// Teluk Cahaya — weather + atmosphere (core sim, pure: no three.js).
// A slow state machine cycles clear / cloudy / rain / fog and never
// repeats the same condition twice in a row. Every visible effect lerps
// toward its target, so the sky, fog and light glide between conditions
// instead of jumping. renderer.js reads the returned effect object each
// frame and applies it to the sky dome, fog, lights and rain.

const CONDITIONS = ['clear', 'cloudy', 'rain', 'fog'];

// Target effect values per condition. Fog ranges follow the renderer
// contract: clear 220/720, rain 150/500, fog 120/350, cloudy in between.
const TARGETS = {
  clear: {
    desat: 0.0, fogTintAmt: 0.0, fogTint: [1.0, 0.9, 0.72],
    fogNear: 220, fogFar: 720, hemi: 1.0, sun: 1.0, rain: 0,
  },
  cloudy: {
    desat: 0.28, fogTintAmt: 0.25, fogTint: [0.74, 0.78, 0.82],
    fogNear: 180, fogFar: 600, hemi: 0.85, sun: 0.62, rain: 0,
  },
  rain: {
    desat: 0.38, fogTintAmt: 0.42, fogTint: [0.58, 0.64, 0.72],
    fogNear: 150, fogFar: 500, hemi: 0.7, sun: 0.45, rain: 0.9,
  },
  fog: {
    desat: 0.5, fogTintAmt: 0.65, fogTint: [0.84, 0.87, 0.9],
    fogNear: 120, fogFar: 350, hemi: 0.75, sun: 0.35, rain: 0,
  },
};

const MIN_HOLD = 90;    // shortest time a condition lasts (seconds)
const HOLD_SPAN = 60;   // ...plus up to this much, so 90..150 s total
const BLEND_RATE = 0.22; // per-second exponential approach to the target

// Tiny local rng (mulberry32) so this module needs no other import.
function seedRng(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Create the weather state. Starts clear so the first frames of a session
// (and the cover shot) always open on a bright sky; the timer is seeded,
// so later changes are deterministic for a given seed.
export function createWeather(seed) {
  const rand = seedRng(typeof seed === 'number' ? seed : 1);
  const start = TARGETS.clear;
  return {
    seed: seed || 1,
    condition: 'clear',
    timer: MIN_HOLD + rand() * HOLD_SPAN,
    desat: start.desat,
    fogTintAmt: start.fogTintAmt,
    fogTint: start.fogTint.slice(),
    fogNear: start.fogNear,
    fogFar: start.fogFar,
    hemi: start.hemi,
    sun: start.sun,
    rain: start.rain,
    _rand: rand,
  };
}

// Pick a new condition that differs from the current one.
function pickNext(weather) {
  let next = weather.condition;
  while (next === weather.condition) {
    next = CONDITIONS[Math.floor(weather._rand() * CONDITIONS.length)];
  }
  return next;
}

// Advance the state machine by dt seconds and return the current effect.
// The returned object is freshly built each call; the fogTint array inside
// it is the state's own (read-only for the caller).
export function updateWeather(weather, dt) {
  if (!weather) {
    const c = TARGETS.clear;
    return {
      desat: c.desat, fogTintAmt: c.fogTintAmt, fogTint: c.fogTint.slice(),
      fogNear: c.fogNear, fogFar: c.fogFar, hemi: c.hemi, sun: c.sun, rain: c.rain,
    };
  }
  const step = Math.min(Math.max(dt || 0, 0), 0.1);
  if (step > 0) {
    weather.timer -= step;
    if (weather.timer <= 0) {
      weather.condition = pickNext(weather);
      weather.timer = MIN_HOLD + weather._rand() * HOLD_SPAN;
    }
    // Smooth blend: exponential approach, same rate for every channel.
    const k = 1 - Math.exp(-BLEND_RATE * step);
    const t = TARGETS[weather.condition];
    weather.desat += (t.desat - weather.desat) * k;
    weather.fogTintAmt += (t.fogTintAmt - weather.fogTintAmt) * k;
    for (let i = 0; i < 3; i++) {
      weather.fogTint[i] += (t.fogTint[i] - weather.fogTint[i]) * k;
    }
    weather.fogNear += (t.fogNear - weather.fogNear) * k;
    weather.fogFar += (t.fogFar - weather.fogFar) * k;
    weather.hemi += (t.hemi - weather.hemi) * k;
    weather.sun += (t.sun - weather.sun) * k;
    weather.rain += (t.rain - weather.rain) * k;
  }
  return {
    desat: weather.desat,
    fogTintAmt: weather.fogTintAmt,
    fogTint: weather.fogTint,
    fogNear: weather.fogNear,
    fogFar: weather.fogFar,
    hemi: weather.hemi,
    sun: weather.sun,
    rain: weather.rain,
  };
}
