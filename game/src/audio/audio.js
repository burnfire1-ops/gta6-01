// Teluk Cahaya — audio slice (synthesized, Web Audio API only).
// No audio files, no network, no licensed content. Every sound below is
// generated at runtime with oscillators and filtered noise.
//
// Buses (per audio-design skill: sliders are squared, and ducking never
// touches the player's Music slider — it rides a separate duck bus):
//   master -> destination
//   music -> musicDuck -> master, sfx -> master, ambience -> master, ui -> master
//
// Adaptive music: one original Am-F-C-G chord every 4 s (pad layer, always
// on), a rhythm layer (bass + hats) that fades in during active missions,
// and a tense layer (dissonant high pad + faster hats) at wanted >= 3.
// A 100 ms scheduler interval schedules 200 ms ahead (lookahead pattern).
//
// The AudioContext is created lazily on the 'gameStarted' user gesture so
// autoplay policy is satisfied. If Web Audio is unavailable, every function
// below is a silent no-op.

const CHORD_SECONDS = 4;          // one chord per 4 s (8 beats @ 120 bpm)
const STEP_SECONDS = 0.25;        // 8th note @ 120 bpm
const STEPS_PER_CHORD = 16;       // 16 8th-notes per chord
const LOOKAHEAD_MS = 100;         // scheduler tick
const LOOKAHEAD_SECONDS = 0.2;    // how far ahead to schedule

// Original chord progression (Am - F - C - G), frequencies in Hz.
// padNotes: triad per chord; bassRoot: root one octave down.
const CHORDS = [
  { pad: [110.00, 130.81, 164.81], bass: 55.00, tense: [220.00, 233.08] }, // Am (+Bb cluster)
  { pad: [87.31, 110.00, 130.81], bass: 43.65, tense: [174.61, 185.00] }, // F  (+F# cluster)
  { pad: [130.81, 164.81, 196.00], bass: 65.41, tense: [261.63, 277.18] }, // C  (+C# cluster)
  { pad: [98.00, 123.47, 146.83], bass: 49.00, tense: [196.00, 207.65] }, // G  (+Ab cluster)
];

let ctx = null;          // slice context { state, ... } from systems.js
let ac = null;           // AudioContext (null until gameStarted / unsupported)
let buses = null;        // { master, music, musicDuck, sfx, ambience, ui }
let noiseBuf = null;     // shared 1 s white-noise buffer
let started = false;     // true once the context + loops are running
let schedulerId = null;
let nextChordTime = 0;   // AudioContext time of the next chord to schedule
let chordIndex = 0;
let duckUntil = 0;       // performance.now() ms; music ducked while > now

// Continuous voices (created once, gain-driven per frame).
let engine = null;       // { osc, filter, gain }
let siren = null;        // { osc, gain, nextFlip, high }
let ambienceSrc = null;  // looped city-noise source (or null)

// Footstep timing accumulator.
let stepAcc = 0;
let lastTickMs = 0;

function clamp01(v) {
  return Math.min(1, Math.max(0, v || 0));
}

// Slider 0..1 -> bus gain: square first (audio-design skill), mute at 0.
function sliderGain(v) {
  const s = clamp01(v);
  return s * s;
}

function applySettings() {
  if (!ac || !buses) return;
  const s = (ctx && ctx.state && ctx.state.settings) || {};
  const t = ac.currentTime;
  buses.music.gain.setTargetAtTime(sliderGain(s.music ?? 0.7) * 0.5, t, 0.1);
  buses.sfx.gain.setTargetAtTime(sliderGain(s.sfx ?? 0.8) * 0.9, t, 0.1);
  buses.ambience.gain.setTargetAtTime(sliderGain(s.ambience ?? 0.6) * 0.5, t, 0.1);
  buses.ui.gain.setTargetAtTime(sliderGain(s.ui ?? 0.8) * 0.7, t, 0.1);
}

