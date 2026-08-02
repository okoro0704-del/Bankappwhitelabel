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

`X-Tenant-Slug` is **removed** from the production path. Public branding uses hostname → `get_tenant_public_config` only. Actor tenant for money ops comes from `profiles.tenant_id`.

---

## Tenant isolation strategy

### Phase 1 (foundation)

- `profiles.tenant_id`
- Tenants / branding / master_admins
- Public branding RPC + Master RPCs / Edge deploy

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

## Client / Supabase contract (Implemented)

### Public

- RPC `get_tenant_public_config(subdomain)` — active tenant branding only
- Localhost / missing label → `VITE_TENANT_DEV_DEFAULT_SLUG` (default `northline`) in Vite DEV only

### Authenticated user (own tenant + ownership via RLS)

- RPC `get_my_session()`
- PostgREST reads: profiles, accounts, wallets, transactions, transfers
- Edge `transfer-actions`: create / verify / complete

### Tenant Admin (own tenant only)

- PostgREST admin list/detail reads (RLS `is_tenant_admin`)
- Edge `admin-ops`: `fundWallet`, `setProfileStatus`, `createUser`

### Master Admin (platform)

- RPCs `master_*` for tenant CRUD / status
- Edge `master-deploy`: provision / verify DNS / SSL

### Removed

- Node `/api/*` HTTP server, Railway, `API_ORIGIN`, Vite `/api` proxy, CORS API gateway

---

## Tenant resolution (Implemented)

Authoritative public branding:

1. Browser extracts label under `VITE_TENANT_BASE_DOMAIN`
2. RPC `get_tenant_public_config` loads **active** tenant + branding (SECURITY DEFINER)
3. Unknown / inactive → not found / unavailable UI

Actor tenant for financial ops comes from `profiles.tenant_id` (JWT user), never from a client-supplied tenant id.

---

## Production topology

Creating a tenant does **not** create a new frontend deployment. One Netlify SPA serves every tenant hostname; Supabase is Auth + DB + Edge Functions.

```text
                         Production
                             │
                  ┌──────────┴──────────┐
     bank-a.{TENANT_BASE_DOMAIN}   bank-b.{TENANT_BASE_DOMAIN}
                  │                     │
                  └──────────┬──────────┘
                             │
                    Same Netlify SPA build
                             │
                    Supabase Auth / DB / Edge
                             │
              get_tenant_public_config(subdomain)
                             │
                 Tenant-specific branding / data
```

Recommended topology:

1. Static frontend on Netlify serves the same SPA on every tenant hostname.
2. Privileged logic runs in Supabase Edge Functions (service role + user JWT checks).
3. `TENANT_BASE_DOMAIN` is authoritative for hostname generation and public config lookup.
4. DNS CNAME for each `{subdomain}.{TENANT_BASE_DOMAIN}` → `DEPLOYMENT_DNS_TARGET` (shared Netlify site).

### Hostname resolution hardening

- Only `{label}.{TENANT_BASE_DOMAIN}` resolves for public branding.
- Attacker hosts like `{label}.evil.com` → no label under base → unavailable.
- Reserved labels (`www`, `api`, `master`, `admin`) rejected client-side.

### Edge secrets (never `VITE_*`)

`VERIFICATION_CODE_PEPPER`, `TENANT_BASE_DOMAIN`, `DEPLOYMENT_DNS_TARGET`, optional `NETLIFY_AUTH_TOKEN` + `NETLIFY_SITE_ID`. Service role is injected by Supabase for Edge Functions.

### Rate limiting / idempotency

- Verification codes: per-code attempt limits (`TOO_MANY_VERIFICATION_ATTEMPTS`).
- Transfer idempotency keys.
- Hosting-layer rate limits (Netlify / Supabase) recommended in production.
- Auth via Supabase (no custom password-spray limiter in-app).

Production should add edge/WAF rate limits for:

- Auth (sign-in / password reset)
- Public branding RPC
- Master write RPCs / Edge deploy
- Transfer create / verification submit

Do not change transfer business rules solely to add rate limiting.

### Deployment readiness

`ready` requires verified DNS **and** verified SSL. Creating a tenant or activating it does not invent Ready. Frontend cannot PATCH deployment status without Master auth (Edge / RPC).

## Live verification readiness

