# Manual QA / live integration checklist (Phase 4)
#
# Live Supabase credentials were not available in the automated environment.
# Run these steps against a real project before production deploy.

## Prerequisites

1. Apply migrations: `npm run db:push`
2. Configure root `.env` and `web/.env` from the examples
3. `npm run setup:initial-admin`
4. Start API (`npm run dev`) and UI (`npm run dev:web`)

## Create test users (admin UI or API)

Using authenticated admin + `POST /api/admin/users` (or Admin → Create user):

| Persona | accountType | Fund wallet |
|---------|-------------|-------------|
| Escrow user | `escrow` | Yes |
| One-time user | `one_time_transfer` | Yes |
| Four-stage user | `four_stage_verification` | Yes |

Funding: Admin → Wallet funding (`POST /api/admin/wallets/fund`).

## Live integration test command

```powershell
$env:RUN_SUPABASE_INTEGRATION="1"
$env:INTEGRATION_ADMIN_EMAIL="admin@example.com"
$env:INTEGRATION_ADMIN_PASSWORD="your-dev-admin-password"
# Ensure SUPABASE_URL / keys are loaded from .env
npm test
```

## Manual E2E matrix

1. Auth — admin → `/admin`, user → `/app`, logout, refresh session, user blocked from `/admin` and `/api/admin/*`
2. Escrow — transfer → restricted UI; balance unchanged
3. One-time — first transfer completes + debit; second fails; balance unchanged on failure
4. Four-stage — stages 1→4 via API codes; single debit; refresh restores stage
5. Failures — wrong/expired/reuse/too-many/skip stage
6. Duplicate confirm clicks — no double debit
7. Admin — create user, fund, inspect tx/transfer details (no hashes)

## Peek codes (dev only)

Only when `ALLOW_VERIFICATION_CODE_PEEK=true` and `NODE_ENV` is not `production`:

`GET /api/dev/transfers/:id/verification-code?stage=N`

Never wire this into the normal user UI.
