# Northline — Fictional Bank App

Backend + frontend for a small fictional financial application (about 100 users per instance). Stack: TypeScript, Node.js, Supabase Auth/PostgreSQL, Vite + React.

This application does **not** process real money and does **not** connect to real banks or payment processors.

## Run locally

### 1. Install dependencies

```bash
npm install
npm --prefix web install
```

### 2. Configure Supabase

Create a Supabase project. Copy the project URL, anon key, and service-role key from the dashboard.

### 3. Apply migrations

```bash
# With Supabase CLI linked to your project
npm run db:push
# or: supabase db push
```

Migration order (applied automatically by timestamp):

1. `20260730000000_initial_schema.sql`
2. `20260730170000_auth_profiles_accounts.sql`
3. `20260731090000_wallets_transactions_ledger.sql`
4. `20260731120000_transfer_engine.sql`
5. `20260731180000_tenant_architecture.sql` — tenants, branding, master admins, profile.tenant_id
6. `20260731190000_tenant_isolation.sql` — tenant_id on financial tables, tenant-scoped RLS

### 4. Configure server environment

```bash
cp .env.example .env
```

Set at least:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `PORT` (default `3000`)
- `VERIFICATION_CODE_PEPPER` (recommended)
- `INITIAL_ADMIN_*` for first admin bootstrap
- `CORS_ORIGIN` — leave empty when using the Vite proxy; set to your frontend origin(s) for production cross-origin API access

Never put the service-role key in `web/.env`.

### 5. Configure frontend environment

```bash
cp web/.env.example web/.env
```

Set only client-safe values:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL` — leave empty for local Vite proxy to `http://localhost:3000`

### 6. Create initial admin

```bash
npm run setup:initial-admin
```

### 7. Start API

```bash
npm run dev
```

### 8. Start frontend

```bash
npm run dev:web
```

Open http://localhost:5173 — Vite proxies `/api` and `/health` to the API.

### 9. Run tests

```bash
npm test
npm run test:web
```

Optional live Supabase integration (requires a real project + admin credentials):

```bash
# PowerShell
$env:RUN_SUPABASE_INTEGRATION="1"
$env:INTEGRATION_ADMIN_EMAIL="admin@example.com"
$env:INTEGRATION_ADMIN_PASSWORD="your-dev-admin-password"
npm test
```

### 10. Build production artifacts

```bash
npm run build
npm run build:web
```

API start (compiled): `npm start`  
Frontend output: `web/dist` (static hosting)

## Production architecture

```text
Browser
  └─ Vite/React static build (web/dist)
       ├─ Supabase Auth (anon key only)
       └─ HTTPS API (Authorization: Bearer <access_token>)
            └─ Node HTTP API server (this repo)
                 ├─ Supabase Auth validation (anon + user JWT)
                 └─ Supabase Postgres (service role only on server)
```

- Frontend may only embed `VITE_SUPABASE_*` anon/public values and `VITE_API_BASE_URL`.
- `SUPABASE_SERVICE_ROLE_KEY`, bootstrap passwords, and verification pepper stay on the API host.
- Set `CORS_ORIGIN` to the exact static-site origin(s). Do not use `*`.
- Local development can omit `CORS_ORIGIN` and use the Vite proxy.

## Scope

Implemented:

- Supabase Auth, roles, profiles, accounts (three types), wallets, ledger
- Admin funding, transfer engine, four-stage verification, idempotency, RLS
- Thin Node HTTP API + frozen contract in `docs/API.md`
- Northline React app (user + admin + transfer/verification UI)
- Automated backend and frontend tests
- **White-label Phase 1–2:** tenants, branding, Master Admin, TenantResolver, Master API, public tenant config, financial tenant isolation (see `docs/TENANT_ARCHITECTURE.md`)
- **White-label Phase 3:** Master Admin Dashboard UI at `/master/*` (tenant create/manage/branding)
- **White-label Phase 4:** runtime tenant branding — one customer build applies `/api/tenant/config` (name, logo, colors, login copy, favicon, document title)

Not in scope (yet):

