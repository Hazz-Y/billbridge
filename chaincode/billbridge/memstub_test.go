package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// memLedger is the in-memory test double of a Fabric peer, mirroring MockLedger in
// shared/src/ledger/mock-ledger.ts: one block per submitted tx, deterministic txIds
// sha256(counter|fn|jsonArgs), per-key history for INV~ keys, a private data collection,
// a single envelope event per tx and all-or-nothing writes.
type memLedger struct {
	state       map[string][]byte
	priv        map[string]map[string][]byte
	history     map[string][]HistoryItem
	blockHeight uint64
	txCounter   int
	events      []EnvelopeEvent
}

func newMemLedger() *memLedger {
	return &memLedger{state: map[string][]byte{}, priv: map[string]map[string][]byte{}, history: map[string][]HistoryItem{}}
}

// memTx is the per-transaction Stub: reads overlay the pending write-set; writes are buffered
// and committed by memLedger.submit only when the function succeeds.
type memTx struct {
	l          *memLedger
	txID, ts   string
	caller     Caller
	block      uint64
	writes     map[string][]byte // nil = delete
	order      []string          // insertion order of first write per key (Map semantics)
	privWrites map[string]map[string][]byte
	events     []SubEvent
}

func (l *memLedger) newTx(txID, ts string, caller Caller, block uint64) *memTx {
	return &memTx{l: l, txID: txID, ts: ts, caller: caller, block: block, writes: map[string][]byte{}, privWrites: map[string]map[string][]byte{}, events: []SubEvent{}}
}

func (t *memTx) GetTxID() string                 { return t.txID }
func (t *memTx) GetTxTimestamp() (string, error) { return t.ts, nil }
func (t *memTx) GetCaller() (Caller, error)      { return t.caller, nil }
func (t *memTx) GetBlockNumber() uint64          { return t.block }
func (t *memTx) AddEvent(ev SubEvent)            { t.events = append(t.events, ev) }
func (t *memTx) GetState(key string) ([]byte, error) {
	if v, ok := t.writes[key]; ok {
		return v, nil
	}
	return t.l.state[key], nil
}
func (t *memTx) write(key string, v []byte) {
	if _, ok := t.writes[key]; !ok {
		t.order = append(t.order, key)
	}
	t.writes[key] = v
}
func (t *memTx) PutState(key string, value []byte) error { t.write(key, value); return nil }
func (t *memTx) DelState(key string) error               { t.write(key, nil); return nil }
func (t *memTx) GetStateByPrefix(prefix string) ([]KV, error) {
	merged := map[string][]byte{}
	for k, v := range t.l.state {
		if strings.HasPrefix(k, prefix) {
			merged[k] = v
		}
	}
	for k, v := range t.writes {
		if !strings.HasPrefix(k, prefix) {
			continue
		}
		if v == nil {
			delete(merged, k)
		} else {
			merged[k] = v
		}
	}
	keys := sortedKeys(merged)
	out := make([]KV, 0, len(keys))
	for _, k := range keys {
		out = append(out, KV{Key: k, Value: merged[k]})
	}
	return out, nil
}
func (t *memTx) GetPrivateData(collection, key string) ([]byte, error) {
	if col, ok := t.privWrites[collection]; ok {
		if v, ok := col[key]; ok {
			return v, nil
		}
	}
	return t.l.priv[collection][key], nil
}
func (t *memTx) PutPrivateData(collection, key string, value []byte) error {
	if t.privWrites[collection] == nil {
		t.privWrites[collection] = map[string][]byte{}
	}
	t.privWrites[collection][key] = value
	return nil
}
func (t *memTx) GetHistoryForKey(key string) ([]HistoryItem, error) {
	src := t.l.history[key]
	out := make([]HistoryItem, len(src))
	copy(out, src)
	return out, nil
}

// submit runs a mutating function and commits its writes atomically on success.
func (l *memLedger) submit(caller Caller, fn string, args []string, ts string) (any, *EnvelopeEvent, error) {
	if !IsMutating(fn) {
		return nil, nil, newErr("ERR_INVALID_ARGUMENT", fn+" is not a submit (mutating) function", D{"fn": fn})
	}
	counter := l.txCounter + 1
	argsJSON, _ := json.Marshal(args)
	txID := sha256Hex(fmt.Sprintf("%d|%s|%s", counter, fn, argsJSON))
	block := l.blockHeight + 1
	tx := l.newTx(txID, ts, caller, block)
	res, err := Invoke(tx, fn, args)
	if err != nil {
		return nil, nil, err
	}
	effectiveTs, err := newCore(tx).now()
	if err != nil {
		return nil, nil, err
	}
	for _, k := range tx.order {
		v := tx.writes[k]
		if v == nil {
			delete(l.state, k)
		} else {
			l.state[k] = v
		}
		if strings.HasPrefix(k, "INV~") {
			l.history[k] = append(l.history[k], HistoryItem{TxID: txID, Timestamp: effectiveTs, IsDelete: v == nil, Value: v, BlockNumber: block, Fn: fn, ActorID: caller.ParticipantID})
		}
	}
	for col, m := range tx.privWrites {
		if l.priv[col] == nil {
			l.priv[col] = map[string][]byte{}
		}
		for k, v := range m {
			l.priv[col][k] = v
		}
	}
	l.txCounter = counter
	l.blockHeight = block
	env := EnvelopeEvent{Fn: fn, TxID: txID, BlockNumber: block, Timestamp: effectiveTs, ActorID: caller.ParticipantID, ActorRole: caller.Role, Events: tx.events}
	for _, e := range tx.events {
		if id, ok := e.Payload["invoiceId"].(string); ok {
			env.InvoiceID = id
			break
		}
	}
	l.events = append(l.events, env)
	return res, &env, nil
}

// evaluate runs a query function without committing anything.
func (l *memLedger) evaluate(caller Caller, fn string, args []string, ts string) (any, error) {
	if IsMutating(fn) {
		return nil, newErr("ERR_INVALID_ARGUMENT", fn+" is a submit function; use submit()", D{"fn": fn})
	}
	return Invoke(l.newTx("evaluate", ts, caller, l.blockHeight), fn, args)
}

// stateKeys returns all committed keys (sorted) — handy for debugging failing vectors.
func (l *memLedger) stateKeys() []string {
	keys := sortedKeys(l.state)
	sort.Strings(keys)
	return keys
}
