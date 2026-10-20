package main

import "testing"

// Mirrors shared/src/math.test.ts so the Go math is proven against the same check values.

func TestPricingWorkedExample(t *testing.T) {
	p, err := ComputePricing(100000, 800, 67)
	if err != nil {
		t.Fatal(err)
	}
	if p.DiscountPerUnitPaise != 1468 || p.PricePerUnitPaise != 98532 || p.AnnualizedYieldBps != 811 {
		t.Fatalf("got discount %d price %d yield %d; want 1468 / 98532 / 811", p.DiscountPerUnitPaise, p.PricePerUnitPaise, p.AnnualizedYieldBps)
	}
	z, err := ComputePricing(100000, 0, 1)
	if err != nil || z.PricePerUnitPaise != 100000 {
		t.Fatalf("zero discount: price %d err %v", z.PricePerUnitPaise, err)
	}
	if _, err := ComputePricing(100000, 800, 0); err == nil {
		t.Fatal("tenor 0 must error")
	}
}

func TestBuyerScoreTable(t *testing.T) {
	cases := []struct{ on, late, def, want int64 }{
		{0, 0, 0, 50}, {1, 0, 0, 100}, {5, 2, 0, 63}, {6, 2, 0, 67}, {0, 0, 1, 0}, {4, 1, 0, 73}, {3, 0, 0, 100}, {5, 2, 1, 38}, {5, 3, 0, 53}, {5, 3, 1, 34},
	}
	for _, c := range cases {
		got, err := ComputeBuyerScore(c.on, c.late, c.def)
		if err != nil {
			t.Fatal(err)
		}
		if got != c.want {
			t.Errorf("%d/%d/%d -> %d, want %d", c.on, c.late, c.def, got, c.want)
		}
	}
	if _, err := ComputeBuyerScore(-1, 0, 0); err == nil {
		t.Error("negative input must error")
	}
}

func TestWaterfallDemoCase(t *testing.T) {
	w, err := ComputeWaterfall(40_000_000, 400, 400, []WaterfallHolder{{"investorB", 150}, {"investorA", 250}})
	if err != nil {
		t.Fatal(err)
	}
	if len(w.Shares) != 2 || w.Shares[0].HolderID != "investorA" || w.Shares[0].SharePaise != 25_000_000 || w.Shares[1].HolderID != "investorB" || w.Shares[1].SharePaise != 15_000_000 {
		t.Fatalf("unexpected shares %+v", w.Shares)
	}
	if w.ResidualPaise != 0 {
		t.Fatalf("residual %d", w.ResidualPaise)
	}
}

func TestWaterfallSingleHolder(t *testing.T) {
	w, err := ComputeWaterfall(1_000_000, 10, 10, []WaterfallHolder{{"x", 10}})
	if err != nil || w.Shares[0].SharePaise != 1_000_000 {
		t.Fatalf("single holder: %+v err %v", w, err)
	}
}

func TestWaterfallSevenHoldersRemainder(t *testing.T) {
	holders := []WaterfallHolder{}
	for _, h := range []string{"h1", "h2", "h3", "h4", "h5", "h6", "h7"} {
		holders = append(holders, WaterfallHolder{h, 1})
	}
	w, err := ComputeWaterfall(1_000_003, 7, 7, holders)
	if err != nil {
		t.Fatal(err)
	}
	var sum int64
	for i, s := range w.Shares {
		sum += s.SharePaise
		if i < 6 && s.SharePaise != 142857 {
			t.Errorf("share %d = %d, want 142857", i, s.SharePaise)
		}
	}
	if sum+w.ResidualPaise != 1_000_003 {
		t.Errorf("sum %d + residual %d != 1000003", sum, w.ResidualPaise)
	}
	if w.Shares[6].HolderID != "h7" || w.Shares[6].SharePaise != 1_000_003-142857*6 {
		t.Errorf("last share %+v", w.Shares[6])
	}
}

