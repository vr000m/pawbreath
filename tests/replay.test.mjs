import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplayController, replayableReadings } from '../dist/replay.mjs';

const entry = (id, date = '2026-11-14T12:00:00.000Z', seconds = 30) => ({ id, dogId: 'milo', date,
  seconds, count: 3, rate: seconds === 30 ? 6 : 3, notes: '', source: 'timed', context: 'asleep', uncertain: false,
  tapOffsetsMs: [1000, 4500, 12345] });
function fixture() {
  let time = 100, id = 0;
  const frames = new Map(), cancelled = [], states = [];
  let ended = 0;
  const controller = createReplayController({ now: () => time,
    requestFrame: cb => { frames.set(++id, cb); return id; },
    cancelFrame: id => { cancelled.push(id); frames.delete(id); },
    onFrame: state => states.push(state), onEnd: () => ended++ });
  return { controller, frames, cancelled, states, get ended() { return ended; },
    advance(ms) { time = 100 + ms; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb => cb()); } };
}

test('eligible queue is newest first with deterministic ties, excluding old/manual/invalid traces', () => {
  const older = entry('old', '2026-11-13T12:00:00.000Z');
  const legacy = entry('legacy'); delete legacy.tapOffsetsMs;
  const manual = { ...entry('manual'), source: 'manual', count: null, seconds: null };
  const input = [older, entry('z'), legacy, manual, { ...entry('bad'), tapOffsetsMs: [1] }, entry('a')];
  const before = structuredClone(input);
  assert.deepEqual(replayableReadings(input).map(r => r.id), ['a', 'z', 'old']);
  assert.deepEqual(input, before);
});

test('irregular taps preserve initial/trailing silence, exact boundaries and full 30/60-second clips', () => {
  const f = fixture();
  f.controller.start([entry('older', '2026-11-13T12:00:00.000Z', 60), entry('newer')]);
  assert.equal(f.states.at(-1).tapCount, 0);
  for (const [ms, taps, age] of [[999, 0, Infinity], [1000, 1, 0], [4000, 1, 3000],
    [4500, 2, 0], [12345, 3, 0], [29999, 3, 17654]]) {
    f.advance(ms);
    assert.equal(f.states.at(-1).entry.id, 'newer');
    assert.equal(f.states.at(-1).tapCount, taps);
    assert.equal(f.states.at(-1).pulseAgeMs, age);
  }
  f.advance(30000);
  assert.equal(f.states.at(-1).entry.id, 'older');
  assert.equal(f.states.at(-1).elapsedMs, 0);
  assert.equal(f.states.at(-1).tapCount, 0);
  f.advance(89999); assert.equal(f.ended, 0);
  f.advance(90000); assert.equal(f.ended, 1); assert.equal(f.frames.size, 0);
  f.advance(999999); assert.equal(f.ended, 1);
});

test('late frames skip overdue pulses and whole elapsed clips without catch-up bursts', () => {
  const f = fixture();
  f.controller.start([entry('newer'), entry('older', '2026-11-13T12:00:00.000Z')]);
  f.advance(20000);
  assert.equal(f.states.length, 2);
  assert.equal(f.states.at(-1).tapCount, 3);
  assert.equal(f.states.at(-1).pulseAgeMs, 7655);
  f.advance(50000);
  assert.equal(f.states.length, 3);
  assert.equal(f.states.at(-1).entry.id, 'older');
  assert.equal(f.states.at(-1).elapsedMs, 20000);
  f.advance(60001); assert.equal(f.ended, 1);
});

test('same-millisecond taps retain count fidelity without multiple queued pulses', () => {
  const f = fixture(); f.controller.start([{ ...entry('same'), tapOffsetsMs: [0, 0, 1] }]);
  assert.equal(f.states.at(-1).tapCount, 2);
  f.advance(1); assert.equal(f.states.at(-1).tapCount, 3);
  assert.equal(f.frames.size, 1);
});

test('stop/replacement invalidate stale callbacks and do not complete or alter a new replay', () => {
  const f = fixture(); f.controller.start([entry('first')]);
  const stale = [...f.frames.values()][0];
  f.controller.stop(); stale();
  assert.equal(f.frames.size, 0); assert.equal(f.states.length, 1); assert.equal(f.ended, 0);
  f.controller.start([entry('second')]); stale();
  assert.equal(f.frames.size, 1); assert.equal(f.states.at(-1).entry.id, 'second');
  const replaced = [...f.frames.values()][0];
  f.controller.start([entry('third')]); replaced();
  assert.equal(f.states.at(-1).entry.id, 'third'); assert.equal(f.frames.size, 1);
  assert.equal(f.controller.start([]), false); assert.equal(f.frames.size, 0);
});

test('caller and frame consumers cannot mutate a running snapshot or the original reading', () => {
  const f = fixture(), input = entry('snapshot'), original = structuredClone(input);
  f.controller.start([input]);
  input.tapOffsetsMs[0] = 20000; input.date = '2020-01-01T00:00:00.000Z';
  input.tapOffsetsMs.push(25000);
  const frame = f.states[0];
  assert.deepEqual(frame.entry, original);
  assert.throws(() => { frame.entry.tapOffsetsMs[0] = 9000; }, TypeError);
  assert.throws(() => { frame.entry.seconds = 60; }, TypeError);
  f.advance(1000); assert.equal(f.states.at(-1).tapCount, 1);
  assert.equal(input.tapOffsetsMs[0], 20000);
});

test('synchronous onFrame stop or replacement cannot leave duplicate animation loops', () => {
  let c, callbacks = [], states = [];
  c = createReplayController({ now: () => 0, requestFrame: cb => callbacks.push(cb), cancelFrame() {},
    onFrame(state) { states.push(state.entry.id); if (state.entry.id === 'first') c.start([entry('second')]); else c.stop(); } });
  c.start([entry('first')]);
  assert.deepEqual(states, ['first', 'second']); assert.equal(callbacks.length, 0);
});
