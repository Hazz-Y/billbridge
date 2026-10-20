package main

import (
	"encoding/json"
	"fmt"
	"sort"
)

// ───────────────────────── queries ─────────────────────────

func (c *core) GetInvoice(invoiceID string) (*Invoice, error) {
	if _, err := c.anyRole(); err != nil {
		return nil, err
	}
	return c.invoice(invoiceID)
}

func (c *core) GetInvoicePrivateDetails(invoiceID string) (*InvoicePrivateDetails, error) {
	caller, err := c.anyRole()
	if err != nil {
		return nil, err
	}
	inv, err := c.invoice(invoiceID)
	if err != nil {
		return nil, err
	}
	if !privateCollectionMSPs[caller.MspID] {
		return nil, newErr("ERR_UNAUTHORIZED_ROLE", fmt.Sprintf("org %s is not a member of %s", caller.MspID, CollectionInvoiceDetails), D{"mspId": caller.MspID, "collection": CollectionInvoiceDetails})
	}
	allowed := caller.Role == "OPERATOR" || caller.ParticipantID == inv.SupplierID || caller.ParticipantID == inv.BuyerID
	if !allowed {
		return nil, newErr("ERR_UNAUTHORIZED_ROLE", fmt.Sprintf("participant %s is neither supplier, buyer nor operator for this invoice", caller.ParticipantID), D{"invoiceId": invoiceID, "participantId": caller.ParticipantID})
	}
	raw, err := c.stub.GetPrivateData(CollectionInvoiceDetails, keyInvoice(invoiceID))
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return nil, newErr("ERR_NOT_FOUND", fmt.Sprintf("private details for %s not found", invoiceID), D{"invoiceId": invoiceID})
	}
	var pd InvoicePrivateDetails
	if err := json.Unmarshal(raw, &pd); err != nil {
		return nil, err
	}
	if pd.LineItems == nil {
		pd.LineItems = []LineItem{}
	}
	return &pd, nil
}

func (c *core) pageSize(s string) (int64, error) {
	return parseInt64(s, "pageSize", intOpts{min: ptr(1), max: ptr(1000)})
}

func (c *core) invoicePageFromIndex(prefix, pageSize, bookmark string) (*Page[*Invoice], error) {
	if _, err := c.anyRole(); err != nil {
		return nil, err
	}
	size, err := c.pageSize(pageSize)
	if err != nil {
		return nil, err
	}
	kvs, err := c.stub.GetStateByPrefix(prefix)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(kvs))
	for _, kv := range kvs {
		ids = append(ids, string(kv.Value))
	}
	page := paginate(ids, size, bookmark, func(id string) string { return id })
	items := make([]*Invoice, 0, len(page.Items))
	for _, id := range page.Items {
		inv, err := c.invoice(id)
		if err != nil {
			return nil, err
		}
		items = append(items, inv)
	}
	return &Page[*Invoice]{Items: items, NextBookmark: page.NextBookmark}, nil
}

func (c *core) ListInvoicesByStatus(status, pageSize, bookmark string) (*Page[*Invoice], error) {
	if !contains(InvoiceStatuses, status) {
		return nil, newErr("ERR_INVALID_ARGUMENT", "unknown status "+status, D{"field": "status"})
	}
	return c.invoicePageFromIndex("STATUS~"+status+"~", pageSize, bookmark)
}

func (c *core) ListInvoicesBySupplier(supplierID, pageSize, bookmark string) (*Page[*Invoice], error) {
	return c.invoicePageFromIndex("SUP~"+supplierID+"~", pageSize, bookmark)
}

func (c *core) ListInvoicesByBuyer(buyerID, pageSize, bookmark string) (*Page[*Invoice], error) {
	return c.invoicePageFromIndex("BUY~"+buyerID+"~", pageSize, bookmark)
}

func (c *core) ListAllInvoices(pageSize, bookmark string) (*Page[Invoice], error) {
	if _, err := c.anyRole(); err != nil {
		return nil, err
	}
	size, err := c.pageSize(pageSize)
	if err != nil {
		return nil, err
	}
	all, err := listJSON[Invoice](c, "INV~")
	if err != nil {
		return nil, err
	}
	p := paginate(all, size, bookmark, func(i Invoice) string { return i.InvoiceID })
	return &p, nil
}

