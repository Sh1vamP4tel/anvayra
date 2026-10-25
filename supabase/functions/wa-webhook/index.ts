// Anvayra — wa-webhook: Meta WhatsApp webhook endpoint (production)
// GET  → hub.challenge handshake (verify token: WHATSAPP_VERIFY_TOKEN)
// POST → X-Hub-Signature-256 (HMAC-SHA256 of APP_SECRET) verified, idempotent
//        persist into webhook_events, then fan out: inbound messages →
//        contacts/threads/messages, statuses → message_status_events + message
//        updates, STOP keywords → suppressions. Unknown-signature events are
//        stored but never processed. Always answers 200 to Meta.
import { createClient } from "jsr:@supabase/supabase-js@2";

const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ??
  "anvayra-meta-verify-1111754955165517";
const APP_SECRET = Deno.env.get("META_APP_SECRET"); // set later via secrets
const STOP_RE = /^\s*(stop|unsubscribe|cancel|end|block)\b/i;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function signatureMatches(secret: string, raw: string, header: string | null): Promise<boolean> {
  if (!header || !header.startsWith("sha256=")) return false;
  const given = header.slice("sha256=".length).trim().toLowerCase();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  /* ---------------- GET: webhook verification handshake ---------------- */
  if (req.method === "GET") {
    const params = new URL(req.url).searchParams;
    const mode = params.get("hub.mode");
    const token = params.get("hub.verify_token");
    const challenge = params.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  /* ---------------- POST: verify signature, persist, process ---------------- */
  const raw = await req.text();
  const given = (req.headers.get("x-hub-signature-256") ?? "").trim().toLowerCase();

  let sigState: "verified" | "invalid" | "unconfigured" = "unconfigured";
  if (APP_SECRET) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(APP_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
    const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const expected = "sha256=" + hex;
    if (given.length === expected.length) {
      let diff = 0;
      for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
      sigState = diff === 0 ? "valid" : "invalid";
    } else {
      sigState = "invalid";
    }
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ ok: true, note: "unparseable payload stored/ignored" });
  }

  const client = supabase;

  // Idempotency key: first entry id + first change field. Meta may redeliver.
  const entry = payload?.entry?.[0];
  const change = entry?.changes?.[0];
  const eventKey = "wm:" + (entry?.id ?? "noentry") + ":" + (change?.field ?? "unknown");

  let inserted: { id: number } | null = null;
  let evErrMsg = "";
  try {
    const { data, error: evErr } = await client
      .from("webhook_events")
      .upsert(
        {
          event_key: eventKey,
          source: "meta",
          signature_valid: sigState === "valid",
          payload: payload,
        },
        { onConflict: "event_key", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();
    if (evErr) evErrMsg = evErr.message;
    inserted = data;
  } catch (e) {
    evErrMsg = String(e?.message ?? e);
  }
  if (evErrMsg) {
    console.error("webhook_events insert failed:", evErrMsg);
    return json({ error: "storage error" }, 500);
  }

  if (!inserted) {
    return json({ ok: true, duplicate: true }); // already seen — ack, do not reprocess
  }

  if (sigState !== "valid") {
    await client
      .from("webhook_events")
      .update({ processed_at: new Date().toISOString(), error: "signature " + sigState })
      .eq("event_key", eventKey);
    // 200 so Meta does not retry-storm; the event is retained unprocessed.
    return json({ ok: true, note: "signature " + sigState });
  }

  try {
    await processChange(change);
    await client.from("webhook_events").update({ processed_at: new Date().toISOString() }).eq("event_key", eventKey);
  } catch (err) {
    console.error("processing error:", err?.message ?? err);
    await client.from("webhook_events").update({ error: String(err?.message ?? err) }).eq("event_key", eventKey);
  }
  return json({ ok: true });

  /* ------------------------- processing ------------------------- */
  async function accountFor(phoneNumberId: string) {
    const { data } = await client
      .from("whatsapp_accounts")
      .select("id, workspace_id, label")
      .eq("phone_number_id", String(phoneNumberId))
      .maybeSingle();
    return data;
  }

  async function processChange(change: any): Promise<void> {
    if (!change || change.field !== "messages") return;
    const value = change.value ?? {};
    const accountId: string | undefined = value.metadata?.phone_number_id;

    let account = null;
    if (accountId) {
      const { data } = await client
        .from("whatsapp_accounts")
        .select("id, workspace_id")
        .eq("phone_number_id", String(accountId))
        .maybeSingle();
      account = data;
    }
    if (!account) {
      console.warn("no whatsapp_account for phone_number_id", accountId);
      return;
    }
    const workspaceId: string = account.workspace_id;

    // ---- inbound messages ----
    for (const msg of value.messages ?? []) {
      const from: string = msg.from;
      const profileName: string | undefined = value.contacts?.[0]?.profile?.name;

      // contacts upsert
      await client.from("contacts").upsert(
        {
          workspace_id: workspaceId,
          wa_id: from,
          name: profileName ?? null,
          opt_in_state: "unknown",
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,wa_id" },
      );
      const { data: contact } = await client
        .from("contacts")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("wa_id", from)
        .maybeSingle();
      if (!contact) continue;

      // thread upsert
      let threadId: string | undefined;
      const { data: thread } = await client
        .from("threads")
        .select("id")
        .eq("account_id", account.id)
        .eq("contact_id", contact.id)
        .maybeSingle();
      if (thread) {
        threadId = thread.id;
      } else {
        const { data: created } = await client
          .from("threads")
          .insert({ workspace_id: workspaceId, account_id: account.id, contact_id: contact.id, status: "open" })
          .select("id")
          .single();
        threadId = created?.id ?? undefined;
      }
      if (!threadId) continue;

      const body = typeof msg.text?.body === "string" ? msg.text.body : null;
      const ts = msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString();

      await client.from("messages").upsert(
        {
          workspace_id: workspaceId,
          thread_id: threadId,
          account_id: account.id,
          direction: "in",
          type: msg.type ?? "unknown",
          body: body,
          payload: msg,
          wamid: msg.id ?? null,
          status: "received",
          sent_at: ts,
        },
        { onConflict: "wamid" },
      );

      await client
        .from("threads")
        .update({
          last_message_at: ts,
          last_message_preview: (body ?? "[" + (msg.type ?? "media") + "]").slice(0, 140),
          unread_count: 1,
          status: "open",
          updated_at: new Date().toISOString(),
        })
        .eq("id", threadId);

      // opt-out keywords → suppression (compliance)
      if (body && STOP_RE.test(body)) {
        await client.from("suppressions").upsert(
          {
            workspace_id: workspaceId,
            wa_id: from,
            reason: "user opted out (STOP keyword)",
            source: "inbound-message",
          },
          { onConflict: "workspace_id,wa_id" },
        );
      }
    }

    // ---- delivery statuses ----
    for (const st of value.statuses ?? []) {
      const at = st.timestamp ? new Date(Number(st.timestamp) * 1000).toISOString() : new Date().toISOString();
      await client.from("message_status_events").insert({
        wamid: st.id,
        status: st.status,
        occurred_at: at,
        payload: st,
      });
      const patch: Record<string, unknown> = { status: st.status };
      if (st.status === "delivered") patch.delivered_at = at;
      if (st.status === "read") patch.read_at = at;
      if (st.status === "failed") {
        patch.error_code = String(st.errors?.[0]?.code ?? "");
        patch.error_message = st.errors?.[0]?.title ?? null;
      }
      await client.from("messages").update(patch).eq("wamid", st.id);
    }
  }
});