- Real OTP SMS/email delivery
- Real bank / payment integrations
- DNS / Netlify / deployment automation for per-tenant hosts
- Owner invitation / email provisioning for tenant owners
- Production cloud deployment (document only)

## Tech stack

- Node.js + TypeScript (API)
- Supabase (Auth + PostgreSQL + RLS)
- Pino logging
- Vite + React 19 + TypeScript (UI in `web/`)

## Project structure

```text
src/                      # API server
web/                      # Northline frontend
docs/API.md               # Frozen API contract
supabase/migrations/      # Database migrations
tests/                    # Backend tests
```

## Environment variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

### Client-safe (also mirrored for Vite as `VITE_*`)

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

### Server-only (never expose to browsers)

- `SUPABASE_SERVICE_ROLE_KEY`
- `INITIAL_ADMIN_*`
- `VERIFICATION_CODE_PEPPER`
- `ALLOW_VERIFICATION_CODE_PEEK` (dev only; blocked when `NODE_ENV=production`)

### Application

- `LOG_LEVEL`
- `NODE_ENV`
- `PORT` (API server, default `3000`)
- `CORS_ORIGIN` (comma-separated frontend origins for cross-origin API access)
- `TENANT_DEV_DEFAULT_SLUG` (optional; default `northline` for local tenant resolution)
- `ALLOW_DEV_TENANT_HEADER` (dev only; must be `true` to honor `X-Tenant-Slug`; blocked conceptually in production by resolver)

### Initial admin bootstrap (server-only)

- `INITIAL_ADMIN_EMAIL`
- `INITIAL_ADMIN_PASSWORD`
- `INITIAL_ADMIN_FIRST_NAME` (optional, default `Admin`)
- `INITIAL_ADMIN_LAST_NAME` (optional, default `User`)
- `INITIAL_ADMIN_USERNAME` (optional, default `admin`)
- `INITIAL_ADMIN_PHONE` (optional)
- `INITIAL_ADMIN_ACCOUNT_TYPE` (optional, default `escrow`)
- `INITIAL_ADMIN_ACCOUNT_NUMBER` (optional; auto-generated when omitted)

Do not commit real passwords or service-role keys.

## Migrations

Apply with the Supabase CLI:

```bash
npm run db:push
# or
supabase db push
```

Migration order:

1. `20260730000000_initial_schema.sql` — enums, helpers, Prompt 1 placeholders
2. `20260730170000_auth_profiles_accounts.sql` — profiles, accounts, RLS, privilege triggers, account-number helper
3. `20260731090000_wallets_transactions_ledger.sql` — wallets, transactions, atomic funding, ledger RLS
4. `20260731120000_transfer_engine.sql` — transfers, verification codes, atomic debit, one-time guard
5. `20260731180000_tenant_architecture.sql` — tenants, branding, master_admins, profiles.tenant_id, Northline seed

White-label architecture details: **[docs/TENANT_ARCHITECTURE.md](docs/TENANT_ARCHITECTURE.md)**

## Authentication architecture

- Supabase Auth is the only credential store. Passwords are never stored in application tables.
- Backend services use:
  - anon key + user JWT for user-scoped operations
  - service-role key only on the server for provisioning and admin writes
- `AuthService` supports:
  - `signIn`
  - `signOut`
  - `getUserFromAccessToken`
  - `requestPasswordReset`
  - admin Auth user create/delete used by provisioning

## Role architecture

Tenant-level roles (unchanged):

| Role | Capabilities |
|------|----------------|
| `user` | Read/update own permitted profile fields; read own account, wallet, and transactions |
| `admin` | Provision users, list/search profiles and accounts, update statuses, fund wallets **within the tenant application** |

Platform-level privilege (Phase 1):

| Privilege | Storage | Capabilities |
|-----------|---------|--------------|
| Master Admin | `master_admins.user_id` | Manage tenants/branding via `/api/master/*` |

Master Admin is **not** an `app_role` value. Tenant Admin does not imply Master Admin. Tenant ownership (`tenants.owner_user_id`) does not imply Master Admin.

