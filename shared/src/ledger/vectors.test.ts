import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VectorFileSchema, runVector } from './vectors.js';

const dir = join(__dirname, '..', '..', 'test-vectors');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

describe('shared conformance vectors (MockLedger)', () => {
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    it(f, async () => {
      const vec = VectorFileSchema.parse(JSON.parse(readFileSync(join(dir, f), 'utf8')));
      const failures = await runVector(vec);
      expect(failures, failures.map((x) => `step ${x.step}${x.id ? ` (${x.id})` : ''} ${x.fn}: ${x.message}`).join('\n')).toEqual([]);
    });
  }
});
