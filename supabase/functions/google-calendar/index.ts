const CALENDAR_ID = '5fb1a4d4b0ec39a32fcd94b99524368e3a5cf038807228cad9b3520761084924@group.calendar.google.com';
const env = (name: string) => { const v = Deno.env.get(name); if (!v) throw new Error(`Missing server configuration: ${name}`); return v; };
function supabaseKey(legacyName: string, dictionaryName: string): string {
  const legacy = Deno.env.get(legacyName);
  if (legacy) return legacy;
  const keys = JSON.parse(env(dictionaryName));
  const key = keys.default || Object.values(keys).find(v => typeof v === 'string' && v);
  if (typeof key !== 'string' || !key) throw new Error('Missing Supabase API key');
  return key;
}
type GoogleEvent = { id: string; status?: string; summary?: string; [key: string]: unknown };
async function jsonFetch(url: string, options: RequestInit = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`Upstream ${res.status}`); }
  return res.json();
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin') || '';
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(x => x.trim()).filter(Boolean);
  const cors = { 'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'https://invalid.local', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin', 'Cache-Control': 'no-store' };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (!allowed.includes(origin)) return reply({ error: 'Origin not allowed' }, 403);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  try {
    const base = env('SUPABASE_URL');
    const anon = supabaseKey('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS');
    const service = supabaseKey('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS');
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) return reply({ error: 'Войди через Google.' }, 401);
    const userHeaders = { apikey: anon, Authorization: authorization, 'Content-Type': 'application/json' };
    let user;
    try {
      user = await jsonFetch(`${base}/auth/v1/user`, { headers: userHeaders });
      const owner = await jsonFetch(`${base}/rest/v1/rpc/is_workspace_owner`, { method: 'POST', headers: userHeaders, body: '{}' });
      if (!owner) return reply({ error: 'Доступ только для владельца.' }, 403);
    } catch { return reply({ error: 'Вход истёк. Войди через Google ещё раз.' }, 401); }
    const raw = await req.text();
    if (raw.length > 200000) return reply({ error: 'Запрос слишком большой.' }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return reply({ error: 'Некорректный JSON.' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'Некорректный запрос.' }, 400);
    if (!['connect', 'list'].includes(body.action)) return reply({ error: 'Неизвестное действие.' }, 400);
    const tracked = Array.isArray(body.trackedIds) ? [...new Set(body.trackedIds)] : [];
    if (tracked.length > 2000 || tracked.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_@.-]{1,250}$/.test(id))) return reply({ error: 'Некорректный список мероприятий.' }, 400);
    // New sb_secret keys belong in apikey only; they are not JWT bearer tokens.
    const adminHeaders = { apikey: service, ...(service.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${service}` }), 'Content-Type': 'application/json' };
    let refreshToken = body.action === 'connect' ? body.refreshToken : null;
    if (!refreshToken) {
      const rows = await jsonFetch(`${base}/rest/v1/workspace_calendar_credentials?owner_id=eq.${encodeURIComponent(user.id)}&select=refresh_token`, { headers: adminHeaders });
      refreshToken = rows[0]?.refresh_token;
    }
    if (typeof refreshToken !== 'string' || refreshToken.length > 5000) return reply({ error: 'Подключи Google Календарь: нажми «Переподключить Google» в настройках.' }, 428);
    const googleClientId = env('GOOGLE_CLIENT_ID'), googleClientSecret = env('GOOGLE_CLIENT_SECRET');
    let google;
    try {
      google = await jsonFetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: googleClientId, client_secret: googleClientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }) });
    } catch { return reply({ error: 'Разрешение Google истекло или отозвано. Переподключи Google в настройках.' }, 428); }
    const googleHeaders = { Authorization: `Bearer ${google.access_token}` };
    // Check that a submitted refresh token belongs to the authenticated owner.
    const profile = await jsonFetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: googleHeaders });
    if (!profile.email_verified || profile.email?.toLowerCase() !== user.email?.toLowerCase()) return reply({ error: 'Google-аккаунт календаря не совпадает с аккаунтом владельца.' }, 403);
    if (body.action === 'connect') {
      await jsonFetch(`${base}/rest/v1/workspace_calendar_credentials?on_conflict=owner_id`, { method: 'POST', headers: { ...adminHeaders, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ owner_id: user.id, refresh_token: google.refresh_token || refreshToken, updated_at: new Date().toISOString() }) });
      return reply({ connected: true });
    }
    const now = new Date();
    const timeMin = new Date(Date.UTC(now.getUTCFullYear() - 2, 0, 1)).toISOString();
    const timeMax = new Date(Date.UTC(now.getUTCFullYear() + 4, 0, 1)).toISOString();
    const root = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`;
    const events: GoogleEvent[] = []; let pageToken = ''; let pages = 0;
    do {
      const params = new URLSearchParams({ singleEvents: 'true', showDeleted: 'false', maxResults: '2500', timeMin, timeMax });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await jsonFetch(`${root}?${params}`, { headers: googleHeaders });
      events.push(...(page.items || [])); pageToken = page.nextPageToken || '';
      if (++pages > 30) throw new Error('Calendar snapshot too large');
    } while (pageToken);
    const found = new Set(events.map(x => x.id));
    // Verify missing tracked events individually, including ones moved outside the time window.
    const missing = tracked.filter(id => !found.has(id as string));
    for (let offset = 0; offset < missing.length; offset += 8) {
      const batch = await Promise.all(missing.slice(offset, offset + 8).map(async id => {
        const res = await fetch(`${root}/${encodeURIComponent(id as string)}`, { headers: googleHeaders, signal: AbortSignal.timeout(20000) });
        if (res.status === 404 || res.status === 410) { await res.body?.cancel(); return null; }
        if (!res.ok) { await res.body?.cancel(); throw new Error('Incomplete calendar snapshot'); }
        return res.json();
      }));
      events.push(...batch.filter(Boolean));
    }
    return reply({ events: events.filter(e => /^\??Заказ:/.test(e.summary || '') && e.status !== 'cancelled'), complete: true, syncedAt: new Date().toISOString() });
  } catch {
    // No upstream response bodies, credentials, or tokens in client errors or logs.
    return reply({ error: 'Не удалось обновить календарь. Проверь настройки функции и доступ к календарю. Сохранённые карточки остаются доступны.' }, 502);
  }
});
