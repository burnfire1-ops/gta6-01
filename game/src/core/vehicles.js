// Teluk Cahaya — vehicles slice (core sim, pure: no three.js).
// Arcade driving, stealing cars, damage. State lives in state.vehicles;
// this module owns spawning, the per-vehicle physics step, enter/exit and
// the hold-to-steal interaction (F). Other slices (traffic, police) drive
// vehicles by calling stepVehicle with their own control input.
import { makeRng } from './rng.js';
import { districtAt } from './city.js';

export const VEHICLE_TYPES = {
  sedan: { top: 22, accel: 14, color: 0xd8d8d8, name: 'Sedan' },
  taksi: { top: 22, accel: 14, color: 0xf2c14e, name: 'Taksi' },
  van: { top: 18, accel: 10, color: 0xe8e8e8, name: 'Van' },
  pikap: { top: 20, accel: 12, color: 0x7a2f2f, name: 'Pikap' },
  sport: { top: 32, accel: 20, color: 0x2a9a9a, name: 'Sport' },
  patroli: { top: 28, accel: 18, color: 0xf2f2f2, name: 'Patroli' },
};

const BOUND = 258;        // world clamp (same as the player bound)
const BODY_RADIUS = 2.2;  // collision circle vs buildings
const CAR_GAP = 4.4;      // centre distance at which two cars touch
const REVERSE_MAX = 8;    // fastest reverse speed

let nextId = 1;

export function spawnVehicle(state, city, type, x, z, heading, opts = {}) {
  const spec = VEHICLE_TYPES[type] || VEHICLE_TYPES.sedan;
  const v = {
    id: opts.id ?? nextId++,
    type,
    x, z,
    heading,
    speed: 0,
    steer: 0,
    color: opts.color ?? spec.color,
    health: opts.health ?? 100,
    driver: opts.driver ?? null,   // 'player' | 'npc' | 'police' | null
    parked: opts.parked ?? true,
    locked: opts.locked ?? false,
    stolen: false,
    wantedMarked: false,
    owned: !!opts.owned,
  };
  state.vehicles.push(v);
  return v;
}

export function topSpeedFor(vehicle) {
  const spec = VEHICLE_TYPES[vehicle.type] || VEHICLE_TYPES.sedan;
  let top = spec.top;
  if (vehicle.health < 50) top *= 0.5 + vehicle.health / 100;
  return top;
}

function damagePlayerFromImpact(state, impact) {
  // Hard crashes hurt the driver, not just the car.
  if (impact <= 14 || state.health <= 0) return;
  state.health = Math.max(0, state.health - Math.round(impact - 14));
  state.events.emit('healthChanged', { health: state.health });
}

export function damageVehicle(state, vehicle, amount) {
  if (vehicle.health <= 0 || amount <= 0) return;
  vehicle.health = Math.max(0, vehicle.health - amount);
  if (vehicle.health <= 0) {
    vehicle.speed = 0;
    vehicle.parked = true;
    if (vehicle.driver === 'player') {
      vehicle.driver = null;
      const p = state.player;
      p.onFoot = true;
      p.vehicleId = null;
      p.speed = 0;
      state.events.emit('vehicleExited', { name: vehicleName(vehicle), health: 0, wrecked: true });
    } else {
      vehicle.driver = null;
    }
  }
}

export function vehicleName(vehicle) {
  const spec = VEHICLE_TYPES[vehicle.type] || VEHICLE_TYPES.sedan;
  return spec.name;
}

