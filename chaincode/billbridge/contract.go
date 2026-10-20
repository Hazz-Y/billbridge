package main

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// ───────────────────────── dispatcher (Fabric calling convention: fn + string args) ─────────────────────────

// Invoke runs fn with string args against the given stub and returns the typed result.
// Any non-LedgerError (bugs, math overflow, stub failures, panics) is wrapped as ERR_INTERNAL,
// exactly like MockLedger does in shared/src/ledger/mock-ledger.ts.
func Invoke(stub Stub, fn string, args []string) (result any, err error) {
	defer func() {
		if r := recover(); r != nil {
			result, err = nil, newErr("ERR_INTERNAL", fmt.Sprintf("panic in %s: %v", fn, r), D{"fn": fn})
		}
	}()
	result, err = dispatch(newCore(stub), fn, args)
	if err != nil {
		if AsLedgerError(err) == nil {
			err = newErr("ERR_INTERNAL", err.Error(), D{"fn": fn})
		}
		return nil, err
	}
	return result, nil
}

func dispatch(c *core, fn string, args []string) (any, error) {
	a := func(i int) string {
		if i < len(args) {
			return args[i]
		}
		return ""
	}
	switch fn {
	case "InitLedger":
		return c.InitLedger(a(0))
	case "RegisterParticipant":
		return c.RegisterParticipant(a(0), a(1), a(2), a(3))
	case "SetKycStatus":
		return c.SetKycStatus(a(0), a(1), a(2))
	case "FreezeParticipant":
		return c.FreezeParticipant(a(0), a(1))
	case "UnfreezeParticipant":
		return c.UnfreezeParticipant(a(0))
	case "CreateInvoice":
		return c.CreateInvoice(a(0), a(1), a(2), a(3), a(4), a(5))
	case "BuyerAcceptInvoice":
		return c.BuyerAcceptInvoice(a(0))
	case "ListInvoice":
		return c.ListInvoice(a(0), a(1), a(2))
	case "CancelInvoice":
		return c.CancelInvoice(a(0), a(1))
	case "Invest":
		return c.Invest(a(0), a(1), a(2), a(3))
	case "ReleaseToSupplier":
		return c.ReleaseToSupplier(a(0), a(1))
	case "RecordRepayment":
		return c.RecordRepayment(a(0), a(1), a(2))
	case "MarkLate":
		return c.MarkLate(a(0))
	case "MarkDefault":
		return c.MarkDefault(a(0))
	case "RecordAnomaly":
		return c.RecordAnomaly(a(0), a(1), a(2), a(3), a(4))
	case "AdvanceDemoClock":
		return c.AdvanceDemoClock(a(0))
	case "SeedBuyerHistory":
		return c.SeedBuyerHistory(a(0), a(1), a(2), a(3))
	case "GetInvoice":
		return c.GetInvoice(a(0))
	case "GetInvoicePrivateDetails":
		return c.GetInvoicePrivateDetails(a(0))
	case "ListInvoicesByStatus":
		return c.ListInvoicesByStatus(a(0), a(1), a(2))
	case "ListInvoicesBySupplier":
		return c.ListInvoicesBySupplier(a(0), a(1), a(2))
	case "ListInvoicesByBuyer":
		return c.ListInvoicesByBuyer(a(0), a(1), a(2))
	case "ListAllInvoices":
		return c.ListAllInvoices(a(0), a(1))
	case "GetHoldingsByInvoice":
		return c.GetHoldingsByInvoice(a(0))
	case "GetHoldingsByInvestor":
		return c.GetHoldingsByInvestor(a(0))
	case "GetInvoiceHistory":
		return c.GetInvoiceHistory(a(0))
	case "GetBuyerScore":
		return c.GetBuyerScore(a(0))
	case "GetParticipant":
		return c.GetParticipant(a(0))
	case "ListParticipants":
		return c.ListParticipants(a(0), a(1))
	case "GetPlatformStats":
		return c.GetPlatformStats()
	case "GetAnomalies":
		return c.GetAnomalies(a(0), a(1))
	case "GetAuditTrail":
		return c.GetAuditTrail(a(0), a(1), a(2), a(3))
	case "GetPaymentsByInvoice":
		return c.GetPaymentsByInvoice(a(0))
	case "ListPayments":
		return c.ListPayments(a(0), a(1))
	case "GetClock":
		return c.GetClock()
	case "GetConfig":
		return c.GetConfig()
	}
	return nil, newErr("ERR_INVALID_ARGUMENT", "unknown function "+fn, D{"fn": fn})
}

// ───────────────────────── contractapi surface ─────────────────────────

// BillBridgeContract is the Fabric contract-api facade. Every transaction takes string arguments
// (numbers as decimal strings, objects as JSON strings) and returns the JSON-encoded result; errors
// are returned as the JSON LedgerError payload so the gateway can parse the code.
type BillBridgeContract struct {
	contractapi.Contract
}

