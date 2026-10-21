import { CONFIG } from '../config.js';
const SESSION_KEY = 'zk.auth.v1';
const VERIFIER_KEY = 'zk.pkce.v1';
const headers = () => ({ apikey: CONFIG.publishableKey, 'Content-Type': 'application/json' });
export function session() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } }
function saveSession(data) {
  const safe = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at || Date.now() / 1000 + data.expires_in, user: data.user };
  localStorage.setItem(SESSION_KEY, JSON.stringify(safe)); return safe;
}
export async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(25000), cache: 'no-store' });
  const data = response.headers.get('content-type')?.includes('json') ? await response.json() : null;
  if (!response.ok) {
    const serverMessage = [data?.error_description, data?.error, data?.message].find(x => typeof x === 'string');
    const error = new Error(serverMessage || `Сервис недоступен (${response.status}). Попробуй ещё раз.`);
    error.status = response.status; throw error;
  }
  return data;
}
export async function login() {
  if (!navigator.onLine) throw new Error('Для первого входа нужен интернет.');
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(48)), b => b.toString(16).padStart(2, '0')).join('');
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const redirect = new URL('./', location.href).href;
  const url = new URL(`${CONFIG.supabaseUrl}/auth/v1/authorize`);
  url.search = new URLSearchParams({ provider: 'google', redirect_to: redirect, code_challenge: challenge, code_challenge_method: 's256',
    scopes: 'openid email profile https://www.googleapis.com/auth/calendar.events.readonly', access_type: 'offline', prompt: 'consent', login_hint: CONFIG.ownerEmail }).toString();
  location.assign(url);
}
export async function completeLogin() {
  const params = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.slice(1));
  const oauthError = params.get('error_description') || params.get('error') || fragment.get('error_description') || fragment.get('error');
  if (oauthError) { history.replaceState(null, '', location.pathname); throw new Error('Google не разрешил вход. Попробуй войти ещё раз.'); }
  if (!params.get('code')) return false;
  const code = params.get('code'), verifier = sessionStorage.getItem(VERIFIER_KEY);
  history.replaceState(null, '', location.pathname);
  if (!verifier) throw new Error('Вход нужно завершить в том же браузере, где он был начат.');
  const data = await request(`${CONFIG.supabaseUrl}/auth/v1/token?grant_type=pkce`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  sessionStorage.removeItem(VERIFIER_KEY);
  saveSession(data);
  await authorize();
  // Google refresh credentials go straight to the owner-only server function, never to browser storage.
  // If Google reused an existing consent, the function retains an earlier server-side token.
  // Its failure does not invalidate the successful Supabase login.
  try { await callFunction({ action: 'connect', ...(data.provider_refresh_token ? { refreshToken: data.provider_refresh_token } : {}) }); }
  catch (error) { sessionStorage.setItem('zk.calendar-connection-error', error.message); }
  return true;
}
export async function token() {
  const refresh = async () => {
    const old = session();
    if (!old) throw new Error('Войди через Google, чтобы синхронизировать данные.');
    if (old.expires_at > Date.now() / 1000 + 60) return old.access_token;
    const data = await request(`${CONFIG.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ refresh_token: old.refresh_token }),
    });
    return saveSession(data).access_token;
  };
  return navigator.locks ? navigator.locks.request('zk-refresh', refresh) : refresh();
}
export async function api(path, options = {}) {
  return request(`${CONFIG.supabaseUrl}${path}`, { ...options, headers: { ...headers(), Authorization: `Bearer ${await token()}`, ...options.headers } });
}
export async function authorize() {
  const s = session();
  if (!s || s.user?.email?.toLowerCase() !== CONFIG.ownerEmail) { clearAuth(); throw new Error('Этот кабинет доступен только владельцу. Войди нужным Google-аккаунтом.'); }
  if (!await api('/rest/v1/rpc/is_workspace_owner', { method: 'POST', body: '{}' })) { clearAuth(); throw new Error('Доступ не настроен. Выполни SQL из инструкции Supabase для аккаунта владельца.'); }
  localStorage.setItem('zk.authorized', s.user.id);
  return s.user.id;
}
export function offlineAuthorized() { const s = session(); return s?.user?.email?.toLowerCase() === CONFIG.ownerEmail && localStorage.getItem('zk.authorized') === s.user.id ? s.user.id : null; }
export function clearAuth() { localStorage.removeItem(SESSION_KEY); localStorage.removeItem('zk.authorized'); sessionStorage.removeItem(VERIFIER_KEY); sessionStorage.removeItem('zk.calendar-connection-error'); }
export async function logout() { try { await api('/auth/v1/logout', { method: 'POST' }); } finally { clearAuth(); } }
export async function cloudRecords() {
  const all = []; let offset = 0;
  while (true) {
    const page = await api(`/rest/v1/workspace_records?select=id,kind,payload,version,updated_at&order=id&limit=500&offset=${offset}`);
    all.push(...page); if (page.length < 500) break; offset += 500;
  }
  return all;
}
export function saveCloud(record) {
  return api('/rest/v1/rpc/save_workspace_record', { method: 'POST', body: JSON.stringify({ record_id: record.id, record_kind: record.kind, record_payload: record.payload, expected_version: record.version }) });
}
export function callFunction(body) { return api('/functions/v1/google-calendar', { method: 'POST', body: JSON.stringify(body) }); }
export const readCalendar = trackedIds => callFunction({ action: 'list', trackedIds });
