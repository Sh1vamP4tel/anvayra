# Anvayra WhatsApp Platform — Build Plan & Current State

**Last updated:** 27 October 2026
**Repository:** `Sh1vamP4tel/anvayra` (branch `main`)
**Production URL:** `https://anvayra.vercel.app` (final domain pending)
**Supabase project:** `nbxsebcrcussmmxismsa` — `https://nbxsebcrcussmmxismsa.supabase.co`

---

## 1. Objective

Ship a real, App-Review-ready WhatsApp Tech Provider product:

- A public business website with working legal pages and a real contact form.
- Authenticated workspace backed by Postgres, not browser storage.
- Meta Embedded Signup that onboards a client's own WABA and phone number.
- Cloud API sending, webhook receiving, template sync, delivery status and opt-out handling.
- No demo tenants, seeded conversations, simulated replies or shared reviewer credentials.

Every visible account, contact, thread, message, template and automation is real data for the
signed-in workspace. When a workspace has no data, the UI shows an explicit empty state.

---

## 2. Architecture

```
Browser (static frontend on Vercel)
  index.html · login/ · signup/ · dashboard/ · privacy/ · terms/ · data-deletion/
  assets/js/auth.js       session + OAuth
  assets/js/workspace.js  DB-backed workspace, Embedded Signup, sending, template sync
        │
        │ HTTPS + user JWT
        ▼
Supabase project nbxsebcrcussmmxismsa
  Auth .............. email/password + Google OAuth
  Postgres .......... RLS-scoped business data
  Edge Functions .... wa-connect · wa-send · wa-templates · wa-webhook ·
                      wa-lead · data-deletion · health
        │
        │ Graph API v21.0
        ▼
Meta WhatsApp Business Platform
  Embedded Signup · Cloud API · message templates · webhooks
```

Optional Node/Express host lives in `backend/server/` for deployments that need an authoritative
`POST /api/auth/session` check. The static frontend works without it; the dashboard already
validates the session server-side through Supabase Auth.

---

## 3. Repository layout

```
frontend/                    static site published by Vercel
  index.html                 marketing + product explanation
  login/ signup/             authentication screens
  dashboard/                 authenticated workspace (single document, five views)
  privacy/ terms/            legal pages
  data-deletion/             deletion instructions + status lookup entry
  deletion-status/           deletion confirmation-code lookup
  thank-you/ 404.html
  assets/{css,js,img,fonts}/
backend/
  supabase/functions/        Edge Functions (Deno/TypeScript)
  server/                    optional Express session-check service
docs/                        internal documentation — never published
scripts/check-vercel-routes.mjs
vercel.json                  builds frontend/ into dist/
```

`vercel.json` runs:

```bash
rm -rf dist && mkdir -p dist && cp -r frontend/. dist/
```

Only `dist/` is served. `docs/` and `backend/` are not part of the deployment output, and
`/docs/:path*` additionally rewrites to `404.html`.

---

## 4. Data model

| Table | Purpose |
|---|---|
| `profiles` | Display name, business name, contact details per auth user |
| `workspaces` | Tenant boundary; one per customer |
| `workspace_members` | User ↔ workspace membership and role |
| `whatsapp_accounts` | Connected WABA + phone number, status, label; unique `phone_number_id` |
| `contacts` | Per-workspace WhatsApp contacts, consent state, last seen |
| `threads` | Conversation per account + contact, unread count, last message preview |
| `messages` | Inbound/outbound messages, `wamid`, delivery status, error details |
| `message_status_events` | Raw delivered/read/failed status transitions |
| `templates` | Approved/pending templates synced from Meta; unique `(account_id,name,language)` |
| `automations` | Six preference rows per WhatsApp account, auto-created by DB trigger |
| `activity_log` | Workspace-visible operational events |
| `suppressions` | Opt-out / STOP list enforced before marketing sends |
| `webhook_events` | Idempotent raw webhook storage keyed by event |
| `leads` | Public contact-form submissions with consent metadata |
| `rate_limits` | Server-side send/lead throttling counters |
| `deletion_requests` | Data-deletion confirmation codes and status |

### Access rules

- RLS is enabled on all business tables.
- Members can `SELECT` accounts, threads, messages, contacts, templates, automations and
  activity for workspaces they belong to.
