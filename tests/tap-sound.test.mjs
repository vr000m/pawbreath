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
