import { openDatabase, readAll, saveDog, saveReading, deleteReading, restoreBackup,
  readBackupFile, makeBackup, toCsv, respiratoryRate, manualDate, manualDialogAction,
  CONTEXTS, CONTEXT_LABELS, withReadingDefaults, defaultDogId, newestFirst } from './data.mjs';
import { createUpdateMonitor } from './updates.mjs';
import { createTapSound } from './tap-sound.mjs';
import { createReplayController, replayableReadings } from './replay.mjs';
import { createHistoryChart } from './history-chart.mjs';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let db;
let snapshot = { dogs: [], readings: [] };
let selectedId = '';
let page = 'measure';
let duration = 30;
let range = '30';
let historyContext = 'all';
let session = null;
let pending = null;
let manualDraft = null;
let manualDirty = false;
let manualConfirming = false;
let timer = null;
let saving = false;
let editId = null;
let photo = '';
let photoBusy = false;
let toastTimer;
let installPrompt;
let wakeLock;
const tapSound = createTapSound(window.AudioContext || window.webkitAudioContext);
const counterCard = document.querySelector('.counter-card');
const counterHome = document.createComment('Counter home');
counterCard.before(counterHome);
const countingDialog = document.querySelector('#counting-dialog');
const soundOnStatus = 'Tap sound on. Device volume or mute may prevent sound.';
const soundUnavailableStatus = 'Tap sound is not available on this device.';
let soundCheck = 0;
// The only way the app silences tap audio. Suspending makes a pending detect() resolve false, so every stop
// also invalidates that check: its result would describe this suspend, not whether the device can play sound.
function stopTapSound() {
  soundCheck++;
  tapSound.stop();
}
let noticeAnnouncement;
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('pawbreath-updates') : null;
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
// What History last rendered: replay and chart hit-testing use this list, not a fresh filter at click time,
// so the controls always act on the readings the person can see and that were validated as replayable.
let visibleReadings = [];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const historyChart = createHistoryChart({ canvas: $('#history-chart'), timeline: $('#tap-timeline'), reducedMotion });
// The controller is the one record of whether playback runs (replay.active); the chart only paints the frames it gets.
const replay = createReplayController({ onFrame: renderReplay, onEnd: () => clearReplay('Replay finished.') });

// The detail panel keeps its layout space; inactive, it is invisible, unfocusable and hidden from assistive tech.
function setReplayDetail(active) {
  const detail = $('#replay-detail');
  detail.inert = !active;
  detail.setAttribute('aria-hidden', String(!active));
}

function stopReplay(message = 'Replay stopped.') {
  const wasActive = replay.active;
  replay.stop();
  if (wasActive) clearReplay(message);
}

// Playback has ended (stopped, replaced or finished): clear the frame and restore the idle controls.
function clearReplay(message) {
  historyChart.setReplay(null);
  const stop = $('#replay-stop');
  // A disabled Stop button must not strand keyboard and screen-reader focus.
  const refocus = document.activeElement === stop && !document.hidden && !$('#replay-all').disabled;
  $('#replay-status').textContent = message;
  setReplayDetail(false);
  stop.disabled = true;
  if (refocus) $('#replay-all').focus({ preventScroll: true });
  for (const row of $$('.reading-row')) row.classList.remove('replaying');
  drawReplayPoint();
}

function startReplay(entries) {
  if (page !== 'history' || document.hidden || session || pending || $$('dialog[open]').length) return;
  stopReplay();
  if (replay.start(entries)) {
    $('#replay-stop').focus({ preventScroll: true });
    $('#history-chart').scrollIntoView({ block: 'center' });
  }
}

function renderReplay(state) {
  const changed = historyChart.setReplay(state);
  if (changed) {
    $('#replay-stop').disabled = false;
    setReplayDetail(true);
    $('#replay-status').textContent = `Replaying ${dateFormat.format(new Date(state.entry.date))} · ${state.index + 1} of ${state.total}.`;
    for (const row of $$('.reading-row')) row.classList.toggle('replaying', row.dataset.readingId === state.entry.id);
    historyChart.drawTimeline();
  }
  // Frames arrive every display refresh; the text changes at most once a second or per tap.
  const progress = `${Math.floor(state.elapsedMs / 1000)} / ${state.entry.seconds} seconds · ${state.tapCount} / ${state.entry.count} recorded taps`;
  if ($('#replay-progress').textContent !== progress) $('#replay-progress').textContent = progress;
  drawReplayPoint();
}

