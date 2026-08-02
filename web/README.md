# White-label web (Supabase-only)

React + TypeScript SPA. Backend is **Supabase** (Auth, Postgres/RLS, Edge Functions) — no Node HTTP API.

## Setup

1. Copy `.env.example` to `.env` and set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_TENANT_BASE_DOMAIN`
   - `VITE_DEPLOYMENT_DNS_TARGET` (Master handoff CNAME target)
2. Apply migrations and deploy Edge Functions (`transfer-actions`, `admin-ops`, `master-deploy`).
3. `npm run dev` from this folder (or `npm run dev` from the repo root).

## Scripts

- `npm run dev` — Vite
- `npm run build` — production build
- `npm test` — Vitest (mocked `api`; no live Supabase required)

## Architecture

- Auth: Supabase Auth (browser session)
- Session / branding / master tenant CRUD: RPCs (`get_my_session`, `get_tenant_public_config`, `master_*`)
- Reads: PostgREST + RLS
- Privileged writes: Edge Functions (transfers, funding, admin provision, Netlify DNS)
- Client facade: `src/api/endpoints.ts` (same method names the UI already uses)

Never put `SUPABASE_SERVICE_ROLE_KEY`, Netlify tokens, or verification peppers in `VITE_*`.
