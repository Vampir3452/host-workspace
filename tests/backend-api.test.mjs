import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../config.js';
import * as api from '../lib/api.js';

class MemoryStorage {
  data = new Map();
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}
const user = { id: 'owner-uid', email: CONFIG.ownerEmail };
const session = () => ({ access_token: 'supabase-access', refresh_token: 'supabase-refresh', expires_in: 3600, user });
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  globalThis.location = { href: 'https://example.github.io/cabinet/', pathname: '/cabinet/', search: '', hash: '', assign(url) { this.assigned = url; } };
  globalThis.history = { replaceState() {} };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
});

test('Google login uses PKCE and read-only calendar scope under a repository subpath', async () => {
  await api.login();
  const url = new URL(location.assigned);
  assert.equal(url.origin, CONFIG.supabaseUrl);
  assert.equal(url.searchParams.get('redirect_to'), 'https://example.github.io/cabinet/');
  assert.equal(url.searchParams.get('code_challenge_method'), 's256');
  assert.match(url.searchParams.get('code_challenge'), /^[\w-]{43}$/);
  assert.match(url.searchParams.get('scopes'), /calendar.events.readonly/);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.ok(sessionStorage.getItem('zk.pkce.v1'));
});

test('callback sends Google refresh credentials to the function without persisting them', async () => {
  location.search = '?code=oauth-code';
  sessionStorage.setItem('zk.pkce.v1', 'verifier');
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push([url, options]);
    if (url.includes('/auth/v1/token')) return response({ ...session(), provider_token: 'google-access', provider_refresh_token: 'google-refresh-secret' });
    if (url.includes('/is_workspace_owner')) return response(true);
    if (url.includes('/functions/v1/google-calendar')) return response({ connected: true });
    throw new Error(`Unexpected request ${url}`);
  };
  assert.equal(await api.completeLogin(), true);
  assert.deepEqual(JSON.parse(calls[0][1].body), { auth_code: 'oauth-code', code_verifier: 'verifier' });
  const connect = calls.find(([url]) => url.includes('/functions/'));
  assert.equal(JSON.parse(connect[1].body).refreshToken, 'google-refresh-secret');
  assert.ok(!JSON.stringify([...localStorage.data, ...sessionStorage.data]).includes('google-refresh-secret'));
  assert.equal(api.offlineAuthorized(), 'owner-uid');
});

test('a calendar connection failure preserves the successfully authorized workspace login', async () => {
  location.search = '?code=oauth-code';
  sessionStorage.setItem('zk.pkce.v1', 'verifier');
  globalThis.fetch = async url => {
    if (url.includes('/auth/v1/token')) return response(session());
    if (url.includes('/is_workspace_owner')) return response(true);
    return response({ error: 'Подключи Google Календарь.' }, 428);
  };
  assert.equal(await api.completeLogin(), true);
  assert.equal(api.offlineAuthorized(), 'owner-uid');
  assert.equal(sessionStorage.getItem('zk.calendar-connection-error'), 'Подключи Google Календарь.');
});

test('owner access is verified by server RPC rather than by the client email alone', async () => {
  localStorage.setItem('zk.auth.v1', JSON.stringify({ ...session(), expires_at: Date.now() / 1000 + 3600 }));
  globalThis.fetch = async () => response(false);
  await assert.rejects(api.authorize(), /Доступ не настроен/);
  assert.equal(api.session(), null);
  assert.equal(api.offlineAuthorized(), null);
});

test('expired Supabase session is refreshed without storing provider credentials', async () => {
  localStorage.setItem('zk.auth.v1', JSON.stringify({ ...session(), expires_at: 1 }));
  globalThis.fetch = async (url, options) => {
    assert.match(url, /grant_type=refresh_token/);
    assert.deepEqual(JSON.parse(options.body), { refresh_token: 'supabase-refresh' });
    return response({ ...session(), access_token: 'new-token' });
  };
  assert.equal(await api.token(), 'new-token');
  assert.equal(api.session().access_token, 'new-token');
});

test('sign-out removes local authorization even when the remote service is unavailable', async () => {
  localStorage.setItem('zk.auth.v1', JSON.stringify({ ...session(), expires_at: Date.now() / 1000 + 3600 }));
  localStorage.setItem('zk.authorized', user.id);
  globalThis.fetch = async () => { throw new Error('Offline'); };
  await assert.rejects(api.logout(), /Offline/);
  assert.equal(api.session(), null);
  assert.equal(api.offlineAuthorized(), null);
});
