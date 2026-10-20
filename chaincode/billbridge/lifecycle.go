package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// ───────────────────────── invoice lifecycle ─────────────────────────

// privateDetailsInput is the loosely-typed shape of the CreateInvoice privateDetails argument.
// lineItems is kept raw so "missing / not an array" can be reported exactly like the TS reference.
type privateDetailsInput struct {
	SupplierGstin string          `json:"supplierGstin"`
	BuyerGstin    string          `json:"buyerGstin"`
	InvoiceNumber string          `json:"invoiceNumber"`
	FileHash      string          `json:"fileHash"`
	LineItems     json.RawMessage `json:"lineItems"`
	ExtractedJson string          `json:"extractedJson"`
}

func short(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func (c *core) CreateInvoice(supplierID, buyerID, faceValuePaise, issueDate, dueDate, privateDetailsJSON string) (*Invoice, error) {
	caller, err := c.requireRole("MSME")
	if err != nil {
		return nil, err
	}
	if err := c.bind(caller, supplierID, "supplierId"); err != nil {
		return nil, err
	}
	if _, err := c.requireActive(caller); err != nil {
		return nil, err
	}
	cfg, err := c.config()
	if err != nil {
		return nil, err
	}
	face, err := parseInt64(faceValuePaise, "faceValuePaise", intOpts{min: ptr(1)})
	if err != nil {
		return nil, err
	}
	if !IsIsoDate(issueDate) {
		return nil, newErr("ERR_INVALID_ARGUMENT", "issueDate must be YYYY-MM-DD", D{"field": "issueDate"})
	}
	if !IsIsoDate(dueDate) {
		return nil, newErr("ERR_INVALID_ARGUMENT", "dueDate must be YYYY-MM-DD", D{"field": "dueDate"})
	}
	dueSec, _ := ToEpochSeconds(dueDate)
	issueSec, _ := ToEpochSeconds(issueDate)
	if dueSec <= issueSec {
		return nil, newErr("ERR_INVALID_ARGUMENT", "dueDate must be after issueDate", D{"field": "dueDate"})
	}
	var pd privateDetailsInput
	if err := parseJSONArg(privateDetailsJSON, &pd, "privateDetails"); err != nil {
		return nil, err
	}
	if err := requireNonEmpty(pd.SupplierGstin, "privateDetails.supplierGstin"); err != nil {
		return nil, err
	}
	if err := requireNonEmpty(pd.BuyerGstin, "privateDetails.buyerGstin"); err != nil {
		return nil, err
	}
	if err := requireNonEmpty(pd.InvoiceNumber, "privateDetails.invoiceNumber"); err != nil {
		return nil, err
	}
	if err := requireNonEmpty(pd.FileHash, "privateDetails.fileHash"); err != nil {
		return nil, err
	}
	rawItems := strings.TrimSpace(string(pd.LineItems))
	if !strings.HasPrefix(rawItems, "[") {
		return nil, newErr("ERR_INVALID_ARGUMENT", "privateDetails.lineItems must be an array", D{"field": "lineItems"})
	}
	lineItems := make([]LineItem, 0)
	if err := json.Unmarshal(pd.LineItems, &lineItems); err != nil {
		return nil, newErr("ERR_INVALID_ARGUMENT", "privateDetails.lineItems must be an array of line items", D{"field": "lineItems"})
	}
	if face%cfg.UnitFaceValuePaise != 0 {
		return nil, newErr("ERR_FACE_NOT_UNIT_MULTIPLE", fmt.Sprintf("faceValuePaise %d is not a multiple of unit %d", face, cfg.UnitFaceValuePaise),
			D{"faceValuePaise": face, "unitFaceValuePaise": cfg.UnitFaceValuePaise})
	}
	buyer, err := c.participant(buyerID)
	if err != nil {
		return nil, err
	}
	if buyer.Role != "BUYER" {
		return nil, newErr("ERR_INVALID_ARGUMENT", buyerID+" is not a BUYER", D{"buyerId": buyerID})
	}
	if buyer.KycStatus != "APPROVED" {
		return nil, newErr("ERR_KYC_NOT_APPROVED", fmt.Sprintf("buyer %s KYC status is %s", buyerID, buyer.KycStatus), D{"participantId": buyerID})
	}

	// ── double-financing guards (spec 4.6) — identity, content, file ──
	invoiceID := sha256Hex(InvoiceIdentityString(pd.SupplierGstin, pd.BuyerGstin, pd.InvoiceNumber))
	contentHash := sha256Hex(InvoiceContentString(pd.SupplierGstin, pd.BuyerGstin, issueDate, face, lineItems))
	existing, err := getJSON[Invoice](c, keyInvoice(invoiceID))
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, newErr("ERR_DUPLICATE_INVOICE_ID",
			fmt.Sprintf("Invoice %s from %s to %s is already tokenized (status: %s, tx %s…)", pd.InvoiceNumber, existing.SupplierID, existing.BuyerID, existing.Status, short(existing.CreatedTxID, 12)),
			D{"guard": "IDENTITY", "invoiceId": invoiceID, "invoiceNumber": pd.InvoiceNumber, "existingStatus": existing.Status, "existingTxId": existing.CreatedTxID})
	}
	contentClash, err := c.getString(keyContent(contentHash))
	if err != nil {
		return nil, err
	}
	if contentClash != "" {
		other, err := c.invoice(contentClash)
		if err != nil {
			return nil, err
		}
		return nil, newErr("ERR_DUPLICATE_INVOICE_CONTENT",
			fmt.Sprintf("Invoice content (same supplier, buyer, date, amount and line items) already tokenized as invoice %s… (status: %s); only the invoice number differs", short(contentClash, 12), other.Status),
			D{"guard": "CONTENT", "contentHash": contentHash, "existingInvoiceId": contentClash, "existingStatus": other.Status, "existingTxId": other.CreatedTxID})
	}
	fileClash, err := c.getString(keyFile(pd.FileHash))
	if err != nil {
		return nil, err
	}
	if fileClash != "" {
		other, err := c.invoice(fileClash)
		if err != nil {
			return nil, err
		}
		return nil, newErr("ERR_DUPLICATE_FILE",
			fmt.Sprintf("This exact PDF (sha256 %s…) was already uploaded for invoice %s… (status: %s)", short(pd.FileHash, 12), short(fileClash, 12), other.Status),
			D{"guard": "FILE", "fileHash": pd.FileHash, "existingInvoiceId": fileClash, "existingStatus": other.Status, "existingTxId": other.CreatedTxID})
	}

	now, err := c.now()
	if err != nil {
		return nil, err
	}
	inv := &Invoice{
		InvoiceID: invoiceID, ContentHash: contentHash, SupplierID: supplierID, BuyerID: buyerID, FaceValuePaise: face, IssueDate: issueDate, DueDate: dueDate,
		UnitFaceValuePaise: cfg.UnitFaceValuePaise, DiscountBps: 0, TenorDays: 0, PricePerUnitPaise: 0, AnnualizedYieldBps: 0,
		TotalUnits: face / cfg.UnitFaceValuePaise, UnitsSold: 0, MinFundingUnits: 0, Status: "DRAFT",
		CreatedAt: now, UpdatedAt: now, CreatedTxID: c.stub.GetTxID(),
	}
	if err := c.saveInvoice(inv); err != nil {
		return nil, err
	}
	for _, kv := range []struct{ k, v string }{
		{keyContent(contentHash), invoiceID}, {keyFile(pd.FileHash), invoiceID}, {keyStatus("DRAFT", invoiceID), invoiceID},
		{keySupplier(supplierID, invoiceID), invoiceID}, {keyBuyer(buyerID, invoiceID), invoiceID},
	} {
		if err := c.stub.PutState(kv.k, []byte(kv.v)); err != nil {
			return nil, err
		}
	}
	priv := InvoicePrivateDetails{InvoiceID: invoiceID, SupplierGstin: pd.SupplierGstin, BuyerGstin: pd.BuyerGstin, InvoiceNumber: pd.InvoiceNumber,
		LineItems: lineItems, FileHash: pd.FileHash, ExtractedJson: pd.ExtractedJson}
	privBytes, err := json.Marshal(priv)
	if err != nil {
		return nil, err
	}
	if err := c.stub.PutPrivateData(CollectionInvoiceDetails, keyInvoice(invoiceID), privBytes); err != nil {
		return nil, err
	}
	c.stub.AddEvent(SubEvent{Type: "INVOICE_CREATED", Payload: D{"invoiceId": invoiceID, "supplierId": supplierID, "buyerId": buyerID, "faceValuePaise": face,
		"totalUnits": inv.TotalUnits, "dueDate": dueDate, "contentHash": contentHash, "fileHash": pd.FileHash}})
	c.stub.AddEvent(SubEvent{Type: "INVOICE_STATUS_CHANGED", Payload: D{"invoiceId": invoiceID, "from": nil, "to": "DRAFT"}})
	if err := c.audit("CreateInvoice", caller, invoiceID); err != nil {
		return nil, err
	}
	return inv, nil
}

