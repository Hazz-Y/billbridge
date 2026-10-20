# Security & compliance notes (prototype)

## Threats we designed against
| Threat | Control | Where |
|---|---|---|
| Same invoice financed twice (replayed PDF, re-numbered invoice, amount tweak) | Three independent ledger keys checked in `CreateInvoice`: `INV~sha256(supplier\|buyer\|number)`, `CONTENT~sha256(canonical content excl. number)`, `FILE~sha256(pdf)`. Cancelled invoices keep their keys (identity is burned). | chaincode `lifecycle.go` / `shared/src/ledger/contract.ts` |
| Acting as another participant | Identity binding: cert attribute `participantId` must equal the argument (`supplierId`, `investorId`, `buyerId`); role attribute must match the MSP (`Org1` platform, `Org2` corporate, `Org3` regulator). | `requireRole` / `bind` |
| Unapproved or sanctioned investors | KYC must be `APPROVED`; `frozen` blocks every function for every role (operators included); per-investor cap is cumulative per invoice. | `requireActive`, `Invest` |
| Regulator reading invoice contents | Private data collection `collectionInvoiceDetails` (Org1+Org2 only, `memberOnlyRead`), plus participant-level check (supplier, buyer, operator). Regulator sees public fields and hashes only. | `GetInvoicePrivateDetails`, `network/collections_config.json` |
| Forged / replayed UPI webhooks | HMAC-SHA256 over the raw body with `UPI_WEBHOOK_SECRET`, constant-time compare, timestamp within ±5 min, idempotent on `upiRef` (DB unique + ledger `PAY~upiRef` replay returns the original result). | `backend/src/upi/` |
| Money received but ledger rejects | Webhook acknowledges, row → `REFUND_REQUIRED`, simulated refund logged, anomaly recorded, reconciliation flags it. | invest webhook handler |
| Float money bugs | Integer paise end-to-end; `parseDecimalToPaise` string parsing; `floor(a·b/c)` via BigInt/big.Int; waterfall invariant asserted at runtime. | `shared/src/money.ts`, `waterfall.ts`, Go equivalents |
| Non-deterministic chaincode | Time from tx timestamp + on-ledger clock offset; sorted iteration; single envelope event. | chaincode |
| Secrets in git | `.env` ignored; `.env.example` complete; identities folder ignored. | repo root |

## Known gaps (prototype)
- Authentication is email+password JWT; production would bind users to CA-issued identities with hardware-backed keys.
- The mock ledger has no endorsement policy; on Fabric use `OR('Org1MSP.peer','Org2MSP.peer')` as in `network/deploy.sh`.
- Uploaded PDFs are stored unencrypted on disk; KYC documents are never stored (hash only), as specified.
- Rate limiting, CSRF and audit-log signing are out of scope.

## Regulatory framing (concepts, no section numbers claimed)
BillBridge mirrors the structure of India's TReDS model (invoice financing on a regulated platform with buyer
acceptance), applies KYC gating before participation, and keeps an immutable, regulator-visible audit trail. A production
deployment would need the appropriate registrations and would route real money through a licensed PSP; this prototype
simulates UPI.
