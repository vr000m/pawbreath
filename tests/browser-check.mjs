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
app = replaced(app, "import { createTapSound } from './tap-sound.mjs';\n", '');
const tapSoundSource = replaced(readFileSync(new URL('tap-sound.mjs', dist), 'utf8'), 'export ', '', true);
app = replaced(app, "import { createReplayController, newestFirst, replayableReadings } from './replay.mjs';\n", '');
const replaySource = replaced(replaced(readFileSync(new URL('replay.mjs', dist), 'utf8'),
  "import { validateReading } from './data.mjs';\n", ''), 'export ', '', true);
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
await check('History has its own dog picker that shares the selection with Measure', async () => {
  const original = selectedId;
  snapshot.dogs.push({ id: 'picker-dog', name: 'Zed', threshold: null, photo: '' });
  try {
    renderProfiles();
    const picker = $('#history-dog-select');
    assert([...picker.options].map(option => option.value).join() === snapshot.dogs.map(item => item.id).join(), 'History picker lists different dogs');
    picker.value = 'picker-dog';
    picker.onchange();
    assert(selectedId === 'picker-dog' && $('#selected-dog').value === 'picker-dog', 'Pickers disagree after a History change');
    assert($('#history-dog').textContent.includes('Zed') && $('#reading-total').textContent.startsWith('0 '), 'History did not switch dog');
    $('#selected-dog').value = original;
    $('#selected-dog').onchange();
    assert(picker.value === original, 'Measure change not reflected in History picker');
  } finally {
    snapshot.dogs.pop(); selectedId = original; renderProfiles(); renderHistory();
  }
});
let fakeNow = 0;
Object.defineProperty(performance, 'now', {configurable:true, value:()=>fakeNow});
await check('The breath action keeps its visible name and exposes the count through every state', async () => {
  const verify = (value, label = 'Count one breath') => {
    const button = $('#breath-button');
    assert($('#counter-label').textContent === label, 'Visible label is ' + $('#counter-label').textContent + ', expected ' + label);
    assert(button.getAttribute('aria-labelledby') === 'counter-label', 'Name does not use the visible label');
    assert(button.getAttribute('aria-describedby') === 'counter-number', 'Count is not exposed as a description');
    assert($('#counter-number').textContent === value, 'Count description differs from the display');
  };
  verify('Ready');
  $('#start').click(); verify('0');
  assert($('#counter-instruction').textContent === 'Watch your dog. Tap the large area once per breath.', 'Instruction relies on colour or changed');
  $('#breath-button').click(); verify('1');
  $('#undo').click(); verify('0');
  $('#cancel').click(); verify('Ready');
  $('#start').click(); $('#breath-button').click();
  fakeNow = 30000; tick(); verify('1', 'breath counted');
  assert(!countingDialog.open && document.activeElement === $('#save-reading'), 'Completion did not restore result focus');
  const discard = $('#discard').onclick(); $('#confirm-yes').click(); await discard;
  verify('Ready');
  fakeNow = 0; $('#start').click(); for (let i = 0; i < 13; i++) $('#breath-button').click();
  fakeNow = 30000; tick(); verify('13', 'breaths counted');
  const discardMany = $('#discard').onclick(); $('#confirm-yes').click(); await discardMany;
  verify('Ready'); fakeNow = 0;
});
await check('Counting dialog restores the card on every exit and isolates later sessions', async () => {
  const home = counterCard.parentElement;
  const restored = () => {
    assert(!countingDialog.open && counterCard.parentElement === home, 'Counter not restored');
    assert(!session && !timer, 'Hidden count remains active');
  };
  $('#start').click();
  assert(countingDialog.open && counterCard.parentElement === countingDialog, 'Count did not open modally');
  for (const key of ['Enter',' ']) {
    const repeat = new KeyboardEvent('keydown', {key,repeat:true,cancelable:true});
    $('#breath-button').dispatchEvent(repeat);
    assert(repeat.defaultPrevented && session.tapOffsetsMs.length===0, 'Held key repeated a count');
  }
  for (const type of ['pointerdown','pointercancel','pointerup']) $('#breath-button').dispatchEvent(new PointerEvent(type, {pointerId:1,pointerType:'touch'}));
  assert(session.tapOffsetsMs.length===0, 'Raw/cancelled pointer sequence changed the count');
  countingDialog.dispatchEvent(new Event('cancel', {cancelable:true})); restored();
  assert(document.activeElement === $('#start'), 'Cancel focus not restored');
  $('#start').click();
  await sleep(0); // Consume the earlier queued close event while the new dialog is open.
  assert(session && countingDialog.open, 'Old close event cancelled a new count');
  countingDialog.close();
  for (let i=0; i<50 && session; i++) await sleep(10);
  restored();
  const open = countingDialog.showModal;
  countingDialog.showModal = () => { throw new Error('Open failed'); };
  try { $('#start').click(); restored(); }
  finally { countingDialog.showModal = open; }
  $('#start').click(); fakeNow += 30000; tick(); restored();
  assert(!pending, 'Zero count produced a result');
  fakeNow = 0;
});
await check('Delayed audio never blocks counting or replays tones into a later session', async () => {
  const original = {...tapSound};
  const checked = $('#tap-sound').checked;
  let context, tones=0;
  const resumes=[];
  class DeferredAudio {
    constructor() { context=this; this.state='suspended'; this.currentTime=0; }
    resume() { return new Promise((resolve,reject)=>resumes.push({resolve,reject})); }
    createOscillator() { tones++; return {frequency:{},connect(){},disconnect(){},start(){},stop(){}}; }
    createGain() { return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}}; }
  }
  Object.assign(tapSound,createTapSound(DeferredAudio));
  try {
    $('#tap-sound').checked=true; $('#start').click();
    assert(timer && session && countingDialog.open, 'Audio delayed the measurement');
    const requested=resumes.length;
    $('#breath-button').click(); $('#breath-button').click();
    assert(session.tapOffsetsMs.length===2 && tones===0, 'Suspended audio affected counting');
    assert(resumes.length===requested+2, 'A tap on suspended audio did not request resume');
    $('#cancel').click(); $('#tap-sound').checked=false; $('#start').click();
    const next=session;
    context.state='running'; resumes[0].resolve(); await sleep(0);
    assert(session===next && session.tapOffsetsMs.length===0 && tones===0, 'Late audio changed a later session');
    $('#breath-button').click(); assert(session.tapOffsetsMs.length===1 && tones===0, 'Opt-out made a tone');
    $('#cancel').click(); $('#tap-sound').checked=true; context.state='suspended'; $('#start').click();
    resumes.at(-1).reject(new Error('Audio denied')); await sleep(0);
    $('#breath-button').click(); assert(session.tapOffsetsMs.length===1 && tones===0, 'Rejected audio blocked counting');
    context.state='running'; $('#breath-button').click();
    assert(session.tapOffsetsMs.length===2 && tones===1, 'Accepted click did not produce exactly one tone');
    $('#undo').click(); assert(session.tapOffsetsMs.length===1 && tones===1, 'Undo requested a breath tone');
  } finally { $('#cancel').click(); Object.assign(tapSound,original); $('#tap-sound').checked=checked; }
});
await check('Ticking tap sound reports real audio availability and never blocks counting', async () => {
  const original = {...tapSound};
  const box = $('#tap-sound');
  const tickBox = async () => { box.checked = true; box.dispatchEvent(new Event('change')); await sleep(0); await sleep(0); };
  class Running { constructor() { this.state='suspended'; this.currentTime=0; } resume() { this.state='running'; return Promise.resolve(); } suspend() { this.state='suspended'; return Promise.resolve(); }
    createOscillator() { return {frequency:{},connect(){},disconnect(){},start(){},stop(){}}; } createGain() { return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}}; } }
  try {
    Object.assign(tapSound, createTapSound(undefined));
    await tickBox();
    assert($('#counter-status').textContent === 'Tap sound is not available on this device.', 'Missing audio status: ' + $('#counter-status').textContent);
    assert(!box.checked, 'Unavailable sound left the box ticked');
    $('#start').click(); $('#breath-button').click();
    assert(session && session.tapOffsetsMs.length === 1 && $('#counter-status').textContent === 'Keep this screen open while counting.', 'Unavailable sound affected counting');
    $('#cancel').click();
    Object.assign(tapSound, createTapSound(class { constructor() { throw new Error('No audio'); } }));
    await tickBox();
    assert(!box.checked && $('#counter-status').textContent === 'Tap sound is not available on this device.', 'Throwing audio reported as on');
    Object.assign(tapSound, createTapSound(Running));
    await tickBox();
    assert(box.checked && $('#counter-status').textContent === 'Tap sound on. Device volume or mute may prevent sound.', 'Available audio status: ' + $('#counter-status').textContent);
    box.checked = false; box.dispatchEvent(new Event('change'));
    assert($('#counter-status').textContent === 'Start the timer, then tap for each breath.', 'Unticking left a sound status');
  } finally { Object.assign(tapSound, original); box.checked = false; }
});
// Contract: unticking Quiet tap sound always leaves the context not running and no tone enabled, whether the
// tick's detect() finished, is still pending, or a count already ended; counting never depends on audio.
await check('Unticking tap sound suspends audio in every idle state without affecting counting', async () => {
  const original = {...tapSound};
  const box = $('#tap-sound');
  let context, suspends = 0, tones = 0, deferred = false;
  const pendingResumes = [];
  class Audio {
    constructor() { context = this; this.state = 'suspended'; this.currentTime = 0; }
    // Operations apply in call order: a suspend requested after resume wins, as in a real AudioContext.
    resume() { const at = suspends; return new Promise(resolve => {
      const settle = () => { if (suspends === at) this.state = 'running'; resolve(); };
      if (deferred) pendingResumes.push(settle); else settle(); }); }
    suspend() { suspends++; this.state = 'suspended'; return Promise.resolve(); }
    createOscillator() { tones++; return {frequency:{},connect(){},disconnect(){},start(){},stop(){}}; }
    createGain() { return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}}; }
  }
  const setBox = checked => { box.checked = checked; box.dispatchEvent(new Event('change')); };
  const settle = async () => { pendingResumes.splice(0).forEach(resolve => resolve()); await sleep(0); await sleep(0); };
  const cells = {
    'ticked, audio running': async () => { setBox(true); await settle(); assert(context.state === 'running', 'tick did not start audio'); },
    'ticked, detect still pending': async () => { deferred = true; setBox(true); },
    'ticked, after a finished count': async () => {
      setBox(true); await settle(); $('#start').click(); $('#breath-button').click(); $('#cancel').click(); setBox(true); await settle();
      assert(context.state === 'running', 're-tick did not resume audio'); }
  };
  try {
    for (const [cell, arrange] of Object.entries(cells)) {
      context = undefined; deferred = false; pendingResumes.length = 0;
      Object.assign(tapSound, createTapSound(Audio));
      await arrange();
      const before = suspends;
      setBox(false); await settle();
      assert(suspends > before, cell + ': unticking did not request suspend');
      assert(context.state !== 'running', cell + ': audio still running after untick (' + context.state + ')');
      assert(!box.checked && $('#counter-status').textContent !== 'Tap sound on. Device volume or mute may prevent sound.', cell + ': stale detect re-ticked the box or status');
      const made = tones;
      $('#start').click(); $('#breath-button').click();
      assert(session && session.tapOffsetsMs.length === 1 && tones === made, cell + ': unticked count sounded or failed to count');
      $('#cancel').click();
    }
    Object.assign(tapSound, createTapSound(undefined));
    setBox(false); await settle(); // Never ticked, no audio: unticking must not throw.
  } finally { if (session) $('#cancel').click(); Object.assign(tapSound, original); box.checked = false; }
});
await check('30-second count, undo, deadline, save and persisted result', async () => {
  $('#start').click();
  const expectedOffsets = Array.from({length:12}, (_,i) => 500 + i * 1234);
  for(let i=0;i<13;i++) { fakeNow = 500.9 + i * 1234; $('#breath-button').click(); }
  $('#undo').click();
  assert($('#counter-number').textContent === '12', 'Undo count wrong');
  fakeNow = 30000;
  $('#breath-button').click();
  assert(pending.count === 12 && pending.rate === 24, 'Deadline tap incorrectly counted');
  assert(JSON.stringify(pending.tapOffsetsMs) === JSON.stringify(expectedOffsets), 'Undo/deadline changed accepted timing');
  $('#reading-notes').value = 'Quiet <script>window.unwanted = true<\\/script>';
  $('#reading-context').value = 'asleep';
  $('#reading-uncertain').checked = true;
  await $('#save-reading').onclick();
  const savedReading = (await readAll(db)).readings[0];
  assert(JSON.stringify(savedReading.tapOffsetsMs) === JSON.stringify(expectedOffsets), 'Save lost timing');
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
  const expectedTiming = JSON.stringify(pending.tapOffsetsMs);
  const pendingId = pending.id;
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(...args) {
    const request = originalPut.apply(this,args);
    request.addEventListener('success',()=>this.transaction.abort(),{once:true});
    return request;
  };
  try { await $('#save-reading').onclick(); }
  finally { IDBObjectStore.prototype.put = originalPut; }
  assert(pending?.count === 19 && JSON.stringify(pending.tapOffsetsMs) === expectedTiming, 'Failed save discarded result or timing');
  assert((await readAll(db)).readings.length === 1, 'Aborted save committed');
  await $('#save-reading').onclick();
  assert((await readAll(db)).readings.length === 2, 'Retry failed');
  assert(JSON.stringify((await readAll(db)).readings.find(r=>r.id===pendingId).tapOffsetsMs) === expectedTiming, 'Retry changed timing');
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
  // The dialog's close event is queued as a task, so wait for it (and the app's listener, registered
  // earlier, which reopens the draft) instead of guessing with a timer.
  const closed = new Promise(resolve => $('#manual-dialog').addEventListener('close', () => setTimeout(resolve, 0), { once: true }));
  $('#manual-dialog').close();
  await closed;
  assert($('#manual-dialog').open && manualDraft === draft && $('#manual-rate').value === '26', 'Draft lost after forced close');
  $('#manual-dialog').dispatchEvent(new Event('cancel', {cancelable:true}));
  assert($('#confirm-dialog').open && $('#manual-dialog').open, 'Cancelable Escape did not ask to discard');
  $('#confirm-yes').click();
  // confirmAction resolves from the confirm dialog's queued close event, so poll for the settled state.
  for (let tries = 0; tries < 100 && $('#manual-dialog').open; tries++) await sleep(5);
  assert(!$('#manual-dialog').open && !$('#confirm-dialog').open && !manualDraft,
    'Discard unreachable (manual open=' + $('#manual-dialog').open + ', confirm open=' + $('#confirm-dialog').open + ', draft=' + !!manualDraft + ')');
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
  assert(session === active && session.tapOffsetsMs.length === 1, 'Update check interrupted counting');
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
  const notice = $('#update-notice'), message = notice.textContent;
  $('#breath-button').click();
  assert(session === active && session.tapOffsetsMs.length === 2, 'Mid-count notice altered counting');
  const announced = [];
  const observer = new MutationObserver(records => { for (const r of records) for (const n of r.addedNodes) announced.push(n.textContent); });
  observer.observe(notice, {childList:true, characterData:true, subtree:true});
  fakeNow += duration * 1000;
  tick();
  const completed = pending;
  assert(completed?.count === 2, 'Mid-count notice changed the result');
  await sleep(250); observer.disconnect();
  assert(!countingDialog.open && announced.includes(message) && notice.textContent === message && !notice.hidden,
    'Notice was not re-announced after the counting view closed: ' + JSON.stringify(announced));
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
await check('History replays individual points and visible readings newest first without changing data or audio', async () => {
  const originalDog = selectedId, originalNow = fakeNow;
  const replayDog = {id:'replay-dog',name:'Replay check',threshold:null,photo:''};
  await saveDog(db,replayDog);
  const base = {...record,dogId:replayDog.id,count:3,rate:6,tapOffsetsMs:[1000,4500,12345],context:'asleep'};
  const fixtures = [
    {...base,id:'replay-new',date:'2026-11-14T12:00:00.000Z'},
    {...base,id:'replay-tie',date:'2026-11-14T12:00:00.000Z'},
    {...base,id:'replay-old',date:'2020-01-01T12:00:00.000Z',context:'resting'},
    {...record,id:'replay-legacy',dogId:replayDog.id},
    {...record,id:'replay-manual',dogId:replayDog.id,source:'manual',count:null,seconds:null,rate:23},
  ];
  for (const r of fixtures) await saveReading(db,r);
  // A stored trace that fails validation (written around the validator) is untimed: no control, no chart hit target.
  await new Promise((resolve, reject) => {
    const tx = db.transaction('readings', 'readwrite');
    tx.objectStore('readings').put({...base,id:'replay-bad',date:'2020-01-02T12:00:00.000Z',tapOffsetsMs:[1]});
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  selectedId = replayDog.id; await refresh(); setRange('all'); setHistoryContext('all'); showPage('history');
  await sleep(40);
  const before = JSON.stringify(await readAll(db));
  let sounds = 0; const playSound = tapSound.play; tapSound.play = () => sounds++;
  try {
    assert(document.querySelectorAll('.replay-reading').length === 3, 'Unavailable readings acquired replay controls');
    drawChart();
    assert(chartPoints.length === 3 && !chartPoints.some(p=>p.entry.id==='replay-bad'), 'Chart offered a point that cannot replay');
    assert($('#reading-list').textContent.includes('Tap timing unavailable'), 'Untimed status missing');
    const row = id => [...document.querySelectorAll('.reading-row')].find(r=>r.dataset.readingId===id);
    // Layout must not move: the list heading below the replay detail and the replaying row's text stay put.
    const layout = () => {
      const chartTop = $('#history-chart').getBoundingClientRect().top;
      const heading = $('#reading-total').closest('.section-heading').getBoundingClientRect();
      const details = row('replay-old').querySelector('.reading-details').getBoundingClientRect();
      return JSON.stringify([heading.top - chartTop, details.left, details.width]);
    };
    $('#replay-status').textContent = ''; $('#replay-progress').textContent = '';
    const idleLayout = layout();
    row('replay-old').querySelector('.replay-reading').click();
    assert(replayState.entry.id === 'replay-old' && replayState.total === 1 && replayState.tapCount === 0, 'Individual replay wrong');
    await sleep(40);
    assert(row('replay-old').classList.contains('replaying') && $('#replay-detail').getAttribute('aria-hidden') === 'false', 'Replay detail or row cue missing');
    assert(layout() === idleLayout, 'Starting replay moved layout: ' + idleLayout + ' -> ' + layout());
    const announcement = $('#replay-status').textContent;
    fakeNow += 1000; await sleep(40);
    assert(replayState.tapCount === 1 && $('#replay-status').textContent === announcement, 'Tap changed live announcement');
    const elapsed = replayState.elapsedMs;
    window.dispatchEvent(new Event('resize'));
    assert(replayState.entry.id === 'replay-old' && replayState.elapsedMs === elapsed, 'Resize restarted playback');
    const radii = [], arc = CanvasRenderingContext2D.prototype.arc;
    CanvasRenderingContext2D.prototype.arc = function(...args) { radii.push(args[2]); return arc.apply(this,args); };
    try {
      Object.defineProperty(reducedMotion,'matches',{configurable:true,value:false}); drawChart();
      assert(radii.some(r=>r>7), 'Recorded tap did not pulse');
      radii.length = 0;
      Object.defineProperty(reducedMotion,'matches',{configurable:true,value:true}); reducedMotion.dispatchEvent(new Event('change'));
      assert(radii.includes(7) && !radii.some(r=>r>7), 'Reduced motion still pulses');
    } finally { delete reducedMotion.matches; CanvasRenderingContext2D.prototype.arc = arc; }
    $('#replay-stop').click(); assert(!replayState && $('#replay-stop').disabled, 'Stop left playback alive');
    assert(layout() === idleLayout, 'Stopping replay moved layout: ' + idleLayout + ' -> ' + layout());
    assert($('#replay-detail').inert && $('#replay-detail').getAttribute('aria-hidden') === 'true' && getComputedStyle($('#replay-detail')).visibility === 'hidden', 'Inactive replay detail exposed');
    drawChart(); const point = chartPoints.find(p=>p.entry.id==='replay-old');
    const rect = $('#history-chart').getBoundingClientRect();
    $('#history-chart').dispatchEvent(new MouseEvent('click',{clientX:rect.left+point.x,clientY:rect.top+point.y}));
    assert(replayState?.entry.id === 'replay-old', 'Chart point selected the wrong reading');
    $('#replay-all').click();
    assert(replayState.entry.id === 'replay-new' && replayState.total === 3, 'Sequence did not start newest eligible first');
    fakeNow += 29999; await sleep(40);
    assert(replayState.entry.id === 'replay-new', 'Trailing silence was skipped');
    fakeNow += 1; await sleep(40);
    assert(replayState.entry.id === 'replay-tie' && replayState.elapsedMs === 0, 'Tie order or duration wrong');
    fakeNow += 30000; await sleep(40);
    assert(replayState.entry.id === 'replay-old', 'Older reading was not next');
    fakeNow += 30000; await sleep(40);
    assert(!replayState && $('#replay-status').textContent === 'Replay finished.', 'Sequence failed to finish');
    assert(layout() === idleLayout, 'Finished replay moved layout: ' + idleLayout + ' -> ' + layout());
    $('#history-context').value = 'resting'; $('#history-context').onchange(); $('#replay-all').click();
    assert(replayState.entry.id === 'replay-old' && replayState.total === 1, 'Sequence ignored context filter');
    assert(toCsv(snapshot).includes('2026-11-14T12:00:00.000Z'), 'Replay filtering changed export scope');
    assert(sounds === 0, 'Silent replay used recording audio');
    assert(JSON.stringify(await readAll(db)) === before, 'Replay modified journal data');
    const operations = [
      async()=>document.querySelector('[data-range="7"]').click(),
      async()=>{ $('#history-context').value='asleep'; $('#history-context').onchange(); },
      async()=>{ $('#history-dog-select').value=originalDog; $('#history-dog-select').onchange(); },
      async()=>showPage('settings'),
      async()=>{ openManual(); assert(!replayState,'Manual form did not stop replay'); finishManual(); },
      async()=>{ openDog(replayDog.id); assert(!replayState,'Profile form did not stop replay'); $('#dog-dialog').close(); },
      async()=>{ const result=confirmAction('Test','Test'); assert(!replayState,'Confirmation did not stop replay'); $('#confirm-no').click(); await result; },
      async()=>{ Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden; },
      async()=>window.dispatchEvent(new Event('pagehide')),
      async()=>{ await saveReading(db,{...fixtures[0],notes:'Changed elsewhere'}); await refresh(); },
      async()=>{ $('#start').click(); assert(!replayState && session,'Starting count did not stop replay'); $('#cancel').click(); },
    ];
    for (let i=0;i<operations.length;i++) {
      selectedId=replayDog.id; setRange('all'); setHistoryContext('all'); showPage('history');
      $('#replay-all').click(); assert(replayState, 'Cannot start lifecycle case '+i);
      await operations[i](); await sleep(30);
      assert(!replayState && $('#replay-stop').disabled, 'Replay survived lifecycle case '+i);
    }
  } finally {
    tapSound.play = playSound; stopReplay(); selectedId=originalDog; fakeNow=originalNow;
    await deleteReading(db,'replay-bad');
    setRange('all'); setHistoryContext('all'); await refresh(); showPage('measure');
  }
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
  assert(JSON.stringify(restored.readings) === JSON.stringify(saved.readings), 'Round-trip changed records or timing');
  fresh.close();
});
await check('Save copies caller timing before asynchronous storage', async () => {
  const input = {...record,id:'timing-copy',count:3,rate:6,tapOffsetsMs:[10,1300,29999]};
  const saved = saveReading(db,input);
  input.tapOffsetsMs[0] = 999; input.tapOffsetsMs.push(30000);
  await saved;
  assert(JSON.stringify((await readAll(db)).readings.find(r=>r.id===input.id).tapOffsetsMs) === '[10,1300,29999]', 'Save aliased caller timing');
  await deleteReading(db,input.id);
});
// Smoke check only: Chromium already shrinks the select without the minmax(0,1fr)/min-width:0 rules, so this
// passes on the unfixed CSS. The structure test on those rules is the regression guard.
await check('Smoke: a long dog name fits beside the phone picker controls', async () => {
  const name = 'Sir Bartholomew the Third of Fluffington';
  const clone = selector => {
    const node = document.querySelector(selector).cloneNode(true);
    const select = node.querySelector('select');
    select.innerHTML = '';
    select.append(new Option(name));
    return node.outerHTML;
  };
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:absolute;left:-10000px;top:0;width:320px;height:568px;border:0';
  frame.srcdoc = '<!doctype html><html><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="' + document.querySelector('link[rel=stylesheet]').href + '"></head><body><main>'
    + '<section id="measure-page" class="page"><div class="page-heading">' + clone('#measure-page .dog-picker') + '</div></section>'
    + '<section id="history-page" class="page">' + clone('.history-toolbar') + '</section></main></body></html>';
  const loaded = new Promise(resolve => frame.addEventListener('load', resolve, {once:true}));
  document.body.append(frame);
  try {
    await loaded;
    const doc = frame.contentDocument;
    for (let i = 0; i < 50 && !doc.styleSheets.length; i++) await sleep(50);
    assert(frame.contentWindow.matchMedia('(max-width:600px)').matches, 'the frame is not phone width');
    assert(frame.contentWindow.getComputedStyle(doc.querySelector('#measure-page .dog-picker')).display === 'grid', 'the stylesheet did not apply (picker not a grid)');
    const box = selector => doc.querySelector(selector).getBoundingClientRect();
    assert(box('#selected-dog').right <= box('#add-dog').left + 0.5, 'Measure: the select runs under + Add a dog');
    assert(box('#history-dog-select').right <= box('.history-toolbar .segments').left + 0.5, 'History: the select runs under the period buttons');
    assert(box('.history-toolbar .segments').right <= 320 && box('#add-dog').right <= 320, 'a control is pushed off a 320px screen');
  } finally { frame.remove(); }
});
// Use the real stylesheet with only env() values replaced in this isolated frame. A viewport-only
// test sees zero safe areas and missed Undo moving over the circle on installed phones.
await check('Counting targets stay separate and reachable across phone sizes, safe areas and scrolling', async () => {
  const layoutCss = ${JSON.stringify(readFileSync(new URL('app.css', dist), 'utf8'))};
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:absolute;left:-10000px;top:0;width:390px;height:844px;border:0';
  frame.srcdoc = '<!doctype html><html><head><meta name="viewport" content="width=device-width"><style id="layout"></style></head><body>'
    + document.querySelector('header').outerHTML + document.querySelector('main').outerHTML + '<dialog id="counting-dialog" aria-label="Breath counting"></dialog></body></html>';
  const loaded = new Promise(resolve => frame.addEventListener('load', resolve, {once:true}));
  document.body.append(frame);
  try {
    await loaded;
    const doc = frame.contentDocument, win = frame.contentWindow;
    const circle = doc.querySelector('#breath-button');
    const modal = doc.querySelector('#counting-dialog'), card = doc.querySelector('.counter-card'), home = card.parentElement;
    const anchor = doc.createComment('home'); card.before(anchor);
    const box = selector => doc.querySelector(selector).getBoundingClientRect();
    for (const section of doc.querySelectorAll('.page')) section.hidden = section.id !== 'measure-page';
    doc.querySelector('#update-notice').hidden = false;
    doc.querySelector('#update-notice').textContent = 'Update ready. Save your work and reopen.';
    const active = value => {
      if (value) { modal.append(card); if (!modal.open) modal.showModal(); }
      else { if (modal.open) modal.close(); anchor.after(card); }
      circle.classList.toggle('active', value); circle.disabled = !value;
      doc.querySelector('#counter-number').textContent = value ? '123' : 'Ready';
      doc.querySelector('#start').hidden = value;
      doc.querySelector('#start').disabled = false;
      for (const id of ['undo','cancel']) { doc.getElementById(id).hidden = !value; doc.getElementById(id).disabled = false; }
    };
    const apply = inset => {
      doc.querySelector('#layout').textContent = layoutCss.replaceAll('env(safe-area-inset-bottom)', inset + 'px');
    };
    const viewportBottom = () => modal.open ? win.innerHeight : win.getComputedStyle(doc.querySelector('nav')).position === 'fixed' ? Math.min(win.innerHeight, box('nav').top) : win.innerHeight;
    const reachable = selector => {
      const element = doc.querySelector(selector);
      element.scrollIntoView({block:'center'});
      const r = box(selector), nav = box('nav');
      assert(r.top >= -0.5 && r.bottom <= viewportBottom() + 0.5,
        frame.dataset.case + selector + ' cannot be scrolled above navigation: ' + JSON.stringify({top:r.top,bottom:r.bottom,limit:viewportBottom()}));
      const hit = doc.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      assert(element === hit || element.contains(hit), selector + ' does not receive its center tap');
    };
    const cases = [[320,480],[320,560],[320,561],[320,568],[360,640],[360,641],[360,660],[360,666],
      [375,667],[360,680],[360,684],[375,700],[390,740],[390,844],[440,956],[844,390],[956,440],[390,420],[440,480]];
    for (const [width,height] of cases) for (const inset of [0,20,34,48]) {
      frame.style.width = width + 'px'; frame.style.height = height + 'px'; apply(inset);
      const at = width + 'x' + height + ' inset ' + inset + ': '; frame.dataset.case=at;
      active(false); win.scrollTo(0,0);
      // Prove styling loaded; normal-flow rectangles alone could pass with no CSS.
      assert(win.getComputedStyle(circle).borderRadius === '50%', at + 'circle stylesheet absent');
      if (width <= 600) assert(win.getComputedStyle(doc.querySelector('#counter-controls')).position === 'sticky', at + 'idle Start stopped being sticky');
      reachable('#start');
      active(true); win.scrollTo(0,0);
      const originalTarget=box('#breath-button').toJSON();
      for (const count of ['9','10','99','100']) {
        doc.querySelector('#counter-number').textContent=count;
        assert(JSON.stringify(box('#breath-button').toJSON())===JSON.stringify(originalTarget),at+'target moved as count changed');
      }
      assert(doc.documentElement.scrollWidth <= width, at + 'horizontal overflow');
      for (const y of [0, height / 2, modal.scrollHeight]) {
        modal.scrollTo(0,y);
        const r=box('#breath-button');
        for (const selector of ['#undo','#cancel']) {
          const control=box(selector);
          assert(r.bottom <= control.top + 0.5, at + selector + ' overlaps the circle');
        }
        // Hit-test actual circle points within the unobscured viewport, including its lower edge.
        const nav=box('nav');
        for (const fraction of [0.1,0.5,0.9]) for (const across of [0.1,0.3,0.5,0.7,0.9]) {
          const x=r.x+r.width*across, y=r.y+r.height*fraction;
          if (y<0 || y>=viewportBottom()) continue;
          const hit=doc.elementFromPoint(x,y);
          assert(hit===circle || circle.contains(hit), at + 'a visible breath tap hits another element');
        }
      }
      reachable('#breath-button'); reachable('#undo'); reachable('#cancel');
      if ((width===390 && height===844) || (width===440 && height===956)) {
        const r=box('#breath-button'),controls=box('#counter-controls');
        assert(r.top>=0 && controls.bottom<=height+0.5, at + 'primary portrait cannot show target and controls together');
        assert(r.width>=width-40, at + 'active target is not wide enough');
      }
    }
    // Stress safe-area-like top/side padding and larger control text on the primary profiles.
    // These are synthetic constraints, not a claim that iOS exposes these exact values.
    const stress=doc.createElement('style');
    stress.textContent='body { padding:44px 20px 0; } button, input, select, textarea, #counter-label { font-size:20px !important; }';
    doc.head.append(stress);
    for (const [width,height] of [[390,844],[440,956],[844,390],[956,440]]) {
      frame.style.width=width+'px'; frame.style.height=height+'px'; apply(34); active(true);
      frame.dataset.case='large text/top-side padding '+width+'x'+height+': ';
      assert(doc.documentElement.scrollWidth<=width,frame.dataset.case+'horizontal overflow');
      reachable('#breath-button'); reachable('#undo'); reachable('#cancel');
      assert(box('#breath-button').bottom<=box('#undo').top,frame.dataset.case+'Undo overlaps circle');
    }
    stress.remove();
    // A smaller old-style target must fail the new width invariant.
    frame.style.width='390px'; frame.style.height='844px'; apply(34); active(true);
    const old=doc.createElement('style');
    old.textContent='#counting-dialog .breath-circle { width:225px !important; }';
    doc.head.append(old);
    assert(box('#breath-button').width<350,'Target-width mutation did not shrink the target');
    old.remove();
    assert(box('#breath-button').width>=350,'Wide target did not recover');
  } finally { frame.remove(); }
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
const script = `window.testRun = crypto.randomUUID();\n(async () => {\n${version}\n${updates}\n${workerStub}\n${data}\n${tapSoundSource}\n${replaySource}\n${app}\n${checks}\n})().catch(error => { document.title = 'Pawbreath harness failed'; document.body.prepend(Object.assign(document.createElement('pre'), {textContent:error.stack})); });`;
const outputPath = process.argv[2] || '/tmp/pawbreath-browser-check.html';
let result = replaced(html, '  <script type="module" src="./app.js"></script>', '');
result = replaced(result, /(src|href)="\.\/([^"#]+)"/g, (_, attr, path) => `${attr}="${new URL(path, dist).href}"`);
result = replaced(result, '</body>', () => `<script>${script.replaceAll('</script', '<\\/script')}</script></body>`);
writeFileSync(outputPath, result);
console.log(fileURLToPath(new URL('file://' + outputPath)));