func normalizeHoldings(list []Holding) []Holding {
	for i := range list {
		if list[i].UpiRefs == nil {
			list[i].UpiRefs = []string{}
		}
	}
	return list
}

func (c *core) GetHoldingsByInvoice(invoiceID string) ([]Holding, error) {
	if _, err := c.anyRole(); err != nil {
		return nil, err
	}
	list, err := listJSON[Holding](c, "HOLD~"+invoiceID+"~")
	if err != nil {
		return nil, err
	}
	return normalizeHoldings(list), nil
}

func (c *core) GetHoldingsByInvestor(investorID string) ([]Holding, error) {
	if _, err := c.anyRole(); err != nil {
		return nil, err
	}
	kvs, err := c.stub.GetStateByPrefix("HOLDINV~" + investorID + "~")
	if err != nil {
		return nil, err
	}
	out := make([]Holding, 0, len(kvs))
	for _, kv := range kvs {
		h, err := getJSON[Holding](c, keyHolding(string(kv.Value), investorID))
		if err != nil {
			return nil, err
		}
		if h != nil {
			out = append(out, *h)
		}
	}
	return normalizeHoldings(out), nil
}

func (c *core) GetInvoiceHistory(invoiceID string) ([]HistoryEntry, error) {
	if _, err := c.anyRole(); err != nil {
		return nil, err
	}
	if _, err := c.invoice(invoiceID); err != nil {
		return nil, err
	}
	items, err := c.stub.GetHistoryForKey(keyInvoice(invoiceID))
	if err != nil {
		return nil, err
	}
	out := make([]HistoryEntry, 0, len(items))
	for _, h := range items {
		e := HistoryEntry{TxID: h.TxID, Timestamp: h.Timestamp, IsDelete: h.IsDelete, BlockNumber: h.BlockNumber, Fn: h.Fn, ActorID: h.ActorID}
		if len(h.Value) > 0 {
			var inv Invoice
			if err := json.Unmarshal(h.Value, &inv); err != nil {
				return nil, err
			}
			e.Value = &inv
		}
		out = append(out, e)
	}
	return out, nil
}

func (c *core) GetBuyerScore(buyerID string) (*BuyerScore, error) {
	if _, err := c.anyRole(); err != nil {
		return nil, err
	}
	s, err := c.scoreFor(buyerID)
	if err != nil {
		return nil, err
	}
	if s.LastUpdated == "" {
		now, err := c.now()
		if err != nil {
			return nil, err
		}
		s.LastUpdated = now
	}
	return s, nil
}

func (c *core) GetParticipant(participantID string) (*Participant, error) {
	if _, err := c.anyRole(); err != nil {
		return nil, err
	}
	return c.participant(participantID)
}

func (c *core) ListParticipants(pageSize, bookmark string) (*Page[Participant], error) {
	if _, err := c.anyRole(); err != nil {
		return nil, err
	}
	size, err := c.pageSize(pageSize)
	if err != nil {
		return nil, err
	}
	all, err := listJSON[Participant](c, "PART~")
	if err != nil {
		return nil, err
	}
	p := paginate(all, size, bookmark, func(p Participant) string { return p.ID })
	return &p, nil
}

func (c *core) GetPlatformStats() (*PlatformStats, error) {
	if _, err := c.anyRole(); err != nil {
		return nil, err
	}
	invoices, err := listJSON[Invoice](c, "INV~")
	if err != nil {
		return nil, err
	}
	holdings, err := listJSON[Holding](c, "HOLD~")
	if err != nil {
		return nil, err
	}
	active := map[string]bool{"LISTED": true, "PARTIALLY_FUNDED": true, "FULLY_FUNDED": true, "SUPPLIER_PAID": true, "LATE": true}
	stats := &PlatformStats{TotalInvoices: int64(len(invoices)), BlockHeight: c.stub.GetBlockNumber()}
	var listedCount, yieldSum, settled, defaulted int64
	for _, i := range invoices {
		if active[i.Status] {
			stats.ActiveInvoices++
		}
		if i.AnnualizedYieldBps > 0 {
			listedCount++
			yieldSum += i.AnnualizedYieldBps
		}
		if i.Status == "SETTLED" {
			settled++
		}
		if i.Status == "DEFAULTED" {
			defaulted++
		}
		if i.Status != "CANCELLED" {
			stats.TotalFaceValuePaise += i.FaceValuePaise
		}
	}
	investors := map[string]bool{}
	for _, h := range holdings {
		stats.TotalFundedPaise += h.CostPaise
		investors[h.HolderID] = true
	}
	stats.SettledInvoices = settled
	stats.ActiveInvestors = int64(len(investors))
	if listedCount > 0 {
		stats.AvgYieldBps = yieldSum / listedCount
	}
	if settled+defaulted > 0 {
		rate, err := MulDivFloor(defaulted, 10000, settled+defaulted)
		if err != nil {
			return nil, err
		}
		stats.DefaultRateBps = rate
	}
	return stats, nil
}

