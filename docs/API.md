# Backend API Contract (Frozen)

This document freezes the HTTP API for frontend integration.

This application is **fictional**. It does **not** connect to real banks or payment networks and does **not** move real money.

Base URL (local default):

```text
http://localhost:3000
```

Authentication header (all authenticated routes):

```http
Authorization: Bearer <supabase_access_token>
```

The backend resolves identity from the Supabase session. Clients must **never** send trusted values for:

- `userId`
- `role`
- `accountType`
- `balance`
- `accountStatus`

Success envelope:

```json
{ "data": { } }
```

Error envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable safe message"
  }
}
```

---

## Frontend Integration Contract

### Required headers

| Header | Value |
|--------|--------|
| `Authorization` | `Bearer <access_token>` |
| `Content-Type` | `application/json` (for POST/PATCH bodies) |

### Account types

| Value | Transfer behavior |
|-------|-------------------|
| `escrow` | External transfers restricted; no debit |
| `one_time_transfer` | Exactly one successful external transfer |
| `four_stage_verification` | Requires stages 1→4 before debit/completion |

### Transfer statuses

`initiated`, `processing`, `verification_stage_1`, `verification_stage_2`, `verification_stage_3`, `verification_stage_4`, `completed`, `failed`, `cancelled`, `restricted`

### Transfer action result statuses

| `status` | Meaning |
|----------|---------|
| `completed` | Transfer finished; wallet debited |
| `restricted` | Escrow block; no debit |
| `failed` | Rejected (e.g. one-time limit); no debit for that attempt |
| `verification_required` | Four-stage flow; see `stage` |

### Verification states

- Stage values: `1` \| `2` \| `3` \| `4`
- Frontend advances only by submitting codes to the API
- Frontend must not invent stage transitions

### Common error codes

`UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `ACCOUNT_NOT_FOUND`, `ACCOUNT_INACTIVE`, `INSUFFICIENT_BALANCE`, `EXTERNAL_TRANSFER_NOT_ALLOWED`, `TRANSFER_LIMIT_REACHED`, `INVALID_TRANSFER`, `VERIFICATION_REQUIRED`, `INVALID_VERIFICATION_CODE`, `VERIFICATION_EXPIRED`, `TOO_MANY_VERIFICATION_ATTEMPTS`, `TRANSFER_ALREADY_COMPLETED`, `DUPLICATE_REQUEST`, `INTERNAL_ERROR`

---

## User API

### `GET /health`

- Auth: none
- Response: `{ "data": { "status": "ok" } }`

### `GET /api/session`

- Auth: required
- Response data: `SessionUserResponse`
  - `userId`, `role`, `accountStatus`, `email`, `username`, `firstName`, `lastName`

### `GET /api/me/profile`

- Auth: required
- Response data: `ProfileResponse`

### `GET /api/me/account`

- Auth: required
- Response data: `AccountResponse`
  - `id`, `accountNumber`, `accountType`, `accountStatus`, `balance`, `currency`, `oneTimeTransferUsed`

### `GET /api/me/wallet`

- Auth: required
- Response data: `WalletResponse`

### `GET /api/me/transactions?limit=&offset=`

- Auth: required
- Query: `limit` (1–100, default 20), `offset` (>=0, default 0)
- Response data: `{ items: TransactionResponse[], limit, offset, total }`

### `GET /api/transactions/:id`

- Auth: required (owner or admin)
- Response data: `TransactionResponse`

### `GET /api/me/transfers?limit=&offset=`

- Auth: required
- Response data: `{ items: TransferResponse[], limit, offset, total }`

### `POST /api/transfers`

- Auth: required + active account
- Body:

```json
{
  "recipientName": "string",
  "recipientAccount": "8-20 digits",
  "recipientBank": "string",
  "amount": 12.34,
  "description": "optional",
  "idempotencyKey": "unique-8-to-128-chars"
}
```

- Response data: `TransferActionResponse`
- Idempotency: repeating the same `idempotencyKey` returns the same logical result (no second debit)

Examples:

Escrow:

```json
{ "data": { "status": "restricted", "reasonCode": "EXTERNAL_TRANSFER_NOT_ALLOWED", "...": "..." } }
```