- `automations` allows member `UPDATE`; `workspaces` allows admin `UPDATE`.
- The browser cannot `INSERT`/`UPDATE` accounts, threads or messages. Those writes happen only
  inside Edge Functions using the service role.
- Owners get profile + workspace + membership provisioned by the `on_auth_user_created` trigger.
- Creating a WhatsApp account seeds six `automations` rows via a DB trigger.

---

## 5. WhatsApp integration

### 5.1 Constants

| Constant | Value |
|---|---|
| Meta App ID | `1111754955165517` |
| Embedded Signup configuration | `1469679065081628` |
| Business Portfolio ID | `983719140695281` |
| Graph API version | `v21.0` |
| Webhook verify token | `anvayra-meta-verify-1111754955165517` |

### 5.2 `wa-connect`

`POST { code, workspaceId, wabaId?, phoneNumberId?, label? }` with a user JWT.

1. Exchanges the Embedded Signup code with `META_APP_ID` + `META_APP_SECRET`.
2. Upgrades the token to a long-lived token and records granted scopes.
3. Resolves the selected WABA and phone number (explicit Embedded Signup selection first).
4. Subscribes the app to the WABA via `POST /{wabaId}/subscribed_apps`.
5. Stores the token in the server-side vault (`store_wa_token`) and upserts `whatsapp_accounts`.

The browser receives only the WABA ID and Phone Number ID. It never receives the access token.

### 5.3 `wa-send`

`POST { accountId, to, text | templateName, templateLang? }` with a user JWT.

- Verifies workspace membership, connected status and `phone_number_id`.
- Checks `suppressions` and `rate_limits` before calling the Cloud API.
- Sends with the vault token; stores the outbound message and its `wamid`.
- Records failed attempts with Meta's error code and message.

### 5.4 `wa-webhook`

- `GET` performs the `hub.challenge` handshake against `WHATSAPP_VERIFY_TOKEN`.
- `POST` verifies `X-Hub-Signature-256` HMAC-SHA256 using `META_APP_SECRET`.
- Events are stored idempotently in `webhook_events` before processing.
- Inbound messages upsert contacts (without overwriting consent), create/find the thread,
  persist the message and increment unread count.
- STOP / unsubscribe / cancel / end / block sets `contacts.opt_in_state = 'opted_out'` and
  writes a `suppressions` row.
- Delivery statuses update `messages` and append to `message_status_events`.
- Always answers `200` to Meta.

### 5.5 `wa-templates`

`POST { accountId }` with a user JWT. Fetches `/{wabaId}/message_templates` with the vault token,
upserts by `(account_id,name,language)` and deletes rows Meta no longer returns.

### 5.6 Supporting functions

| Function | Auth | Purpose |
|---|---|---|
| `wa-lead` | public, honeypot + rate limit | Contact-form intake into `leads` |
| `data-deletion` | Meta `signed_request` + status lookup | Deletion callback and confirmation codes |
| `health` | public | Liveness + whether server secrets are configured |

---

## 6. Workspace behaviour

- Auth gate runs in `<head>` before `<body>` exists. A visitor without a stored session is
  redirected to `/login/?next=dashboard` before any protected markup can paint.
- Accounts, threads, messages, contacts, templates, automations and activity are loaded from
  Postgres for the signed-in user's workspace.
- The rail lists only real `whatsapp_accounts` rows. An empty workspace shows a "no accounts yet"
  message and a Connect button.
- Templates are never seeded. They appear only after `wa-templates` syncs them from Meta.
- Automation switches are saved account preferences. They do not claim to execute workflows.
- Sending requires a connected account; unconnected accounts show `Setup · Cloud API` and
  disable the composer.
- Dashboard panels scroll independently inside `100dvh`; the page itself does not scroll.

---

## 7. Deployment

### 7.1 Frontend

```bash
cd /home/ronny/Desktop/anvayra
node scripts/check-vercel-routes.mjs
git push origin main
```

Vercel builds `frontend/` into `dist/`. `cleanUrls` serves `/dashboard`, `/login`, `/signup`,
`/thank-you`; legacy `.html` paths rewrite to the clean URLs. `/docs/*` returns 404.

Security headers include CSP, `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy` and `Permissions-Policy`. Asset directories use non-nested cache rules.

### 7.2 Edge Functions

Deploy from `backend/supabase/functions/<name>/index.ts`:

