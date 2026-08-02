# Migration audit — Supabase-only

## Backend remnants found (pre-fix)

| Item | Status |
|------|--------|
| `src/` Node HTTP API | **Absent** on disk/git |
| `tests/` Node suites | **Absent** on disk/git |
| Dockerfile / railway.toml | **Absent** |
| Root `package-lock.json` (old Node deps) | **Removed** this pass |
| `web/src/api/client.ts` HTTP `apiRequest` | **Removed** this pass |
| `web/README.md` Vite `/api` proxy docs | **Updated** |
| `docs/TENANT_ARCHITECTURE.md` `/api/*` / CORS / TenantResolver | **Updated** |
| `API_UNREACHABLE` / AdminCreateUser copy | **Updated** |

## Frontend operation map (verified)

| UI capability | Mechanism | Server enforcement |
|---------------|-----------|-------------------|
| Sign-in / session | Supabase Auth + `get_my_session` RPC | Profile active + `is_master_admin` |
| Public branding | `get_tenant_public_config` | Active tenants only |
| Me reads | PostgREST + RLS | Ownership / tenant RLS |
| Admin lists | PostgREST + RLS | `is_tenant_admin` |
| Transfers / verify / complete | Edge `transfer-actions` | JWT + tenant + service_role atomics |
| Fund / create user / status | Edge `admin-ops` | JWT + tenant admin + service_role |
| Master tenant CRUD | `master_*` RPCs | `require_master_admin` |
| Netlify provision / DNS / SSL | Edge `master-deploy` | Master + Edge secrets |

## Security invariants retained

- No service role / pepper / Netlify token in `VITE_*`
- Ledger/transfer mutation triggers still require `service_role`
- Edge Functions authenticate the user JWT before elevating
- Client cannot set actor `tenant_id` for money paths

## Not redesigned

UI layouts, transfer account-type rules, and RLS business rules unchanged.
