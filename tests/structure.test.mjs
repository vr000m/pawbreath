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

test('phone layout: SVG tab icons, History controls in one toolbar, Export CSV beside the backup buttons', () => {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const nav = html.match(/<nav aria-label="Main navigation">([\s\S]*?)<\/nav>/)[1];
  assert.equal((nav.match(/<svg /g) ?? []).length, 3, 'each tab has an SVG icon');
  for (const glyph of ['◉', '▥', '⚙']) assert.ok(!html.includes(glyph), `glyph ${glyph} renders differently per platform`);
  const history = html.match(/<section id="history-page"[\s\S]*?<section id="settings-page"/)[0];
  const toolbar = history.match(/<div class="history-toolbar">([\s\S]*?)<\/div><\/div>/)[1];
  assert.ok(toolbar.includes('id="history-dog-select"') && toolbar.includes('data-range="30"'), 'dog picker and period share the toolbar');
  assert.ok(!history.includes('id="csv-export"'), 'Export CSV exports every dog, so it does not belong on one dog\'s History page');
  assert.ok(history.indexOf('id="history-chart"') < history.indexOf('id="history-context"'), 'the chart comes before the context filter');
  const settings = html.match(/<section id="settings-page"[\s\S]*?<footer/)[0];
  assert.ok(settings.includes('id="csv-export"') && settings.includes('id="home-screen-card"'));
  assert.ok(!/<p class="small muted">For sleeping readings/.test(html), 'the card keeps one instruction line');
  assert.ok(html.includes('<meta name="mobile-web-app-capable" content="yes">'), 'the non-prefixed standalone meta replaces the deprecated Apple-only one');
});

test('installed mode hides only the install steps; the offline status stays visible', () => {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../dist/app.css', import.meta.url), 'utf8');
  const card = html.match(/<section class="settings-card" id="home-screen-card">([\s\S]*?)<\/section>/)[1];
  assert.equal((card.match(/<p class="install-steps">/g) ?? []).length, 2, 'both platform instructions are install steps');
  assert.ok(/<p class="small muted" id="cache-status">/.test(card), 'the offline status is not an install step');
  const standalone = css.match(/@media\(display-mode:standalone\)\s*\{([\s\S]*?)\n\}/)[1];
  assert.ok(standalone.includes('.install-steps') && !standalone.includes('#home-screen-card'), 'the whole card must not be hidden');
});

test('form controls are at least 16px so iOS Safari does not zoom the page on focus', () => {
  const css = read('app.css');
  const small = [];
  for (const [, selector, body] of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const size = body.match(/font-size:\s*(\d+(?:\.\d+)?)px/);
    if (!size || Number(size[1]) >= 16) continue;
    const controls = selector.split(',').map(part => part.trim()).filter(part => /(^|[\s>])(select|textarea|input)\b/.test(part) && !part.includes('type=file'));
    if (controls.length) small.push(`${controls.join(', ')} { font-size: ${size[1]}px }`);
  }
  assert.deepEqual(small, []);
});