// GetEvaluateTransactions marks the read-only functions (the gateway may evaluate them without ordering).
func (bc *BillBridgeContract) GetEvaluateTransactions() []string { return QueryFunctions }

func (bc *BillBridgeContract) run(ctx contractapi.TransactionContextInterface, fn string, args ...string) (string, error) {
	fs := newFabricStub(ctx.GetStub())
	res, err := Invoke(fs, fn, args)
	if err != nil {
		return "", err
	}
	if IsMutating(fn) {
		if err := fs.emitEnvelope(fn); err != nil {
			return "", newErr("ERR_INTERNAL", "failed to set event: "+err.Error(), D{"fn": fn})
		}
	}
	b, err := json.Marshal(res)
	if err != nil {
		return "", newErr("ERR_INTERNAL", "failed to encode result: "+err.Error(), D{"fn": fn})
	}
	return string(b), nil
}

// ── init ──

func (bc *BillBridgeContract) InitLedger(ctx contractapi.TransactionContextInterface, configJSON string) (string, error) {
	return bc.run(ctx, "InitLedger", configJSON)
}

// ── participants ──

func (bc *BillBridgeContract) RegisterParticipant(ctx contractapi.TransactionContextInterface, id, role, orgMsp, perInvoiceCapPaise string) (string, error) {
	return bc.run(ctx, "RegisterParticipant", id, role, orgMsp, perInvoiceCapPaise)
}

func (bc *BillBridgeContract) SetKycStatus(ctx contractapi.TransactionContextInterface, participantID, status, kycDocHash string) (string, error) {
	return bc.run(ctx, "SetKycStatus", participantID, status, kycDocHash)
}

func (bc *BillBridgeContract) FreezeParticipant(ctx contractapi.TransactionContextInterface, participantID, reason string) (string, error) {
	return bc.run(ctx, "FreezeParticipant", participantID, reason)
}

func (bc *BillBridgeContract) UnfreezeParticipant(ctx contractapi.TransactionContextInterface, participantID string) (string, error) {
	return bc.run(ctx, "UnfreezeParticipant", participantID)
}

// ── invoice lifecycle ──

func (bc *BillBridgeContract) CreateInvoice(ctx contractapi.TransactionContextInterface, supplierID, buyerID, faceValuePaise, issueDate, dueDate, privateDetailsJSON string) (string, error) {
	return bc.run(ctx, "CreateInvoice", supplierID, buyerID, faceValuePaise, issueDate, dueDate, privateDetailsJSON)
}

func (bc *BillBridgeContract) BuyerAcceptInvoice(ctx contractapi.TransactionContextInterface, invoiceID string) (string, error) {
	return bc.run(ctx, "BuyerAcceptInvoice", invoiceID)
}

func (bc *BillBridgeContract) ListInvoice(ctx contractapi.TransactionContextInterface, invoiceID, discountBps, minFundingUnits string) (string, error) {
	return bc.run(ctx, "ListInvoice", invoiceID, discountBps, minFundingUnits)
}

func (bc *BillBridgeContract) CancelInvoice(ctx contractapi.TransactionContextInterface, invoiceID, reason string) (string, error) {
	return bc.run(ctx, "CancelInvoice", invoiceID, reason)
}

// ── investment & settlement ──

func (bc *BillBridgeContract) Invest(ctx contractapi.TransactionContextInterface, invoiceID, investorID, units, upiRef string) (string, error) {
	return bc.run(ctx, "Invest", invoiceID, investorID, units, upiRef)
}

func (bc *BillBridgeContract) ReleaseToSupplier(ctx contractapi.TransactionContextInterface, invoiceID, upiRef string) (string, error) {
	return bc.run(ctx, "ReleaseToSupplier", invoiceID, upiRef)
}

func (bc *BillBridgeContract) RecordRepayment(ctx contractapi.TransactionContextInterface, invoiceID, upiRef, amountPaise string) (string, error) {
	return bc.run(ctx, "RecordRepayment", invoiceID, upiRef, amountPaise)
}

func (bc *BillBridgeContract) MarkLate(ctx contractapi.TransactionContextInterface, invoiceID string) (string, error) {
	return bc.run(ctx, "MarkLate", invoiceID)
}

func (bc *BillBridgeContract) MarkDefault(ctx contractapi.TransactionContextInterface, invoiceID string) (string, error) {
	return bc.run(ctx, "MarkDefault", invoiceID)
}

// ── anomalies & demo ──

func (bc *BillBridgeContract) RecordAnomaly(ctx contractapi.TransactionContextInterface, kind, actorID, invoiceRef, errorCode, detail string) (string, error) {
	return bc.run(ctx, "RecordAnomaly", kind, actorID, invoiceRef, errorCode, detail)
}

