import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { validateDog, validateReading, validateBackup, makeBackup, readBackupFile, toCsv, respiratoryRate, manualDate,
  CONTEXTS, CONTEXT_LABELS, withReadingDefaults } from '../dist/data.mjs';

const dog = { id: 'dog-1', name: 'Milo', threshold: null, photo: '' };
const reading = { id: 'reading-1', dogId: dog.id, date: '2026-11-12T21:00:00.000Z', count: 12, seconds: 30, rate: 24, notes: '', source: 'timed', context: 'not-recorded', uncertain: false };
const backup = () => ({ format: 'pawbreath', version: 2, dogs: [{ ...dog }], readings: [{ ...reading }] });

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

test('combined valid backups remain exportable beyond the former aggregate limits', () => {
  const first = validateBackup({
    format: 'pawbreath', version: 1,
    dogs: Array.from({ length: 100 }, (_, i) => ({ ...dog, id: `dog-${i}` })),
    readings: Array.from({ length: 50000 }, (_, i) => ({ ...reading, id: `reading-${i}` })),
  });
  const second = validateBackup({
    format: 'pawbreath', version: 1,
    dogs: [{ ...dog, id: 'extra-dog' }],
    readings: [{ ...reading, id: 'extra-reading', dogId: 'extra-dog' }],
  });
  const combined = { dogs: [...first.dogs, ...second.dogs], readings: [...first.readings, ...second.readings] };
  const exported = makeBackup(combined);
  const restored = validateBackup(JSON.parse(JSON.stringify(exported)));
  assert.deepEqual(restored.dogs, combined.dogs);
  assert.deepEqual(restored.readings, combined.readings);

  const invalid = structuredClone(exported);
  invalid.readings.at(-1).dogId = 'missing';
  assert.throws(() => validateBackup(invalid), /missing its dog profile/);
  invalid.readings.at(-1).dogId = 'extra-dog';
  invalid.readings.at(-1).id = invalid.readings[0].id;
  assert.throws(() => validateBackup(invalid), /duplicate reading IDs/);
});

test('exported files above 20 MB remain readable by the restore file reader', async () => {
  const input = {
    dogs: [dog],
    readings: Array.from({ length: 10000 }, (_, i) => ({ ...reading, id: `reading-${i}`, notes: 'x'.repeat(2000) })),
  };
  const file = new Blob([JSON.stringify(makeBackup(input), null, 2)], { type: 'application/json' });
  assert.ok(file.size > 20000000);
  const restored = await readBackupFile(file);
  assert.deepEqual(restored.dogs, input.dogs);
  assert.deepEqual(restored.readings, input.readings);
});

test('file reader rejects invalid JSON, invalid records and unreadable files', async () => {
  await assert.rejects(readBackupFile(new Blob(['{'])), SyntaxError);
  const invalid = backup();
  invalid.readings[0].rate = 999;
  await assert.rejects(readBackupFile(new Blob([JSON.stringify(invalid)])), /inconsistent breathing rate/);
  await assert.rejects(readBackupFile({ text: async () => { throw new Error('Cannot read file'); } }), /Cannot read file/);
});

