#!/usr/bin/env bash
# Register + enroll every demo user from shared/src/demo.ts with fabric-ca, stamping the two X.509
# attributes the chaincode reads (fabric_stub.go GetCaller): role=<ROLE>:ecert, participantId=<id>:ecert.
# Org1 CA = OPERATOR / MSME / INVESTOR, Org2 CA = BUYER, Org3 CA = REGULATOR (shared/src/enums.ts ROLE_MSP).
# Output: identities/<participantId>/{cert.pem,key.pem,mspId} consumed by the backend (FABRIC_IDENTITIES_DIR).
#
# DOCUMENTATION-GRADE: not executed on the hackathon host (Docker unusable). Run after deploy.sh steps 1-2.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
FABRIC_SAMPLES="${FABRIC_SAMPLES:-$REPO/../fabric-samples}"
TN="$FABRIC_SAMPLES/test-network"
OUT="${FABRIC_IDENTITIES_DIR:-$REPO/identities}"
export PATH="$FABRIC_SAMPLES/bin:$PATH"

# participantId:ROLE — mirrors DEMO_USERS in shared/src/demo.ts (password for the app is Demo@1234; CA secret below).
USERS=(
  operator1:OPERATOR regulator1:REGULATOR
  msme1:MSME msme2:MSME msme3:MSME
  buyer1:BUYER buyer2:BUYER buyer3:BUYER
  investor1:INVESTOR investor2:INVESTOR investor3:INVESTOR investor4:INVESTOR investor5:INVESTOR investor6:INVESTOR
)

# org settings: CA name, URL, TLS cert, CA-admin home (where test-network enrolled the registrar), MSP id
org_for_role() {
  case "$1" in
    OPERATOR|MSME|INVESTOR) echo "org1 ca-org1 localhost:7054 $TN/organizations/fabric-ca/org1/ca-cert.pem $TN/organizations/peerOrganizations/org1.example.com Org1MSP" ;;
    BUYER)                  echo "org2 ca-org2 localhost:8054 $TN/organizations/fabric-ca/org2/ca-cert.pem $TN/organizations/peerOrganizations/org2.example.com Org2MSP" ;;
    REGULATOR)              echo "org3 ca-org3 localhost:11054 $TN/addOrg3/fabric-ca/org3/ca-cert.pem $TN/organizations/peerOrganizations/org3.example.com Org3MSP" ;;
    *) echo "unknown role $1" >&2; exit 1 ;;
  esac
}

for entry in "${USERS[@]}"; do
  pid="${entry%%:*}"; role="${entry##*:}"
  read -r org caname caurl tlscert cahome mspid <<<"$(org_for_role "$role")"
  secret="${pid}pw"
  dest="$OUT/$pid"
  mkdir -p "$dest"
  echo "==> $pid ($role) via $caname"

  # 1. register with the org's CA admin (idempotent: ignore 'already registered')
  FABRIC_CA_CLIENT_HOME="$cahome" fabric-ca-client register \
    --caname "$caname" --tls.certfiles "$tlscert" \
    --id.name "$pid" --id.secret "$secret" --id.type client \
    --id.attrs "role=${role}:ecert,participantId=${pid}:ecert" \
    || echo "   (already registered, continuing)"

  # 2. enroll -> MSP dir; the attrs are baked into the ecert because of the :ecert suffix
  fabric-ca-client enroll -u "https://${pid}:${secret}@${caurl}" --caname "$caname" \
    --tls.certfiles "$tlscert" -M "$dest/msp" \
    --enrollment.attrs "role,participantId"

  # 3. flatten for the backend gateway client
  cp "$dest/msp/signcerts/"*.pem "$dest/cert.pem"
  cp "$dest/msp/keystore/"* "$dest/key.pem"
  printf '%s' "$mspid" > "$dest/mspId"
done

echo "Identities written to $OUT ($(ls "$OUT" | wc -l) users). Set FABRIC_IDENTITIES_DIR=$OUT"
