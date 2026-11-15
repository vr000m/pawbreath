import { newestFirst } from './data.mjs';

// The History chart: drawing, point layout and hit-testing, and the replay ring and tap timeline. It owns its canvases
// and replay drawing state and touches no other DOM; app.js wires it to History, buttons, text and focus.

// How far (CSS pixels) a click may land from a point and still choose it.
export const CHART_HIT_RADIUS = 14;
// How long a recorded tap's ring takes to settle back to its resting size.
const RING_PULSE_MS = 240;

// History lists readings newest first; the chart x-axis is chronological. Only replayable readings get points, so a
// reading whose trace cannot replay has no hit target. `readings` must not be empty.
export function layoutChart(readings, { width, height, threshold, replayable = new Set() }) {
  const entries = [...readings].reverse();
  const left = 34, right = width - 15, top = 15, bottom = height - 32;
  const maximum = Math.max(10, ...entries.map(item => item.rate), threshold ?? 0);
  const ceiling = Math.ceil(maximum / 10) * 10 + 10;
  const start = Date.parse(entries[0].date);
  const end = Date.parse(entries.at(-1).date);
  const x = date => start === end ? (left + right) / 2 : left + (Date.parse(date) - start) / (end - start) * (right - left);
  const y = rate => bottom - rate / ceiling * (bottom - top);
  const points = entries.filter(entry => replayable.has(entry.id)).map(entry => ({ entry, x: x(entry.date), y: y(entry.rate) }));
  return { entries, left, right, top, bottom, ceiling, start, end, x, y, points };
}

// The nearest point within the radius. Overlapping points (equal distance) go to the reading History lists first.
export function hitTest(points, x, y, radius = CHART_HIT_RADIUS) {
  return points.map(point => ({ ...point, distance: Math.hypot(point.x - x, point.y - y) }))
    .filter(point => point.distance <= radius)
    .sort((a, b) => a.distance - b.distance || newestFirst(a.entry, b.entry))[0];
}

// Extra ring size for the active point: 1 at a recorded tap, easing to 0; always 0 with reduced motion.
export function ringPulse(pulseAgeMs, reduced) {
  return reduced ? 0 : Math.max(0, 1 - pulseAgeMs / RING_PULSE_MS);
}

export function createHistoryChart({ canvas, timeline, reducedMotion, pixelRatio = () => globalThis.devicePixelRatio || 1,
  background = canvas.ownerDocument.createElement('canvas') }) {
  let readings = [], replayable = new Set(), points = [], replay = null;
  // The ring last painted; frames that would repaint the identical image are skipped.
  let drawnRing = null;

  // The readings History rendered (newest first) and which of them can replay. Redraws (resize) reuse them rather
  // than filtering again, which would apply a later Date.now() cutoff.
  function show(next, ids) {
    readings = next;
    replayable = ids;
    points = [];
  }

  function draw({ visible = true, threshold } = {}) {
    points = [];
    drawnRing = null;
    if (!readings.length || canvas.hidden || !visible) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const scale = pixelRatio();
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    const layout = layoutChart(readings, { width, height, threshold, replayable });
    const { entries, left, right, start, end, ceiling, x, y } = layout;
    ctx.font = '11px system-ui';
    ctx.fillStyle = '#71806a';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const value = ceiling * i / 4;
      ctx.fillText(String(Math.round(value)), left - 9, y(value) + 4);
      ctx.strokeStyle = '#e4e9df';
      ctx.beginPath(); ctx.moveTo(left, y(value)); ctx.lineTo(right, y(value)); ctx.stroke();
    }
    if (threshold) {
      ctx.strokeStyle = '#b98640'; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(left, y(threshold)); ctx.lineTo(right, y(threshold)); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = '#42745a'; ctx.lineWidth = 2;
    ctx.beginPath();
    entries.forEach((entry, index) => index === 0 ? ctx.moveTo(x(entry.date), y(entry.rate)) : ctx.lineTo(x(entry.date), y(entry.rate)));
    ctx.stroke();
    for (const entry of entries) {
      ctx.fillStyle = '#42745a'; ctx.beginPath(); ctx.arc(x(entry.date), y(entry.rate), 4, 0, Math.PI * 2); ctx.fill();
    }
    points = layout.points;
    const day = timestamp => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(timestamp));
    ctx.fillStyle = '#71806a'; ctx.textAlign = 'left'; ctx.fillText(day(start), left, height - 8);
    if (start !== end) { ctx.textAlign = 'right'; ctx.fillText(day(end), right, height - 8); }
    // Cache the chart so replay frames copy it and paint only the ring, never re-sorting or redrawing history.
    background.width = canvas.width; background.height = canvas.height;
    background.getContext('2d').drawImage(canvas, 0, 0);
    paintRing();
  }

  // Records the replay frame to draw (null when stopped). Returns whether the active reading changed.
  function setReplay(state) {
    const changed = replay?.entry.id !== state?.entry.id;
    replay = state;
    return changed;
  }

  // Copy the cached chart and paint just the active point's ring.
  function paintRing() {
    if (canvas.hidden || !background.width) return;
    const point = replay && points.find(item => item.entry.id === replay.entry.id);
    const pulse = point ? ringPulse(replay.pulseAgeMs, reducedMotion.matches) : 0;
    const ring = point ? `${point.entry.id}|${point.x}|${point.y}|${pulse}` : '';
    if (ring === drawnRing) return;
    drawnRing = ring;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(background, 0, 0);
    if (!point) return;
    const scale = pixelRatio();
    ctx.scale(scale, scale);
    ctx.strokeStyle = '#42745a'; ctx.lineWidth = 2; ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.arc(point.x, point.y, 7 + pulse * 5, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // The static tap timeline for the active reading.
  function drawTimeline() {
    if (!replay) return;
    const { entry } = replay;
    const width = timeline.clientWidth, height = 36;
    const scale = pixelRatio();
    timeline.width = width * scale; timeline.height = height * scale;
    const ctx = timeline.getContext('2d'); ctx.scale(scale, scale);
    ctx.strokeStyle = '#71806a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 24); ctx.lineTo(width, 24); ctx.stroke();
    ctx.beginPath();
    for (const offset of entry.tapOffsetsMs) {
      const x = 1 + offset / (entry.seconds * 1000) * (width - 2);
      ctx.moveTo(x, 4); ctx.lineTo(x, 24);
    }
    ctx.stroke();
    timeline.setAttribute('aria-label', `${entry.count} recorded taps across ${entry.seconds} seconds. Each vertical mark is an accepted tap; gaps show time between taps.`);
  }

  return {
    show, draw, setReplay, paintRing, drawTimeline,
    pointAt: (x, y) => hitTest(points, x, y),
    get points() { return points; },
    get replay() { return replay; },
  };
}
