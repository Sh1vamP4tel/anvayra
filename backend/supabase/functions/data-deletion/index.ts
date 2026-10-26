// Anvayra — data-deletion: Meta Platform Data Deletion Request callback.
// POST: signed_request (HMAC-SHA256 with app secret) -> deletion_requests row
//       -> respond { url, confirmation_code } per Meta spec.
// GET  ?code=<confirmation_code> -> status JSON for the user-facing page.
// Also serves as the status endpoint Meta requires at data_deletion_callback_url.
// Requires META_APP_SECRET; falls back to recording requests with
// signature_valid=false when unset (never confirmed to Meta as verified).
import { createClient } from "jsr:@supabase/supabase-js@2";

const APP_SECRET = Deno.env.get("META_APP_SECRET");

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function code(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (req.method === "GET") {
    const reqCode = new URL(req.url).searchParams.get("code");
    if (!reqCode) return json({ error: "code query param required" }, 400);
    const { data } = await supabase
      .from("deletion_requests")
      .select("confirmation_code, status, requested_at, completed_at")
      .eq("confirmation_code", reqCode)
      .maybeSingle();
    if (!data) return json({ error: "unknown confirmation code" }, 404);
    return json({
      status: data.status,
      requested_at: data.requested_at,
      completed_at: data.completed_at,
      message: data.status === "completed"
        ? "Your data has been deleted."
        : "Your deletion request is pending. We will complete it within 30 days.",
    });
  }

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const form = await req.formData().catch(() => null);
  const signedRequest = form?.get("signed_request");
  if (!signedRequest || typeof signedRequest !== "string") {
    return json({ error: "signed_request required" }, 400);
  }

  const [sigB64, payloadB64] = signedRequest.split(".");
  let payload: any = {};
  let userId: string | null = null;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
    userId = payload?.user_id ?? null;
  } catch {
    return json({ error: "unparseable signed_request" }, 400);
  }

  let signatureValid = false;
  if (APP_SECRET && sigB64) {
    const expected = b64urlToHex(sigB64);
    const mac = await hmacHex(APP_SECRET, payloadB64);
    signatureValid = expected !== null && mac.length === expected.length &&
      mac.split("").every((c, i) => c === expected[i]);
  }

  const confirmation = code();
  const { error } = await supabase.from("deletion_requests").insert({
    confirmation_code: confirmation,
    meta_user_id: userId,
    status: "pending",
    details: { payload, signature_valid: signatureValid },
  });
  if (error) {
    console.error("deletion_requests insert failed:", error.message);
    return json({ error: "storage error" }, 500);
  }

  return json({
    url: "https://anvayra.vercel.app/deletion-status/?code=" + confirmation,
    confirmation_code: confirmation,
  });
});

function b64urlToHex(s: string): string | null {
  try {
    const bytes = b64urlDecode(s);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}
