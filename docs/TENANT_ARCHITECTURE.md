# Tenant / White-Label Architecture

This document describes the white-label multi-tenant architecture.

| Status | Meaning |
|--------|---------|
| **Implemented (Phase 1–4)** | Tenant schema, branding, Master Admin, TenantResolver, Master API, public tenant config, financial `tenant_id` isolation, Master Dashboard UI, **runtime customer branding** via `TenantProvider` + `/api/tenant/config` |
| **Planned later** | DNS, Netlify, deployment automation, edge hostname routing, owner invitation flows |

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

The **Master Admin application** creates and manages tenants. It is **not** the per-tenant admin dashboard (`/api/admin/*`).

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

## Branding

Stored in `tenant_branding`. Public config never includes secrets.

### Runtime customer branding (Phase 4)

```text
hostname → TenantResolver → GET /api/tenant/config → TenantProvider → CSS vars / logo / title / login copy
```

- One Vite build serves every tenant.
- Customer routes are gated until an **active** public config loads.
- Inactive / unknown hosts → application unavailable (no silent Northline fallback in production resolution failures).
- Local development still uses `TENANT_DEV_DEFAULT_SLUG` (default `northline`) when the host has no subdomain label.
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

## What remains out of scope

- DNS / hosting integrations
- Owner invitation / email provisioning APIs
- Real banks / payment processors
- Broadening Master Admin into financial operations
