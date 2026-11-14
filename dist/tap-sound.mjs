// Optional feedback only: no timers, deferred tones, or access to measurement state.
export function createTapSound(AudioContextClass) {
  let context;
  let enabled = false;
  return {
    prepare(wanted) {
      enabled = wanted;
      if (!enabled || !AudioContextClass) return;
      try {
        context ??= new AudioContextClass();
        // Called directly by Start's user gesture. Never wait to begin counting.
        Promise.resolve(context.resume()).catch(() => {});
      } catch { /* Audio must never prevent a measurement. */ }
    },
    play() {
      if (!enabled || context?.state !== 'running') return false;
      let oscillator, gain;
      const disconnect = () => { oscillator?.disconnect(); gain?.disconnect(); };
      try {
        oscillator = context.createOscillator();
        gain = context.createGain();
        const now = context.currentTime;
        oscillator.frequency.value = 660;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.035, now + 0.005);
        gain.gain.linearRampToValueAtTime(0, now + 0.045);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.onended = disconnect;
        oscillator.start(now);
        oscillator.stop(now + 0.05);
        return true;
      } catch {
        try { oscillator?.stop(); } catch { /* May not have started. */ }
        try { disconnect(); } catch { /* Best-effort audio cleanup. */ }
        return false;
      }
    },
    stop() { enabled = false; }
  };
}
