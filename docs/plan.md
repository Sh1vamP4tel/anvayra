# Meta App Verification Website — Build Plan & Result

**Date:** 24 Oct 2026
**Folder:** `/home/ronny/Desktop/meta-app`
**Brand:** Anvayra (operated by Shivam Kushwah)
**Purpose:** A live, review-ready website that proves Anvayra is a real WhatsApp Tech Provider business — not a portfolio mock-up.
**Supabase project:** `nbxsebcrcussmmxismsa` (https://nbxsebcrcussmmxismsa.supabase.co) — production auth + Postgres.

---

## 1. What we are building (and why)

Meta App Review needs to see a **working business product**, not just marketing pages. The reviewer must be able to:

1. Understand what the business does in under 10 seconds.
2. See the WhatsApp product, permissions it uses, and how a client onboards.
3. Open a functional Client Dashboard (Connect WhatsApp, WABA / Phone Number ID, send test message, logs).
4. Read live Privacy Policy, Terms of Service and Data Deletion pages.
5. Find a real business identity: legal name, email, phone, address.

### Design direction (new, not the old portfolio)

- **Brown paper / kraft journal aesthetic** — warm paper texture, serif headlines, ink-brown text, rust accents, thin hand-ruled borders.
- **No background video, no stock photos, no image assets.** Texture and visual interest come from CSS only (paper grain, ruled lines, stamps, tape corners).
- **Fully new CSS** (`assets/css/paper.css`). The old `style.css` is not used or copied.
- **High contrast for review:** deep ink `#2b2117` on cream paper `#f2e7d3`, with WCAG-friendly body text.
- **Simple, predictable structure:** one scrolling home page + dashboard + three legal pages.

---

## 2. File structure

```
meta-app/
  index.html                  → marketing + verification proof
  login.html                  → workspace sign in (demo reviewer account)
  signup.html                 → create a workspace
  dashboard.html              → multi-account workspace (review centrepiece)
  thank-you.html              → form success page
  robots.txt, sitemap.xml
  assets/
    css/paper.css             → complete design system
    css/workspace.css         → auth screens + workspace layout
    css/fonts.css             → self-hosted @font-face (latin subsets)
    fonts/*.woff2             → 14 files, ~460 KB, no external font calls
    js/main.js                → nav, FAQ, form, preview tabs, typewriter
    js/auth.js                → session, demo user, signup / login / logout
    js/workspace.js           → accounts, inbox, send, templates, logs
    img/logo-mark.png, app-icon-1024.png, founder.jpg
  privacy/index.html          → Privacy Policy
  terms/index.html            → Terms of Service
  data-deletion/index.html    → Data Deletion Instructions
  docs/                       → internal briefs + this plan (not linked)
```

All links are relative, so the site works on Vercel, Netlify or any static host.

---

## 3. Content map vs Meta review requirements

| Requirement (info.txt / info2.txt) | Where it is on the new site |
|---|---|
| Clear business name + one-line positioning | Hero: "WhatsApp automation for real businesses" |
| CTAs: Connect WhatsApp / Book Demo / Dashboard | Hero (3 buttons) + nav + closing CTA |
| Services: AI WhatsApp agent, follow-up, reminders, templates, n8n | `#services` — 6 paper cards |
| How it works: connect → number → template → send → track | `#how` — 4 numbered steps |
| Client Dashboard (main review area) | `dashboard.html` — Connect, WABA/Phone ID, send, logs, provider table |
| Permissions explained for reviewers | `#permissions` — messaging / management / business_management |
| Trust pages | `/privacy/`, `/terms/`, `/data-deletion/` |
| Contact with real email, phone, address | `#contact` + footer + thank-you page |
| Consent checkbox for WhatsApp messages | Contact form checkbox (required) |
| Opt-in / STOP handling explained | Security & compliance section + privacy policy |
| Tech Provider proof | "Built on the official WhatsApp Business Platform" + reviewer note block |
| About the business | Founder + legal business details in `#about` |
| FAQ | `#faq` — 6 questions reviewers/clients ask |

---

## 4. n8n backend

**Workflow name:** `meta-app-verification` (new, in teamapexgaming workspace)

Routes:

| Method | Path | Purpose |
|---|---|---|
| GET | `/webhook/meta-app-verification` | Meta webhook verification — validates `hub.verify_token`, echoes `hub.challenge`, 403 on mismatch |
| POST | `/webhook/meta-app-verification` | Receives WhatsApp message + template-status events, normalizes, returns `200 OK` fast |
| POST | `/webhook/meta-app-verification/lead` | Website contact form + consent capture endpoint (validates required fields, returns JSON) |
| GET | `/webhook/meta-app-verification/health` | Public health/readiness JSON for reviewers |

Existing workflows stay untouched:
- `meta-app` (already live) — verification + incoming + **send message** endpoint used by dashboard.
- `Anvayra - Fixed WhatsApp Callback` — Embedded Signup code → token exchange.

**Secrets:** App Secret and access tokens live only in n8n credentials/env. The browser never receives them.

---

## 5. Deploy checklist (10 minutes after build)

1. Upload the `meta-app` folder to Vercel as a new static project (or replace `anvayra`).
2. In `assets/js/workspace.js`, confirm `CONFIG` values:
   - `appId` = `1111754955165517`
   - `configId` = `1469679065081628`
   - `callbackUrl` = `https://teamapexgaming.app.n8n.cloud/webhook/whatsapp-callback`
   - `sendUrl` = `https://teamapexgaming.app.n8n.cloud/webhook/meta-app/send`
   - `healthUrl` = `https://teamapexgaming.app.n8n.cloud/webhook/meta-app-verification/health`
   - `redirectUri` is derived automatically from the deployed domain (`window.location.origin + '/'`).
3. Meta App Dashboard:
   - App Domains: the new deployed domain + `teamapexgaming.app.n8n.cloud`
   - Valid OAuth Redirect URI: new domain (must match the deployed origin)
   - Webhook callback: `https://teamapexgaming.app.n8n.cloud/webhook/meta-app-verification` (or keep `meta-app`)
   - Verify token: `anvayra-meta-verify-1111754955165517`
4. Update the canonical/OG URL in `index.html` to the live domain.
5. Submit for App Review with reviewer steps from section 6.

---

## 6. Reviewer instructions (copy-paste)

1. Open the website home page — services, business details and legal pages are public.
2. Click **Client login** (header or hero) → sign in with:
   - Email: `demo@anvayra.app`
   - Password: `anvayra2026`
   (or click “Fill demo credentials” on the login screen)
3. The workspace opens with **5 WhatsApp accounts** in the left rail: `Anvayra Support` (live Cloud API account) plus four clearly labelled demo tenants (Lotus Dental, Sunrise Realty, Cafe Mocha House, Fitloop Studio).
4. Switch accounts in one click — inbox, contacts, templates, automations and settings all follow the selected account.
5. Open a demo account (e.g. Lotus Dental) and send a message: it moves **queued → sent → delivered → read**, then a simulated customer reply arrives (`webhook 200 OK` in the activity log). No real message is sent on demo accounts.
6. On `Anvayra Support`, open **Settings → Connection details**, paste the account's **Phone Number ID** and **WABA ID**, save, then send from the inbox — this calls `POST /webhook/meta-app/send`, which sends through the official WhatsApp Cloud API. The access token never leaves n8n.
7. **Connect WhatsApp Business** (top right or Settings) opens Meta Embedded Signup (`config_id 1469679065081628`); the returned `waba_id` / `phone_number_id` are saved per account, and the auth code is exchanged server-side via `/webhook/whatsapp-callback`.
8. Incoming replies are received by the `meta-app-verification` webhook and acknowledged with HTTP 200.
9. To delete data: `/data-deletion/` (email request, actioned within 7 days) or **Settings → Clear local workspace data**.
10. **Sign out** in the rail bottom-left.

---

## 7. Actual result (completed 24 Oct 2026)

### Website — built and locally verified

- [x] Home page rebuilt from scratch in a brown-paper / kraft theme (`assets/css/paper.css`). Old `style.css` not used.
- [x] No background video, no stock images, no copied assets. Visual texture is CSS (grain, ruled lines, tape, stamp).
- [x] High-contrast palette: ink `#2b2117` on paper `#f2e7d3`, rust `#8a4426` accents.
- [x] Responsive at desktop, tablet and mobile (tested at 1440px and 390px).
- [x] Dashboard rebuilt with the same theme and wired to the existing n8n endpoints.
- [x] Privacy, Terms, Data Deletion live as real pages in `/privacy/`, `/terms/`, `/data-deletion/`.
- [x] Contact form with required WhatsApp consent checkbox, n8n lead endpoint and `thank-you.html`.
- [x] Favicon, robots.txt and sitemap.xml added.
- [x] All internal links checked — zero broken links; JS syntax checks pass.

### n8n — workflow created, published and tested

**Workflow:** `meta-app-verification`
**URL:** https://teamapexgaming.app.n8n.cloud/workflow/tfcSmIkGlNdySVxH
**Status:** Published and active · 14 nodes · 4 groups

| Test | Result |
|---|---|
| `GET /webhook/meta-app-verification?hub.verify_token=…&hub.challenge=987654` | ✅ 200, body `987654` |
| Same request with a wrong token | ✅ 403 `Forbidden: wrong verify token` |
| `GET /webhook/meta-app-verification/health` | ✅ 200 JSON `{status:"ok", …}` |
| `POST /webhook/meta-app-verification/lead` with consent `true` | ✅ 200 `{received:true}` |
| `POST /webhook/meta-app-verification/lead` with consent `false` | ✅ 400 validation error |
| CORS preflight `OPTIONS /lead` | ✅ 204 with matching `Access-Control-Allow-Origin` |

The website’s dashboard health check is already pointed at this workflow and displays **“Online · 200 OK”**.

### Two values to keep consistent everywhere

- **Verify token:** `anvayra-meta-verify-1111754955165517`
- **Webhook URL:** `https://teamapexgaming.app.n8n.cloud/webhook/meta-app-verification`

### One thing to confirm before submitting

The dashboard sends messages through the **existing, already-published** `meta-app` workflow (`/webhook/meta-app/send`) because it already holds the WhatsApp credential. The new `meta-app-verification` workflow handles verification, incoming events, leads/consent and health. If you prefer one workflow to do everything, we can merge the send route into `meta-app-verification` later — but doing so is not required for review and risks breaking the working send path today.

---

## 8. Workspace build (added 24 Oct 2026)

### What changed

| Area | Before | Now |
|---|---|---|
| Auth | None (dashboard open to anyone) | `login.html` + `signup.html`, salted SHA-256 passwords in `localStorage`, 12-hour session, redirect guard |
| Accounts | One hard-coded account | 5 accounts: `Anvayra Support` (live Cloud API) + 4 demo tenants |
| Inbox | Single static thread | Threaded per account, search, unread counts, day separators, delivery ticks |
| Sending | One test form | Composer per conversation; demo accounts simulate `queued → sent → delivered → read` then auto-reply; live account calls `/webhook/meta-app/send` |
| Views | 1 | Inbox, Contacts, Templates, Automations, Settings |
| Data | — | Per-user workspace state (`anvayra.workspace.v1.<userId>`), templates, automation switches, activity log |
| Fonts | Google Fonts CDN | Self-hosted `assets/fonts` + `assets/css/fonts.css` (works offline, no third-party request) |

### Reviewer demo account

- Email `demo@anvayra.app`, password `anvayra2026` (seeded automatically on first login).
- New signups get their own `Your business` account (empty, not connected) plus the four demo tenants, and their own storage namespace.
- Demo replies are generated locally and labelled as such in the composer hint and activity log — never presented as real WhatsApp traffic.

### Live-send requirements (the one remaining external piece)

`/webhook/meta-app/send` requires **`to`, `message` and `phoneNumberId`** (verified against the published workflow). It then sends through the `WhatsApp account` credential (`3g9xCjWEuzqXksPj`).

To make `Anvayra Support` send for real:

1. Get the **Phone Number ID** and **WABA ID** for +91 91658 26867 from Meta → WhatsApp → API Setup.
2. Paste both into **Settings → Connection details** and save (stored in that browser only).
3. Open a conversation and send. Success shows `Accepted by Cloud API · wamid …` and an HTTP 200 in n8n.

Until those two values are entered the account correctly shows `SETUP · CLOUD API` instead of `LIVE`.

**Multi-account caveat:** one credential can only send from numbers it has access to. Sending from a *client's* WABA needs that client's own token (from Embedded Signup) stored server-side per account — the current build reuses Anvayra's token, so the four extra accounts are intentionally demo-only.

### WhatsApp Coexistence

Coexistence is not granted by App Review. It is a separate Meta onboarding track (Business app + Cloud API on one number). The site explains the model, but the switch is flipped by Meta after eligibility/onboarding approval — no website change can enable it.

### Verification performed

- `node --check` passes on `auth.js`, `workspace.js`, `main.js`.
- Zero broken internal links across all HTML files.
- Browser E2E: demo login → workspace (5 accounts, 2 threads on the live account); all five views render (2 contacts, 5 templates, 6 automations, 11 provider rows); account switching; template → composer; automation toggle + log; search empty state; profile save; sign-out.
- Delivery simulation sampled every 300 ms: `queued → sent → delivered → read → inbound reply`.
- Real-send guard: without a Phone Number ID the bubble fails with an explicit message instead of a silent error.
- Mobile 390×844: rail drawer, inbox list, chat view with back button, composer visible; settings scrolls.
- Homepage re-checked at 1440×1000 after the font self-hosting change.

---

## 9. P2 — Real authentication + pretty URLs (completed 24 Oct 2026)

### Auth: localStorage → Supabase Auth (done)

| Before | Now |
|---|---|
| `auth.js` localStorage user store, salted SHA-256 passwords | `supabase.auth` — email/password (`signInWithPassword`, `signUp`) |
| 12-hour localStorage session with own expiry | JWT session managed by supabase-js v2 (auto-refresh, persisted) |
| `usr_demo` seeded in localStorage | `demo@anvayra.app` is a **real confirmed Supabase user** (`37b9c643-989b-41b2-bbba-976f21858a38`), provisioned server-side; trigger auto-created profile + workspace + owner membership |
| `requireSession()` sync localStorage check | `requireSession()` async guard → `supabase.auth.getUser()` (+ profile row) |
| `updateProfile()` wrote to localStorage | Writes to `public.profiles` via RLS + keeps auth metadata in step |
| Random local userId in workspace namespace | `anvayra.workspace.v1.<auth.users.id>` (uuid) with one-time legacy-key migration |

- Login/signup pages load `supabase-js@2` from jsDelivr CDN, then `assets/js/auth.js`.
- Email confirmation is ON: signups show a "check your inbox" state; demo user bypasses it (server-seeded).
- **Google OAuth is wired** (`signInWithOAuth({ provider: 'google', redirectTo: origin + '/dashboard/' })`) with the official Google button style on login + signup. To activate:
  1. Google Cloud Console → OAuth consent screen (App: Anvayra, support email shivamkushwahsironj@gmail.com, scopes `email` + `profile`).
  2. Create OAuth Client ID (Web) with redirect URI:
     `https://nbxsebcrcussmmxismsa.supabase.co/auth/v1/callback`
  3. Supabase Dashboard → Auth → Providers → Google → enable with the Client ID/Secret.
  4. Add the production domain to Google "Authorized domains" once the real domain is live.
- **Facebook Login intentionally deferred** — add a 2nd Meta App for login only so it cannot jeopardise the WhatsApp `whatsapp_business_messaging` review (button code `signInWithFacebook` is already in auth.js, provider to be enabled later).
- Reviewer demo box on `/login/` is hidden by default and shows only with `?reviewer=1`.
- Privacy Policy section 3 added: Google/Facebook OAuth disclosure (name/email/profile picture via Supabase).

### Pretty URLs (done)

```
/                     → index.html (home)
/dashboard/           → dashboard/index.html   (was /dashboard.html)
/login/               → login/index.html       (was /login.html)
/signup/              → signup/index.html      (was /signup.html)
/thank-you/           → thank-you/index.html   (was /thank-you.html)
/privacy/ /terms/ /data-deletion/  (already foldered)
```

- Old `*.html` root paths remain as redirect stubs (0-second meta refresh) so any reviewer bookmark still lands correctly.
- `assets/js/main.js`, all nav/footer links, workspace links and auth redirects updated; 0 broken links verified.

### Vercel config (new `vercel.json`)

- `cleanUrls: true` + `trailingSlash: false` → `/dashboard`, `/login` serve the folder index files.
- Rewrites: legacy `/dashboard.html` etc → new clean paths; `/docs/*` → `/404.html` (docs no longer deployable).
- Security headers (nosniff, frame-options, referrer-policy, permissions-policy) + immutable cache for `/assets/`.
- `404.html` added; `robots.txt` updated to disallow the new workspace paths.

### Verified

- `node --check` passes on `auth.js`, `workspace.js`, `main.js`.
- All internal links resolve; duplicate-ID check clean across all pages.
- Live login test against the production Auth API: `demo@anvayra.app / anvayra2026` → 200 + access token; wrong password → 400.
- Signup path: `signUp` with `full_name`/`business_name` metadata → DB trigger provisions profile + workspace + owner membership (verified earlier with a test user).

### Still pending (user actions)

1. Google Cloud OAuth Client (Client ID + Secret) → paste into Supabase Auth → Providers → Google. Redirect URI: `https://nbxsebcrcussmmxismsa.supabase.co/auth/v1/callback`.
2. Final production domain (anvayra.com) → update sitemap, robots, canonical, OAuth redirect URIs.
3. WhatsApp: Phone Number ID + WABA ID + permanent System User token → P3 Edge Functions (`wa-webhook`, `wa-send`, `wa-connect`, `data-deletion`).

### Follow-up fix (same day): dashboard redirect loop resolved

**Symptom:** after logging in, `/dashboard/` bounced back to `/login/?next=dashboard`.

**Root cause:** `dashboard/index.html` loaded `auth.js` but never loaded the supabase-js CDN
script, so `window.supabase` was undefined → `AnvayraAuth.client === null` → `getSession()`
returned null → the guard redirected even with a valid stored session.

**Fix:** added `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>`
before `../assets/js/auth.js` in `dashboard/index.html`.

**Re-verified end to end in the browser:**

1. `/login/` loads, supabase-js OK, demo box hidden without `?reviewer=1`, Google button present.
2. Programmatic login (`AnvayraAuth.login`) → `ok:true`, userId `37b9c643-…`, name "Shivam Kushwah".
3. Navigating to `/dashboard/` with the session → **loads, no redirect**; header shows
   "Shivam Kushwah / demo@anvayra.app"; 5 workspace accounts seeded (Anvayra Automation + 4 demo tenants).
4. `Sign out` → redirects to `/login/`.
5. UI-form login (fill fields + submit) → redirects to `/dashboard/`, session resolves.

Handbook (`docs/WEBSITE-HANDBOOK.md`) updated to v2.0: auth section rewritten for Supabase,
status matrix updated (G-1 auth part resolved), repository map now shows the foldered layout.

---

## 10 · P3 — Supabase Edge Functions backend (DONE)

The public backend is now hosted on **Supabase Edge Functions** on project
`nbxsebcrcussmmxismsa` (`https://nbxsebcrcussmmxismsa.supabase.co`). The legacy
`teamapexgaming.app.n8n.cloud` webhooks are replaced: `workspace.js` now points
at the Edge Functions and no longer references the old n8n URLs.

### Deployed functions (all live, versioned in `supabase/functions/`)

| Function | URL | `verify_jwt` | Role |
|---|---|---|---|
| `wa-webhook` | `/functions/v1/wa-webhook` | false (own HMAC) | Meta webhook: GET handshake, POST signature check + idempotent persist |
| `wa-send` | `/functions/v1/wa-send` | true (user JWT) | Real Cloud API sends via vault token, membership + suppression + rate-limit checks |
| `wa-connect` | `/functions/v1/wa-connect` | true (user JWT) | Embedded Signup code → long-lived token → WABA + phone numbers → vault + `whatsapp_accounts` |
| `data-deletion` | `/functions/v1/data-deletion` | false (signed_request) | Meta Data Deletion callback + `GET ?code=` status |
| `health` | `/functions/v1/health` | false | Liveness/config probe |
| `wa-lead` | `/functions/v1/wa-lead` | false | Public contact-form intake → `public.leads` (honeypot + rate limit) |

`public.leads` table added (`meta_platform_public_leads` migration), RLS on, no client access.

### Verified live (curl)

- `GET /functions/v1/health` → `200 {"ok":true,…}`; `appSecretConfigured:false`, `systemTokenConfigured:false` (secrets pending).
- `GET /functions/v1/wa-webhook?hub.mode=subscribe&hub.verify_token=…&hub.challenge=CHALLENGE` → echoes challenge `200`; wrong token → `403`.
- `POST /functions/v1/wa-webhook` with a real payload, no APP_SECRET → `200 {ok:true,note:"signature unconfigured"}` and the event row persisted; re-POST same event → `200 {ok:true,duplicate:true}` (idempotent). Test rows cleaned from `webhook_events`.
- `POST /functions/v1/wa-send` and `/wa-connect` without a JWT → `401` (gate refuses).
- `GET /functions/v1/data-deletion?code=NOPE` → `404` (unknown code).
- `POST /functions/v1/wa-lead` → `200 {ok:true}` and a real `leads` row (verified, then cleaned up); honeypot → `200 {ok:true,ignored:true}`.
- `POST /functions/v1/data-deletion` (dummy `signed_request`, no APP_SECRET) → `200` returns `url: https://anvayra.vercel.app/deletion-status/?code=…`; `GET ?code=` → `200 pending`; unknown code → `404`. Test row cleaned (deployed v2).
- `deletion-status/` page added (reads `?code=`, fetches GET status, `noindex`); `/data-deletion/` page now has a confirmation-code lookup form leading to it. `robots.txt` disallows `/deletion-status/`.
- `vercel.json` now serves a `Content-Security-Policy` header (self + supabase host + facebook SDK / Embedded Signup).

**Bugs found and fixed during deployment:**

1. `wa-webhook` used `insert().onConflict().doNothing()` — this jsr build of
   supabase-js lacks `onConflict` on insert (threw `…onConflict is not a function`).
   Fixed with `.upsert({…}, { onConflict: "event_key", ignoreDuplicates: true })`
   (v2 `upsert` options — verified working; duplicate event acked, fresh event stored). Local file synced.
2. `wa-send` rewritten cleanly: removed dead `getUser`/`userErr` duplicated call,
   implemented contact+thread resolution and `messages` logging inline (no
   undefined helpers), failure path records a failed message + activity log,
   fixed `resp.messages[0].id` → `result.messages[0].id`.

### You still need to set these secrets (no MCP secrets tool exists)

Dashboard → your project → Edge Functions → **Secrets**, or `supabase secrets set`:

- `META_APP_SECRET` (App Secret from Meta App Dashboard → Basic Settings)
- `WHATSAPP_SYSTEM_USER_TOKEN` (permanent System User token, `whatsapp_business_messaging` + `whatsapp_business_management`)
- `META_APP_ID=1111754955165517` (has a sane default, set anyway)
- `GRAPH_VERSION=v21.0` (optional, defaults to v21.0)

### Meta dashboard configuration (App Review → webhook)

- Callback URL: `https://nbxsebcrcussmmxismsa.supabase.co/functions/v1/wa-webhook`
- Verify token: `anvayra-meta-verify-1111754955165517`
- Fields: `messages` (add `message_template_status_update` later), max 5. Click
  **Verify and save** — this fires the GET handshake.

### Still pending (user actions)

1. Google Cloud OAuth Client (ID + Secret) → Supabase Auth → Google. Redirect URI: `https://nbxsebcrcussmmxismsa.supabase.co/auth/v1/callback`. (currently `sso_providers` empty)
2. Final production domain → sitemap/canonical/robots/OAuth redirects.
3. System User token + App Secret secrets (above).
4. Complete an Embedded Signup from the dashboard to land the WABA in the vault →
   real sends work (P5).
5. Data Deletion callback URL in Meta App Dashboard Basic Settings →
   `https://nbxsebcrcussmmxismsa.supabase.co/functions/v1/data-deletion`

### P4 roadmap (next)
Replace the localStorage workspace model with live Supabase data (accounts, threads,
messages, realtime), wire `wa-send`/`wa-connect` to real DB account IDs + workspace
membership, then P5 Embedded Signup end-to-end.
