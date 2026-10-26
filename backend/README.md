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

## Express server (Node backend)

A real Node/Express backend now lives in `backend/server/`. Its job is to give
the dashboard an authoritative, server-side confirmation of login status, which
satisfies the "confirm the user before rendering protected UI" requirement
without trusting localStorage alone.

```bash
cd backend/server
cp .env.example .env   # set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + APP_ORIGIN
npm install
npm start              # or npm run dev
```

Endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness + whether auth is configured |
| GET | `/api/config` | Public, non-secret app constants |
| POST | `/api/auth/session` | body `{ token }` → verifies the Supabase access token server-side and returns `{ authenticated, user }` |
| * | `/api/*` | 404 for unmatched API routes |

The frontend can call `/api/auth/session` by setting
`window.AnvayraServerSessionUrl` (scroll to the top of
`frontend/assets/js/auth.js`). When set, the dashboard confirms the session with
the Express server and signs the user out only if the server explicitly rejects
the token. When empty (default), it relies on Supabase `getUser`, which is still
real server-side authentication — so the app works with or without the Express
host. The service-role key and WhatsApp token must stay server-side only.

## Note on Node/Express vs serverless

Login is handled by **Supabase Auth**; the Express server above *adds* a proper
Node backend for session confirmation. The Supabase Edge Functions (below) cover
the WhatsApp operations. Together they mean the backend is real server code — it is
just split across Supabase serverless and this optional Express host rather than a
single long-running process. You do not need both; either works.

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
reviewers can be bounced to `localhost:3000` after Google sign-in. This is a
project setting, not application code — set it in the dashboard (see above).

## Note on Node/Express

The Express server above ("Express server (Node backend)") is the Node backend;
Supabase Auth is the identity store. Both are on this machine's `backend/`. The
Supabase serverless functions handle the WhatsApp operations. This Express host is
optional and can be deployed on Vercel-as-a-function or a VPS.
