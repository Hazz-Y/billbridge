/** Date helpers. All ledger timestamps are UTC ISO-8601; invoice dates are YYYY-MM-DD. */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  return new Date(t).toISOString().slice(0, 10) === s;
}

export function isIsoTimestamp(s: string): boolean {
  const t = Date.parse(s);
  return !Number.isNaN(t);
}

/** Epoch seconds (UTC) of a YYYY-MM-DD at 00:00:00Z or a full ISO timestamp. */
export function toEpochSeconds(s: string): number {
  const str = DATE_RE.test(s) ? `${s}T00:00:00Z` : s;
  const t = Date.parse(str);
  if (Number.isNaN(t)) throw new Error(`invalid date: ${s}`);
  return Math.floor(t / 1000);
}

export function epochToIso(sec: number): string {
  return new Date(sec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Whole calendar days between the DATE parts of two ISO strings (UTC): date(b) - date(a). */
export function daysBetween(a: string, b: string): number {
  const da = toEpochSeconds(a.slice(0, 10));
  const db = toEpochSeconds(b.slice(0, 10));
  return Math.floor((db - da) / 86400);
}

export function addDays(isoDate: string, days: number): string {
  return epochToIso(toEpochSeconds(isoDate.slice(0, 10)) + days * 86400).slice(0, 10);
}
