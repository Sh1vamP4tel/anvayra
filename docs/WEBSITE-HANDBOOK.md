# Anvayra WhatsApp Platform — System Handbook

**Version:** 3.0
**Last updated:** 27 October 2026
**Owner:** Shivam Kushwah — Anvayra (sole proprietor), Sironj, Madhya Pradesh, India
**Support:** shivamkushwahsironj@gmail.com · +91 91658 26867

This document describes the platform as it is built today. It covers the public site, the
authenticated workspace, the Supabase backend, the WhatsApp integration, deployment and the
remaining production gaps.

> **Production rule:** the workspace contains only real customer data. There are no demo tenants,
> seeded conversations, simulated replies, shared reviewer passwords or client-side business
> records. Empty workspaces show empty states.

---

## Table of contents

1. [Purpose](#1-purpose)
2. [Status matrix](#2-status-matrix)
3. [Architecture](#3-architecture)
4. [Repository map](#4-repository-map)
5. [Public website](#5-public-website)
6. [Authentication](#6-authentication)
7. [Workspace](#7-workspace)
8. [WhatsApp integration](#8-whatsapp-integration)
9. [Edge Functions](#9-edge-functions)
10. [Data model](#10-data-model)
11. [Configuration](#11-configuration)
12. [Security model](#12-security-model)
13. [Meta App Review playbook](#13-meta-app-review-playbook)
14. [Deployment and operations](#14-deployment-and-operations)
15. [Verification log](#15-verification-log)
16. [Gap register](#16-gap-register)
17. [Roadmap](#17-roadmap)
18. [Glossary](#18-glossary)
19. [Handover checklist](#19-handover-checklist)

---

## 1. Purpose

Anvayra is a WhatsApp Tech Provider product for businesses that want one place to:

- connect their own WhatsApp Business Account through Meta Embedded Signup;
- read and answer customer conversations;
- send approved templates and free-form replies inside the service window;
- keep consent, opt-out and delivery records;
- delete their data on request.

The public website explains the product and carries the legal pages Meta requires. The dashboard
is the working product the App Review submission points to.

### 1.1 Permissions requested

| Permission | Access | Why the product needs it | Where it is used |
|---|---|---|---|
| `whatsapp_business_messaging` | Advanced | Send replies and approved templates for the business that connected its account | Inbox composer, template send |
| `whatsapp_business_management` | Advanced | Read the connected WABA, phone numbers and templates | Settings, Templates |
| `business_management` | Advanced | Complete Meta Embedded Signup for assets the client selects | Connect WhatsApp Business |

### 1.2 What approval does not provide

**WhatsApp Coexistence is not an App Review outcome.** Running the WhatsApp Business app and the
Cloud API on the same number is a separate Meta onboarding track with its own eligibility review.
The product does not claim Coexistence is enabled. It must not be sold as available until Meta
confirms onboarding.

---

## 2. Status matrix

Legend: **LIVE** = works against the real service · **READY** = implemented and deployed, waiting
on an external input for end-to-end proof · **PENDING** = owner action.

| Capability | Status | Notes |
|---|---|---|
| Marketing site + legal pages | LIVE | Static HTML/CSS, no build framework |
| Contact form → `wa-lead` → `leads` | LIVE | Honeypot + rate limit, consent metadata stored |
| Email/password authentication | LIVE | Supabase Auth, email confirmation on |
| Google OAuth | READY | Client flow complete; Supabase redirect allow-list pending |
| Pre-paint auth gate | LIVE | No protected markup before session validation |
| Workspace data (accounts, inbox, contacts) | LIVE | Postgres + RLS; no seeded rows |
| Automation preferences | LIVE | Six rows per account created by DB trigger; saved to Postgres |
| Template list | READY | Synced from Meta by `wa-templates`; empty until an account is connected |
| Embedded Signup launch | LIVE | Real `FB.login` with config `1469679065081628` |
| Embedded Signup token exchange | READY | `wa-connect` deployed; needs `META_APP_SECRET` + a real signup |
| Outbound Cloud API send | READY | `wa-send` deployed; needs a connected account and vault token |
| Inbound webhook persistence | READY | `wa-webhook` deployed; needs `META_APP_SECRET` for signature verification |
| Delivery/read status events | READY | Stored by `wa-webhook` into `message_status_events` + `messages` |
| STOP / opt-out suppression | LIVE | Webhook writes `suppressions` and sets consent state |
| Template sync | READY | `wa-templates` deployed; needs a connected WABA |
| Data deletion callback | LIVE | `data-deletion` + `deletion-status/` lookup |
| Health probe | LIVE | `health` returns config booleans, no secrets |
| Coexistence | NOT ENABLED | Separate Meta onboarding track |

---

## 3. Architecture

```
┌───────────────────────────── Browser ──────────────────────────────┐
│  index.html · login/ · signup/ · dashboard/ · legal pages          │
│                                                                    │
│  auth.js        session, Google OAuth, redirect guard              │
│  workspace.js   accounts · inbox · contacts · templates ·          │
│                 automations · settings · Embedded Signup           │
└───────────────┬───────────────────────────────────┬────────────────┘
                │ HTTPS + user JWT                  │ OAuth popup
                ▼                                   ▼
┌──────────────────────────────┐        ┌───────────────────────────┐
│ Supabase                     │        │ Meta / Facebook           │
│  Auth                        │        │  Embedded Signup          │
│  Postgres + RLS              │        │  config 1469679065081628  │
│  Edge Functions              │        └─────────────┬─────────────┘
│   wa-connect  wa-send        │                      │
│   wa-templates wa-webhook    │                      │
│   wa-lead data-deletion      │                      │
│   health                     │                      │
└───────────────┬──────────────┘                      │
                │ Graph API v21.0                     │
                ▼                                     ▼
        WhatsApp Cloud API  ◄──────── messages ── Meta
```

**Design decisions**

1. **Static frontend.** `frontend/` is copied to `dist/` and served by Vercel. No bundler.
2. **All privileged calls are server-side.** Access tokens live in an encrypted vault table and
   are read only by Edge Functions using the service role. The browser never receives one.
3. **Postgres is the source of truth.** The workspace reads and writes business data through
   Supabase with row-level security. Browser storage holds only the auth session.
4. **Tenant isolation.** Every business row carries `workspace_id`; RLS checks membership through
   `private.my_workspace_ids()`.
5. **Webhooks are verified and idempotent.** `X-Hub-Signature-256` is checked against the App
   Secret, and each event is stored once by event key.

---

## 4. Repository map

```
frontend/
├── index.html                  Marketing + product explanation
├── login/                      Sign in (email/password + Google)
├── signup/                     Create workspace
├── dashboard/                  Workspace shell (five views)
├── privacy/                    Privacy Policy
├── terms/                      Terms of Service
├── data-deletion/              Deletion instructions + status lookup
├── deletion-status/            Confirmation-code lookup
├── thank-you/                  Contact-form success page (noindex)
├── 404.html
├── robots.txt  sitemap.xml
└── assets/
    ├── css/paper.css           Marketing design system
    ├── css/workspace.css       Auth + workspace layout, responsive rules
    ├── css/fonts.css           Self-hosted font faces
    ├── fonts/*.woff2
    ├── js/main.js              Nav, FAQ, scroll reveal, lead form
    ├── js/auth.js              Session, OAuth, profile
    ├── js/workspace.js         DB-backed workspace + Meta flows
    └── img/                    Logo and founder image

backend/
├── supabase/functions/
│   ├── wa-connect/             Embedded Signup code exchange + WABA subscription
│   ├── wa-send/                Cloud API send + message persistence
│   ├── wa-templates/           Template sync from Meta
│   ├── wa-webhook/             Meta webhook: verify, persist, fan out
│   ├── wa-lead/                Public contact-form intake
│   ├── data-deletion/          Meta deletion callback + status
│   └── health/                 Liveness/config probe
├── server/                     Optional Node/Express session-check service
└── README.md

docs/                           Internal documentation — never published
scripts/check-vercel-routes.mjs Deployment route/header validator
vercel.json                     Build command, rewrites, headers
```

---

## 5. Public website

### 5.1 `index.html`

One long page with in-page anchors.

| Section | Contents |
|---|---|
| Header | Brand, Services, How it works, Platform, About, FAQ, Contact, Client dashboard, Connect WhatsApp |
| Hero | Positioning, three CTAs, four operating facts |
| Trust marquee | Cloud API, Embedded Signup, consent, deletion, multi-account workspace |
| Services | Six service cards: AI agent, lead follow-up, reminders, templates, workflow automation, AI voice |
| How it works | Connect → select number → approve template → send and track |
| Platform | Product explanation + illustrative preview of the workspace |
| Permissions | The three Meta permissions and their business justification |
| Security & compliance | Secrets, consent, STOP, retention, deletion |
| Reviewer instructions | How to test the flow; credentials are supplied in the submission form only |
| About | Founder, legal entity, location, contact |
| FAQ | Six questions about the product, data and setup |
| Contact | Real contact details + lead form with required WhatsApp consent |
| Footer | Product, company, legal links, business identity |

The `#platform` panel is explicitly labelled as an **illustrative preview**. It contains no real
IDs, phone numbers or message identifiers, and it is not presented as live data.

### 5.2 Contact form

`main.js` posts to `wa-lead`:

```json
{
  "name": "...", "business": "...", "email": "...", "phone": "...",
  "service": "...", "message": "...",
  "consent": true,
  "consentText": "I agree to be contacted on WhatsApp about my enquiry.",
  "consentAt": "2026-10-27T09:00:00.000Z",
  "source": "anvayra-site",
  "page": "/"
}
```

The function rejects missing fields, missing consent, honeypot hits and over-limit requests.
Success navigates to `thank-you.html`.

### 5.3 Legal pages

| Page | Coverage |
|---|---|
| `/privacy/` | Data collected, WhatsApp/Meta data, use, subprocessors, retention, rights, security, transfers, contact |
| `/terms/` | Services, client responsibilities, Meta compliance, billing, ownership, IP, availability, liability, suspension, law |
| `/data-deletion/` | What to include, what is deleted, what may be retained, Meta-held data, timeline, escalation |
| `/deletion-status/` | Confirmation-code lookup against `data-deletion` |

All three carry the same legal identity and are linked from the footer, dashboard and signup.

---

## 6. Authentication

### 6.1 Model

- Supabase Auth with email/password and Google OAuth.
- Sessions are JWTs managed by supabase-js v2 and persisted under `anvayra.auth.v2`.
- `requireSession()` calls `auth.getUser()` and loads the `profiles` row. It returns
  `{ userId, name, email, business }`; it does not expose an access token to callers.
- Unauthenticated access to `/dashboard/` redirects to `/login/?next=dashboard`.

### 6.2 Pre-paint gate

`dashboard/index.html` contains an inline script in `<head>`:

1. Reads the stored session key.
2. If no session exists and the URL is not an OAuth/magic-link landing, it calls
   `location.replace('../login/?next=dashboard')` before `<body>` is parsed.
3. If a session exists, it shows a full-screen “Checking your session…” splash.
4. `workspace.js` adds `body.auth-ready` only after `requireSession()` succeeds.
5. An 8-second safety net redirects to login if auth never resolves.

Result: an unauthenticated visitor never sees protected workspace markup.

### 6.3 Signup

`signup/index.html` collects name, business, email, password (min 8) and Terms/Privacy consent.
`supabase.auth.signUp` passes `full_name` and `business_name` metadata. The
`on_auth_user_created` trigger creates:

- a `profiles` row;
- a `workspaces` row owned by the user;
- an owner row in `workspace_members`.

Email confirmation is enabled, so the UI shows a “check your inbox” state until confirmed.

### 6.4 Google OAuth

`auth.js` calls:

```js
client.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: window.location.origin + '/dashboard/',
    queryParams: { prompt: 'select_account' }
  }
});
```

The redirect is always derived from the current origin, so production never sends users to
`localhost`. The Supabase project must allow the production origin, otherwise GoTrue replaces the
destination with the Site URL.

**Required setting (Supabase → Authentication → URL Configuration):**

- Site URL: `https://anvayra.vercel.app`
- Redirect URLs: `https://anvayra.vercel.app/**`, `http://localhost:3000/**`

### 6.5 Profile updates

`updateProfile()` writes `full_name` and `business_name` to `public.profiles` under RLS and syncs
the auth user metadata. The rail and header update after a successful save.

---

## 7. Workspace

Single document; views are `<section class="ws-view">` toggled by `data-view`.

### 7.1 Left rail

- Brand link to the marketing site.
- Five navigation buttons: Inbox (unread badge), Contacts, Templates, Automations, Settings.
- **WhatsApp accounts** loaded from `whatsapp_accounts` for the workspace. Each row shows
  initials, label, `SETUP`/`LIVE` state and the last four digits of the number when known.
  Selecting a row switches every view to that account.
- Empty state when the workspace has no accounts, with a Connect action.
- User footer with name, email and Sign out.

There are no seeded account names, phone numbers or tenants.

### 7.2 Top bar

Account label and badge (`Cloud API` / `Setup · Cloud API`), phone number and status,
Website link (desktop), Connect WhatsApp button.

### 7.3 Inbox

- Search filters the active account's threads by contact name or number.
- Thread list: avatar, name, last message preview, relative time, unread count.
- Chat header: back button (mobile), avatar, name, number, consent state.
- Message log: day separators, inbound/outbound bubbles, timestamps, delivery ticks from the
  stored message status, error text for failed sends.
- Composer: auto-growing textarea, Send button, Enter to send, Shift+Enter for a new line.
  Disabled with an explanatory hint when the account is not connected.
- Empty states for “no conversations” and “select a conversation”.

### 7.4 Contacts

Table of contacts for the active account: name, number, last message, consent pill, Open chat.
Consent is read from `contacts.opt_in_state` (`opted_in`, `opted_out`, `unknown`).

### 7.5 Templates

- Cards come from `templates` for the active account.
- Each card shows name, category, language, status and body preview.
- **Sync from WhatsApp** calls `wa-templates`; the button is disabled until an account is connected.
- **Copy to composer** inserts the template body with `{{n}}` placeholders replaced by bracketed
  hints, then switches to Inbox.
- Empty state explains that approved templates appear after a sync.
- No template is seeded in code or in the database.

### 7.6 Automations

Six preference cards per account:

| Key | Label |
|---|---|
| `auto_reply` | Instant first reply |
| `lead_capture` | Lead capture |
| `appointment_reminder` | Appointment reminders |
| `opt_out_handler` | STOP / opt-out handler |
| `human_handover` | Human handover |
| `daily_digest` | Daily owner digest |

Rows are created automatically when a WhatsApp account is inserted. Toggling writes `enabled` to
`automations` and updates the label to `On · saved` / `Off · saved`. The UI describes these as
saved account preferences; it does not claim a workflow engine executes them.

### 7.7 Settings

Left column:

1. **Connect WhatsApp Business** — opens Embedded Signup; live status line.
2. **Connection details** — status, business, WABA ID, Phone Number ID, webhook health, Graph
   version. Values are written by Embedded Signup, not typed by hand.
3. **Profile** — name and business, saved to `profiles`.
4. **Data deletion** — links to instructions and confirmation-code lookup.

Right column:

1. **Activity log** — last 60 `activity_log` rows for the workspace, newest first. Refresh reloads
   from the database.
2. **Provider details** — legal entity, location, platform, support contact, legal links.

### 7.8 Scrolling and layout

- `body.ws-body` and `.ws` are fixed to `100dvh` with `overflow: hidden`.
- `.ws-main`, `.ws-views`, `.ws-view` use `min-height: 0` and a flex chain so the active panel
  owns the scroll.
- `.panel` is `height: 100%`, `overflow-y: auto`, `overscroll-behavior: contain`.
- The page body never scrolls; each panel scrolls independently.
- At ≤860 px the rail becomes a drawer; thread list and chat are mutually exclusive; the composer
  stays visible above the safe area.

---

## 8. WhatsApp integration

### 8.1 Meta objects

| Object | Meaning | Where it appears |
|---|---|---|
| Meta App | Permissions, webhooks, Embedded Signup config | App ID `1111754955165517` |
| Business Portfolio | Legal business that owns assets | `983719140695281` |
| WABA | WhatsApp Business Account | `whatsapp_accounts.waba_id` |
| Phone Number ID | Cloud API identifier for a sending number | `whatsapp_accounts.phone_number_id` |
| Access token | Bearer token for Graph calls | Encrypted vault only |
| App Secret | Signs webhook payloads | Edge Function secret only |

### 8.2 Embedded Signup

**Load the SDK** (dashboard only):

```html
<script async defer crossorigin="anonymous"
        src="https://connect.facebook.net/en_US/sdk.js"></script>
```

`fbAsyncInit` runs:

```js
FB.init({ appId: '1111754955165517', version: 'v21.0', xfbml: true });
```

**Launch the dialog:**

```js
FB.login(handler, {
  config_id: '1469679065081628',
  response_type: 'code',
  override_default_response_type: true,
  extras: { setup: {}, sessionInfoVersion: '3' }
});
```

**Receive the result:**

1. `FB.login` returns `authResponse.code`.
2. `postMessage` events of type `WA_EMBEDDED_SIGNUP` provide `FINISH`, `CANCEL` or `ERROR`.
   `FINISH` payloads can include `waba_id`, `phone_number_id` and `business_id`.

**Exchange server-side:**

```js
POST /functions/v1/wa-connect
Authorization: Bearer <user JWT>

{
  "code": "<authResponse.code>",
  "workspaceId": "<workspace uuid>",
  "wabaId": "<optional selection>",
  "phoneNumberId": "<optional selection>",
  "label": "<account label>"
}
```

`wa-connect` exchanges the code, upgrades the token, resolves the WABA and number, subscribes the
app to the WABA, stores the token in the vault and upserts `whatsapp_accounts`. The response
includes `wabaId`, `scopes`, `webhookSubscribed` and the created accounts.

**What is stored where:**

| Value | Browser | Server |
|---|---|---|
| WABA ID | yes (not secret) | yes |
| Phone Number ID | yes (not secret) | yes |
| Access token | **never** | encrypted vault |
| App Secret | **never** | Edge Function secret |

### 8.3 Sending

```js
POST /functions/v1/wa-send
Authorization: Bearer <user JWT>

{
  "accountId": "<uuid>",
  "to": "919876543210",
  "text": "Hello! Your appointment is confirmed."
}
```

Template sends use `templateName` and `templateLang` instead of `text`.

`wa-send` verifies membership and connection state, checks suppression and rate limits, calls the
Cloud API with the vault token, and stores the outbound message with its `wamid`. Failures are
stored with Meta's error code and message.

**Status model:**

| Status | Meaning | UI tick |
|---|---|---|
| `queued` | Stored before the request completes | single |
| `sending` | Request in flight | single |
| `sent` | Accepted by Cloud API, `wamid` stored | single |
| `delivered` | Delivery webhook received | double |
| `read` | Read webhook received | double |
| `failed` | Rejected or blocked; error stored | exclamation |

Delivery and read states come from Meta webhooks, not timers.

### 8.4 Receiving

`wa-webhook` handles Meta events:

1. `GET` verifies `hub.verify_token` and echoes `hub.challenge`.
2. `POST` computes HMAC-SHA256 of the raw body with `META_APP_SECRET` and compares it to
   `X-Hub-Signature-256`.
3. The event is upserted into `webhook_events` by event key; duplicates are acknowledged without
   reprocessing.
4. Inbound messages:
   - upsert the contact without overwriting name or consent;
   - find or create the thread for the account + contact;
   - insert the message;
   - increment `unread_count`;
   - update last-message preview and timestamp.
5. STOP / unsubscribe / cancel / end / block:
   - insert a `suppressions` row;
   - set `contacts.opt_in_state = 'opted_out'`.
6. Status events update `messages` and append to `message_status_events`.
7. The function always answers `200` so Meta does not retry indefinitely.

### 8.5 Template sync

```js
POST /functions/v1/wa-templates
Authorization: Bearer <user JWT>

{ "accountId": "<uuid>" }
```

Fetches `/{wabaId}/message_templates`, maps category/status/components, upserts by
`(account_id,name,language)`, and deletes rows Meta no longer returns. If no token is stored it
returns a clear “reconnect the account” error.

### 8.6 Webhook configuration

- Callback URL: `https://nbxsebcrcussmmxismsa.supabase.co/functions/v1/wa-webhook`
- Verify token: `anvayra-meta-verify-1111754955165517`
- Fields: `messages` (add `message_template_status_update` when template status events are needed)

### 8.7 Coexistence

Coexistence is a separate Meta onboarding track. The codebase does not enable it, and the website
does not claim it is active. State this plainly in any partner or review conversation.

---

## 9. Edge Functions

| Function | `verify_jwt` | Responsibility |
|---|---|---|
| `wa-connect` | `true` | Code exchange, token upgrade, WABA resolution, webhook subscription, account upsert |
| `wa-send` | `true` | Membership check, suppression/rate limit, Cloud API send, message persistence |
| `wa-templates` | `true` | Template fetch, upsert, stale-row removal |
| `wa-webhook` | `false` | Handshake, HMAC verification, idempotent events, contacts/threads/messages, statuses, STOP |
| `wa-lead` | `false` | Public lead intake with honeypot and rate limit |
| `data-deletion` | `false` | Meta `signed_request` callback and status lookup |
| `health` | `false` | Liveness and secret-configuration booleans |

**Shared rules**

- Service-role clients are created inside the function; the key is never returned.
- User-authenticated functions validate the JWT with `auth.getUser()` before touching data.
- BOLA checks confirm the user is a member of the workspace that owns the account.
- CORS is limited to the methods and headers the frontend needs.
- Errors return JSON `{ error }` with a useful status code.

---

## 10. Data model

| Table | Key columns | Notes |
|---|---|---|
| `profiles` | `id` → auth user, `full_name`, `business_name` | RLS: user reads/updates own |
| `workspaces` | `id`, `name`, `owner_id` | Admin update only |
| `workspace_members` | `workspace_id`, `user_id`, `role` | Membership gate for RLS |
| `whatsapp_accounts` | `workspace_id`, `waba_id`, `phone_number_id`, `status`, `label` | Unique partial index on `phone_number_id` |
| `contacts` | `workspace_id`, `wa_id`, `name`, `opt_in_state`, `last_seen_at` | Unique `(workspace_id, wa_id)` |
| `threads` | `account_id`, `contact_id`, `unread_count`, `last_message_at` | One per account + contact |
| `messages` | `account_id`, `thread_id`, `direction`, `body`, `wamid`, `status` | Outbound and inbound |
| `message_status_events` | `wamid`, `status`, `payload` | Raw status audit |
| `templates` | `account_id`, `name`, `language`, `category`, `status` | Unique `(account_id,name,language)` |
| `automations` | `account_id`, `key`, `enabled` | Six rows auto-created per account |
| `activity_log` | `workspace_id`, `action`, `detail`, `kind` | Workspace event feed |
| `suppressions` | `workspace_id`, `wa_id`, `reason`, `source` | Checked before sends |
| `webhook_events` | `event_key`, `payload` | Idempotency |
| `leads` | contact fields + consent metadata | No client access |
| `rate_limits` | key + counters | Server-side throttling |
| `deletion_requests` | `code`, `status`, `requested_at` | Deletion tracking |

### 10.1 RLS summary

- Members may `SELECT` business rows for their workspaces.
- Members may `UPDATE` `automations`; admins may `UPDATE` `workspaces`.
- No client `INSERT`/`UPDATE` on accounts, threads, messages, contacts or templates.
- All writes for those tables happen in Edge Functions with the service role.
- `leads`, `webhook_events`, `rate_limits` and token storage have no client policies.

### 10.2 Token vault

Access tokens are stored through `store_wa_token()` and read through `get_wa_token()` from Edge
Functions only. The frontend has no policy path to either table or function.

---

## 11. Configuration

All values below are public identifiers. Secrets are intentionally absent.

| Constant | Value | Location |
|---|---|---|
| Supabase project URL | `https://nbxsebcrcussmmxismsa.supabase.co` | `auth.js`, functions |
| Supabase publishable key | `sb_publishable_…` | `auth.js` |
| Meta App ID | `1111754955165517` | `workspace.js`, `wa-connect` |
| Embedded Signup config | `1469679065081628` | `workspace.js` |
| Business Portfolio ID | `983719140695281` | Meta / provider card |
| Graph version | `v21.0` | functions |
| Webhook verify token | `anvayra-meta-verify-1111754955165517` | `wa-webhook` |
| Lead endpoint | `/functions/v1/wa-lead` | `main.js` |
| Health endpoint | `/functions/v1/health` | `workspace.js` |
| Canonical host | `https://anvayra.vercel.app` | `index.html`, `sitemap.xml`, `robots.txt` |
| Asset version | `?v=20261027` | HTML script/style URLs |

### 11.1 Edge Function secrets

| Secret | Purpose |
|---|---|
| `META_APP_SECRET` | Code exchange and webhook signature verification |
| `WHATSAPP_SYSTEM_USER_TOKEN` | Server-side System User token; never a 24-hour token |
| `META_APP_ID` | Defaults to `1111754955165517` |
| `GRAPH_VERSION` | Defaults to `v21.0` |

### 11.2 Supabase Auth settings

- Site URL: `https://anvayra.vercel.app`
- Redirect URLs: `https://anvayra.vercel.app/**`, `http://localhost:3000/**`

---

## 12. Security model

### 12.1 Controls in place

- Access tokens and App Secret exist only as Edge Function secrets and vault rows.
- Webhooks are HMAC-verified before processing; unverified payloads are stored but not acted on.
- All user-facing functions validate the JWT and workspace membership.
- RLS enforces tenant isolation for every client read.
- Business writes are server-only; the browser cannot forge messages or accounts.
- Suppression and rate limits are checked before sending.
- STOP keywords update consent and suppression immediately.
- The dashboard is hidden until the session is validated, with no protected paint.
- CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and
  `Permissions-Policy` are set in `vercel.json`.
- Self-hosted fonts; the only third-party script is the Meta JS SDK on the dashboard.

### 12.2 Operational rules

1. Never paste access tokens, refresh tokens or callback URLs into chat, tickets or screenshots.
2. Rotate the Google client secret and any exposed session immediately if a token leaks.
3. Use a permanent System User token for server operations; never a 24-hour token.
4. Keep `docs/`, `backend/` and `.env` files out of the deployed output.
5. Review Supabase advisor findings after schema changes.

---

## 13. Meta App Review playbook

### 13.1 Prerequisites

- [x] Business verification complete.
- [x] Public website with product description and legal pages.
- [x] Privacy, Terms and Data Deletion URLs live.
- [x] App in Live mode.
- [x] Webhook callback and verify token configured.
- [x] Embedded Signup configuration created.
- [x] Pre-paint auth gate verified.
- [ ] Edge Function secrets configured.
- [ ] Supabase Auth URL configuration saved.
- [ ] One real Embedded Signup completed.
- [ ] One real outbound send + inbound reply recorded.
- [ ] Screencast recorded.
- [ ] Permission justifications pasted into App Review.

### 13.2 Reviewer flow (current)

1. Open `https://anvayra.vercel.app`.
2. Sign in with the reviewer account supplied in the App Review submission form.
3. The workspace opens with the accounts that belong to that workspace. A fresh workspace shows
   an explicit “no accounts yet” state.
4. **Connect WhatsApp Business** opens Meta Embedded Signup. Complete it with a test business and
   phone number.
5. The account appears as connected; WABA ID and Phone Number ID are visible in Settings.
6. Open **Templates → Sync from WhatsApp** to pull approved templates.
7. Open **Inbox**, choose or start a conversation, and send a message. The stored `wamid` and
   status appear on the bubble.
8. Send a WhatsApp reply from the test phone; the webhook stores it and it appears in the inbox.
9. Send **STOP**; the contact becomes opted out and a suppression row is created.
10. **Settings → Check webhook** shows the live health response.
11. Sign out.

Reviewer credentials are never published on the public site.

### 13.3 Screencast outline (2–4 minutes, no cuts in the critical path)

1. Home page and legal footer links (20 s).
2. Sign in; show the workspace and empty state (15 s).
3. Complete Embedded Signup; show the connected account and IDs (45 s).
4. Sync templates; show approved templates (20 s).
5. Send a message; show `wamid` and delivery status (30 s).
6. Reply from a phone; show the inbound message in the inbox (25 s).
7. Send STOP; show opt-out and suppression (20 s).
8. Show the deletion page and status lookup (15 s).

### 13.4 Permission justifications

**`whatsapp_business_messaging`**

> Anvayra provides a shared inbox and customer-service automation for businesses that connect
> their own WhatsApp Business Account. Messages are sent only after a visible user action and only
> to contacts with a recorded consent state. The reviewer can exercise sending from the dashboard
> after completing Embedded Signup.

**`whatsapp_business_management`**

> We display the connected WABA, its phone numbers and its message templates so the business can
> confirm which number is active and which templates are approved. The dashboard shows WABA ID and
> Phone Number ID and lists templates synced from Meta with their approval status.

**`business_management`**

> Used solely to complete Embedded Signup so a client can grant access to the specific business
> assets they select. We do not access other businesses or assets the client did not choose.

### 13.5 Rejection risks to pre-empt

| Rejection | Cause | Mitigation |
|---|---|---|
| “Could not reproduce the use case” | Reviewer cannot sign in or has no data | Working reviewer account + Embedded Signup flow in the notes |
| “Permission not used in the product” | Requested scope has no visible surface | Each permission maps to a named screen |
| “Screencast does not show the flow” | Edited video or missing send | Record the full path end to end |
| “App not in Live mode” | Review submitted in Development | Switch to Live before submitting |
| “Website unreachable / legal pages missing” | Dead links or placeholder pages | Static pages, link check before submission |

---

## 14. Deployment and operations

### 14.1 Local preview

```bash
cd /home/ronny/Desktop/anvayra
python3 -m http.server 3000 --directory frontend
# http://localhost:3000/
```

### 14.2 Pre-deploy checks

```bash
for f in frontend/assets/js/*.js; do node --check "$f" || exit 1; done
node scripts/check-vercel-routes.mjs
```

### 14.3 Deploy

```bash
git push origin main
```

Vercel runs `rm -rf dist && mkdir -p dist && cp -r frontend/. dist/` and serves `dist/`.

`vercel.json` also defines:

- `cleanUrls` and `trailingSlash: false`;
- legacy `.html` rewrites to clean paths;
- `/docs/:path*` → `/404.html`;
- cache rules for `assets/js`, `assets/css`, `assets/img`, `assets/fonts`;
- CSP and security headers.

### 14.4 Edge Function deployment

Each function lives in `backend/supabase/functions/<name>/index.ts`. Deploy with the Supabase
dashboard editor, CLI (`supabase functions deploy <name>`) or the project's MCP tooling. Preserve
the `verify_jwt` settings in Section 9.

### 14.5 Post-deploy smoke test

| Test | Expected |
|---|---|
| `GET /` | 200, hero and nav render, no console errors |
| Anchor navigation | Each section scrolls correctly |
| Contact form with consent | Redirect to thank-you |
| Contact form without consent | Inline error, no navigation |
| `/dashboard` signed out | Redirect to login before workspace paint |
| `/dashboard` signed in | Workspace renders with real data |
| Settings at 800 px height | Panel scrolls; body does not |
| `/docs/plan.md` | 404 |
| `/backend/README.md` | 404 |
| `GET /functions/v1/health` | 200 with config booleans |
| `wa-connect` without JWT | 401 |
| `wa-webhook` wrong verify token | 403 |

### 14.6 Rollback

Redeploy the previous Vercel commit. Edge Functions keep numbered versions and can be rolled back
in the Supabase dashboard. Database migrations should be additive and reversible where possible.

---

## 15. Verification log

**27 October 2026**

| Check | Result |
|---|---|
| `node --check` on all frontend JS | Pass |
| Dashboard signed out | Redirects to `/login/?next=dashboard`; workspace markup absent |
| Dashboard signed in | Real empty states for accounts, contacts, templates |
| Settings panel scroll | `clientHeight 576`, `scrollHeight 1309`, reached bottom (`scrollTop 733`) |
| Console errors | None |
| Automation rows | Six created per account; toggle persisted to Postgres and UI |
| Temporary test account | Created, verified, deleted with cascade; no test rows remain |
| Auth users | Only the two real owner accounts remain |
| Dummy users | Deleted; cached demo session now redirects to login |
| `health` | `200 {ok:true}`; secrets reported unconfigured |
| `wa-connect` without JWT | `401` |
| `wa-templates` | Deployed; requires a connected account |
| Vercel routes | Validated with `scripts/check-vercel-routes.mjs` |

**Not yet verified end to end:** Embedded Signup token exchange, a real Cloud API send, an inbound
reply, template sync against a live WABA. Each requires the owner-held secrets and a connected
number.

---

## 16. Gap register

| # | Gap | Severity | Impact | Owner | Fix |
|---|---|---|---|---|---|
| G-1 | `META_APP_SECRET` not set | High | Token exchange and webhook signature verification cannot succeed | Owner | Supabase → Edge Functions → Secrets |
| G-2 | `WHATSAPP_SYSTEM_USER_TOKEN` not set | Medium | Server-side operations cannot use a permanent token | Owner | Add as an Edge Function secret |
| G-3 | Auth Site URL + Redirect URLs not saved | High | Google OAuth may land on `localhost:3000` | Owner | Supabase Auth → URL Configuration |
| G-4 | No real Embedded Signup completed | High (review) | No connected WABA, no templates, no sends | Owner + Eng | Run the flow with a test business |
| G-5 | No automated browser test suite | Low | Regressions caught manually | Eng | Add Playwright smoke tests |
| G-6 | Retention stated, not scheduled | Medium | 90-day policy claim without a purge job | Eng | Scheduled purge and audit |
| G-7 | Automation switches store intent only | Medium | Labels must stay honest; no execution engine | Eng | Add a workflow runner or keep as preferences |
| G-8 | Final domain unconfirmed | Low | Canonical, sitemap, OAuth and Meta domains tied to the placeholder | Owner | Update constants and Meta settings |
| G-9 | Leaked OAuth session not revoked | High | Exposed refresh token could be reused | Owner | Revoke the session in Supabase Auth |
| G-10 | Coexistence not enabled | Expected | Cannot run the Business app and API on one number | Meta | Separate onboarding application |

---

## 17. Roadmap

**Now — unblock production**

1. Set Edge Function secrets.
2. Save the Supabase Auth URL configuration.
3. Revoke the leaked session.
4. Complete Embedded Signup with a test business.
5. Send and receive one real message; capture the `wamid` and webhook event.

**Next — operational hardening**

1. Add Playwright smoke tests for login, empty states, send and webhook.
2. Add a scheduled retention job and document the deletion runbook.
3. Add uptime monitoring for `health` and webhook failures.
4. Add richer template management (create/delete) if customers need it.
5. Decide whether automation preferences become executable workflows or stay documented
   preferences.

**Later — growth**

1. Coexistence onboarding when Meta opens eligibility.
2. Team roles and invitations.
3. Billing and usage reporting.
4. Media message support and richer contact fields.

---

## 18. Glossary

| Term | Meaning |
|---|---|
| **WABA** | WhatsApp Business Account — owns numbers and templates |
| **Phone Number ID** | Cloud API identifier for a sending number (not the phone number) |
| **Cloud API** | Meta-hosted WhatsApp API, Graph `v21.0` |
| **Embedded Signup** | Meta dialog that onboards a client's WABA and number with consent |
| **Tech Provider / BSP** | Meta partner status that allows onboarding other businesses |
| **Coexistence** | Running the WhatsApp Business app and Cloud API on one number |
| **Template** | Pre-approved message format required outside the 24-hour service window |
| **24-hour window** | Period after a user's last message when free-form replies are allowed |
| **wamid** | WhatsApp message ID returned by the send API |
| **Opt-in / STOP** | Consent to receive messages / the user's withdrawal keywords |
| **App Secret** | Meta credential used to sign and verify webhook payloads |
| **RLS** | Postgres row-level security, used for tenant isolation |

---

## 19. Handover checklist

**Access**

- [ ] GitHub repository and Vercel project.
- [ ] Supabase project `nbxsebcrcussmmxismsa` (owner access).
- [ ] Meta App Dashboard, App `1111754955165517`.
- [ ] Business Portfolio `983719140695281`.
- [ ] Domain DNS.

**Values to collect from Meta**

- [ ] Confirmation that Embedded Signup config `1469679065081628` allows the production domain.
- [ ] WABA ID and Phone Number ID from the first real signup.
- [ ] App Review status and any reviewer questions.
- [ ] Data Deletion callback and webhook configuration confirmed.

**Before submission**

- [ ] Edge Function secrets set; `health` reports both as configured.
- [ ] Supabase Auth URL configuration saved.
- [ ] Reviewer account created and tested in a clean browser.
- [ ] Embedded Signup, send, inbound reply and STOP tested end to end.
- [ ] Screencast recorded per Section 13.3.
- [ ] Permission justifications pasted.
- [ ] App in Live mode.
- [ ] Leaked session revoked.

**Engineering acceptance**

- [ ] `node --check` passes on all frontend JS.
- [ ] `scripts/check-vercel-routes.mjs` passes.
- [ ] `/docs/plan.md` and `/backend/README.md` return 404 in production.
- [ ] No placeholder data, shared credentials or simulated replies remain.
- [ ] Dashboard scrolls correctly at desktop and mobile heights.

---

*Keep this handbook in sync with the code. When a claim and the product disagree, fix the product
or remove the claim.*