| Function | `verify_jwt` |
|---|---|
| `wa-connect` | `true` |
| `wa-send` | `true` |
| `wa-templates` | `true` |
| `wa-webhook` | `false` (own HMAC verification) |
| `wa-lead` | `false` |
| `data-deletion` | `false` |
| `health` | `false` |

### 7.3 Required secrets

Set in Supabase → Edge Functions → Secrets:

- `META_APP_SECRET`
- `WHATSAPP_SYSTEM_USER_TOKEN` (server-side System User token; never expires in 24 hours)
- `META_APP_ID=1111754955165517`
- `GRAPH_VERSION=v21.0`

`health` reports `appSecretConfigured` and `systemTokenConfigured` so configuration can be
checked without exposing values.

### 7.4 Supabase Auth URL configuration

Set in Supabase → Authentication → URL Configuration:

- Site URL: `https://anvayra.vercel.app`
- Redirect URLs: `https://anvayra.vercel.app/**`, `http://localhost:3000/**`

Without this, Google OAuth falls back to the Site URL and can land on `localhost:3000`.

### 7.5 Meta dashboard

- Webhook callback: `https://nbxsebcrcussmmxismsa.supabase.co/functions/v1/wa-webhook`
- Verify token: `anvayra-meta-verify-1111754955165517`
- Fields: `messages` (add `message_template_status_update` when enabled)
- Data Deletion callback:
  `https://nbxsebcrcussmmxismsa.supabase.co/functions/v1/data-deletion`
- Embedded Signup config `1469679065081628` must allow the production domain.

---

## 8. Current status

### Complete

- Public website, legal pages, contact form, lead intake, 404 handling.
- Real authentication (email/password + Google OAuth) with pre-paint auth gate.
- Postgres-backed workspace across all five views.
- Empty states for accounts, contacts, threads, templates and automations.
- Scroll fix for every dashboard panel at desktop and mobile heights.
- `wa-connect`, `wa-send`, `wa-webhook`, `wa-templates`, `wa-lead`, `data-deletion`, `health`
  implemented and deployed.
- Webhook signature verification, idempotent event storage, STOP suppression.
- Template sync from Meta.
- Removal of placeholder accounts, shared sign-in, seeded conversations, simulated replies and
  placeholder badges.
- Removal of the shared reviewer account; only real customer accounts remain.
- Asset cache-busting (`?v=20261027`).
- Vercel route/header validation script.

### Pending (external inputs)

| Item | Owner | Why it blocks |
|---|---|---|
| `META_APP_SECRET`, `WHATSAPP_SYSTEM_USER_TOKEN` | Owner | Embedded Signup exchange and signed webhooks need them |
| Auth Site URL + Redirect URLs | Owner | Google OAuth currently falls back to Site URL |
| Complete one Embedded Signup | Owner + Eng | Produces the first real WABA/phone row and vault token |
| Real send + inbound reply test | Owner + Eng | Proves the full Cloud API loop |
| Final production domain | Owner | Canonical, sitemap, OAuth redirects, Meta app domains |
| Revoke the leaked OAuth session | Owner | Token was exposed in a pasted callback URL |

---

## 9. Verification

Run before each deploy:

```bash
for f in frontend/assets/js/*.js; do node --check "$f" || exit 1; done
node scripts/check-vercel-routes.mjs
```

Local smoke test:

```bash
python3 -m http.server 3000 --directory frontend
```

| Check | Expected |
|---|---|
| Signed out → `/dashboard/` | Redirect to `/login/?next=dashboard`, no workspace paint |
| Signed in → `/dashboard/` | Splash, then workspace with real data |
| Settings panel at 800 px height | Panel scrolls; page body does not |
| Templates with no account | Sync disabled, explicit empty state |
| Automations with an account | Six rows loaded from Postgres; toggle persists |
| `GET /functions/v1/health` | `200 {ok:true}` with secret status booleans |
| `POST /functions/v1/wa-connect` without JWT | `401` |
| `GET /functions/v1/wa-webhook` wrong token | `403` |
| `/docs/plan.md` on production | `404` |

---

## 10. Known limitations

- No automated browser test suite; checks are manual plus syntax and route validation.
- Retention is stated in the privacy policy but no scheduled purge job runs yet.
- Automation switches store intent only; no workflow engine executes them.
- Coexistence is not enabled; it requires a separate Meta onboarding track.
- The final production domain is not confirmed.
