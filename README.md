# BillBridge — Tokenized MSME invoice financing with UPI-native settlement

> Drunix Hackathon (NPCI × Citi) · Track: Real Asset Tokenization · **SANDBOX — prototype, synthetic data, not investment advice.**

An MSME supplier turns a buyer-accepted invoice into fractional ₹1,000 units on a permissioned ledger. Investors fund it
over UPI, the supplier is paid in minutes, and on the due date the buyer's UPI repayment is distributed pro-rata by the
chaincode. Double financing is rejected inside the ledger by three independent guards, and every rejection is itself an
on-chain record the regulator sees live.

```
MSME uploads PDF → AI extraction (+ GSTIN checksum, integer-paise arithmetic) → CreateInvoice (3 duplicate guards)
→ Buyer accepts → Operator lists at an annualized discount → Investors fund via UPI QR / upi:// (HMAC webhook)
→ Supplier paid via UPI → Time passes → Buyer repays via UPI → waterfall → investors paid, buyer score updated
```

## Quick start (one command)

```bash
git clone <repo> billbridge && cd billbridge
make demo          # installs deps, starts ledger (auto: Fabric/Drunix → mock) + backend + frontend, seeds, opens browser
```

Prereqs: Node ≥ 20, GNU Make. Optional: Go ≥ 1.22 (chaincode tests), Docker (real Fabric/Drunix network).
`make demo` is idempotent; `make reset` returns to a clean seeded state in ~3 s; `make down` stops everything.

| URL | What |
|---|---|
| http://localhost:3000 | App (mobile-first; try 390×844) |
| http://localhost:4000/docs | Swagger UI (generated from the Zod schemas in `shared/`) |
| http://localhost:4000/health | Health + **active ledger mode** |

**Demo credentials** (password `Demo@1234` for all; chips on the login page autofill them):

| Role | Email | Note |
|---|---|---|
| Operator | operator@demo.in | lists invoices, KYC, freeze, settlement |
| Regulator | regulator@demo.in | read-only org; no private data |
| MSME | msme1@demo.in · msme2 · msme3 | Sharma Precision, Kaveri Textiles, Nila Packaging |
| Buyer | buyer1@demo.in · buyer2 · buyer3 | Aurora Motors (score 63), Meridian Retail (50), Vertex Infra (100) |
| Investor | investor1@demo.in … investor6 | investor4 = ₹50,000 cap · investor5 = KYC pending |

The live demo invoice is `samples/invoice-aurora-001.pdf` (Sharma Precision → Aurora Motors, ₹4,00,000, due +67 days).
It is **not** created by the seed — you create it on stage. Script: `docs/DEMO_SCRIPT.md`.

## Which ledger is running?

`LEDGER_MODE=auto` (default) tries a Fabric/Drunix gateway and falls back to **MockLedger** with a loud log line. The
UI footer, the landing badge and `/health` always say which one is active. On the build machine Docker was unusable
(see `docs/DRUNIX_NOTES.md`), so the shipped demo runs on **Ledger: Mock (Fabric-compatible interface)**.

The mock is not a toy: it is a line-by-line TypeScript port of the Go chaincode with the same function names,
validation order, error codes, envelope events, state machine, key layout, private-data ACL, simulated blocks and
deterministic tx IDs, persisted to `.data/ledger.json`. **Both** implementations execute the same
`shared/test-vectors/*.json` (8 files, 275 steps) — `go test` for the chaincode, Vitest for the mock.

To run on a real network: `make network-up` (Docker; `network/deploy.sh` uses fabric-samples `test-network` + `addOrg3`,
deploys `chaincode/billbridge` with `network/collections_config.json`), then `LEDGER_MODE=fabric make demo`.
Drunix: swap images to `npcioss/drunix-peer|orderer` and add `drunix-vscc` — the chaincode is unchanged.

## What the demo proves (spec §2)