// One physics step for a single vehicle. control = { throttle -1..1,
// steer -1..1, brake bool, handbrake bool }. Pure apart from the event bus
// (damage / player-health events) and the shared state.vehicles list used
// for car-vs-car separation.
export function stepVehicle(state, vehicle, control, dt, city) {
  if (dt <= 0 || vehicle.health <= 0) {
    vehicle.speed = 0;
    return;
  }
  const spec = VEHICLE_TYPES[vehicle.type] || VEHICLE_TYPES.sedan;
  const top = topSpeedFor(vehicle);
  const throttle = Math.max(-1, Math.min(1, control.throttle || 0));
  const steerIn = Math.max(-1, Math.min(1, control.steer || 0));
  const handbrake = !!control.handbrake;

  // --- longitudinal: accelerate, brake, drag -------------------------------
  if (throttle > 0) {
    vehicle.speed += spec.accel * throttle * dt;
  } else if (throttle < 0) {
    if (vehicle.speed > 0.5) {
      // S while rolling forward = brake, not instant reverse.
      vehicle.speed -= spec.accel * 1.6 * dt;
      if (vehicle.speed < 0) vehicle.speed = 0;
    } else {
      vehicle.speed += spec.accel * 0.7 * throttle * dt; // reverse
    }
  }
  if (control.brake) vehicle.speed -= spec.accel * 2 * dt * Math.sign(vehicle.speed);
  // Rolling drag + engine braking when no throttle.
  vehicle.speed -= vehicle.speed * 0.35 * dt;
  if (throttle === 0 && !control.brake) vehicle.speed -= Math.sign(vehicle.speed) * 4 * dt;
  if (Math.abs(vehicle.speed) < 0.05 && throttle === 0) vehicle.speed = 0;

  if (handbrake) {
    // Handbrake: rear slip, speed bleed, yaw boost (handled below).
    vehicle.speed -= Math.sign(vehicle.speed) * 12 * dt;
    if (Math.abs(vehicle.speed) < 0.3) vehicle.speed = 0;
  }
  // Clamp: forward top speed (health-scaled), reverse cap.
  if (vehicle.speed > top) vehicle.speed = top;
  if (vehicle.speed < -REVERSE_MAX) vehicle.speed = -REVERSE_MAX;

  // --- steering: less lock at speed, yaw follows direction of travel ------
  const speedAbs = Math.abs(vehicle.speed);
  const steerTarget = steerIn * (0.55 / (1 + speedAbs * 0.045));
  vehicle.steer += (steerTarget - vehicle.steer) * Math.min(1, 8 * dt);
  const grip = Math.min(1, speedAbs / 8); // no turning while (nearly) still
  let yawRate = vehicle.steer * 1.6 * grip * Math.sign(vehicle.speed || 1);
  if (handbrake) yawRate += steerIn * 1.1 * grip * Math.sign(vehicle.speed || 1);
  vehicle.heading += yawRate * dt;

  // --- integrate ------------------------------------------------------------
  vehicle.x += Math.sin(vehicle.heading) * vehicle.speed * dt;
  vehicle.z += Math.cos(vehicle.heading) * vehicle.speed * dt;

  // --- buildings: slide along the wall, damage on hard hits -----------------
  const c = city.collideCircle(vehicle.x, vehicle.z, BODY_RADIUS);
  if (c.hit) {
    const impact = speedAbs;
    vehicle.x = Math.max(-BOUND, Math.min(BOUND, c.x));
    vehicle.z = Math.max(-BOUND, Math.min(BOUND, c.z));
    vehicle.speed *= 0.25; // bounce/slide: most speed is lost on the wall
    if (impact > 8) {
      damageVehicle(state, vehicle, (impact - 8) * 1.5);
      if (vehicle.driver === 'player') damagePlayerFromImpact(state, impact);
    }
  } else {
    vehicle.x = Math.max(-BOUND, Math.min(BOUND, vehicle.x));
    vehicle.z = Math.max(-BOUND, Math.min(BOUND, vehicle.z));
  }

  // --- other vehicles: push apart, damage from relative speed ---------------
  for (const other of state.vehicles) {
    if (other === vehicle || other.health <= 0) continue;
    const dx = vehicle.x - other.x, dz = vehicle.z - other.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= CAR_GAP * CAR_GAP || d2 < 1e-6) continue;
    const d = Math.sqrt(d2);
    const push = (CAR_GAP - d) / 2;
    const nx = dx / d, nz = dz / d;
    vehicle.x += nx * push; vehicle.z += nz * push;
    other.x -= nx * push; other.z -= nz * push;
    const rel = Math.abs(vehicle.speed - other.speed);
    if (rel > 6) {
      const dmg = (rel - 6) * 0.8;
      damageVehicle(state, vehicle, dmg);
      damageVehicle(state, other, dmg);
    }
    // Gentle speed exchange so a shove is felt, not just a position pop.
    const avg = (vehicle.speed + other.speed) / 2;
    vehicle.speed = vehicle.speed * 0.7 + avg * 0.3;
    other.speed = other.speed * 0.7 + avg * 0.3;
  }
}

