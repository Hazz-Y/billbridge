# Drunix / Fabric notes (Phase 0 spike)

**Outcome: rung 3 — MockLedger (Fabric-compatible `LedgerClient` interface).**
Spike time used: ~15 min of the 45 min budget. Everything below is reproducible.

## What was tried

### Rung 1 — Drunix (`github.com/npci/drunix`)
- `git clone --depth 1 https://github.com/npci/drunix.git` ✅
- The README links to `drunix-network/test-network/README.md`, but **that directory does not exist in the
  repository** (only `drunix-network/asset-transfer-basic` and `asset-transfer-private-data` sample apps are present).
  There is no checked-in compose/network script for a local Drunix network.
- Published images do exist on Docker Hub under the `npcioss` namespace:
  `drunix-peer`, `drunix-orderer`, `drunix-vscc`, `drunix-ccenv`, `drunix-baseos`, `fabric-tools`, `hlf-builder`
  (`docker manifest inspect npcioss/drunix-peer:latest` → found).
- Drunix architecture deviations from stock Fabric (from `docs/drunix-arch.md`): separated endorsing vs committing
  peers, a **stateless validation service (`drunix-vscc`)** that must be deployed alongside peers, optional SQL
  (Postgres) state store, and reduced private-data gossip. Without the sample network, wiring the VSCC into a
  stock `test-network` compose is guesswork and well over the spike budget.

### Rung 2 — Hyperledger Fabric 2.5 `test-network`
- `install-fabric.sh --fabric-version 2.5.12 --ca-version 1.5.15 docker samples binary` ✅ (images + binaries pulled)
- `MSYS_NO_PATHCONV=1 ./network.sh up createChannel -c billbridge` ❌
  - `cryptogen` failed: **"There is not enough space on the disk"** — the host `C:` drive had **0 bytes free**.
  - Docker Desktop's VM disk also lives on `C:` and returned `input/output error` on image blobs
    (containerd content store corrupted by the full disk). `docker image rm` of the pulled images also fails with
    the same I/O error.
- Second genuine attempt is impossible without freeing/relocating the Docker VM disk (a host-level Docker Desktop
  settings change, outside the agent's remit and the 45-min box).

### Rung 3 — MockLedger ✅
- In-process TypeScript implementation of the identical `LedgerClient` contract (`shared/src/ledger/`).
- Same function names, argument encoding (all-string args like Fabric), validation order, error codes, envelope
  events, state machine, composite-key layout, pagination bookmarks, private-data ACL simulation, history per key,
  simulated blocks and deterministic txIds `sha256(counter|fn|args)`. File-persisted to `.data/ledger.json`.
- Conformance is proven by `shared/test-vectors/*.json`, executed by **both** `go test` (chaincode) and Vitest
  (MockLedger).

## Commands that worked
```
winget install --id GoLang.Go -e          # Go 1.27
winget install --id GnuWin32.Make -e      # GNU Make 3.81
docker manifest inspect npcioss/drunix-peer:latest
curl -sSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh | bash -s -- --fabric-version 2.5.12 --ca-version 1.5.15 docker samples binary
```

## How to run on a real network later
1. Free ≥ 20 GB on the Docker host disk; `./network.sh up createChannel -c billbridge -ca`; `addOrg3` for the
   Regulator org; deploy `chaincode/billbridge` with `-ccp ../chaincode/billbridge -ccl go -cccg network/collections_config.json`.
2. Set `LEDGER_MODE=fabric` and `FABRIC_*` env vars (see `.env.example`); the backend's `FabricLedgerClient`
   (`backend/src/ledger/fabric-ledger.ts`) maps the same `LedgerClient` calls to `@hyperledger/fabric-gateway`.
3. For Drunix: swap image names to `npcioss/drunix-peer` / `npcioss/drunix-orderer` and add the `drunix-vscc`
   service; the chaincode is unchanged (Drunix is HLF 2.5-compatible).