// The chart is drawn only while History is the page shown.
function drawReplayPoint() {
  if (page === 'history') historyChart.paintRing();
}

$('#replay-all').onclick = () => startReplay(visibleReadings);
$('#replay-stop').onclick = () => stopReplay();
$('#history-chart').onclick = event => {
  const rect = event.currentTarget.getBoundingClientRect();
  const point = historyChart.pointAt(event.clientX - rect.left, event.clientY - rect.top);
  if (point) startReplay([point.entry]);
};
reducedMotion.addEventListener('change', () => { if (replay.active) drawReplayPoint(); });

function showError(error) {
  $('#error').textContent = error.message || 'Something went wrong. Please try again.';
  $('#error').hidden = false;
}

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}

// Context options come from data.mjs, the single definition. Unrecorded context is listed last in the filter.
for (const id of ['#reading-context', '#manual-context']) {
  for (const value of CONTEXTS) $(id).add(new Option(CONTEXT_LABELS[value].label, value));
}
for (const value of [...CONTEXTS.filter(item => item !== 'not-recorded'), 'not-recorded']) {
  $('#history-context').add(new Option(CONTEXT_LABELS[value].filter, value));
}

function dog() { return snapshot.dogs.find(item => item.id === selectedId); }
const DOG_KEY = 'pawbreath.dog';
function rememberedDog() { try { return localStorage.getItem(DOG_KEY) ?? ''; } catch { return ''; } }
// An explicit choice is remembered for the next launch; the automatic default is not.
function chooseDog(id) {
  selectedId = id;
  try { localStorage.setItem(DOG_KEY, id); } catch { /* Optional convenience only. */ }
}
function readingDetails(reading) {
  const entry = withReadingDefaults(reading);
  const context = CONTEXT_LABELS[entry.context]?.short ?? CONTEXT_LABELS['not-recorded'].short;
  const source = entry.source === 'manual' ? 'Manual entry' : `${entry.count} breaths counted over ${entry.seconds} seconds`;
  return `${source} · ${context}${entry.uncertain ? ' · Uncertain' : ''}`;
}
function readings() {
  return snapshot.readings.filter(item => item.dogId === selectedId).sort(newestFirst);
}

function confirmAction(title, message, label = 'Continue') {
  stopReplay();
  return new Promise(resolve => {
    const dialog = $('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-message').textContent = message;
    $('#confirm-yes').textContent = label;
    dialog.returnValue = '';
    $('#confirm-yes').onclick = () => dialog.close('yes');
    $('#confirm-no').onclick = () => dialog.close('no');
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true });
    dialog.showModal();
  });
}

async function refresh() {
  snapshot = await readAll(db);
  snapshot.dogs.sort((a, b) => a.name.localeCompare(b.name));
  if (!dog()) selectedId = defaultDogId(snapshot.dogs, snapshot.readings, rememberedDog());
  renderProfiles();
  renderHistory();
  renderLatest();
  if (!session && !pending) resetCounter();
}

function notifyChange() { channel?.postMessage('updated'); }

async function refreshAfterWrite() {
  $('#error').hidden = true;
  try { await refresh(); }
  catch (error) {
    showError(new Error(`Your changes were saved, but the journal could not refresh. Reload the app. ${error.message}`));
  }
}

function renderProfiles() {
  // The Measure and History pages share one selection, so both pickers show the same dog.
  for (const select of $$('#selected-dog, #history-dog-select')) {
    select.replaceChildren();
    if (!snapshot.dogs.length) select.add(new Option('Add your first dog', ''));
    for (const item of snapshot.dogs) select.add(new Option(item.name, item.id));
    select.value = selectedId;
    select.disabled = !snapshot.dogs.length || !!session || !!pending;
  }
  const current = dog();
  $('#dog-name').textContent = current?.name ?? 'Every breath matters.';
  $('#dog-caption').textContent = current
    ? (current.threshold ? `Threshold you entered · ${current.threshold} breaths/min` : 'No vet threshold entered.')
    : 'Add a profile to start their journal.';
  const avatar = $('#dog-avatar');
  avatar.replaceChildren();
  if (current?.photo) {
    const img = new Image();
    img.src = current.photo;
    img.alt = '';
    avatar.append(img);
  } else avatar.textContent = current ? current.name.slice(0, 1).toUpperCase() : '♡';
  $('#edit-dog').hidden = !current;
  $('#dog-list').replaceChildren();
  for (const item of snapshot.dogs) {
    const row = document.createElement('div');
    row.className = 'dog-list-row';
    const name = document.createElement('span');
    name.textContent = item.name;
    const edit = document.createElement('button');
    edit.className = 'text-button';
    edit.textContent = 'Edit profile ↗';
    edit.setAttribute('aria-label', `Edit ${item.name}'s profile`);
    edit.onclick = () => openDog(item.id);
    row.append(name, edit);
    $('#dog-list').append(row);
  }
}

