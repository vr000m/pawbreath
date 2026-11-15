import test from 'node:test';
import assert from 'node:assert/strict';
import { createTapSound } from '../dist/tap-sound.mjs';

function fixture() {
  const calls = {created:0, starts:0, stops:0, disconnected:0, resumes:0};
  let context;
  class Audio {
    constructor() { calls.created++; context=this; this.state='running'; this.currentTime=2; }
    resume() { calls.resumes++; return Promise.resolve(); }
    createOscillator() {
      const node = { frequency:{}, connect(){}, disconnect(){calls.disconnected++;}, start(){calls.starts++;}, stop(){calls.stops++;} };
      calls.oscillator=node; return node;
    }
    createGain() { return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){calls.disconnected++;}}; }
  }
  const sound=createTapSound(Audio);
  return {sound,calls,get context(){return context;}};
}

test('tap sound is opt-in, reuses its context, produces one short tone and releases nodes', () => {
  const f=fixture();
  f.sound.prepare(false); assert.equal(f.calls.created,0); assert.equal(f.sound.play(),false);
  f.sound.prepare(true); assert.equal(f.sound.play(),true); assert.equal(f.calls.starts,1); assert.equal(f.calls.stops,1);
  f.calls.oscillator.onended(); assert.equal(f.calls.disconnected,2);
  f.sound.stop(); assert.equal(f.sound.play(),false);
  f.sound.prepare(true); assert.equal(f.calls.created,1); f.sound.play(); assert.equal(f.calls.starts,2);
});

test('missing, throwing, suspended and rejected audio never throw or schedule a tone', async () => {
  for (const Audio of [undefined,class {constructor(){throw Error('unavailable');}},class {resume(){throw Error('resume');}}]) {
    const sound=createTapSound(Audio); sound.prepare(true); assert.equal(sound.play(),false); sound.stop();
  }
  const f=fixture(); f.sound.prepare(true); f.context.state='suspended';
  f.context.resume=()=>Promise.reject(Error('blocked'));
  f.sound.prepare(true); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.sound.play(),false); assert.equal(f.calls.starts,0);
  f.context.state='running'; f.context.createGain=()=>{throw Error('device lost');};
  assert.equal(f.sound.play(),false); assert.equal(f.calls.starts,0); assert.equal(f.calls.disconnected,1);
});

test('late audio resume across cancelled and restarted sessions never replays taps', async () => {
  for (const reject of [false,true]) for (const enabled of [false,true]) {
    const f=fixture(); f.sound.prepare(true); f.context.state='suspended';
    const settles=[]; f.context.resume=()=>new Promise((resolve,fail)=>{settles.push(reject?fail:resolve);});
    f.sound.prepare(true);
    for (let i=0;i<4;i++) assert.equal(f.sound.play(),false);
    f.sound.stop(); f.sound.prepare(enabled);
    f.context.state='running';
    settles[0](); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.calls.starts,0, 'old session resume replayed a tone');
    settles[1]?.(); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.calls.starts,0, 'late resume must not replay prior taps');
    assert.equal(f.sound.play(),enabled); assert.equal(f.calls.starts,enabled?1:0);
    f.sound.stop();
  }
});

test('an interrupted context is resumed by later taps without blocking, throwing or queueing tones', async () => {
  const f=fixture(); f.sound.prepare(true);
  assert.equal(f.sound.play(),true); assert.equal(f.calls.starts,1);
  // A call, Siri or Control Center interrupts audio mid-count.
  f.context.state='interrupted'; const before=f.calls.resumes;
  f.context.resume=()=>{ f.calls.resumes++; return Promise.resolve().then(()=>{ f.context.state='running'; }); };
  assert.equal(f.sound.play(),false, 'a tap during the interruption may stay silent');
  assert.equal(f.calls.resumes,before+1, 'a tap on a non-running context must request resume');
  assert.equal(f.calls.starts,1);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.calls.starts,1, 'resuming must not replay the silent tap');
  assert.equal(f.sound.play(),true, 'later taps recover once the context runs'); assert.equal(f.calls.starts,2);
  assert.equal(f.calls.resumes,before+1, 'a running context needs no resume');
  for (const resume of [()=>Promise.reject(Error('denied')), ()=>{ throw Error('gone'); }]) {
    f.context.state='suspended'; f.context.resume=resume;
    assert.doesNotThrow(()=>assert.equal(f.sound.play(),false));
    await new Promise(resolve=>setImmediate(resolve)); // An unhandled rejection would fail the test run.
  }
  assert.equal(f.calls.starts,2, 'exactly one tone per accepted tap that found a running context');
});

