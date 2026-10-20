package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// Every (from, to) pair NOT in the transition table must be rejected with ERR_INVALID_TRANSITION;
// every legal pair must succeed and emit INVOICE_STATUS_CHANGED when the status actually changes.
func TestTransitionTable(t *testing.T) {
	for _, from := range InvoiceStatuses {
		for _, to := range InvoiceStatuses {
			tx := newMemLedger().newTx("tx", "2026-03-01T10:00:00Z", Caller{}, 1)
			c := newCore(tx)
			inv := &Invoice{InvoiceID: "abc", Status: from}
			err := c.transition(inv, to, "test")
			legal := contains(InvoiceTransitions[from], to)
			if legal {
				if err != nil {
					t.Errorf("%s -> %s should be legal, got %v", from, to, err)
					continue
				}
				if inv.Status != to || inv.UpdatedAt != "2026-03-01T10:00:00Z" {
					t.Errorf("%s -> %s: invoice not updated: %+v", from, to, inv)
				}
				wantEvents := 1
				if from == to {
					wantEvents = 0
				}
				if len(tx.events) != wantEvents {
					t.Errorf("%s -> %s: expected %d status events, got %d", from, to, wantEvents, len(tx.events))
				}
				continue
			}
			le := AsLedgerError(err)
			if le == nil || le.Code != "ERR_INVALID_TRANSITION" {
				t.Errorf("%s -> %s should be ERR_INVALID_TRANSITION, got %v", from, to, err)
			}
			if inv.Status != from || len(tx.events) != 0 || len(tx.writes) != 0 {
				t.Errorf("%s -> %s: illegal transition mutated state", from, to)
			}
		}
	}
}

// contractapi reflects over the exported methods at construction time; this catches signature mistakes.
func TestContractApiMetadata(t *testing.T) {
	cc, err := contractapi.NewChaincode(&BillBridgeContract{})
	if err != nil {
		t.Fatalf("contractapi.NewChaincode: %v", err)
	}
	if cc == nil {
		t.Fatal("nil chaincode")
	}
}

func TestLedgerErrorIsParseableJSON(t *testing.T) {
	err := newErr("ERR_CAP_EXCEEDED", "cap <exceeded>", D{"capPaise": int64(5)})
	raw := "chaincode response 500, " + err.Error()
	start := strings.Index(raw, "{")
	var parsed struct {
		Code    string         `json:"code"`
		Message string         `json:"message"`
		Details map[string]any `json:"details"`
	}
	if e := json.Unmarshal([]byte(raw[start:]), &parsed); e != nil {
		t.Fatalf("not JSON: %v", e)
	}
	if parsed.Code != "ERR_CAP_EXCEEDED" || parsed.Message != "cap <exceeded>" || parsed.Details["capPaise"] != float64(5) {
		t.Fatalf("parsed %+v", parsed)
	}
	empty := newErr("ERR_NOT_FOUND", "x")
	if !strings.Contains(empty.Error(), `"details":{}`) {
		t.Fatalf("details must default to {}: %s", empty.Error())
	}
}

// JSON shapes the gateway / Zod schemas rely on: items:[] never null, nextBookmark null, upiRefs:[] never null.
func TestWireShapes(t *testing.T) {
	l := newMemLedger()
	op := Caller{MspID: "Org1MSP", Role: "OPERATOR", ParticipantID: "operator1"}
	if _, _, err := l.submit(op, "InitLedger", []string{""}, "2026-03-01T09:59:59Z"); err != nil {
		t.Fatal(err)
	}
	res, err := l.evaluate(op, "ListInvoicesByStatus", []string{"LISTED", "10", ""}, "2026-03-01T10:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(res)
	if string(b) != `{"items":[],"nextBookmark":null}` {
		t.Fatalf("page shape: %s", b)
	}
	res, err = l.evaluate(op, "GetHoldingsByInvoice", []string{"nope"}, "2026-03-01T10:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	if b, _ = json.Marshal(res); string(b) != `[]` {
		t.Fatalf("empty list shape: %s", b)
	}
	h := Holding{InvoiceID: "i", HolderID: "h", UpiRefs: []string{}}
	if b, _ = json.Marshal(h); !strings.Contains(string(b), `"upiRefs":[]`) || strings.Contains(string(b), "lossPaise") {
		t.Fatalf("holding shape: %s", b)
	}
	if _, err := l.evaluate(op, "Nope", nil, "2026-03-01T10:00:00Z"); AsLedgerError(err) == nil || AsLedgerError(err).Code != "ERR_INVALID_ARGUMENT" {
		t.Fatalf("unknown function: %v", err)
	}
	// InitLedger is idempotent: a second call returns the stored config and emits nothing.
	res, env, err := l.submit(op, "InitLedger", []string{`{"demoMode":false}`}, "2026-03-01T10:00:01Z")
	if err != nil || res.(*LedgerConfig).DemoMode != true || len(env.Events) != 0 {
		t.Fatalf("InitLedger idempotency: %v %+v %+v", err, res, env)
	}
}
