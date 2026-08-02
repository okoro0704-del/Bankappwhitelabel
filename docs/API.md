# Client / Supabase contract

The Node HTTP API has been removed. The SPA uses:

1. **Supabase Auth** — email/password session
2. **PostgREST + RLS** — profile, account, wallet, transaction, transfer **reads**
3. **RPCs** — `get_my_session`, `get_tenant_public_config`, `master_*` tenant CRUD
4. **Edge Functions** — privileged writes

## Edge Functions

| Function | Actions (JSON `action`) |
|----------|-------------------------|
| `transfer-actions` | `create`, `getVerification`, `submitVerification`, `complete` |
| `admin-ops` | `fundWallet`, `setProfileStatus`, `createUser` |
| `master-deploy` | `provision`, `verifyDns`, `verifySsl`, `getDeployment` |

All require `Authorization: Bearer <user access token>`. Errors: `{ error: { code, message } }`. Success: `{ data: ... }` (camelCase payloads matching the former REST shapes).

## RPCs

| RPC | Caller | Purpose |
|-----|--------|---------|
| `get_my_session()` | authenticated | Session user + `isMasterAdmin` |
| `get_tenant_public_config(p_subdomain)` | anon/authenticated | Active tenant branding |
| `master_list_tenants` / `master_get_tenant` / `master_create_tenant` / `master_update_tenant` / `master_set_tenant_status` / `master_patch_tenant_deployment` | master admin | Platform tenant management |

## Secrets (Edge only)

`SUPABASE_SERVICE_ROLE_KEY` (auto), `VERIFICATION_CODE_PEPPER`, `TENANT_BASE_DOMAIN`, `DEPLOYMENT_DNS_TARGET`, `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`
