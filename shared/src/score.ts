/**
 * Buyer reliability score (spec 4.9). Integer math, round-half-up.
 *
 * if onTime + late + defaulted == 0 -> 50
 * num = 100 * 2 * onTime
 * den = 2*onTime + 3*late + 10*defaulted
 * if den == 0 -> 50
 * score = (2*num + den) / (2*den)   (integer division = round-half-up)
 *
 * Check values: 0/0/0->50, 1/0/0->100, 5/2/0->63, 6/2/0->67, 0/0/1->0, 4/1/0->73
 */
export function computeBuyerScore(onTime: number, late: number, defaulted: number): number {
  for (const v of [onTime, late, defaulted]) {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error('score inputs must be non-negative integers');
  }
  if (onTime + late + defaulted === 0) return 50;
  const num = 100 * 2 * onTime;
  const den = 2 * onTime + 3 * late + 10 * defaulted;
  if (den === 0) return 50;
  return Math.trunc((2 * num + den) / (2 * den));
}

export function scoreBand(score: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (score >= 75) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  return 'LOW';
}
