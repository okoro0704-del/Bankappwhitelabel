# QA — Supabase-only deploy

## Automated

```bash
npm --prefix web install
npm test
npm run build
```

## Live checklist

1. [ ] Apply migrations (`supabase db push`) including `20260802000000_supabase_only_rpcs.sql`
2. [ ] Deploy Edge Functions: `transfer-actions`, `admin-ops`, `master-deploy`
3. [ ] Set Edge secrets (pepper, tenant base domain, DNS target, optional Netlify)
4. [ ] Seed/create Northline tenant + branding; create Auth users; insert Master into `master_admins`
5. [ ] Netlify env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TENANT_BASE_DOMAIN`, `VITE_DEPLOYMENT_DNS_TARGET`
6. [ ] Open `https://{subdomain}.{TENANT_BASE_DOMAIN}/login` — branding loads via RPC (no Railway)
7. [ ] User transfer (four-stage) completes through Edge Function
8. [ ] Admin fund wallet works
9. [ ] Master create → provision → verify DNS/SSL → activate
10. [ ] Confirm service role / Netlify token **not** in `web/dist`

## Not required

- Railway / Node API / `API_ORIGIN` / `VITE_API_BASE_URL`
