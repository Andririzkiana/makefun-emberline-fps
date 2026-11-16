// Synthesized sound effects with WebAudio — no audio assets, everything is noise bursts,
// filtered thumps and oscillator blips shaped per event. Created lazily on the first
// user gesture (the Play click), silent until then.

let ctx = null;
let master = null;
let noiseBuffer = null;

function init() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  const len = ctx.sampleRate * 1;
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
}

// A noise burst through a band/low pass; gain falls off with listener distance.
function burst({ dur = 0.15, freq = 1200, q = 0.8, gain = 0.5, dist = 0, type = 'lowpass', slideTo = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(Math.max(60, freq - dist * 28), t);
  if (slideTo) filter.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  filter.Q.value = q;
  const g = ctx.createGain();
  const vol = gain / (1 + dist * 0.16);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

function blip({ freq = 1200, dur = 0.06, gain = 0.18, type = 'square', slideTo = 0, delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// Gunshot voices per weapon class; dist is metres from the listener (0 = the player's own gun).
const SHOT_VOICES = {
  p9: { dur: 0.11, freq: 2100, gain: 0.4 },
  rook: { dur: 0.1, freq: 1700, gain: 0.42 },
  vk47: { dur: 0.14, freq: 1300, gain: 0.55 },
  farshot: { dur: 0.34, freq: 750, gain: 0.8 },
};

export const sfx = {
  init,
  shot(id, dist = 0) {
    const v = SHOT_VOICES[id] || SHOT_VOICES.vk47;
    burst({ dur: v.dur, freq: v.freq, gain: v.gain, dist, slideTo: 120 });
    if (dist === 0) blip({ freq: 150, dur: 0.07, gain: 0.3, type: 'sine', slideTo: 55 });
  },
  dry() { blip({ freq: 1900, dur: 0.03, gain: 0.12 }); },
  reloadStart() {
    blip({ freq: 700, dur: 0.04, gain: 0.14 });
    blip({ freq: 480, dur: 0.04, gain: 0.12, delay: 0.12 });
  },
  reloadEnd() { blip({ freq: 950, dur: 0.05, gain: 0.16 }); },
  hit(kill) {
    blip({ freq: kill ? 620 : 1500, dur: kill ? 0.14 : 0.05, gain: 0.2, type: 'sine', slideTo: kill ? 240 : 1200 });
  },
  hurt() { burst({ dur: 0.12, freq: 500, gain: 0.3 }); },
  throwNade() { burst({ dur: 0.16, freq: 900, gain: 0.1, type: 'bandpass' }); },
  boom(dist = 0) {
    burst({ dur: 0.8, freq: 900, gain: 0.9, dist, slideTo: 45 });
    blip({ freq: 90, dur: 0.6, gain: 0.5, type: 'sine', slideTo: 32 });
  },
  beep(fast) { blip({ freq: 1250, dur: 0.05, gain: 0.13, type: 'sine' }); if (fast) blip({ freq: 1250, dur: 0.05, gain: 0.1, type: 'sine', delay: 0.09 }); },
  defuseBeep() { blip({ freq: 880, dur: 0.06, gain: 0.12, type: 'sine' }); },
  plantDone() { blip({ freq: 1250, dur: 0.07, gain: 0.16, type: 'sine' }); blip({ freq: 1680, dur: 0.09, gain: 0.16, type: 'sine', delay: 0.09 }); },
  buy() { blip({ freq: 1040, dur: 0.05, gain: 0.14, type: 'sine' }); },
  denied() { blip({ freq: 220, dur: 0.09, gain: 0.14, type: 'square' }); },
  roundWin() {
    blip({ freq: 660, dur: 0.12, gain: 0.16, type: 'triangle' });
    blip({ freq: 880, dur: 0.2, gain: 0.16, type: 'triangle', delay: 0.11 });
  },
  roundLose() {
    blip({ freq: 392, dur: 0.14, gain: 0.16, type: 'triangle' });
    blip({ freq: 262, dur: 0.24, gain: 0.16, type: 'triangle', delay: 0.12 });
  },
};
