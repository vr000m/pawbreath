export const FORMAT = 'pawbreath';
export const VERSION = 1;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function validId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value);
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

export function validateDog(dog) {
  requireValue(dog && validId(dog.id), 'A dog profile has an invalid ID.');
  requireValue(typeof dog.name === 'string' && dog.name.trim().length > 0 && dog.name.length <= 60,
    'Dog names must contain 1–60 characters.');
  requireValue(dog.threshold === null || (Number.isFinite(dog.threshold) && dog.threshold >= 1 && dog.threshold <= 300),
    'The optional threshold must be between 1 and 300.');
  requireValue(typeof dog.photo === 'string' && dog.photo.length <= 300000 &&
    (dog.photo === '' || /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(dog.photo)),
    'A profile photo is invalid or too large.');
  return { id: dog.id, name: dog.name.trim(), threshold: dog.threshold, photo: dog.photo };
}

export function respiratoryRate(count, seconds) {
  return Math.round(count * 60 / seconds * 10) / 10;
}

export function validateReading(reading) {
  requireValue(reading && validId(reading.id) && validId(reading.dogId), 'A reading has an invalid ID.');
  requireValue(validDate(reading.date), 'A reading has an invalid date.');
  requireValue(Number.isInteger(reading.count) && reading.count > 0 && reading.count <= 10000,
    'A reading must contain a positive breath count.');
  requireValue([30, 60].includes(reading.seconds), 'A reading must use a 30- or 60-second count.');
  requireValue(reading.rate === respiratoryRate(reading.count, reading.seconds), 'A reading has an inconsistent breathing rate.');
  requireValue(typeof reading.notes === 'string' && reading.notes.length <= 2000, 'Notes must contain at most 2,000 characters.');
  return { id: reading.id, dogId: reading.dogId, date: reading.date, count: reading.count,
    seconds: reading.seconds, rate: reading.rate, notes: reading.notes };
}

export function validateBackup(input) {
  requireValue(input && input.format === FORMAT && input.version === VERSION,
    'Choose a Pawbreath version 1 backup (.json).');
  requireValue(Array.isArray(input.dogs) && Array.isArray(input.readings), 'This backup is incomplete.');
  const dogs = input.dogs.map(validateDog);
  const readings = input.readings.map(validateReading);
  const dogIds = new Set(dogs.map(dog => dog.id));
  requireValue(dogIds.size === dogs.length, 'This backup contains duplicate dog IDs.');
  requireValue(new Set(readings.map(reading => reading.id)).size === readings.length,
    'This backup contains duplicate reading IDs.');
  requireValue(readings.every(reading => dogIds.has(reading.dogId)), 'A reading is missing its dog profile.');
  return { format: FORMAT, version: VERSION, dogs, readings };
}

export function makeBackup(snapshot) {
  return { ...validateBackup({ format: FORMAT, version: VERSION, ...snapshot }), exportedAt: new Date().toISOString() };
}

export async function readBackupFile(file) {
  return validateBackup(JSON.parse(await file.text()));
}

function csvCell(value) {
  let text = String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function toCsv(snapshot) {
  const names = new Map(snapshot.dogs.map(dog => [dog.id, dog.name]));
  const rows = [['Dog', 'Timestamp (UTC)', 'Breaths per minute', 'Breaths counted', 'Seconds', 'Notes']];
  for (const reading of [...snapshot.readings].sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([names.get(reading.dogId) ?? '', reading.date, reading.rate, reading.count, reading.seconds, reading.notes]);
  }
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pawbreath', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('dogs', { keyPath: 'id' });
      db.createObjectStore('readings', { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Pawbreath tabs, then reload to open your journal.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

// Resolve only when the transaction commits. Queued writes are atomic across both stores.
function transaction(db, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['dogs', 'readings'], mode);
    const result = {};
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error ?? new Error('The storage transaction was cancelled. Please try again.'));
    tx.onerror = () => {}; // The abort event owns failure reporting.
    try {
      work(tx, result);
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
}

export function readAll(db) {
  return transaction(db, 'readonly', (tx, result) => {
    for (const name of ['dogs', 'readings']) {
      tx.objectStore(name).getAll().onsuccess = event => { result[name] = event.target.result; };
    }
  });
}

export function saveDog(db, input) {
  const dog = validateDog(input);
  return transaction(db, 'readwrite', tx => tx.objectStore('dogs').put(dog));
}

export function saveReading(db, input) {
  const reading = validateReading(input);
  return transaction(db, 'readwrite', tx => {
    tx.objectStore('dogs').get(reading.dogId).onsuccess = event => {
      if (!event.target.result) { tx.abort(); return; }
      // A retry of the same result uses the same ID, so it cannot create duplicates.
      tx.objectStore('readings').put(reading);
    };
  });
}

export function deleteReading(db, id) {
  return transaction(db, 'readwrite', tx => tx.objectStore('readings').delete(id));
}

export function restoreBackup(db, input) {
  const backup = validateBackup(input);
  return transaction(db, 'readwrite', (tx, result) => {
    result.added = 0;
    for (const name of ['dogs', 'readings']) {
      const store = tx.objectStore(name);
      for (const record of backup[name]) {
        store.get(record.id).onsuccess = event => {
          if (!event.target.result) {
            store.add(record);
            result.added++;
          }
        };
      }
    }
  });
}
