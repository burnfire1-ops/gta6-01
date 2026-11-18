
const CHORDS = {
  Am: [110.0, 130.81, 164.81],
  F: [87.31, 110.0, 130.81],
  C: [130.81, 164.81, 196.0],
  G: [98.0, 123.47, 146.83],
};
const PROGRESSION = ['Am', 'F', 'C', 'G'];

const MOOD_GAIN = { calm: 0.05, mission: 0.08, chase: 0.12 };
const MOOD_CHORD_SECONDS = { calm: 4, mission: 4, chase: 2 };
const MOOD_HAT_SECONDS = { calm: 0, mission: 0.5, chase: 0.25 };

export function createAudio() {
  let ctx = null;
  let master = null;
  let musicBus = null;
  let musicDuck = null;
  let sfxBus = null;
  let ambienceBus = null;
  let uiBus = null;

  let engineOsc = null;
  let engineFilter = null;
  let engineGain = null;

  let sirenOsc = null;
  let sirenLfo = null;
  let sirenLfoGain = null;
  let sirenGain = null;
  let sirenOn = false;

  let mood = 'calm';
  let musicTimer = null;
  let chordIndex = 0;
  let chordNodes = [];
  let noiseBuffer = null;
  let muted = false;
  let masterGainValue = 0.9;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : masterGainValue;
      master.connect(ctx.destination);

      musicDuck = ctx.createGain();
      musicDuck.gain.value = sirenOn ? 0.5 : 1.0;
      musicDuck.connect(master);

      musicBus = ctx.createGain();
      musicBus.gain.value = MOOD_GAIN[mood] || MOOD_GAIN.calm;
      musicBus.connect(musicDuck);

      sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.9;
      sfxBus.connect(master);

      ambienceBus = ctx.createGain();
      ambienceBus.gain.value = 0.4;
      ambienceBus.connect(master);

      uiBus = ctx.createGain();
      uiBus.gain.value = 0.8;
      uiBus.connect(master);

      startMusicScheduler();
    } catch {
      ctx = null;
    }
  }

  function stopChord() {
    for (const n of chordNodes) {
      try {
        n.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        n.oscs.forEach((o) => o.stop(ctx.currentTime + 0.4));
      } catch {
      }
    }
    chordNodes = [];
  }

  function playChord(name) {
    if (!ctx || !musicBus) return;
    stopChord();
    const freqs = CHORDS[name] || CHORDS.Am;
    const t = ctx.currentTime;
    for (const f of freqs) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.8);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      const oscs = [];
      for (const detune of [-4, 4]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.detune.value = detune;
        o.connect(filter);
        o.start(t);
        oscs.push(o);
      }
      filter.connect(g);
      g.connect(musicBus);
      chordNodes.push({ gain: g, oscs });
    }
  }

  function makeNoiseBuffer() {
    if (noiseBuffer) return noiseBuffer;
    const len = ctx.sampleRate * 1;
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  function playHat() {
    if (!ctx || !musicBus) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 6000;
    bp.Q.value = 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(mood === 'chase' ? 0.12 : 0.07, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(bp);
    bp.connect(g);
    g.connect(musicBus);
    src.start(t, Math.random());
    src.stop(t + 0.08);
  }

  function startMusicScheduler() {
    if (musicTimer || !ctx) return;
    let nextChordAt = 0;
    let nextHatAt = 0;
    musicTimer = setInterval(() => {
      if (!ctx) return;
      const now = ctx.currentTime;
      if (now >= nextChordAt) {
        playChord(PROGRESSION[chordIndex % PROGRESSION.length]);
        chordIndex += 1;
        nextChordAt = now + (MOOD_CHORD_SECONDS[mood] || 4);
      }
      const hatEvery = MOOD_HAT_SECONDS[mood] || 0;
      if (hatEvery > 0 && now >= nextHatAt) {
        playHat();
        nextHatAt = now + hatEvery;
      }
    }, 120);
  }

  function setEngine(rpm01) {
    if (!ctx || !sfxBus) return;
    const rpm = Math.max(0, Math.min(1, Number(rpm01) || 0));
    const t = ctx.currentTime;
    if (!engineOsc) {
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 800;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(sfxBus);
      engineOsc.start();
    }
    engineOsc.frequency.setTargetAtTime(60 + 140 * rpm, t, 0.05);
    engineFilter.frequency.setTargetAtTime(400 + 1200 * rpm, t, 0.05);
    engineGain.gain.setTargetAtTime(rpm > 0.02 ? 0.05 + 0.05 * rpm : 0, t, 0.1);
  }

  function siren(on) {
    sirenOn = !!on;
    if (!ctx || !sfxBus) return;
    const t = ctx.currentTime;
    if (on && !sirenOsc) {
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'triangle';
      sirenOsc.frequency.value = 825; // ten
      sirenLfo = ctx.createOscillator();
      sirenLfo.type = 'sine';
      sirenLfo.frequency.value = 0.6; // ~1
      sirenLfoGain = ctx.createGain();
      sirenLfoGain.gain.value = 125; // 825
      sirenLfo.connect(sirenLfoGain);
      sirenLfoGain.connect(sirenOsc.frequency);
      sirenGain = ctx.createGain();
      sirenGain.gain.setValueAtTime(0, t);
      sirenGain.gain.linearRampToValueAtTime(0.08, t + 0.2);
      sirenOsc.connect(sirenGain);
      sirenGain.connect(sfxBus);
      sirenOsc.start();
      sirenLfo.start();
    } else if (!on && sirenOsc) {
      const osc = sirenOsc;
      const lfo = sirenLfo;
      const g = sirenGain;
      sirenOsc = null;
      sirenLfo = null;
      sirenGain = null;
      try {
        g.gain.setTargetAtTime(0, t, 0.05);
        osc.stop(t + 0.3);
        lfo.stop(t + 0.3);
      } catch {
      }
    }
    if (musicDuck) {
      musicDuck.gain.setTargetAtTime(on ? 0.5 : 1.0, t, 0.15);
    }
  }

  function blip() {
    if (!ctx || !uiBus) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 880 * (1 + (Math.random() - 0.5) * 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(g);
    g.connect(uiBus);
    o.start(t);
    o.stop(t + 0.08);
  }

  function setMood(next) {
    if (next !== 'calm' && next !== 'mission' && next !== 'chase') return;
    mood = next;
    if (ctx && musicBus) {
      musicBus.gain.setTargetAtTime(MOOD_GAIN[mood], ctx.currentTime, 0.5);
    }
  }

  function setMuted(m) {
    muted = !!m;
    if (ctx && master) {
      master.gain.setTargetAtTime(muted ? 0 : masterGainValue, ctx.currentTime, 0.05);
    }
  }

  return { ensure, setEngine, siren, blip, setMood, setMuted };
}
