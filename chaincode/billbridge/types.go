// Package main implements the BillBridge chaincode: tokenized MSME invoice financing.
//
// This is a FAITHFUL PORT of shared/src/ledger/contract.ts (the TypeScript reference that
// backs the MockLedger). Same function names, argument order (all string args), validation
// order, error codes, JSON shapes and sub-events. Conformance is proven by executing the
// shared/test-vectors/*.json files against both implementations.
package main

import (
	"encoding/json"
	"sort"
)

// ───────────────────────── enums (shared/src/enums.ts) ─────────────────────────

var Roles = []string{"MSME", "INVESTOR", "BUYER", "OPERATOR", "REGULATOR"}

var KycStatuses = []string{"PENDING", "APPROVED", "REJECTED", "SUSPENDED"}

var InvoiceStatuses = []string{
	"DRAFT", "BUYER_ACCEPTED", "LISTED", "PARTIALLY_FUNDED", "FULLY_FUNDED",
	"SUPPLIER_PAID", "SETTLED", "LATE", "DEFAULTED", "CANCELLED",
}

var AnomalyKinds = []string{
	"DUPLICATE_INVOICE_ID", "DUPLICATE_CONTENT", "DUPLICATE_FILE", "KYC_VIOLATION",
	"CAP_VIOLATION", "FROZEN_ACTOR_ATTEMPT", "IDENTITY_MISMATCH", "DEFAULT", "OTHER",
}

// RoleMSP maps role -> Fabric MSP (spec 5.5).
var RoleMSP = map[string]string{
	"OPERATOR": "Org1MSP", "MSME": "Org1MSP", "INVESTOR": "Org1MSP", "BUYER": "Org2MSP", "REGULATOR": "Org3MSP",
}

