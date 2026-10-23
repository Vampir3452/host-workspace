import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../update.js', import.meta.url), 'utf8');
async function run(search, online = true) {
  let clicked;
  const deleted = [], calls = [];
  const button = { addEventListener: (_, handler) => { clicked = handler; } };
  const status = {};
  const scope = 'https://example.com/host-workspace/';
  const context = {
    URL, URLSearchParams, setTimeout, clearTimeout,
    document: { querySelector: selector => selector === '#update-site' ? button : status },
    location: { href: scope + 'update.html' + search, search, replace: url => calls.push(['navigate', url]) },
    navigator: { onLine: online, serviceWorker: {
      getRegistration: async () => ({ scope, unregister: async () => calls.push(['unregister']) }),
      register: async () => ({ update: async () => calls.push(['update']) })
    } },
    caches: {
      keys: async () => ['zk-shell:/host-workspace/:old', 'zk-shell:/host-workspace/:current', 'zk-shell:/other/:old', 'another-app'],
      delete: async key => deleted.push(key)
    }
  };
  vm.runInNewContext(source, context);
  await clicked();
  return { deleted, calls, status, button };
}

test('cache reset only removes this site shell and reinstalls it without accessing account storage', async () => {
  const result = await run('?clear=1');
  assert.deepEqual(result.deleted, ['zk-shell:/host-workspace/:old', 'zk-shell:/host-workspace/:current']);
  assert.deepEqual(result.calls, [['unregister'], ['update'], ['navigate', './']]);
});

test('normal update preserves caches and offline reset leaves cached files intact', async () => {
  assert.deepEqual((await run('')).deleted, []);
  const offline = await run('?clear=1', false);
  assert.deepEqual(offline.deleted, []);
  assert.deepEqual(offline.calls, []);
  assert.equal(offline.button.disabled, false);
  assert.match(offline.status.textContent, /интернет/);
});