function renderLatest() {
  const latest = readings()[0];
  const container = $('#latest-reading');
  container.replaceChildren();
  if (!latest) {
    const text = document.createElement('p');
    text.className = 'empty-copy';
    text.textContent = 'Your first reading will appear here.';
    container.append(text);
    return;
  }
  const number = document.createElement('span');
  number.className = 'latest-number';
  number.textContent = latest.rate;
  const unit = document.createElement('span');
  unit.className = 'unit';
  unit.textContent = 'breaths / min';
  const date = document.createElement('p');
  date.textContent = dateFormat.format(new Date(latest.date));
  const meta = document.createElement('p');
  meta.className = 'reading-meta';
  meta.textContent = readingDetails(latest);
  container.append(number, unit, date, meta);
}

function filteredReadings() {
  const cutoff = range === 'all' ? 0 : Date.now() - Number(range) * 86400000;
  return readings().filter(item => Date.parse(item.date) >= cutoff &&
    (historyContext === 'all' || withReadingDefaults(item).context === historyContext));
}

function renderHistory() {
  stopReplay();
  $('#history-dog').textContent = dog() ? `${dog().name}'s breathing journal.` : 'Add a dog and save your first reading.';
  const entries = filteredReadings();
  visibleReadings = entries;
  const replayIds = new Set(replayableReadings(entries).map(entry => entry.id));
  historyChart.show(entries, replayIds);
  $('#replay-all').disabled = replayIds.size === 0;
  $('#reading-total').textContent = `${entries.length} ${entries.length === 1 ? 'reading' : 'readings'}`;
  $('#chart-empty').hidden = entries.length > 0;
  $('#history-chart').hidden = entries.length === 0;
  $('#chart-empty').textContent = 'No readings match this period and context. Try another filter or add a reading.';
  $('#chart-summary').textContent = entries.length
    ? `${Math.min(...entries.map(item => item.rate))}–${Math.max(...entries.map(item => item.rate))} breaths/min for the selected readings${dog()?.threshold ? ` · Dashed line marks the threshold you entered: ${dog().threshold}` : ''}`
    : 'Your observations will build a picture over time.';
  const list = $('#reading-list');
  list.replaceChildren();
  for (const entry of entries) {
    const row = document.createElement('article');
    row.className = 'reading-row';
    row.dataset.readingId = entry.id;
    const details = document.createElement('div');
    details.className = 'reading-details';
    const date = document.createElement('time');
    date.dateTime = entry.date;
    date.textContent = dateFormat.format(new Date(entry.date));
    const meta = document.createElement('p');
    meta.className = 'reading-meta';
    meta.textContent = readingDetails(entry);
    details.append(date, meta);
    if (replayIds.has(entry.id)) {
      const play = document.createElement('button');
      play.className = 'text-button replay-reading';
      play.textContent = 'Replay taps';
      play.setAttribute('aria-label', `Replay recorded taps from ${date.textContent}`);
      play.onclick = () => startReplay([entry]);
      details.append(play);
    } else {
      const unavailable = document.createElement('p');
      unavailable.className = 'reading-meta';
      unavailable.textContent = 'Tap timing unavailable';
      details.append(unavailable);
    }
    if (entry.notes) {
      const notes = document.createElement('p');
      notes.textContent = entry.notes;
      details.append(notes);
    }
    const actions = document.createElement('div');
    actions.className = 'reading-actions';
    const value = document.createElement('div');
    value.className = 'reading-value';
    value.textContent = entry.rate;
    const unit = document.createElement('div');
    unit.className = 'reading-meta';
    unit.textContent = 'breaths/min';
    const remove = document.createElement('button');
    remove.className = 'text-button delete-reading';
    remove.textContent = 'Delete';
    remove.setAttribute('aria-label', `Delete reading from ${date.textContent}`);
    remove.onclick = async () => {
      if (!await confirmAction('Delete this reading?', 'This removes the reading from this device. A previously downloaded backup may still contain it.', 'Delete reading')) return;
      remove.disabled = true;
      try { await deleteReading(db, entry.id); await refreshAfterWrite(); notifyChange(); toast('Reading deleted.'); }
      catch (error) { remove.disabled = false; showError(error); }
    };
    actions.append(value, unit, remove);
    row.append(details, actions);
    list.append(row);
  }
  if (page === 'history' && entries.length) requestAnimationFrame(drawChart);
}

