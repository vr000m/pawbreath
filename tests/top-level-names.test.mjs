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

test('escaped and non-ASCII identifiers are found under their decoded names (round-7 N1)', () => {
  assert.deepEqual(names(String.raw`function respiratoryRate() {} const caf\u{e9} = 1; let ünïcode = 2; var 名前;`),
    ['café', 'respiratoryRate', 'ünïcode', '名前']);
  // Escapes in strings or comments that decode to no identifier (or to no code point at all) name nothing.
  assert.deepEqual(names(String.raw`// a\u{110000}b c d
const bom = '﻿';`), ['bom']);
  assert.throws(() => assertNoTopLevelCollisions({ one: 'function respiratoryRate() {}', two: String.raw`function respiratoryRate() {}` }),
    /respiratoryRate is declared by one and two/);
  assert.throws(() => assertNoTopLevelCollisions({ one: 'function café() {}', two: String.raw`const café = 1;` }),
    /café is declared by one and two/);
  const read = name => readFileSync(new URL(`../dist/${name}`, import.meta.url), 'utf8')
    .replace(/^import [^;]+;\n/gm, '').replaceAll('export ', '');
  const chart = read('history-chart.mjs') + String.raw`
function respiratoryRate() { return -999; }
`;
  assert.throws(() => assertNoTopLevelCollisions({ 'data.mjs': read('data.mjs'), 'history-chart.mjs': chart }),
    /respiratoryRate is declared by data\.mjs and history-chart\.mjs/);
});

test('a fixed-width \\uXXXX escape consumes exactly four hex digits, however many hex letters follow (round-8)', () => {
  assert.deepEqual(names(String.raw`function \u0072espiratoryRate() {}`), ['respiratoryRate']);
  assert.deepEqual(names(String.raw`const \u0061bcd = 1; let \u{61}bcd2 = 2; var x\u0061bc\u{64}ef = 3;`), ['abcd', 'abcd2', 'xabcdef']);
  assert.throws(() => assertNoTopLevelCollisions({ one: 'function respiratoryRate() {}', two: String.raw`function \u0072espiratoryRate() { return -999; }` }),
    /respiratoryRate is declared by one and two/);
  const read = name => readFileSync(new URL(`../dist/${name}`, import.meta.url), 'utf8')
    .replace(/^import [^;]+;\n/gm, '').replaceAll('export ', '');
  const chart = read('history-chart.mjs') + String.raw`
function \u0072espiratoryRate() { return -999; }
`;
  assert.throws(() => assertNoTopLevelCollisions({ 'data.mjs': read('data.mjs'), 'history-chart.mjs': chart }),
    /respiratoryRate is declared by data\.mjs and history-chart\.mjs/);
});

test('a strict piece with reserved-in-strict words in strings, comments and properties still works (round-7 N2)', () => {
  const strict = `"use strict";
// eval arguments yield let static interface package private protected public implements
const text = "arguments eval yield let static interface";
const obj = { arguments: 1, eval: 2, yield: 3, let: 4, static: 5 };
obj.interface = obj.package;
function shared() { return \`\${text} yield\`; }
`;
  assert.deepEqual(names(strict), ['obj', 'shared', 'text']);
  assert.throws(() => assertNoTopLevelCollisions({ one: strict, two: 'const shared = 1;' }), /shared is declared by one and two/);
  const read = name => readFileSync(new URL(`../dist/${name}`, import.meta.url), 'utf8')
    .replace(/^import [^;]+;\n/gm, '').replaceAll('export ', '');
  assert.doesNotThrow(() => assertNoTopLevelCollisions({ 'data.mjs': read('data.mjs'), 'history-chart.mjs': '"use strict";\n// eval\n' + read('history-chart.mjs') }));
  // A sloppy piece may still declare a name that is reserved only in strict code.
  assert.throws(() => assertNoTopLevelCollisions({ one: 'var yield = 1;', two: 'var interface, yield;' }), /yield is declared by one and two/);
});

test('the browser harness uses this guard and no column-zero declaration regex', () => {
  const harness = readFileSync(new URL('browser-check.mjs', import.meta.url), 'utf8');
  assert.match(harness, /assertNoTopLevelCollisions\(pieces\)/);
  assert.doesNotMatch(harness, /\(\?:const\|let\|var\)\\s\+/);
});
