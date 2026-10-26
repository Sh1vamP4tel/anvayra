// Anvayra — wa-lead: public contact-form intake (production).
// POST JSON { name, business, email, phone, message, consent, consentText, consentAt, source, page }
// Public (verify_jwt: false). Stores into public.leads via service role.
// Minimal abuse guards: honeypot field, size limit, per-source rate limit.
import { createClient } from "jsr:@supabase/supabase-js@2";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const raw = await req.text();
  if (raw.length > 8000) return json({ error: "payload too large" }, 413);

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  // honeypot: hidden field a human never fills
  if (body?.website && String(body.website).length > 0) {
    return json({ ok: true, ignored: true }); // bot — silently accept
  }

  const name = typeof body?.name === "string" ? body.name.slice(0, 200) : null;
  const business = typeof body?.business === "string" ? body.business.slice(0, 200) : null;
  const email = typeof body?.email === "string" ? body.email.slice(0, 254) : null;
  const phone = typeof body?.phone === "string" ? body.phone.slice(0, 60) : null;
  const message = typeof body?.message === "string" ? body.message.slice(0, 4000) : null;
  const consent = body?.consent === true;
  const consentText = typeof body?.consentText === "string" ? body.consentText.slice(0, 300) : null;
  const consentAt = typeof body?.consentAt === "string" && !isNaN(Date.parse(body.consentAt))
    ? body.consentAt
    : new Date().toISOString();
  const source = typeof body?.source === "string" && body.source.trim()
    ? body.source.trim().slice(0, 100)
    : "meta-app-verification-site";
  const page = typeof body?.page === "string" ? body.page.slice(0, 200) : null;

  if (!name && !email) return json({ error: "name or email required" }, 400);

  // basic rate limit: max 5 leads/minute per source+ip window
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const windowKey = "lead:" + source + ":" + ip + ":" + Math.floor(Date.now() / 60000);
  const { data: rl } = await supabase.from("rate_limits").select("count").eq("key", windowKey).maybeSingle();
  if (rl && rl.count >= 5) return json({ error: "too many submissions — try again in a minute." }, 429);

  const { error } = await supabase.from("leads").insert({
    source,
    page,
    name,
    business,
    email,
    phone,
    message,
    consent,
    consent_text: consentText,
    consent_at: consent ? consentAt : null,
    ip: ip === "unknown" ? null : ip,
  });
  if (error) {
    console.error("leads insert failed:", error.message);
    return json({ error: "storage error" }, 500);
  }

  if (rl) {
    await supabase.from("rate_limits").update({ count: rl.count + 1 }).eq("key", windowKey);
  } else {
    await supabase.from("rate_limits").insert({ key: windowKey, count: 1 });
  }

  return json({ ok: true });
});