// Redraws (resize) reuse what History rendered; a fresh filter would apply a later Date.now() cutoff.
function drawChart() {
  historyChart.draw({ visible: page === 'history', threshold: dog()?.threshold });
}

function setLocked(locked) {
  for (const select of $$('#selected-dog, #history-dog-select')) select.disabled = locked || !snapshot.dogs.length;
  for (const element of $$('[data-page], [data-duration], #add-dog, #edit-dog')) element.disabled = locked;
  for (const element of $$('#manual-entry, #history-manual-entry')) element.disabled = locked || !dog() || !db;
  $('#tap-sound').disabled = locked;
}

function leaveCountingView() {
  const moved = counterCard.parentElement === countingDialog;
  if (countingDialog.open) countingDialog.close();
  if (moved) counterHome.after(counterCard);
  // Only a count ending releases audio and supersedes a pending tap-sound check. A reset that ended no count
  // (refresh, duration, dog select, save, discard) leaves the tick's check to report the device.
  if (moved) {
    stopTapSound();
    announceUpdateNotice();
  }
  return moved;
}

// A notice that arrived during a count was inert behind the modal and never announced.
// Clear and restore its text once the modal closes so the status live region announces it.
function announceUpdateNotice() {
  const notice = $('#update-notice');
  const message = notice.textContent;
  if (notice.hidden || !message) return;
  clearTimeout(noticeAnnouncement);
  notice.textContent = '';
  noticeAnnouncement = setTimeout(() => { notice.textContent = message; }, 100);
}

function resetCounter(message = '') {
  const wasCounting = leaveCountingView();
  $('#counter-number').textContent = 'Ready';
  $('#counter-label').textContent = 'Count one breath';
  $('#timer-label').textContent = `${duration}-second measurement`;
  $('#timer-progress').value = 0;
  $('#timer-progress').max = duration;
  $('#breath-button').disabled = true;
  $('#breath-button').classList.remove('active');
  $('#start').hidden = false;
  $('#start').disabled = !dog() || !db;
  $('#undo').hidden = true;
  $('#cancel').hidden = true;
  $('#result').hidden = true;
  $('#reading-notes').value = '';
  $('#reading-context').value = 'not-recorded';
  $('#reading-uncertain').checked = false;
  $('#counter-instruction').textContent = 'Wait until your dog is settled or asleep.';
  $('#counter-status').textContent = message || (dog() ? 'Start the timer, then tap for each breath.' : 'Add your dog to begin.');
  setLocked(false);
  if (wasCounting) $('#start').focus();
}

async function releaseWakeLock() {
  if (wakeLock) { await wakeLock.release().catch(() => {}); wakeLock = null; }
}

function stopTimer() {
  clearInterval(timer);
  timer = null;
  releaseWakeLock();
}

function cancelCount(message = 'Count cancelled. Start again when your dog is settled.') {
  stopTimer();
  session = null;
  resetCounter(message);
}

function completeCount() {
  const finished = session;
  if (!finished) return;
  stopTimer();
  session = null;
  const count = finished.tapOffsetsMs.length;
  if (!count) { resetCounter('No breaths were counted. Please try again.'); return; }
  leaveCountingView();
  pending = { id: crypto.randomUUID(), dogId: finished.dogId, date: finished.date,
    count, seconds: finished.seconds, tapOffsetsMs: [...finished.tapOffsetsMs],
    rate: respiratoryRate(count, finished.seconds), notes: '', source: 'timed', context: 'not-recorded', uncertain: false };
  $('#timer-progress').value = finished.seconds;
  $('#timer-label').textContent = 'Measurement complete';
  $('#breath-button').disabled = true;
  $('#breath-button').classList.remove('active');
  $('#undo').hidden = true;
  $('#cancel').hidden = true;
  $('#result').hidden = false;
  $('#result-rate').textContent = `${pending.rate} breaths per minute`;
  const exceeds = dog()?.threshold && pending.rate >= dog().threshold;
  $('#result-threshold').textContent = exceeds ? `At or above the threshold you entered: ${dog().threshold} breaths/min. Follow the guidance your vet gave you.` : 'Review your count, add any notes, and save this moment.';
  $('#result-threshold').className = exceeds ? 'threshold-note' : 'muted';
  $('#counter-status').textContent = 'Reading ready to save.';
  $('#counter-label').textContent = count === 1 ? 'breath counted' : 'breaths counted';
  $('#counter-instruction').textContent = `${count} breaths counted in ${finished.seconds} seconds.`;
  $('#save-reading').focus();
}