function makeNoiseBuffer() {
  const len = ac.sampleRate;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function buildGraph() {
  const master = ac.createGain();
  master.gain.value = 0.9;
  // Safety limiter on master so summed layers never clip (headroom).
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.2;
  master.connect(limiter);
  limiter.connect(ac.destination);

  const music = ac.createGain();
  const musicDuck = ac.createGain(); // duck bus: sits between Music and Master
  musicDuck.gain.value = 1;
  music.connect(musicDuck);
  musicDuck.connect(master);

  const sfx = ac.createGain();
  sfx.connect(master);
  const ambience = ac.createGain();
  ambience.connect(master);
  const ui = ac.createGain();
  ui.connect(master);

  // Layer buses under music: pad (always), rhythm (missions), tense (wanted).
  const padBus = ac.createGain();
  padBus.gain.value = 1;
  padBus.connect(music);
  const rhythmBus = ac.createGain();
  rhythmBus.gain.value = 0;
  rhythmBus.connect(music);
  const tenseBus = ac.createGain();
  tenseBus.gain.value = 0;
  tenseBus.connect(music);

  buses = { master, music, musicDuck, sfx, ambience, ui, padBus, rhythmBus, tenseBus };
  noiseBuf = makeNoiseBuffer();
  applySettings();
}

function startContinuousVoices() {
  // Engine: sawtooth through a lowpass; pitch/gain driven per frame.
  const osc = ac.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 60;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 700;
  const gain = ac.createGain();
  gain.gain.value = 0;
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(buses.sfx);
  osc.start();
  engine = { osc, filter, gain };

  // Siren: square wave alternating ~700 / ~950 Hz; gain follows the
  // nearest police distance (driven per frame).
  const sOsc = ac.createOscillator();
  sOsc.type = 'square';
  sOsc.frequency.value = 700;
  const sGain = ac.createGain();
  sGain.gain.value = 0;
  sOsc.connect(sGain);
  sGain.connect(buses.sfx);
  sOsc.start();
  siren = { osc: sOsc, gain: sGain, nextFlip: 0, high: false };

  // City ambience: looped noise through a low lowpass, very quiet.
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const aFilter = ac.createBiquadFilter();
  aFilter.type = 'lowpass';
  aFilter.frequency.value = 320;
  const aGain = ac.createGain();
  aGain.gain.value = 0.05;
  src.connect(aFilter);
  aFilter.connect(aGain);
  aGain.connect(buses.ambience);
  src.start();
  ambienceSrc = src;
}

// ---- Music scheduler -------------------------------------------------

function schedulePad(chord, t) {
  for (const freq of chord.pad) {
    for (const detune of [-4, 4]) {
      const osc = ac.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.045, t + 0.6);
      g.gain.setValueAtTime(0.045, t + CHORD_SECONDS - 0.6);
      g.gain.linearRampToValueAtTime(0, t + CHORD_SECONDS);
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      osc.connect(g);
      g.connect(lp);
      lp.connect(buses.padBus);
      osc.start(t);
      osc.stop(t + CHORD_SECONDS + 0.05);
    }
  }
  // Tense layer: the same chord's dissonant cluster, one octave up, quiet.
  for (const freq of chord.tense) {
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.02, t + 0.8);
    g.gain.setValueAtTime(0.02, t + CHORD_SECONDS - 0.8);
    g.gain.linearRampToValueAtTime(0, t + CHORD_SECONDS);
    osc.connect(g);
    g.connect(buses.tenseBus);
    osc.start(t);
    osc.stop(t + CHORD_SECONDS + 0.05);
  }
}

function scheduleHat(t, vol) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.1;
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 6000;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  src.connect(hp);
  hp.connect(g);
  g.connect(buses.rhythmBus);
  src.start(t);
  src.stop(t + 0.08);
}

function scheduleTenseHat(t, vol) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  src.connect(hp);
  hp.connect(g);
  g.connect(buses.tenseBus);
  src.start(t);
  src.stop(t + 0.06);
}

function scheduleBass(chord, t) {
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = chord.bass;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.16, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
  osc.connect(g);
  g.connect(buses.rhythmBus);
  osc.start(t);
  osc.stop(t + 0.5);
}

function scheduleChord(chord, t) {
  schedulePad(chord, t);
  // 8th-note hats across the chord; bass on each beat (every other step).
  for (let step = 0; step < STEPS_PER_CHORD; step++) {
    const st = t + step * STEP_SECONDS;
    scheduleHat(st, step % 4 === 0 ? 0.10 : 0.06);
    if (step % 2 === 0) scheduleBass(chord, st);
    // Tense layer: 16th-note hats between the 8ths.
    scheduleTenseHat(st + STEP_SECONDS / 2, 0.05);
  }
}

function schedulerTick() {
  if (!ac || !started) return;
  while (nextChordTime < ac.currentTime + LOOKAHEAD_SECONDS) {
    scheduleChord(CHORDS[chordIndex % CHORDS.length], nextChordTime);
    chordIndex++;
    nextChordTime += CHORD_SECONDS;
  }
}