func (c *core) BuyerAcceptInvoice(invoiceID string) (*Invoice, error) {
	caller, err := c.requireRole("BUYER")
	if err != nil {
		return nil, err
	}
	if _, err := c.requireActive(caller); err != nil {
		return nil, err
	}
	inv, err := c.invoice(invoiceID)
	if err != nil {
		return nil, err
	}
	if err := c.bind(caller, inv.BuyerID, "buyerId"); err != nil {
		return nil, err
	}
	if err := c.transition(inv, "BUYER_ACCEPTED", "BuyerAcceptInvoice"); err != nil {
		return nil, err
	}
	if err := c.saveInvoice(inv); err != nil {
		return nil, err
	}
	c.stub.AddEvent(SubEvent{Type: "INVOICE_ACCEPTED", Payload: D{"invoiceId": invoiceID, "buyerId": caller.ParticipantID}})
	if err := c.audit("BuyerAcceptInvoice", caller, invoiceID); err != nil {
		return nil, err
	}
	return inv, nil
}

func (c *core) ListInvoice(invoiceID, discountBps, minFundingUnits string) (*Invoice, error) {
	caller, err := c.requireRole("OPERATOR")
	if err != nil {
		return nil, err
	}
	if _, err := c.requireActive(caller); err != nil {
		return nil, err
	}
	cfg, err := c.config()
	if err != nil {
		return nil, err
	}
	bps, err := parseInt64(discountBps, "discountBps", intOpts{})
	if err != nil {
		return nil, err
	}
	minUnits, err := parseInt64(minFundingUnits, "minFundingUnits", intOpts{})
	if err != nil {
		return nil, err
	}
	inv, err := c.invoice(invoiceID)
	if err != nil {
		return nil, err
	}
	if bps < cfg.MinDiscountBps || bps > cfg.MaxDiscountBps {
		return nil, newErr("ERR_DISCOUNT_OUT_OF_RANGE", fmt.Sprintf("discountBps %d outside [%d, %d]", bps, cfg.MinDiscountBps, cfg.MaxDiscountBps),
			D{"discountBps": bps, "min": cfg.MinDiscountBps, "max": cfg.MaxDiscountBps})
	}
	if minUnits < 1 || minUnits > inv.TotalUnits {
		return nil, newErr("ERR_INVALID_ARGUMENT", fmt.Sprintf("minFundingUnits must be within [1, %d]", inv.TotalUnits), D{"field": "minFundingUnits", "totalUnits": inv.TotalUnits})
	}
	now, err := c.now()
	if err != nil {
		return nil, err
	}
	tenor, err := DaysBetween(now, inv.DueDate)
	if err != nil {
		return nil, err
	}
	if tenor < 1 {
		tenor = 1
	}
	pricing, err := ComputePricing(inv.UnitFaceValuePaise, bps, tenor)
	if err != nil {
		return nil, err
	}
	if err := c.transition(inv, "LISTED", "ListInvoice"); err != nil {
		return nil, err
	}
	inv.DiscountBps = bps
	inv.TenorDays = tenor
	inv.PricePerUnitPaise = pricing.PricePerUnitPaise
	inv.AnnualizedYieldBps = pricing.AnnualizedYieldBps
	inv.MinFundingUnits = minUnits
	inv.ListedAt = now
	if err := c.saveInvoice(inv); err != nil {
		return nil, err
	}
	c.stub.AddEvent(SubEvent{Type: "INVOICE_LISTED", Payload: D{"invoiceId": invoiceID, "discountBps": bps, "tenorDays": tenor, "pricePerUnitPaise": inv.PricePerUnitPaise,
		"annualizedYieldBps": inv.AnnualizedYieldBps, "minFundingUnits": minUnits, "totalUnits": inv.TotalUnits}})
	if err := c.audit("ListInvoice", caller, invoiceID); err != nil {
		return nil, err
	}
	return inv, nil
}

