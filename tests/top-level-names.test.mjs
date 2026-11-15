import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { topLevelNames, assertNoTopLevelCollisions } from '../scripts/lib/top-level-names.mjs';

const names = source => [...topLevelNames(source)].sort();

test('top-level declarations are found whatever their indentation or form', () => {
  assert.deepEqual(names(`
    function indented() {}
  async function later() {}
      function* gen() {}
   class Box {}
  const a = 1;
    let b = 2, c = 3;
  var d;
  const [e, { f }] = [1, {}];
  if (a) { var g = 1; }
`), ['Box', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'gen', 'indented', 'later']);
});

test('nested declarations and words in strings, comments, templates and regexes are not top-level', () => {
  assert.deepEqual(names(`
function outer(param) {
  function inner() {}
  const local = 1;
  class Hidden {}
  return () => { let deeper; };
}
const text = 'function fromString() {}';
const tpl = \`
  function fromTemplate() {} \${'const fromExpr = 1'}
\`;
// function fromLineComment() {}
/* const fromBlockComment = 1; */
const re = /function fromRegex\\(\\) \\{\\}/;
{ let blockScoped = 1; }
`), ['outer', 're', 'text', 'tpl']);
});

test('the same top-level name in two pieces is a collision; the same name only nested is not', () => {
  assert.throws(() => assertNoTopLevelCollisions({ one: 'function shared() {}', two: '  function shared() { return 1; }' }),
    /shared is declared by one and two/);
  assert.throws(() => assertNoTopLevelCollisions({ one: 'const shared = 1;', two: 'let x = 1, shared = 2;' }),
    /shared is declared by one and two/);
  assert.doesNotThrow(() => assertNoTopLevelCollisions({ one: 'function shared() {}', two: 'function f() { const shared = 1; return shared; }' }));
});

test('an indented function appended to history-chart.mjs that shadows data.mjs is rejected (round-6 repro)', () => {
  const read = name => readFileSync(new URL(`../dist/${name}`, import.meta.url), 'utf8')
    .replace(/^import [^;]+;\n/gm, '').replaceAll('export ', '');
  const data = read('data.mjs');
  assert.ok(topLevelNames(data).has('respiratoryRate'));
  const chart = read('history-chart.mjs') + '\n function respiratoryRate() { return -999; }\n';
  assert.throws(() => assertNoTopLevelCollisions({ 'data.mjs': data, 'history-chart.mjs': chart }),
    /respiratoryRate is declared by data\.mjs and history-chart\.mjs/);
  assert.doesNotThrow(() => assertNoTopLevelCollisions({ 'data.mjs': data, 'history-chart.mjs': read('history-chart.mjs') }));
});

test('the browser harness uses this guard and no column-zero declaration regex', () => {
  const harness = readFileSync(new URL('browser-check.mjs', import.meta.url), 'utf8');
  assert.match(harness, /assertNoTopLevelCollisions\(pieces\)/);
  assert.doesNotMatch(harness, /\(\?:const\|let\|var\)\\s\+/);
});
