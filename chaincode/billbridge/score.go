package main

import "errors"

// Buyer reliability score (spec 4.9, shared/src/score.ts). Integer math, round-half-up.
//
//	if onTime + late + defaulted == 0 -> 50
//	num = 100 * 2 * onTime
//	den = 2*onTime + 3*late + 10*defaulted
//	if den == 0 -> 50
//	score = (2*num + den) / (2*den)   (integer division = round-half-up)
//
// Check values: 0/0/0->50, 1/0/0->100, 5/2/0->63, 6/2/0->67, 0/0/1->0, 4/1/0->73
func ComputeBuyerScore(onTime, late, defaulted int64) (int64, error) {
	for _, v := range []int64{onTime, late, defaulted} {
		if !isSafeInteger(v) || v < 0 {
			return 0, errors.New("score inputs must be non-negative integers")
		}
	}
	if onTime+late+defaulted == 0 {
		return 50, nil
	}
	num := 100 * 2 * onTime
	den := 2*onTime + 3*late + 10*defaulted
	if den == 0 {
		return 50, nil
	}
	return (2*num + den) / (2 * den), nil
}
