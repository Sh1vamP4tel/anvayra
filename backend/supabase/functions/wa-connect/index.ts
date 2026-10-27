// Anvayra — wa-connect: Embedded Signup / token exchange callback (production)
// POST { code, workspaceId, wabaId?, phoneNumberId?, label? } with a user JWT.
// Exchanges the OAuth code for a token, upgrades to long-lived, inspects granted
// scopes, resolves the WABA + phone numbers, subscribes the app to the WABA
// webhook, stores the token in the server-side vault via store_wa_token(), and
// upserts whatsapp_accounts. Requires META_APP_ID + META_APP_SECRET secrets.
import { createClient } from "jsr:@supabase/supabase-js@2";

const GRAPH_VERSION = Deno.env.get("GRAPH_VERSION") ?? "v21.0";
const APP_ID = Deno.env.get("META_APP_ID") ?? "1111754955165517";
const APP_SECRET = Deno.env.get("META_APP_SECRET");

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

async function graph(path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + path + "?" + qs);
  return resp.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  if (!APP_SECRET) {
    return json({ error: "Server not configured: META_APP_SECRET missing." }, 503);
  }

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
  const code = body?.code;
  const workspaceId: string | undefined = body?.workspaceId;
  const explicitPhoneId: string | null = body?.phoneNumberId ? String(body.phoneNumberId) : null;
  const label: string = typeof body?.label === "string" && body.label.trim() ? body.label.trim() : "WhatsApp Business";
  if (!code || !workspaceId) return json({ error: "code and workspaceId are required" }, 400);

  // membership check
  const { data: member } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", String(workspaceId))
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return json({ error: "not a member of this workspace" }, 403);

  // 1) code -> short-lived user access token
  const shortTok = await graph("/oauth/access_token", {
    client_id: APP_ID,
    client_secret: APP_SECRET,
    code: String(code),
  });
  if (!shortTok?.access_token) {
    return json({ error: "token exchange failed", details: shortTok?.error ?? shortTok }, 400);
  }

  // 2) short-lived -> long-lived (60 days; refreshed on subsequent Embedded Signup)
  const longTok = await graph("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: APP_ID,
    client_secret: APP_SECRET,
    fb_exchange_token: shortTok.access_token,
  });
  const accessToken: string = longTok?.access_token ?? shortTok.access_token;
  if (!accessToken) return json({ error: "long-lived exchange failed", details: longTok?.error ?? null }, 502);

  // 3) inspect token: granted scopes + WABA ids
  const debug = await graph("/debug_token", {
    input_token: accessToken,
    access_token: APP_ID + "|" + APP_SECRET,
  });
  const scopes: string[] = debug?.data?.scopes ?? [];
  const wabaIds: string[] = (debug?.data?.granular_scopes ?? [])
    .filter((s: any) => s.scope === "whatsapp_business_management")
    .flatMap((s: any) => s.target_ids ?? []);

  // 4) resolve phone numbers (explicit Embedded Signup number, or first WABA)
  let wabaId: string | null = body?.wabaId ? String(body.wabaId) : (wabaIds[0] ?? null);
  let phones: Array<{ id: string; display_phone: string; name: string }> = [];
  async function loadPhones(id: string): Promise<Array<{ id: string; display_phone: string; name: string }>> {
    const pn = await graph("/" + id + "/phone_numbers", {
      access_token: accessToken,
      fields: "id,display_phone_number,verified_name",
      limit: "100",
    });
    return (pn?.data ?? []).map((p: any) => ({
      id: String(p.id),
      display_phone: p.display_phone_number,
      name: p.verified_name ?? p.display_phone_number,
    }));
  }
  if (wabaId) {
    phones = await loadPhones(wabaId);
    if (!phones.length) {
      // WABA id might be scoped differently; try every WABA returned by the token.
      for (const alt of wabaIds) {
        if (alt === wabaId) continue;
        const altPhones = await loadPhones(alt);
        if (altPhones.length) {
          wabaId = alt;
          phones = altPhones;
          break;
        }
      }
    }
  }
  if (explicitPhoneId) {
    const selected = phones.find((p) => p.id === explicitPhoneId);
    if (selected) {
      phones = [selected];
    } else {
      // The number was not in the WABA list; read it directly and verify it exists.
      const one = await graph("/" + explicitPhoneId, {
        access_token: accessToken,
        fields: "id,display_phone_number,verified_name",
      });
      if (one?.id) {
        phones = [{
          id: String(one.id),
          display_phone: one.display_phone_number,
          name: one.verified_name ?? one.display_phone_number,
        }];
      }
    }
  }
  if (!wabaId || !phones.length) {
    return json({ error: "No WhatsApp Business Account or phone numbers were shared. Complete Embedded Signup with all permissions granted.", scopes }, 400);
  }

  // 5) subscribe this app to the WABA so inbound messages and status events arrive.
  let webhookSubscribed = false;
  try {
    const subResp = await fetch(
      "https://graph.facebook.com/" + GRAPH_VERSION + "/" + wabaId + "/subscribed_apps",
      { method: "POST", headers: { Authorization: "Bearer " + accessToken } },
    );
    const subResult = await subResp.json().catch(() => ({}));
    webhookSubscribed = Boolean(subResp.ok && !subResult?.error);
    if (!webhookSubscribed) console.error("subscribed_apps failed:", JSON.stringify(subResult));
  } catch (err) {
    console.error("subscribed_apps request failed:", String((err as Error)?.message ?? err));
  }

  // 6) persist account rows + tokens (one per phone number)
  const created: Array<{ id: string; label: string; phone: string; phone_number_id: string }> = [];
  for (const p of phones) {
    const { data: acct, error: acctErr } = await supabase
      .from("whatsapp_accounts")
      .upsert(
        {
          workspace_id: String(workspaceId),
          label: phones.length > 1 ? label + " · " + p.display_phone : label,
          waba_id: wabaId,
          phone_number_id: p.id,
          display_phone: p.display_phone,
          business_name: p.name,
          status: "connected",
          connected_at: new Date().toISOString(),
        },
        { onConflict: "phone_number_id" },
      )
      .select("id, label, phone_number_id, display_phone")
      .single();
    if (acctErr) {
      console.error("whatsapp_accounts upsert failed:", acctErr.message);
      continue;
    }
    const { error: tokErr } = await supabase.rpc("store_wa_token", {
      p_account_id: acct.id,
      p_token: accessToken,
    });
    if (tokErr) console.error("store_wa_token failed:", tokErr.message);
    created.push({
      id: acct.id,
      label: acct.label ?? label,
      phone: p.display_phone,
      phone_number_id: p.id,
    });
  }

  await supabase.from("activity_log").insert({
    workspace_id: workspaceId,
    actor_id: user.id,
    action: "account.connected",
    detail: "WABA " + wabaId + " · " + phones.length + " number(s) · scopes: " + scopes.join(","),
    kind: "ok",
  });

  return json({ ok: true, wabaId, scopes, webhookSubscribed, accounts: created });
});