func (c *core) CancelInvoice(invoiceID, reason string) (*Invoice, error) {
	caller, err := c.requireRole("MSME", "OPERATOR")
	if err != nil {
		return nil, err
	}
	if _, err := c.requireActive(caller); err != nil {
		return nil, err
	}
	inv, err := c.invoice(invoiceID)
	if err != nil {
		return nil, err
	}
	if caller.Role == "MSME" {
		if err := c.bind(caller, inv.SupplierID, "supplierId"); err != nil {
			return nil, err
		}
		if inv.Status != "DRAFT" {
			return nil, newErr("ERR_INVALID_TRANSITION", "MSME may cancel only DRAFT invoices; invoice is "+inv.Status, D{"invoiceId": invoiceID, "from": inv.Status, "to": "CANCELLED"})
		}
	} else if inv.Status != "LISTED" || inv.UnitsSold != 0 {
		return nil, newErr("ERR_INVALID_TRANSITION", fmt.Sprintf("operator may cancel only LISTED invoices with no units sold; invoice is %s with %d sold", inv.Status, inv.UnitsSold),
			D{"invoiceId": invoiceID, "from": inv.Status, "to": "CANCELLED"})
	}
	if err := c.transition(inv, "CANCELLED", "CancelInvoice"); err != nil {
		return nil, err
	}
	inv.CancelReason = reason
	if err := c.saveInvoice(inv); err != nil {
		return nil, err
	}
	// NOTE: CONTENT~ and FILE~ index keys are deliberately kept: a cancelled invoice's identity is burned.
	c.stub.AddEvent(SubEvent{Type: "INVOICE_CANCELLED", Payload: D{"invoiceId": invoiceID, "reason": reason, "by": caller.ParticipantID}})
	if err := c.audit("CancelInvoice", caller, invoiceID); err != nil {
		return nil, err
	}
	return inv, nil
}

// ───────────────────────── investment & settlement ─────────────────────────

