# network/ — Fabric / Drunix deployment (documentation-grade)

These scripts target `fabric-samples/test-network` (Fabric 2.5.x) and were **not executed on the hackathon host**:
Docker is unusable there (C: drive full, Docker VM disk corrupted — see `docs/BUILD_LOG.md` Phase 0), so the demo
runs on the `MockLedger`. The Go chaincode itself is fully tested without Docker (`cd chaincode/billbridge && go test ./...`
executes every `shared/test-vectors/*.json` through an in-memory stub, the same vectors Vitest runs against the TS port).

| File | Purpose |
| --- | --- |
| `deploy.sh` | `network.sh up createChannel -c billbridge -ca` → `addOrg3` → `deployCC` (Go, private collection, endorsement `OR('Org1MSP.peer','Org2MSP.peer')`) → `InitLedger` invoke → `register-identities.sh` |
| `collections_config.json` | `collectionInvoiceDetails`: GSTINs, invoice number, line items, file hash. Members `OR('Org1MSP.member','Org2MSP.member')` — the regulator org (Org3) only sees hashes. `memberOnlyRead/Write`, `blockToLive 0` |
| `register-identities.sh` | For every demo user in `shared/src/demo.ts`: `fabric-ca-client register` with `role=<ROLE>:ecert,participantId=<id>:ecert` under the right org CA (Org1 = OPERATOR/MSME/INVESTOR, Org2 = BUYER, Org3 = REGULATOR), then `enroll` into `identities/<participantId>/{cert.pem,key.pem,mspId}` |
| `drunix.env` | Image overrides to run the same topology on NPCI's Drunix fork (`npcioss/drunix-peer`, `npcioss/drunix-orderer`, `npcioss/drunix-vscc`). `USE_DRUNIX=true ./network/deploy.sh` |

Orgs: **Org1MSP** = platform (operator, MSMEs, investors), **Org2MSP** = corporate buyers, **Org3MSP** = regulator (read-only).
The chaincode enforces role↔MSP (`shared/src/enums.ts ROLE_MSP`) and identity binding from the cert attributes, so a
certificate can never act as another participant.

## Running it

```bash
git clone https://github.com/hyperledger/fabric-samples ../fabric-samples   # + install-fabric.sh binaries/images
FABRIC_SAMPLES=../fabric-samples ./network/deploy.sh                        # ~5 min; idempotent InitLedger
```

Chaincode keys are plain strings (`INV~<id>`, `STATUS~<status>~<id>`, …) and all queries are `GetStateByRange`
prefix scans, so the default **LevelDB** state database is enough (no CouchDB indexes). One chaincode event
`billbridge` is emitted per transaction with the `EnvelopeEvent` shape from `shared/src/events.ts`.
Errors are returned as the JSON `LedgerError` payload (`shared/src/errors.ts parseLedgerError`).

## Backend environment (`.env.example`)

```
LEDGER_MODE=fabric            # auto | fabric | mock  (auto: Fabric health ≤90 s, then mock)
FABRIC_CHANNEL=billbridge
FABRIC_CHAINCODE=billbridge
FABRIC_PEER_ENDPOINT=localhost:7051
FABRIC_PEER_HOST_ALIAS=peer0.org1.example.com
FABRIC_IDENTITIES_DIR=./identities   # output of register-identities.sh
```

Chaincode-as-a-Service: `CHAINCODE_SERVER_ADDRESS=0.0.0.0:9999 CORE_CHAINCODE_ID_NAME=<package-id> ./billbridge` (see `main.go`).
