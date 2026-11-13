import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { validateDog, validateReading, validateBackup, makeBackup, toCsv, respiratoryRate } from '../dist/data.mjs';

const dog = { id: 'dog-1', name: 'Milo', threshold: null, photo: '' };
const reading = { id: 'reading-1', dogId: dog.id, date: '2026-11-12T21:00:00.000Z', count: 12, seconds: 30, rate: 24, notes: '' };
const backup = () => ({ format: 'pawbreath', version: 1, dogs: [{ ...dog }], readings: [{ ...reading }] });

test('rate calculation retains raw count and handles both supported durations', () => {
  assert.equal(respiratoryRate(12, 30), 24);
  assert.equal(respiratoryRate(19, 60), 19);
  assert.deepEqual(validateReading(reading), reading);
});

test('backup round-trip preserves Unicode, multiline notes, and literal markup', () => {
  const input = backup();
  input.dogs[0].name = 'Šoko <img src=x onerror=alert(1)>';
  input.readings[0].notes = 'Asleep\n"Quiet" <script>alert(1)</script>';
  const exported = makeBackup(input);
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(exported))), input);
  assert.ok(exported.exportedAt);
});

test('reject incompatible, incomplete, duplicate and orphaned backups', () => {
  for (const modify of [
    value => { value.version = 2; },
    value => { delete value.dogs; },
    value => { value.dogs.push({ ...dog }); },
    value => { value.readings.push({ ...reading }); },
    value => { value.readings[0].dogId = 'missing'; },
  ]) {
    const input = backup(); modify(input);
    assert.throws(() => validateBackup(input));
  }
});

test('reject impossible or inconsistent readings', () => {
  for (const patch of [{ count: 0 }, { count: 1.5 }, { rate: Infinity }, { rate: 99 },
    { seconds: 0 }, { seconds: 15 }, { date: 'tomorrow' }, { notes: null }, { notes: 'a'.repeat(2001) }]) {
    assert.throws(() => validateReading({ ...reading, ...patch }));
  }
});

test('profiles validate thresholds and restrict photos to small raster data', () => {
  for (const patch of [{ name: ' ' }, { threshold: -1 }, { threshold: Infinity },
    { photo: 'javascript:alert(1)' }, { photo: 'data:image/svg+xml;base64,PHN2Zz4=' }]) {
    assert.throws(() => validateDog({ ...dog, ...patch }));
  }
  assert.equal(validateDog({ ...dog, threshold: 30 }).threshold, 30);
});

test('CSV neutralizes formula prefixes and correctly quotes commas, quotes and line breaks', () => {
  for (const text of ['=1+1', '+1+1', '-1+1', '@SUM(A1)', '  =1+1', '\t=1+1', '\r=1+1']) {
    const csv = toCsv({ dogs: [{ ...dog, name: text }], readings: [{ ...reading, notes: text }] });
    assert.ok(csv.includes('"\'' + text.replaceAll('"', '""') + '"'));
  }
  const csv = toCsv({ dogs: [dog], readings: [{ ...reading, notes: 'a,b\n"c"' }] });
  assert.ok(csv.includes('"a,b\n""c"""'));
  assert.ok(csv.includes('Timestamp (UTC)'));
});

test('manifest icon sizes, app references and cached shell files exist', () => {
  const base = new URL('../dist/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', base)));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, './');
  for (const icon of manifest.icons) {
    const bytes = readFileSync(new URL(icon.src, base));
    assert.equal(bytes.readUInt32BE(16), Number(icon.sizes.split('x')[0]));
    assert.equal(bytes.readUInt32BE(20), Number(icon.sizes.split('x')[1]));
  }
  const html = readFileSync(new URL('index.html', base), 'utf8');
  for (const [, path] of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)) assert.ok(existsSync(new URL(path, base)), path);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size, 'IDs must be unique');
  const app = readFileSync(new URL('app.js', base), 'utf8');
  for (const [, id] of app.matchAll(/\$\('#([a-z-]+)'\)/g)) assert.ok(ids.includes(id), `Missing element ${id}`);
  const worker = readFileSync(new URL('sw.js', base), 'utf8');
  assert.ok(!worker.includes('skipWaiting('));
  for (const [, path] of worker.matchAll(/'(\.\/[^']*)'/g)) assert.ok(existsSync(new URL(path, base)), path);
});