// InvoiceTransitions lists the legal transitions (spec 4.5). Anything else -> ERR_INVALID_TRANSITION.
var InvoiceTransitions = map[string][]string{
	"DRAFT":            {"BUYER_ACCEPTED", "CANCELLED"},
	"BUYER_ACCEPTED":   {"LISTED"},
	"LISTED":           {"PARTIALLY_FUNDED", "FULLY_FUNDED", "CANCELLED"},
	"PARTIALLY_FUNDED": {"PARTIALLY_FUNDED", "FULLY_FUNDED", "SUPPLIER_PAID"},
	"FULLY_FUNDED":     {"SUPPLIER_PAID"},
	"SUPPLIER_PAID":    {"SETTLED", "LATE", "DEFAULTED"},
	"LATE":             {"SETTLED", "DEFAULTED"},
	"SETTLED":          {},
	"DEFAULTED":        {},
	"CANCELLED":        {},
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// ───────────────────────── domain (shared/src/domain.ts) ─────────────────────────
// json tags MUST match the Zod field names exactly.

type Participant struct {
	ID                 string `json:"id"`
	Role               string `json:"role"`
	OrgMsp             string `json:"orgMsp"`
	KycStatus          string `json:"kycStatus"`
	KycDocHash         string `json:"kycDocHash"`
	PerInvoiceCapPaise int64  `json:"perInvoiceCapPaise"`
	Frozen             bool   `json:"frozen"`
	FrozenReason       string `json:"frozenReason,omitempty"`
	CreatedAt          string `json:"createdAt"`
	UpdatedAt          string `json:"updatedAt"`
}

type Invoice struct {
	InvoiceID          string `json:"invoiceId"`
	ContentHash        string `json:"contentHash"`
	SupplierID         string `json:"supplierId"`
	BuyerID            string `json:"buyerId"`
	FaceValuePaise     int64  `json:"faceValuePaise"`
	IssueDate          string `json:"issueDate"`
	DueDate            string `json:"dueDate"`
	UnitFaceValuePaise int64  `json:"unitFaceValuePaise"`
	DiscountBps        int64  `json:"discountBps"`
	TenorDays          int64  `json:"tenorDays"`
	PricePerUnitPaise  int64  `json:"pricePerUnitPaise"`
	AnnualizedYieldBps int64  `json:"annualizedYieldBps"`
	TotalUnits         int64  `json:"totalUnits"`
	UnitsSold          int64  `json:"unitsSold"`
	MinFundingUnits    int64  `json:"minFundingUnits"`
	Status             string `json:"status"`
	ListedAt           string `json:"listedAt,omitempty"`
	FundedAt           string `json:"fundedAt,omitempty"`
	SupplierPaidAt     string `json:"supplierPaidAt,omitempty"`
	SettledAt          string `json:"settledAt,omitempty"`
	CancelReason       string `json:"cancelReason,omitempty"`
	CreatedAt          string `json:"createdAt"`
	UpdatedAt          string `json:"updatedAt"`
	CreatedTxID        string `json:"createdTxId,omitempty"`
}

type Holding struct {
	InvoiceID     string   `json:"invoiceId"`
	HolderID      string   `json:"holderId"`
	Units         int64    `json:"units"`
	CostPaise     int64    `json:"costPaise"`
	UpiRefs       []string `json:"upiRefs"`
	AcquiredAt    string   `json:"acquiredAt"`
	ReceivedPaise int64    `json:"receivedPaise"`
	LossPaise     *int64   `json:"lossPaise,omitempty"`
}

type PaymentRecord struct {
	UpiRef      string `json:"upiRef"`
	InvoiceID   string `json:"invoiceId"`
	Kind        string `json:"kind"`
	FromID      string `json:"fromId"`
	ToID        string `json:"toId"`
	AmountPaise int64  `json:"amountPaise"`
	Timestamp   string `json:"timestamp"`
	TxID        string `json:"txId,omitempty"`
}

type BuyerScore struct {
	BuyerID       string `json:"buyerId"`
	SettledOnTime int64  `json:"settledOnTime"`
	SettledLate   int64  `json:"settledLate"`
	Defaulted     int64  `json:"defaulted"`
	Score         int64  `json:"score"`
	LastUpdated   string `json:"lastUpdated"`
}

type AnomalyRecord struct {
	AnomalyID  string `json:"anomalyId"`
	Kind       string `json:"kind"`
	ActorID    string `json:"actorId"`
	InvoiceRef string `json:"invoiceRef,omitempty"`
	ErrorCode  string `json:"errorCode"`
	Detail     string `json:"detail"`
	RecordedAt string `json:"recordedAt"`
	TxID       string `json:"txId,omitempty"`
}

type LineItem struct {
	Description    string `json:"description"`
	Quantity       int64  `json:"quantity"`
	UnitPricePaise int64  `json:"unitPricePaise"`
	TotalPaise     int64  `json:"totalPaise"`
	HsnCode        string `json:"hsnCode,omitempty"`
}

type InvoicePrivateDetails struct {
	InvoiceID     string     `json:"invoiceId,omitempty"`
	SupplierGstin string     `json:"supplierGstin"`
	BuyerGstin    string     `json:"buyerGstin"`
	InvoiceNumber string     `json:"invoiceNumber"`
	LineItems     []LineItem `json:"lineItems"`
	FileHash      string     `json:"fileHash"`
	ExtractedJson string     `json:"extractedJson"`
}

type PlatformStats struct {
	TotalInvoices       int64  `json:"totalInvoices"`
	ActiveInvoices      int64  `json:"activeInvoices"`
	SettledInvoices     int64  `json:"settledInvoices"`
	TotalFundedPaise    int64  `json:"totalFundedPaise"`
	TotalFaceValuePaise int64  `json:"totalFaceValuePaise"`
	ActiveInvestors     int64  `json:"activeInvestors"`
	AvgYieldBps         int64  `json:"avgYieldBps"`
	DefaultRateBps      int64  `json:"defaultRateBps"`
	BlockHeight         uint64 `json:"blockHeight"`
}

type HistoryEntry struct {
	TxID        string   `json:"txId"`
	Timestamp   string   `json:"timestamp"`
	IsDelete    bool     `json:"isDelete"`
	BlockNumber uint64   `json:"blockNumber"`
	Fn          string   `json:"fn"`
	ActorID     string   `json:"actorId"`
	Value       *Invoice `json:"value"`
}

type AuditEntry struct {
	TxID        string `json:"txId"`
	BlockNumber uint64 `json:"blockNumber"`
	Timestamp   string `json:"timestamp"`
	Fn          string `json:"fn"`
	ActorID     string `json:"actorId"`
	ActorRole   string `json:"actorRole"`
	InvoiceID   string `json:"invoiceId,omitempty"`
}

type LedgerConfig struct {
	UnitFaceValuePaise  int64  `json:"unitFaceValuePaise"`
	GraceDays           int64  `json:"graceDays"`
	DefaultDays         int64  `json:"defaultDays"`
	DemoMode            bool   `json:"demoMode"`
	MinDiscountBps      int64  `json:"minDiscountBps"`
	MaxDiscountBps      int64  `json:"maxDiscountBps"`
	BootstrapOperatorID string `json:"bootstrapOperatorId"`
}

// DefaultLedgerConfig mirrors DEFAULT_LEDGER_CONFIG.
func DefaultLedgerConfig() LedgerConfig {
	return LedgerConfig{
		UnitFaceValuePaise: 100000, GraceDays: 7, DefaultDays: 90, DemoMode: true,
		MinDiscountBps: 100, MaxDiscountBps: 3000, BootstrapOperatorID: "operator1",
	}
}

// Page is a bookmark-paginated result. Items is never null; NextBookmark is null when no more pages.
type Page[T any] struct {
	Items        []T     `json:"items"`
	NextBookmark *string `json:"nextBookmark"`
}

// ───────────────────────── typed results (shared/src/ledger-api.ts) ─────────────────────────

type InvestResult struct {
	Invoice  *Invoice       `json:"invoice"`
	Holding  *Holding       `json:"holding"`
	Payment  *PaymentRecord `json:"payment"`
	Replayed bool           `json:"replayed"`
}

type ReleaseResult struct {
	Invoice *Invoice       `json:"invoice"`
	Payment *PaymentRecord `json:"payment"`
}

type RepaymentResult struct {
	Invoice       *Invoice         `json:"invoice"`
	Repayment     *PaymentRecord   `json:"repayment"`
	Distributions []*PaymentRecord `json:"distributions"`
	Residual      *PaymentRecord   `json:"residual"`
	BuyerScore    *BuyerScore      `json:"buyerScore"`
	OnTime        bool             `json:"onTime"`
}

type DefaultResult struct {
	Invoice    *Invoice    `json:"invoice"`
	BuyerScore *BuyerScore `json:"buyerScore"`
	Holdings   []*Holding  `json:"holdings"`
}

type Clock struct {
	Now           string `json:"now"`
	OffsetSeconds int64  `json:"offsetSeconds"`
	DemoMode      bool   `json:"demoMode"`
}

// ───────────────────────── events (shared/src/events.ts) ─────────────────────────

// SubEvent is one typed event inside the per-transaction envelope.
type SubEvent struct {
	Type    string         `json:"type"`
	Payload map[string]any `json:"payload"`
}

// EnvelopeEvent is the ONE Fabric event emitted per transaction (Fabric overwrites earlier SetEvent calls).
type EnvelopeEvent struct {
	Fn          string     `json:"fn"`
	TxID        string     `json:"txId"`
	BlockNumber uint64     `json:"blockNumber"`
	Timestamp   string     `json:"timestamp"`
	ActorID     string     `json:"actorId"`
	ActorRole   string     `json:"actorRole"`
	InvoiceID   string     `json:"invoiceId,omitempty"`
	Events      []SubEvent `json:"events"`
}

// ───────────────────────── errors (shared/src/errors.ts) ─────────────────────────

// D is a shorthand for error details.
type D = map[string]any

// LedgerError is the structured chaincode error. Error() returns the JSON payload
// {"code":...,"message":...,"details":{...}} so the gateway can parse it (parseLedgerError).
type LedgerError struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details"`
}