// --- enter / exit -----------------------------------------------------------

function nearestVehicle(state, x, z, maxDist) {
  let best = null, bestD = maxDist;
  for (const v of state.vehicles) {
    if (v.health <= 0) continue;
    const d = Math.hypot(v.x - x, v.z - z);
    if (d < bestD) { best = v; bestD = d; }
  }
  return best;
}

function exitVehicle(state, vehicle) {
  const p = state.player;
  const sideX = Math.cos(vehicle.heading), sideZ = -Math.sin(vehicle.heading);
  p.x = vehicle.x + sideX * 2.4;
  p.z = vehicle.z + sideZ * 2.4;
  p.y = 0; p.vy = 0; p.grounded = true;
  p.vx = 0; p.vz = 0; p.speed = 0;
  p.heading = vehicle.heading;
  p.onFoot = true;
  p.vehicleId = null;
  vehicle.driver = null;
  vehicle.parked = true;
  state.events.emit('vehicleExited', { name: vehicleName(vehicle), health: vehicle.health });
}

function enterVehicle(state, vehicle) {
  const p = state.player;
  const wasParked = vehicle.parked;
  const wasOwned = !!vehicle.owned;
  if (vehicle.driver && vehicle.driver !== 'player') {
    state.events.emit('driverPulled', { vehicleId: vehicle.id, x: vehicle.x, z: vehicle.z });
  }
  vehicle.driver = 'player';
  vehicle.parked = false;
  vehicle.stolen = wasParked && !wasOwned;
  p.onFoot = false;
  p.vehicleId = vehicle.id;
  p.x = vehicle.x; p.z = vehicle.z;
  p.heading = vehicle.heading;
  p.speed = vehicle.speed;
  p.vx = 0; p.vz = 0;
  if (vehicle.stolen) {
    state.events.emit('crimeSeen', {
      kind: 'steal', x: vehicle.x, z: vehicle.z,
      vehicleId: vehicle.id, police: vehicle.type === 'patroli',
    });
  }
  state.events.emit('vehicleEntered', { name: vehicleName(vehicle), health: vehicle.health });
}

// Hold-to-steal progress for a locked car (seconds of F held).
let holdT = 0;
let holdTargetId = null;
const HOLD_SECONDS = 1.5;

function resetHold() {
  holdT = 0;
  holdTargetId = null;
}

