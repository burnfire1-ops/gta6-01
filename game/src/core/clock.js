// City clock: one day is ~12 real minutes. Sun, sky, lights, traffic density
// and pedestrian schedules all read this one clock. Pure, no three.js.
export const DAY_LENGTH = 720; // seconds per city day

export function clockFromTime(time) { return ((time / DAY_LENGTH) % 1 + 1) % 1; }
export function hourOf(clock) { return (6 + clock * 24) % 24; }
export function isNight(clock) { const h = hourOf(clock); return h >= 18 || h < 6; }

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpColor(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// Sky keyframes: [clock, topColor, horizonColor] (0..1 RGB).
const SKY_KEYS = [
  [0.00, [1.00, 0.62, 0.45], [1.00, 0.85, 0.62]], // 06:00 dawn coral
  [0.08, [0.45, 0.78, 0.90], [0.95, 0.90, 0.75]], // 08:00 morning
  [0.42, [0.35, 0.72, 0.92], [0.85, 0.92, 0.95]], // 16:00 day
  [0.50, [0.98, 0.55, 0.38], [1.00, 0.78, 0.55]], // 18:00 dusk
  [0.58, [0.05, 0.10, 0.22], [0.12, 0.18, 0.33]], // 20:00 night navy
  [0.92, [0.04, 0.08, 0.19], [0.10, 0.15, 0.30]], // 04:00 deep night
  [1.00, [1.00, 0.62, 0.45], [1.00, 0.85, 0.62]], // 06:00 dawn again
];

export function skyColors(clock) {
  let i = 0;
  while (i < SKY_KEYS.length - 2 && clock > SKY_KEYS[i + 1][0]) i++;
  const [c0, top0, hor0] = SKY_KEYS[i];
  const [c1, top1, hor1] = SKY_KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (clock - c0) / (c1 - c0)));
  return { top: lerpColor(top0, top1, t), horizon: lerpColor(hor0, hor1, t) };
}

// Sun position (unit-ish direction) and intensity. Day: t in [0, 0.5].
export function sunState(clock) {
  const h = hourOf(clock);
  const day = h >= 6 && h < 18;
  if (day) {
    const f = (h - 6) / 12; // 0 sunrise -> 1 sunset
    const el = Math.sin(f * Math.PI); // 0..1..0
    const az = Math.PI * f; // east -> west
    return {
      isDay: true,
      dir: [Math.cos(az), 0.35 + el * 1.1, 0.45 * Math.sin(az)],
      intensity: 0.6 + 2.0 * el,
      color: f < 0.12 || f > 0.88 ? [1.0, 0.72, 0.45] : [1.0, 0.95, 0.85],
    };
  }
  // Night: dim moon from a fixed high angle.
  return { isDay: false, dir: [-0.4, 0.9, -0.3], intensity: 0.28, color: [0.65, 0.75, 1.0] };
}

// How "on" the night lights are (windows, neon, street lamps): 0 day -> 1 night.
export function nightFactor(clock) {
  const h = hourOf(clock);
  if (h >= 18 && h < 19) return (h - 18) / 1;
  if (h >= 19 || h < 5) return 1;
  if (h >= 5 && h < 6) return 1 - (h - 5) / 1;
  return 0;
}

// Traffic density multiplier by hour (busy morning/evening, quiet midnight).
export function trafficDensity(clock, district) {
  const h = hourOf(clock);
  let d = 0.45;
  if (h >= 7 && h < 10) d = 0.95;
  else if (h >= 16 && h < 19) d = 1.0;
  else if (h >= 0 && h < 5) d = 0.18;
  else if (h >= 11 && h < 15) d = 0.65;
  if (district === 'neon' && isNight(clock)) d = Math.min(1, d + 0.35);
  if (district === 'port' && h >= 6 && h < 18) d = Math.min(1, d + 0.15);
  return d;
}