func (e *LedgerError) Error() string {
	b, err := json.Marshal(e)
	if err != nil {
		return `{"code":"` + e.Code + `","message":"` + e.Message + `","details":{}}`
	}
	return string(b)
}

// newErr builds a LedgerError; details default to {} (never null).
func newErr(code, message string, details ...D) *LedgerError {
	d := D{}
	if len(details) > 0 && details[0] != nil {
		d = details[0]
	}
	return &LedgerError{Code: code, Message: message, Details: d}
}

// AsLedgerError unwraps an error into a *LedgerError, or nil.
func AsLedgerError(err error) *LedgerError {
	if le, ok := err.(*LedgerError); ok {
		return le
	}
	return nil
}

// ───────────────────────── stub (shared/src/ledger/stub.ts) ─────────────────────────

// Caller is who is invoking the chaincode (X.509 cert attributes on Fabric; explicit in tests).
type Caller struct {
	MspID         string `json:"mspId"`
	Role          string `json:"role"`
	ParticipantID string `json:"participantId"`
}

// KV is a key/value pair returned by prefix queries.
type KV struct {
	Key   string
	Value []byte
}

// HistoryItem is one entry of a key's write history.
type HistoryItem struct {
	TxID        string
	Timestamp   string
	IsDelete    bool
	Value       []byte // nil on delete
	BlockNumber uint64
	Fn          string
	ActorID     string
}

