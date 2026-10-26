// Anvayra — health: liveness/config probe for uptime checks and Meta review.
// GET /functions/v1/health -> { ok: true, ... } (no auth, no secrets leaked)
Deno.serve((_req: Request) => {
  return new Response(
    JSON.stringify({
      ok: true,
      service: "anvayra-meta-app",
      time: new Date().toISOString(),
      config: {
        webhook: true,
        appSecretConfigured: !!Deno.env.get("META_APP_SECRET"),
        systemTokenConfigured: !!Deno.env.get("WHATSAPP_SYSTEM_USER_TOKEN"),
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
});
