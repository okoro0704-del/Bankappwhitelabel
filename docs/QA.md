# Manual QA / live integration checklist

Automated unit/security tests do **not** prove live Netlify DNS, live SSL, or live Supabase hosting.
Mark items **PASS** only after actually running them. Otherwise leave them **NOT VERIFIED**.

## Phase 9 — Live verification results (2026-07-31)

Attempted real infrastructure connection in this workspace.

### Verified live

_None._ Real Supabase and Netlify credentials were not available in this environment.

### Not verified

| Check | Result | Blocker |
|-------|--------|---------|
| Real Supabase connection | **NOT VERIFIED** | No `.env` / `SUPABASE_*` in workspace or process env |
| Migrations applied to live project | **NOT VERIFIED** | Requires linked Supabase project + `npm run db:push` |
| Initial Master Admin bootstrap | **NOT VERIFIED** | Requires `.env` + `npm run setup:initial-admin` |
| Live Supabase integration suite | **NOT VERIFIED** | Skipped (`RUN_SUPABASE_INTEGRATION` unset; no `INTEGRATION_ADMIN_*`) |
| Real Netlify API / site | **NOT VERIFIED** | No `NETLIFY_AUTH_TOKEN` / `NETLIFY_SITE_ID` |
| Parent domain / Netlify DNS | **NOT VERIFIED** | No real `TENANT_BASE_DOMAIN` configured |
| Test tenant Provision (`testtenant`) | **NOT VERIFIED** | Blocked on Netlify + domain |
| Live DNS verification | **NOT VERIFIED** | — |
| Live SSL / HTTPS hostname | **NOT VERIFIED** | — |
| Runtime tenant branding on real host | **NOT VERIFIED** | — |
| Live Auth on tenant hostname | **NOT VERIFIED** | — |
| Two-tenant live isolation | **NOT VERIFIED** | — |
| Production CORS against real origins | **NOT VERIFIED** | No `CORS_ORIGIN` |

### Automated (still green; not live)

| Suite | Result |
|-------|--------|
| `npm test` | See latest run in Phase 9 report |
| `npm run test:web` | See latest run |
| `npm run build` / `build:web` | See latest run |
| `npm run check:live-env` | Reports **NOT READY** until `.env` is filled |

### How to unblock Phase 9

1. `cp .env.example .env` and `cp web/.env.example web/.env`
2. Fill real Supabase + Netlify + domain values (never commit `.env`)
3. `npm run check:live-env` — must report required vars **SET** (not PLACEHOLDER)
4. `npm run db:push`
5. `npm run setup:initial-admin` (+ Master membership)
6. Deploy shared `web/dist` to **one** Netlify site; set `NETLIFY_SITE_ID` + `DEPLOYMENT_DNS_TARGET`
7. Point `TENANT_BASE_DOMAIN` DNS at Netlify; set `DEPLOYMENT_PROVIDER=netlify`
8. Re-run this checklist with Master → create `testtenant` → Provision → Verify DNS/SSL → Activate

**Platform is not production-ready until the Verified live section is filled with actual PASS results.**

## Automated vs live

| Suite | How to run | Status meaning |
|-------|------------|----------------|
| Unit / security | `npm test` + `npm run test:web` | Default CI |
| Live Supabase | `RUN_SUPABASE_INTEGRATION=1` + `INTEGRATION_ADMIN_*` | Skips unless flag set |
| Live Netlify | Manual Master Provision against real site | Not automated |
| Production smoke | Checklist below | Manual |

## Full white-label deployment sequence (Phase 8)

1. Create a Supabase project
2. Apply migrations: `npm run db:push` (includes tenant, isolation, deployment, Netlify metadata)
3. Configure root `.env` (server-only) and `web/.env` (client-safe only)
4. Production server env must include:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `TENANT_BASE_DOMAIN`, `DEPLOYMENT_DNS_TARGET`
   - `CORS_ORIGIN` (exact Master origin and/or `https://*.{TENANT_BASE_DOMAIN}`)
   - `DEPLOYMENT_PROVIDER=netlify`
   - `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID` (optional `NETLIFY_DNS_ZONE_ID`)
   - `ALLOW_DEV_TENANT_HEADER=false`, `ALLOW_VERIFICATION_CODE_PEEK=false`