// Stub is the minimal chaincode stub abstraction the contract core needs.
// fabric_stub.go adapts shim.ChaincodeStubInterface; memstub_test.go is the in-memory test double.
type Stub interface {
	GetTxID() string
	// GetTxTimestamp returns the tx timestamp as RFC3339 UTC (no fractional seconds).
	GetTxTimestamp() (string, error)
	GetCaller() (Caller, error)
	GetState(key string) ([]byte, error)
	PutState(key string, value []byte) error
	DelState(key string) error
	// GetStateByPrefix returns all keys with the given prefix, sorted ascending by key.
	GetStateByPrefix(prefix string) ([]KV, error)
	GetPrivateData(collection, key string) ([]byte, error)
	PutPrivateData(collection, key string, value []byte) error
	GetHistoryForKey(key string) ([]HistoryItem, error)
	AddEvent(ev SubEvent)
	GetBlockNumber() uint64
}

// ───────────────────────── keys ─────────────────────────

const (
	CollectionInvoiceDetails = "collectionInvoiceDetails"
	keyConfig                = "CONFIG"
	keyClock                 = "CLOCK_OFFSET_SECONDS"
)

var privateCollectionMSPs = map[string]bool{"Org1MSP": true, "Org2MSP": true}

func keyParticipant(id string) string                { return "PART~" + id }
func keyInvoice(id string) string                    { return "INV~" + id }
func keyContent(h string) string                     { return "CONTENT~" + h }
func keyFile(h string) string                        { return "FILE~" + h }
func keyStatus(s, id string) string                  { return "STATUS~" + s + "~" + id }
func keySupplier(s, id string) string                { return "SUP~" + s + "~" + id }
func keyBuyer(b, id string) string                   { return "BUY~" + b + "~" + id }
func keyHolding(inv, holder string) string           { return "HOLD~" + inv + "~" + holder }
func keyHoldingByInvestor(holder, inv string) string { return "HOLDINV~" + holder + "~" + inv }
func keyPayment(ref string) string                   { return "PAY~" + ref }
func keyPaymentByInvoice(inv, ref string) string     { return "PAYINV~" + inv + "~" + ref }
func keyScore(b string) string                       { return "SCORE~" + b }
func keyAnomaly(id string) string                    { return "ANOM~" + id }
func keyAudit(ts, tx string) string                  { return "AUDIT~" + ts + "~" + tx }

// MutatingFunctions / QueryFunctions mirror MUTATING_FUNCTIONS / QUERY_FUNCTIONS in contract.ts.
var MutatingFunctions = []string{
	"InitLedger", "RegisterParticipant", "SetKycStatus", "FreezeParticipant", "UnfreezeParticipant", "CreateInvoice", "BuyerAcceptInvoice",
	"ListInvoice", "CancelInvoice", "Invest", "ReleaseToSupplier", "RecordRepayment", "MarkLate", "MarkDefault", "RecordAnomaly",
	"AdvanceDemoClock", "SeedBuyerHistory",
}

var QueryFunctions = []string{
	"GetInvoice", "GetInvoicePrivateDetails", "ListInvoicesByStatus", "ListInvoicesBySupplier", "ListInvoicesByBuyer", "ListAllInvoices",
	"GetHoldingsByInvoice", "GetHoldingsByInvestor", "GetInvoiceHistory", "GetBuyerScore", "GetParticipant", "ListParticipants",
	"GetPlatformStats", "GetAnomalies", "GetAuditTrail", "GetPaymentsByInvoice", "ListPayments", "GetClock", "GetConfig",
}

// IsMutating reports whether fn is a submit (state-changing) function.
func IsMutating(fn string) bool { return contains(MutatingFunctions, fn) }

// sortedKeys returns the keys of a map in ascending order (deterministic iteration).
func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
