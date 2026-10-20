package main

import (
	"errors"
	"fmt"
	"sort"
)

// Settlement waterfall (spec 4.8, shared/src/waterfall.ts). Deterministic, integer only.
//
//	investorPool = floor(amount * unitsSold / totalUnits)
//	residual     = amount - investorPool                         (-> supplier, 0 when fully funded)
//	holders sorted by holderId ascending
//	each holder except last: share = floor(investorPool * units / unitsSold)
//	last holder:             share = investorPool - sum(previous)   (remainder, exact total)
//
// Invariant: sum(shares) + residual == amount.
type WaterfallHolder struct {
	HolderID string
	Units    int64
}

type WaterfallShare struct {
	HolderID   string
	Units      int64
	SharePaise int64
	Index      int
}

type WaterfallResult struct {
	InvestorPoolPaise int64
	ResidualPaise     int64
	Shares            []WaterfallShare
}

// ComputeWaterfall is the port of computeWaterfall.
func ComputeWaterfall(amountPaise, unitsSold, totalUnits int64, holders []WaterfallHolder) (WaterfallResult, error) {
	if !isSafeInteger(amountPaise) || amountPaise < 0 {
		return WaterfallResult{}, errors.New("amountPaise must be a non-negative integer")
	}
	if !isSafeInteger(totalUnits) || totalUnits <= 0 {
		return WaterfallResult{}, errors.New("totalUnits must be positive")
	}
	if !isSafeInteger(unitsSold) || unitsSold < 0 || unitsSold > totalUnits {
		return WaterfallResult{}, errors.New("unitsSold out of range")
	}
	sorted := make([]WaterfallHolder, len(holders))
	copy(sorted, holders)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].HolderID < sorted[j].HolderID })
	var sumUnits int64
	for _, h := range sorted {
		sumUnits += h.Units
	}
	if sumUnits != unitsSold {
		return WaterfallResult{}, fmt.Errorf("holder units (%d) != unitsSold (%d)", sumUnits, unitsSold)
	}
	pool, err := MulDivFloor(amountPaise, unitsSold, totalUnits)
	if err != nil {
		return WaterfallResult{}, err
	}
	residual := amountPaise - pool
	shares := make([]WaterfallShare, 0, len(sorted))
	var distributed int64
	for i, h := range sorted {
		var share int64
		if i == len(sorted)-1 {
			share = pool - distributed
		} else {
			share, err = MulDivFloor(pool, h.Units, unitsSold)
			if err != nil {
				return WaterfallResult{}, err
			}
		}
		distributed += share
		shares = append(shares, WaterfallShare{HolderID: h.HolderID, Units: h.Units, SharePaise: share, Index: i})
	}
	total := residual
	for _, s := range shares {
		total += s.SharePaise
	}
	if total != amountPaise {
		return WaterfallResult{}, fmt.Errorf("waterfall invariant violated: %d != %d", total, amountPaise)
	}
	return WaterfallResult{InvestorPoolPaise: pool, ResidualPaise: residual, Shares: shares}, nil
}