func (c *core) Invest(invoiceID, investorID, units, upiRef string) (*InvestResult, error) {
	caller, err := c.requireRole("INVESTOR")
	if err != nil {
		return nil, err
	}
	if err := c.bind(caller, investorID, "investorId"); err != nil {
		return nil, err
	}
	investor, err := c.requireActive(caller)
	if err != nil {
		return nil, err
	}
	if err := requireNonEmpty(upiRef, "upiRef"); err != nil {
		return nil, err
	}
	n, err := parseInt64(units, "units", intOpts{min: ptr(1)})
	if err != nil {
		return nil, err
	}
	inv, err := c.invoice(invoiceID)
	if err != nil {
		return nil, err
	}
	// idempotency: same upiRef -> return original result, no state change
	existingPay, err := getJSON[PaymentRecord](c, keyPayment(upiRef))
	if err != nil {
		return nil, err
	}
	if existingPay != nil {
		h, err := getJSON[Holding](c, keyHolding(existingPay.InvoiceID, existingPay.FromID))
		if err != nil {
			return nil, err
		}
		if h == nil {
			return nil, newErr("ERR_INVALID_ARGUMENT", fmt.Sprintf("upiRef %s already used by a non-funding payment", upiRef), D{"upiRef": upiRef})
		}
		orig, err := c.invoice(existingPay.InvoiceID)
		if err != nil {
			return nil, err
		}
		return &InvestResult{Invoice: orig, Holding: h, Payment: existingPay, Replayed: true}, nil
	}
	if inv.Status != "LISTED" && inv.Status != "PARTIALLY_FUNDED" {
		return nil, newErr("ERR_INVALID_TRANSITION", fmt.Sprintf("invoice is %s; investments are accepted only while LISTED or PARTIALLY_FUNDED", inv.Status),
			D{"invoiceId": invoiceID, "from": inv.Status})
	}
	available := inv.TotalUnits - inv.UnitsSold
	if n > available {
		return nil, newErr("ERR_UNITS_UNAVAILABLE", fmt.Sprintf("requested %d units but only %d available", n, available), D{"invoiceId": invoiceID, "requested": n, "available": available})
	}
	amount, err := mulChecked(n, inv.PricePerUnitPaise)
	if err != nil {
		return nil, err
	}
	holdingKey := keyHolding(invoiceID, investorID)
	holding, err := getJSON[Holding](c, holdingKey)
	if err != nil {
		return nil, err
	}
	if holding == nil {
		acquiredAt, err := c.now()
		if err != nil {
			return nil, err
		}
		holding = &Holding{InvoiceID: invoiceID, HolderID: investorID, Units: 0, CostPaise: 0, UpiRefs: []string{}, AcquiredAt: acquiredAt, ReceivedPaise: 0}
	}
	if holding.UpiRefs == nil {
		holding.UpiRefs = []string{}
	}
	cumulative, err := addChecked(holding.CostPaise, amount)
	if err != nil {
		return nil, err
	}
	if investor.PerInvoiceCapPaise > 0 && cumulative > investor.PerInvoiceCapPaise {
		return nil, newErr("ERR_CAP_EXCEEDED", fmt.Sprintf("cumulative investment %d paise would exceed your per-invoice cap of %d paise", cumulative, investor.PerInvoiceCapPaise),
			D{"invoiceId": invoiceID, "investorId": investorID, "capPaise": investor.PerInvoiceCapPaise, "existingPaise": holding.CostPaise, "requestedPaise": amount})
	}
	now, err := c.now()
	if err != nil {
		return nil, err
	}
	holding.Units += n
	holding.CostPaise = cumulative
	holding.UpiRefs = append(holding.UpiRefs, upiRef)
	if err := c.put(holdingKey, holding); err != nil {
		return nil, err
	}
	if err := c.stub.PutState(keyHoldingByInvestor(investorID, invoiceID), []byte(invoiceID)); err != nil {
		return nil, err
	}
	payment := &PaymentRecord{UpiRef: upiRef, InvoiceID: invoiceID, Kind: "FUNDING", FromID: investorID, ToID: "PLATFORM_ESCROW", AmountPaise: amount, Timestamp: now, TxID: c.stub.GetTxID()}
	if err := c.put(keyPayment(upiRef), payment); err != nil {
		return nil, err
	}
	if err := c.stub.PutState(keyPaymentByInvoice(invoiceID, upiRef), []byte(upiRef)); err != nil {
		return nil, err
	}
	inv.UnitsSold += n
	if inv.UnitsSold == inv.TotalUnits {
		if err := c.transition(inv, "FULLY_FUNDED", "Invest"); err != nil {
			return nil, err
		}
		inv.FundedAt = now
	} else if err := c.transition(inv, "PARTIALLY_FUNDED", "Invest"); err != nil {
		return nil, err
	}
	if err := c.saveInvoice(inv); err != nil {
		return nil, err
	}
	c.stub.AddEvent(SubEvent{Type: "INVESTMENT_MADE", Payload: D{"invoiceId": invoiceID, "investorId": investorID, "units": n, "amountPaise": amount, "upiRef": upiRef,
		"unitsSold": inv.UnitsSold, "totalUnits": inv.TotalUnits}})
	if err := c.audit("Invest", caller, invoiceID); err != nil {
		return nil, err
	}
	return &InvestResult{Invoice: inv, Holding: holding, Payment: payment, Replayed: false}, nil
}