| # | Feature | Where |
|---|---|---|
| 1 | Double-financing prevention — 3 guards (identity, content fingerprint, file hash) | Demo Panel attack buttons → 3 distinct error codes → regulator anomaly panel (on-chain `RecordAnomaly`) |
| 2 | UPI-native money flow | QR + `upi://pay?…` deeplink for funding and repayment; HMAC-SHA256 webhook, idempotent on `upiRef`, ±5 min skew; simulated payouts in the UPI log |
| 3 | Multi-org trust model | Org1 Platform (operator/MSME/investor), Org2 Corporate (buyer), Org3 Regulator (read-only); private collection excludes Org3 |
| 4 | Compliance-by-code | KYC gate, per-investor cap (cumulative), freeze — all enforced in chaincode |
| 5 | On-chain buyer reliability score | Aurora 63 → 67 after an on-time settlement; drops on default |
| 6 | AI invoice intake with confidence | Gemini (if `GEMINI_API_KEY`) or pdf-parse heuristics; deterministic post-processing drives green/amber/red |
| 7 | Reconciliation engine | Operator tab: ledger payments vs UPI log; "Inject mismatch" turns a row red |
| 8 | One-command setup | `make demo` |

## Repository

```
shared/      Zod schemas, error codes, events, LedgerClient + LedgerApi, money/pricing/score/waterfall math,
             BillBridgeContract (TS port) + MockLedger, test-vectors/
chaincode/   Go chaincode (fabric-contract-api-go v2) + in-memory stub + vector conformance tests
network/     collections_config.json, deploy.sh, register-identities.sh (Fabric/Drunix; not runnable without Docker)
backend/     Fastify 5 + Prisma/SQLite (off-chain only), UPI simulator, AI extraction, SSE event pipeline, demo routes
frontend/    Next.js 15 App Router, Tailwind v4, TanStack Query, SSE hook, Demo Panel
samples/     generated invoice PDFs (clean + scan-like)
e2e/         Playwright: happy path (UI-driven) + 3 attacks + compliance gates
scripts/     cross-platform orchestration behind the Makefile (demo/down/reset/logs/smoke)
docs/        BUILD_LOG, DRUNIX_NOTES, API_ROUTES, DEMO_SCRIPT, SECURITY_AND_COMPLIANCE, PITCH
```

## Tests

```bash
make test        # shared (31) + chaincode (16 incl. 8 vectors) + backend (33) + frontend typecheck/lint
make smoke       # 45 API checks driving the whole §9 flow (needs make demo running)
make test-e2e    # Playwright (needs make demo running)
```

## Design rules that hold everywhere
- **Money is integer paise.** Go `int64`; TS `number` guarded by `Number.isSafeInteger`; ratios via `floor(a·b/c)` with
  BigInt. ₹ strings exist only at the render/UPI boundary.
- **The ledger is the single source of truth** for ownership, balances and invoice state. SQLite holds users, tokens,
  UPI log, reservations, uploads, and mirrors (events, anomalies, score history) for SSE replay.
- **Structured errors**: chaincode `{code,message,details}` → HTTP status per code → human message in the UI.
- **Determinism**: chaincode time = tx timestamp + demo clock offset (`AdvanceDemoClock`, demoMode only); no
  `time.Now()`, no map-order dependence, one envelope event per tx, composite-prefix keys (LevelDB-safe).

## Environment
Copy `.env.example` to `.env` (optional — defaults work). Notable: `LEDGER_MODE`, `GEMINI_API_KEY`/`GEMINI_MODEL`,
`UPI_WEBHOOK_SECRET`, `AUTO_SUPPLIER_PAYOUT`, `DEMO_MODE`. Demo routes exist only when `NODE_ENV!=production` and
`DEMO_MODE=true`.

## Honesty notes
- Market-size statements are phrased as reported estimates; nothing here is investment advice.
- Gemini is used only if a key is present; the fallback parser is what the shipped demo exercises.
- `NpciSandboxUpiProvider` is a compile-time stub; the demo uses `SimulatedUpiProvider`.
- Fabric gateway client compiles but was not exercised against a live peer on the build host.
