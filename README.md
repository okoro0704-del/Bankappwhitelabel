# White-label bank app (Supabase-only)

One shared React SPA on Netlify. **Supabase** is Auth, Postgres (RLS), and Edge Functions. There is no Node/Railway API.

## Architecture

```text
Browser (Netlify)
  ├─ Supabase Auth (anon key)
  ├─ Postgres reads via RLS
  └─ Edge Functions (service role) for transfers, funding, admin provision, Netlify DNS
```

## Quick start

1. Create a Supabase project and run migrations: `npx supabase db push` (or link + push).
2. Deploy Edge Functions: `npx supabase functions deploy transfer-actions admin-ops master-deploy`
3. Set Edge secrets: `VERIFICATION_CODE_PEPPER`, `TENANT_BASE_DOMAIN`, `DEPLOYMENT_DNS_TARGET`, optional `NETLIFY_AUTH_TOKEN` + `NETLIFY_SITE_ID`
4. Copy `web/.env.example` → `web/.env` with `VITE_SUPABASE_*` and `VITE_TENANT_BASE_DOMAIN`
5. `npm --prefix web install && npm run dev`
6. Promote a Web Finance (Master) Admin: insert into `master_admins` (see `supabase/seed_master_admin.sql`)

## Netlify

- Publish `web/dist` (see `netlify.toml`)
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TENANT_BASE_DOMAIN`, `VITE_DEPLOYMENT_DNS_TARGET`
- Never put service role / Netlify token / pepper in Netlify env as `VITE_*`

## Security

- Service role and peppers stay in Supabase Edge secrets only
- Tenant isolation via `tenant_id` + RLS + Edge actor checks
- Public branding via `get_tenant_public_config(subdomain)` for **active** tenants only

## Docs

- `docs/API.md` — client + RPC + Edge contract
- `docs/QA.md` — deploy checklist
- `docs/TENANT_ARCHITECTURE.md` — white-label model
