/**
 * GSTIN validation: 15 chars, regex + check digit.
 * Format: 2-digit state code, 10-char PAN, 1 entity code, 'Z', 1 check character.
 * Check digit algorithm (GSTN): base-36 characters, alternating weights 1 and 2 (left to right),
 * products reduced as floor(p/36) + p%36, sum mod 36, check = (36 - sum%36) % 36.
 */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < first14.length; i++) {
    const v = ALPHABET.indexOf(first14[i] ?? '');
    if (v < 0) throw new Error('invalid GSTIN character');
    const weight = i % 2 === 0 ? 1 : 2;
    const p = v * weight;
    sum += Math.floor(p / 36) + (p % 36);
  }
  return ALPHABET[(36 - (sum % 36)) % 36] ?? '0';
}

export function isValidGstin(gstin: string): boolean {
  if (!GSTIN_REGEX.test(gstin)) return false;
  return gstinCheckChar(gstin.slice(0, 14)) === gstin[14];
}

/** Build a structurally valid synthetic GSTIN from a 14-char prefix (adds the check character). */
export function makeGstin(first14: string): string {
  const g = first14 + gstinCheckChar(first14);
  if (!GSTIN_REGEX.test(g)) throw new Error(`prefix does not produce a valid GSTIN shape: ${g}`);
  return g;
}