function startMusic() {
  if (schedulerId !== null) return;
  nextChordTime = ac.currentTime + 0.1;
  chordIndex = 0;
  schedulerId = setInterval(schedulerTick, LOOKAHEAD_MS);
  schedulerTick();
}

// ---- One-shot SFX ----------------------------------------------------
// Every repeated sound gets a small random pitch/volume offset so it never
// sounds like the same sample twice (audio-design skill).

function vary(base, amount) {
  return base * (1 + (Math.random() - 0.5) * 2 * amount);
}

function blip(freq, dur, vol, type, when, dest) {
  const t = when ?? ac.currentTime;
  const osc = ac.createOscillator();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(vary(freq, 0.04), t);
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g);
  g.connect(dest || buses.sfx);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noiseBurst(dur, vol, filterType, filterFreq, when, dest) {
  const t = when ?? ac.currentTime;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = vary(1, 0.08);
  const f = ac.createBiquadFilter();
  f.type = filterType || 'bandpass';
  f.frequency.value = filterFreq || 1200;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(dest || buses.sfx);
  src.start(t);
  src.stop(t + dur + 0.02);
}

function thump(freq, dur, vol, when) {
  const t = when ?? ac.currentTime;
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(vary(freq, 0.06), t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.5), t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g);
  g.connect(buses.sfx);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const SFX = {
  punch() {
    noiseBurst(0.12, 0.5, 'lowpass', 900);
    thump(90, 0.18, 0.7);
  },
  shoot() {
    noiseBurst(0.09, 0.6, 'highpass', 1500);
    blip(1800, 0.05, 0.25, 'square');
  },
  money() {
    const t = ac.currentTime;
    blip(880, 0.12, 0.35, 'sine', t);
    blip(1320, 0.18, 0.35, 'sine', t + 0.09);
  },
  ui() {
    blip(660, 0.06, 0.25, 'sine', undefined, buses.ui);
  },
  door() {
    thump(140, 0.16, 0.6);
    noiseBurst(0.07, 0.3, 'lowpass', 500);
  },
  horn() {
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = 'square';
    osc.frequency.value = vary(370, 0.03);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.setValueAtTime(0.22, t + 0.25);
    g.gain.linearRampToValueAtTime(0, t + 0.3);
    osc.connect(g);
    g.connect(buses.sfx);
    osc.start(t);
    osc.stop(t + 0.32);
  },
  footstep() {
    noiseBurst(0.05, 0.22, 'lowpass', 700);
  },
  complete() {
    const t = ac.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      blip(f, 0.22, 0.3, 'triangle', t + i * 0.11);
    });
  },
  sting() {
    const t = ac.currentTime;
    blip(220, 0.5, 0.4, 'sawtooth', t);
    blip(164.81, 0.7, 0.4, 'sawtooth', t + 0.25);
    thump(55, 0.8, 0.6, t);
  },
};

// Public entry: play a named sound. Silent no-op when audio is unavailable.
export function play(name) {
  if (!ac || !started || !SFX[name]) return;
  try {
    SFX[name]();
  } catch (e) {
    // A failed one-shot must never break the game loop.
  }
}

function duckMusic(ms) {
  duckUntil = Math.max(duckUntil, performance.now() + ms);
}

// ---- Per-frame audio (driven by the 'frame' event from main.js) ------

function nearestPoliceDistance(state) {
  const p = state.player;
  let best = Infinity;
  for (const cop of state.police || []) {
    const v = cop.vehicleId != null
      ? state.vehicles.find((x) => x.id === cop.vehicleId)
      : null;
    const x = v ? v.x : cop.x;
    const z = v ? v.z : cop.z;
    if (x === undefined || z === undefined) continue;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < best) best = d;
  }
  return best;
}

