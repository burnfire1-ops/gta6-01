// Weather state machine for Teluk Cahaya. Pure, no three.js.
// Types: clear / cloudy / rain / fog. Starts clear; every 90-150 game
// seconds a new type is picked by weight, never repeating the same type
// twice in a row. Transitions blend over ~5 seconds. The renderer reads
// the returned effective params (a single reused object, no allocation
// per frame) and layers them on top of the clock.js day/night cycle.
import { mulberry32 } from './rng.js';

export const WEATHER_TYPES = ['clear', 'cloudy', 'rain', 'fog'];

const WEIGHTS = { clear: 0.45, cloudy: 0.25, rain: 0.15, fog: 0.15 };
const BLEND_TIME = 5; // seconds to crossfade between types

// Per-type render params: sun/hemi intensity multipliers, fog range,
// how much the sky desaturates toward grey, rain amount (0..1), and a
// fog tint the fog colour blends toward (amt 0 = no tint).
const PARAMS = {
  clear:  { sun: 1.0,  hemi: 1.0,  fogNear: 220, fogFar: 720, desat: 0.0,  rain: 0, fogTint: [0.85, 0.88, 0.92], fogTintAmt: 0.0 },
  cloudy: { sun: 0.7,  hemi: 0.7,  fogNear: 200, fogFar: 650, desat: 0.45, rain: 0, fogTint: [0.70, 0.72, 0.75], fogTintAmt: 0.25 },
  rain:   { sun: 0.45, hemi: 0.45, fogNear: 150, fogFar: 500, desat: 0.6,  rain: 1, fogTint: [0.55, 0.58, 0.62], fogTintAmt: 0.35 },
  fog:    { sun: 0.6,  hemi: 0.6,  fogNear: 120, fogFar: 350, desat: 0.5,  rain: 0, fogTint: [0.72, 0.75, 0.78], fogTintAmt: 0.6 },
};

function lerp(a, b, t) { return a + (b - a) * t; }

export function createWeather(seed = 20261118) {
  const rng = mulberry32(seed >>> 0);
  const w = {
    type: 'clear', // target type (what we are blending toward)
    prev: 'clear', // type we are blending from
    t: 0, // game seconds spent in the current type
    duration: 90 + rng() * 60, // 90-150 s per type
    blend: 1, // 0..1 crossfade progress (1 = fully settled)
    rng,
    // Effective (blended) params, reused every frame — updateWeather
    // mutates and returns this same object, never allocates.
    eff: {
      type: 'clear', blend: 1,
      sun: 1, hemi: 1, fogNear: 220, fogFar: 720,
      desat: 0, rain: 0,
      fogTint: [0.85, 0.88, 0.92], fogTintAmt: 0,
    },
  };
  return w;
}

function pickNext(w) {
  let next;
  do {
    const r = w.rng();
    let acc = 0;
    next = 'clear';
    for (let i = 0; i < WEATHER_TYPES.length; i++) {
      acc += WEIGHTS[WEATHER_TYPES[i]];
      if (r < acc) { next = WEATHER_TYPES[i]; break; }
    }
  } while (next === w.type); // never repeat the same type twice in a row
  return next;
}

export function updateWeather(w, dt) {
  if (dt > 0) w.t += dt;
  if (w.blend < 1) w.blend = Math.min(1, w.blend + dt / BLEND_TIME);
  if (w.t >= w.duration) {
    w.prev = w.type;
    w.type = pickNext(w);
    w.t = 0;
    w.duration = 90 + w.rng() * 60;
    w.blend = 0;
  }
  // Smoothstep the blend so transitions ease in and out.
  const b = w.blend * w.blend * (3 - 2 * w.blend);
  const a = PARAMS[w.prev];
  const c = PARAMS[w.type];
  const e = w.eff;
  e.type = w.type;
  e.blend = w.blend;
  e.sun = lerp(a.sun, c.sun, b);
  e.hemi = lerp(a.hemi, c.hemi, b);
  e.fogNear = lerp(a.fogNear, c.fogNear, b);
  e.fogFar = lerp(a.fogFar, c.fogFar, b);
  e.desat = lerp(a.desat, c.desat, b);
  e.rain = lerp(a.rain, c.rain, b);
  e.fogTint[0] = lerp(a.fogTint[0], c.fogTint[0], b);
  e.fogTint[1] = lerp(a.fogTint[1], c.fogTint[1], b);
  e.fogTint[2] = lerp(a.fogTint[2], c.fogTint[2], b);
  e.fogTintAmt = lerp(a.fogTintAmt, c.fogTintAmt, b);
  return e;
}
