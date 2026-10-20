/**
 * Money helpers. All amounts are INTEGER PAISE (1 INR = 100 paise).
 * Never use floats for money; conversion to rupee strings happens only at the render / UPI boundary.
 */
export const PAISE_PER_RUPEE = 100;

export function isPaise(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

export function assertPaise(v: unknown, label = 'amount'): number {
  if (!isPaise(v)) throw new Error(`${label} must be a non-negative safe integer (paise); got ${String(v)}`);
  return v;
}

/** 123456 paise -> "1234.56" (for `upi://pay?am=`). Pure integer math. */
export function paiseToDecimalString(paise: number): string {
  assertPaise(paise);
  const rupees = Math.trunc(paise / PAISE_PER_RUPEE);
  const rem = paise % PAISE_PER_RUPEE;
  return `${rupees}.${rem.toString().padStart(2, '0')}`;
}

/**
 * "1,23,456.78" / "Rs 1234.5" / "1234" -> paise. String parsing only, never parseFloat*100.
 * Returns null when the string is not a valid decimal amount.
 */
export function parseDecimalToPaise(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '').replace(/^(INR|Rs\.?)/i, '');
  const m = /^(-)?(\d+)(?:\.(\d{0,2})\d*)?$/.exec(cleaned);
  if (!m) return null;
  if (m[1]) return null;
  const whole = m[2] ?? '0';
  const frac = (m[3] ?? '').padEnd(2, '0');
  const rupees = Number(whole);
  if (!Number.isSafeInteger(rupees)) return null;
  const paise = rupees * PAISE_PER_RUPEE + Number(frac);
  return Number.isSafeInteger(paise) ? paise : null;
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** Render boundary only: 40000000 -> "₹4,00,000" ; 9853200 -> "₹98,532.00" */
export function formatINR(paise: number, opts: { whole?: boolean } = {}): string {
  assertPaise(paise);
  const rupees = Math.trunc(paise / PAISE_PER_RUPEE);
  const rem = paise % PAISE_PER_RUPEE;
  if (opts.whole || rem === 0) return inrWhole.format(rupees);
  // Intl needs a number; it is only used for display formatting, never arithmetic.
  return inrFormatter.format(Number(`${rupees}.${rem.toString().padStart(2, '0')}`));
}

/** Compact: 40000000 -> "₹4.00 L", 2500000000 -> "₹25.00 Cr" (display only) */
export function formatINRCompact(paise: number): string {
  assertPaise(paise);
  const rupees = Math.trunc(paise / PAISE_PER_RUPEE);
  if (rupees >= 10_000_000) return `₹${(rupees / 10_000_000).toFixed(2)} Cr`;
  if (rupees >= 100_000) return `₹${(rupees / 100_000).toFixed(2)} L`;
  return inrWhole.format(rupees);
}

/** 811 bps -> "8.11%" (display only) */
export function formatBps(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const rem = Math.abs(bps % 100);
  return `${whole}.${rem.toString().padStart(2, '0')}%`;
}

/** floor(a*b/c) with overflow guard (BigInt internally, result must be a safe integer). */
export function mulDivFloor(a: number, b: number, c: number): number {
  if (c === 0) throw new Error('division by zero');
  const r = (BigInt(a) * BigInt(b)) / BigInt(c);
  const n = Number(r);
  if (!Number.isSafeInteger(n)) throw new Error('mulDivFloor overflow');
  return n;
}
