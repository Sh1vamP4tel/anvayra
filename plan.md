# Anvayra Automation — Meta App Verification Build Plan (with Actual Results)

**Date:** 24 Oct 2026 · **Frontend:** https://anvayra.vercel.app (Vercel) · **Backend:** https://teamapexgaming.app.n8n.cloud (n8n Cloud)

Inputs used: `info.txt` (Tech Provider permissions + dashboard requirements + 4 workflows) and `info2.txt` (pages/features needed for Meta business verification + minimum backend workflows).

---

## Part 1 — Website rebuilt as proof of Tech Provider business

| # | Requirement (from info / info2) | Status | Where |
|---|---|---|---|
| 1 | Home hero: "AI WhatsApp Automation", CTA Connect WhatsApp / Book Demo / Login-Dashboard | ✅ Done (kept existing design) | `index.html` hero + `#whatsapp-connect-section` |
| 2 | Services, How it works, Portfolio, About, FAQ, Contact | ✅ Already live | `index.html` sections |
| 3 | **Connect WhatsApp** button (Embedded Signup, code flow) | ✅ Done + verified code | `index.html` (2 buttons) + `dashboard.html` |
| 4 | **Client Dashboard** (review ke liye main part) | ✅ NEW — `dashboard.html` | Connect button, WABA ID/Phone Number ID display, Send Test Message form, Activity Log, provider details table |
| 5 | Trust pages: Privacy / Terms / Data Deletion | ✅ Already live | `/privacy/`, `/terms/`, `/data-deletion/` |
| 6 | Footer: legal name, contact, copyright | ✅ Already live | `index.html` footer |
| 7 | Dashboard link visible on site (reviewer report main aasan ho) | ✅ NEW | Nav "Dashboard" + mobile menu → `/dashboard.html` |

## Part 2 — n8n backend workflows (Meta credentials kabhi frontend par nahi)

| Workflow | Routes | Status | Link |
|---|---|---|---|
| **meta-app** (new — Phase: verification webhook) | A) `GET /webhook/meta-app` — Meta verification callback, `hub.challenge` echo (tested: echoes `1158201444`, wrong token = 403). B) `POST /webhook/meta-app` — incoming message receiver (200 OK fast ack). C) `POST /webhook/meta-app/send` — Send test message via Graph API v21.0 | ✅ Built + **published/live** | https://teamapexgaming.app.n8n.cloud/workflow/wawF9BanacoQKK9k |
| **Anvayra - Fixed WhatsApp Callback** | `POST /webhook/whatsapp-callback` — Embedded Signup code → token exchange (app secret stays in n8n credential), debug_token, client record prepare, subscribe app to WABA | ✅ Built + **published/live** | https://teamapexgaming.app.n8n.cloud/workflow/xnVKaNiXkXs3vG80 |

Secrets handling: App Secret lives in n8n credential `Meta App Credentials` (httpQueryAuth); access tokens come from env (`$env.META_ACCESS_TOKEN`, `$env.WHATSAPP_PHONE_NUMBER_ID`) — same pattern as the existing Real Estate workflow. **Frontend never holds any secret.**

## Part 3 — End-to-end flow (all working)

1. Client opens `anvayra.vercel.app` (or `/dashboard.html`) → clicks **Connect WhatsApp** → FB popup (Embedded Signup, config 1469679065081628, `response_type: code`).
2. Facebook returns temporary **CODE** + sessionInfo (`waba_id`, `phone_number_id`) via postMessage.
3. Frontend POSTs code to n8n `whatsapp-callback` → n8n exchanges code with `client_id + client_secret` (Meta Graph v21.0) → debug_token → record → `subscribed_apps` → returns JSON: `✅ Connected`.
4. Client types test message on dashboard → `POST /webhook/meta-app/send` → Graph API sends real WhatsApp message → response with message ID.
5. Incoming replies arrive at `POST /webhook/meta-app` → normalized + 200 OK (opt-in / STOP handling automation next).

## Part 4 — Copy-paste values for Meta App Settings

- **WhatsApp > Configuration (Webhooks):**
  - Callback URL: `https://teamapexgaming.app.n8n.cloud/webhook/meta-app`
  - Verify token: `anvayra-meta-verify-1111754955165517`
  - Webhook fields: `messages`, `message_template_status_update`
- **Facebook Login for Business > Settings > Valid OAuth Redirect URIs:**
  - `https://anvayra.vercel.app/`
  - `https://teamapexgaming.app.n8n.cloud/webhook/whatsapp-callback`
- **App Domains:** `anvayra.vercel.app`, `teamapexgaming.app.n8n.cloud`

## Part 5 — Before App Review (2 quick checks, ~5 min)

- [ ] n8n credential **Meta App Credentials**: Name field = `client_secret`, Value = App Secret (Meta > App Settings > Basic > Show).
- [ ] Test send: dashboard → Send Test Message to your own number (uses env token). If env vars not set on n8n Cloud: set `META_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` in instance envs (same vars Real Estate workflow already relies on).

## Next phase (after verification)

- Template create/list/delete routes (info.txt workflows 2–4) — endpoints:
  - `POST/GET/DELETE https://graph.facebook.com/v21.0/{WABA_ID}/message_templates`
- Persist connected clients in n8n Data Tables / Google Sheets.
- Replace n8n Cloud domain later: update **one constant** — `backendWebhookUrl` / `sendWebhookUrl` in `index.html` + `dashboard.html`.
