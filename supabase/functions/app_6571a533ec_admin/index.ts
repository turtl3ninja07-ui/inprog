/* Admin Edge Function: app_6571a533ec_admin
   - Verifies admin by email and handles admin actions.
   - Adds 'accounts' action: returns total number of Supabase Auth users by paging.
   - CORS enabled; uses Supabase service role with user JWT forwarded.
*/
import { createClient } from 'npm:@supabase/supabase-js@2';

const ADMIN_EMAIL = 'stathisxilitshs@gmail.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders },
  });
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const method = req.method;

  if (method === 'OPTIONS') {
    // Preflight
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch (_e) {
    // optional body, ignore parse error
    payload = {};
  }

  // Init Supabase client with forwarded auth header to read user
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    console.error(JSON.stringify({ requestId, msg: 'Missing env', supabaseUrl: !!supabaseUrl, serviceKey: !!serviceKey }));
    return json(500, { ok: false, error: 'Server not configured', requestId });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });

  // Identify user
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) {
    console.error(JSON.stringify({ requestId, error: String(userErr) }));
  }
  const email = userData?.user?.email ?? undefined;
  const isAdmin = email ? email.toLowerCase() === ADMIN_EMAIL.toLowerCase() : false;

  const action = (payload?.action as string) || 'verify';
  console.log(JSON.stringify({ requestId, method, action, email, isAdmin }));

  // Always allow verify
  if (action === 'verify') {
    return json(200, { ok: true, isAdmin, email, requestId });
  }

  // Admin-only actions
  if (!isAdmin) {
    return json(403, { ok: false, error: 'Forbidden: not admin', requestId });
  }

  try {
    if (action === 'stats') {
      const now = new Date();
      const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
      const d7 = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
      const d30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

      const todayCountSel = await supabase
        .from('app_6571a533ec_click_events')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startToday.toISOString());

      const d7CountSel = await supabase
        .from('app_6571a533ec_click_events')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', d7.toISOString());

      const d30CountSel = await supabase
        .from('app_6571a533ec_click_events')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', d30.toISOString());

      const stats = {
        today: todayCountSel.count ?? 0,
        d7: d7CountSel.count ?? 0,
        d30: d30CountSel.count ?? 0,
      };
      return json(200, { ok: true, stats, requestId });
    }

    if (action === 'accounts') {
      // Page through users to compute total count
      let page = 1;
      const perPage = 200;
      let total = 0;
      for (let i = 0; i < 100; i++) { // safe cap
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
        if (error) throw error;
        const users = data?.users ?? [];
        total += users.length;
        const nextPage = (data as { nextPage?: number | null })?.nextPage ?? null;
        if (!nextPage || users.length === 0) break;
        page = nextPage;
      }
      return json(200, { ok: true, count: total, requestId });
    }

    if (action === 'list_blocked_ips') {
      const { data, error } = await supabase
        .from('app_6571a533ec_ip_blocklist')
        .select('ip, reason, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return json(200, { ok: true, items: data ?? [], requestId });
    }

    if (action === 'block_ip') {
      const ip = (payload?.ip as string | undefined)?.trim() ?? '';
      const reason = ((payload?.reason as string | undefined)?.trim() ?? null) || null;
      if (!ip) return json(400, { ok: false, error: 'IP required', requestId });
      const { error } = await supabase
        .from('app_6571a533ec_ip_blocklist')
        .upsert({ ip, reason }, { onConflict: 'ip' });
      if (error) throw error;
      return json(200, { ok: true, requestId });
    }

    if (action === 'unblock_ip') {
      const ip = (payload?.ip as string | undefined)?.trim() ?? '';
      if (!ip) return json(400, { ok: false, error: 'IP required', requestId });
      const { error } = await supabase
        .from('app_6571a533ec_ip_blocklist')
        .delete()
        .eq('ip', ip);
      if (error) throw error;
      return json(200, { ok: true, requestId });
    }

    if (action === 'reset_leaderboard') {
      // Clear aggregated counts and raw click events
      const cleared: string[] = [];
      const del1 = await supabase.from('app_6571a533ec_country_counts').delete().neq('country_code', '');
      if (!del1.error) cleared.push('country_counts');
      const del2 = await supabase.from('app_6571a533ec_click_events').delete().neq('ip', '');
      if (!del2.error) cleared.push('click_events');
      return json(200, { ok: true, cleared, requestId });
    }

    if (action === 'clear_abuse') {
      // Delete click events for blocked IPs
      const { data: blocked, error: be } = await supabase
        .from('app_6571a533ec_ip_blocklist')
        .select('ip');
      if (be) throw be;
      const ips = (blocked ?? []).map((b: { ip: string }) => b.ip).filter(Boolean);
      if (ips.length === 0) return json(200, { ok: true, deleted: 0, requestId });

      // Get count first
      const sel = await supabase
        .from('app_6571a533ec_click_events')
        .select('*', { count: 'exact', head: true })
        .in('ip', ips);
      const toDelete = sel.count ?? 0;

      const { error: delErr } = await supabase
        .from('app_6571a533ec_click_events')
        .delete()
        .in('ip', ips);
      if (delErr) throw delErr;

      return json(200, { ok: true, deleted: toDelete, requestId });
    }

    return json(400, { ok: false, error: 'Unknown action', requestId });
  } catch (e) {
    console.error(JSON.stringify({ requestId, error: String(e) }));
    return json(500, { ok: false, error: 'Server error', requestId });
  }
});