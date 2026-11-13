import { RELEASE } from './version.mjs';

const CHECK_KEY = 'pawbreath-last-update-check';
const sameRelease = (a, b) => a?.version === b?.version && a?.build === b?.build;

export function validRelease(value) {
  return typeof value?.version === 'string' && typeof value?.build === 'string' &&
    /^\d+\.\d+\.\d+$/.test(value.version) && /^[a-f0-9]{12}$/.test(value.build);
}

function withTimeout(promise, ms = 20000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Update check timed out.')), ms);
  })]).finally(() => clearTimeout(timer));
}

async function fetchRelease() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    // release.json is deliberately absent from the offline cache.
    const response = await fetch('./release.json', { cache: 'no-store', signal: controller.signal });
    if (!response.ok || response.redirected) throw new Error('Release unavailable.');
    const release = await response.json();
    if (!validRelease(release)) throw new Error('Invalid release.');
    return release;
  } finally { clearTimeout(timer); }
}

// Never activates a waiting worker or reloads a client. All tabs must close naturally,
// so checking for updates cannot interrupt a count, a pending result, or an edited form.
export function createUpdateMonitor({
  serviceWorker = globalThis.navigator?.serviceWorker,
  online = () => globalThis.navigator.onLine,
  getRelease = fetchRelease,
  storage,
  now = () => new Date().toISOString(),
  onChange = () => {},
} = {}) {
  let registration;
  let checking = false;
  let latest = null;
  let checked = null;
  let error = false;
  let activationChanged = false;
  const observed = new WeakSet();
  try {
    const saved = storage?.getItem(CHECK_KEY);
    if (saved && Number.isFinite(Date.parse(saved))) checked = saved;
  } catch { /* Update checks still work when browser storage is restricted. */ }

  function state() {
    const connected = online();
    const waiting = !!registration?.waiting;
    const installing = !!registration?.installing;
    let message;
    if (waiting) {
      message = 'Update ready. Save your work, fully close Pawbreath and all its browser tabs, then reopen.';
      if (!connected) message += ' The downloaded update can be used offline.';
    } else if (activationChanged) message = 'An update has activated. Save your work, then close and reopen Pawbreath to load it.';
    else if (!connected) message = 'Offline. Connect to the internet to check for updates.';
    else if (checking || installing) message = installing ? 'Downloading app for offline use…' : 'Checking for updates…';
    else if (error) message = 'Could not complete the update check. Your current app is still available. Try again when connected.';
    else if (latest && sameRelease(latest, RELEASE)) message = 'You’re running the latest published version as of the last successful check.';
    else if (latest) message = 'A different version is published. Its download is not ready yet; check again to retry.';
    else message = 'Connect and check for the latest published version.';
    return { running: RELEASE, latest, checked, checking, waiting, installing, activationChanged,
      offlineReady: !!registration?.active || !!serviceWorker?.controller, supported: !!serviceWorker, message };
  }
  function emit() { onChange(state()); }
  function observe(worker) {
    if (!worker || observed.has(worker)) return;
    observed.add(worker);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'redundant') error = true;
      emit();
    });
  }
  function watchRegistration(value) {
    // Concurrent offline lookups resolve to the same registration; listen to it once.
    if (registration === value) return;
    registration = value;
    registration.addEventListener('updatefound', () => { observe(registration.installing); emit(); });
    observe(registration.installing);
    emit();
  }
  async function check() {
    if (checking) return;
    if (!online()) {
      // Recover an already-downloaded update after an offline relaunch too.
      if (!registration && serviceWorker) {
        try {
          const existing = await withTimeout(serviceWorker.getRegistration('./'));
          if (existing) watchRegistration(existing);
        } catch { /* Keep the installed app usable if registration lookup fails. */ }
      }
      emit(); return;
    }
    checking = true;
    error = false;
    emit();
    try {
      if (serviceWorker) {
        // update() rejects with InvalidStateError on a registration with no worker at all, which is what
        // a failed first installation leaves behind. Register again so the retry can still succeed.
        if (!registration || !(registration.installing || registration.waiting || registration.active)) {
          watchRegistration(await withTimeout(serviceWorker.register('./sw.js', { updateViaCache: 'none' })));
        } else await withTimeout(registration.update());
      }
      const published = await getRelease();
      if (!validRelease(published)) throw new Error('Invalid release.');
      latest = published;
      // A first installation may have claimed this page before the published release was known.
      if (claimedWhileUnknown && !sameRelease(latest, RELEASE)) activationChanged = true;
      claimedWhileUnknown = false;
      checked = now();
      try { storage?.setItem(CHECK_KEY, checked); } catch { /* Optional metadata only. */ }
    } catch { error = true; }
    finally { checking = false; emit(); }
  }
  let hadController = !!serviceWorker?.controller;
  let claimedWhileUnknown = false;
  serviceWorker?.addEventListener('controllerchange', () => {
    // First installation claims the current page too; that alone is not an update. If the published
    // release is not known yet, remember the claim so check() can apply the same rule once it is.
    if (hadController) activationChanged = true;
    else if (!latest) claimedWhileUnknown = true;
    else if (!sameRelease(latest, RELEASE)) activationChanged = true;
    hadController = true;
    emit();
  });
  emit();
  return { check, refresh: emit, getState: state };
}