func (c *core) ReleaseToSupplier(invoiceID, upiRef string) (*ReleaseResult, error) {
	caller, err := c.requireRole("OPERATOR")
	if err != nil {
		return nil, err
	}
	if _, err := c.requireActive(caller); err != nil {
		return nil, err
	}
	if err := requireNonEmpty(upiRef, "upiRef"); err != nil {
		return nil, err
	}
	inv, err := c.invoice(invoiceID)
	if err != nil {
		return nil, err
	}
	if used, err := c.exists(keyPayment(upiRef)); err != nil {
		return nil, err
	} else if used {
		return nil, newErr("ERR_INVALID_ARGUMENT", fmt.Sprintf("upiRef %s already used", upiRef), D{"upiRef": upiRef})
	}
	if inv.Status != "PARTIALLY_FUNDED" && inv.Status != "FULLY_FUNDED" {
		return nil, newErr("ERR_INVALID_TRANSITION", fmt.Sprintf("invoice is %s; release requires PARTIALLY_FUNDED or FULLY_FUNDED", inv.Status),
			D{"invoiceId": invoiceID, "from": inv.Status, "to": "SUPPLIER_PAID"})
	}
	if inv.UnitsSold < inv.MinFundingUnits {
		return nil, newErr("ERR_BELOW_MIN_FUNDING", fmt.Sprintf("only %d of minimum %d units funded", inv.UnitsSold, inv.MinFundingUnits),
			D{"invoiceId": invoiceID, "unitsSold": inv.UnitsSold, "minFundingUnits": inv.MinFundingUnits})
	}
	holdings, err := listJSON[Holding](c, "HOLD~"+invoiceID+"~")
	if err != nil {
		return nil, err
	}
	var payout int64
	for _, h := range holdings {
		if payout, err = addChecked(payout, h.CostPaise); err != nil {
			return nil, err
		}
	}
	now, err := c.now()
	if err != nil {
		return nil, err
	}
	if err := c.transition(inv, "SUPPLIER_PAID", "ReleaseToSupplier"); err != nil {
		return nil, err
	}
	inv.SupplierPaidAt = now
	if err := c.saveInvoice(inv); err != nil {
		return nil, err
	}
	payment := &PaymentRecord{UpiRef: upiRef, InvoiceID: invoiceID, Kind: "SUPPLIER_PAYOUT", FromID: "PLATFORM_ESCROW", ToID: inv.SupplierID, AmountPaise: payout, Timestamp: now, TxID: c.stub.GetTxID()}
	if err := c.put(keyPayment(upiRef), payment); err != nil {
		return nil, err
	}
	if err := c.stub.PutState(keyPaymentByInvoice(invoiceID, upiRef), []byte(upiRef)); err != nil {
		return nil, err
	}
	c.stub.AddEvent(SubEvent{Type: "SUPPLIER_PAID", Payload: D{"invoiceId": invoiceID, "supplierId": inv.SupplierID, "amountPaise": payout, "upiRef": upiRef, "unitsSold": inv.UnitsSold}})
	if err := c.audit("ReleaseToSupplier", caller, invoiceID); err != nil {
		return nil, err
	}
	return &ReleaseResult{Invoice: inv, Payment: payment}, nil
}

// sortedHoldings returns the invoice's holdings sorted by holderId ascending.
func (c *core) sortedHoldings(invoiceID string) ([]*Holding, error) {
	list, err := listJSON[Holding](c, "HOLD~"+invoiceID+"~")
	if err != nil {
		return nil, err
	}
	holdings := make([]*Holding, 0, len(list))
	for i := range list {
		if list[i].UpiRefs == nil {
			list[i].UpiRefs = []string{}
		}
		holdings = append(holdings, &list[i])
	}
	sort.SliceStable(holdings, func(i, j int) bool { return holdings[i].HolderID < holdings[j].HolderID })
	return holdings, nil
}

