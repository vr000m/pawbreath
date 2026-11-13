// Build a file-openable verification harness using the exact app sources.
// It uses an isolated IndexedDB database and a controlled measurement clock.
// Service-worker installation requires a separately served HTTPS/localhost test.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dist = new URL('../dist/', import.meta.url);
// Every substitution must apply. A silently skipped replace would test an app that does not exist.
function replaced(source, search, replacement, all = false) {
  const found = typeof search === 'string' ? source.includes(search) : search.test(source);
  if (!found) throw new Error(`Harness substitution did not match: ${search}`);
  return all ? source.replaceAll(search, replacement) : source.replace(search, replacement);
}
const html = readFileSync(new URL('index.html', dist), 'utf8');
let data = readFileSync(new URL('data.mjs', dist), 'utf8');
data = replaced(data, 'export ', '', true);
data = replaced(data, "indexedDB.open('pawbreath', 1)", "indexedDB.open('pawbreath-verification-' + window.testRun, 1)");
let app = readFileSync(new URL('app.js', dist), 'utf8');
app = replaced(app, /^import [\s\S]+?from '\.\/data.mjs';\n/, '');
app = replaced(app, "import { createUpdateMonitor } from './updates.mjs';\n", '');
app = replaced(app, 'const updates = createUpdateMonitor({ storage: updateStorage, onChange(state) {', 'const updates = createUpdateMonitor({ serviceWorker: harnessServiceWorker, getRelease: async () => RELEASE, storage: updateStorage, onChange(state) {');
app = replaced(app, '  prepareOffline();', "  $('#cache-status').textContent = 'Offline installation is excluded from the file-based test harness.';");
const checks = `
const output = document.createElement('pre');
output.id = 'test-results';
output.style.cssText = 'white-space:pre-wrap;background:#fff;padding:24px;border:2px solid #214e40;margin:20px;position:relative;z-index:9';
document.body.prepend(output);
const results = [];
const assert = (ok, text) => { if (!ok) throw new Error(text); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function check(name, fn) {
  try { await fn(); results.push('PASS ' + name); }
  catch (error) { results.push('FAIL ' + name + ': ' + error.message); }
  output.textContent = results.join('\\n');
}
const profile = {id:'test-dog',name:'Milo <img src=x onerror=alert(1)>',threshold:30,photo:''};
const record = {id:'record-1',dogId:profile.id,date:new Date().toISOString(),count:12,seconds:30,rate:24,notes:'Asleep on the sofa.'};
await check('Add profile through the form and persist it', async () => {
  $('#add-dog').click();
  $('#dog-input').value = profile.name;
  $('#threshold-input').value = '30';
  await $('#dog-form').onsubmit({preventDefault(){}});
  const saved = (await readAll(db)).dogs[0];
  assert(saved.name === profile.name, 'Profile not saved');
  profile.id = saved.id;
  record.dogId = saved.id;
  assert(!$('#dog-name').querySelector('img'), 'Name rendered as markup');
});
let fakeNow = 0;
Object.defineProperty(performance, 'now', {configurable:true, value:()=>fakeNow});
await check('30-second count, undo, deadline, save and persisted result', async () => {
  $('#start').click();
  for(let i=0;i<13;i++) $('#breath-button').click();
  $('#undo').click();
  assert($('#counter-number').textContent === '12', 'Undo count wrong');
  fakeNow = 30000;
  $('#breath-button').click();
  assert(pending.count === 12 && pending.rate === 24, 'Deadline tap incorrectly counted');
  $('#reading-notes').value = 'Quiet <script>window.unwanted = true<\\/script>';
  $('#reading-context').value = 'asleep';
  $('#reading-uncertain').checked = true;
  await $('#save-reading').onclick();
  const savedReading = (await readAll(db)).readings[0];
  assert(savedReading.context === 'asleep' && savedReading.uncertain && savedReading.source === 'timed', 'Context not saved');
  assert((await readAll(db)).readings.length === 1, 'Saved reading missing');
  assert(!pending, 'Result not cleared after commit');
});
await check('History renders literal notes and a chart', async () => {
  showPage('history');
  await sleep(50);
  assert($('#reading-list').textContent.includes('window.unwanted'), 'Notes missing');
  assert(!$('#reading-list').querySelector('script'), 'Notes interpreted as markup');
  assert($('#history-chart').width > 0, 'Chart has no width');
  showPage('measure');
});
await check('60-second count and failed save retains the result', async () => {
  document.querySelector('[data-duration="60"]').click();
  fakeNow = 40000;
  $('#start').click();
  for(let i=0;i<19;i++) $('#breath-button').click();
  fakeNow = 100000;
  tick();
  assert(pending.rate === 19 && pending.seconds === 60, '60-second rate wrong');
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(...args) {
    const request = originalPut.apply(this,args);
    request.addEventListener('success',()=>this.transaction.abort(),{once:true});
    return request;
  };
  try { await $('#save-reading').onclick(); }
  finally { IDBObjectStore.prototype.put = originalPut; }
  assert(pending?.count === 19, 'Failed save discarded result');
  assert((await readAll(db)).readings.length === 1, 'Aborted save committed');
  await $('#save-reading').onclick();
  assert((await readAll(db)).readings.length === 2, 'Retry failed');
});
await check('Zero-breath session cannot produce a reading', async () => {
  fakeNow = 200000;
  $('#start').click();
  fakeNow = 260000;
  tick();
  assert(!pending && !session, 'Zero count produced result');
});
await check('Hidden document cancels an active count', async () => {
  fakeNow = 300000;
  $('#start').click();
  $('#breath-button').click();
  Object.defineProperty(document,'hidden',{configurable:true,value:true});
  document.dispatchEvent(new Event('visibilitychange'));
  delete document.hidden;
  assert(!session && !pending, 'Background count survived');
});
await check('Manual form retains failed saves and records the original date and context', async () => {
  $('#manual-entry').click();
  $('#manual-rate').value = '23.5';
  $('#manual-date').value = '2020-01-15T13:45';
  $('#manual-context').value = 'resting';
  $('#manual-uncertain').checked = true;
  $('#manual-notes').value = 'From paper <b>journal</b>';
  const id = manualDraft.id;
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(...args) {
    const request = originalPut.apply(this,args);
    request.addEventListener('success',()=>this.transaction.abort(),{once:true});
    return request;
  };
  try { await $('#manual-form').onsubmit({preventDefault(){}}); }
  finally { IDBObjectStore.prototype.put = originalPut; }
  assert($('#manual-dialog').open && manualDraft.id === id, 'Failed save lost manual draft');
  assert($('#manual-rate').value === '23.5' && $('#manual-error').textContent.includes('Could not save'), 'Failed save lost form');
  assert(!(await readAll(db)).readings.some(r=>r.id===id), 'Aborted manual save committed');
  await $('#manual-form').onsubmit({preventDefault(){}});
  const saved = (await readAll(db)).readings.find(r=>r.id===id);
  assert(saved.source === 'manual' && saved.count === null && saved.seconds === null, 'Manual source wrong');
  assert(saved.date === new Date(2020,0,15,13,45).toISOString() && saved.rate === 23.5, 'Original measurement changed');
  assert(saved.context === 'resting' && saved.uncertain, 'Manual context missing');
  showPage('history');
  document.querySelector('[data-range="all"]').click();
  assert($('#reading-list').textContent.includes('Manual entry · Resting · Uncertain'), 'Manual label missing');
  assert(!$('#reading-list').querySelector('b'), 'Manual notes rendered as markup');
  showPage('measure');
});
await check('Repeated Escape on a dirty manual draft keeps one modal on top and Discard reachable', async () => {
  $('#manual-entry').click();
  $('#manual-rate').value = '26';
  $('#manual-rate').dispatchEvent(new Event('input', {bubbles:true}));
  const draft = manualDraft;
  // A non-cancelable cancel (Escape without fresh user activation) is followed by the browser closing the dialog.
  $('#manual-dialog').dispatchEvent(new Event('cancel', {cancelable:false}));
  assert(!$('#confirm-dialog').open, 'Non-cancelable Escape opened a confirm that would sit below the reopened draft');
  $('#manual-dialog').close();
  await sleep(0);
  assert($('#manual-dialog').open && manualDraft === draft && $('#manual-rate').value === '26', 'Draft lost after forced close');
  $('#manual-dialog').dispatchEvent(new Event('cancel', {cancelable:true}));
  assert($('#confirm-dialog').open && $('#manual-dialog').open, 'Cancelable Escape did not ask to discard');
  $('#confirm-yes').click();
  await sleep(0);
  assert(!$('#manual-dialog').open && !$('#confirm-dialog').open && !manualDraft, 'Discard unreachable');
});
await check('Manual form rejects a future date and is unavailable during a count', async () => {
  $('#manual-entry').click();
  $('#manual-rate').value = '24';
  $('#manual-date').value = '9999-01-01T12:00';
  await $('#manual-form').onsubmit({preventDefault(){}});
  assert($('#manual-dialog').open && $('#manual-error').textContent.includes('future'), 'Future date accepted');
  await closeManual();
  $('#start').click();
  assert($('#manual-entry').disabled && $('#history-manual-entry').disabled, 'Manual entry available during count');
  $('#cancel').click();
});
await check('Checking and downloading updates preserves active counts, results and manual drafts', async () => {
  $('#start').click();
  $('#breath-button').click();
  const active = session;
  await updates.check();
  assert(session === active && session.count === 1, 'Update check interrupted counting');
  assert($('#app-version').textContent.includes(RELEASE.build), 'Running build missing');
  assert($('#update-status').textContent.includes('latest published'), 'Latest check missing');
  const worker = new EventTarget();
  worker.postMessage = () => { throw new Error('Must not force update activation'); };
  harnessRegistration.installing = worker;
  harnessRegistration.dispatchEvent(new Event('updatefound'));
  harnessRegistration.installing = null;
  harnessRegistration.waiting = worker;
  worker.state = 'installed';
  worker.dispatchEvent(new Event('statechange'));
  assert(session === active && !$('#update-notice').hidden, 'Waiting update interrupted count or hid notice');
  fakeNow += duration * 1000;
  tick();
  const completed = pending;
  $('#reading-notes').value = 'Keep this unsaved note';
  await updates.check();
  assert(pending === completed && $('#reading-notes').value === 'Keep this unsaved note', 'Update lost result');
  setHistoryContext('asleep');
  await $('#save-reading').onclick();
  assert(historyContext === 'all', 'Saved timed entry remained hidden by the context filter');
  $('#manual-entry').click();
  $('#manual-rate').value = '25';
  $('#manual-rate').dispatchEvent(new Event('input', {bubbles:true}));
  const draft = manualDraft;
  await updates.check();
  assert(manualDraft === draft && manualDirty && $('#manual-rate').value === '25', 'Update lost manual draft');
  finishManual();
  harnessRegistration.waiting = null;
  updates.refresh();
});
await check('General breathing guidance never supplies a threshold or reassures below one', async () => {
  for (const threshold of ['', '35']) {
    openDog(profile.id);
    $('#threshold-input').value = threshold;
    await $('#dog-form').onsubmit({preventDefault(){}});
    assert(dog().threshold === (threshold ? 35 : null), 'General guidance changed the stored threshold');
    $('#start').click();
    for (let i = 0; i < duration * 40 / 60; i++) $('#breath-button').click();
    fakeNow += duration * 1000;
    tick();
    assert(pending.rate === 40, 'Test count did not finish');
    if (threshold) assert($('#result-threshold').textContent.includes('threshold you entered: 35'), 'Personal threshold missing');
    else {
      assert(!$('#result-threshold').classList.contains('threshold-note'), 'General 30 reference applied as a personal threshold');
      assert(!/normal|safe|healthy/i.test($('#result-threshold').textContent), 'Result made a medical reassurance');
    }
    const discard = $('#discard').onclick();
    $('#confirm-yes').click();
    await discard;
  }
  openDog(profile.id);
  $('#threshold-input').value = '30';
  await $('#dog-form').onsubmit({preventDefault(){}});
});
await check('History context filters chart and list, preserves unknown context and never filters exports', async () => {
  const original = selectedId;
  const filterDog = {id:'filter-dog',name:'Filter check',threshold:null,photo:''};
  await saveDog(db, filterDog);
  const fixtures = [
    {...record,id:'filter-asleep',dogId:filterDog.id,context:'asleep',uncertain:true},
    {...record,id:'filter-resting',dogId:filterDog.id,context:'resting'},
    {...record,id:'filter-legacy',dogId:filterDog.id},
    {...record,id:'filter-old',dogId:filterDog.id,context:'asleep',date:'2020-01-01T12:00:00.000Z'},
  ];
  for (const entry of fixtures) await saveReading(db, {...entry, notes:entry.id});
  selectedId = filterDog.id;
  await refresh();
  showPage('history');
  setRange('30');
  const choose = context => { $('#history-context').value = context; $('#history-context').onchange(); };
  choose('asleep');
  assert(filteredReadings().length === 1 && filteredReadings()[0].id === 'filter-asleep', 'Sleeping filter mixed contexts or dates');
  assert($('#reading-list').children.length === 1 && $('#reading-list').textContent.includes('Uncertain'), 'Uncertain sleeping reading was hidden');
  assert(!$('#history-chart').hidden, 'Filtered chart was hidden');
  choose('not-recorded');
  assert(filteredReadings().length === 1 && filteredReadings()[0].id === 'filter-legacy', 'Legacy reading context was inferred');
  choose('restless');
  assert($('#history-chart').hidden && !$('#chart-empty').hidden, 'Empty filtered chart not handled');
  const csv = toCsv(snapshot);
  for (const entry of fixtures) assert(csv.includes(entry.id), 'Context filter affected exported data');
  choose('asleep');
  $('#history-manual-entry').click();
  $('#manual-rate').value = '22';
  $('#manual-date').value = '2020-01-15T13:45';
  $('#manual-context').value = 'resting';
  await $('#manual-form').onsubmit({preventDefault(){}});
  assert(range === 'all' && historyContext === 'all', 'Saved manual entry remained hidden by filters');
  assert($('#reading-list').textContent.includes('Manual entry · Resting'), 'Saved manual entry is not visible');
  selectedId = original;
  setRange('all');
  setHistoryContext('all');
  await refresh();
  showPage('measure');
});
await check('Concurrent connections preserve distinct records', async () => {
  const second = await openDatabase();
  await Promise.all([saveReading(db,{...record,id:'concurrent-a'}),saveReading(second,{...record,id:'concurrent-b'})]);
  const all = await readAll(db);
  assert(all.readings.some(r=>r.id==='concurrent-a') && all.readings.some(r=>r.id==='concurrent-b'), 'A concurrent record was lost');
  second.close();
});
await check('Invalid restore changes no records', async () => {
  const before = JSON.stringify(await readAll(db));
  try { await restoreBackup(db,{format:'pawbreath',version:1,dogs:[profile],readings:[{...record,rate:999}]}); }
  catch {}
  assert(JSON.stringify(await readAll(db)) === before, 'Invalid import changed data');
});
await check('Mid-import failure rolls back every write', async () => {
  const before = JSON.stringify(await readAll(db));
  const originalAdd = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function(...args) {
    const request = originalAdd.apply(this,args);
    request.addEventListener('success',()=>this.transaction.abort(),{once:true});
    return request;
  };
  let rejected = false;
  try { await restoreBackup(db,{format:'pawbreath',version:1,dogs:[{...profile,id:'new-dog'}],readings:[{...record,id:'new-reading',dogId:'new-dog'}]}); }
  catch { rejected = true; }
  finally { IDBObjectStore.prototype.add = originalAdd; }
  assert(rejected, 'Import did not reject');
  assert(JSON.stringify(await readAll(db)) === before, 'Partial import persisted');
});
await check('Repeated restore is additive and idempotent', async () => {
  const input = {format:'pawbreath',version:1,dogs:[profile],readings:[{...record,id:'restored-reading'}]};
  const first = await restoreBackup(db,input);
  const second = await restoreBackup(db,input);
  assert(first.added === 1 && second.added === 0, 'Restore duplicated records');
});
await check('Backup round-trip restores into an empty database', async () => {
  const saved = makeBackup(await readAll(db));
  window.testRun += '-roundtrip';
  const fresh = await openDatabase();
  await restoreBackup(fresh,JSON.parse(JSON.stringify(saved)));
  const restored = await readAll(fresh);
  assert(restored.dogs.length === saved.dogs.length && restored.readings.length === saved.readings.length, 'Round-trip lost data');
  fresh.close();
});
await refresh();
$('#error').hidden = true;
showPage('measure');
output.textContent = 'BROWSER CHECK COMPLETE\\n' + results.join('\\n');
document.title = results.some(line=>line.startsWith('FAIL')) ? 'Pawbreath checks FAILED' : 'Pawbreath checks PASSED';
`;