function tick() {
  if (!session) return;
  const elapsed = performance.now() - session.started;
  if (elapsed >= session.seconds * 1000) { completeCount(); return; }
  $('#timer-label').textContent = `${Math.ceil(session.seconds - elapsed / 1000)} seconds remaining`;
  $('#timer-progress').value = elapsed / 1000;
}

$('#start').onclick = async () => {
  if (!dog() || session || pending) return;
  stopReplay();
  $('#error').hidden = true;
  session = { dogId: selectedId, date: new Date().toISOString(), started: performance.now(), seconds: duration, tapOffsetsMs: [] };
  setLocked(true);
  $('#start').hidden = true;
  $('#undo').hidden = false;
  $('#undo').disabled = true;
  $('#cancel').hidden = false;
  $('#breath-button').disabled = false;
  $('#breath-button').classList.add('active');
  $('#counter-number').textContent = '0';
  $('#counter-instruction').textContent = 'Watch your dog. Tap the large area once per breath.';
  $('#counter-status').textContent = $('#tap-sound').checked ? soundOnStatus : 'Keep this screen open while counting.';
  countingDialog.append(counterCard);
  try { countingDialog.showModal(); }
  catch { cancelCount('Could not open counting. Please try again.'); return; }
  tapSound.prepare($('#tap-sound').checked);
  $('#breath-button').focus();
  timer = setInterval(tick, 100);
  tick();
  if ('wakeLock' in navigator) {
    try { wakeLock = await navigator.wakeLock.request('screen'); if (!session) releaseWakeLock(); }
    catch { /* Counting still works when screen wake lock is unavailable. */ }
  }
};

$('#breath-button').onclick = event => {
  if (event.detail > 0) event.preventDefault();
  if (!session) return;
  const elapsed = performance.now() - session.started;
  if (elapsed >= session.seconds * 1000) { completeCount(); return; }
  session.tapOffsetsMs.push(Math.floor(elapsed));
  // The count is always the trace length; no separate counter can drift from it.
  $('#counter-number').textContent = session.tapOffsetsMs.length;
  $('#undo').disabled = false;
  tapSound.play();
};
// Ticking the box is a user gesture: start audio here and report what this device actually allows.
// Unavailable audio unticks the box, so the checkbox always matches whether a count will try to sound.
$('#tap-sound').onchange = async () => {
  const box = $('#tap-sound');
  const status = $('#counter-status');
  if (!box.checked) {
    // Unticking is the opt-out: silence and suspend audio started by the tick; stopTapSound() also makes a pending
    // detect() ignore its result. Counting never reads audio state, and the box is locked while a count runs.
    stopTapSound();
    if (!session && !pending && [soundOnStatus, soundUnavailableStatus].includes(status.textContent)) {
      status.textContent = dog() ? 'Start the timer, then tap for each breath.' : 'Add your dog to begin.';
    }
    return;
  }
  // A count ending (or an untick) before detect() settles supersedes this tick: the box stays ticked, so the next
  // count still attempts sound, and the count's own message stays.
  const attempt = ++soundCheck;
  const available = await tapSound.detect();
  if (attempt !== soundCheck || !box.checked) return;
  if (!available) { box.checked = false; tapSound.prepare(false); }
  if (!pending) status.textContent = available ? soundOnStatus : soundUnavailableStatus;
};
$('#breath-button').onkeydown = event => { if (event.repeat) event.preventDefault(); };
$('#undo').onclick = () => {
  if (!session) return;
  if (performance.now() - session.started >= session.seconds * 1000) { completeCount(); return; }
  session.tapOffsetsMs.pop();
  $('#counter-number').textContent = session.tapOffsetsMs.length;
  $('#undo').disabled = session.tapOffsetsMs.length === 0;
};
$('#cancel').onclick = () => cancelCount();
countingDialog.addEventListener('cancel', event => {
  event.preventDefault();
  if (session) cancelCount();
});
countingDialog.addEventListener('close', () => {
  // close events are queued: an old event must not cancel a newly opened count.
  if (!countingDialog.open && session) cancelCount();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopReplay();
  if (document.hidden && session) cancelCount('The count stopped when the app left the screen. Please start a new measurement.');
  if (!document.hidden && db && !session && !pending) refresh().catch(showError);
});
window.addEventListener('pagehide', () => { stopReplay(); if (session) cancelCount(); });
window.addEventListener('beforeunload', event => {
  if (session || pending || saving || (manualDraft && manualDirty)) { event.preventDefault(); event.returnValue = ''; }
});
$('#save-reading').onclick = async () => {
  if (!pending || saving) return;
  saving = true;
  $('#save-reading').disabled = true;
  $('#discard').disabled = true;
  pending.notes = $('#reading-notes').value.trim();
  pending.context = $('#reading-context').value;
  pending.uncertain = $('#reading-uncertain').checked;
  try {
    await saveReading(db, pending);
    revealSavedReading(pending);
    pending = null;
    resetCounter();
    await refreshAfterWrite();
    notifyChange();
    toast('Reading saved to your journal.');
  } catch (error) { showError(new Error(`Could not save the reading. ${error.message}`)); }
  finally { saving = false; $('#save-reading').disabled = false; $('#discard').disabled = false; }
};
$('#discard').onclick = async () => {
  if (await confirmAction('Discard this count?', 'The completed measurement has not been saved.', 'Discard')) {
    pending = null; resetCounter();
  }
};