Role / master membership is resolved from the database after Auth succeeds. Client-supplied role values are never trusted for authorization.

Users cannot change their own role. Ordinary users cannot promote themselves. Protected column changes are blocked by RLS policies and database triggers unless the caller is the service role.

## User provisioning flow

Admin-only `UserProvisioningService.provisionUser()`:

1. Validate input (names, email, username, phone, account type, optional account number).
2. Reject duplicate email / username / account number.
3. Create Supabase Auth identity (service role).
4. Create `profiles` row with role `user`.
5. Create `accounts` row with type + unique account number.
6. Create a zero-balance `wallets` row for the account.
7. Optionally fund the wallet when `initialBalance > 0` (atomic funding + ledger row).
8. If database steps fail after Auth creation, delete the Auth user (compensating cleanup).

### Transaction safety note

Auth and PostgreSQL are separate systems, so a single SQL transaction cannot cover both. This backend uses create-then-compensate cleanup: Auth user creation is reversed if profile/account/wallet persistence fails.

Wallet funding itself is atomic inside PostgreSQL via `fund_wallet_atomic`.

## Wallets and ledger

### Wallets

- One wallet per application account (`wallets.account_id` unique)
- `balance numeric(18,2)` with `balance >= 0`
- Created at provisioning with zero balance
- Clients cannot insert/update/delete wallets; balance changes only through trusted server/DB paths

### Transactions (ledger)

Enums:

- `transaction_type`: `funding` | `debit` | `credit`
- `transaction_status`: `pending` | `completed` | `failed`

Each ledger row stores:

- amount, balance_before, balance_after
- unique `reference`
- optional unique `idempotency_key`
- wallet/account linkage, description, metadata, created_by

Only `funding` is written by application code in this step. `debit` / `credit` exist for later transfer work.

### Admin fictional funding

`TransactionService.fundWallet()` (admin-only):

1. Validate amount (> 0, max 2 decimal places), reference, optional idempotency key.
2. Resolve wallet by `walletId` or `accountId`.
3. Call `fund_wallet_atomic` (row lock → balance update → transaction insert).
4. Replaying the same `idempotency_key` or `reference` returns the original funding result without double-crediting.

This is fictional application money only — no payment processor or bank integration.

## Transfer engine

`TransferService.initiateTransfer(actor, input)` accepts recipient fields, amount, description, and `idempotencyKey`. Sender identity, account type, balance, and status are resolved server-side from the authenticated actor — never from client-supplied sender IDs.

### Account-type rules

| Account type | Behavior |
|--------------|----------|
| `escrow` | External transfers restricted. No debit. Result `status: restricted` / `EXTERNAL_TRANSFER_NOT_ALLOWED`. |
| `one_time_transfer` | Exactly one successful external transfer. Enforced with `accounts.one_time_transfer_used` compare-and-set inside `complete_transfer_debit_atomic`. Later attempts fail without debit (`TRANSFER_LIMIT_REACHED`). |
| `four_stage_verification` | Starts at stage 1. Stages 1→4 must be verified in order. Debit happens only in `completeFourStageTransfer` after `stages_completed = 4`. |

### Structured results

- `completed` — transferId, transactionId, reference, amount
- `restricted` — reasonCode `EXTERNAL_TRANSFER_NOT_ALLOWED`
- `failed` — machine-readable reasonCode + user-safe reason
- `verification_required` — current stage (1–4)

### Atomic debit

`debit_wallet_atomic` / `complete_transfer_debit_atomic` lock the wallet, check balance, debit, write a `debit` ledger row, and update transfer status in one DB transaction. Negative balances are rejected.

### Verification codes

- Six-digit codes generated server-side
- SHA-256 hashes stored (peppered); plaintext only in `transfer_verification_code_reveals` (service-role / admin peek)
- Expiration, attempt limits, single-use consumption
- Stages cannot be skipped
- Admin peek: `VerificationService.peekVerificationCodeForTesting` requires admin + `ALLOW_VERIFICATION_CODE_PEEK=true` (or non-production)

### Idempotency

