const allowedOrigin = Deno.env.get("DEMO_ALLOWED_ORIGIN");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const demoEmail = Deno.env.get("DEMO_EMAIL");
const demoPassword = Deno.env.get("DEMO_PASSWORD");

function respond(body: unknown, status: number, origin: string | null) {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  });

  if (origin && origin === allowedOrigin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }

  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (!allowedOrigin || !supabaseUrl || !supabaseAnonKey || !demoEmail || !demoPassword) {
    return respond({ error: "Demo login is not configured." }, 503, origin);
  }

  if (origin !== allowedOrigin) {
    return respond({ error: "Origin not allowed." }, 403, origin);
  }

  if (request.method === "OPTIONS") {
    return respond(null, 204, origin);
  }
  if (request.method !== "POST") {
    return respond({ error: "Method not allowed." }, 405, origin);
  }

  try {
    const authResponse = await fetch(
      `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          "apikey": supabaseAnonKey,
          "Authorization": `Bearer ${supabaseAnonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: demoEmail, password: demoPassword }),
      },
    );

    if (!authResponse.ok) {
      console.error("Demo account sign-in failed with status:", authResponse.status);
      return respond({ error: "Demo login is temporarily unavailable." }, 503, origin);
    }

    const session = await authResponse.json();
    if (typeof session.access_token !== "string" || typeof session.refresh_token !== "string") {
      console.error("Demo sign-in response did not contain a valid session.");
      return respond({ error: "Demo login is temporarily unavailable." }, 503, origin);
    }

    return respond({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    }, 200, origin);
  } catch (error) {
    console.error("Demo login request failed:", error instanceof Error ? error.message : "Unknown error");
    return respond({ error: "Demo login is temporarily unavailable." }, 503, origin);
  }
});
