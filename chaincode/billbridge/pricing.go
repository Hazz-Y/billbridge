package main

import "errors"

// Pricing math (spec 4.7, shared/src/pricing.ts). Integer only. Discount is an ANNUALIZED rate (bps)
// prorated by tenor.
//
//	tenorDays          = max(1, days(listedAt -> dueDate))
//	discountPerUnit    = floor(unitFace * discountBps * tenorDays / (365 * 10000))
//	pricePerUnitPaise  = unitFace - discountPerUnit
//	yieldPerUnitPaise  = discountPerUnit
//	annualizedYieldBps = floor(yieldPerUnit * 365 * 10000 / (pricePerUnit * tenorDays))
//
// Worked example: unit 100000, 800 bps, 67 days -> discount 1468, price 98532, yield 811 bps.
type Pricing struct {
	UnitFaceValuePaise   int64 `json:"unitFaceValuePaise"`
	DiscountBps          int64 `json:"discountBps"`
	TenorDays            int64 `json:"tenorDays"`
	DiscountPerUnitPaise int64 `json:"discountPerUnitPaise"`
	PricePerUnitPaise    int64 `json:"pricePerUnitPaise"`
	YieldPerUnitPaise    int64 `json:"yieldPerUnitPaise"`
	AnnualizedYieldBps   int64 `json:"annualizedYieldBps"`
}

// ComputePricing is the port of computePricing.
func ComputePricing(unitFaceValuePaise, discountBps, tenorDays int64) (Pricing, error) {
	if !isSafeInteger(unitFaceValuePaise) || unitFaceValuePaise <= 0 {
		return Pricing{}, errors.New("unitFaceValuePaise must be a positive integer")
	}
	if !isSafeInteger(discountBps) || discountBps < 0 {
		return Pricing{}, errors.New("discountBps must be a non-negative integer")
	}
	if !isSafeInteger(tenorDays) || tenorDays < 1 {
		return Pricing{}, errors.New("tenorDays must be >= 1")
	}
	faceTimesBps, err := mulChecked(unitFaceValuePaise, discountBps)
	if err != nil {
		return Pricing{}, err
	}
	discountPerUnit, err := MulDivFloor(faceTimesBps, tenorDays, 365*10000)
	if err != nil {
		return Pricing{}, err
	}
	pricePerUnit := unitFaceValuePaise - discountPerUnit
	if pricePerUnit <= 0 {
		return Pricing{}, errors.New("discount exceeds face value")
	}
	priceTimesTenor, err := mulChecked(pricePerUnit, tenorDays)
	if err != nil {
		return Pricing{}, err
	}
	annualized, err := MulDivFloor(discountPerUnit*365, 10000, priceTimesTenor)
	if err != nil {
		return Pricing{}, err
	}
	return Pricing{
		UnitFaceValuePaise: unitFaceValuePaise, DiscountBps: discountBps, TenorDays: tenorDays,
		DiscountPerUnitPaise: discountPerUnit, PricePerUnitPaise: pricePerUnit,
		YieldPerUnitPaise: discountPerUnit, AnnualizedYieldBps: annualized,
	}, nil
}
