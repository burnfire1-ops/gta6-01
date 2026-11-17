// Raka on foot: camera-relative movement, run, jump, punch. Pure sim.
// Vehicle driving lives in core/vehicles.js (separate slice).
const WALK_SPEED = 6, RUN_SPEED = 9.5, ACCEL = 42, FRICTION = 26;
const JUMP_V = 8.5, GRAVITY = 24, RADIUS = 0.6, BOUND = 258;

export function updatePlayer(state, input, dt, city) {
  const p = state.player;
  if (!p.onFoot) return;
  const a = input.actions;
  // Camera-relative move direction.
  const fwd = { x: Math.sin(input.camYaw), z: Math.cos(input.camYaw) };
  const right = { x: fwd.z, z: -fwd.x };
  let mx = right.x * a.moveX + fwd.x * a.moveY;
  let mz = right.z * a.moveX + fwd.z * a.moveY;
  const ml = Math.hypot(mx, mz);
  if (ml > 1) { mx /= ml; mz /= ml; }
  const target = (a.run ? RUN_SPEED : WALK_SPEED) * (ml > 0.05 ? 1 : 0);
  const cur = Math.hypot(p.vx || 0, p.vz || 0);
  const speed = target > cur ? Math.min(target, cur + ACCEL * dt) : Math.max(target, cur - FRICTION * dt);
  p.speed = speed;
  if (ml > 0.05) {
    p.vx = mx * speed; p.vz = mz * speed;
    p.heading = Math.atan2(mx, mz);
  } else { p.vx = 0; p.vz = 0; }
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  // Buildings push the player out; city bounds clamp.
  const c = city.collideCircle(p.x, p.z, RADIUS);
  p.x = Math.max(-BOUND, Math.min(BOUND, c.x));
  p.z = Math.max(-BOUND, Math.min(BOUND, c.z));
  // Jump + gravity.
  if (a.jump && p.grounded) { p.vy = JUMP_V; p.grounded = false; }
  if (!p.grounded) {
    p.vy -= GRAVITY * dt;
    p.y += p.vy * dt;
    if (p.y <= 0) { p.y = 0; p.vy = 0; p.grounded = true; }
  }
  // Punch anim only (combat slice owns the 'punch' event + resolution,
  // one emit per swing; aiming fires the pistol, not a punch).
  if (p.punchT > 0) p.punchT -= dt;
  if (a.attack && !a.aim && p.punchT <= 0) {
    p.punchT = 0.32;
    p.punchKind = (p.punchKind + 1) % 2;
  }
}