const version = replaced(readFileSync(new URL('version.mjs', dist), 'utf8'), 'export ', '', true);
const updates = replaced(replaced(readFileSync(new URL('updates.mjs', dist), 'utf8'),
  "import { RELEASE } from './version.mjs';\n", ''), 'export ', '', true);
const workerStub = `const harnessRegistration = Object.assign(new EventTarget(), {active:{}, waiting:null, installing:null, update:async()=>{}});
const harnessServiceWorker = Object.assign(new EventTarget(), {controller:{}, register:async()=>harnessRegistration, getRegistration:async()=>harnessRegistration});`;
const script = `window.testRun = crypto.randomUUID();\n(async () => {\n${version}\n${updates}\n${workerStub}\n${data}\n${app}\n${checks}\n})().catch(error => { document.title = 'Pawbreath harness failed'; document.body.prepend(Object.assign(document.createElement('pre'), {textContent:error.stack})); });`;
const outputPath = process.argv[2] || '/tmp/pawbreath-browser-check.html';
let result = replaced(html, '  <script type="module" src="./app.js"></script>', '');
result = replaced(result, /(src|href)="\.\/([^"#]+)"/g, (_, attr, path) => `${attr}="${new URL(path, dist).href}"`);
result = replaced(result, '</body>', () => `<script>${script.replaceAll('</script', '<\\/script')}</script></body>`);
writeFileSync(outputPath, result);
console.log(fileURLToPath(new URL('file://' + outputPath)));
