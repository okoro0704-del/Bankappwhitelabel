# Northline web (UI Phase 1)

React + TypeScript frontend for the fictional bank API.

## Setup

1. Copy `.env.example` to `.env` and set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_API_BASE_URL` (leave empty for local Vite proxy)
2. Start the backend API on port 3000.
3. Run `npm run dev` from this folder (or `npm run dev:web` from the repo root).

## Scripts

- `npm run dev` — Vite dev server (proxies `/api` → `http://localhost:3000`)
- `npm run build` — production build
- `npm test` — Vitest unit/UI tests (mocked API; no live Supabase required)

## Architecture

- Auth: Supabase Auth (session in browser storage; passwords never stored by the app)
- Role/account truth: `GET /api/session` and other backend routes
- HTTP: `src/api/client.ts` + `src/api/endpoints.ts` (exact paths from `docs/API.md`)
- Shells: user (`/app/*`) and admin (`/admin/*`)

## Out of scope (later)

Admin polish beyond Phase 1 shells. Real OTP delivery remains backend/ops concern.