function openManual() {
  if (!db || !dog() || session || pending || saving || manualDraft) return;
  stopReplay();
  manualDraft = { id: crypto.randomUUID(), dogId: selectedId };
  manualDirty = false;
  $('#manual-form').reset();
  $('#manual-error').textContent = '';
  $('#manual-dog').textContent = `For ${dog().name}`;
  $('#manual-timezone').textContent = `Times use this device’s time zone (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`;
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  $('#manual-date').value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  $('#manual-dialog').showModal();
  $('#manual-rate').focus();
}
function setManualBusy(busy) {
  $('#manual-fields').disabled = busy;
  for (const button of $$('#save-manual, #close-manual, #cancel-manual')) button.disabled = busy;
}
async function closeManual() {
  if (saving || manualConfirming) return;
  if (!manualDirty) { finishManual(); return; }
  manualConfirming = true;
  let discard = false;
  try { discard = await confirmAction('Discard this entry?', 'The manual reading has not been saved.', 'Discard'); }
  finally { manualConfirming = false; }
  const action = manualDialogAction({ event: 'confirmed', dirty: manualDirty, discard, dialogOpen: $('#manual-dialog').open });
  if (action === 'finish') finishManual();
  else if (action === 'reopen' && manualDraft) $('#manual-dialog').showModal();
}
function finishManual() {
  manualDraft = null;
  manualDirty = false;
  $('#manual-dialog').close();
}
$('#manual-entry').onclick = openManual;
$('#history-manual-entry').onclick = openManual;
$('#close-manual').onclick = closeManual;
$('#cancel-manual').onclick = closeManual;
$('#manual-form').addEventListener('input', () => { manualDirty = true; });
// Browsers let a page cancel Escape only once per user activation, so a dirty dialog can still
// close without Save or Discard. manualDialogAction (data.mjs) keeps one modal on top and the draft intact.
$('#manual-dialog').addEventListener('cancel', event => {
  const action = manualDialogAction({ event: 'cancel', dirty: manualDirty, cancelable: event.cancelable, confirmOpen: manualConfirming });
  if (event.cancelable) event.preventDefault();
  if (saving) return;
  if (action === 'confirm') closeManual();
  else if (action === 'finish') finishManual();
});
$('#manual-dialog').addEventListener('close', () => {
  const action = manualDialogAction({ event: 'close', dirty: manualDirty && !!manualDraft, confirmOpen: manualConfirming });
  if (action === 'reopen') $('#manual-dialog').showModal();
  else if (action === 'clear') manualDraft = null;
});
$('#manual-form').onsubmit = async event => {
  event.preventDefault();
  if (!manualDraft || saving || !$('#manual-form').reportValidity()) return;
  saving = true;
  setManualBusy(true);
  try {
    const entry = { ...manualDraft, source: 'manual', count: null, seconds: null,
      rate: Number($('#manual-rate').value), date: manualDate($('#manual-date').value),
      context: $('#manual-context').value, uncertain: $('#manual-uncertain').checked, notes: $('#manual-notes').value.trim() };
    await saveReading(db, entry);
    finishManual();
    revealSavedReading(entry);
    await refreshAfterWrite();
    notifyChange();
    toast('Manual reading saved to your journal.');
  } catch (error) { $('#manual-error').textContent = `Could not save the reading. ${error.message}`; }
  finally {
    saving = false;
    setManualBusy(false);
  }
};