test('reject incompatible, incomplete, duplicate and orphaned backups', () => {
  for (const modify of [
    value => { value.version = 3; },
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


test('version 1 backups migrate without guessing measurement context', () => {
  const legacy = { ...reading };
  delete legacy.source; delete legacy.context; delete legacy.uncertain;
  const migrated = validateBackup({ format: 'pawbreath', version: 1, dogs: [dog], readings: [legacy] });
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.readings[0], reading);
});

test('manual readings round-trip with context and uncertainty without invented counts', () => {
  const manual = { ...reading, source: 'manual', count: null, seconds: null, rate: 23.5, context: 'resting', uncertain: true };
  const restored = validateBackup(JSON.parse(JSON.stringify(makeBackup({ dogs: [dog], readings: [reading, { ...manual, id: 'manual-1' }] }))));
  assert.deepEqual(restored.readings[1], { ...manual, id: 'manual-1' });
  const csv = toCsv({ dogs: [dog], readings: [manual] });
  assert.ok(csv.includes('"23.5","",""'));
  assert.ok(csv.includes('"manual","resting","Yes"'));
  assert.equal(validateReading({ ...manual, rate: 300 }).rate, 300);
  const legacy = { id: 'legacy-1', dogId: dog.id, date: reading.date, count: 12, seconds: 30, rate: 24, notes: '' };
  const lenient = toCsv({ dogs: [dog], readings: [reading, { ...manual, id: 'bad-1', rate: 2400 }, legacy] }).split('\r\n');
  assert.equal(lenient.length, 4, 'one invalid record must not abort or drop other rows');
  assert.ok(lenient.some(row => row.includes('"2400"')));
  assert.ok(lenient.some(row => row.includes('"timed","not-recorded","No"')));
  for (const patch of [{ rate: 301 }, { rate: 2400 }, { count: 12 }, { seconds: 30 }, { rate: 0 }, { rate: Infinity }, { rate: 23.55 },
    { source: 'imported' }, { context: 'sleepy' }, { context: null }, { uncertain: 'yes' }]) {
    assert.throws(() => validateReading({ ...manual, ...patch }));
  }
  for (const context of ['asleep', 'resting', 'restless', 'not-recorded']) {
    assert.equal(validateReading({ ...reading, context, uncertain: true }).context, context);
  }
});

test('manual dates preserve the original local time and reject future or nonexistent dates', () => {
  const value = '2020-01-15T13:45';
  assert.equal(manualDate(value), new Date(2020, 0, 15, 13, 45).toISOString());
  for (const invalid of ['', 'tomorrow', '2020-02-30T13:45', '2020-13-15T13:45', '2020-01-15T25:45']) {
    assert.throws(() => manualDate(invalid));
  }
  assert.throws(() => manualDate(value, new Date(2019, 0, 1).getTime()), /future/);
  // Typing "20" into a datetime-local year field yields year 0020, which must not be saved.
  assert.throws(() => manualDate('0020-01-15T13:45'), /1970/);
});

test('CSV export sorts and keeps records whose stored date is missing or not a string', () => {
  const undated = { ...reading, id: 'undated' };
  delete undated.date;
  const numeric = { ...reading, id: 'numeric', date: 1700000000000 };
  const rows = toCsv({ dogs: [dog], readings: [reading, undated, numeric] }).split('\r\n');
  assert.equal(rows.length, 4, 'every stored reading must be exported');
  assert.ok(rows.some(row => row.includes('"1700000000000"')));
  assert.ok(rows.some(row => row.startsWith('"Milo",""')));
});

test('measurement contexts have one definition used by every form, filter and label', () => {
  for (const value of CONTEXTS) {
    for (const field of ['label', 'filter', 'short']) {
      assert.equal(typeof CONTEXT_LABELS[value]?.[field], 'string', `${value}.${field}`);
      assert.ok(CONTEXT_LABELS[value][field].length > 0);
    }
  }
  assert.deepEqual(CONTEXTS, Object.keys(CONTEXT_LABELS));
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  for (const id of ['reading-context', 'manual-context', 'history-context']) assert.ok(html.includes(`<select id="${id}"`), id);
  for (const value of CONTEXTS) assert.ok(!html.includes(`value="${value}"`), `index.html hardcodes context ${value}`);
});

test('legacy reading defaults fill only absent fields and leave present values for validation', () => {
  const legacy = { id: 'legacy', dogId: dog.id, date: reading.date, count: 12, seconds: 30, rate: 24, notes: '' };
  assert.deepEqual(withReadingDefaults(legacy), { ...legacy, source: 'timed', context: 'not-recorded', uncertain: false });
  const manual = { ...legacy, source: 'manual', context: 'asleep', uncertain: true };
  assert.deepEqual(withReadingDefaults(manual), manual);
  assert.equal(withReadingDefaults({ ...legacy, context: null }).context, null);
  assert.equal(validateReading(legacy).context, 'not-recorded');
});