func (bc *BillBridgeContract) AdvanceDemoClock(ctx contractapi.TransactionContextInterface, seconds string) (string, error) {
	return bc.run(ctx, "AdvanceDemoClock", seconds)
}

func (bc *BillBridgeContract) SeedBuyerHistory(ctx contractapi.TransactionContextInterface, buyerID, onTime, late, defaulted string) (string, error) {
	return bc.run(ctx, "SeedBuyerHistory", buyerID, onTime, late, defaulted)
}

// ── queries ──

func (bc *BillBridgeContract) GetInvoice(ctx contractapi.TransactionContextInterface, invoiceID string) (string, error) {
	return bc.run(ctx, "GetInvoice", invoiceID)
}

func (bc *BillBridgeContract) GetInvoicePrivateDetails(ctx contractapi.TransactionContextInterface, invoiceID string) (string, error) {
	return bc.run(ctx, "GetInvoicePrivateDetails", invoiceID)
}

func (bc *BillBridgeContract) ListInvoicesByStatus(ctx contractapi.TransactionContextInterface, status, pageSize, bookmark string) (string, error) {
	return bc.run(ctx, "ListInvoicesByStatus", status, pageSize, bookmark)
}

func (bc *BillBridgeContract) ListInvoicesBySupplier(ctx contractapi.TransactionContextInterface, supplierID, pageSize, bookmark string) (string, error) {
	return bc.run(ctx, "ListInvoicesBySupplier", supplierID, pageSize, bookmark)
}

func (bc *BillBridgeContract) ListInvoicesByBuyer(ctx contractapi.TransactionContextInterface, buyerID, pageSize, bookmark string) (string, error) {
	return bc.run(ctx, "ListInvoicesByBuyer", buyerID, pageSize, bookmark)
}

func (bc *BillBridgeContract) ListAllInvoices(ctx contractapi.TransactionContextInterface, pageSize, bookmark string) (string, error) {
	return bc.run(ctx, "ListAllInvoices", pageSize, bookmark)
}

func (bc *BillBridgeContract) GetHoldingsByInvoice(ctx contractapi.TransactionContextInterface, invoiceID string) (string, error) {
	return bc.run(ctx, "GetHoldingsByInvoice", invoiceID)
}

func (bc *BillBridgeContract) GetHoldingsByInvestor(ctx contractapi.TransactionContextInterface, investorID string) (string, error) {
	return bc.run(ctx, "GetHoldingsByInvestor", investorID)
}

func (bc *BillBridgeContract) GetInvoiceHistory(ctx contractapi.TransactionContextInterface, invoiceID string) (string, error) {
	return bc.run(ctx, "GetInvoiceHistory", invoiceID)
}

func (bc *BillBridgeContract) GetBuyerScore(ctx contractapi.TransactionContextInterface, buyerID string) (string, error) {
	return bc.run(ctx, "GetBuyerScore", buyerID)
}

func (bc *BillBridgeContract) GetParticipant(ctx contractapi.TransactionContextInterface, participantID string) (string, error) {
	return bc.run(ctx, "GetParticipant", participantID)
}

func (bc *BillBridgeContract) ListParticipants(ctx contractapi.TransactionContextInterface, pageSize, bookmark string) (string, error) {
	return bc.run(ctx, "ListParticipants", pageSize, bookmark)
}

func (bc *BillBridgeContract) GetPlatformStats(ctx contractapi.TransactionContextInterface) (string, error) {
	return bc.run(ctx, "GetPlatformStats")
}

func (bc *BillBridgeContract) GetAnomalies(ctx contractapi.TransactionContextInterface, pageSize, bookmark string) (string, error) {
	return bc.run(ctx, "GetAnomalies", pageSize, bookmark)
}

func (bc *BillBridgeContract) GetAuditTrail(ctx contractapi.TransactionContextInterface, startTime, endTime, pageSize, bookmark string) (string, error) {
	return bc.run(ctx, "GetAuditTrail", startTime, endTime, pageSize, bookmark)
}

func (bc *BillBridgeContract) GetPaymentsByInvoice(ctx contractapi.TransactionContextInterface, invoiceID string) (string, error) {
	return bc.run(ctx, "GetPaymentsByInvoice", invoiceID)
}

func (bc *BillBridgeContract) ListPayments(ctx contractapi.TransactionContextInterface, pageSize, bookmark string) (string, error) {
	return bc.run(ctx, "ListPayments", pageSize, bookmark)
}

func (bc *BillBridgeContract) GetClock(ctx contractapi.TransactionContextInterface) (string, error) {
	return bc.run(ctx, "GetClock")
}

func (bc *BillBridgeContract) GetConfig(ctx contractapi.TransactionContextInterface) (string, error) {
	return bc.run(ctx, "GetConfig")
}