func TestWaterfallPartiallyFundedResidual(t *testing.T) {
	w, err := ComputeWaterfall(1_000_000, 4, 10, []WaterfallHolder{{"a", 3}, {"b", 1}})
	if err != nil {
		t.Fatal(err)
	}
	if w.InvestorPoolPaise != 400_000 || w.ResidualPaise != 600_000 {
		t.Fatalf("pool %d residual %d", w.InvestorPoolPaise, w.ResidualPaise)
	}
	if w.Shares[0].SharePaise != 300_000 || w.Shares[1].SharePaise != 100_000 {
		t.Fatalf("shares %+v", w.Shares)
	}
}

func TestWaterfallInvariantLoop(t *testing.T) {
	for amt := int64(999_990); amt < 1_000_010; amt++ {
		w, err := ComputeWaterfall(amt, 9, 10, []WaterfallHolder{{"a", 4}, {"b", 3}, {"c", 2}})
		if err != nil {
			t.Fatal(err)
		}
		var sum int64
		for _, s := range w.Shares {
			sum += s.SharePaise
		}
		if sum+w.ResidualPaise != amt {
			t.Errorf("amount %d: sum %d + residual %d", amt, sum, w.ResidualPaise)
		}
	}
	if _, err := ComputeWaterfall(100, 5, 10, []WaterfallHolder{{"a", 4}}); err == nil {
		t.Error("holder units != unitsSold must error")
	}
}

func TestCanonicalStrings(t *testing.T) {
	got := InvoiceContentString("x", "y", "2026-02-25", 100, []LineItem{
		{Description: "  B item ", Quantity: 1, UnitPricePaise: 1, TotalPaise: 1},
		{Description: "a", Quantity: 2, UnitPricePaise: 1, TotalPaise: 2},
	})
	want := "X|Y|2026-02-25|100|a~2~1~2;b item~1~1~1"
	if got != want {
		t.Fatalf("content string\n got %q\nwant %q", got, want)
	}
	if id := InvoiceIdentityString(" 27aaacs1234a1zx", "27AABCA3456D1ZX", " inv-2025-001 "); id != "27AAACS1234A1ZX|27AABCA3456D1ZX|INV-2025-001" {
		t.Fatalf("identity string %q", id)
	}
	if NormalizeDescription("  cnc   HOUSINGS \t") != "cnc housings" {
		t.Fatal("normalizeDescription must collapse whitespace")
	}
	if InvoiceContentString("s", "b", "2026-02-25T10:00:00Z", 1, nil) != "S|B|2026-02-25|1|" {
		t.Fatal("empty line items / timestamp date part")
	}
	if sha256Hex("abc") != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" {
		t.Fatal("sha256 hex mismatch")
	}
}

func TestDates(t *testing.T) {
	if !IsIsoDate("2026-02-28") || IsIsoDate("2026-02-30") || IsIsoDate("2026-2-5") || IsIsoDate("2026-02-25T00:00:00Z") {
		t.Fatal("IsIsoDate")
	}
	d, err := DaysBetween("2026-03-01T12:00:00Z", "2026-05-07")
	if err != nil || d != 67 {
		t.Fatalf("daysBetween = %d err %v", d, err)
	}
	d, _ = DaysBetween("2026-05-07", "2026-05-06T23:59:59Z")
	if d != -1 {
		t.Fatalf("negative daysBetween = %d", d)
	}
	s, err := AddDays("2026-05-07", 7)
	if err != nil || s != "2026-05-14" {
		t.Fatalf("addDays = %s err %v", s, err)
	}
	sec, _ := ToEpochSeconds("2026-03-01T10:00:00Z")
	if EpochToIso(sec+6480000) != "2026-05-15T10:00:00Z" {
		t.Fatal("epoch round trip")
	}
}

func TestMulDivFloor(t *testing.T) {
	if v, _ := MulDivFloor(1, 10000, 2); v != 5000 {
		t.Fatal("defaultRate")
	}
	if _, err := MulDivFloor(1, 1, 0); err == nil {
		t.Fatal("div by zero")
	}
	if _, err := MulDivFloor(maxSafeInteger, 1000, 1); err == nil {
		t.Fatal("overflow must error")
	}
}