func (c *core) RecordRepayment(invoiceID, upiRef, amountPaise string) (*RepaymentResult, error) {
	caller, err := c.requireRole("OPERATOR")
	if err != nil {
		return nil, err
	}
	if _, err := c.requireActive(caller); err != nil {
		return nil, err
	}
	cfg, err := c.config()
	if err != nil {
		return nil, err
	}
	if err := requireNonEmpty(upiRef, "upiRef"); err != nil {
		return nil, err
	}
	amount, err := parseInt64(amountPaise, "amountPaise", intOpts{min: ptr(1)})
	if err != nil {
		return nil, err
	}
	inv, err := c.invoice(invoiceID)
	if err != nil {
		return nil, err
	}
	if used, err := c.exists(keyPayment(upiRef)); err != nil {
		return nil, err
	} else if used {
		return nil, newErr("ERR_INVALID_ARGUMENT", fmt.Sprintf("upiRef %s already used", upiRef), D{"upiRef": upiRef})
	}
	if inv.Status != "SUPPLIER_PAID" && inv.Status != "LATE" {
		return nil, newErr("ERR_INVALID_TRANSITION", fmt.Sprintf("invoice is %s; repayment requires SUPPLIER_PAID or LATE", inv.Status),
			D{"invoiceId": invoiceID, "from": inv.Status, "to": "SETTLED"})
	}
	if amount != inv.FaceValuePaise {
		return nil, newErr("ERR_AMOUNT_MISMATCH", fmt.Sprintf("repayment %d paise must equal face value %d paise", amount, inv.FaceValuePaise),
			D{"invoiceId": invoiceID, "expected": inv.FaceValuePaise, "actual": amount})
	}
	holdings, err := c.sortedHoldings(invoiceID)
	if err != nil {
		return nil, err
	}
	wfHolders := make([]WaterfallHolder, 0, len(holdings))
	for _, h := range holdings {
		wfHolders = append(wfHolders, WaterfallHolder{HolderID: h.HolderID, Units: h.Units})
	}
	wf, err := ComputeWaterfall(amount, inv.UnitsSold, inv.TotalUnits, wfHolders)
	if err != nil {
		return nil, err
	}
	now, err := c.now()
	if err != nil {
		return nil, err
	}
	repayment := &PaymentRecord{UpiRef: upiRef, InvoiceID: invoiceID, Kind: "BUYER_REPAYMENT", FromID: inv.BuyerID, ToID: "PLATFORM_ESCROW", AmountPaise: amount, Timestamp: now, TxID: c.stub.GetTxID()}
	if err := c.put(keyPayment(upiRef), repayment); err != nil {
		return nil, err
	}
	if err := c.stub.PutState(keyPaymentByInvoice(invoiceID, upiRef), []byte(upiRef)); err != nil {
		return nil, err
	}
	distributions := make([]*PaymentRecord, 0, len(wf.Shares))
	for i, s := range wf.Shares {
		if i >= len(holdings) || holdings[i].HolderID != s.HolderID {
			return nil, newErr("ERR_INVALID_ARGUMENT", "waterfall holder order mismatch")
		}
		h := holdings[i]
		h.ReceivedPaise = s.SharePaise
		if err := c.put(keyHolding(invoiceID, h.HolderID), h); err != nil {
			return nil, err
		}
		ref := upiRef + "-D" + strconv.Itoa(i)
		d := &PaymentRecord{UpiRef: ref, InvoiceID: invoiceID, Kind: "INVESTOR_DISTRIBUTION", FromID: "PLATFORM_ESCROW", ToID: h.HolderID, AmountPaise: s.SharePaise, Timestamp: now, TxID: c.stub.GetTxID()}
		if err := c.put(keyPayment(ref), d); err != nil {
			return nil, err
		}
		if err := c.stub.PutState(keyPaymentByInvoice(invoiceID, ref), []byte(ref)); err != nil {
			return nil, err
		}
		distributions = append(distributions, d)
		c.stub.AddEvent(SubEvent{Type: "DISTRIBUTION_PAID", Payload: D{"invoiceId": invoiceID, "holderId": h.HolderID, "units": h.Units, "costPaise": h.CostPaise, "amountPaise": s.SharePaise, "upiRef": ref}})
	}
	var residual *PaymentRecord
	if wf.ResidualPaise > 0 {
		ref := upiRef + "-R"
		residual = &PaymentRecord{UpiRef: ref, InvoiceID: invoiceID, Kind: "SUPPLIER_RESIDUAL", FromID: "PLATFORM_ESCROW", ToID: inv.SupplierID, AmountPaise: wf.ResidualPaise, Timestamp: now, TxID: c.stub.GetTxID()}
		if err := c.put(keyPayment(ref), residual); err != nil {
			return nil, err
		}
		if err := c.stub.PutState(keyPaymentByInvoice(invoiceID, ref), []byte(ref)); err != nil {
			return nil, err
		}
	}
	var total int64
	for _, d := range distributions {
		total += d.AmountPaise
	}
	if residual != nil {
		total += residual.AmountPaise
	}
	if total != amount {
		return nil, newErr("ERR_INVALID_ARGUMENT", fmt.Sprintf("waterfall invariant violated %d != %d", total, amount))
	}
	// buyer score
	lateDate, err := AddDays(inv.DueDate, cfg.GraceDays)
	if err != nil {
		return nil, err
	}
	lateThreshold, err := ToEpochSeconds(lateDate)
	if err != nil {
		return nil, err
	}
	nowSec, err := ToEpochSeconds(now)
	if err != nil {
		return nil, err
	}
	onTime := nowSec <= lateThreshold
	score, err := c.scoreFor(inv.BuyerID)
	if err != nil {
		return nil, err
	}
	reason := "SETTLED_LATE"
	if onTime {
		score.SettledOnTime++
		reason = "SETTLED_ON_TIME"
	} else {
		score.SettledLate++
	}
	buyerScore, err := c.saveScore(score, reason)
	if err != nil {
		return nil, err
	}
	if err := c.transition(inv, "SETTLED", "RecordRepayment"); err != nil {
		return nil, err
	}
	inv.SettledAt = now
	if err := c.saveInvoice(inv); err != nil {
		return nil, err
	}
	c.stub.AddEvent(SubEvent{Type: "REPAYMENT_RECORDED", Payload: D{"invoiceId": invoiceID, "buyerId": inv.BuyerID, "amountPaise": amount, "upiRef": upiRef, "onTime": onTime,
		"investorPoolPaise": wf.InvestorPoolPaise, "residualPaise": wf.ResidualPaise, "holders": len(distributions)}})
	if err := c.audit("RecordRepayment", caller, invoiceID); err != nil {
		return nil, err
	}
	return &RepaymentResult{Invoice: inv, Repayment: repayment, Distributions: distributions, Residual: residual, BuyerScore: buyerScore, OnTime: onTime}, nil
}

