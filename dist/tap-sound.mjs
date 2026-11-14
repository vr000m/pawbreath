// Optional feedback only: no timers, deferred tones, or access to measurement state.
export function createTapSound(AudioContextClass) {
  let context;
  let enabled = false;
  // Request a resume without waiting for it. Rejections and throws are ignored: audio is never essential.
  const resume = () => {
    try { Promise.resolve(context.resume()).catch(() => {}); } catch { /* Audio must never prevent a measurement. */ }
  };
  const create = () => {
    if (!AudioContextClass) return false;
    try { context ??= new AudioContextClass(); return true; } catch { return false; }
  };
  return {
    // Called by the checkbox's user gesture. Resolves true only when the context actually runs.
    detect() {
      if (!create()) return Promise.resolve(false);
      if (context.state === 'running') return Promise.resolve(true);
      try {
        return Promise.resolve(context.resume()).then(() => context.state === 'running', () => false);
      } catch { return Promise.resolve(false); }
    },
    prepare(wanted) {
      enabled = wanted;
      // Called directly by Start's user gesture. Never wait to begin counting.
      if (enabled && create() && context.state !== 'running') resume();
    },
    play() {
      if (!enabled || !context) return false;
      // An interruption (call, Siri, Control Center) can suspend the context mid-count. Each accepted tap
      // is a user gesture, so ask to resume; this tap stays silent, later taps sound once it runs.
      if (context.state !== 'running') { resume(); return false; }
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
    // Suspend rather than close, so the next count can reuse the same context.
    stop() {
      enabled = false;
      // Also suspends after a resume that is still pending, so the context does not run on unused.
      if (!context || context.state === 'closed') return;
      try { Promise.resolve(context.suspend()).catch(() => {}); } catch { /* Best-effort. */ }
    }
  };
}
