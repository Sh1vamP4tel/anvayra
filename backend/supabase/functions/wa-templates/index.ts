// Anvayra — wa-templates: sync approved WhatsApp message templates (production)
// POST { accountId } with a user JWT. Reads the account's WABA from the database,
// fetches message templates from the Graph API with the server-side vault token,
// and upserts them into public.templates. The browser never sees the token.
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

const CATEGORIES = new Set(["MARKETING", "UTILITY", "AUTHENTICATION"]);
const STATUSES = new Set(["APPROVED", "PENDING", "REJECTED", "DISABLED", "PAUSED"]);

function bodyPreview(components: any): string {
  if (!Array.isArray(components)) return "";
  const body = components.find((c: any) => String(c?.type ?? "").toUpperCase() === "BODY");
  const text = body?.text ?? body?.example?.body_text?.[0] ?? "";
  return String(text).slice(0, 1000);
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
  const accountId = body?.accountId ? String(body.accountId) : "";
  if (!accountId) return json({ error: "accountId is required" }, 400);

  const { data: account } = await supabase
    .from("whatsapp_accounts")
    .select("id, workspace_id, waba_id, status")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) return json({ error: "unknown account" }, 404);

  const { data: member } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", account.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return json({ error: "not a member of this workspace" }, 403);

  if (account.status !== "connected" || !account.waba_id) {
    return json({ error: "This account is not connected yet." }, 400);
  }

  const { data: token, error: tokenErr } = await supabase.rpc("get_wa_token", { p_account_id: account.id });
  if (tokenErr || !token) {
    return json({ error: "No WhatsApp access token stored for this account. Reconnect the account." }, 400);
  }

  const qs = new URLSearchParams({
    fields: "id,name,language,category,status,components",
    limit: "200",
    access_token: String(token),
  });
  let payload: any = null;
  try {
    const resp = await fetch(
      "https://graph.facebook.com/" + GRAPH_VERSION + "/" + account.waba_id + "/message_templates?" + qs.toString(),
    );
    payload = await resp.json();
  } catch (err) {
    return json({ error: "Graph request failed: " + String((err as Error)?.message ?? err) }, 502);
  }

  if (payload?.error) {
    return json({ error: payload.error.message ?? "Graph API error", details: payload.error }, 502);
  }

  const rows = (Array.isArray(payload?.data) ? payload.data : [])
    .map((tpl: any) => {
      const category = String(tpl?.category ?? "UTILITY").toUpperCase();
      const status = String(tpl?.status ?? "PENDING").toUpperCase();
      return {
        workspace_id: account.workspace_id,
        account_id: account.id,
        name: String(tpl?.name ?? "").trim(),
        language: String(tpl?.language ?? "en").trim() || "en",
        category: CATEGORIES.has(category) ? category : "UTILITY",
        status: STATUSES.has(status) ? status : "PENDING",
        meta_template_id: tpl?.id ? String(tpl.id) : null,
        components: Array.isArray(tpl?.components) ? tpl.components : [],
        body_preview: bodyPreview(tpl?.components),
      };
    })
    .filter((tpl: any) => tpl.name);

  if (rows.length) {
    const { error: upsertErr } = await supabase
      .from("templates")
      .upsert(rows, { onConflict: "account_id,name,language" });
    if (upsertErr) {
      console.error("template upsert failed:", upsertErr.message);
      return json({ error: "Could not store templates: " + upsertErr.message }, 500);
    }
  }

  // Remove rows that Meta no longer returns for this WABA.
  const keep = new Set(rows.map((row: any) => row.name + "\u0000" + row.language));
  const { data: existing } = await supabase
    .from("templates")
    .select("id,name,language")
    .eq("account_id", account.id);
  const stale = (existing ?? [])
    .filter((row: any) => !keep.has(row.name + "\u0000" + row.language))
    .map((row: any) => row.id);
  if (stale.length) {
    await supabase.from("templates").delete().in("id", stale);
  }

  return json({
    ok: true,
    count: rows.length,
    removed: stale.length,
    synced_at: new Date().toISOString(),
  });
});
