/**
 * Shared conformance test vectors (shared/test-vectors/*.json).
 * The SAME files are executed by `go test` (chaincode) and Vitest (MockLedger).
 *
 * Format:
 * {
 *   "name": "...", "config": { ...InitLedger overrides },
 *   "identities": { "<alias>": { "mspId", "role", "participantId" } },
 *   "steps": [
 *     { "id": "s1", "caller": "<alias>", "fn": "CreateInvoice", "args": [ ... ], "ts": "2026-03-01T10:00:00Z",
 *       "expect": { "error": "ERR_X" } | { "result": { ...deep-subset... } }, "events": ["INVOICE_CREATED"] }
 *   ]
 * }
 * Args: strings are passed as-is, numbers/objects are encoded like the backend does (String / JSON).
 * Any string of the form "$<stepId>.<path.to.field>" is substituted with that field of a previous step's result.
 * Expected results are matched as a deep SUBSET of the actual result (arrays: same length, element-wise subset).
 */
import { z } from 'zod';
import type { CallerIdentity } from '../ledger-client.js';
import { encodeArg } from '../ledger-client.js';
import { isLedgerError } from '../errors.js';
import { MockLedger } from './mock-ledger.js';
import { MUTATING_FUNCTIONS } from './contract.js';

export const VectorStepSchema = z.object({
  id: z.string().optional(),
  caller: z.string(),
  fn: z.string(),
  args: z.array(z.unknown()).default([]),
  ts: z.string().optional(),
  expect: z.object({ error: z.string().optional(), result: z.unknown().optional() }).default({}),
  events: z.array(z.string()).optional(),
  note: z.string().optional(),
});
export const VectorFileSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  config: z.record(z.unknown()).default({}),
  identities: z.record(z.object({ mspId: z.string(), role: z.string(), participantId: z.string() })),
  steps: z.array(VectorStepSchema),
});
export type VectorFile = z.infer<typeof VectorFileSchema>;
export type VectorStep = z.infer<typeof VectorStepSchema>;

const BASE_TS = Date.parse('2026-03-01T10:00:00Z');
export function defaultStepTs(i: number): string { return new Date(BASE_TS + i * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'); }

function lookup(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const p of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function substitute(value: unknown, results: Map<string, unknown>): unknown {
  if (typeof value === 'string' && value.startsWith('$')) {
    const [stepId, ...path] = value.slice(1).split('.');
    if (stepId && results.has(stepId)) return lookup(results.get(stepId), path);
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, results));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, results)]));
  }
  return value;
}

/** Deep subset match. Returns null when ok, else a description of the first mismatch. */
export function subsetMismatch(expected: unknown, actual: unknown, path = '$'): string | null {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return `${path}: expected array, got ${typeof actual}`;
    if (expected.length !== actual.length) return `${path}: expected length ${expected.length}, got ${actual.length}`;
    for (let i = 0; i < expected.length; i++) { const m = subsetMismatch(expected[i], actual[i], `${path}[${i}]`); if (m) return m; }
    return null;
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return `${path}: expected object, got ${JSON.stringify(actual)}`;
    for (const [k, v] of Object.entries(expected)) {
      const m = subsetMismatch(v, (actual as Record<string, unknown>)[k], `${path}.${k}`);
      if (m) return m;
    }
    return null;
  }
  if (expected !== actual) return `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  return null;
}

export interface VectorFailure { step: number; id?: string; fn: string; message: string }

/** Run one vector file against a fresh MockLedger. Returns failures (empty = pass). */
export async function runVector(file: VectorFile): Promise<VectorFailure[]> {
  const ledger = new MockLedger({ filePath: null });
  const failures: VectorFailure[] = [];
  const results = new Map<string, unknown>();
  const bootstrapId = (file.config['bootstrapOperatorId'] as string | undefined) ?? 'operator1';
  const bootstrap: CallerIdentity = { mspId: 'Org1MSP', role: 'OPERATOR', participantId: bootstrapId };
  await ledger.init(JSON.stringify(file.config), bootstrap, { txTimestamp: defaultStepTs(-1) });

  for (let i = 0; i < file.steps.length; i++) {
    const step = file.steps[i] as VectorStep;
    const identity = file.identities[step.caller];
    if (!identity) { failures.push({ step: i, id: step.id, fn: step.fn, message: `unknown caller alias ${step.caller}` }); continue; }
    const caller = identity as CallerIdentity;
    const args = (substitute(step.args, results) as unknown[]).map(encodeArg);
    const ts = step.ts ?? defaultStepTs(i);
    let actual: unknown;
    let errorCode: string | null = null;
    let eventTypes: string[] = [];
    try {
      if (MUTATING_FUNCTIONS.has(step.fn)) {
        const r = await ledger.submit(caller, step.fn, args, { txTimestamp: ts });
        actual = r.data;
        const ev = (await ledger.recentEvents(1))[0];
        eventTypes = ev ? ev.events.map((e) => e.type) : [];
      } else {
        actual = await ledger.evaluate(caller, step.fn, args, { txTimestamp: ts });
      }
    } catch (e) {
      if (isLedgerError(e)) errorCode = e.code;
      else { failures.push({ step: i, id: step.id, fn: step.fn, message: `unexpected throw: ${e instanceof Error ? e.stack ?? e.message : String(e)}` }); continue; }
    }
    if (step.id && actual !== undefined) results.set(step.id, actual);
    const expectedErr = step.expect.error ?? null;
    if (expectedErr !== errorCode) {
      failures.push({ step: i, id: step.id, fn: step.fn, message: `expected error ${expectedErr ?? 'none'}, got ${errorCode ?? 'none'}${actual !== undefined ? ` (result ${JSON.stringify(actual).slice(0, 200)})` : ''}` });
      continue;
    }
    if (step.expect.result !== undefined) {
      const expected = substitute(step.expect.result, results);
      const m = subsetMismatch(expected, actual);
      if (m) failures.push({ step: i, id: step.id, fn: step.fn, message: m });
    }
    if (step.events) {
      for (const t of step.events) if (!eventTypes.includes(t)) failures.push({ step: i, id: step.id, fn: step.fn, message: `expected event ${t}; got [${eventTypes.join(', ')}]` });
    }
  }
  return failures;
}
