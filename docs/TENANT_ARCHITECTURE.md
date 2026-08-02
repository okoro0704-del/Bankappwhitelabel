# Tenant / White-Label Architecture

This document describes the white-label multi-tenant architecture.

| Status | Meaning |
|--------|---------|
| **Implemented** | Tenant schema, branding, Master Admin, public tenant config RPC, financial isolation, Master Dashboard, runtime branding, deployment metadata, **Supabase Edge** Netlify provision/DNS/SSL |
| **Removed** | Node HTTP API / Railway — browser talks to Supabase Auth + RLS + Edge Functions |

---

## High-level model

```text
MASTER APPLICATION (Master Admins)
        │
        ├── Tenant / Application A  (branded instance)
        ├── Tenant / Application B
        ├── Tenant / Application C
        └── Tenant / Application D
```

Each tenant is one independently branded application instance that reuses the existing banking application functionality.

The **Master Admin application** creates and manages tenants. It is **not** the per-tenant admin dashboard.

---

## Ownership model (Implemented)

```text
Tenant
  ↓
Profile  (tenant_id)
  ↓
Account  (tenant_id)
  ↓
Wallet   (tenant_id)
  ↓
Transactions / Transfers (tenant_id)
  ↓
Verification records (scoped via transfer.tenant_id)
```

| Resource | Owner | Tenant association | Who may read | Who may mutate |
|----------|--------|--------------------|--------------|----------------|
| Profile | Auth user | `profiles.tenant_id` | Self; Tenant Admin (same tenant) | Self (limited fields); Tenant Admin (status); service role |
| Account | Profile | `accounts.tenant_id` | Owner; Tenant Admin (same tenant) | Service role / admin status only |
| Wallet | Account | `wallets.tenant_id` | Owner; Tenant Admin (same tenant) | Funding/debit RPCs (service role) |
| Transaction | Account/Wallet | `transactions.tenant_id` | Owner; Tenant Admin (same tenant) | Atomic RPCs only |
| Transfer | User/Account | `transfers.tenant_id` | Owner; Tenant Admin (same tenant) | Transfer engine (service role) |
| Verification codes | Transfer | Via `transfers.tenant_id` | Owner (metadata); Tenant Admin (same tenant) | Service role |

Cross-tenant access fails as **NOT FOUND** (does not leak whether the foreign resource exists).

---

## Roles & authentication

### Master Admin authentication (Implemented)

```text
Supabase Auth
      ↓
authenticated user (JWT)
      ↓
master_admins membership?
      ├── yes → Master Admin (platform tenant configuration only)
      └── no  → normal application authorization via profiles.role + profiles.tenant_id
```

- No second password store, JWT system, or auth provider.
- Master Admin does **not** automatically become Tenant Admin of every tenant.
- Master API scope remains narrow: tenant create/list/update/activate/deactivate.

### Tenant Admin (Implemented)

`profiles.role = 'admin'` **and** `profiles.tenant_id = T`.

May manage only users/accounts/wallets/transactions/transfers for tenant `T`.

### Normal User (Implemented)

`profiles.role = 'user'` within a single tenant.

### Owner

`tenants.owner_user_id` is a business association only — not Master Admin and not automatic Tenant Admin.

---

## Authorization context (Implemented)

Server-resolved (never trusted from request body):

```text
userId
role              # tenant role: admin | user
tenantId          # profiles.tenant_id
isMasterAdmin     # master_admins membership
accountStatus
```

Helpers:

- `requireActorTenantId`
- `requireTenantAdmin`
- `assertSameTenant`
- `assertTenantResourceAccess`

Client-supplied `tenantId`, `role`, `accountType`, or balances are never authoritative.

`X-Tenant-Slug` is a **development resolution** override only (`ALLOW_DEV_TENANT_HEADER=true` and non-production). It never grants membership or bypasses `actor.tenantId` checks on protected APIs.

---

## Tenant isolation strategy

### Phase 1 (foundation)

- `profiles.tenant_id`
- Tenants / branding / master_admins
- TenantResolver + Master API + public config

### Phase 2 (Implemented now)

1. Denormalized `tenant_id` on `accounts`, `wallets`, `transactions`, `transfers` (backfilled from Northline).
2. Insert triggers copy tenant from parent when omitted.
3. Privilege triggers block client changes to `tenant_id`.
4. Atomic funding/debit RPCs copy `wallet.tenant_id` onto new ledger rows.
5. RLS admin policies use `is_tenant_admin(auth.uid(), resource.tenant_id)` instead of global `is_admin`.
6. Repositories filter list/find admin paths by `tenant_id`.
7. Services enforce same-tenant checks on get/mutate/fund/list.

### Security rule