function onFrame(state, dt) {
  if (!ac || !started || !buses) return;
  const t = ac.currentTime;
  const now = performance.now();
  // Guard: update() and the 'frame' event both call this; run once per frame.
  if (now - lastTickMs < 5) return;
  lastTickMs = now;

  const p = state.player || {};
  const driving = !p.onFoot && p.vehicleId !== null && p.vehicleId !== undefined;
  const speed = Math.abs(p.speed || 0);

  // Engine: pitch follows the driven vehicle's speed.
  if (engine) {
    const targetGain = driving ? Math.min(0.16, 0.05 + speed * 0.003) : 0;
    const targetFreq = 55 + speed * 4.5;
    engine.gain.gain.setTargetAtTime(targetGain, t, 0.08);
    engine.osc.frequency.setTargetAtTime(targetFreq, t, 0.08);
    engine.filter.frequency.setTargetAtTime(500 + speed * 30, t, 0.1);
  }

  // Siren: only while wanted; gain follows nearest police distance.
  let sirenLoud = false;
  if (siren) {
    const stars = (state.wanted && state.wanted.stars) || 0;
    let target = 0;
    if (stars > 0) {
      const d = nearestPoliceDistance(state);
      if (Number.isFinite(d)) {
        target = Math.max(0, 1 - d / 140) * 0.10;
        sirenLoud = target > 0.005;
      }
    }
    siren.gain.gain.setTargetAtTime(target, t, 0.15);
    if (sirenLoud && now >= siren.nextFlip) {
      siren.high = !siren.high;
      siren.osc.frequency.setTargetAtTime(siren.high ? 950 : 700, t, 0.02);
      siren.nextFlip = now + 250; // alternate at 2 Hz
    }
  }

  // Footsteps: timing follows on-foot speed.
  if (p.onFoot && speed > 0.5) {
    const interval = Math.min(0.55, Math.max(0.28, 0.6 - speed * 0.04));
    stepAcc += dt;
    if (stepAcc >= interval) {
      stepAcc = 0;
      play('footstep');
    }
  } else {
    stepAcc = 0;
  }

  // Adaptive layers: rhythm in during active missions, tense at >= 3 stars.
  const missionActive = state.mission && state.mission.state === 'active';
  const stars = (state.wanted && state.wanted.stars) || 0;
  buses.rhythmBus.gain.setTargetAtTime(missionActive ? 1 : 0, t, 0.5);
  buses.tenseBus.gain.setTargetAtTime(stars >= 3 ? 1 : 0, t, 0.5);

  // Ducking: music x0.35 while the siren is audible or during dialog
  // (duckMusic holds duckUntil for 2 s after a 'dialog' event).
  const ducked = sirenLoud || now < duckUntil;
  buses.musicDuck.gain.setTargetAtTime(ducked ? 0.35 : 1, t, 0.12);
}

// ---- Lifecycle -------------------------------------------------------

function ensureAudio() {
  if (started) {
    if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return; // unsupported: stay a silent no-op
  try {
    ac = new AC();
  } catch (e) {
    ac = null;
    return;
  }
  try {
    buildGraph();
    startContinuousVoices();
    startMusic();
    started = true;
    if (ac.state === 'suspended') ac.resume().catch(() => {});
  } catch (e) {
    ac = null;
    started = false;
  }
}

export function init(c) {
  ctx = c || {};
  const state = ctx.state;
  if (!state || !state.events) return;

  // Lazy creation on the New Game user gesture; resume when tab visible again.
  state.events.on('gameStarted', ensureAudio);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && started && ac && ac.state === 'suspended') {
      ac.resume().catch(() => {});
    }
  });

  state.events.on('settingsChanged', applySettings);
  state.events.on('frame', (data) => onFrame(state, (data && data.dt) || 0.016));
  state.events.on('punch', () => play('punch'));
  state.events.on('vehicleEntered', () => play('door'));
  state.events.on('vehicleExited', () => play('door'));
  state.events.on('moneyChanged', (data) => {
    if (data && typeof data.delta === 'number' ? data.delta > 0 : true) play('money');
  });
  state.events.on('missionComplete', () => play('complete'));
  state.events.on('missionFailed', () => play('sting'));
  state.events.on('busted', () => play('sting'));
  state.events.on('wasted', () => play('sting'));
  state.events.on('dialog', () => duckMusic(2000));

  window.__audio = {
    get contextState() { return ac ? ac.state : 'unavailable'; },
    get musicGain() { return buses ? buses.music.gain.value : 0; },
    play,
  };
}

export function update(state, input, dt, c) {
  // Per-frame work is driven by the 'frame' event (subscribed in init);
  // update() is the same tick for slices that call it directly. The
  // 5 ms guard in onFrame prevents a double run in one frame.
  onFrame(state, dt);
}

export function sync(state, dt) {
  // Nothing to render-sync; audio state follows events + the frame tick.
}