Unique `transfers.idempotency_key`. Replays return the original structured result without a second debit.

## Account-number generation

- Format: 10-digit fictional identifier (`1000000000`–`9999999999`)
- Generated server-side with `crypto.randomInt` (Node) / `gen_random_bytes` (SQL helper)
- Uniqueness enforced by a database unique constraint
- Collision retries are handled in the account repository
- Admins may optionally supply a custom fictional number (still uniqueness-checked)
- The number is an application identifier only, not a real bank account

## Account types

PostgreSQL enum `account_type`:

- `escrow` — external transfers disallowed (behavior later)
- `one_time_transfer` — first external transfer only (behavior later)
- `four_stage_verification` — staged verification path (behavior later)

Only the type is stored now. Transfer behavior is out of scope.

## User / account status

Enum `account_status`: `active` | `suspended`

`requireActiveAccount()` rejects suspended actors so later protected actions (transfers, funding) can reuse the same gate.

## Row Level Security

RLS is enabled on `profiles`, `accounts`, `wallets`, `transactions`, `transfers`, and verification tables.

Users can:

- `SELECT` their own profile, account, wallet, transactions, and transfers
- `UPDATE` limited profile fields (`first_name`, `last_name`, `phone`, `username`)
- `SELECT` limited verification metadata for own transfers (not code hashes / plaintext)

Users cannot:

- Read another user's financial or transfer records
- Insert/update/delete wallets, ledger rows, transfers, or verification records
- Change balances, stages, statuses, hashes, or account type

Privileged mutations use the service-role client and SECURITY DEFINER RPCs (`fund_wallet_atomic`, `debit_wallet_atomic`, `complete_transfer_debit_atomic`).

## Initial admin setup

There is no public registration endpoint that grants `admin`.

1. Set the `INITIAL_ADMIN_*` variables in `.env`.
2. Apply migrations.
3. Run:

```bash
npm run setup:initial-admin
```

The command refuses to run if an admin already exists.

## Development commands

```bash
npm run build
npm run dev
npm run start
npm run setup:initial-admin
npm test
```

## HTTP API layer

The project previously exposed domain logic only via service imports. This step adds a thin API boundary using Node's built-in `http` module (no Express/Fastify).

Start:

```bash
npm run dev
# or
npm run build && npm start
```

Authenticate with:

```http
Authorization: Bearer <supabase_access_token>
```

Identity, role, account type, and balance are never trusted from the request body.

### User endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/session` | Current authenticated app user |
| GET | `/api/me/profile` | Current profile |
| GET | `/api/me/account` | Account + balance |
| GET | `/api/me/wallet` | Wallet |
| GET | `/api/me/transactions?limit&offset` | Recent transactions |
| GET | `/api/transactions/:id` | Transaction detail |
| GET | `/api/me/transfers?limit&offset` | Own transfers |
| POST | `/api/transfers` | Create transfer (`idempotencyKey` required) |
| GET | `/api/transfers/:id` | Transfer detail |
| GET | `/api/transfers/:id/verification` | Current verification stage (+ expiresAt) |
| POST | `/api/transfers/:id/verification` | Submit verification code |
| POST | `/api/transfers/:id/complete` | Complete four-stage transfer after stage 4 |

### Admin endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/admin/users` | Provision user |
| GET | `/api/admin/users` | List users |
| GET | `/api/admin/users/:id` | User detail |
| PATCH | `/api/admin/profiles/:id/status` | Suspend/activate |
| PATCH | `/api/admin/profiles/:id` | Update allowed profile fields |
| POST | `/api/admin/wallets/fund` | Fund wallet |
| GET | `/api/admin/wallets/:id` | Get wallet |
| GET | `/api/admin/transactions` | List transactions |
| GET | `/api/admin/transfers` | List transfers |
| GET | `/api/admin/transfers/:id` | Transfer detail |

