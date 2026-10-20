# BillBridge — 4-minute demo script

Before you start: `make demo` (or `make reset` if it is already running). Open http://localhost:3000 on the laptop
and, optionally, on a phone on the same network (`http://<laptop-ip>:3000`). Every account's password is `Demo@1234`.
The floating flask button (bottom-right) opens the **Demo Panel** on every screen: role switcher, time travel,
attack buttons, network explorer.

| Time | Screen | Do | Say |
|---|---|---|---|
| 0:00 | Landing `/` | Point at the stat counters, the sandbox banner and the ledger badge. | "MSMEs wait 60–90 days to get paid. BillBridge turns an accepted invoice into ₹1,000 units on a permissioned ledger and settles every leg over UPI. The badge tells you which ledger is live — today it's our Fabric-compatible mock; the chaincode is Go and passes the same test vectors." |
| 0:30 | Login → MSME chip → `/msme` | Drop `samples/invoice-aurora-001.pdf`. Watch the 4 extraction steps, then the field form with green/amber confidence badges. Click **Confirm & tokenize**. | "AI reads the invoice, we validate GSTIN check digits and that line items + GST equal the total — integer paise only. Tokenizing writes it on-chain: 400 units, hash of the PDF, hash of the content." |
| 1:05 | Demo Panel → **Attack** | Click **Same file**, **New number**, **Changed amount**. Each shows *Rejected ✓* with a different error code and guard. | "Double financing is India's receivables fraud. Three independent guards live in consensus: identity, content fingerprint, file hash. Rejected attempts are themselves written on-chain." |
| 1:30 | Demo Panel → **REGULATOR** | Anomaly panel shows the three guards with tx IDs. Click the invoice → provenance timeline and the 🔒 "private details not shared with this org" placeholder. | "The regulator org sees every transaction and every rejection live, but never the invoice contents — that's a private data collection between the platform and corporate orgs." |
| 1:50 | Demo Panel → **BUYER** | Click **Accept** on the Sharma Precision invoice. Point at the reliability score **63**. | "Aurora Motors accepts on-chain. Its reliability score is computed from settlement history — 5 on time, 2 late." |
| 2:05 | Demo Panel → **OPERATOR** | **Price & list** → 800 bps → see price ₹985.32 and yield 8.11% p.a. → **List on marketplace**. | "The operator sets an annualized discount; the chaincode fixes the unit price for the 67-day tenor." |
| 2:20 | Demo Panel → **INVESTOR** | **Invest** on the Aurora card → 250 units → **Create UPI request** → show the QR / `upi://` link (scan it with a phone to show it's a real intent) → **Simulate payment**. | "The investor pays over UPI. The webhook is HMAC-signed and idempotent; the ledger's Invest is the final arbiter — KYC, per-investor cap and freeze are enforced there." |
| 2:50 | (optional) login `investor5@demo.in` / `investor4@demo.in` | Invest is disabled (KYC pending) / cap exceeded at 51 units. | "Compliance by code." |
| 3:00 | Demo Panel → **MSME** | Open the invoice: **Paid in N s vs 67-day wait**. (The second investor is pre-funded in the E2E; in a live demo fund the remaining 150 units as `investor2@demo.in` first, or point at the partially-funded seed invoice.) | "Supplier gets working capital in minutes, automatically once funding completes." |
| 3:20 | Demo Panel → **Advance to due date (+1 day)** → **BUYER** → Repayments due → **Pay via UPI** → **Simulate payment** | Distribution summary appears; score gauge moves **63 → 67**. | "On the due date the buyer repays via UPI; the chaincode waterfall pays investors pro-rata — ₹2.5 L and ₹1.5 L here, exact to the paisa — and Aurora's score rises." |
| 3:45 | Demo Panel → **REGULATOR** / Network explorer | Live feed shows `RecordRepayment`, distributions, `SCORE_UPDATED`. | "Every step you just saw is a block with a tx ID. Reconciliation of ledger vs UPI log is on the operator tab — inject a mismatch from the panel to see it go red." |

## If something goes wrong
- **Reset in < 5 s:** Demo Panel → Reset (or `make reset`).
- **Services down:** `make down && make demo`.
- **Pending UPI request stuck:** Demo Panel lists pending `upiRef`s with a Simulate button.
- **Default demo (P1):** Demo Panel → *Simulate default (+91d)* on the last invoice → score drops, holdings show loss.
- The ledger footer always states the active mode. If it says *Mock*, say so — the Go chaincode and the mock pass the same 8 shared vectors (275 steps), see `docs/DRUNIX_NOTES.md`.
