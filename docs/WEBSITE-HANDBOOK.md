# Anvayra WhatsApp Platform — Complete Website & System Handbook

**Document version:** 2.0
**Date:** 24 October 2026
**Prepared for:** engineering handover / technical due diligence
**Owner:** Shivam Kushwah — Anvayra (sole proprietor), Sironj, Madhya Pradesh, India
**Contact:** shivamkushwahsironj@gmail.com · +91 91658 26867

> **v2.0 update (24 Oct 2026):** authentication is now **real** — Supabase Auth
> (project `nbxsebcrcussmmxismsa`) with email/password + Google OAuth. All pages use
> pretty URLs (`/dashboard/`, `/login/`, `/signup/`, `/thank-you/`). See **Section 6**
> for the new auth model and `docs/plan.md` §9 for the full change log. Sections 8–9
> (n8n send/webhook paths) describe the **legacy** n8n backend; it is being replaced by
> Supabase Edge Functions (P3, see plan) and old `teamapexgaming.app.n8n.cloud` URLs are
> scheduled for removal from the product.

> This document describes the website exactly as it is built today, including what is
> production-capable, what is deliberately simulated for the Meta review, and what must be
> replaced before real customers use it. Read Section 16 (Gap Register) before making promises
> to a client or to Meta.

---

## Table of contents