for (const button of $$('[data-duration]')) button.onclick = () => {
  if (session || pending) return;
  duration = Number(button.dataset.duration);
  $$('[data-duration]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  resetCounter();
};

function showPage(next) {
  if (session || pending || !['measure', 'history', 'settings'].includes(next)) return;
  stopReplay();
  page = next;
  for (const section of $$('.page')) section.hidden = section.id !== `${page}-page`;
  for (const button of $$('nav [data-page]')) {
    if (button.dataset.page === page) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  if (page === 'history') renderHistory();
  window.scrollTo(0, 0);
}
$$('[data-page]').forEach(button => { button.onclick = () => showPage(button.dataset.page); });
$('.brand').onclick = event => { event.preventDefault(); showPage('measure'); };
for (const select of $$('#selected-dog, #history-dog-select')) {
  select.onchange = () => { chooseDog(select.value); renderProfiles(); renderLatest(); renderHistory(); resetCounter(); };
}
function setRange(value) {
  range = value;
  $$('[data-range]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.range === value)));
}
for (const button of $$('[data-range]')) button.onclick = () => { setRange(button.dataset.range); renderHistory(); };
function setHistoryContext(value) {
  historyContext = value;
  $('#history-context').value = value;
}
function revealSavedReading(entry) {
  // A newly saved reading must not appear to be lost behind an earlier filter.
  if (range !== 'all' && Date.parse(entry.date) < Date.now() - Number(range) * 86400000) setRange('all');
  if (historyContext !== 'all' && historyContext !== entry.context) setHistoryContext('all');
}
$('#history-context').onchange = () => { setHistoryContext($('#history-context').value); renderHistory(); };
window.addEventListener('resize', () => { if (page === 'history') { drawChart(); historyChart.drawTimeline(); } });

function previewPhoto() {
  $('#photo-preview').hidden = !photo;
  $('#remove-photo').hidden = !photo;
  if (photo) $('#photo-preview').src = photo;
  else $('#photo-preview').removeAttribute('src');
}

function openDog(id = null) {
  if (session || pending || !db) return;
  stopReplay();
  const current = snapshot.dogs.find(item => item.id === id);
  editId = current?.id ?? null;
  photo = current?.photo ?? '';
  $('#dog-form').reset();
  $('#dog-input').value = current?.name ?? '';
  $('#threshold-input').value = current?.threshold ?? '';
  $('#dog-dialog-title').textContent = current ? 'Edit your dog' : 'Add your dog';
  $('#dog-error').textContent = '';
  previewPhoto();
  $('#dog-dialog').showModal();
  $('#dog-input').focus();
}
$('#add-dog').onclick = () => openDog();
$('#settings-add-dog').onclick = () => openDog();
$('#edit-dog').onclick = () => openDog(selectedId);
$('#close-dog').onclick = () => { if (!photoBusy && !saving) $('#dog-dialog').close(); };
$('#dog-dialog').addEventListener('cancel', event => { if (photoBusy || saving) event.preventDefault(); });
$('#remove-photo').onclick = () => { photo = ''; $('#photo-input').value = ''; previewPhoto(); };
$('#photo-input').onchange = async () => {
  const file = $('#photo-input').files[0];
  if (!file) return;
  photoBusy = true;
  $('#save-dog').disabled = true;
  $('#remove-photo').disabled = true;
  $('#photo-input').disabled = true;
  $('#dog-error').textContent = '';
  let url;
  try {
    if (file.size > 15000000) throw new Error('Choose an image smaller than 15 MB.');
    url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 320;
    const ctx = canvas.getContext('2d');
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.fillStyle = '#e6edde'; ctx.fillRect(0, 0, 320, 320);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 320, 320);
    photo = canvas.toDataURL('image/jpeg', 0.8);
    previewPhoto();
  } catch (error) { $('#dog-error').textContent = `Could not read that photo. ${error.message}`; }
  finally {
    if (url) URL.revokeObjectURL(url);
    photoBusy = false;
    $('#save-dog').disabled = false;
    $('#remove-photo').disabled = false;
    $('#photo-input').disabled = false;
  }
};
$('#dog-form').onsubmit = async event => {
  event.preventDefault();
  if (saving || photoBusy) return;
  saving = true;
  $('#save-dog').disabled = true;
  const value = $('#threshold-input').value;
  const entry = { id: editId ?? crypto.randomUUID(), name: $('#dog-input').value.trim(),
    threshold: value ? Number(value) : null, photo };
  try {
    await saveDog(db, entry);
    // Adding a dog is a choice worth remembering; editing one from Settings only follows it for this session.
    if (editId) selectedId = entry.id; else chooseDog(entry.id);
    $('#dog-dialog').close();
    await refreshAfterWrite();
    notifyChange();
    toast('Profile saved.');
    navigator.storage?.persist?.().catch(() => {});
  } catch (error) { $('#dog-error').textContent = `Could not save the profile. ${error.message}`; }
  finally { saving = false; $('#save-dog').disabled = false; }
};

function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
$('#backup').onclick = async () => {
  try {
    const fresh = await readAll(db);
    download(JSON.stringify(makeBackup(fresh), null, 2), `pawbreath-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    $('#backup-status').textContent = 'Backup prepared. Keep the downloaded file somewhere you can find it.';
  } catch (error) { showError(error); }
};
$('#csv-export').onclick = async () => {
  try {
    const fresh = await readAll(db);
    download(toCsv(fresh), `pawbreath-readings-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
    toast('CSV prepared with readings for all dogs.');
  } catch (error) { showError(error); }
};
$('#restore').onclick = () => $('#restore-file').click();
$('#restore-file').onchange = async () => {
  const file = $('#restore-file').files[0];
  if (!file) return;
  $('#restore').disabled = true;
  try {
    const backup = await readBackupFile(file);
    if (!await confirmAction('Restore this backup?', `Add missing records from ${backup.dogs.length} dogs and ${backup.readings.length} readings? Existing records with matching IDs stay as they are.`, 'Restore')) return;
    const result = await restoreBackup(db, backup);
    await refreshAfterWrite(); notifyChange();
    toast(`Restored ${result.added} new records.`);
    $('#backup-status').textContent = 'Backup restored. Existing records were kept.';
  } catch (error) { showError(new Error(`Could not restore the backup. ${error.message}`)); }
  finally { $('#restore').disabled = false; $('#restore-file').value = ''; }
};

if (channel) channel.onmessage = () => { if (!session && !pending && !saving) refresh().catch(showError); };
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); installPrompt = event; $('#install').hidden = false;
});
$('#install').onclick = async () => {
  if (!installPrompt) return;
  await installPrompt.prompt(); installPrompt = null; $('#install').hidden = true;
};

