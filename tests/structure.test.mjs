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

// Markup and CSS lookups that do not depend on serialization: attribute order, whitespace and line breaks
// are free to change. The repo has no dependencies, so there is no DOM parser here; these helpers stay
// tolerant instead.
const openTag = (tag, attr, value) => new RegExp(`<${tag}\\b[^>]*\\b${attr}="(?:[^"]*\\s)?${value}(?:\\s[^"]*)?"[^>]*>`);
const hasId = (html, id) => new RegExp(`\\bid="${id}"`).test(html);
// The markup from the start of `startRe` up to (not including) the first match of `endRe` after it.
const slice = (html, startRe, endRe) => {
  const from = html.search(startRe);
  assert.ok(from >= 0, `${startRe} not found`);
  const rest = html.slice(from);
  const to = rest.slice(1).search(endRe);
  return to < 0 ? rest : rest.slice(0, to + 1);
};
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
// Bodies of every at-rule block whose prelude matches, found by brace matching.
const atBlocks = (css, preludeRe) => {
  const bodies = [];
  css = stripComments(css);
  for (const match of css.matchAll(/@[^{};]+\{/g)) {
    if (!preludeRe.test(match[0].slice(0, -1))) continue;
    let depth = 1, i = match.index + match[0].length;
    const start = i;
    for (; i < css.length && depth; i++) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0;
    bodies.push(css.slice(start, i - 1));
  }
  return bodies;
};
const rules = css => [...stripComments(css).matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selectors: selector.split(',').map(part => part.trim()), body }));
const phoneQuery = /^@media\s*\(\s*max-width\s*:\s*600px\s*\)\s*$/;

test('phone layout: SVG tab icons, History controls in one toolbar, Export CSV beside the backup buttons', () => {
  const html = read('index.html');
  const nav = slice(html, /<nav\b[^>]*aria-label="Main navigation"/, /<\/nav>/);
  assert.equal((nav.match(/<svg\b/g) ?? []).length, 3, 'each tab has an SVG icon');
  for (const glyph of ['◉', '▥', '⚙']) assert.ok(!html.includes(glyph), `glyph ${glyph} renders differently per platform`);
  const history = slice(html, openTag('section', 'id', 'history-page'), openTag('section', 'id', 'settings-page'));
  const toolbar = slice(history, openTag('div', 'class', 'history-toolbar'), openTag('section', 'class', 'chart-card'));
  assert.ok(hasId(toolbar, 'history-dog-select') && /\bdata-range="30"/.test(toolbar), 'dog picker and period share the toolbar');
  assert.ok(!hasId(history, 'csv-export'), 'Export CSV exports every dog, so it does not belong on one dog\'s History page');
  const at = id => history.search(new RegExp(`\\bid="${id}"`));
  assert.ok(at('history-chart') < at('history-context'), 'the chart comes before the context filter');
  assert.ok(at('history-chart') < at('history-manual-entry') && at('history-manual-entry') < at('reading-list'), 'Enter a reading sits with the Recorded moments list, below the chart');
  const settings = slice(html, openTag('section', 'id', 'settings-page'), /<footer\b/);
  assert.ok(hasId(settings, 'csv-export') && hasId(settings, 'home-screen-card'));
  assert.ok(!new RegExp(`${openTag('p', 'class', 'small').source}\\s*For sleeping readings`).test(html),'the card keeps one instruction line');
  assert.ok(/<meta\b(?=[^>]*\bname="mobile-web-app-capable")(?=[^>]*\bcontent="yes")[^>]*>/.test(html), 'the non-prefixed standalone meta is added alongside the Apple-only one');
});

test('installed mode hides only the install steps; the offline status stays visible', () => {
  const html = read('index.html');
  const css = read('app.css');
  const card = slice(html, openTag('section', 'id', 'home-screen-card'), /<\/section>/);
  const installSteps = card.match(new RegExp(openTag('p', 'class', 'install-steps').source, 'g')) ?? [];
  assert.equal(installSteps.length, 2, 'both platform instructions are install steps');
  const cacheStatus = card.match(openTag('p', 'id', 'cache-status'));
  assert.ok(cacheStatus && !/\binstall-steps\b/.test(cacheStatus[0]), 'the offline status is not an install step');
  const standalone = atBlocks(css, /^@media\s*\(\s*display-mode\s*:\s*standalone\s*\)\s*$/);
  assert.equal(standalone.length, 1);
  assert.ok(standalone[0].includes('.install-steps') && !standalone[0].includes('#home-screen-card'), 'the whole card must not be hidden');
});

test('form controls are at least 16px so iOS Safari does not zoom the page on focus', () => {
  const css = read('app.css');
  const html = read('index.html');
  // Every control in the markup, by id and class, so a rule like `#manual-notes { font-size: 14px }` is caught too.
  const names = new Set();
  for (const [tag] of html.matchAll(/<(?:select|input|textarea)\b[^>]*>/g)) {
    if (/\btype="(?:file|checkbox|radio|hidden)"/.test(tag)) continue;
    const id = tag.match(/\bid="([^"]+)"/);
    if (id) names.add(`#${id[1]}`);
    for (const name of tag.match(/\bclass="([^"]+)"/)?.[1].split(/\s+/) ?? []) names.add(`.${name}`);
  }
  assert.ok(names.has('#manual-notes') && names.has('#selected-dog'), 'the control list comes from index.html');
  const targetsControl = part => {
    if (part.includes('type=file')) return false;
    const subject = part.split(/\s*[\s>+~]\s*/).pop();
    if (/^(select|textarea|input)\b/.test(subject)) return true;
    return [...subject.matchAll(/[#.][\w-]+/g)].some(([name]) => names.has(name));
  };
  const small = [];
  for (const { selectors, body } of rules(css)) {
    const size = body.match(/font-size:\s*(\d+(?:\.\d+)?)px/);
    if (!size || Number(size[1]) >= 16) continue;
    const controls = selectors.filter(targetsControl);
    if (controls.length) small.push(`${controls.join(', ')} { font-size: ${size[1]}px }`);
  }
  assert.deepEqual(small, []);
});

test('phone CSS: one max-width:600px block, so each phone property has a single value', () => {
  assert.equal(atBlocks(read('app.css'), phoneQuery).length, 1);
});

test('an update notice shown mid-count on a phone is visually hidden, not removed, so the circle clears the pinned controls', () => {
  const [phone] = atBlocks(read('app.css'), phoneQuery);
  const rule = rules(phone).find(({ selectors }) => selectors.some(part => /:has\(\s*\.breath-circle\.active\s*\)/.test(part) && /#update-notice\b/.test(part)));
  assert.ok(rule, 'a phone rule hides #update-notice while .breath-circle.active is present');
  assert.ok(/position:\s*absolute/.test(rule.body) && /clip-path:\s*inset\(50%\)/.test(rule.body), 'visually hidden, out of the flow');
  assert.ok(!/display:\s*none|visibility:\s*hidden/.test(rule.body), 'the status stays in the accessibility tree');
});