test('stop suspends the context for reuse and no tone follows it', async () => {
  const f=fixture(); let suspends=0;
  f.sound.prepare(true); f.context.suspend=()=>{ suspends++; f.context.state='suspended'; return Promise.resolve(); };
  f.sound.play(); f.sound.stop();
  assert.equal(suspends,1); assert.equal(f.sound.play(),false); assert.equal(f.calls.starts,1);
  f.sound.prepare(true); assert.equal(f.calls.created,1, 'context reused, not closed'); assert.ok(f.calls.resumes>=1);
  f.context.suspend=()=>Promise.reject(Error('busy')); assert.doesNotThrow(()=>f.sound.stop());
  f.context.suspend=()=>{ throw Error('gone'); }; assert.doesNotThrow(()=>f.sound.stop());
  await new Promise(resolve=>setImmediate(resolve));
  createTapSound(undefined).stop(); // No context yet.
});

test('detect reports whether audio actually runs', async () => {
  assert.equal(await createTapSound(undefined).detect(), false, 'missing Web Audio');
  assert.equal(await createTapSound(class { constructor(){ throw Error('unavailable'); } }).detect(), false, 'throwing constructor');
  assert.equal(await createTapSound(class { constructor(){ this.state='suspended'; } resume(){ return Promise.reject(Error('denied')); } }).detect(), false, 'rejected resume');
  assert.equal(await createTapSound(class { constructor(){ this.state='suspended'; } resume(){ throw Error('denied'); } }).detect(), false, 'throwing resume');
  assert.equal(await createTapSound(class { constructor(){ this.state='suspended'; } resume(){ return Promise.resolve(); } }).detect(), false, 'resume resolved but still suspended');
  let created=0;
  const Later=class { constructor(){ created++; this.state='suspended'; } resume(){ return Promise.resolve().then(()=>{ this.state='running'; }); } };
  const sound=createTapSound(Later);
  assert.equal(await sound.detect(), true, 'suspended then running');
  assert.equal(await sound.detect(), true); assert.equal(created,1, 'detect reuses the context');
  assert.equal(sound.play(),false, 'detect alone never enables tones');
  const f=fixture(); assert.equal(await f.sound.detect(), true, 'already running');
});

