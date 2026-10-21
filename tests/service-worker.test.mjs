import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const worker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
function setup({ origin = 'https://example.github.io', offline = false } = {}) {
  const handlers = {}, matched = [], fetched = [], deleted = [], opened = [], written = [];
  let claimed = false;
  const address = request => typeof request === 'string' ? request : request.url || request.href;
  const cache = { addAll: async () => {}, match: async request => { matched.push(address(request)); return new Response('cached shell'); }, put: async (request, response) => { written.push({ url: address(request), body: await response.text() }); } };
  vm.runInNewContext(worker, {
    self: { registration: { scope: `${origin}/workspace/` }, location: { origin, hostname: new URL(origin).hostname }, clients: { claim: async () => { claimed = true; } }, addEventListener: (type, fn) => { handlers[type] = fn; } },
    caches: { open: async name => { opened.push(name); return cache; }, keys: async () => ['zk-shell:/workspace/:old', 'zk-shell:/different/:old', 'unrelated'], delete: async name => { deleted.push(name); } },
    URL, Request, Response, fetch: async (request, options) => { fetched.push({ url: address(request), options }); if (offline) throw new TypeError('Network unavailable'); return new Response('network'); },
  });
  return { handlers, matched, fetched, deleted, opened, written, claimed: () => claimed };
}
function dispatch(state, url, { method = 'GET', mode = 'cors', headers = {} } = {}) {
  let promise;
  state.handlers.fetch({ request: { url, method, mode, headers: new Headers(headers) }, respondWith: p => { promise = p; } });
  return promise;
}
test('worker never intercepts remote APIs, credentials or unrelated files', () => {
  const state = setup();
  for (const url of ['https://project.supabase.co/rest/v1/workspace_records', 'https://example.github.io/workspace/api/private', 'https://example.github.io/other/app.js', 'https://example.github.io/workspace/config.js?token=private']) assert.equal(dispatch(state, url), undefined);
  assert.equal(dispatch(state, 'https://example.github.io/workspace/app.js', { headers: { Authorization: 'Bearer secret' } }), undefined);
  assert.equal(dispatch(state, 'https://example.github.io/workspace/index.html', { method: 'POST' }), undefined);
});
test('offline navigation with an OAuth code returns clean shell without storing callback URL', async () => {
  const state = setup();
  const response = await dispatch(state, 'https://example.github.io/workspace/?code=secret-code', { mode: 'navigate' });
  assert.equal(await response.text(), 'cached shell');
  assert.deepEqual(state.matched, ['https://example.github.io/workspace/index.html']);
  assert.equal(state.fetched.length, 0);
});
test('worker uses its own versioned shell and leaves other site caches alone', async () => {
  const state = setup();
  await dispatch(state, 'https://example.github.io/workspace/lib/model.js');
  assert.deepEqual(state.opened, ['zk-shell:/workspace/:dev-v2']);
  let activation;
  state.handlers.activate({ waitUntil: p => { activation = p; } });
  await activation;
  assert.deepEqual(state.deleted, ['zk-shell:/workspace/:old']);
  assert.equal(state.claimed(), true);
});

test('localhost and loopback load fresh public assets while production remains cache-first', async () => {
  for (const origin of ['http://localhost:4181', 'http://127.0.0.1:4181']) {
    const state = setup({ origin });
    const response = await dispatch(state, `${origin}/workspace/app.js`);
    assert.equal(await response.text(), 'network');
    assert.equal(state.fetched.length, 1);
    assert.equal(state.fetched[0].options.cache, 'no-store');
    assert.deepEqual(state.written, [{ url: `${origin}/workspace/app.js`, body: 'network' }]);
    assert.equal(state.matched.length, 0);
  }
  const production = setup();
  assert.equal(await (await dispatch(production, 'https://example.github.io/workspace/app.js')).text(), 'cached shell');
  assert.equal(production.fetched.length, 0);
  assert.equal(production.written.length, 0);
});

test('development navigation refreshes clean shell and never caches the OAuth code', async () => {
  const origin = 'http://localhost:4181', state = setup({ origin });
  const response = await dispatch(state, `${origin}/workspace/?code=private-code`, { mode: 'navigate' });
  assert.equal(await response.text(), 'network');
  assert.deepEqual(state.written, [{ url: `${origin}/workspace/index.html`, body: 'network' }]);
  assert.equal(state.written.some(x => x.url.includes('private-code')), false);
});

test('development falls back to cached public files offline and still leaves APIs untouched', async () => {
  const origin = 'http://localhost:4181', state = setup({ origin, offline: true });
  for (const url of [`${origin}/workspace/app.js`, `${origin}/workspace/`]) {
    const response = await dispatch(state, url, { mode: url.endsWith('/') ? 'navigate' : 'cors' });
    assert.equal(await response.text(), 'cached shell');
  }
  assert.equal(dispatch(state, `${origin}/workspace/api/private`), undefined);
  assert.equal(dispatch(state, 'https://project.supabase.co/rest/v1/workspace_records'), undefined);
  assert.equal(state.written.length, 0);
});