func (c *core) GetAnomalies(pageSize, bookmark string) (*Page[AnomalyRecord], error) {
	if _, err := c.anyRole(); err != nil {
		return nil, err
	}
	size, err := c.pageSize(pageSize)
	if err != nil {
		return nil, err
	}
	all, err := listJSON[AnomalyRecord](c, "ANOM~")
	if err != nil {
		return nil, err
	}
	sort.SliceStable(all, func(i, j int) bool {
		if all[i].RecordedAt != all[j].RecordedAt {
			return all[i].RecordedAt > all[j].RecordedAt
		}
		return all[i].AnomalyID < all[j].AnomalyID
	})
	p := paginate(all, size, bookmark, func(a AnomalyRecord) string { return a.AnomalyID })
	return &p, nil
}

func (c *core) GetAuditTrail(startTime, endTime, pageSize, bookmark string) (*Page[AuditEntry], error) {
	if _, err := c.anyRole(); err != nil {
		return nil, err
	}
	size, err := c.pageSize(pageSize)
	if err != nil {
		return nil, err
	}
	all, err := listJSON[AuditEntry](c, "AUDIT~")
	if err != nil {
		return nil, err
	}
	filtered := make([]AuditEntry, 0, len(all))
	for _, e := range all {
		if (startTime == "" || e.Timestamp >= startTime) && (endTime == "" || e.Timestamp <= endTime) {
			filtered = append(filtered, e)
		}
	}
	p := paginate(filtered, size, bookmark, func(e AuditEntry) string { return e.Timestamp + "~" + e.TxID })
	return &p, nil
}

func (c *core) GetPaymentsByInvoice(invoiceID string) ([]PaymentRecord, error) {
	if _, err := c.anyRole(); err != nil {
		return nil, err
	}
	kvs, err := c.stub.GetStateByPrefix("PAYINV~" + invoiceID + "~")
	if err != nil {
		return nil, err
	}
	out := make([]PaymentRecord, 0, len(kvs))
	for _, kv := range kvs {
		p, err := getJSON[PaymentRecord](c, keyPayment(string(kv.Value)))
		if err != nil {
			return nil, err
		}
		if p != nil {
			out = append(out, *p)
		}
	}
	return out, nil
}

func (c *core) ListPayments(pageSize, bookmark string) (*Page[PaymentRecord], error) {
	if _, err := c.anyRole(); err != nil {
		return nil, err
	}
	size, err := c.pageSize(pageSize)
	if err != nil {
		return nil, err
	}
	all, err := listJSON[PaymentRecord](c, "PAY~")
	if err != nil {
		return nil, err
	}
	p := paginate(all, size, bookmark, func(p PaymentRecord) string { return p.UpiRef })
	return &p, nil
}

func (c *core) GetClock() (*Clock, error) {
	if _, err := c.anyRole(); err != nil {
		return nil, err
	}
	now, err := c.now()
	if err != nil {
		return nil, err
	}
	offset, err := c.clockOffset()
	if err != nil {
		return nil, err
	}
	cfg, err := c.config()
	if err != nil {
		return nil, err
	}
	return &Clock{Now: now, OffsetSeconds: offset, DemoMode: cfg.DemoMode}, nil
}

func (c *core) GetConfig() (*LedgerConfig, error) {
	if _, err := c.anyRole(); err != nil {
		return nil, err
	}
	cfg, err := c.config()
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}