```text
Tenant A → only Tenant A data
Tenant B → only Tenant B data
Master Admin → tenant configuration only
             → does not bypass financial ownership rules
```

---

## Repository / query strategy (Implemented)

Admin lists require tenant id at query time:

```text
listProfiles(tenantId)
listAccounts(tenantId)
listWallets(tenantId)
listAll transactions/transfers(tenantId)
```

Lookups by id for protected operations validate `resource.tenantId === actor.tenantId`.

Provisioning always sets `profile.tenant_id` (and cascading account/wallet) from the **caller’s** tenant context (or Northline for initial bootstrap). Clients cannot choose another tenant.

Funding resolves wallet/account then asserts same tenant before calling `fund_wallet_atomic`.

---

## API endpoint classification (Implemented)

### Public

- `GET /health`
- `GET /api/tenant/config` (hostname/dev resolution; public branding only)

### Authenticated user (own tenant + ownership)

- `/api/session`, `/api/me/*`, `/api/transfers`, `/api/transactions/:id`, verification routes

### Tenant Admin (own tenant only)

- `/api/admin/*`

### Master Admin (platform)

- `/api/master/tenants*`

### Development-only

- `/api/dev/transfers/:id/verification-code` (admin + flags + non-production; still tenant-scoped)

---

## Tenant resolution (Implemented)

`TenantResolver`:

1. Hostname / subdomain → `tenants.subdomain` or `slug`
2. Dev only: `X-Tenant-Slug` when allowed
3. Local default: `TENANT_DEV_DEFAULT_SLUG` (default `northline`)

Unknown tenants → safe not found.

### Planned later

DNS, TLS, edge routing, Netlify automation.

---

## Production topology (Phase 6)

Creating a tenant does **not** create a new application deployment. One frontend build and one API serve every tenant subdomain.

```text
                         Production
                             │
                    yourdomain.com (optional apex)
                             │
                  ┌──────────┴──────────┐
                  │                     │
     bank-a.app.yourdomain.com   bank-b.app.yourdomain.com
                  │                     │
                  └──────────┬──────────┘
                             │
                    Same frontend build
                             │
                       Same API
                             │
                       Supabase
                             │
                    TenantResolver
                   (TENANT_BASE_DOMAIN)
                             │
                 Tenant-specific branding / data
```

Recommended topology:

1. Static frontend (or edge) serves the same SPA on every tenant hostname.
2. API is on a fixed host (e.g. `api.yourdomain.com`) or same-origin via reverse proxy.
3. `CORS_ORIGIN` lists exact Master origins and/or `https://*.{TENANT_BASE_DOMAIN}`.
4. `TENANT_BASE_DOMAIN` is authoritative for hostname **generation and resolution**.
5. DNS CNAME for each `{subdomain}.{TENANT_BASE_DOMAIN}` → `DEPLOYMENT_DNS_TARGET`.

### Hostname resolution hardening

- Only `{label}.{TENANT_BASE_DOMAIN}` (optional `www.` prefix) resolves.
- Attacker hosts like `{label}.evil.com` or `{base}.attacker.com` → not found.
- Production: no `TENANT_DEV_DEFAULT_SLUG` fallback; localhost / missing Host → not found.
- `X-Tenant-Slug` never overrides identity in production (startup refuses `ALLOW_DEV_TENANT_HEADER=true`).

### CORS

- Never `Access-Control-Allow-Origin: *`.
- Allow exact origins and single-label patterns: `https://*.app.example.com`.
- Multi-label hosts (`a.b.app.example.com`) are rejected by the pattern matcher.

### Rate limiting (hosting layer)

Application-level protections today:

- Verification codes: per-code attempt limits (`TOO_MANY_VERIFICATION_ATTEMPTS`).
- Transfer idempotency keys.
- Auth via Supabase (no custom password-spray limiter in-app).

Production should add edge/WAF or API-gateway rate limits for:

- `/api/session`, password reset, public `/api/tenant/config`
- Master write endpoints
- Transfer create / verification submit

Do not change transfer business rules solely to add rate limiting.

### Deployment readiness

`ready` requires verified DNS **and** verified SSL. Creating a tenant or activating it does not invent Ready. Frontend cannot PATCH deployment status.

## Live verification readiness (Phase 8)

Automated tests cover mocked Netlify provisioning, production env guards, CORS tenant patterns, hostname fail-closed behavior, and secret non-exposure.

Live checks that remain **manual / flagged**:

| Check | How | Automated? |
|-------|-----|------------|
| Real Netlify DNS record creation | Master **Provision** on staging/prod | No — mocked in CI |
| Real SSL issuance | Wait + **Verify SSL** after DNS propagates | No |
| Live Supabase Auth + RLS | `RUN_SUPABASE_INTEGRATION=1` | Optional / skipped by default |
| Cross-tenant isolation on live DB | Manual smoke + integration flag | Partial (unit/mocked) |

