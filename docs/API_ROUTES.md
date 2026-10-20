# BillBridge HTTP API contract (backend ⇄ frontend)

Base URL: `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`). All JSON. Schemas named below live in
`shared/src/api.ts` and are the single source of truth (the backend validates with them, the frontend parses with them).

- Auth: `Authorization: Bearer <accessToken>` (15-min JWT). Refresh with `POST /api/auth/refresh`.
- Errors: non-2xx body is `ApiErrorSchema` → `{ error: { code, message, details? } }`. Status from `HTTP_STATUS_FOR_CODE`.
- Pagination: `?pageSize=&bookmark=` → `{ items, nextBookmark }`.
- SSE: `GET /api/platform/audit/stream?token=<accessToken>` (EventSource cannot set headers). Events: `event: ledger`,
  `id: <seq>`, `data: SseEvent` JSON. Heartbeat comment every 15 s. Supports `Last-Event-ID` header or `?lastEventId=`.
- Swagger UI at `GET /docs`. Health at `GET /health` → `{ ok, ledger: LedgerHealth, simulatedNow, demoMode }`.

| Method | Path | Roles | Request | Response |
|---|---|---|---|---|
| POST | /api/auth/register | public | RegisterRequestSchema | TokenResponseSchema |
| POST | /api/auth/login | public | LoginRequestSchema | TokenResponseSchema |
| POST | /api/auth/refresh | public | RefreshRequestSchema | TokenResponseSchema |
| GET | /api/auth/me | any | – | UserProfileSchema |
| POST | /api/invoices/upload | MSME | multipart `file` (pdf/png/jpg ≤10MB) | UploadResponseSchema |
| POST | /api/invoices | MSME | CreateInvoiceRequestSchema | InvoiceWithMetaSchema (409 + ledger code on duplicate; anomaly recorded) |
| GET | /api/invoices | any | ListInvoicesQuerySchema (`marketplace=true` ⇒ LISTED+PARTIALLY_FUNDED; MSME/BUYER default to own) | InvoiceListResponseSchema |
| GET | /api/invoices/:id | any | – | InvoiceDetailSchema (privateDetails null + privateAccess=DENIED_* for regulator/investor/others) |
| GET | /api/invoices/:id/history | any | – | InvoiceHistoryResponseSchema |
| POST | /api/invoices/:id/accept | BUYER | – | InvoiceWithMetaSchema |
| POST | /api/invoices/:id/list | OPERATOR | ListInvoiceRequestSchema | InvoiceWithMetaSchema |
| POST | /api/invoices/:id/cancel | MSME/OPERATOR | CancelInvoiceRequestSchema | InvoiceWithMetaSchema |
| GET | /api/invoices/:id/pricing-preview?discountBps=&minFundingUnits= | OPERATOR | – | PricingPreviewSchema |
| POST | /api/invest/:invoiceId/intent | INVESTOR | InvestIntentRequestSchema | PaymentIntentResponseSchema |
| POST | /api/invest/webhook | HMAC header `x-upi-signature`, `x-upi-timestamp` | UpiWebhookPayloadSchema (raw body) | WebhookResultSchema |
| GET | /api/invest/portfolio | INVESTOR | – | PortfolioResponseSchema |
| GET | /api/invest/upi/:upiRef | owner/OPERATOR | – | UpiTransactionSchema |
| GET | /api/invest/upi?invoiceId=&status= | any (own) | – | `{ items: UpiTransaction[] }` |
| POST | /api/settlement/:invoiceId/supplier-payout | OPERATOR | – | SupplierPayoutResponseSchema |
| POST | /api/settlement/:invoiceId/repayment-intent | BUYER | – | PaymentIntentResponseSchema |
| POST | /api/settlement/:invoiceId/repayment | OPERATOR (also driven by webhook) | RepaymentRecordRequestSchema | RepaymentResponseSchema |
| POST | /api/settlement/:invoiceId/mark-late | OPERATOR | – | InvoiceWithMetaSchema |
| POST | /api/settlement/:invoiceId/mark-default | OPERATOR | – | `{ invoice, buyerScore, holdings, tx }` |
| GET | /api/platform/stats | public | – | StatsResponseSchema |
| GET | /api/platform/scores/:buyerId | any | – | ScoreResponseSchema |
| GET | /api/platform/reconciliation | OPERATOR/REGULATOR | – | ReconciliationResponseSchema |
| GET | /api/platform/audit/stream | any (token query) | – | SSE |
| GET | /api/platform/audit/events | any | AuditEventsQuerySchema | AuditEventsResponseSchema or CSV |
| GET | /api/platform/anomalies | OPERATOR/REGULATOR | pagination | AnomalyListResponseSchema |
| GET | /api/platform/participants | OPERATOR/REGULATOR | – | ParticipantListResponseSchema |
| POST | /api/platform/kyc/:participantId | OPERATOR | KycRequestSchema | ParticipantWithUserSchema |
| POST | /api/platform/freeze/:participantId | OPERATOR | FreezeRequestSchema | ParticipantWithUserSchema |
| GET | /api/platform/network | public | – | NetworkResponseSchema |
| GET | /api/demo/state | public | – | DemoStateResponseSchema |
| POST | /api/demo/seed | public (demo) | – | SeedResponseSchema |
| POST | /api/demo/reset | public (demo) | – | SeedResponseSchema |
| POST | /api/demo/time-travel | public (demo) | TimeTravelRequestSchema | TimeTravelResponseSchema |
| POST | /api/demo/simulate-payment | public (demo) | SimulatePaymentRequestSchema | WebhookResultSchema |
| POST | /api/demo/attack/duplicate | public (demo) | AttackRequestSchema | AttackResponseSchema |
| POST | /api/demo/inject-mismatch | public (demo) | – | `{ upiRef, reason }` |
| POST | /api/demo/switch-role | public (demo) | SwitchRoleRequestSchema | TokenResponseSchema |

Demo routes exist only when `NODE_ENV !== 'production' && DEMO_MODE=true`.
Role → landing route in the frontend: MSME `/msme`, BUYER `/buyer`, INVESTOR `/investor`, OPERATOR `/operator`, REGULATOR `/regulator`.