func (c *core) MarkLate(invoiceID string) (*Invoice, error) {
	caller, err := c.requireRole("OPERATOR")
	if err != nil {
		return nil, err
	}
	if _, err := c.requireActive(caller); err != nil {
		return nil, err
	}
	cfg, err := c.config()
	if err != nil {
		return nil, err
	}
	inv, err := c.invoice(invoiceID)
	if err != nil {
		return nil, err
	}
	if inv.Status != "SUPPLIER_PAID" {
		return nil, newErr("ERR_INVALID_TRANSITION", fmt.Sprintf("invoice is %s; MarkLate requires SUPPLIER_PAID", inv.Status), D{"invoiceId": invoiceID, "from": inv.Status, "to": "LATE"})
	}
	now, err := c.now()
	if err != nil {
		return nil, err
	}
	threshold, err := AddDays(inv.DueDate, cfg.GraceDays)
	if err != nil {
		return nil, err
	}
	nowSec, _ := ToEpochSeconds(now)
	thrSec, _ := ToEpochSeconds(threshold)
	if nowSec <= thrSec {
		return nil, newErr("ERR_NOT_YET_LATE", fmt.Sprintf("grace period ends %s; simulated now is %s", threshold, now),
			D{"invoiceId": invoiceID, "dueDate": inv.DueDate, "graceDays": cfg.GraceDays, "now": now})
	}
	if err := c.transition(inv, "LATE", "MarkLate"); err != nil {
		return nil, err
	}
	if err := c.saveInvoice(inv); err != nil {
		return nil, err
	}
	c.stub.AddEvent(SubEvent{Type: "INVOICE_LATE", Payload: D{"invoiceId": invoiceID, "buyerId": inv.BuyerID, "dueDate": inv.DueDate}})
	if err := c.audit("MarkLate", caller, invoiceID); err != nil {
		return nil, err
	}
	return inv, nil
}

func (c *core) MarkDefault(invoiceID string) (*DefaultResult, error) {
	caller, err := c.requireRole("OPERATOR")
	if err != nil {
		return nil, err
	}
	if _, err := c.requireActive(caller); err != nil {
		return nil, err
	}
	cfg, err := c.config()
	if err != nil {
		return nil, err
	}
	inv, err := c.invoice(invoiceID)
	if err != nil {
		return nil, err
	}
	if inv.Status != "SUPPLIER_PAID" && inv.Status != "LATE" {
		return nil, newErr("ERR_INVALID_TRANSITION", fmt.Sprintf("invoice is %s; MarkDefault requires SUPPLIER_PAID or LATE", inv.Status), D{"invoiceId": invoiceID, "from": inv.Status, "to": "DEFAULTED"})
	}
	now, err := c.now()
	if err != nil {
		return nil, err
	}
	threshold, err := AddDays(inv.DueDate, cfg.DefaultDays)
	if err != nil {
		return nil, err
	}
	nowSec, _ := ToEpochSeconds(now)
	thrSec, _ := ToEpochSeconds(threshold)
	if nowSec <= thrSec {
		return nil, newErr("ERR_NOT_YET_DEFAULT", fmt.Sprintf("default window opens after %s; simulated now is %s", threshold, now),
			D{"invoiceId": invoiceID, "dueDate": inv.DueDate, "defaultDays": cfg.DefaultDays, "now": now})
	}
	holdings, err := c.sortedHoldings(invoiceID)
	if err != nil {
		return nil, err
	}
	var totalLoss int64
	for _, h := range holdings {
		loss := h.CostPaise - h.ReceivedPaise
		h.LossPaise = &loss
		totalLoss += loss
		if err := c.put(keyHolding(invoiceID, h.HolderID), h); err != nil {
			return nil, err
		}
	}
	score, err := c.scoreFor(inv.BuyerID)
	if err != nil {
		return nil, err
	}
	score.Defaulted++
	buyerScore, err := c.saveScore(score, "DEFAULTED")
	if err != nil {
		return nil, err
	}
	if err := c.transition(inv, "DEFAULTED", "MarkDefault"); err != nil {
		return nil, err
	}
	if err := c.saveInvoice(inv); err != nil {
		return nil, err
	}
	c.stub.AddEvent(SubEvent{Type: "INVOICE_DEFAULTED", Payload: D{"invoiceId": invoiceID, "buyerId": inv.BuyerID, "lossPaise": totalLoss, "holders": len(holdings)}})
	if err := c.audit("MarkDefault", caller, invoiceID); err != nil {
		return nil, err
	}
	return &DefaultResult{Invoice: inv, BuyerScore: buyerScore, Holdings: holdings}, nil
}

