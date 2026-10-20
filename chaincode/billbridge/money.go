package main

import (
	"errors"
	"math/big"
)

// All amounts are INTEGER PAISE (1 INR = 100 paise). Never floats.
// JS numbers are only exact up to 2^53-1; the TS reference enforces Number.isSafeInteger, so the
// Go port enforces the same bound to stay byte-for-byte equivalent.
const maxSafeInteger = int64(1)<<53 - 1

func isSafeInteger(n int64) bool { return n >= -maxSafeInteger && n <= maxSafeInteger }

// MulDivFloor = floor(a*b/c) computed with big.Int (overflow-safe); the result must be a safe integer.
func MulDivFloor(a, b, c int64) (int64, error) {
	if c == 0 {
		return 0, errors.New("division by zero")
	}
	r := new(big.Int).Mul(big.NewInt(a), big.NewInt(b))
	r.Quo(r, big.NewInt(c)) // truncating division; BigInt division in JS truncates toward zero too
	if !r.IsInt64() || !isSafeInteger(r.Int64()) {
		return 0, errors.New("mulDivFloor overflow")
	}
	return r.Int64(), nil
}

// mulChecked multiplies two int64 and errors if the product is not a safe integer.
func mulChecked(a, b int64) (int64, error) {
	r := new(big.Int).Mul(big.NewInt(a), big.NewInt(b))
	if !r.IsInt64() || !isSafeInteger(r.Int64()) {
		return 0, errors.New("integer overflow")
	}
	return r.Int64(), nil
}

// addChecked adds two int64 and errors if the sum is not a safe integer.
func addChecked(a, b int64) (int64, error) {
	r := new(big.Int).Add(big.NewInt(a), big.NewInt(b))
	if !r.IsInt64() || !isSafeInteger(r.Int64()) {
		return 0, errors.New("integer overflow")
	}
	return r.Int64(), nil
}
