# Fictional Bank App Backend

Backend for a small fictional financial application (about 100 users per instance). It uses TypeScript, Node.js, Supabase Auth, and PostgreSQL.

This application does **not** process real money and does **not** connect to real banks or payment processors.

## Scope of this step

Implemented:

- Supabase Auth sign-in / sign-out / session lookup / password-reset initiation
- Application roles (`admin`, `user`) enforced server-side and in the database
- Profiles linked to `auth.users`
- Application accounts with unique fictional account numbers and constrained account types
- Admin user provisioning with compensating Auth cleanup
- Controlled initial-admin bootstrap (no public self-promotion endpoint)
- Authorization helpers (`requireAuthenticatedUser`, `requireAdmin`, `requireActiveAccount`)
- Row Level Security plus privilege-protection triggers
- Fictional wallets with non-negative balances
- Ledger `transactions` table with unique references
- Admin-only atomic wallet funding with idempotency
- Server-side transfer engine (escrow / one-time / four-stage)
- Fictional verification codes (hashed, expiring, attempt-limited)
- HTTP API layer (Node `http`, no extra framework) for future frontend consumption
- Standardized API request/response/error contracts
- Automated unit/security/API/workflow tests and optional Supabase integration tests

Not implemented yet:

- Frontend / dashboards / progress UI
- Real OTP delivery (SMS/email)
- Real financial integrations
- Bank / payment-processor connections

## Tech stack

- Node.js + TypeScript
- Supabase (Auth + PostgreSQL + RLS)
- Pino logging

## Project structure

```text
src/
  api/                    # HTTP boundary: contracts, handlers, router, server
  config/                 # Env + Supabase clients (anon vs service role)
  middleware/
    auth/                 # Token → application user resolution
    authorization/        # requireAuthenticatedUser / requireAdmin / requireActiveAccount
  repositories/
    profiles/
    accounts/
    wallets/
    transactions/
    transfers/
  services/
    auth/
    users/                # Profile + provisioning
    accounts/
    wallets/
    transactions/         # Funding + ledger reads
    transfers/            # Transfer engine + verification
  scripts/                # Controlled setup commands
  utils/
supabase/
  migrations/
tests/
```

## Environment variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

### Client-safe

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

### Server-only (never expose to browsers)

- `SUPABASE_SERVICE_ROLE_KEY`

### Application

- `LOG_LEVEL`
- `NODE_ENV`
- `PORT` (API server, default `3000`)
- `VERIFICATION_CODE_PEPPER` (server-only hash pepper)
- `ALLOW_VERIFICATION_CODE_PEEK` (must be exactly `true` for admin/dev peek; default off)

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

Exactly two roles:

| Role | Capabilities |
|------|----------------|
| `user` | Read/update own permitted profile fields; read own account, wallet, and transactions |
| `admin` | Provision users, list/search profiles and accounts, update statuses, fund wallets |

Role is stored on `profiles.role` and resolved from the database after Auth succeeds. Client-supplied role values are never trusted for authorization.

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

### Development-only verification peek

```http
GET /api/dev/transfers/:id/verification-code?stage=1
```

Requires admin + `ALLOW_VERIFICATION_CODE_PEEK=true`. Not part of normal user transfer APIs. Never returns hashes on user routes; never returns plaintext codes from production user endpoints.

### Response shape

Success:

```json
{ "data": { ... } }
```

Error:

```json
{ "error": { "code": "INSUFFICIENT_BALANCE", "message": "..." } }
```

### Transfer idempotency

Every `POST /api/transfers` must include `idempotencyKey` (8–128 chars). Replays return the original logical result and never double-debit.

### Verification API behavior

- User responses include stage/status/expiry only.
- Submitting the correct stage-4 code marks stages complete; the verification endpoint then completes the transfer so the frontend receives an authoritative `completed` result when eligible.
- `POST /api/transfers/:id/complete` remains available for explicit completion/resume.

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

## Security reminders

- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only.
- Do not put production passwords in source control.
- Do not add a client-callable “make me admin” route.
- Suspended users must be blocked by authorization helpers before protected actions.
