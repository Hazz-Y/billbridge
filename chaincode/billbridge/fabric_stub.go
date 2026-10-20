package main

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/hyperledger/fabric-chaincode-go/v2/pkg/cid"
	"github.com/hyperledger/fabric-chaincode-go/v2/shim"
)

// fabricStub adapts shim.ChaincodeStubInterface to the Stub interface used by the core.
//
// Fabric reads (GetState / GetStateByRange) always see COMMITTED state, never the current
// transaction's own writes. The TS reference (and MockLedger) do read-your-writes within a tx
// (e.g. AdvanceDemoClock writes CLOCK_OFFSET_SECONDS and then calls now()). To keep the two
// implementations equivalent, this adapter overlays the pending write-set on every read.
type fabricStub struct {
	shim       shim.ChaincodeStubInterface
	writes     map[string][]byte // nil value = delete
	privWrites map[string]map[string][]byte
	events     []SubEvent
}

func newFabricStub(s shim.ChaincodeStubInterface) *fabricStub {
	return &fabricStub{shim: s, writes: map[string][]byte{}, privWrites: map[string]map[string][]byte{}, events: []SubEvent{}}
}

func (f *fabricStub) GetTxID() string { return f.shim.GetTxID() }

// GetTxTimestamp formats the proposal timestamp as RFC3339 UTC without fractional seconds.
// It comes from the client proposal, so it is identical on every endorsing peer.
func (f *fabricStub) GetTxTimestamp() (string, error) {
	ts, err := f.shim.GetTxTimestamp()
	if err != nil {
		return "", err
	}
	return time.Unix(ts.GetSeconds(), 0).UTC().Format(isoTimestampLayout), nil
}

// GetCaller reads the MSP and the `role` / `participantId` X.509 attributes issued by fabric-ca.
func (f *fabricStub) GetCaller() (Caller, error) {
	msp, err := cid.GetMSPID(f.shim)
	if err != nil {
		return Caller{}, err
	}
	role, _, err := cid.GetAttributeValue(f.shim, "role")
	if err != nil {
		return Caller{}, err
	}
	pid, _, err := cid.GetAttributeValue(f.shim, "participantId")
	if err != nil {
		return Caller{}, err
	}
	return Caller{MspID: msp, Role: role, ParticipantID: pid}, nil
}

func (f *fabricStub) GetState(key string) ([]byte, error) {
	if v, ok := f.writes[key]; ok {
		return v, nil
	}
	return f.shim.GetState(key)
}

func (f *fabricStub) PutState(key string, value []byte) error {
	f.writes[key] = value
	return f.shim.PutState(key, value)
}

func (f *fabricStub) DelState(key string) error {
	f.writes[key] = nil
	return f.shim.DelState(key)
}

// GetStateByPrefix uses a plain range query [prefix, prefix+U+FFFF) — works on LevelDB (no CouchDB needed)
// — merged with this transaction's pending writes and sorted ascending by key.
func (f *fabricStub) GetStateByPrefix(prefix string) ([]KV, error) {
	merged := map[string][]byte{}
	it, err := f.shim.GetStateByRange(prefix, prefix+"￿")
	if err != nil {
		return nil, err
	}
	defer it.Close()
	for it.HasNext() {
		kv, err := it.Next()
		if err != nil {
			return nil, err
		}
		merged[kv.GetKey()] = kv.GetValue()
	}
	for k, v := range f.writes {
		if !strings.HasPrefix(k, prefix) {
			continue
		}
		if v == nil {
			delete(merged, k)
		} else {
			merged[k] = v
		}
	}
	out := make([]KV, 0, len(merged))
	for _, k := range sortedKeys(merged) {
		out = append(out, KV{Key: k, Value: merged[k]})
	}
	return out, nil
}

func (f *fabricStub) GetPrivateData(collection, key string) ([]byte, error) {
	if col, ok := f.privWrites[collection]; ok {
		if v, ok := col[key]; ok {
			return v, nil
		}
	}
	return f.shim.GetPrivateData(collection, key)
}

func (f *fabricStub) PutPrivateData(collection, key string, value []byte) error {
	if f.privWrites[collection] == nil {
		f.privWrites[collection] = map[string][]byte{}
	}
	f.privWrites[collection][key] = value
	return f.shim.PutPrivateData(collection, key, value)
}

// GetHistoryForKey maps Fabric's key history. Fabric does not record the invoking function or
// actor per modification, so Fn / ActorID are empty on a real network (the MockLedger fills them).
func (f *fabricStub) GetHistoryForKey(key string) ([]HistoryItem, error) {
	it, err := f.shim.GetHistoryForKey(key)
	if err != nil {
		return nil, err
	}
	defer it.Close()
	out := []HistoryItem{}
	for it.HasNext() {
		m, err := it.Next()
		if err != nil {
			return nil, err
		}
		ts := ""
		if m.GetTimestamp() != nil {
			ts = time.Unix(m.GetTimestamp().GetSeconds(), 0).UTC().Format(isoTimestampLayout)
		}
		var val []byte
		if !m.GetIsDelete() {
			val = m.GetValue()
		}
		out = append(out, HistoryItem{TxID: m.GetTxId(), Timestamp: ts, IsDelete: m.GetIsDelete(), Value: val})
	}
	return out, nil
}

func (f *fabricStub) AddEvent(ev SubEvent) { f.events = append(f.events, ev) }

// GetBlockNumber: the block number is not known inside chaincode (assigned by the orderer later).
func (f *fabricStub) GetBlockNumber() uint64 { return 0 }

// emitEnvelope sets the ONE chaincode event for this transaction (Fabric keeps only the last SetEvent).
func (f *fabricStub) emitEnvelope(fn string) error {
	caller, err := f.GetCaller()
	if err != nil {
		return err
	}
	now, err := newCore(f).now()
	if err != nil {
		return err
	}
	env := EnvelopeEvent{Fn: fn, TxID: f.GetTxID(), BlockNumber: 0, Timestamp: now, ActorID: caller.ParticipantID, ActorRole: caller.Role, Events: f.events}
	for _, e := range f.events {
		if id, ok := e.Payload["invoiceId"].(string); ok {
			env.InvoiceID = id
			break
		}
	}
	b, err := json.Marshal(env)
	if err != nil {
		return err
	}
	return f.shim.SetEvent("billbridge", b)
}
