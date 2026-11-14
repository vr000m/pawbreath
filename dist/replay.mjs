import { validateReading } from './data.mjs';

// Immutable copies: callers, storage refreshes and frame consumers cannot change a running queue.
export function replayableReadings(entries) {
  const queue = [];
  for (const entry of entries) {
    try {
      const reading = validateReading(entry);
      if (!reading.tapOffsetsMs) continue;
      Object.freeze(reading.tapOffsetsMs);
      queue.push(Object.freeze(reading));
    } catch { /* An unavailable trace must not prevent other readings from replaying. */ }
  }
  return queue.sort((a, b) => b.date.localeCompare(a.date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function tapsAt(offsets, elapsed) {
  let low = 0, high = offsets.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (offsets[mid] <= elapsed) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function createReplayController({ now = () => performance.now(),
  requestFrame = callback => requestAnimationFrame(callback), cancelFrame = id => cancelAnimationFrame(id),
  onFrame = () => {}, onEnd = () => {} } = {}) {
  let frame = null, generation = 0;
  function stop() {
    generation++;
    if (frame !== null) cancelFrame(frame);
    frame = null;
  }
  function start(entries) {
    stop();
    const queue = replayableReadings(entries);
    if (!queue.length) return false;
    const token = generation, started = now();
    let index = 0, precedingMs = 0;
    function tick() {
      if (generation !== token) return;
      frame = null;
      const elapsed = Math.max(0, now() - started);
      // Use elapsed time, never a chain of per-tap timers or catch-up pulses.
      while (index < queue.length && elapsed >= precedingMs + queue[index].seconds * 1000) {
        precedingMs += queue[index++].seconds * 1000;
      }
      if (index === queue.length) { stop(); onEnd(); return; }
      const entry = queue[index], elapsedMs = elapsed - precedingMs;
      const tapCount = tapsAt(entry.tapOffsetsMs, elapsedMs);
      const pulseAgeMs = tapCount ? elapsedMs - entry.tapOffsetsMs[tapCount - 1] : Infinity;
      onFrame(Object.freeze({ entry, index, total: queue.length, elapsedMs, tapCount, pulseAgeMs }));
      // An onFrame consumer may stop or replace playback synchronously.
      if (generation === token) frame = requestFrame(tick);
    }
    tick();
    return true;
  }
  return { start, stop };
}