// ───────────────────────── anomalies & demo ─────────────────────────

func (c *core) RecordAnomaly(kind, actorID, invoiceRef, errorCode, detail string) (*AnomalyRecord, error) {
	caller, err := c.requireRole("OPERATOR")
	if err != nil {
		return nil, err
	}
	if _, err := c.requireActive(caller); err != nil {
		return nil, err
	}
	if !contains(AnomalyKinds, kind) {
		return nil, newErr("ERR_INVALID_ARGUMENT", "kind must be one of "+strings.Join(AnomalyKinds, "|"), D{"field": "kind"})
	}
	if err := requireNonEmpty(errorCode, "errorCode"); err != nil {
		return nil, err
	}
	now, err := c.now()
	if err != nil {
		return nil, err
	}
	anomalyID := sha256Hex(kind + "|" + invoiceRef + "|" + c.stub.GetTxID())
	rec := &AnomalyRecord{AnomalyID: anomalyID, Kind: kind, ActorID: actorID, InvoiceRef: invoiceRef, ErrorCode: errorCode, Detail: detail, RecordedAt: now, TxID: c.stub.GetTxID()}
	if err := c.put(keyAnomaly(anomalyID), rec); err != nil {
		return nil, err
	}
	payload := D{}
	recBytes, _ := json.Marshal(rec)
	_ = json.Unmarshal(recBytes, &payload)
	c.stub.AddEvent(SubEvent{Type: "ANOMALY_RECORDED", Payload: payload})
	if err := c.audit("RecordAnomaly", caller, invoiceRef); err != nil {
		return nil, err
	}
	return rec, nil
}

func (c *core) AdvanceDemoClock(seconds string) (*Clock, error) {
	caller, err := c.requireRole("OPERATOR")
	if err != nil {
		return nil, err
	}
	if _, err := c.requireActive(caller); err != nil {
		return nil, err
	}
	cfg, err := c.requireDemoMode()
	if err != nil {
		return nil, err
	}
	s, err := parseInt64(seconds, "seconds", intOpts{})
	if err != nil {
		return nil, err
	}
	current, err := c.clockOffset()
	if err != nil {
		return nil, err
	}
	next, err := addChecked(current, s)
	if err != nil {
		return nil, err
	}
	if err := c.stub.PutState(keyClock, []byte(strconv.FormatInt(next, 10))); err != nil {
		return nil, err
	}
	now, err := c.now()
	if err != nil {
		return nil, err
	}
	c.stub.AddEvent(SubEvent{Type: "CLOCK_ADVANCED", Payload: D{"seconds": s, "offsetSeconds": next, "now": now}})
	if err := c.audit("AdvanceDemoClock", caller, ""); err != nil {
		return nil, err
	}
	return &Clock{Now: now, OffsetSeconds: next, DemoMode: cfg.DemoMode}, nil
}

func (c *core) SeedBuyerHistory(buyerID, onTime, late, defaulted string) (*BuyerScore, error) {
	caller, err := c.requireRole("OPERATOR")
	if err != nil {
		return nil, err
	}
	if _, err := c.requireActive(caller); err != nil {
		return nil, err
	}
	if _, err := c.requireDemoMode(); err != nil {
		return nil, err
	}
	b, err := c.participant(buyerID)
	if err != nil {
		return nil, err
	}
	if b.Role != "BUYER" {
		return nil, newErr("ERR_INVALID_ARGUMENT", buyerID+" is not a BUYER", D{"buyerId": buyerID})
	}
	on, err := parseInt64(onTime, "onTime", intOpts{min: ptr(0)})
	if err != nil {
		return nil, err
	}
	lt, err := parseInt64(late, "late", intOpts{min: ptr(0)})
	if err != nil {
		return nil, err
	}
	df, err := parseInt64(defaulted, "defaulted", intOpts{min: ptr(0)})
	if err != nil {
		return nil, err
	}
	score := &BuyerScore{BuyerID: buyerID, SettledOnTime: on, SettledLate: lt, Defaulted: df, Score: 50, LastUpdated: ""}
	saved, err := c.saveScore(score, "SEEDED")
	if err != nil {
		return nil, err
	}
	c.stub.AddEvent(SubEvent{Type: "BUYER_HISTORY_SEEDED", Payload: D{"buyerId": buyerID, "onTime": saved.SettledOnTime, "late": saved.SettledLate, "defaulted": saved.Defaulted, "score": saved.Score}})
	if err := c.audit("SeedBuyerHistory", caller, ""); err != nil {
		return nil, err
	}
	return saved, nil
}
