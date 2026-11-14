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
// The element opened by the first match of `startRe` (a <div>), through its own closing tag, by counting
// nested <div> tags. Unlike `slice`, a child moved out of the element no longer falls inside the result.
const divElement = (html, startRe) => {
  const from = html.search(startRe);
  assert.ok(from >= 0, `${startRe} not found`);
  const tags = /<div\b[^>]*>|<\/div\s*>/g;
  tags.lastIndex = from;
  let depth = 0;
  for (let match; (match = tags.exec(html));) {
    depth += match[0][1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(from, tags.lastIndex);
  }
  assert.fail(`${startRe} is never closed`);
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
  let depth = 0, start = 0, open = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') { if (depth++ === 0) { blocks.push({ prelude: css.slice(start, i).trim() }); open = i + 1; } }
    else if (css[i] === '}' && --depth === 0) { blocks[blocks.length - 1].body = css.slice(open, i); start = i + 1; }
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
  const toolbar = divElement(history, openTag('div', 'class', 'history-toolbar'));
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

// Why a block after the phone block could override one of its values by source order, as messages ([] when none).
// A block after it may only be: a media block capped at 600px or less (the height-gated short-phone blocks), the
// wide-screen complement `not all and (max-width:600px)` (the only complement spelling accepted), or above 600px
// only. A width-agnostic block (display-mode, motion) may follow if it styles nothing the phone block styles.
// Width is read only in the form (max-width:Npx) / (min-width:Npx); any other width feature (range syntax, em,
// rem) fails closed rather than being parsed. Non-@media at-rules (@supports, @layer, @container) fail, which
// also covers any @media nested in them. Each block's body comes from its own entry, never a prelude lookup.
const phoneOrderProblems = css => {
  const blocks = topLevel(css);
  const phone = blocks.findIndex(({ prelude }) => phoneQuery.test(prelude));
  const phoneSelectors = new Set(rules(blocks[phone].body).flatMap(({ selectors }) => selectors));
  const complement = query => query.toLowerCase().replace(/\s+/g, '') === 'notalland(max-width:600px)';
  const skipsPhones = query => {
    const q = query.toLowerCase().replace(/\s+/g, '');
    if (complement(query)) return true;
    if (q.startsWith('not')) return false;
    const conjuncts = q.replace(/^(?:only)?(?:screen|all)and/, '').split('and');
    return conjuncts.some(part => {
      const max = part.match(/^\(max-width:(\d*\.?\d+)px\)$/), min = part.match(/^\(min-width:(\d*\.?\d+)px\)$/);
      return max ? Number(max[1]) <= 600 : min ? Number(min[1]) > 600 : false;
    });
  };
  const problems = [];
  for (const { prelude, body } of blocks.slice(phone + 1)) {
    if (!prelude.startsWith('@')) { problems.push(`base rule \`${prelude}\` belongs above the phone block`); continue; }
    if (!/^@media\b/i.test(prelude)) { problems.push(`${prelude}: only @media blocks may follow the phone block`); continue; }
    const queries = prelude.replace(/^@media/i, '').split(',');
    if (queries.some(query => !complement(query) && /width/i.test(query.replace(/\((?:max|min)-width\s*:\s*\d*\.?\d+px\)/gi, '')))) {
      problems.push(`${prelude}: only px max-width/min-width is supported after the phone block`);
      continue;
    }
    if (queries.every(skipsPhones)) continue;
    if (queries.some(query => /max-width\s*:\s*(\d*\.?\d+)px/i.test(query) && !skipsPhones(query))) { problems.push(`${prelude}: matches phones, so it belongs above the phone block`); continue; }
    if (rules(body).some(({ selectors }) => selectors.some(part => phoneSelectors.has(part)))) problems.push(`${prelude}: styles what the phone block styles, so it belongs above the phone block`);
  }
  return problems;
};

test('phone CSS: one max-width:600px block, so each phone property has a single value', () => {
  const css = read('app.css');
  // Every spelling of a plain 600px max-width query counts; compound ones like the short-phone block do not.
  assert.deepEqual(plainPhonePreludes(css).map(({ prelude }) => prelude), ['@media(max-width:600px)']);
  assert.equal(atBlocks(css, phoneQuery).length, 1);
  // Nothing after it may match phones and override a phone value by source order (see phoneOrderProblems).
  assert.deepEqual(phoneOrderProblems(css), []);
  // The guard must catch each way a late block could override the phone block. Each case appends to the real CSS.
  const brand = rules(atBlocks(css, phoneQuery)[0]).some(({ selectors }) => selectors.includes('.brand'));
  assert.ok(brand, 'the phone block styles .brand, which the cases below rely on');
  const cases = {
    // The same prelude already appears earlier; the check must read this block's own body, not the earlier one.
    '@media(display-mode:standalone){.brand{color:red}}': /styles what the phone block styles/,
    '@media(prefers-reduced-motion:reduce){.brand{}}': /styles what the phone block styles/,
    '@supports(display:grid){.brand{color:red}}': /only @media/,
    '@supports(display:grid){@media(max-width:800px){.brand{}}}': /only @media/,
    '@layer x{.brand{}}': /only @media/,
    '@media(width<=800px){.zzz{}}': /only px max-width\/min-width/,
    '@media(max-width:50em){.zzz{}}': /only px max-width\/min-width/,
    '@media(width<=500px){.zzz{}}': /only px max-width\/min-width/,
    '@media(max-width:800px){.zzz{}}': /matches phones/,
    '.zzz{color:red}': /base rule/,
  };
  for (const [extra, expected] of Object.entries(cases)) {
    const problems = phoneOrderProblems(`${css}\n${extra}`);
    assert.ok(problems.some(problem => expected.test(problem)), `${extra} must fail the guard, got ${JSON.stringify(problems)}`);
  }
  // Blocks that only narrow the phone block, or style nothing it styles, are fine after it.
  for (const extra of ['@media(max-width:600px) and (max-height:500px){.zzz{}}', '@media(min-width:601px){.brand{}}', '@media(display-mode:standalone){.zzz{}}']) {
    assert.deepEqual(phoneOrderProblems(`${css}\n${extra}`), [], extra);
  }
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

test('phone pickers let the select shrink, so a long dog name truncates instead of overlapping the controls beside it', () => {
  const [phone] = atBlocks(read('app.css'), phoneQuery);
  const phoneRules = rules(phone);
  const columns = phoneRules.filter(({ selectors, body }) => selectors.some(part => /\.dog-picker\b/.test(part)) && /grid-template-columns/.test(body));
  assert.ok(columns.length > 0, 'a phone rule sets the picker columns');
  for (const { selectors, body } of columns) {
    // A bare 1fr track keeps an automatic minimum (the select's min-content width, i.e. its longest option).
    assert.ok(/grid-template-columns:\s*minmax\(\s*0\s*,\s*1fr\s*\)/.test(body), `${selectors.join(',')}: the select column must be minmax(0,1fr)`);
  }
  const select = phoneRules.find(({ selectors }) => selectors.includes('.dog-picker select'));
  assert.ok(select && /min-width:\s*0\s*(?:;|$)/.test(select.body), 'the phone .dog-picker select has min-width:0');
});

test('very short phones drop the dog picker mid-count, so the 150px circle clears the pinned Undo/Cancel bar at 480px tall', () => {
  const css = read('app.css');
  const shortQuery = /^@media\s*\(\s*max-width\s*:\s*600px\s*\)\s*and\s*\(\s*max-height\s*:\s*(\d+)px\s*\)\s*$/;
  const heights = topLevel(css).map(({ prelude }) => prelude.match(shortQuery)?.[1]).filter(Boolean).map(Number);
  // 666: the duration picker and instruction go (see the next test). Below about 557px the circle's 150px
  // minimum, the chrome still shown above it and the pinned bar no longer fit, so a second step must start
  // between there and 568 (a 568px-tall phone keeps its picker).
  assert.ok(heights.includes(666), 'the short-phone block is kept');
  const veryShort = heights.filter(height => height >= 557 && height < 568);
  assert.equal(veryShort.length, 1, `one very-short-phone block between 557px and 567px tall (found ${heights.join(', ')})`);
  const [block] = atBlocks(css, new RegExp(`^@media\\s*\\(\\s*max-width\\s*:\\s*600px\\s*\\)\\s*and\\s*\\(\\s*max-height\\s*:\\s*${veryShort[0]}px\\s*\\)\\s*$`));
  const rule = rules(block).find(({ selectors }) => selectors.some(part => /#measure-page:has\(\s*\.breath-circle\.active\s*\)\s+\.dog-picker$/.test(part)));
  assert.ok(rule && /display:\s*none/.test(rule.body), 'the Measure dog picker is removed from the flow mid-count');
});

test('short phones drop the duration picker and instruction mid-count up to 666px tall, so the circle clears Undo', () => {
  const css = read('app.css');
  const shortQuery = /^@media\s*\(\s*max-width\s*:\s*600px\s*\)\s*and\s*\(\s*max-height\s*:\s*(\d+)px\s*\)\s*$/;
  const heights = topLevel(css).map(({ prelude }) => prelude.match(shortQuery)?.[1]).filter(Boolean).map(Number);
  // Measured in Chromium with the picker and instruction shown: the circle reaches the solid Undo button up to
  // 663px tall (16.6px at 641). 667 (iPhone SE 2nd gen, 8) only dips into the bar's transparent fade and keeps
  // its layout, so the step must start between 664 and 666.
  const short = heights.filter(height => height >= 664 && height < 667);
  assert.equal(short.length, 1, `one short-phone block between 664px and 666px tall (found ${heights.join(', ')})`);
  const [block] = atBlocks(css, new RegExp(`^@media\\s*\\(\\s*max-width\\s*:\\s*600px\\s*\\)\\s*and\\s*\\(\\s*max-height\\s*:\\s*${short[0]}px\\s*\\)\\s*$`));
  const selectors = rules(block).filter(({ body }) => /display:\s*none/.test(body)).flatMap(({ selectors }) => selectors);
  assert.ok(selectors.some(part => /#measure-page:has\(\s*\.breath-circle\.active\s*\)\s+\.counter-card\s+\.card-top$/.test(part)), 'the duration picker is removed mid-count');
  assert.ok(selectors.some(part => /#measure-page:has\(\s*\.breath-circle\.active\s*\)\s+#counter-instruction$/.test(part)), 'the instruction is removed mid-count');
});
