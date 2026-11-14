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
