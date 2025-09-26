/**
 * app_6571a533ec_click
 * - Detects client IP & resolves country (alpha-2) using ipapi.co
 * - Records first-time IP-per-country (for "new" vs "repeat" blip)
 * - Increments country count atomically via RPC
 * - Returns { country_code, clicks, isNew }
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json",
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  try {
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { ok: false, request_id: requestId, error: "Missing Supabase envs" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Extract client IP
    const fwd = req.headers.get("x-forwarded-for") || "";
    const ip =
      (fwd.split(",")[0] || "").trim() ||
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-real-ip") ||
      "";

    // Resolve country (alpha-2)
    let country_code = "US";
    try {
      const url = `https://ipapi.co/${ip || ""}/json`;
      const res = await fetch(url, {
        headers: { "User-Agent": "mgx-app/1.0 (+https://mgx.dev)" },
      });
      if (res.ok) {
        const data = await res.json();
        const c = data?.country ? String(data.country).toUpperCase() : null;
        if (c && /^[A-Z]{2}$/.test(c)) {
          country_code = c;
        }
      }
    } catch (_e) {
      // ignore geo errors, fallback to default country_code
    }

    // First-time detection: insert ip+country
    let isNew = true;
    if (ip) {
      const { error: insertErr } = await supabase
        .from("app_6571a533ec_ip_clicks")
        .insert({ ip, country_code });

      if (insertErr) {
        // Unique violation or any other insert issue -> treat as repeat
        isNew = false;
      }
    } else {
      isNew = false;
    }

    // Atomic increment via RPC
    let clicks = 0;
    const { data: inc, error: incErr } = await supabase.rpc("app_6571a533ec_increment", {
      p_code: country_code,
    });
    if (incErr) {
      return json(500, {
        ok: false,
        request_id: requestId,
        error: incErr.message || "increment failed",
      });
    }
    clicks = typeof inc === "number" ? inc : 0;

    const duration = Date.now() - startedAt;
    return json(200, {
      ok: true,
      request_id: requestId,
      country_code,
      clicks,
      isNew,
      duration_ms: duration,
    });
  } catch (error) {
    return json(500, { ok: false, request_id: requestId, error: String(error) });
  }
});