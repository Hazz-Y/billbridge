# BillBridge — pitch notes

**One sentence.** We turned India's MSME receivables gap into a transparent, UPI-native, on-chain marketplace where
invoices become investable digital assets — with double-financing prevention enforced in the consensus layer.

**Problem.** Reported estimates put typical corporate-to-MSME payment terms at 60–90 days. Suppliers borrow against
receivables at high cost, and the same invoice can be pledged to several lenders because lenders cannot see each other.

**What we built (working, demoable).**
1. Invoice → ₹1,000 units on a permissioned ledger (Drunix/Fabric chaincode in Go; mock with identical semantics).
2. Three independent duplicate guards in consensus; rejections are themselves on-chain, regulator-visible records.
3. UPI for every leg: funding, supplier payout, buyer repayment, investor distribution — signed, idempotent webhooks.
4. Compliance by code: KYC gate, per-investor cap, freeze.
5. On-chain buyer reliability score that moves with settlement behaviour (63 → 67 live on stage).
6. AI invoice intake with per-field confidence, integer-paise arithmetic checks and GSTIN check digits.
7. Three-org trust model with private data; regulator sees hashes, statuses and every transaction in real time.

**Why Drunix.** Enterprise-grade, HLF 2.5-compatible, built for tokenization and multi-org networks — the chaincode
runs unchanged; the orgs map to platform / corporate / regulator peers.

**Business model (sketch).** Platform fee in bps on funded volume; data services for buyers (reliability scoring);
white-label for banks/NBFCs as TReDS-adjacent infrastructure.

**Ask.** Access to a Drunix test network and the NPCI UPI sandbox to replace the simulators.