### Master / tenant endpoints (Phase 1)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/tenant/config` | Public branding for server-resolved tenant |
| GET | `/api/master/tenants` | List tenants (Master Admin) |
| POST | `/api/master/tenants` | Create tenant (Master Admin) |
| GET | `/api/master/tenants/:id` | Tenant detail (Master Admin) |
| PATCH | `/api/master/tenants/:id` | Update tenant/branding (Master Admin) |
| POST | `/api/master/tenants/:id/activate` | Activate (Master Admin) |
| POST | `/api/master/tenants/:id/deactivate` | Deactivate (Master Admin) |

### Development-only verification peek

```http
GET /api/dev/transfers/:id/verification-code?stage=1
```

Requires **all** of:

1. Authenticated admin
2. `ALLOW_VERIFICATION_CODE_PEEK=true`
3. `NODE_ENV` is not `production`

Not part of normal user transfer APIs. Never returns hashes on user routes.

### Frozen API contract

See **[docs/API.md](docs/API.md)** for the frozen request/response contract, including the **Frontend Integration Contract**.

## Frontend Integration Contract

Summary for frontend authors (full detail in `docs/API.md`):

- **Base URL:** `http://localhost:3000` (or your deployed API origin)
- **Auth header:** `Authorization: Bearer <supabase_access_token>`
- **Success:** `{ "data": ... }`
- **Error:** `{ "error": { "code": "...", "message": "..." } }`
- **User routes:** `/api/session`, `/api/me/*`, `/api/transfers`, `/api/transactions/:id`
- **Admin routes:** `/api/admin/*` (server-enforced admin role)
- **Transfer statuses returned by create/verify:** `completed` | `restricted` | `failed` | `verification_required`
- **Account types:** `escrow` | `one_time_transfer` | `four_stage_verification`
- Never trust client-supplied role/accountType/balance; never expect verification hashes in user responses

This application does not connect to real banks or payment networks and does not move real money.

## Testing

```bash
npm test
```

Unit/security/API/workflow tests cover:

- Config separation (anon vs service role)
- Account-type / role / transaction constants
- Validation rules (including funding amounts and references)
- Authorization helpers (admin / user / suspended)
- Service-layer security (cross-user access, provisioning restrictions)
- Wallet creation/access authorization
- Admin funding authorization, atomic funding call path, idempotent replay
- Transfer engine (escrow / one-time / four-stage / verification / idempotency)
- API contracts, unauthenticated access, error mapping
- End-to-end workflow A/B/C (escrow, one-time, four-stage)
- Migration SQL presence checks for auth, ledger, and transfer layers

Optional live Supabase integration tests:

```bash
# PowerShell
$env:RUN_SUPABASE_INTEGRATION="1"
$env:INTEGRATION_ADMIN_EMAIL="admin@example.com"
$env:INTEGRATION_ADMIN_PASSWORD="your-dev-admin-password"
npm test
```

Integration tests exercise Auth sign-in, admin provisioning, duplicate rejection, and RLS denial of protected mutations. They do not disable RLS to pass.

## Security checklist

- [x] RLS enabled on profiles, accounts, wallets, transactions, transfers, verification tables
- [x] Service role server-only (never in Vite env / frontend bundle)
- [x] Admin authorization enforced server-side
- [x] User ownership enforced server-side (IDOR covered by service + RLS tests)
- [x] No client balance / ledger / transfer-state mutation paths
- [x] Verification hashes not returned on user APIs
- [x] Verification plaintext not exposed in normal UI; peek requires admin + flag + non-production
- [x] Safe API error envelope (no SQL/stack in responses)
- [x] CORS origin allow-list via `CORS_ORIGIN` (never `*`)
- [x] Authenticated routes protected in API + frontend route guards
- [x] Idempotency on transfers and funding
- [x] Concurrent one-time transfer protection (DB CAS) covered by tests

## Security reminders

- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only; it is never returned by API responses.
- Do not put production passwords in source control.
- Do not add a client-callable “make me admin” route.
- Suspended users must be blocked by authorization helpers before protected actions.
- Verification-code peek is blocked in production even if the peek flag is set.
- Fresh databases: apply migrations in order with `npm run db:push` / `supabase db push`.
- After building the frontend, scan `web/dist` for accidental service-role or bootstrap secrets before deploy.
