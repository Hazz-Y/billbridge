package main

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// core is the stub-agnostic contract logic: a line-by-line port of the BillBridgeContract class in
// shared/src/ledger/contract.ts.
//
// Validation order in every mutating function:
//
//	(1) caller MSP + role + identity binding  (2) caller participant exists, KYC approved, not frozen
//	(3) argument validation  (4) state mutation  (5) sub-events  (6) structured JSON result
type core struct {
	stub Stub
}

func newCore(stub Stub) *core { return &core{stub: stub} }

// ───────────────────────── argument parsing ─────────────────────────

var intRe = regexp.MustCompile(`^-?\d+$`)

type intOpts struct {
	min, max *int64
}

func ptr(n int64) *int64 { return &n }

// parseInt64 mirrors parseInt64() in contract.ts (regex, safe-integer range, optional min/max).
func parseInt64(s, label string, opts intOpts) (int64, error) {
	trimmed := strings.TrimSpace(s)
	if !intRe.MatchString(trimmed) {
		return 0, newErr("ERR_INVALID_ARGUMENT", fmt.Sprintf("%s must be an integer, got %q", label, s), D{"field": label})
	}
	n, err := strconv.ParseInt(trimmed, 10, 64)
	if err != nil || !isSafeInteger(n) {
		return 0, newErr("ERR_INVALID_ARGUMENT", label+" out of range", D{"field": label})
	}
	if opts.min != nil && n < *opts.min {
		return 0, newErr("ERR_INVALID_ARGUMENT", fmt.Sprintf("%s must be >= %d", label, *opts.min), D{"field": label, "value": n})
	}
	if opts.max != nil && n > *opts.max {
		return 0, newErr("ERR_INVALID_ARGUMENT", fmt.Sprintf("%s must be <= %d", label, *opts.max), D{"field": label, "value": n})
	}
	return n, nil
}

func requireNonEmpty(s, label string) error {
	if strings.TrimSpace(s) == "" {
		return newErr("ERR_INVALID_ARGUMENT", label+" is required", D{"field": label})
	}
	return nil
}

func parseJSONArg(s string, v any, label string) error {
	if err := json.Unmarshal([]byte(s), v); err != nil {
		return newErr("ERR_INVALID_ARGUMENT", label+" must be valid JSON", D{"field": label})
	}
	return nil
}

// ───────────────────────── state helpers ─────────────────────────

func (c *core) config() (LedgerConfig, error) {
	raw, err := c.stub.GetState(keyConfig)
	if err != nil {
		return LedgerConfig{}, err
	}
	if len(raw) == 0 {
		return LedgerConfig{}, newErr("ERR_INVALID_ARGUMENT", "ledger not initialised (call InitLedger)")
	}
	var cfg LedgerConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return LedgerConfig{}, err
	}
	return cfg, nil
}

func (c *core) clockOffset() (int64, error) {
	raw, err := c.stub.GetState(keyClock)
	if err != nil {
		return 0, err
	}
	if len(raw) == 0 {
		return 0, nil
	}
	return strconv.ParseInt(strings.TrimSpace(string(raw)), 10, 64)
}

// now = tx timestamp + demo clock offset (deterministic across endorsers).
func (c *core) now() (string, error) {
	offset, err := c.clockOffset()
	if err != nil {
		return "", err
	}
	ts, err := c.stub.GetTxTimestamp()
	if err != nil {
		return "", err
	}
	sec, err := ToEpochSeconds(ts)
	if err != nil {
		return "", err
	}
	return EpochToIso(sec + offset), nil
}

// getJSON returns nil when the key does not exist.
func getJSON[T any](c *core, key string) (*T, error) {
	raw, err := c.stub.GetState(key)
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return nil, nil
	}
	var v T
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	return &v, nil
}

func (c *core) put(key string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return c.stub.PutState(key, b)
}

func (c *core) exists(key string) (bool, error) {
	raw, err := c.stub.GetState(key)
	return len(raw) > 0, err
}

func (c *core) getString(key string) (string, error) {
	raw, err := c.stub.GetState(key)
	return string(raw), err
}