export function init(ctx) {
  const { state, city } = ctx;
  state.vehicles = [];
  nextId = 1;
  const rng = makeRng((state.seed || 1) + 5);

  // Hero car: teal sport, unlocked, owned by the player, parked near start.
  const hero = spawnVehicle(state, city, 'sport', -156, -196, Math.PI / 2,
    { parked: true, locked: false, owned: true });
  if (!state.flags.vehiclesOwned.includes(hero.id)) {
    state.flags.vehiclesOwned.push(hero.id);
  }

  // ~14 more parked cars along road edges, spread over all four districts.
  const palette = {
    sedan: [0xd8d8d8, 0x3a5a8c, 0x8c2f2f, 0x2f6b4f, 0xc8a03a],
    van: [0xe8e8e8, 0x5a6a7a, 0x8a6a3a],
    pikap: [0x7a2f2f, 0x2f4a6b, 0x4a4a4a],
  };
  const types = ['sedan', 'sedan', 'taksi', 'van', 'pikap', 'sport'];
  let placed = 0, tries = 0;
  while (placed < 14 && tries < 300) {
    tries++;
    const ix = rng.int(1, 11), iz = rng.int(1, 11);
    const nx = -240 + ix * 40, nz = -240 + iz * 40;
    // Park on a road shoulder: offset sideways off the grid line.
    const alongX = rng.chance(0.5);
    const off = rng.range(3.2, 4.6) * rng.sign();
    const jitter = rng.range(-12, 12);
    let x, z, heading;
    if (alongX) { // road runs east-west: shoulder offset is in z
      x = nx + jitter; z = nz + off;
      heading = rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2;
    } else { // road runs north-south: shoulder offset is in x
      x = nx + off; z = nz + jitter;
      heading = rng.chance(0.5) ? 0 : Math.PI;
    }
    if (Math.hypot(x + 200, z + 200) < 12) continue; // keep the start clear
    let crowded = false;
    for (const v of state.vehicles) {
      if (Math.hypot(v.x - x, v.z - z) < 14) { crowded = true; break; }
    }
    if (crowded) continue;
    const type = rng.pick(types);
    const district = districtAt(x, z);
    const locked = district === 'residential' ? rng.chance(0.6) : rng.chance(0.25);
    const color = type === 'taksi' ? VEHICLE_TYPES.taksi.color
      : type === 'sport' ? VEHICLE_TYPES.sport.color
      : rng.pick(palette[type] || palette.sedan);
    spawnVehicle(state, city, type, x, z, heading, { parked: true, locked, color });
    placed++;
  }
  resetHold();
}

export function update(state, input, dt, ctx) {
  const p = state.player;
  if (state.mode !== 'playing') { resetHold(); return; }

  // --- driving ---------------------------------------------------------------
  if (!p.onFoot && p.vehicleId !== null) {
    const v = state.vehicles.find((x) => x.id === p.vehicleId);
    if (!v) {
      p.onFoot = true; p.vehicleId = null; p.speed = 0;
      return;
    }
    if (v.health <= 0) {
      // Wrecked by another slice (rammed while parked, etc.): eject.
      v.driver = null; v.parked = true; v.speed = 0;
      p.onFoot = true; p.vehicleId = null; p.speed = 0;
      state.events.emit('vehicleExited', { name: vehicleName(v), health: 0, wrecked: true });
      return;
    }
    const a = input.actions;
    stepVehicle(state, v, {
      throttle: a.moveY,
      steer: a.moveX,
      brake: false,
      handbrake: a.handbrake,
    }, dt, ctx.city);
    // The player rides the car.
    p.x = v.x; p.z = v.z; p.heading = v.heading; p.speed = v.speed;
    if (v.health <= 0) return; // damageVehicle already ejected the player
    // F while driving = get out.
    if (a.interact) {
      resetHold();
      exitVehicle(state, v);
    }
    return;
  }

  // --- on foot: enter / steal -------------------------------------------------
  const near = nearestVehicle(state, p.x, p.z, 3.5);
  const holdingF = input.keys && input.keys.has('KeyF');
  if (!near) {
    if (holdTargetId !== null) resetHold();
    if (state.uiPrompt) state.uiPrompt = null;
    return;
  }
  if (!near.locked) {
    if (input.actions.interact) {
      resetHold();
      state.uiPrompt = null;
      enterVehicle(state, near);
    }
    return;
  }
  // Locked car: hold F for 1.5 s. A tap (buffered interact edge) is not enough.
  if (holdingF) {
    if (holdTargetId !== near.id) { holdTargetId = near.id; holdT = 0; }
    holdT += dt;
    state.uiPrompt = {
      key: 'F',
      text: 'Mencuri mobil...',
      progress: Math.min(1, holdT / HOLD_SECONDS),
    };
    if (holdT >= HOLD_SECONDS) {
      state.uiPrompt = null;
      resetHold();
      enterVehicle(state, near);
    }
  } else {
    if (holdTargetId !== null) resetHold();
    if (state.uiPrompt) state.uiPrompt = null;
  }
}