// A fake audio graph that records whether each tone is still connected and when it is scheduled to stop.
// Operations apply in call order, as a real AudioContext serializes resume() and suspend().
function graph({ deferResume = false } = {}) {
  const tones = []; const pending = []; let context, suspends = 0;
  class Audio {
    constructor() { context = this; this.state = 'suspended'; this.currentTime = 10; }
    resume() {
      const at = suspends;
      return new Promise(resolve => {
        const settle = () => { if (suspends === at) this.state = 'running'; resolve(); };
        if (deferResume) pending.push(settle); else settle();
      });
    }
    suspend() { suspends++; this.state = 'suspended'; return Promise.resolve(); }
    createOscillator() {
      const node = { frequency: {}, connected: false, stopAt: undefined,
        connect() { this.connected = true; }, disconnect() { this.connected = false; },
        start() {}, stop(when) { this.stopAt = when ?? context.currentTime; } };
      tones.push(node); return node;
    }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  return { sound: createTapSound(Audio), tones, pending, get context() { return context; }, get suspends() { return suspends; },
    // A tone is audible once the context runs if it is still connected and not yet stopped.
    sounding: () => tones.filter(node => node.connected && (node.stopAt === undefined || node.stopAt > context.currentTime)).length };
}

test('ending a count 10 ms before a tone finishes leaves nothing to resume into the next count', () => {
  const f = graph();
  f.sound.prepare(true); assert.equal(f.sound.play(), true);
  f.context.currentTime += 0.04; // The count ends 10 ms before the 50 ms tone would stop.
  f.sound.stop();
  assert.equal(f.sounding(), 0, 'a tone stayed connected and scheduled past stop()');
  assert.ok(f.tones.every(node => !node.connected), 'stop() left an oscillator connected');
  f.sound.prepare(true); // Next count resumes the context; a suspended context's clock has not advanced.
  assert.equal(f.context.state, 'running');
  assert.equal(f.sounding(), 0, 'resuming replayed the unfinished tone before any tap');
  assert.equal(f.sound.play(), true); assert.equal(f.sounding(), 1, 'exactly one tone per accepted tap');
});

// Contract: after stop(), from any state, no tone is connected or scheduled, play() is silent until the next
// prepare(true), and the context is asked to suspend. stop() is idempotent.
test('stop() leaves no tone and a suspended context across the whole state space', async () => {
  const phases = ['unticked', 'ticked-idle', 'counting', 'finished'];
  for (const phase of phases) for (const state of ['suspended', 'running']) for (const tone of [false, true]) {
    if (tone && !['counting', 'finished'].includes(phase)) continue; // Only an enabled count can start a tone.
    const cell = `${phase}/${state}/${tone ? 'tone' : 'silent'}`;
    const f = graph();
    if (phase === 'ticked-idle') assert.equal(await f.sound.detect(), true, cell);
    if (phase === 'counting' || phase === 'finished') {
      f.sound.prepare(true);
      if (tone) { assert.equal(f.sound.play(), true, cell); f.context.currentTime += 0.01; }
      if (phase === 'finished') f.sound.stop();
    }
    if (f.context) f.context.state = state; // Interruptions can suspend a context at any point.
    const before = f.suspends;
    assert.doesNotThrow(() => { f.sound.stop(); f.sound.stop(); }, cell);
    assert.equal(f.sounding(), 0, `${cell}: tone survived stop()`);
    assert.ok(f.tones.every(node => !node.connected), `${cell}: oscillator still connected`);
    assert.equal(f.sound.play(), false, `${cell}: play() after stop()`);
    if (f.context) {
      assert.ok(f.suspends > before && f.context.state !== 'running', `${cell}: context not suspended`);
      f.sound.prepare(true);
      assert.equal(f.sounding(), 0, `${cell}: resume replayed a tone`);
      assert.equal(f.sound.play(), true, cell); assert.equal(f.sounding(), 1, cell);
    }
  }
});

test('stop() during a pending detect() or tone onended keeps state consistent', async () => {
  const f = graph({ deferResume: true });
  const detected = f.sound.detect();
  f.sound.stop(); f.pending.forEach(settle => settle());
  assert.equal(await detected, false, 'a resume superseded by stop() must not report running');
  assert.notEqual(f.context.state, 'running'); assert.equal(f.sound.play(), false);
  const g = graph(); g.sound.prepare(true); g.sound.play();
  const [node] = g.tones; node.onended(); g.sound.stop(); node.onended?.();
  assert.equal(g.sounding(), 0); assert.doesNotThrow(() => g.sound.stop());
});

test('stop() ends every tone still playing and a late onended afterwards is harmless', () => {
  const f = graph(); f.sound.prepare(true);
  for (let i = 0; i < 3; i++) { assert.equal(f.sound.play(), true); f.context.currentTime += 0.01; }
  assert.equal(f.sounding(), 3);
  f.sound.stop();
  assert.equal(f.sounding(), 0, 'a tone survived stop()');
  assert.ok(f.tones.every(node => node.stopAt <= f.context.currentTime && !node.connected), 'a tone was not stopped and disconnected');
  const old = [...f.tones];
  f.sound.prepare(true); assert.equal(f.sound.play(), true);
  assert.doesNotThrow(() => old.forEach(node => node.onended()), 'a late onended threw');
  assert.equal(f.sounding(), 1, 'a late onended disturbed the next tone');
  f.sound.stop(); assert.equal(f.sounding(), 0, 'stop() missed a tone after late onended calls');
});
