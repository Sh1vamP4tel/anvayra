// Anvayra — wa-send: send a WhatsApp Cloud API message (production)
// POST { accountId, to, text } | { accountId, to, templateName, templateLang }
// Auth: Supabase user JWT (Authorization: Bearer <access token>). Caller must
// be a member of the workspace that owns the account. The WhatsApp token comes
// from the server-side vault via get_wa_token(); never exposed to browsers.
import { createClient } from "jsr:@supabase/supabase-js@2";

const GRAPH_VERSION = Deno.env.get("GRAPH_VERSION") ?? "v21.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

function digitsOnly(s: string): string {
  return s.replace(/[^\d]/g, "");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const jwt = bearer(req);
  if (!jwt) return json({ error: "missing bearer token" }, 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { auth: { persistSession: false }, global: { headers: { Authorization: "Bearer " + jwt } } },
  );
  const { data: authData } = await userClient.auth.getUser();
  const user = authData?.user;
  if (!user) return json({ error: "invalid session" }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const accountId: string | undefined = body?.accountId;
  const to: string | undefined = body?.to;
  const text: string | undefined = body?.text;
  const templateName: string | undefined = body?.templateName;
  const templateLang: string = typeof body?.templateLang === "string" ? body.templateLang : "en";
  if (!accountId || !to || (!text && !templateName)) {
    return json({ error: "accountId, to, and text or templateName are required" }, 400);
  }

  // account + workspace membership check (BOLA-safe)
  const { data: account } = await supabase
    .from("whatsapp_accounts")
    .select("id, workspace_id, phone_number_id, status, is_demo, label")
    .eq("id", String(accountId))
    .maybeSingle();
  if (!account) return json({ error: "unknown account" }, 404);

  const { data: member } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", account.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return json({ error: "not a member of this workspace" }, 403);

  if (account.is_demo) {
    return json({ error: "This is a demo account — connect a real WhatsApp number first." }, 400);
  }
  if (account.status !== "connected" || !account.phone_number_id) {
    return json({ error: "This account is not connected yet." }, 400);
  }

  const toDigits = digitsOnly(String(to));

  // suppression check (compliance)
  const { data: suppressed } = await supabase
    .from("suppressions")
    .select("reason")
    .eq("workspace_id", account.workspace_id)
    .eq("wa_id", toDigits)
    .maybeSingle();
  if (suppressed) {
    return json({ error: "This recipient opted out — sending is blocked.", reason: suppressed.reason }, 403);
  }

  // simple per-workspace rate limit: 60 sends / minute
  const windowKey = "send:" + account.workspace_id + ":" + Math.floor(Date.now() / 60000);
  const { data: rl } = await supabase
    .from("rate_limits")
    .select("count")
    .eq("key", windowKey)
    .maybeSingle();
  if (rl && rl.count >= 60) return json({ error: "Rate limit reached — try again in a minute." }, 429);

  // token from server-side vault (never stored client-side)
  const { data: token, error: tokenErr } = await supabase.rpc("get_wa_token", { p_account_id: account.id });
  if (tokenErr || !token) {
    return json({ error: "No WhatsApp access token stored for this account. Reconnect the account." }, 400);
  }

  // Graph API send
  const graphBody = templateName
    ? {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toDigits,
        type: "template",
        template: { name: templateName, language: { code: templateLang } },
      }
    : {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toDigits,
        type: "text",
        text: { preview_url: false, body: String(text) },
      };

  let result: any = null;
  try {
    const resp = await fetch(
      "https://graph.facebook.com/" + GRAPH_VERSION + "/" + account.phone_number_id + "/messages",
      {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify(graphBody),
      },
    );
    result = await resp.json();
  } catch (err) {
    result = { error: { message: "Graph request failed: " + String(err?.message ?? err) } };
  }

  const wamid: string | null = result?.messages?.[0]?.id ?? null;
  const graphError = result?.error ?? null;

  // resolve contact + thread for logging (both success and failure paths)
  const { data: contact } = await supabase
    .from("contacts")
    .upsert(
      {
        workspace_id: account.workspace_id,
        wa_id: toDigits,
        opt_in_state: "unknown",
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,wa_id" },
    )
    .select("id")
    .single();
  let threadId: string | null = null;
  if (contact) {
    const { data: thread } = await supabase
      .from("threads")
      .select("id")
      .eq("account_id", account.id)
      .eq("contact_id", contact.id)
      .maybeSingle();
    if (thread) {
      threadId = thread.id;
    } else {
      const { data: created } = await supabase
        .from("threads")
        .insert({ workspace_id: account.workspace_id, account_id: account.id, contact_id: contact.id, status: "open" })
        .select("id")
        .single();
      threadId = created?.id ?? null;
    }
  }

  if (graphError || !wamid) {
    if (threadId) {
      await supabase.from("messages").insert({
        workspace_id: account.workspace_id,
        thread_id: threadId,
        account_id: account.id,
        direction: "out",
        type: templateName ? "template" : "text",
        body: templateName ?? text,
        payload: graphBody,
        wamid: null,
        status: "failed",
        error_code: String(graphError?.code ?? ""),
        error_message: graphError?.message ?? "Graph API error",
        sent_at: new Date().toISOString(),
        created_by: user.id,
      });
    }
    await supabase.from("activity_log").insert({
      workspace_id: account.workspace_id,
      actor_id: user.id,
      action: "send.failed",
      detail: graphError?.message ?? "Graph API error",
      kind: "error",
    });
    return json({ error: graphError?.message ?? "Graph API error", details: graphError }, 502);
  }

  // success: persist outbound message + thread preview + rate limit + activity
  if (threadId) {
    const nowIso = new Date().toISOString();
    await supabase.from("messages").upsert(
      {
        workspace_id: account.workspace_id,
        thread_id: threadId,
        account_id: account.id,
        direction: "out",
        type: templateName ? "template" : "text",
        body: templateName ? "template:" + templateName : text,
        payload: { request: graphBody, response: result },
        wamid: wamid,
        status: "sent",
        sent_at: nowIso,
        created_by: user.id,
      },
      { onConflict: "wamid" },
    );
    await supabase
      .from("threads")
      .update({
        last_message_at: nowIso,
        last_message_preview: (templateName ? "[" + templateName + "] " : "") + (text ?? "").slice(0, 140),
        status: "open",
        updated_at: nowIso,
      })
      .eq("id", threadId);
  }

  if (rl) {
    await supabase.from("rate_limits").update({ count: rl.count + 1 }).eq("key", windowKey);
  } else {
    await supabase.from("rate_limits").insert({ key: windowKey, count: 1 });
  }

  await supabase.from("activity_log").insert({
    workspace_id: account.workspace_id,
    actor_id: user.id,
    action: "send.ok",
    detail: (templateName ? "template " + templateName + " " : "") + "to " + toDigits,
    kind: "ok",
  });

  return json({ ok: true, wamid });
});
