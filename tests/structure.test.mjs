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
// Top-level blocks (rules and at-rules) in source order, with their preludes, found by brace matching.
const topLevel = css => {
  css = stripComments(css);
  const blocks = [];
  let depth = 0, start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') { if (depth++ === 0) blocks.push({ prelude: css.slice(start, i).trim() }); }
    else if (css[i] === '}' && --depth === 0) start = i + 1;
    else if (css[i] === ';' && depth === 0) start = i + 1;
  }
  return blocks;
};
// True when one query of a media query list applies at exactly "viewport width <= 600px" and nothing else,
// whatever the spelling: `(max-width:600px)`, `screen and (max-width: 600px)`, `only all and (width<=600px)`.
const isPlainPhoneQuery = query => {
  const q = query.toLowerCase().replace(/\s+/g, ' ').trim().replace(/^(?:only )?(?:screen|all) and /, '');
  return /^\( ?(?:max-width ?: ?600px|width ?<= ?600px|600px ?>= ?width) ?\)$/.test(q);
};
const plainPhonePreludes = css => topLevel(css)
  .filter(({ prelude }) => /^@media\b/i.test(prelude))
  .filter(({ prelude }) => prelude.replace(/^@media/i, '').split(',').some(isPlainPhoneQuery));

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
  for (const id of ['history-chart', 'history-context', 'history-manual-entry', 'reading-list']) assert.ok(at(id) >= 0, `#${id} is on the History page`);
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
  // The size a `font-size` value or a `font` shorthand sets, as written.
  const sizeOf = (property, value) => {
    value = value.trim();
    if (property === 'font-size' || /^(?:inherit|initial|unset|revert(?:-layer)?)$/.test(value)) return value;
    const length = value.match(/(?:^|\s)(\d*\.?\d+[a-z%]+)(?=\s*\/|\s|$)/i);
    const keyword = value.match(/(?<![\w-])(?:xx?x?-small|xx?x?-large|small|medium|large|smaller|larger)(?![\w-])/);
    return length?.[1] ?? keyword?.[0] ?? value;
  };
  // A control's size must be an explicit px value of at least 16. em, rem, %, keywords, var() and calc()
  // depend on context this test cannot see, so they are rejected on controls. The one exception is the
  // element reset `button, input, select, textarea { font: inherit }`: it hands controls the body text size,
  // which stays at the browser's 16px because html, :root and body never set a font size (asserted below).
  const elementReset = selectors => selectors.every(part => /^(?:button|input|select|textarea)$/.test(part));
  const small = [];
  for (const { selectors, body } of rules(css)) {
    if (selectors.some(part => /^(?:html|:root|body)$/.test(part))) assert.ok(!/(?:^|[;\s])font(?:-size)?\s*:/.test(body), `${selectors.join(', ')} must not set a font size`);
    const controls = selectors.filter(targetsControl);
    if (!controls.length) continue;
    for (const [, property, value] of body.matchAll(/(?:^|[;\s])(font-size|font)\s*:\s*([^;]+)/g)) {
      const size = sizeOf(property, value);
      const px = size.match(/^(\d*\.?\d+)px$/);
      if (px ? Number(px[1]) >= 16 : size === 'inherit' && elementReset(selectors)) continue;
      small.push(`${controls.join(', ')} { ${property}: ${value.trim()} }`);
    }
  }
  assert.deepEqual(small, []);
});

test('phone CSS: one max-width:600px block, so each phone property has a single value', () => {
  const css = read('app.css');
  // Every spelling of a plain 600px max-width query counts; compound ones like the short-phone block do not.
  assert.deepEqual(plainPhonePreludes(css).map(({ prelude }) => prelude), ['@media(max-width:600px)']);
  assert.equal(atBlocks(css, phoneQuery).length, 1);
  // Nothing unscoped follows it, so no base rule can override a phone value by source order.
  const blocks = topLevel(css);
  const phone = blocks.findIndex(({ prelude }) => phoneQuery.test(prelude));
  const after = blocks.slice(phone + 1).filter(({ prelude }) => !prelude.startsWith('@')).map(({ prelude }) => prelude);
  assert.deepEqual(after, [], 'base rules belong above the phone block');
});

test('the wide-screen picker block is the exact complement of the phone block, so no viewport width gets neither', () => {
  const css = read('app.css');
  const wide = atBlocks(css, /^@media\s+not\s+all\s+and\s*\(\s*max-width\s*:\s*600px\s*\)\s*$/);
  assert.equal(wide.length, 1);
  assert.ok(wide[0].includes('#measure-page .dog-picker') && wide[0].includes('.history-toolbar .history-dog-picker'));
  // min-width:601px (or 600.02px) leaves fractional widths such as 600.5px, seen at desktop zoom, uncovered.
  assert.ok(!/min-width\s*:\s*60[01](?:\.\d+)?px/.test(stripComments(css)), 'use the negated phone query, not a min-width just above 600px');
});

test('an update notice shown mid-count on a phone is visually hidden, not removed, so the circle clears the pinned controls', () => {
  const [phone] = atBlocks(read('app.css'), phoneQuery);
  const rule = rules(phone).find(({ selectors }) => selectors.some(part => /:has\(\s*\.breath-circle\.active\s*\)/.test(part) && /#update-notice\b/.test(part)));
  assert.ok(rule, 'a phone rule hides #update-notice while .breath-circle.active is present');
  assert.ok(/position:\s*absolute/.test(rule.body) && /clip-path:\s*inset\(50%\)/.test(rule.body), 'visually hidden, out of the flow');
  assert.ok(!/display:\s*none|visibility:\s*hidden/.test(rule.body), 'the status stays in the accessibility tree');
});
