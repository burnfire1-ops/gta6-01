// Teluk Cahaya — city clock, sun, sky and traffic density.
// Pure math: no three.js, no state. Every daylight system in the game
// (renderer sky, street lights, traffic spawns, ped schedules) reads the
// same clock, so a morning screenshot and a midnight screenshot can never
// disagree about what time it is.
//
// Clock convention: 0..1, 0 = 06:00 sunrise, 0.25 = 12:00 noon,
// 0.5 = 18:00 sunset, 0.75 = 00:00 midnight. One full day is DAY_LENGTH
// real seconds (~12 minutes), driven by state.time in main.js.

export const DAY_LENGTH = 720;

const TAU = Math.PI * 2;

// --- small helpers ---------------------------------------------------------

function clamp01(v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Smooth 0..1 ramp between a and b (Hermite), for dawn/dusk transitions
// that never jump between frames.
function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function mixColor(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// A soft bump centred on `centre` (in clock units), for rush hours.
function bump(clock, centre, width) {
  const d = clock - centre;
  return Math.exp(-(d * d) / (2 * width * width));
}

// --- clock -----------------------------------------------------------------

// Session seconds -> city clock 0..1. Handles negative and huge inputs.
export function clockFromTime(t) {
  return (((t / DAY_LENGTH) % 1) + 1) % 1;
}

// Height of the sun above the horizon, -1..1: +1 at noon, 0 at 06:00 and
// 18:00, -1 at midnight. Every daylight curve below is built on this one
// value, so sun, sky and night factor always agree.
function sunHeight(clock) {
  return Math.cos((clock - 0.25) * TAU);
}

// --- night -----------------------------------------------------------------

export function nightFactor(clock) {
  // 0 in full daylight, 1 in full night, smooth through dawn and dusk.
  // The ramp straddles the horizon so sunrise/sunset read as twilight
  // (~0.35) instead of full night, and street lights come on just
  // before the sun actually sets.
  return 1 - smoothstep(-0.15, 0.1, sunHeight(clock));
}

// --- traffic density -------------------------------------------------------

function districtKey(district) {
  const name = String(district || '').toLowerCase().replace(/[\s_-]/g, '');
  if (name === 'neon' || name === 'distrikneon') return 'neon';
  if (name === 'port' || name === 'pelabuhan' || name === 'industri') return 'port';
  if (name === 'residential' || name === 'residensial' || name === 'bukit') return 'residential';
  return 'boulevard';
}

export function trafficDensity(clock, district) {
  const c = ((clock % 1) + 1) % 1;
  // Day curve: 1 at noon, 0 at midnight. Night curve is its mirror.
  const day = 0.5 + 0.5 * Math.cos((c - 0.25) * TAU);
  const night = 1 - day;
  // Rush hours: ~08:00 (clock 0.083) and ~17:00 (clock 0.458).
  const rush = bump(c, 0.083, 0.045) + bump(c, 0.458, 0.05);

  let density;
  switch (districtKey(district)) {
    case 'neon':
      // Nightlife district: quiet at noon, busiest after dark.
      density = 0.22 + 0.18 * day + 0.6 * night + 0.12 * bump(c, 0.55, 0.06);
      break;
    case 'port':
      // Warehouses and trucks: busy through the working day, dead at night.
      density = 0.1 + 0.62 * day + 0.1 * rush;
      break;
    case 'residential':
      // Houses: the quietest district, small morning/evening peaks.
      density = 0.18 + 0.22 * day + 0.22 * rush;
      break;
    case 'boulevard':
    default:
      // Shops and cafes: steady daytime flow with rush-hour peaks.
      density = 0.32 + 0.34 * day + 0.22 * rush + 0.08 * night;
      break;
  }
  return clamp01(density);
}

// --- sky colours -----------------------------------------------------------

// Keyframes around the day. The list wraps: the last key repeats dawn at
// clock 1 so interpolation never jumps at midnight.
const SKY_KEYS = [
  { at: 0.0, top: [0.36, 0.46, 0.78], horizon: [1.0, 0.62, 0.42] }, // 06:00 dawn
  { at: 0.12, top: [0.22, 0.5, 0.92], horizon: [0.62, 0.82, 1.0] }, // morning
  { at: 0.25, top: [0.15, 0.44, 0.95], horizon: [0.55, 0.78, 1.0] }, // noon
  { at: 0.38, top: [0.24, 0.5, 0.9], horizon: [0.68, 0.84, 1.0] }, // afternoon
  { at: 0.5, top: [0.3, 0.22, 0.52], horizon: [1.0, 0.5, 0.26] }, // 18:00 dusk
  { at: 0.62, top: [0.05, 0.07, 0.18], horizon: [0.16, 0.13, 0.28] }, // evening
  { at: 0.75, top: [0.02, 0.04, 0.1], horizon: [0.06, 0.08, 0.18] }, // midnight
  { at: 0.88, top: [0.05, 0.07, 0.2], horizon: [0.2, 0.18, 0.32] }, // pre-dawn
  { at: 1.0, top: [0.36, 0.46, 0.78], horizon: [1.0, 0.62, 0.42] }, // wraps to dawn
];

export function skyColors(clock) {
  const c = ((clock % 1) + 1) % 1;
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    const a = SKY_KEYS[i];
    const b = SKY_KEYS[i + 1];
    if (c >= a.at && c <= b.at) {
      const span = b.at - a.at || 1;
      const t = smoothstep(0, 1, (c - a.at) / span);
      return { top: mixColor(a.top, b.top, t), horizon: mixColor(a.horizon, b.horizon, t) };
    }
  }
  const last = SKY_KEYS[SKY_KEYS.length - 1];
  return { top: last.top.slice(), horizon: last.horizon.slice() };
}

// --- sun -------------------------------------------------------------------

export function sunState(clock) {
  const c = ((clock % 1) + 1) % 1;
  const height = sunHeight(c);
  // Elevation: up to ~65 degrees at noon, below the horizon at night.
  const elevation = (Math.PI / 2) * 0.72 * height;
  // Azimuth sweeps east -> south -> west across the day.
  const azimuth = c * TAU - Math.PI / 2;
  const cosEl = Math.cos(elevation);
  const dir = [
    cosEl * Math.sin(azimuth),
    Math.sin(elevation),
    cosEl * Math.cos(azimuth),
  ];
  const isDay = height > 0;
  // Brightness grows steeply once the sun clears the horizon.
  const strength = clamp01(height * 1.6);
  const intensity = isDay ? 0.25 + 2.0 * strength : 0;
  // Low sun is warm orange; high sun is near-white.
  const warmth = 1 - strength;
  const color = [1.0, lerp(0.95, 0.55, warmth), lerp(0.85, 0.3, warmth)];
  return { dir, intensity, color, isDay };
}