function connectionStatus(ready = false) {
  $('#offline-status').textContent = navigator.onLine ? (ready ? 'Offline ready' : 'On this device') : 'Offline';
}
let updateStorage;
try { updateStorage = window.localStorage; } catch { /* Version checks do not require storage. */ }
const updates = createUpdateMonitor({ storage: updateStorage, onChange(state) {
  const label = release => `${release.version} · build ${release.build}`;
  $('#app-version').textContent = `Running ${label(state.running)}`;
  $('#published-version').textContent = state.latest ? `Published ${label(state.latest)}` : '';
  $('#update-status').textContent = state.message;
  $('#last-update-check').textContent = state.checked
    ? `Last successful check: ${dateFormat.format(new Date(state.checked))}` : 'No successful update check yet.';
  $('#check-updates').disabled = state.checking;
  clearTimeout(noticeAnnouncement);
  $('#update-notice').hidden = !state.waiting && !state.activationChanged;
  $('#update-notice').textContent = state.message;
  $('#cache-status').textContent = !state.supported ? 'Offline loading is unavailable in this browser. Use a current browser over HTTPS.'
    : state.offlineReady ? 'App saved for offline use. Offline readiness does not indicate whether the app is up to date.'
    : 'Offline setup is not complete. Connect to the internet and check for updates.';
  connectionStatus(state.offlineReady);
} });
function prepareOffline() { return updates.check(); }
$('#check-updates').onclick = () => updates.check();
window.addEventListener('online', () => updates.check());
window.addEventListener('offline', () => updates.refresh());
// Home-screen apps can stay alive for days. Refresh update information when resumed.
let lastResumeCheck = 0;
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - lastResumeCheck > 60000) {
    lastResumeCheck = Date.now();
    updates.check();
  }
});

try {
  db = await openDatabase();
  await refresh();
  prepareOffline();
} catch (error) {
  for (const button of $$('#add-dog, #settings-add-dog, #backup, #restore, #csv-export')) button.disabled = true;
  showError(new Error(`Your journal could not open. ${error.message} Check browser storage permissions and reload.`));
  $('#counter-status').textContent = 'Storage must be available before recording a reading.';
  connectionStatus(updates.getState().offlineReady);
}