One-time success:

```json
{ "data": { "status": "completed", "transactionId": "...", "amount": 50 } }
```

Four-stage start:

```json
{ "data": { "status": "verification_required", "stage": 1, "transferId": "..." } }
```

### `GET /api/transfers/:id`

- Auth: required (owner or admin)
- Response data: `TransferResponse`

### `GET /api/transfers/:id/verification`

- Auth: required (owner or admin)
- Response data:

```json
{
  "transferId": "uuid",
  "status": "verification_stage_1",
  "stage": 1,
  "stagesCompleted": 0,
  "expiresAt": "ISO-8601 optional"
}
```

Does **not** return verification hashes or plaintext codes.

### `POST /api/transfers/:id/verification`

- Auth: required + active account + ownership
- Body: `{ "code": "123456" }`
- Response data: `TransferActionResponse`
- Behavior:
  - Correct stage code advances to next stage (`verification_required`, next `stage`)
  - After stage 4 is fully verified, API may return `completed` (authoritative completion)
  - Invalid/expired/reused codes return error codes above

### `POST /api/transfers/:id/complete`

- Auth: required + active account + ownership
- For four-stage transfers after all stages verified
- Response data: `TransferActionResponse` (`completed` or error)

---

## Admin API

All require authenticated **admin** role (resolved server-side).

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/admin/users` | Provision user |
| GET | `/api/admin/users?search=&limit=&offset=` | List users |
| GET | `/api/admin/users/:id` | User detail (`userId`) |
| PATCH | `/api/admin/profiles/:id/status` | Update status `{ "status": "active" \| "suspended" }` |
| PATCH | `/api/admin/profiles/:id` | Update allowed profile fields |
| POST | `/api/admin/wallets/fund` | Fund wallet |
| GET | `/api/admin/wallets/:id` | Wallet detail |
| GET | `/api/admin/transactions?limit=&offset=` | List transactions |
| GET | `/api/admin/transfers?limit=&offset=` | List transfers |
| GET | `/api/admin/transfers/:id` | Transfer detail |

### Admin create user body

```json
{
  "firstName": "Casey",
  "lastName": "User",
  "email": "casey@example.com",
  "username": "casey",
  "phone": "+15551234567",
  "accountType": "escrow",
  "accountNumber": "optional-10-digits",
  "password": "optional",
  "initialBalance": 0
}
```

### Admin fund wallet body

```json
{
  "amount": 100.0,
  "walletId": "uuid-optional",
  "accountId": "uuid-optional",
  "idempotencyKey": "optional",
  "reference": "optional",
  "description": "optional"
}
```

Provide `walletId` or `accountId`.

---

## Development-only verification peek

```http
GET /api/dev/transfers/:id/verification-code?stage=1
```

Requirements (all):

1. Authenticated admin
2. `ALLOW_VERIFICATION_CODE_PEEK=true`
3. `NODE_ENV` is **not** `production`

Returns:

```json
{ "data": { "transferId": "...", "stage": 1, "code": "123456" } }
```

Not part of the normal user product API.

---

## Response type reference

### TransferResponse

```text
id, reference, status, amount,
recipient: { name, account, bank },
description, currentStage, stagesCompleted,
reasonCode, failureReason, createdAt, updatedAt, completedAt
```

### TransferActionResponse

```text
status: completed | restricted | failed | verification_required
transferId?, reference?, amount?, transactionId?, stage?,
reasonCode?, reason?, idempotentReplay?, transfer?
```

### TransactionResponse

```text
id, accountId, walletId, type, status, amount,
balanceBefore, balanceAfter, reference, description, createdAt
```

---

## Notes for frontend authors

1. Always send a new `idempotencyKey` per user-intent transfer attempt; reuse only for safe retries of the same attempt.
2. Do not branch transfer UX from client-side account-type guesses alone; use the API `status` / `reasonCode`.
3. Never display or request verification hashes.
4. Treat API errors by `error.code`, not by parsing message text for control flow.
5. Unsupported methods return `405` / `METHOD_NOT_ALLOWED`.
6. Unknown routes return `404` / `NOT_FOUND`.
