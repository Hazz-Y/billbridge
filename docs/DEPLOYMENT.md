# Deployment

## Live frontend

**https://billbridge-hackathon.netlify.app** — static export of the Next.js app, deployed via Netlify CLI.

> If you hit a Netlify "Login Redirect" page instead of the app: that is Netlify's own **Visitor Access**
> gate on newly created sites, not an app bug. Fix it once in the dashboard: **Site configuration →
> Visitor access → set to Public** (https://app.netlify.com/projects/billbridge-hackathon/configuration/access).
> It is not exposed through Netlify's public API/CLI, so it has to be toggled there.

### Why a static export, not Netlify's Next.js Runtime

BillBridge's frontend has no API routes, no dynamic route segments and no `next/headers` usage — every
screen is a client component that talks to the backend directly via `NEXT_PUBLIC_API_URL`. That makes it
eligible for `output: 'export'` (plain static HTML/JS), which is simpler and more robust on Netlify than
the serverless Next.js Runtime. The flag is opt-in (`STATIC_EXPORT=1`, set only in `netlify.toml`) so local
`npm run dev` / `make demo` keep using the normal Next.js dev/standalone server.

```bash
# redeploy after a frontend change
npm run build --workspace frontend              # STATIC_EXPORT=1 is only set by netlify.toml;
STATIC_EXPORT=1 npm run build --workspace frontend   # set it by hand for a local static-export test
npx netlify-cli deploy --prod --dir=frontend/out --filter "@billbridge/frontend"
```

## Backend — not deployed to Netlify (by design, not an oversight)

The backend is a stateful, long-running Fastify process:
- **SQLite** (Prisma) for users, UPI log, reservations, event/anomaly mirrors.
- **MockLedger** persisted as a JSON file on disk (`.data/ledger.json`) — the ledger's entire state.
- **SSE** (`/api/platform/audit/stream`) — long-lived HTTP connections for the live audit feed.
- **File uploads** written to local disk.

None of that fits Netlify Functions (ephemeral filesystem, short execution limits, no long-lived
connections). Running it there would mean the ledger resets on every cold start — i.e. a demo that silently
loses all state. That would be worse than being honest about the limitation, so it stays off Netlify.

**Today:** the deployed frontend's `NEXT_PUBLIC_API_URL` must point at a backend you run yourself —
`make demo` locally (see root `README.md`), or any host that gives the backend a persistent disk and a
long-running process (Render, Railway, Fly.io, a VM, etc.). The Netlify build does not bake in a live
backend URL by default; set it as a Netlify environment variable (`NEXT_PUBLIC_API_URL`) and redeploy once
you have one running, or keep demoing against `localhost:4000` as this project has throughout.

**Real Fabric/Drunix:** same story as the backend's ledger mode generally — see `docs/DRUNIX_NOTES.md`.
`LEDGER_MODE=auto` tries a live network and falls back to the mock; it needs Docker with a Fabric/Drunix
network reachable from wherever the backend runs.

## Gemini API key

Set `GEMINI_API_KEY` in `.env` (never committed — `.env` is gitignored, `.env.example` documents every var).
`GEMINI_MODEL` defaults to `gemini-3.5-flash` (the spec's original default, `gemini-2.5-flash`, now returns
`404 This model ... is no longer available to new users` for new API keys — Google's own error message
points at `gemini-3.8-flash`, but that model returned connection timeouts on repeated testing here, likely a
new/overloaded preview model; `gemini-3.5-flash` was the first consistently-responsive option tried).
The client retries once on a transient `503 UNAVAILABLE` ("high demand … usually temporary") within the
existing timeout budget before falling back to the deterministic PDF-heuristics extractor — confirmed live
end to end (`source: "GEMINI", confidence: 100` on a successful call; graceful `source: "FALLBACK"` the rest
of the time this key hit Gemini's free-tier rate limit during testing). Both paths are fully functional and
exercised by `backend/test/extract-samples.test.ts` / `postprocess.test.ts`.
