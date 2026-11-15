import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutChart, hitTest, ringPulse, createHistoryChart, CHART_HIT_RADIUS } from '../dist/history-chart.mjs';
import { newestFirst } from '../dist/data.mjs';

const at = (id, date, rate = 20) => ({ id, dogId: 'd', date, rate });
const size = { width: 349, height: 200 };

test('layout puts the x-axis in chronological order and gives points only to replayable readings', () => {
  // History hands readings newest first.
  const readings = [at('c', '2026-11-03T00:00:00.000Z', 30), at('b', '2026-11-02T00:00:00.000Z', 10), at('a', '2026-11-01T00:00:00.000Z', 20)];
  const layout = layoutChart(readings, { ...size, threshold: null, replayable: new Set(['a', 'c']) });
  assert.deepEqual(layout.entries.map(entry => entry.id), ['a', 'b', 'c']);
  assert.deepEqual(layout.points.map(point => point.entry.id), ['a', 'c']);
  // Plot box 34..334 x 15..168; ceiling = ceil(30 / 10) * 10 + 10 = 40.
  assert.equal(layout.ceiling, 40);
  assert.deepEqual(layout.points.map(({ x, y }) => [x, y]), [[34, 168 - 20 / 40 * 153], [334, 168 - 30 / 40 * 153]]);
  assert.equal(layout.x(readings[1].date), 184);
  assert.ok(layout.entries.every(entry => readings.includes(entry)), 'points carry the rendered readings, not copies');
  assert.equal(readings[0].id, 'c', 'the caller list is not reordered');
});

test('layout centres a single date and lifts the ceiling for a threshold above every rate', () => {
  const same = '2026-11-01T00:00:00.000Z';
  const layout = layoutChart([at('b', same), at('a', same)], { ...size, threshold: 55, replayable: new Set(['a', 'b']) });
  assert.ok(layout.points.every(point => point.x === 184));
  assert.equal(layout.ceiling, 70);
  assert.equal(layoutChart([at('a', same, 3)], { ...size, replayable: new Set() }).ceiling, 20, 'minimum scale is 10');
});

// Contract: overlapping points resolve to the reading History lists first (newestFirst), never by array position.
test('hit-test picks the nearest point within the radius, breaking distance ties by newestFirst', () => {
  const same = '2026-11-14T12:00:00.000Z';
  const point = (id, x, y, date = same) => ({ entry: at(id, date), x, y });
  assert.equal(hitTest([point('a', 10, 10)], 10 + CHART_HIT_RADIUS, 10)?.entry.id, 'a', 'radius is inclusive');
  assert.equal(hitTest([point('a', 10, 10)], 10 + CHART_HIT_RADIUS + 0.01, 10), undefined);
  assert.equal(hitTest([point('far', 0, 0), point('near', 8, 0)], 10, 0).entry.id, 'near');
  // Equal distance: every arrangement chooses the newestFirst winner.
  const tied = [point('old', 50, 50, '2026-11-13T12:00:00.000Z'), point('b', 50, 50), point('B', 50, 50), point('a', 50, 50)];
  const winner = [...tied].map(p => p.entry).sort(newestFirst)[0].id;
  assert.equal(winner, 'B');
  for (let shift = 0; shift < tied.length; shift++) {
    const rotated = [...tied.slice(shift), ...tied.slice(0, shift)];
    assert.equal(hitTest(rotated, 52, 51).entry.id, winner, `rotation ${shift}`);
    assert.equal(hitTest([...rotated].reverse(), 52, 51).entry.id, winner, `reversed rotation ${shift}`);
  }
});

test('ring pulse eases from a tap to rest and never pulses with reduced motion', () => {
  assert.equal(ringPulse(0, false), 1);
  assert.equal(ringPulse(120, false), 0.5);
  assert.equal(ringPulse(240, false), 0);
  assert.equal(ringPulse(Infinity, false), 0);
  assert.equal(ringPulse(0, true), 0);
});

// A recording 2D context, enough to drive the chart without a browser.
function fakeCanvas(calls) {
  const ctx = new Proxy({}, { get: (target, key) => key in target ? target[key] : (...args) => calls?.push([key, ...args]),
    set: (target, key, value) => { target[key] = value; return true; } });
  return { hidden: false, clientWidth: 349, clientHeight: 200, width: 0, height: 0, getContext: () => ctx, setAttribute() {} };
}

test('the chart keeps its own replay state, resets points on show and only rings the active replayable point', () => {
  const calls = [];
  const canvas = fakeCanvas(calls);
  const chart = createHistoryChart({ canvas, timeline: fakeCanvas(), reducedMotion: { matches: false },
    pixelRatio: () => 1, background: fakeCanvas() });
  const entry = { ...at('t', '2026-11-01T00:00:00.000Z'), seconds: 30, count: 1, tapOffsetsMs: [5] };
  chart.show([at('u', '2026-11-02T00:00:00.000Z'), entry], new Set(['t']));
  assert.deepEqual(chart.points, []);
  chart.draw({ visible: false });
  assert.deepEqual(chart.points, [], 'hidden History draws nothing');
  chart.draw({ visible: true, threshold: 30 });
  assert.deepEqual(chart.points.map(point => point.entry.id), ['t']);
  assert.equal(chart.pointAt(chart.points[0].x, chart.points[0].y).entry, entry);
  assert.equal(chart.replay, null);
  // A plain setter: deciding when the reading changed (and the UI that follows) belongs to app.js.
  assert.equal(chart.setReplay({ entry, pulseAgeMs: 0 }), undefined);
  chart.setReplay({ entry, pulseAgeMs: 10 });
  assert.equal(chart.replay.pulseAgeMs, 10);
  calls.length = 0;
  chart.paintRing();
  assert.deepEqual(calls.filter(([name]) => name === 'arc').map(call => call[3]), [7 + (1 - 10 / 240) * 5]);
  calls.length = 0;
  chart.paintRing();
  assert.equal(calls.length, 0, 'an identical ring is not repainted');
  chart.show([], new Set());
  assert.deepEqual(chart.points, []);
  chart.setReplay(null);
  assert.equal(chart.replay, null);
});