// listJSON decodes every value under prefix (sorted ascending by key).
func listJSON[T any](c *core, prefix string) ([]T, error) {
	kvs, err := c.stub.GetStateByPrefix(prefix)
	if err != nil {
		return nil, err
	}
	out := make([]T, 0, len(kvs))
	for _, kv := range kvs {
		var v T
		if err := json.Unmarshal(kv.Value, &v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

func paginate[T any](items []T, pageSize int64, bookmark string, keyOf func(T) string) Page[T] {
	start := int64(0)
	if bookmark != "" {
		idx := int64(-1)
		for i, it := range items {
			if keyOf(it) == bookmark {
				idx = int64(i)
				break
			}
		}
		start = idx + 1
	}
	n := int64(len(items))
	end := start + pageSize
	if end > n {
		end = n
	}
	slice := make([]T, 0)
	if start < n {
		slice = append(slice, items[start:end]...)
	}
	var next *string
	if start+pageSize < n && len(slice) > 0 {
		k := keyOf(slice[len(slice)-1])
		next = &k
	}
	return Page[T]{Items: slice, NextBookmark: next}
}

// ───────────────────────── authorisation ─────────────────────────

func (c *core) requireRole(allowed ...string) (Caller, error) {
	caller, err := c.stub.GetCaller()
	if err != nil {
		return Caller{}, err
	}
	if !contains(Roles, caller.Role) {
		return Caller{}, newErr("ERR_UNAUTHORIZED_ROLE", fmt.Sprintf("unknown role attribute %q", caller.Role))
	}
	if RoleMSP[caller.Role] != caller.MspID {
		return Caller{}, newErr("ERR_UNAUTHORIZED_ROLE",
			fmt.Sprintf("role %s must be enrolled under %s, caller is %s", caller.Role, RoleMSP[caller.Role], caller.MspID),
			D{"role": caller.Role, "mspId": caller.MspID})
	}
	if !contains(allowed, caller.Role) {
		return Caller{}, newErr("ERR_UNAUTHORIZED_ROLE",
			fmt.Sprintf("function requires role %s, caller is %s", strings.Join(allowed, "|"), caller.Role),
			D{"required": allowed, "actual": caller.Role})
	}
	return caller, nil
}

func (c *core) anyRole() (Caller, error) { return c.requireRole(Roles...) }

// bind enforces identity binding: the caller can never act as another participant.
func (c *core) bind(caller Caller, participantIDArg, label string) error {
	if caller.ParticipantID != participantIDArg {
		return newErr("ERR_IDENTITY_MISMATCH",
			fmt.Sprintf("caller %s cannot act as %s %s", caller.ParticipantID, label, participantIDArg),
			D{"caller": caller.ParticipantID, label: participantIDArg})
	}
	return nil
}

func (c *core) participant(id string) (*Participant, error) {
	p, err := getJSON[Participant](c, keyParticipant(id))
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, newErr("ERR_PARTICIPANT_NOT_FOUND", fmt.Sprintf("participant %s not found", id), D{"participantId": id})
	}
	return p, nil
}

// requireActive: KYC approved + not frozen. Operators/regulators: frozen check only.
func (c *core) requireActive(caller Caller) (*Participant, error) {
	p, err := c.participant(caller.ParticipantID)
	if err != nil {
		return nil, err
	}
	if p.Role != caller.Role {
		return nil, newErr("ERR_UNAUTHORIZED_ROLE", fmt.Sprintf("participant %s is registered as %s, certificate says %s", p.ID, p.Role, caller.Role))
	}
	if p.Frozen {
		return nil, newErr("ERR_PARTICIPANT_FROZEN", strings.TrimSpace(fmt.Sprintf("participant %s is frozen: %s", p.ID, p.FrozenReason)),
			D{"participantId": p.ID, "reason": p.FrozenReason})
	}
	if p.Role != "OPERATOR" && p.Role != "REGULATOR" && p.KycStatus != "APPROVED" {
		return nil, newErr("ERR_KYC_NOT_APPROVED", fmt.Sprintf("participant %s KYC status is %s; must be APPROVED", p.ID, p.KycStatus),
			D{"participantId": p.ID, "kycStatus": p.KycStatus})
	}
	return p, nil
}

func (c *core) invoice(id string) (*Invoice, error) {
	inv, err := getJSON[Invoice](c, keyInvoice(id))
	if err != nil {
		return nil, err
	}
	if inv == nil {
		return nil, newErr("ERR_NOT_FOUND", fmt.Sprintf("invoice %s not found", id), D{"invoiceId": id})
	}
	return inv, nil
}

func (c *core) transition(inv *Invoice, to, fn string) error {
	if !contains(InvoiceTransitions[inv.Status], to) {
		return newErr("ERR_INVALID_TRANSITION", fmt.Sprintf("%s: invoice is %s; cannot move to %s", fn, inv.Status, to),
			D{"invoiceId": inv.InvoiceID, "from": inv.Status, "to": to})
	}
	if inv.Status != to {
		if err := c.stub.DelState(keyStatus(inv.Status, inv.InvoiceID)); err != nil {
			return err
		}
		if err := c.stub.PutState(keyStatus(to, inv.InvoiceID), []byte(inv.InvoiceID)); err != nil {
			return err
		}
		c.stub.AddEvent(SubEvent{Type: "INVOICE_STATUS_CHANGED", Payload: D{"invoiceId": inv.InvoiceID, "from": inv.Status, "to": to}})
	}
	now, err := c.now()
	if err != nil {
		return err
	}
	inv.Status = to
	inv.UpdatedAt = now
	return nil
}

func (c *core) saveInvoice(inv *Invoice) error { return c.put(keyInvoice(inv.InvoiceID), inv) }

func (c *core) audit(fn string, caller Caller, invoiceID string) error {
	now, err := c.now()
	if err != nil {
		return err
	}
	entry := AuditEntry{TxID: c.stub.GetTxID(), BlockNumber: c.stub.GetBlockNumber(), Timestamp: now, Fn: fn,
		ActorID: caller.ParticipantID, ActorRole: caller.Role, InvoiceID: invoiceID}
	return c.put(keyAudit(entry.Timestamp, entry.TxID), entry)
}

func (c *core) scoreFor(buyerID string) (*BuyerScore, error) {
	s, err := getJSON[BuyerScore](c, keyScore(buyerID))
	if err != nil {
		return nil, err
	}
	if s == nil {
		s = &BuyerScore{BuyerID: buyerID, Score: 50, LastUpdated: ""}
	}
	return s, nil
}

func (c *core) saveScore(s *BuyerScore, reason string) (*BuyerScore, error) {
	score, err := ComputeBuyerScore(s.SettledOnTime, s.SettledLate, s.Defaulted)
	if err != nil {
		return nil, err
	}
	s.Score = score
	now, err := c.now()
	if err != nil {
		return nil, err
	}
	s.LastUpdated = now
	if err := c.put(keyScore(s.BuyerID), s); err != nil {
		return nil, err
	}
	c.stub.AddEvent(SubEvent{Type: "SCORE_UPDATED", Payload: D{"buyerId": s.BuyerID, "score": s.Score, "settledOnTime": s.SettledOnTime,
		"settledLate": s.SettledLate, "defaulted": s.Defaulted, "reason": reason}})
	return s, nil
}

func (c *core) requireDemoMode() (LedgerConfig, error) {
	cfg, err := c.config()
	if err != nil {
		return cfg, err
	}
	if !cfg.DemoMode {
		return cfg, newErr("ERR_DEMO_MODE_DISABLED", "demo functions are disabled (chaincode init param demoMode=false)")
	}
	return cfg, nil
}

// ───────────────────────── init ─────────────────────────

// InitLedger(configJSON) is idempotent; creates the bootstrap operator participant.
func (c *core) InitLedger(configJSON string) (*LedgerConfig, error) {
	existing, err := getJSON[LedgerConfig](c, keyConfig)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}
	cfg := DefaultLedgerConfig()
	if strings.TrimSpace(configJSON) != "" {
		if err := parseJSONArg(configJSON, &cfg, "config"); err != nil {
			return nil, err
		}
	}
	if cfg.UnitFaceValuePaise <= 0 {
		return nil, newErr("ERR_INVALID_ARGUMENT", "unitFaceValuePaise must be > 0")
	}
	if err := c.put(keyConfig, cfg); err != nil {
		return nil, err
	}
	if err := c.stub.PutState(keyClock, []byte("0")); err != nil {
		return nil, err
	}
	now, err := c.now()
	if err != nil {
		return nil, err
	}
	op := Participant{ID: cfg.BootstrapOperatorID, Role: "OPERATOR", OrgMsp: "Org1MSP", KycStatus: "APPROVED", KycDocHash: "",
		PerInvoiceCapPaise: 0, Frozen: false, CreatedAt: now, UpdatedAt: now}
	if err := c.put(keyParticipant(op.ID), op); err != nil {
		return nil, err
	}
	c.stub.AddEvent(SubEvent{Type: "PARTICIPANT_REGISTERED", Payload: D{"participantId": op.ID, "role": op.Role, "bootstrap": true}})
	return &cfg, nil
}

// ───────────────────────── participants ─────────────────────────

func (c *core) RegisterParticipant(id, role, orgMsp, perInvoiceCapPaise string) (*Participant, error) {
	caller, err := c.requireRole("OPERATOR")
	if err != nil {
		return nil, err
	}
	if _, err := c.requireActive(caller); err != nil {
		return nil, err
	}
	if err := requireNonEmpty(id, "id"); err != nil {
		return nil, err
	}
	if !contains(Roles, role) {
		return nil, newErr("ERR_INVALID_ARGUMENT", "role must be one of "+strings.Join(Roles, "|"), D{"field": "role", "value": role})
	}
	if RoleMSP[role] != orgMsp {
		return nil, newErr("ERR_INVALID_ARGUMENT", fmt.Sprintf("role %s must belong to %s, got %s", role, RoleMSP[role], orgMsp), D{"field": "orgMsp"})
	}
	cap, err := parseInt64(perInvoiceCapPaise, "perInvoiceCapPaise", intOpts{min: ptr(0)})
	if err != nil {
		return nil, err
	}
	if ok, err := c.exists(keyParticipant(id)); err != nil {
		return nil, err
	} else if ok {
		return nil, newErr("ERR_DUPLICATE_PARTICIPANT", fmt.Sprintf("participant %s already registered", id), D{"participantId": id})
	}
	now, err := c.now()
	if err != nil {
		return nil, err
	}
	p := &Participant{ID: id, Role: role, OrgMsp: orgMsp, KycStatus: "PENDING", KycDocHash: "", PerInvoiceCapPaise: cap, Frozen: false, CreatedAt: now, UpdatedAt: now}
	if err := c.put(keyParticipant(id), p); err != nil {
		return nil, err
	}
	c.stub.AddEvent(SubEvent{Type: "PARTICIPANT_REGISTERED", Payload: D{"participantId": id, "role": role, "orgMsp": orgMsp, "perInvoiceCapPaise": cap}})
	if err := c.audit("RegisterParticipant", caller, ""); err != nil {
		return nil, err
	}
	return p, nil
}

func (c *core) SetKycStatus(participantID, status, kycDocHash string) (*Participant, error) {
	caller, err := c.requireRole("OPERATOR")
	if err != nil {
		return nil, err
	}
	if _, err := c.requireActive(caller); err != nil {
		return nil, err
	}
	if !contains(KycStatuses, status) {
		return nil, newErr("ERR_INVALID_ARGUMENT", "status must be one of "+strings.Join(KycStatuses, "|"), D{"field": "status"})
	}
	p, err := c.participant(participantID)
	if err != nil {
		return nil, err
	}
	from := p.KycStatus
	p.KycStatus = status
	if kycDocHash != "" {
		p.KycDocHash = kycDocHash
	}
	now, err := c.now()
	if err != nil {
		return nil, err
	}
	p.UpdatedAt = now
	if err := c.put(keyParticipant(participantID), p); err != nil {
		return nil, err
	}
	c.stub.AddEvent(SubEvent{Type: "KYC_UPDATED", Payload: D{"participantId": participantID, "from": from, "to": status, "kycDocHash": p.KycDocHash}})
	if err := c.audit("SetKycStatus", caller, ""); err != nil {
		return nil, err
	}
	return p, nil
}

func (c *core) FreezeParticipant(participantID, reason string) (*Participant, error) {
	caller, err := c.requireRole("OPERATOR")
	if err != nil {
		return nil, err
	}
	if _, err := c.requireActive(caller); err != nil {
		return nil, err
	}
	p, err := c.participant(participantID)
	if err != nil {
		return nil, err
	}
	p.Frozen = true
	if reason != "" {
		p.FrozenReason = reason
	} else {
		p.FrozenReason = "frozen by operator"
	}
	now, err := c.now()
	if err != nil {
		return nil, err
	}
	p.UpdatedAt = now
	if err := c.put(keyParticipant(participantID), p); err != nil {
		return nil, err
	}
	c.stub.AddEvent(SubEvent{Type: "PARTICIPANT_FROZEN", Payload: D{"participantId": participantID, "reason": p.FrozenReason}})
	if err := c.audit("FreezeParticipant", caller, ""); err != nil {
		return nil, err
	}
	return p, nil
}

func (c *core) UnfreezeParticipant(participantID string) (*Participant, error) {
	caller, err := c.requireRole("OPERATOR")
	if err != nil {
		return nil, err
	}
	if _, err := c.requireActive(caller); err != nil {
		return nil, err
	}
	p, err := c.participant(participantID)
	if err != nil {
		return nil, err
	}
	p.Frozen = false
	p.FrozenReason = ""
	now, err := c.now()
	if err != nil {
		return nil, err
	}
	p.UpdatedAt = now
	if err := c.put(keyParticipant(participantID), p); err != nil {
		return nil, err
	}
	c.stub.AddEvent(SubEvent{Type: "PARTICIPANT_UNFROZEN", Payload: D{"participantId": participantID}})
	if err := c.audit("UnfreezeParticipant", caller, ""); err != nil {
		return nil, err
	}
	return p, nil
}