Production startup (`assertProductionEnvSafety`) requires `CORS_ORIGIN`, Supabase keys, `TENANT_BASE_DOMAIN`, `DEPLOYMENT_DNS_TARGET`, and — when `DEPLOYMENT_PROVIDER=netlify` — `NETLIFY_AUTH_TOKEN` + `NETLIFY_SITE_ID` (rejects placeholder `*.example.com` targets).

See `docs/QA.md` for the full deployment sequence.

## Netlify DNS automation (Phase 7)

One shared Netlify site hosts the white-label frontend for every tenant.

```text
Master Dashboard → POST /api/master/tenants/:id/provision
        ↓
NetlifyDeploymentProvider
        ↓
PATCH site domain_aliases += {subdomain}.{TENANT_BASE_DOMAIN}
        ↓
Netlify DNS CNAME → DEPLOYMENT_DNS_TARGET (usually site.netlify.app)
        ↓
POST /sites/{id}/ssl (Let's Encrypt kickoff)
        ↓
Public DNS + TLS verification
        ↓
ready only when DNS verified AND SSL verified
```

Server-only env:

- `DEPLOYMENT_PROVIDER=netlify` (or auto when token + site id set)
- `NETLIFY_AUTH_TOKEN` — never `VITE_*`
- `NETLIFY_SITE_ID` — shared site only (not client-selectable)
- `NETLIFY_DNS_ZONE_ID` — optional; otherwise resolved from `TENANT_BASE_DOMAIN`
- `TENANT_BASE_DOMAIN` / `DEPLOYMENT_DNS_TARGET` — reused from Phase 5

Manual fallback: `DEPLOYMENT_PROVIDER=manual` keeps Phase 5 verify-only behavior.

Activation remains separate from deployment readiness.

## Branding

Stored in `tenant_branding`. Public config never includes secrets.
Server and client reject `javascript:` / `data:` / non-http(s) logo and favicon URLs; colors must be `#RRGGBB`.

### Runtime customer branding (Phase 4)

```text
hostname → TenantResolver → GET /api/tenant/config → TenantProvider → CSS vars / logo / title / login copy
```

- One Vite build serves every tenant.
- Customer routes are gated until an **active** public config loads.
- Inactive / unknown hosts → application unavailable (no silent Northline fallback in production).
- Local development still uses `TENANT_DEV_DEFAULT_SLUG` (default `northline`) on localhost only.
- Master Dashboard (`/master/*`) is not gated on customer branding.

---

## Northline compatibility

Migration `20260731190000_tenant_isolation.sql` backfills all existing financial rows to Northline (`a0000000-0000-4000-8000-000000000001`). Transfer business rules are unchanged.

---

## Master Dashboard UI (Phase 3)

Frontend routes under `/master/*` (separate from `/app/*` and `/admin/*`):

- `/master` — platform overview (counts from `GET /api/master/tenants`)
- `/master/login` — Master Admin sign-in (Supabase Auth)
- `/master/applications` — tenant list
- `/master/applications/new` — create tenant
- `/master/applications/:tenantId` — detail, activate/deactivate, handoff copy fields
- `/master/applications/:tenantId/branding` — branding editor + live preview

Access requires `GET /api/session` → `isMasterAdmin: true`. Master APIs remain authoritative.
Master Admin is configuration-only — not a tenant financial administrator.

## Deployment / DNS provisioning (Phase 5)

```text
Master creates tenant (inactive)
        ↓
Configure branding + subdomain
        ↓
Server builds hostname = {subdomain}.{TENANT_BASE_DOMAIN}
        ↓
Master shows required CNAME → DEPLOYMENT_DNS_TARGET
        ↓
POST /api/master/tenants/:id/verify-dns
        ↓
ManualDeploymentProvider resolves DNS (no Netlify/Vercel/Cloudflare API)
        ↓
Persists dns_status / ssl_status / deployment_status
        ↓
Master activates tenant when ready (independent of DNS)
        ↓
Customer host → TenantResolver → branded app
```

One customer frontend/backend deployment serves every tenant hostname. DNS/SSL are never reported ready unless verification succeeds.

Environment (server-only):

- `TENANT_BASE_DOMAIN` — e.g. `app.example.com`
- `DEPLOYMENT_DNS_TARGET` — CNAME target for handoff + verification

## What remains out of scope

- DNS / hosting provider automations (Cloudflare, Netlify, Vercel APIs)
- Owner invitation / email provisioning APIs
- Real banks / payment processors
- Broadening Master Admin into financial operations
- Distributed in-app rate limiting (document edge/WAF requirements instead)