| Check | How | Automated? |
|-------|-----|------------|
| Real Netlify DNS record creation | Master **Provision** (Edge `master-deploy`) | No — manual |
| Real SSL issuance | Wait + **Verify SSL** after DNS propagates | No |
| Live Supabase Auth + RLS | Manual smoke against project | Manual |
| Cross-tenant isolation on live DB | Manual smoke | Manual |

Edge secrets must include `TENANT_BASE_DOMAIN`, `DEPLOYMENT_DNS_TARGET`, and — for Netlify automation — `NETLIFY_AUTH_TOKEN` + `NETLIFY_SITE_ID`.

See `docs/QA.md` for the full deployment sequence.

## Netlify DNS automation

One shared Netlify site hosts the white-label frontend for every tenant.

```text
Master Dashboard → Edge master-deploy action=provision
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

Edge Function secrets:

- `NETLIFY_AUTH_TOKEN` — never `VITE_*`
- `NETLIFY_SITE_ID` — shared site only (not client-selectable)
- `NETLIFY_DNS_ZONE_ID` — optional
- `TENANT_BASE_DOMAIN` / `DEPLOYMENT_DNS_TARGET`

Without Netlify tokens, Master **Provision** returns `DEPLOYMENT_NOT_CONFIGURED`; verify-dns still does public DNS/TLS checks.

Activation remains separate from deployment readiness.

## Branding

Stored in `tenant_branding`. Public config never includes secrets.
Server and client reject `javascript:` / `data:` / non-http(s) logo and favicon URLs; colors must be `#RRGGBB`.

### Runtime customer branding (Phase 4)

```text
hostname → label under VITE_TENANT_BASE_DOMAIN → get_tenant_public_config → TenantProvider → CSS vars / logo / title / login copy
```

- One Vite build serves every tenant.
- Customer routes are gated until an **active** public config loads.
- Inactive / unknown hosts → application unavailable (no silent Northline fallback in production).
- Local development still uses `VITE_TENANT_DEV_DEFAULT_SLUG` (default `northline`) on localhost only.
- Master Dashboard (`/master/*`) is not gated on customer branding.

---

## Northline compatibility

Migration `20260731190000_tenant_isolation.sql` backfills all existing financial rows to Northline (`a0000000-0000-4000-8000-000000000001`). Transfer business rules are unchanged.

---

## Master Dashboard UI (Phase 3)

Frontend routes under `/master/*` (separate from `/app/*` and `/admin/*`):

- `/master` — platform overview (counts from `master_list_tenants` RPC)
- `/master/login` — Master Admin sign-in (Supabase Auth)
- `/master/applications` — tenant list
- `/master/applications/new` — create tenant
- `/master/applications/:tenantId` — detail, activate/deactivate, handoff copy fields
- `/master/applications/:tenantId/branding` — branding editor + live preview

Access requires `get_my_session()` → `isMasterAdmin: true`. Master RPCs / Edge remain authoritative.
Master Admin is configuration-only — not a tenant financial administrator.

## Deployment / DNS provisioning

```text
Master creates tenant (inactive)
        ↓
Configure branding + subdomain
        ↓
Hostname = {subdomain}.{TENANT_BASE_DOMAIN}
        ↓
Master shows required CNAME → DEPLOYMENT_DNS_TARGET
        ↓
Edge master-deploy (provision / verifyDns / verifySsl)
        ↓
Persists dns_status / ssl_status / deployment_status
        ↓
Master activates tenant when ready (independent of DNS)
        ↓
Customer host → get_tenant_public_config → branded app
```

One customer frontend deployment serves every tenant hostname. DNS/SSL are never reported ready unless verification succeeds.

Environment:

- Netlify `VITE_TENANT_BASE_DOMAIN` / `VITE_DEPLOYMENT_DNS_TARGET` (public handoff UI)
- Edge secrets `TENANT_BASE_DOMAIN` / `DEPLOYMENT_DNS_TARGET` (+ Netlify tokens for automation)

## What remains out of scope

- DNS / hosting provider automations (Cloudflare, Netlify, Vercel APIs)
- Owner invitation / email provisioning APIs
- Real banks / payment processors
- Broadening Master Admin into financial operations
- Distributed in-app rate limiting (document edge/WAF requirements instead)
