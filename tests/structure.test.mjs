import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAssets } from '../scripts/lib/precache-assets.mjs';

const dist = new URL('../dist/', import.meta.url);
const read = name => readFileSync(new URL(name, dist), 'utf8');
const staticImports = source => [...source.matchAll(/^import\s+(?:\{([^}]*)\}\s+from\s+)?'(\.\/[^']+)';?$/gm)]
  .map(([, names = '', path]) => ({ path, names: names.split(',').map(name => name.trim().split(/\s+as\s+/)[0]).filter(Boolean) }));

test('every name a module imports is exported by the imported module', async () => {
  for (const name of ['app.js', 'data.mjs', 'updates.mjs']) {
    for (const { path, names } of staticImports(read(name))) {
      const module = await import(new URL(path, dist));
      for (const imported of names) assert.ok(imported in module, `${name} imports ${imported} from ${path}, which does not export it`);
    }
  }
});

test('the precache list contains every module, stylesheet, manifest and icon the shell loads', () => {
  const worker = read('sw.js');
  const assets = parseAssets(worker);
  const html = read('index.html');
  const needed = new Set(['./']);
  for (const [, path] of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="(\.\/[^"#]+)"/g)) needed.add(path);
  for (const [, path] of html.matchAll(/<img\b[^>]*src="(\.\/[^"#]+)"/g)) needed.add(path);
  for (const icon of JSON.parse(read('manifest.webmanifest')).icons) needed.add(new URL(icon.src, 'https://x.test/').pathname.replace(/^\//, './'));
  const queue = [...needed].filter(path => /\.m?js$/.test(path));
  while (queue.length) {
    for (const { path } of staticImports(read(queue.shift()))) {
      if (!needed.has(path)) { needed.add(path); queue.push(path); }
    }
  }
  for (const module of ['./app.js', './data.mjs', './updates.mjs', './version.mjs', './app.css', './manifest.webmanifest']) {
    assert.ok(needed.has(module), `${module} was not discovered`);
  }
  for (const path of needed) assert.ok(assets.includes(path), `${path} is loaded by the shell but not precached`);
});

test('the browser harness builds only when every source substitution applies', () => {
  const output = join(mkdtempSync(join(tmpdir(), 'pawbreath-')), 'check.html');
  const result = spawnSync(process.execPath, [new URL('browser-check.mjs', import.meta.url).pathname, output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(output, 'utf8');
  assert.ok(!html.includes('<script type="module" src="./app.js">'));
  assert.ok(html.includes('harnessServiceWorker, getRelease'));
});
