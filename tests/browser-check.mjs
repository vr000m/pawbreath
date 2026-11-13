// Build a file-openable verification harness using the exact app sources.
// It uses an isolated IndexedDB database and a controlled measurement clock.
// Service-worker installation requires a separately served HTTPS/localhost test.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dist = new URL('../dist/', import.meta.url);
const html = readFileSync(new URL('index.html', dist), 'utf8');
const data = readFileSync(new URL('data.mjs', dist), 'utf8')
  .replaceAll('export ', '')
  .replace("indexedDB.open('pawbreath', 1)", "indexedDB.open('pawbreath-verification-' + window.testRun, 1)");
const app = readFileSync(new URL('app.js', dist), 'utf8')
  .replace(/^import [\s\S]+?from '\.\/data.mjs';\n/, '')
  .replace('  prepareOffline();', "  $('#cache-status').textContent = 'Offline installation is excluded from the file-based test harness.';");
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
  await $('#save-reading').onclick();
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

const script = `window.testRun = '${Date.now()}';\n(async () => {\n${data}\n${app}\n${checks}\n})().catch(error => { document.title = 'Pawbreath harness failed'; document.body.prepend(Object.assign(document.createElement('pre'), {textContent:error.stack})); });`;
const outputPath = process.argv[2] || '/tmp/pawbreath-browser-check.html';
const result = html.replace('  <script type="module" src="./app.js"></script>', '')
  .replace(/(src|href)="\.\/([^"#]+)"/g, (_, attr, path) => `${attr}="${new URL(path, dist).href}"`)
  .replace('</body>', () => `<script>${script.replaceAll('</script', '<\\/script')}</script></body>`);
writeFileSync(outputPath, result);
console.log(fileURLToPath(new URL('file://' + outputPath)));
