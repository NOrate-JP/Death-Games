// 効果音はすべてWebAudioで合成（外部ファイル不要）
let ctx = null, master = null, muted = false, drone = null;

function ensure() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.7; master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noiseBuf(sec) {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function burst({ dur = 0.1, freq = 2000, q = 1, vol = 0.5, type = 'lowpass', decay = dur }) {
  ensure();
  const src = ctx.createBufferSource(); src.buffer = noiseBuf(dur);
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); const t = ctx.currentTime;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(f); f.connect(g); g.connect(master); src.start(t);
}

function tone({ f0 = 200, f1 = 60, dur = 0.2, vol = 0.3, type = 'sine' }) {
  ensure();
  const o = ctx.createOscillator(); o.type = type; const g = ctx.createGain(); const t = ctx.currentTime;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}

export const sfx = {
  unlock() { ensure(); },
  card() { burst({ dur: 0.07, freq: 3500, type: 'bandpass', q: 0.8, vol: 0.35 }); },
  deal() { burst({ dur: 0.05, freq: 5000, type: 'highpass', vol: 0.15 }); },
  tick() { tone({ f0: 900, f1: 700, dur: 0.05, vol: 0.08, type: 'square' }); },
  special() { tone({ f0: 300, f1: 900, dur: 0.18, vol: 0.12, type: 'sawtooth' }); },
  bust() { tone({ f0: 160, f1: 40, dur: 0.8, vol: 0.35, type: 'sawtooth' }); },
  cock() { burst({ dur: 0.04, freq: 2500, type: 'bandpass', q: 4, vol: 0.5 }); setTimeout(() => burst({ dur: 0.05, freq: 1800, type: 'bandpass', q: 5, vol: 0.5 }), 120); },
  spin() { for (let i = 0; i < 8; i++) setTimeout(() => burst({ dur: 0.02, freq: 3000, type: 'bandpass', q: 6, vol: 0.25 }), i * 55); },
  click() { burst({ dur: 0.03, freq: 4200, type: 'bandpass', q: 8, vol: 0.7 }); },
  shot() {
    burst({ dur: 0.9, freq: 1400, vol: 1.2, decay: 0.7 });
    tone({ f0: 120, f1: 30, dur: 0.6, vol: 0.9 });
  },
  heartbeat() { tone({ f0: 70, f1: 40, dur: 0.12, vol: 0.5 }); setTimeout(() => tone({ f0: 60, f1: 35, dur: 0.14, vol: 0.4 }), 180); },
  rattle(n = 10) { for (let i = 0; i < n; i++) setTimeout(() => burst({ dur: 0.03, freq: 1800 + Math.random() * 2500, type: 'bandpass', q: 3, vol: 0.25 }), i * 45 + Math.random() * 30); },
  roll() { for (let i = 0; i < 5; i++) setTimeout(() => burst({ dur: 0.04, freq: 2500 + Math.random() * 1500, type: 'bandpass', q: 2, vol: 0.3 }), i * 70); },
  siren(sec = 3.2) {
    ensure();
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
    const g = ctx.createGain(); const t = ctx.currentTime;
    for (let i = 0; i < sec / 0.8; i++) {
      o.frequency.setValueAtTime(520, t + i * 0.8); o.frequency.linearRampToValueAtTime(980, t + i * 0.8 + 0.4);
      o.frequency.linearRampToValueAtTime(520, t + i * 0.8 + 0.8);
    }
    o2.frequency.value = 3; // うなり
    const lfo = ctx.createGain(); lfo.gain.value = 0.03; o2.connect(lfo); lfo.connect(g.gain);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16, t + 0.1);
    g.gain.setValueAtTime(0.16, t + sec - 0.4); g.gain.linearRampToValueAtTime(0.0001, t + sec);
    o.connect(f); f.connect(g); g.connect(master);
    o.start(t); o2.start(t); o.stop(t + sec + 0.05); o2.stop(t + sec + 0.05);
  },
  startDrone() {
    ensure(); if (drone) return;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 41;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 55.3;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180;
    const g = ctx.createGain(); g.gain.value = 0.05;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(master); o1.start(); o2.start();
    drone = { o1, o2, g };
  },
  stopDrone() { if (drone) { drone.o1.stop(); drone.o2.stop(); drone = null; } },
  setMuted(v) { muted = v; if (master) master.gain.value = v ? 0 : 0.7; },
  get muted() { return muted; },
};
