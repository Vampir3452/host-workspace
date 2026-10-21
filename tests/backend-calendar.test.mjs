import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
let handler;
const environment = {
  SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'server-anon', SUPABASE_SERVICE_ROLE_KEY: 'server-service',
  GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'client-secret', ALLOWED_ORIGINS: 'https://example.github.io,http://localhost:4173',
};
globalThis.Deno = { env: { get: name => environment[name] }, serve: fn => { handler = fn; } };
await import('../supabase/functions/google-calendar/index.ts');
const calls = [];
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const request = (body = { action: 'list' }, authorization = 'Bearer user-token', origin = 'https://example.github.io') => new Request('https://project.supabase.co/functions/v1/google-calendar', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(body),
});
function upstream(url, options = {}) {
  calls.push([url, options]);
  if (url.endsWith('/auth/v1/user')) return reply({ id: 'owner-id', email: 'owner@example.com' });
  if (url.endsWith('/is_workspace_owner')) return reply(true);
  if (url.includes('/workspace_calendar_credentials?') && options.method === 'POST') return reply([{ owner_id: 'owner-id' }]);
  if (url.includes('/workspace_calendar_credentials?')) return reply([{ refresh_token: 'google-secret' }]);
  if (url === 'https://oauth2.googleapis.com/token') return reply({ access_token: 'google-access' });
  if (url.includes('openidconnect.googleapis.com')) return reply({ email_verified: true, email: 'owner@example.com' });
  if (url.includes('calendar/v3/')) return reply({ items: [] });
  throw new Error(`Unexpected request ${url}`);
}
beforeEach(() => { calls.length = 0; globalThis.fetch = async (url, options) => upstream(url, options); });

test('unknown origins and missing bearer tokens cannot reach credentials', async () => {
  assert.equal((await handler(request({}, '', 'https://evil.example'))).status, 403);
  assert.equal((await handler(request({}, ''))).status, 401);
  assert.equal(calls.length, 0);
});

test('non-owner is denied before service-role credentials are accessed', async () => {
  globalThis.fetch = async (url, options) => url.endsWith('/is_workspace_owner') ? reply(false) : upstream(url, options);
  assert.equal((await handler(request())).status, 403);
  assert.ok(!calls.some(([url]) => url.includes('/workspace_calendar_credentials')));
});

test('Google refresh token cannot be connected to a different Google identity', async () => {
  globalThis.fetch = async (url, options) => url.includes('openidconnect.googleapis.com') ? reply({ email_verified: true, email: 'other@example.com' }) : upstream(url, options);
  const result = await handler(request({ action: 'connect', refreshToken: 'another-token' }));
  assert.equal(result.status, 403);
  assert.ok(!calls.some(([url, options]) => url.includes('/workspace_calendar_credentials') && options.method === 'POST'));
});

test('complete calendar snapshot includes both order prefixes and follows all pages', async () => {
  globalThis.fetch = async (url, options) => {
    if (url.includes('calendar/v3/')) {
      calls.push([url, options]);
      if (!new URL(url).searchParams.get('pageToken')) return reply({ items: [{ id: 'a', summary: 'Заказ: Свадьба' }, { id: 'b', summary: 'Написать Майе' }], nextPageToken: 'next' });
      return reply({ items: [{ id: 'c', summary: '?Заказ: Корпоратив' }, { id: 'd', summary: 'Заказ: Отмена', status: 'cancelled' }] });
    }
    return upstream(url, options);
  };
  const result = await handler(request());
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.complete, true);
  assert.deepEqual(data.events.map(x => x.id), ['a', 'c']);
  assert.ok(!JSON.stringify(data).includes('google-secret'));
});

test('failed pagination never returns a partial snapshot that could delete cards', async () => {
  globalThis.fetch = async (url, options) => {
    if (url.includes('calendar/v3/')) return new URL(url).searchParams.get('pageToken') ? reply({}, 503) : reply({ items: [{ id: 'a', summary: 'Заказ: Свадьба' }], nextPageToken: 'next' });
    return upstream(url, options);
  };
  const result = await handler(request());
  assert.equal(result.status, 502);
  assert.equal((await result.json()).complete, undefined);
});

test('a tracked event moved outside the import window is fetched before inferring deletion', async () => {
  globalThis.fetch = async (url, options) => {
    if (url.includes('/events/moved-id')) return reply({ id: 'moved-id', summary: 'Заказ: Перенесено', start: { date: '2035-01-01' } });
    return upstream(url, options);
  };
  const result = await handler(request({ action: 'list', trackedIds: ['moved-id'] }));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).events[0].id, 'moved-id');
});

test('current Supabase key dictionaries work without legacy JWT keys', async () => {
  const oldAnon = environment.SUPABASE_ANON_KEY, oldService = environment.SUPABASE_SERVICE_ROLE_KEY;
  delete environment.SUPABASE_ANON_KEY;
  delete environment.SUPABASE_SERVICE_ROLE_KEY;
  environment.SUPABASE_PUBLISHABLE_KEYS = JSON.stringify({ default: 'sb_publishable_public' });
  environment.SUPABASE_SECRET_KEYS = JSON.stringify({ default: 'sb_secret_private' });
  try {
    assert.equal((await handler(request())).status, 200);
    const credentialCall = calls.find(([url]) => url.includes('/workspace_calendar_credentials'));
    assert.equal(credentialCall[1].headers.apikey, 'sb_secret_private');
    assert.equal(credentialCall[1].headers.Authorization, undefined);
  } finally {
    environment.SUPABASE_ANON_KEY = oldAnon;
    environment.SUPABASE_SERVICE_ROLE_KEY = oldService;
    delete environment.SUPABASE_PUBLISHABLE_KEYS;
    delete environment.SUPABASE_SECRET_KEYS;
  }
});
