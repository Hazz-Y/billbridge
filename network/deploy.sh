#!/usr/bin/env bash
# BillBridge — bring up a 3-org Fabric test network and deploy the Go chaincode.
#
# DOCUMENTATION-GRADE: this script was NOT executed on the hackathon host (Docker is unusable there,
# see docs/BUILD_LOG.md Phase 0). It targets fabric-samples/test-network (Fabric 2.5.x) and is the
# exact sequence to run on a machine with Docker. For Drunix images see drunix.env.
#
# Prereqs: fabric-samples checked out next to this repo (or set FABRIC_SAMPLES), `peer` + `fabric-ca-client`
# binaries on PATH, Docker running, Go toolchain (for packaging the chaincode).
#
#   FABRIC_SAMPLES=~/fabric-samples ./network/deploy.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
FABRIC_SAMPLES="${FABRIC_SAMPLES:-$REPO/../fabric-samples}"
TEST_NETWORK="$FABRIC_SAMPLES/test-network"
CHANNEL="${FABRIC_CHANNEL:-billbridge}"
CC_NAME="${FABRIC_CHAINCODE:-billbridge}"
CC_PATH="$REPO/chaincode/billbridge"
COLLECTIONS="$HERE/collections_config.json"
# Endorsement: either platform org or corporate org may endorse (regulator org is read-only).
ENDORSEMENT="OR('Org1MSP.peer','Org2MSP.peer')"
# InitLedger config (see shared/src/domain.ts DEFAULT_LEDGER_CONFIG). demoMode=true enables AdvanceDemoClock / SeedBuyerHistory.
INIT_CONFIG="${INIT_CONFIG:-{\"demoMode\":true,\"bootstrapOperatorId\":\"operator1\"}}"

[ -d "$TEST_NETWORK" ] || { echo "fabric-samples test-network not found at $TEST_NETWORK (set FABRIC_SAMPLES)"; exit 1; }

# Optional Drunix image swap (npcioss/drunix-*). Sourcing is harmless when the file only sets variables.
if [ "${USE_DRUNIX:-false}" = "true" ]; then
  # shellcheck disable=SC1091
  source "$HERE/drunix.env"
fi

cd "$TEST_NETWORK"

echo "==> 1. Network up with CAs + channel '$CHANNEL' (Org1 = platform/MSME/investors, Org2 = buyers)"
./network.sh down
./network.sh up createChannel -c "$CHANNEL" -ca

echo "==> 2. Add Org3 (regulator org, read-only; NOT a member of collectionInvoiceDetails)"
pushd addOrg3 >/dev/null
./addOrg3.sh up -c "$CHANNEL" -ca
popd >/dev/null

echo "==> 3. Vendor + package + deploy Go chaincode with private data collection"
( cd "$CC_PATH" && GOFLAGS=-mod=mod go mod vendor )
./network.sh deployCC \
  -c "$CHANNEL" \
  -ccn "$CC_NAME" \
  -ccp "$CC_PATH" \
  -ccl go \
  -ccv 1.0 -ccs 1 \
  -cccg "$COLLECTIONS" \
  -ccep "$ENDORSEMENT"

echo "==> 4. InitLedger (idempotent) as Org1 admin"
export PATH="$FABRIC_SAMPLES/bin:$PATH"
export FABRIC_CFG_PATH="$FABRIC_SAMPLES/config"
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_TLS_ROOTCERT_FILE="$TEST_NETWORK/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt"
export CORE_PEER_MSPCONFIGPATH="$TEST_NETWORK/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp"
export CORE_PEER_ADDRESS=localhost:7051
ORDERER_CA="$TEST_NETWORK/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem"
ORG2_CA="$TEST_NETWORK/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt"

INIT_ARGS=$(printf '{"function":"InitLedger","Args":[%s]}' "$(printf '%s' "$INIT_CONFIG" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')")
peer chaincode invoke -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com --tls --cafile "$ORDERER_CA" \
  -C "$CHANNEL" -n "$CC_NAME" \
  --peerAddresses localhost:7051 --tlsRootCertFiles "$CORE_PEER_TLS_ROOTCERT_FILE" \
  --peerAddresses localhost:9051 --tlsRootCertFiles "$ORG2_CA" \
  -c "$INIT_ARGS"

echo "==> 5. Register demo identities (role / participantId cert attributes)"
"$HERE/register-identities.sh"

cat <<EOF

Done. Backend env (see .env.example):
  LEDGER_MODE=fabric FABRIC_CHANNEL=$CHANNEL FABRIC_CHAINCODE=$CC_NAME
  FABRIC_PEER_ENDPOINT=localhost:7051 FABRIC_PEER_HOST_ALIAS=peer0.org1.example.com
  FABRIC_IDENTITIES_DIR=$REPO/identities
EOF
