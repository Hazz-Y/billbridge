# BillBridge — one-command demo. Works with GNU Make on Linux/macOS/Windows (GnuWin32 or MSYS).
# All logic lives in cross-platform Node scripts under scripts/ so recipes are shell-agnostic.

.PHONY: help setup network-up network-down up seed demo test test-shared test-chaincode test-backend test-frontend test-e2e down reset logs tunnel lint typecheck

help:
	@node scripts/help.mjs

setup:            ## install deps (npm ci / go mod download), generate Prisma client + sample PDFs
	@node scripts/setup.mjs

network-up:       ## start the Fabric/Drunix test network (requires Docker; see docs/DRUNIX_NOTES.md)
	@bash network/deploy.sh up

network-down:     ## stop the Fabric/Drunix test network
	@bash network/deploy.sh down

up:               ## start backend + frontend (LEDGER_MODE=auto) without seeding
	@node scripts/demo.mjs --no-seed --no-open

seed:             ## seed demo data into the running platform
	@node scripts/reset.mjs --seed-only

demo:             ## setup if needed → start ledger/backend/frontend → wait → seed → print summary → open browser
	@node scripts/demo.mjs

reset:            ## wipe ledger + DB and reseed (< 30 s), platform keeps running
	@node scripts/reset.mjs

down:             ## stop backend + frontend started by `make demo`
	@node scripts/down.mjs

logs:             ## tail backend + frontend logs
	@node scripts/logs.mjs

test: test-shared test-chaincode test-backend test-frontend   ## run every test suite (not e2e)

test-shared:
	@npm run test --workspace shared

test-chaincode:
	@node scripts/go.mjs test ./... -count=1

test-backend:
	@npm run test --workspace backend

test-frontend:
	@npm run typecheck --workspace frontend && npm run lint --workspace frontend

test-e2e:         ## Playwright: happy path + 3 double-financing attacks (needs `make demo` running)
	@npm run test --workspace e2e

typecheck:
	@npm run typecheck --workspaces --if-present

lint:
	@npm run lint --workspaces --if-present

tunnel:           ## optional: expose the frontend via Cloudflare quick tunnel
	@node scripts/tunnel.mjs