1. [Purpose of the website](#1-purpose-of-the-website)
2. [What exists today — status matrix](#2-what-exists-today--status-matrix)
3. [System architecture](#3-system-architecture)
4. [Repository map](#4-repository-map)
5. [Public website — page by page](#5-public-website--page-by-page)
6. [Authentication (login & signup)](#6-authentication-login--signup)
7. [The workspace (`dashboard.html`)](#7-the-workspace-dashboardhtml)
8. [WhatsApp integration — end to end](#8-whatsapp-integration--end-to-end)
9. [n8n backend](#9-n8n-backend)
10. [Data model & storage](#10-data-model--storage)
11. [Configuration reference](#11-configuration-reference)
12. [Security model](#12-security-model)
13. [Meta App Review playbook](#13-meta-app-review-playbook)
14. [Deployment & operations](#14-deployment--operations)
15. [Verification log](#15-verification-log)
16. [Gap register — what is not production-ready](#16-gap-register--what-is-not-production-ready)
17. [Roadmap to production](#17-roadmap-to-production)
18. [Glossary](#18-glossary)
19. [Handover checklist](#19-handover-checklist)

---

## 1. Purpose of the website

### 1.1 The single sentence

> **This website exists to get Anvayra approved by Meta as a WhatsApp Tech Provider / Business
> Solution Provider, by proving — on a live, inspectable product — that we can onboard a
> business onto the official WhatsApp Cloud API, send messages, receive events, respect
> consent, and delete data on request.**

Everything on the site is in service of that goal. It is not a portfolio site with a WhatsApp
theme; it is an application artefact for Meta App Review.

### 1.2 What "approved" concretely means

Meta App Review grants **Advanced Access** to specific permissions. Anvayra needs:

| Permission | Access level requested | Why the product needs it | Where a reviewer sees it |
|---|---|---|---|
| `whatsapp_business_messaging` | Advanced | Send text/template messages and automated replies on behalf of the business that connected its account | `dashboard.html` → Inbox composer and Send flow |
| `whatsapp_business_management` | Advanced | Read the connected WABA, phone numbers and message templates so the dashboard can display and manage them | `dashboard.html` → Settings (WABA ID / Phone Number ID) and Templates |
| `business_management` | Advanced / required for onboarding | Complete Meta Embedded Signup and manage only the business assets the client selects | `dashboard.html` → Connect WhatsApp Business |

### 1.3 Secondary goals

- Give a client (clinic, realtor, restaurant, gym) a calm shared inbox for their WhatsApp number.
- Capture website enquiries with explicit WhatsApp consent.
- Show that secrets stay server-side (n8n), never in the browser.
- Provide public, indexable Privacy / Terms / Data Deletion pages — a hard requirement for review.

### 1.4 What approval does **not** give us

**WhatsApp Coexistence is not an App Review outcome.** Coexistence — running the WhatsApp
Business app on a phone *and* the Cloud API on the same number — is a separate Meta onboarding
track with its own eligibility checks. App Review approval alone will not switch it on.
The website describes Coexistence as a capability we are preparing for; it does not claim it is
already enabled. Any engineer or client conversation must keep that distinction.

### 1.5 Two values that must stay consistent across Meta and the code

```
Verify token : anvayra-meta-verify-1111754955165517
Verify URL   : https://teamapexgaming.app.n8n.cloud/webhook/meta-app-verification
```

---

## 2. What exists today — status matrix

Legend: **LIVE** = works against a real service · **DEMO** = deliberate simulation ·
**INPUT** = works once a value is supplied · **SCAFFOLD** = UI only.

| Capability | Status | Notes |
|---|---|---|
| Marketing site, legal pages, SEO files | LIVE | Static HTML/CSS/JS, no build step |
| Contact form → n8n lead webhook → thank-you | LIVE | Tested 200 with consent, 400 without |
| Meta webhook verification (`GET`) | LIVE | Echoes `hub.challenge`, 403 on wrong token |
| Incoming message webhook (`POST`) | LIVE (ack only) | Normalizes and returns `200 OK`; **does not persist or display** (see G-4) |
| Health endpoint | LIVE | `{"status":"ok"}` JSON, used by dashboard "Check webhook" |
| Login / signup / session | LIVE | Supabase Auth (JWT sessions, email confirmation, Google OAuth wired) — real users in Postgres; reviewer demo account is a confirmed server-side user |
| Google OAuth sign-in | INPUT | Fully wired client-side; activates once the Google Cloud OAuth client is pasted into Supabase Auth → Providers → Google |
| Facebook Login | DEFERRED | Intentionally deferred to a 2nd Meta App; `signInWithFacebook` already in auth.js |
| Multi-account workspace (5 accounts) | DEMO | Seeded per user; per-user storage namespace |
| Chat threading, search, unread, contacts | DEMO | Seeded + locally persisted |
| Demo message sending with statuses + auto-reply | DEMO | `queued → sent → delivered → read → reply` over 3 s |
| Real message sending via Cloud API | INPUT | Works when a **Phone Number ID** is saved; calls `/webhook/meta-app/send` |
| Embedded Signup launch | LIVE | Real `FB.login` with `config_id 1469679065081628`; opens Meta's dialog |
| Embedded Signup code → token exchange | LIVE (external) | POSTs to `/webhook/whatsapp-callback`; endpoint contract assumed, needs a live end-to-end test |
| Template list | DEMO | 5 illustrative templates; no Graph API template CRUD |
| Automation toggles | SCAFFOLD | UI state + local log; not wired to n8n workflow activation |
| Activity log | DEMO | Local session log of UI/API actions |
| Data deletion | LIVE (process) | Local wipe button + documented email process (7 days) |

---

## 3. System architecture

```
┌────────────────────────────  Browser (static site)  ────────────────────────────┐
│                                                                                  │
│  index.html        login.html / signup.html        dashboard.html                │
│  marketing         auth.js (localStorage)          workspace.js                  │
│  main.js           └─ session guard                ├─ accounts (5)                │
│  contact form                                         ├─ inbox / threads          │
│  preview tabs                                         ├─ composer → send         │
│                                                       ├─ templates / automations │
│                                                       ├─ settings / activity log  │
│                                                       └─ Embedded Signup (FB SDK) │
└───────────────┬───────────────────────────┬───────────────────────┬──────────────┘
                │ HTTPS JSON                │ HTTPS JSON            │ OAuth popup
                ▼                           ▼                       ▼
   ┌────────────────────────┐   ┌───────────────────────┐   ┌──────────────────────┐
   │ n8n: meta-app-         │   │ n8n: meta-app         │   │ Meta / Facebook      │
   │ verification           │   │ /webhook/meta-app/send│   │ Embedded Signup      │
   │ GET  verify            │   │ → WhatsApp Cloud node │   │ config_id 1469…628   │
   │ POST events → 200      │   │ → Graph API v21.0     │   └──────────┬───────────┘
   │ POST /lead             │   └───────────┬───────────┘              │
   │ GET  /health           │               │                          │
   └───────────┬────────────┘               ▼                          ▼
               │                 WhatsApp Cloud API  ◄──── messages ── Meta
               │                 (sends to real numbers)
               │
               ▼
      Lead record (workflow runtime)
```

**Key architectural decisions**

1. **Static frontend only.** No Node/PHP server, no bundler. Deployable to any static host.
2. **All privileged calls go through n8n.** The App Secret and WhatsApp access token live in
   n8n credentials (`WhatsApp account` = `3g9xCjWEuzqXksPj`, `Meta App Credentials` =
   `7iCOA2dURcaImBAl`). The browser never receives them.
3. **Demo data is local, real actions are remote.** The workspace seeds itself in the browser;
   only the live send and Embedded Signup touch the network.
4. **Per-user storage namespace.** Two accounts on the same browser do not share a workspace.

---

## 4. Repository map

```
meta-app/
├── index.html                    Marketing + review proof (1 long page, 11 blocks)
├── login/                        Sign-in (Supabase Auth + Google OAuth; reviewer box behind ?reviewer=1)
├── signup/                       Create-workspace screen (Supabase signUp + trigger provisioning)
├── dashboard/                    Workspace shell (all five views in one document)
├── thank-you/                    Contact-form success page (noindex)
├── login.html / signup.html /    Legacy root paths — 0-second redirect stubs
│   dashboard.html / thank-you.html
├── privacy/index.html            Privacy Policy (13 sections, incl. OAuth disclosure)
├── terms/index.html              Terms of Service (11 sections)
├── data-deletion/index.html      Data Deletion Instructions
├── vercel.json                   cleanUrls, legacy rewrites, /docs/* → 404, security headers
├── 404.html                      Not-found page
├── robots.txt                    Disallows /docs/, /dashboard/, /login/, /signup/, /thank-you/
├── sitemap.xml                   Public pages only (/, /privacy/, /terms/, /data-deletion/)
├── assets/
│   ├── css/paper.css             Design system: tokens, nav, hero, sections, preview, footer
│   ├── css/workspace.css         Auth screens + workspace layout + mobile breakpoints
│   ├── css/fonts.css             24 @font-face rules (latin + latin-ext), self-hosted
│   ├── fonts/*.woff2             14 files, ~460 KB total
│   ├── js/main.js                Nav, FAQ, contact form, preview tabs, typewriter, year
│   ├── js/auth.js                signup / login / logout / session / profile
│   ├── js/workspace.js           Accounts, inbox, send, templates, automations, logs
│   └── img/                      logo-mark.png, app-icon-1024.png, founder.jpg
└── docs/
    ├── WEBSITE-HANDBOOK.md       ← this document
    ├── plan.md                   Build plan + review checklist
    ├── brief-1-hindi.txt         Original requirements (Hindi)
    ├── brief-2-hindi.txt         Original requirements, part 2
    ├── reference_design.jpg      Visual reference
    ├── source-founder.png        Original founder photo
    └── source-anvayra-automation.png
```

**No frameworks, no package.json, no build step.** `docs/` is excluded from search engines but
is still publicly fetchable on a static host — move it outside the deploy root if that matters.

---

## 5. Public website — page by page

### 5.1 `index.html` — the marketing + review page

One continuous page. All navigation is in-page anchors except the dashboard/login links.

#### Header (sticky, `.site-head`)

| Element | Label | Destination / action |
|---|---|---|
| Brand | Anvayra (logo tile + "AUTOMATION STUDIO") | `./index.html` |
| Nav | Services | `#services` |
| Nav | How it works | `#how` |
| Nav | Platform | `#platform` |
| Nav | About | `#about` |
| Nav | FAQ | `#faq` |
| Nav | Contact | `#contact` |
| Text link | Client dashboard → | `./dashboard.html` (session guard redirects to login) |
| Button | Connect WhatsApp | `./dashboard.html` |
| Burger | opens `#mobileMenu` | mobile only (≤980 px) |

#### 5.1.1 Hero (`.hero`)

- Eyebrow pill: “WhatsApp Business Platform · Tech Provider applicant”.
- Right tag: “Meta App Review ready”.
- H1: **“Your business on WhatsApp, *running itself.*”** — Cormorant Garamond 400, italic rust
  emphasis, `clamp()` sizing (72–80 px desktop).
- Lead paragraph: official Cloud API positioning, “You keep the WhatsApp app. We run the system
  behind it.”
- Three CTAs:
  - **Connect WhatsApp** → `./dashboard.html` (primary, rust)
  - **Book a free demo** → `#contact`
  - **Client login** → `./login.html`
- Trust note: official onboarding, no password sharing, deletion on request.
- Right column: four stats — 2 min connection, 24/7 replies, 3 permissions, 7-day deletion.
- Background: oversized “ANVAYRA” watermark, paper grain (CSS only, no images).

#### 5.1.2 Trust marquee (`.trust-marquee`)

Infinite right-to-left CSS animation, duplicated track for seamlessness. Keywords:
WhatsApp Business Cloud API · Meta Embedded Signup · n8n automation backend · Business
verification ready · Sole proprietor · India · WhatsApp Coexistence · Cloud API v21.0 ·
Template messaging · Opt-in & STOP compliance · Secure webhooks · Multi-account dashboard ·
Data deletion in 7 days · AI agents · Meta App Review ready.

Pauses on hover; respects `prefers-reduced-motion` (animation disabled).

#### 5.1.3 Services (`#services`)

Six numbered paper cards, each with title, description, 3 bullets:

1. WhatsApp AI agent — 24/7 first response, service/pricing answers, human handover.
2. Lead follow-up — sequences, CRM/sheet sync, owner alerts.
3. Appointment reminders — 24 h & 2 h, confirm/reschedule, no-show reduction.
4. Template campaigns — creation support, opt-in management, sent/delivered/read logs.
5. n8n workflow automation — custom workflows, webhooks, error alerts & retries.
6. AI voice calling *(add-on badge)* — inbound calls, calendar booking, summaries.

#### 5.1.4 How it works (`#how`)

Four steps: **Connect your business** (Embedded Signup, no password sharing) → **Select your
number** (WABA ID + Phone Number ID appear) → **Approve a template** (or plain-text test to your
own number) → **Send & track** (delivery status + webhook events in the activity log).

#### 5.1.5 Platform / live product preview (`#platform`)

Left: pitch + checklist (connect, see IDs, send a real test message, review status/webhooks,
disconnect + delete) + **Open client dashboard** button.

Right: a **fully interactive** preview of the workspace (`#homePreview`), not an image.
Six tabs; each swaps a panel:

| Tab | Panel contents |
|---|---|
| Overview | Connection card (masked WABA ID / Phone Number ID), “Send test message” button, typewritten log: `message queued → delivered → read → reply received · webhook 200` |
| Connect | “Official Meta Embedded Signup. Your password is never shared.” + Connect button + Business/Status fields + log: code received → token exchanged server-side → webhook subscribed 200 |
| Send message | Recipient + message preview + Send button + typewritten sent/delivered/read |
| Templates | Three templates with Approved/In review states |
| Activity | Webhook log including `message queued · id wamid…`, delivered, read, reply 200, `STOP handled · opt-out saved` |
| Settings | WABA/Phone IDs + “access token stored in n8n only”, webhook verified, deletion on request |

Typewriter: `typeLog()` in `main.js` re-types the source lines of the active panel when a tab is
clicked, 9–14 ms per character, 220 ms pause between lines. It starts when the preview scrolls
into view (IntersectionObserver, threshold 0.35) or when any tab is clicked. Rapid tab switching
cancels the previous run via a monotonic `typingToken`.

#### 5.1.6 Permissions (`#permissions`)

Three cards, each labelled with access level, permission code and business reason:
`whatsapp_business_messaging` (Advanced), `whatsapp_business_management` (Advanced),
`business_management` (Required for onboarding).

Below: **Security & compliance** list — Secrets (only in n8n), Consent (opt-in only), STOP
(immediate suppression), Retention (90 days), Deletion (7 days).

Reviewer card (`#reviewers`): five-step “Test the full flow in 5 minutes” + business identity and
support contacts. *Note: this card references the older single-form flow; the workspace login
details are in Section 13 of this handbook and should be added to the card before submission.*

#### 5.1.7 About (`#about`)

Founder photo, name, role, pull-quote. Right: brand story (“anvaya” = connection), sole
proprietor statement, Tech Provider application statement, and a facts grid (legal entity,
location, email, phone/WhatsApp).

#### 5.1.8 FAQ (`#faq`)

Six accordion items (one open at a time, `aria-expanded` managed by `main.js`):

1. Do I need to stop using the WhatsApp app on my phone?
2. What permissions does Anvayra request?
3. Are my customers messaged without consent?
4. Where is my data stored?
5. How long does setup take?
6. Can I disconnect and delete everything?

#### 5.1.9 Contact (`#contact`)

Left: copy + four quick-contact rows (email, phone, `wa.me` link, address).

Right: `#leadForm` with:

| Field | Name | Required | Validation |
|---|---|---|---|
| Your name | `name` | yes | non-empty |
| Business name | `business` | no | — |
| Email | `email` | yes | regex `^[^\s@]+@[^\s@]+\.[^\s@]+$` |
| WhatsApp number | `phone` | yes | non-empty |
| What do you need? | `service` | no | select, 7 options |
| Briefly, what should we fix? | `message` | no | — |
| Consent checkbox | `consent` | yes | must be checked |

On submit (`main.js`):

```js
POST https://teamapexgaming.app.n8n.cloud/webhook/meta-app-verification/lead
{
  "name": "...", "business": "...", "email": "...", "phone": "...",
  "service": "...", "message": "...",
  "consent": true,
  "consentText": "I agree to be contacted on WhatsApp about my enquiry.",
  "consentAt": "2026-10-24T09:00:00.000Z",
  "source": "meta-app-verification-site",
  "page": "/"
}
```

Success → `thank-you.html?name=<first name>` (the page injects the first name).
Failure → inline message with the fallback email; the button resets to “Try again”. The form never
navigates away on error and no data is silently discarded.

#### 5.1.10 Closing CTA + footer

- CTA band: “Ready to put WhatsApp to work?” → Connect WhatsApp / Chat on WhatsApp (`wa.me`).
- Footer: brand, three link columns (Product, Company, Legal), email.
- Copyright: © 2026 Anvayra · Operated by Shivam Kushwah, sole proprietor.

### 5.2 `thank-you.html`

`noindex`. Reads `?name=` and greets the visitor by first name. Static confirmation only — no
server state, so refreshing is harmless.

### 5.3 Legal pages

| Page | Sections |
|---|---|
| `/privacy/` | Who we are · Data we collect · WhatsApp & Meta Platform Data · How we use data · Sharing/sub-processors · Retention · Rights · Security · Children · International transfers · Changes · Contact |
| `/terms/` | Services · Client responsibilities · Meta & WhatsApp compliance · Fees/billing · Data/accounts/ownership · IP · Availability/support · Disclaimers/liability · Suspension · Changes · Governing law |
| `/data-deletion/` | What to include · What we delete · What may be retained · Deleting data held by Meta · Disconnecting · Timeline (7 days) · Escalation · Contact |

All three carry the same business identity and are linked from the footer, the dashboard and the
signup consent line — reviewers check for that consistency.

---

## 6. Authentication (login & signup)

### 6.1 Production model (v2.0)

Authentication is **Supabase Auth** (project `nbxsebcrcussmmxismsa`) — real users in
`auth.users`, profiles in `public.profiles`, workspaces in `public.workspaces`. Sessions are
JWTs managed by supabase-js v2 (auto-refresh, persisted under localStorage key
`anvayra.auth.v2`). The old localStorage user store, salted SHA-256 hashing, 12-hour
hand-rolled sessions and the lazily-seeded demo user are **removed**.

- Pages load `@supabase/supabase-js@2` from jsDelivr, then `assets/js/auth.js`.
- `window.AnvayraAuth` keeps its public surface (`getSession`, `requireSession`, `login`,
  `signup`, `logout`, `updateProfile`) plus `signInWithGoogle` / `signInWithFacebook`;
  `getSession`/`requireSession` are now **async**.
- `requireSession()` → `supabase.auth.getUser()` + `profiles` row; unauthenticated →
  `/login/?next=<path>` (open-redirect safe).
- `updateProfile()` writes to `public.profiles` under RLS and keeps auth metadata in step.
- Email confirmation is ON: signups get a "check your inbox" state before they can sign in.
- The one-time legacy namespace migration adopts a returning user's old
  `anvayra.workspace.v1.<random-id>` blob under the new key `anvayra.workspace.v1.<auth uid>`.

### 6.2 Screens

**`/login/`** — split layout:
- Left (dark): brand, “Every WhatsApp account, *one calm inbox.*”, three proof points, founder quote.
- Right (paper): official-style **Continue with Google** button, "or" divider, email + password
  fields, **Sign in to workspace →**; links to signup and the website; legal line.
- The **Reviewer demo access** box is hidden from the public page and appears only with
  `?reviewer=1` (linkable from App Review notes), with a **Fill demo credentials →** button.

**`/signup/`** — same split:
- Fields: name*, business, work email*, password* (min 8), Terms/Privacy checkbox*.
- Google button on top; **Create workspace →** runs `supabase.auth.signUp` with
  `full_name` / `business_name` metadata → the `on_auth_user_created` trigger provisions
  profile + workspace + owner membership. With email confirmation ON, the UI shows a
  "check your inbox" state instead of redirecting.
- Legacy `login.html` / `signup.html` root paths are 0-second redirect stubs.

### 6.3 Reviewer account (real Supabase user)

| Field | Value |
|---|---|
| Email | `demo@anvayra.app` |
| Password | `anvayra2026` |
| User ID | `37b9c643-989b-41b2-bbba-976f21858a38` |
| Provisioned | server-side via SQL into `auth.users` + `auth.identities` (email-confirmed); the `on_auth_user_created` trigger created profile + workspace + owner membership |
| Workspace | Anvayra Automation (live slot) + Lotus Dental, Sunrise Realty, Cafe Mocha House, Fitloop Studio |

Verified live: password grant → `200` + access token; wrong password → `400`.

### 6.4 Google OAuth activation (one step pending)

The client-side flow is complete (`signInWithOAuth({ provider: 'google', redirectTo:
origin + '/dashboard/' })`). To switch it on:

1. Google Cloud Console → OAuth consent screen: app *Anvayra*, support email
   `shivamkushwahsironj@gmail.com`, scopes `email` + `profile`.
2. Create an OAuth Client ID (Web) with redirect URI
   `https://nbxsebcrcussmmxismsa.supabase.co/auth/v1/callback`.
3. Supabase Dashboard → Authentication → Providers → Google → enable with that Client ID/Secret.
4. Add the production domain to Google "Authorized domains" once the final domain is live.

Facebook Login is deliberately deferred to a second Meta App so it cannot jeopardise the
WhatsApp `whatsapp_business_messaging` review; the client code (`signInWithFacebook`) is
already in place.

### 6.5 Swapping the workspace document to the server

The workspace document still lives in localStorage (`anvayra.workspace.v1.<auth users.id>`,
Section 10) and is planned to move to the `workspaces`/related Postgres tables with Realtime
in P4 — see `docs/plan.md`. Auth itself is fully server-side today.

---

## 7. The workspace (`dashboard.html`)

Single document; views are `<section class="ws-view">` toggled by `data-view`. State lives in
`workspace.js` and persists on every mutation.

### 7.1 Left rail

- Brand → `index.html`.
- **Primary nav** (5): Inbox (with unread count), Contacts, Templates, Automations, Settings.
- **WhatsApp accounts**: header + `+` button (`#addAccount` → opens Embedded Signup), then one row
  per account: avatar initials, name, `LIVE|SETUP|DEMO · last-4`, status dot.
  Clicking a row switches the whole workspace (inbox, contacts, templates, settings) to that account.
- **User footer**: avatar, name, email, **Sign out**.

Accounts seeded:

| id | Name | Number | Kind | Initial state |
|---|---|---|---|---|
| `acc_real` | Anvayra Support (demo user) / business name (new users) | +91 91658 26867 (demo user only) | real | `SETUP` until IDs saved |
| `acc_lotus` | Lotus Dental Clinic | +91 90000 11121 | demo | connected (simulated) |
| `acc_sunrise` | Sunrise Realty | +91 90000 22232 | demo | connected |
| `acc_mocha` | Cafe Mocha House | +91 90000 33343 | demo | connected |
| `acc_fitloop` | Fitloop Studio | +91 90000 44454 | demo | connected |

### 7.2 Top bar

Hamburger (mobile) · account name + badge (`Live · Cloud API` / `Setup · Cloud API` /
`Demo · sandbox`) · number + connection status · **Website** (desktop only) · **Connect WhatsApp →**.

### 7.3 Inbox

- **Search** filters the current account’s threads by name or number.
- **Thread list**: avatar, name, last message preview (`You:` prefix when outbound), relative time,
  unread badge.
- **Chat header**: back (mobile), avatar, name, E.164-ish number, consent state
  (“Opted in · 24h window open” or “Opted out · marketing blocked”).
- **Message log**: day separators (Today / Yesterday / date), inbound bubbles left (paper),
  outbound right (green), per-message time, delivery tick:
  `✓ queued` (single tick), `✓✓ delivered/read`, `!` failed; optional error line.
- **Composer**: auto-growing textarea (44–130 px), **Send →**, Enter sends / Shift+Enter newline,
  hint shows live vs demo behaviour.

### 7.4 Contacts

Table of the current account’s threads: Contact, Number, Last message (truncated), Consent pill
(Opted in / Opted out), **Open chat** (switches to Inbox and opens the thread).

### 7.5 Templates

Five cards: `appointment_reminder`, `enquiry_followup`, `order_update` (In review), `payment_link`,
`review_request` — each shows category · language · Cloud API, body, and **Use in chat →**.
Using a template loads it into the composer with placeholders converted to editable hints:
`{{1}} → [name]`, `{{2}} → [detail]`, `{{3}} → [link]`.

### 7.6 Automations

Six cards, each with a switch and state label:
Instant first reply · Lead capture to sheet · Appointment reminders · STOP/opt-out handler
(all initially on); Human handover · Daily owner digest (off). Toggling writes to local state and
the activity log. **Not connected to n8n workflow activation today (G-8).**

### 7.7 Settings

Left column:
1. **Connect WhatsApp Business** — opens Embedded Signup; live status line.
2. **Connection details** — Phone Number ID, WABA ID, **Save connection details**, read-only
   Status/WABA/Phone/Webhook/Graph rows, **Disconnect this account**.
3. **Profile** — name, business, **Save profile**.
4. **Data deletion** — link to policy + **Clear local workspace data** (confirm dialog, wipes only
   this user’s workspace key, reloads).

Right column:
1. **Activity log** — last 40 entries, newest first, colour-coded (`ok`/`err`), **Clear log**,
   **Check webhook** (GET health).
2. **Provider details** — legal entity, location, Meta App ID, Embedded Signup config, backend,
   support email, legal links.
3. **Reviewer note** — explains what is reachable and which accounts are simulated.

### 7.8 Toasts

Bottom-right, auto-hide after 3.4 s, `bad` variant for failures. One toast at a time.

### 7.9 Responsive behaviour

| Breakpoint | Behaviour |
|---|---|
| > 1080 px | Rail 258 px; inbox list 310 px + chat |
| 861–1080 px | Inbox list 265 px; panels single-column |
| ≤ 860 px | Rail becomes a fixed drawer (hamburger, overlay, close button); inbox list and chat are mutually exclusive; chat gets a back button; body locked to viewport height; composer pinned above the safe area; Website button hidden; header compacted to two rows |

---

## 8. WhatsApp integration — end to end

### 8.1 Meta objects you need to know

| Object | What it is | Where it appears |
|---|---|---|
| Meta App | Container for permissions, webhooks, Embedded Signup config | App ID `1111754955165517` |
| Business Portfolio | The legal business that owns assets | Business ID `983719140695281` |
| WABA | WhatsApp Business Account — owns numbers and templates | `wabaId` |
| Phone Number ID | Cloud API identifier for one sending number | `phoneNumberId` |
| Access token | Bearer token for Graph API calls | n8n only |
| App Secret | Signs webhook payloads | n8n only |

### 8.2 Connecting a real account — two supported paths

#### Path A — Meta Embedded Signup (intended production path)

This is the flow Meta reviewers expect for a Tech Provider. Implemented in
`workspace.js → openEmbeddedSignup()`.

**Step 1 — load the SDK**

```html
<script async defer crossorigin="anonymous"
        src="https://connect.facebook.net/en_US/sdk.js"></script>
```

`window.fbAsyncInit` runs `FB.init({ appId: '1111754955165517', version: 'v21.0', xfbml: true })`.

**Step 2 — launch the dialog**

```js
FB.login(handler, {
  config_id: '1469679065081628',   // Embedded Signup configuration
  response_type: 'code',
  override_default_response_type: true,
  extras: { setup: {}, sessionInfoVersion: '3' }
});
```

This opens Meta's own window. The user signs in to Facebook, picks (or creates) a Business
Portfolio, a WABA and a phone number, and grants the requested permissions. **The user's
password never reaches Anvayra.**

**Step 3 — receive the result (two channels, both handled)**

1. **`FB.login` callback** returns `authResponse.code` when `response_type=code`.
2. **`postMessage` events** from `facebook.com` with `type: "WA_EMBEDDED_SIGNUP"`:
   - `event: "FINISH"` → payload may include `waba_id` and `phone_number_id`
   - `event: "CANCEL"` → logged, status line updated
   - `event: "ERROR"` → logged with detail

**Step 4 — exchange the code server-side**

```js
POST https://teamapexgaming.app.n8n.cloud/webhook/whatsapp-callback
{
  "code": "<authResponse.code>",
  "wabaId": "<optional current value>",
  "phoneNumberId": "<optional current value>",
  "redirect_uri": "https://<deployed-origin>/"
}
```

The n8n workflow (`Anvayra - Fixed WhatsApp Callback`, credential `Meta App Credentials`)
exchanges the code for an access token, subscribes the app to the WABA, and is expected to return:

```json
{ "wabaId": "…", "phoneNumberId": "…" }
```

The dashboard accepts either camelCase or snake_case (`waba_id`, `phone_number_id`), then stores
the IDs on the active account and marks it connected.

> **Verification status:** the exchange endpoint is external and was *not* re-tested end-to-end in
> this build. The response contract above is what the frontend consumes. Test with a real test
> business before the review recording (see G-6).

**Step 5 — what is stored where**

| Value | Browser | n8n |
|---|---|---|
| WABA ID | yes (workspace doc) | yes (exchange result) |
| Phone Number ID | yes (workspace doc) | yes |
| Access token | **never** | yes, encrypted credential |
| App Secret | **never** | yes, credential |

#### Path B — manual entry (fastest for a single owned number)

Settings → Connection details:

1. Meta App Dashboard → WhatsApp → API Setup → copy **Phone Number ID**.
2. Copy **WhatsApp Business Account ID**.
3. Paste both, **Save connection details**.
4. The account badge changes from `SETUP · CLOUD API` to `LIVE · Cloud API`.

This is how Anvayra's own number should be enabled for the review demo. It stores IDs only; the
token still comes from the n8n credential.

### 8.3 Sending a message

#### 8.3.1 UI flow

1. Select the account in the rail.
2. Open a conversation (or a demo thread).
3. Type in the composer, press **Send →** or Enter.
4. A bubble is appended immediately with status `queued`; the message is persisted before the
   network call, so nothing is lost on reload.
5. Demo account → local simulation. Live account → HTTP request.

#### 8.3.2 Wire format (live account)

```http
POST https://teamapexgaming.app.n8n.cloud/webhook/meta-app/send
Content-Type: application/json

{
  "to": "919876543210",
  "message": "Hello! Your appointment is confirmed.",
  "phoneNumberId": "771234567890123",
  "accountId": "acc_real"
}
```

- `to` is digits only (country code, no `+`, no spaces).
- `accountId` is informational for logging; n8n ignores it.
- `phoneNumberId` is mandatory — the published workflow's IF node rejects the request with
  **400** `Bad request: "to", "message" and "phoneNumberId" fields are required.` if any is empty.

#### 8.3.3 n8n path for the send

```
C1. Webhook Send Request (POST /webhook/meta-app/send, responseMode=responseNode, CORS *)
  → C2. IF to && message && phoneNumberId non-empty
      ├─ true  → C3. WhatsApp node (operation: send, credential "WhatsApp account")
      │            phoneNumberId = body.phoneNumberId
      │            recipient     = body.to
      │            text          = body.message
      │          → C4. Respond Message Sent (200, WhatsApp node output)
      └─ false → C5. Respond Bad Request (400, text)
```

Success body includes the Graph API result, e.g.:

```json
{ "messaging_product": "whatsapp",
  "contacts": [{ "input": "919876543210", "wa_id": "919876543210" }],
  "messages": [{ "id": "wamid.HBgM…" }] }
```

The dashboard extracts `messages[0].id` (fallback `messageId`, `id`) as the `wamid` and shows
`Accepted by Cloud API · wamid …`.

#### 8.3.4 Error handling

| Condition | UI result | Log |
|---|---|---|
| No Phone Number ID | Bubble `failed` + “No Phone Number ID saved for this account.” | `Send blocked — Phone Number ID missing` |
| Non-2xx from n8n | Bubble `failed` with Meta's message (max 220 chars) | `Send failed — <message>` |
| Network/CORS error | Bubble `failed` with the thrown message | same |
| Meta rejects (e.g. 131047 outside 24 h window, 131026 undeliverable) | Bubble `failed`, Meta text surfaced | same |

> The live path has not been exercised with a real token in this build because the Phone Number ID
> was not available. The request/response contract was verified against the published workflow
> definition. See G-10 for the exact test to run.

#### 8.3.5 Message status model

| Status | Meaning | Tick |
|---|---|---|
| `queued` | Stored locally, request not yet acknowledged | `✓` |
| `sending` | Request in flight (live) | `✓` |
| `sent` | Accepted by n8n / Graph API | `✓` |
| `delivered` | Demo simulation step 2 (live delivery comes from webhooks, not implemented) | `✓✓` |
| `read` | Demo simulation step 3 | `✓✓` |
| `failed` | Blocked or rejected; `error` field carries the reason | `!` |

**Demo timing:** sent at 350 ms, delivered at 1 100 ms, read at 2 100 ms, simulated inbound reply at
3 000 ms (only if “Instant first reply” automation is on). Replies rotate per account to feel
natural. Every demo action is written to the activity log with the word “Demo” or “Simulated”.

### 8.4 Receiving messages

`POST https://teamapexgaming.app.n8n.cloud/webhook/meta-app-verification`

- Node `B2. Normalize Incoming Message` extracts:
  `eventName`, `fromNumber`, `messageBody`, `contactName`, `receivedAt`.
- Node `B3. Respond 200 OK` returns `{"received":true,"status":"ok"}` immediately.

**Current limitation:** normalized fields are not written anywhere and the dashboard does not read
them. The inbox is seeded + locally simulated. Real inbound display requires persistence and a
fetch/subscription layer (G-4).

Webhook subscription fields requested: `messages`, `message_template_status_update`.

### 8.5 Webhook verification

`GET https://teamapexgaming.app.n8n.cloud/webhook/meta-app-verification?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`

- Token compared to `anvayra-meta-verify-1111754955165517`.
- Match → raw challenge echoed, `200`, `Content-Type: text/plain`.
- Mismatch → `403 Forbidden: wrong verify token`.

This is the URL and token to paste into Meta App Dashboard → WhatsApp → Configuration.

### 8.6 Demo simulation vs real sending — exact behaviour

| Account kind | Bubble | Network | Status source | Reply |
|---|---|---|---|---|
| `demo` (4 tenants) | Green/paper bubble | none | local timers | canned inbound reply after 3 s |
| `real` + Phone ID | Green bubble | `POST /meta-app/send` | HTTP response | none (a real reply would arrive by webhook, not shown — G-4) |
| `real` without Phone ID | Failed bubble | none | validation | none |

### 8.7 WhatsApp Coexistence

Coexistence lets a number keep the WhatsApp Business app while also using the Cloud API. It is a
Meta-managed onboarding track. Requirements in practice (subject to Meta's current policy):

- A WhatsApp Business app account eligible for coexistence.
- Business verification (Anvayra has this).
- Onboarding performed through a supported flow (Embedded Signup variant) with Meta approval.
- App Review approval for the messaging/management permissions used afterwards.

Nothing in this codebase enables Coexistence by itself. The site positions it as planned, which is
accurate. Do not tell a client it is "available" until Meta confirms onboarding.

---

## 9. n8n backend

### 9.1 Workflow 1 — `meta-app-verification` (published)

- **ID:** `tfcSmIkGlNdySVxH`
- **URL:** https://teamapexgaming.app.n8n.cloud/workflow/tfcSmIkGlNdySVxH
- **Shape:** 14 nodes, 4 groups (verification, incoming, leads, health)
- **Active:** yes

| Route | Method | Behaviour |
|---|---|---|
| `/webhook/meta-app-verification` | GET | Verify token → echo challenge (200) or 403 |
| `/webhook/meta-app-verification` | POST | Normalize Meta event → 200 JSON |
| `/webhook/meta-app-verification/lead` | POST | Validate name/email/phone/consent → 200 `{received:true}` or 400 |
| `/webhook/meta-app-verification/health` | GET | `{status:"ok", …}` for uptime checks |

### 9.2 Workflow 2 — `meta-app` (published, reused for sending)

- **ID:** `wawF9BanacoQKK9k`
- **URL:** https://teamapexgaming.app.n8n.cloud/workflow/wawF9BanacoQKK9k
- **Nodes:** 13, three independent webhook branches (verify, receive, send)
- **Credential:** `WhatsApp account` (`3g9xCjWEuzqXksPj`)

Why two workflows: `meta-app` already held the WhatsApp credential and a working send node. Reusing
it avoided touching a proven path; `meta-app-verification` was added for review-specific routes
(health, lead, consent). Merging them is optional and carries regression risk.

### 9.3 Workflow 3 — Embedded Signup callback (external, pre-existing)

`Anvayra - Fixed WhatsApp Callback` — accepts the OAuth code and exchanges it for a token using
`Meta App Credentials` (`7iCOA2dURcaImBAl`). Contract consumed by the dashboard:

```
POST /webhook/whatsapp-callback  { code, wabaId?, phoneNumberId?, redirect_uri }
→ { wabaId | waba_id, phoneNumberId | phone_number_id }
```

### 9.4 Credentials inventory

| Name | ID | Used by | Contains |
|---|---|---|---|
| WhatsApp account | `3g9xCjWEuzqXksPj` | `meta-app` send node | Access token + WhatsApp account context |
| Meta App Credentials | `7iCOA2dURcaImBAl` | signup callback | App ID + App Secret |

Never copy these values into the frontend, this document, screenshots, or the repo.

---

## 10. Data model & storage

### 10.1 Workspace document (`anvayra.workspace.v1.<userId>`)

```jsonc
{
  "version": 1,
  "createdAt": "2026-10-24T09:00:00.000Z",
  "activeAccountId": "acc_real",
  "accounts": [
    {
      "id": "acc_real",
      "name": "Anvayra Support",
      "number": "+91 91658 26867",
      "phoneNumberId": "",
      "wabaId": "",
      "kind": "real",          // "real" | "demo"
      "connected": false
    }
  ],
  "threads": {
    "acc_real": [
      {
        "id": "th_real_1",
        "name": "Aarav Mehta",
        "number": "+91 98200 44531",
        "optIn": true,
        "messages": [
          {
            "id": "m_ab12cd34",
            "dir": "in",                 // "in" | "out"
            "text": "Hi, I saw your website…",
            "at": "2026-10-24T08:00:00.000Z",
            "status": "read",            // outbound only
            "unread": false,
            "wamid": "wamid…",           // live sends only
            "error": "…"                 // failed sends only
          }
        ]
      }
    ]
  },
  "templates": [
    { "id": "tpl_x", "name": "appointment_reminder", "category": "UTILITY",
      "lang": "en", "status": "approved", "body": "Hello {{1}}, …" }
  ],
  "automations": [
    { "id": "auto_reply", "name": "Instant first reply", "desc": "…", "enabled": true }
  ],
  "activity": [
    { "at": "2026-10-24T09:01:00.000Z", "message": "Workspace loaded…", "kind": "ok" }
  ]
}
```

### 10.2 State transitions

- `save()` is called after every mutation (send, status change, toggle, profile, thread open).
- `load()` validates the shape; corrupt/legacy data falls back to `seed()`.
- Switching accounts resets the active thread to that account’s first thread and clears search.
- Opening a thread clears its unread flags.
- `wipeLocalBtn` removes only the current user’s key, then reloads.
- `seed()` differs by user: the reviewer (`usr_demo`) gets Anvayra Support with 2 threads; a new
  signup gets “Your business” with 0 threads, plus the four demo tenants.

### 10.3 What is *not* persisted

- No server copy, no cross-device sync, no multi-user sharing.
- Inbound webhook events are not stored at all.
- Message delivery/read receipts from Meta are not consumed.

---

## 11. Configuration reference

All values below are public identifiers or URLs. Secrets are intentionally absent.

| Constant | Value | File / line |
|---|---|---|
| Meta App ID | `1111754955165517` | `workspace.js` `CONFIG.appId` |
| Embedded Signup configuration ID | `1469679065081628` | `CONFIG.configId` |
| Graph API version | `v21.0` | `CONFIG.graphVersion` |
| Business Portfolio ID | `983719140695281` | Meta / dashboard provider card |
| Send endpoint | `https://teamapexgaming.app.n8n.cloud/webhook/meta-app/send` | `CONFIG.sendUrl` |
| Signup callback | `https://teamapexgaming.app.n8n.cloud/webhook/whatsapp-callback` | `CONFIG.callbackUrl` |
| Health endpoint | `https://teamapexgaming.app.n8n.cloud/webhook/meta-app-verification/health` | `CONFIG.healthUrl` |
| Lead endpoint | `https://teamapexgaming.app.n8n.cloud/webhook/meta-app-verification/lead` | `main.js` `SITE.leadWebhookUrl` |
| Verify endpoint | `https://teamapexgaming.app.n8n.cloud/webhook/meta-app-verification` | Meta dashboard |
| Verify token | `anvayra-meta-verify-1111754955165517` | Meta dashboard + workflow |
| Redirect URI | `window.location.origin + "/"` | `CONFIG.redirectUri` |
| Canonical / sitemap host | `https://anvayra.vercel.app` | `index.html`, `sitemap.xml`, `robots.txt` |
| Fallback contact email | `shivamkushwahsironj@gmail.com` | `main.js`, legal pages |

**Before deploying to a new domain, update:** canonical link, OG tags, `sitemap.xml`, `robots.txt`,
Meta App Domains, Valid OAuth Redirect URIs, and the signup callback's expected `redirect_uri`.

---

## 12. Security model

### 12.1 What is protected

- App Secret and WhatsApp access token exist only in n8n credentials.
- The browser receives WABA/Phone IDs (not secret) and message content it already displays.
- Passwords are salted and hashed; plaintext is never stored.
- `?next` redirects are constrained to a simple filename pattern.
- No third-party scripts except the Facebook JS SDK on the dashboard; fonts are self-hosted.

### 12.2 What is *not* protected yet (must be fixed before production)

1. **Send endpoint is unauthenticated and `Access-Control-Allow-Origin: *`.** Anyone who learns
   the URL can send WhatsApp messages on Anvayra's credential — a direct abuse and billing risk.
2. **No webhook signature verification.** Meta signs POST bodies with `X-Hub-Signature-256`
   (HMAC-SHA256 of the raw body using the App Secret). The workflow accepts any POST.
3. **Lead endpoint is unauthenticated and CORS-open.** Spam/abuse possible; no rate limit, no
   CAPTCHA, no honeypot.
4. **Client-side auth.** A user can edit `localStorage` and impersonate another local workspace.
   Acceptable only because no server data is exposed.
5. **No CSP, no HSTS config** (host-dependent). Add security headers at the edge.
6. **Access tokens for multiple tenants are not isolated** — see 8.6 and G-5.

### 12.3 Recommended hardening (in order)

1. Add a shared secret header or HMAC signature to `/meta-app/send`; reject anything unsigned.
2. Verify `X-Hub-Signature-256` on `/webhook/meta-app-verification` before normalizing.
3. Restrict CORS to the deployed origin.
4. Rate-limit send + lead (per IP and per account), add a honeypot to the form.
5. Move auth and workspace data to a server (Supabase) with row-level security.
6. Store per-tenant tokens encrypted, never in a shared credential.
7. Add CSP: `default-src 'self'; connect-src 'self' https://teamapexgaming.app.n8n.cloud https://connect.facebook.net; frame-src https://www.facebook.com; img-src 'self' data:`.

---

## 13. Meta App Review playbook

### 13.1 Prerequisites checklist

- [x] Business verification completed (Anvayra / Shivam Kushwah).
- [x] Public website with product description, pricing/contact, and legal pages.
- [x] Privacy Policy URL, Terms URL, Data Deletion URL (live).
- [x] App in Live mode (required before review).
- [x] Webhook callback + verify token configured.
- [x] Embedded Signup configuration created.
- [x] Reviewer login that works on a clean browser.
- [ ] Phone Number ID saved so the reviewer can perform a **real** send.
- [ ] Screencast recorded (Section 13.3).
- [ ] Permission justifications written (Section 13.4).

### 13.2 Reviewer instructions (current, accurate)

1. Open the site → **Client login**.
2. Sign in with `demo@anvayra.app` / `anvayra2026` (or click “Fill demo credentials”).
3. The workspace opens with five accounts. `Anvayra Support` is the Cloud API account.
4. Click a demo tenant (e.g. Lotus Dental) → open a thread → send a message → watch
   `queued → sent → delivered → read` and the simulated reply (activity log shows `webhook 200`).
5. Go to `Anvayra Support` → **Settings** → paste Phone Number ID / WABA ID → save → return to
   Inbox → send → status `sent` with `wamid`.
6. **Connect WhatsApp Business** (top-right or Settings) opens Meta Embedded Signup; after
   completion the WABA/Phone IDs populate automatically.
7. **Check webhook** in Settings shows `Online · 200 OK`.
8. **Sign out** from the rail.

> Update the on-site reviewer card (`#reviewers`) to match these steps before submitting — it
> currently describes the older single-form dashboard.

### 13.3 Screencast script (2–4 minutes, no cuts in the critical path)

1. (10 s) Home page, scroll once, show permissions section and legal footer links.
2. (15 s) Open Privacy and Data Deletion pages in new tabs.
3. (20 s) Login with the demo account; show the five accounts switching.
4. (30 s) Demo send on Lotus Dental: show queued → delivered → read and the reply; open Activity
   to show webhook 200.
5. (60 s) `Anvayra Support` → Settings → enter Phone Number ID → save → send to an opted-in
   number → show `wamid` and the real message arriving on a phone (screen-record the phone or
   show a second device).
6. (20 s) Click Connect WhatsApp → complete Embedded Signup with a test business → show the IDs.
7. (20 s) Show incoming reply reaching the webhook (n8n execution or Meta webhook log), HTTP 200.
8. (10 s) Sign out.

Record at 1080p, English narration or captions, no background music needed.

### 13.4 Permission justifications (draft)

**`whatsapp_business_messaging`**
> Anvayra provides a shared inbox and automation for businesses that connect their own WhatsApp
> Business Account. We send customer-service replies, approved template messages on explicit
> opt-in, and automated follow-ups. The reviewer can exercise sending from the dashboard after
> connecting a test WABA; every send is initiated by a visible user action.

**`whatsapp_business_management`**
> We display the connected WABA, its phone numbers and its message templates so the business can
> confirm which number is active and choose an approved template. The dashboard shows WABA ID and
> Phone Number ID and lists templates with their approval status.

**`business_management`**
> Used solely to complete Embedded Signup so a client can grant access to the specific business
> assets they choose. We do not access other businesses or assets the client did not select.

### 13.5 Common rejection reasons to pre-empt

| Rejection | Cause | Mitigation in this build |
|---|---|---|
| “Could not reproduce the use case” | Reviewer cannot log in / no test data | Demo credentials on the login page + seeded threads |
| “Permission not used in the product” | Requested scopes with no visible feature | Each permission has a matching section and UI surface |
| “Screencast does not show the flow” | Edited video, missing send | Script above records the full path |
| “App not in Live mode” | Review submitted in Development | Flip to Live before submitting |
| “Website not reachable / legal pages missing” | Dead links, placeholder pages | All pages static and linked; link check passes |

### 13.6 Coexistence submission note

If asked about Coexistence in the review or partner application, state plainly:

> “Coexistence is not yet enabled for this app. We are applying for the standard Cloud API
> permissions and Embedded Signup now; Coexistence onboarding will be requested separately once
> the app is approved, because it requires Meta's eligibility review and a number currently on the
> WhatsApp Business app.”

---

## 14. Deployment & operations

### 14.1 Run locally

```bash
cd /home/ronny/Desktop/meta-app
python3 -m http.server 4173
# open http://localhost:4173/
```

No install step. Do not open via `file://` if you need WebCrypto (the hash falls back, but
Embedded Signup and fetch behave differently).

### 14.2 Deploy (Vercel / Netlify / any static host)

1. Upload the folder (excluding `docs/` if you prefer it private).
2. Framework preset: **Other / static**; no build command; output directory `.`.
3. Add the custom domain and HTTPS.
4. Update canonical/OG/`sitemap.xml`/`robots.txt` to the new domain.
5. Meta App Dashboard → Settings → Basic:
   - App Domains: new domain + `teamapexgaming.app.n8n.cloud`
   - Valid OAuth Redirect URIs: `https://<domain>/`
6. Meta App Dashboard → WhatsApp → Configuration:
   - Callback URL: `https://teamapexgaming.app.n8n.cloud/webhook/meta-app-verification`
   - Verify token: `anvayra-meta-verify-1111754955165517`
   - Subscribe: `messages`, `message_template_status_update`
7. Smoke test: home → login → demo send → settings health check → contact form.

### 14.3 Post-deploy smoke test (5 minutes)

| Test | Expected |
|---|---|
| `GET /` | 200, hero + nav render, no console errors |
| Click every nav anchor | Scrolls to the right section |
| Contact form with consent | Redirect to `thank-you.html` |
| Contact form without consent | Inline error, no navigation |
| Login wrong password | Inline “does not match” error |
| Login demo | Dashboard, 5 accounts |
| Demo send | queued → sent → delivered → read + reply |
| Settings → Check webhook | `Online · 200 OK` |
| Live send with Phone ID | `sent` + wamid |
| Mobile 390 px | Drawer, chat, composer all usable |

### 14.4 Rollback

Static site: redeploy the previous commit/zip. n8n: workflows are versioned — republish the prior
version. No database migrations exist today.

---

## 15. Verification log

Performed 24 October 2026 on the local build (`python3 -m http.server 4173`).

| Check | Result |
|---|---|
| `node --check` on `main.js`, `auth.js`, `workspace.js` | Pass |
| Internal link crawl across all HTML | 0 broken |
| Homepage at 1440 × 1000 | Hero, marquee, 6 preview tabs render |
| Preview typewriter | `queued → delivered → read → reply · webhook 200` |
| Demo login | Session created, redirect to dashboard |
| Signup | User created, `?welcome=1`, Settings view + toast |
| Workspace accounts | 5 rendered, correct `LIVE/SETUP/DEMO` labels |
| All five views | Contacts 2 rows, Templates 5 cards, Automations 6, Settings 11 provider rows, Inbox 2 threads |
| Demo send sampling (300 ms) | queued → sent (600 ms) → delivered (1 200 ms) → read (2 100 ms) → reply (3 000 ms) |
| Real send without Phone ID | Failed bubble + explicit toast; no network call |
| Template → composer | `[name]`/`[detail]`/`[link]` placeholders inserted |
| Automation toggle | State + activity log entry |
| Search no-match | “No conversation matches that search.” |
| Profile save | Toast + rail updated; session persisted |
| Mobile 390 × 844 | Chat composer visible, header 2 rows, drawer works |
| Meta verify GET (correct token) | 200 + challenge |
| Meta verify GET (wrong token) | 403 |
| Health endpoint | 200 JSON |
| Lead with consent | 200 `{received:true}` |
| Lead without consent | 400 |
| CORS preflight | 204 with matching origin |

Not verified (blocked on external inputs): a real Cloud API send, Embedded Signup token exchange
end-to-end, real inbound message persistence.

---

## 16. Gap register — what is not production-ready

| # | Gap | Severity | Impact | Owner | Fix |
|---|---|---|---|---|---|
| G-1 | Client-side auth; workspace in `localStorage` | ~~High~~ → **Auth RESOLVED (v2.0)**: Supabase Auth live with real users, JWT sessions, RLS-backed profiles; *workspace document still in localStorage* (P4 will move it to Postgres + Realtime) | High | No real multi-user security; data per browser only | Eng | Supabase Auth + `workspaces` table + RLS |
| G-2 | Send endpoint unauthenticated, CORS `*` | High | Anyone can send on our credential; billing abuse | Eng | HMAC/shared secret, origin allowlist, rate limit |
| G-3 | No `X-Hub-Signature-256` verification | High | Forged webhook events accepted | Eng | Verify HMAC with App Secret before processing |
| G-4 | Inbound messages are not stored or displayed | High | Real replies never appear in the inbox; demo only | Eng | Persist events; add fetch/Realtime to dashboard |
| G-5 | Single shared WhatsApp credential | High | Cannot send for client WABAs legitimately | Eng | Per-tenant token vault from Embedded Signup |
| G-6 | Signup token-exchange contract untested | Medium | Connect flow may fail on response shape | Eng | Live test, then pin the contract |
| G-7 | Templates/automations are UI only | Medium | No Graph API template CRUD; toggles do nothing | Eng | Template sync; workflow activation API |
| G-8 | STOP/opt-out is described, not implemented server-side | Medium | Compliance promise not enforced automatically | Eng | Suppression table + pre-send check |
| G-9 | Domain hardcoded to `anvayra.vercel.app` | Low | Wrong canonical/OG/sitemap after deploy | Eng | Environment-based config or search/replace |
| G-10 | No real send test in this environment | High (for review) | Reviewer may see `SETUP` instead of a working send | Owner+Eng | Enter Phone Number ID/WABA, run test, record |
| G-11 | No automated tests / CI | Low | Regressions caught manually | Eng | Playwright smoke + link check |
| G-12 | Coexistence not enabled | Expected | Cannot use Business app + API on one number yet | Meta | Separate onboarding application |
| G-13 | 90-day retention stated, not enforced | Medium | Policy claim without a deletion job | Eng | Scheduled purge or documented manual process |
| G-14 | Reviewer card on homepage describes the old flow | Low | Reviewer confusion | Eng | Update to login + demo credentials |

---

## 17. Roadmap to production

**Phase 1 — close the security holes (1–2 days)**
- Sign `/meta-app/send` with an HMAC or shared secret; restrict CORS.
- Verify `X-Hub-Signature-256` in the verification workflow.
- Rate-limit lead + send; add a form honeypot.

**Phase 2 — real accounts and data (3–5 days)**
- Supabase: `profiles`, `workspaces`, `accounts`, `threads`, `messages`, `templates`,
  `automations`, `activity`, `suppressions` with RLS by workspace.
- Supabase Auth (email/password or magic link); remove demo auth from production build.
- Move workspace `save()`/`load()` to API calls; keep the same UI.
- Token vault: store per-account tokens encrypted (pgcrypto/KMS), never in a shared n8n credential.

**Phase 3 — real inbound (2–3 days)**
- Persist normalized webhook events; link by `phone_number_id` → workspace.
- Dashboard subscribes (Realtime or polling) and renders real threads.
- Handle delivery/read status webhooks; replace simulated ticks.
- Enforce STOP server-side before every marketing send.

**Phase 4 — templates & automation (3–4 days)**
- Graph API template list/create/delete; approval status sync.
- Automation switches map to real n8n workflow activation (n8n API) with per-workspace credentials.
- Add an outbound queue with retries and error visibility.

**Phase 5 — operations**
- Playwright smoke suite + link checker in CI.
- Uptime monitor on `/health`; alerting to email/Telegram.
- Retention job (90 days) and documented deletion runbook.
- Logging/audit trail per workspace; no message bodies in logs by default.

---

## 18. Glossary

| Term | Meaning |
|---|---|
| **WABA** | WhatsApp Business Account — owns numbers and templates |
| **Phone Number ID** | Cloud API identifier for a sending number (not the phone number itself) |
| **Cloud API** | Meta-hosted WhatsApp API used here (Graph `v21.0`) |
| **Embedded Signup** | Meta's in-app onboarding dialog that returns a WABA and number with user consent |
| **Tech Provider / BSP** | Meta partner status that allows onboarding other businesses |
| **Coexistence** | Running the WhatsApp Business app and Cloud API on the same number |
| **Template** | Pre-approved message format required outside the 24-hour service window |
| **24-hour window** | Period after a user's last message in which free-form replies are allowed |
| **wamid** | WhatsApp message ID returned by the send API |
| **Opt-in / STOP** | Consent to receive messages / user's withdrawal keywords |
| **App Secret** | Meta app credential used to sign and verify webhook payloads |

---

## 19. Handover checklist

**Access & credentials**
- [ ] n8n workspace access (workflows `tfcSmIkGlNdySVxH`, `wawF9BanacoQKK9k`, callback workflow).
- [ ] Meta App Dashboard access (App `1111754955165517`).
- [ ] Hosting account + domain DNS.
- [ ] Business Portfolio access (`983719140695281`).

**Values to collect from Meta**
- [ ] Phone Number ID for the live number.
- [ ] WABA ID for the live number.
- [ ] Confirmation of the Embedded Signup config (`1469679065081628`) and its allowed domains.
- [ ] App Review status / any open reviewer questions.

**Before the review submission**
- [ ] Save Phone Number ID + WABA ID; run one real send; confirm wamid.
- [ ] Run one live inbound message; confirm the webhook execution shows 200.
- [ ] Update the homepage reviewer card to the login-based flow (G-14).
- [ ] Record the screencast per Section 13.3.
- [ ] Paste the permission justifications from 13.4.
- [ ] Confirm App is in Live mode and the callback URL/token match Section 11.

**Engineering acceptance**
- [ ] G-2 and G-3 fixed (send auth + webhook signature).
- [ ] Decision recorded: demo auth stays for review only; production build uses Supabase.
- [ ] `docs/` excluded from the public deploy (or accepted as public).
- [ ] Domain constants updated (G-9).

---

*End of handbook. Keep this file in sync with the code; the "as built" sections are the source of
truth for anyone joining the project.*
