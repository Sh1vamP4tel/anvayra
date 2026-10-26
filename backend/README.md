# Anvayra backend

The server-side API for the Anvayra WhatsApp workspace. No secret key or
WhatsApp token ships to the browser.

## Layout

```
backend/
  supabase/functions/
    wa-webhook/     Meta webhook: verify handshake, signature check, idempotent persistence
    wa-send/        Authenticated send through the WhatsApp Cloud API (vault token)
    wa-connect/     Embedded Signup -> long-lived token -> vault + whatsapp_accounts
    wa-lead/        Public contact-form intake (honeypot + rate limit)
    data-deletion/  Meta Data Deletion callback + status lookup
    health/         Liveness / config probe
```

Each function is a serverless TypeScript module (Deno runtime) deployed to the
Supabase project `nbxsebcrcussmmxismsa`. They are already live at:

```
https://nbxsebcrcussmmxismsa.supabase.co/functions/v1/<name>
```

Database schema, RLS policies, vault helpers and the `public.leads` table live in
the Supabase project (migrations are tracked outside this folder).

## Required secrets (Supabase → Edge Functions → Secrets)

| Secret | Purpose |
| --- | --- |
| `META_APP_SECRET` | Webhook + Data Deletion signature verification |
| `WHATSAPP_SYSTEM_USER_TOKEN` | Permanent System User token used for sends |
| `META_APP_ID` | `1111754955165517` |
| `GRAPH_VERSION` | `v21.0` (optional; defaults to v21.0) |

## Deploy checks

Vercel publishes `frontend/` through `vercel.json` (`buildCommand` → `dist/`).
Before pushing a change to `vercel.json`, run:

```bash
node scripts/check-vercel-routes.mjs
```

It rejects route sources that Vercel's parser refuses (nested regex groups such
as `/assets/(.*\.(js|css))`) and confirms `/docs` and `/backend` are never
published. A rejected pattern blocks the whole deployment.

## Authentication

Login is handled by **Supabase Auth** (email/password + Google OAuth). The
frontend talks to it with the publishable key only; the service role key and the
WhatsApp token never leave the server. Dashboard access is gated before the
workspace renders, so unauthenticated visitors never see protected UI.

For Google OAuth, set in Supabase → Authentication → URL Configuration:

- **Site URL**: `https://anvayra.vercel.app` (or the final production domain)
- **Redirect URLs**: `https://anvayra.vercel.app/**`
- (local development) `http://localhost:3000/**`

If the production origin is missing there, GoTrue falls back to the Site URL and
reviewers can be bounced to `localhost:3000` after Google sign-in.

## Note on Node/Express

The backend is serverless (Supabase Edge Functions) by design: it scales to zero,
keeps secrets encrypted in the platform vault, and needs no separate host. A
separate long-running Express server is not required for this app. If you later
want one (for example to self-host on a VPS), it can proxy the same endpoints —
but it must not replace the vault-backed token flow.