5. Bootstrap Master/admin: `npm run setup:initial-admin` (and ensure Master membership)
6. Build and deploy the **single** shared frontend to one Netlify site (`npm run build:web` → publish `web/dist`)
7. Configure Netlify DNS for the parent domain (`TENANT_BASE_DOMAIN` zone on Netlify)
8. Set `DEPLOYMENT_DNS_TARGET` to the shared site hostname (e.g. `your-site.netlify.app`)
9. Deploy/start the API with production env (startup validates Netlify + CORS config)
10. Master login → create tenant (starts **inactive**)
11. Configure branding
12. **Provision** hostname (`POST /api/master/tenants/:id/provision`)
13. **Verify DNS** / **Verify SSL** (or Refresh Status)
14. Confirm deployment shows **Ready** only after DNS **and** SSL verification succeed
15. **Activate** tenant (independent of ready)
16. Open tenant login URL `https://{subdomain}.{TENANT_BASE_DOMAIN}/login`
17. Confirm branded login (hostname → TenantResolver → `/api/tenant/config`)
18. Authenticate via Supabase
19. Confirm tenant isolation (cross-tenant admin/financial access denied)
20. Run banking smoke (escrow / one-time / four-stage) on that tenant

## Netlify provisioning notes

- One shared Netlify **site** serves every tenant subdomain (domain aliases + Netlify DNS CNAMEs).
- Provisioning is Master-only and idempotent for matching aliases/records.
- Conflicting DNS values return `DEPLOYMENT_CONFLICT` (no silent overwrite).
- Manual provider (`DEPLOYMENT_PROVIDER=manual`) refuses automated Provision with `DEPLOYMENT_NOT_CONFIGURED`.
- Unit tests mock Netlify — they do **not** prove live DNS/SSL.

## Live Supabase integration command

```powershell
$env:RUN_SUPABASE_INTEGRATION="1"
$env:INTEGRATION_ADMIN_EMAIL="admin@example.com"
$env:INTEGRATION_ADMIN_PASSWORD="your-dev-admin-password"
npm test
```

Do not commit credentials. If unavailable, the suite skips — **NOT VERIFIED**.

## Production smoke-test checklist

1. [ ] Master login
2. [ ] Create tenant
3. [ ] Configure branding
4. [ ] Configure subdomain
5. [ ] Provision via Netlify (Master UI or API)
6. [ ] Verify DNS
7. [ ] Verify SSL (Ready only if DNS+SSL verified)
8. [ ] Activate tenant
9. [ ] Visit tenant hostname
10. [ ] Verify branded login
11. [ ] Sign in as tenant user
12. [ ] Verify tenant dashboard
13. [ ] Verify tenant admin
14. [ ] Verify another tenant cannot access tenant resources
15. [ ] Verify inactive tenant is unavailable
16. [ ] Verify unknown hostname is unavailable
17. [ ] Verify Master remains accessible
18. [ ] Verify service-role / Netlify token not in `web/dist`
19. [ ] Verify production CORS
20. [ ] Verify password reset
21. [ ] Verify transfer workflows

**Do not call the system production-ready until this live checklist is completed.**

## Banking E2E matrix (unchanged)

1. Auth — admin → `/admin`, user → `/app`, logout, refresh session
2. Escrow — restricted UI; balance unchanged
3. One-time — first debit succeeds; second fails
4. Four-stage — stages 1→4; single debit
5. Failures — wrong/expired/reuse/too-many
6. Duplicate confirm clicks — no double debit
7. Admin — create user, fund, inspect details (no hashes)

## Peek codes (dev only)

Only when `ALLOW_VERIFICATION_CODE_PEEK=true` and `NODE_ENV` is not `production`.
Production startup rejects this flag.
