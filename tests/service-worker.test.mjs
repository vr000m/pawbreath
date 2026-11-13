import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
const scope = 'https://example.test/pawbreath/';

function worker(fetchAsset) {
  const handlers = new Map();
  const stores = new Map();
  let claimed = false;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async put(url, response) { store.set(url, response); },
        async match(url) { return store.get(url)?.clone(); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const context = {
    URL,
    caches,
    fetch: fetchAsset,
    self: {
      registration: { scope },
      clients: { async claim() { claimed = true; } },
      addEventListener(name, handler) { handlers.set(name, handler); },
    },
  };
  vm.runInNewContext(source, context);
  return {
    stores,
    get claimed() { return claimed; },
    async lifecycle(name) {
      let completion;
      handlers.get(name)({ waitUntil(value) { completion = value; } });
      await completion;
    },
    request(url, method = 'GET') {
      let response;
      handlers.get('fetch')({ request: new Request(url, { method }), respondWith(value) { response = value; } });
      return response;
    },
  };
}

function asset(url) {
  const html = url.endsWith('/') || url.endsWith('/index.html');
  return new Response(html ? '<button id="breath-button">Tap</button>' : 'asset bytes');
}

test('installed shell serves offline, including a queried home-screen URL', async () => {
  let offline = false;
  const instance = worker(async url => {
    if (offline) throw new Error('Offline');
    return asset(url);
  });
  await instance.lifecycle('install');
  offline = true;
  const response = await instance.request(scope + '?source=homescreen');
  assert.ok((await response.text()).includes('breath-button'));
  assert.equal((await instance.request(scope + 'app.js')).status, 200);
});

test('worker ignores unrelated origins, paths, and write requests', async () => {
  const instance = worker(async url => asset(url));
  await instance.lifecycle('install');
  assert.equal(instance.request('https://another.test/'), undefined);
  assert.equal(instance.request(scope + 'private-data.json'), undefined);
  assert.equal(instance.request(scope, 'POST'), undefined);
});

test('activation removes obsolete app caches and preserves unrelated caches', async () => {
  const instance = worker(async url => asset(url));
  instance.stores.set('pawbreath-shell-v0', new Map());
  instance.stores.set('another-app', new Map());
  await instance.lifecycle('install');
  await instance.lifecycle('activate');
  assert.ok(!instance.stores.has('pawbreath-shell-v0'));
  assert.ok(instance.stores.has('another-app'));
  assert.ok(instance.claimed);
});

test('authentication pages and missing assets fail installation', async () => {
  await assert.rejects(worker(async () => new Response('<html>Sign in</html>')).lifecycle('install'));
  await assert.rejects(worker(async () => new Response('Unavailable', { status: 503 })).lifecycle('install'));
});
