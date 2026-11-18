// Raka, the player: a
// with procedural sinusoi
// runs with Shift, jumps
// city and is pushed out
// and syncs it to the

import * as THREE from 'three';
import { CITY, PLAYER } from './config.js';

function bodyPart(w, h, d, color, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

export function createPlayer(scene, graph, rng) {
  const start = graph.projectToRoad(0, 40);
  const group = new THREE.Group();
  group.name = 'player-raka';

  const shirt = 0xffb703; // j
  const skin = 0xc98d64;
  const pants = 0x2c3444;

  const body = bodyPart(0.55, 0.7, 0.3, shirt, 0, 1.15, 0);
  group.add(body);

  const head = bodyPart(0.4, 0.4, 0.4, skin, 0, 1.7, 0);
  group.add(head);
  const cap = bodyPart(0.46, 0.08, 0.46, pants, 0, 1.94, 0);
  group.add(cap);

  const armL = bodyPart(0.16, 0.65, 0.16, skin, -0.36, 1.15, 0);
  const armR = bodyPart(0.16, 0.65, 0.16, skin, 0.36, 1.15, 0);
  armL.geometry.translate(0, -0.28, 0);
  armR.geometry.translate(0, -0.28, 0);
  armL.position.y = 1.45;
  armR.position.y = 1.45;
  group.add(armL);
  group.add(armR);

  const legL = bodyPart(0.22, 0.8, 0.22, pants, -0.2, 0.42, 0);
  const legR = bodyPart(0.22, 0.8, 0.22, pants, 0.2, 0.42, 0);
  legL.geometry.translate(0, -0.3, 0);
  legR.geometry.translate(0, -0.3, 0);
  legL.position.y = 0.8;
  legR.position.y = 0.8;
  group.add(legL);
  group.add(legR);

  scene.add(group);

  const state = {
    pos: { x: start.x, z: start.z },
    heading: 0,
    speed: 0,
    health: PLAYER.health,
    armor: PLAYER.armor,
    onFoot: true,
    currentCar: null,
    mesh: group,
    _y: 0,
    _vy: 0,
    _walkPhase: 0,
    _attackT: 0,
    _grounded: true,
  };

  function resolveColliders(colliders) {
    if (!colliders) return;
    for (const c of colliders) {
      const dx = state.pos.x - c.x;
      const dz = state.pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + PLAYER.radius;
      if (d < min && d > 0.0001) {
        state.pos.x = c.x + (dx / d) * min;
        state.pos.z = c.z + (dz / d) * min;
      } else if (d <= 0.0001) {
        state.pos.x = c.x + min;
      }
    }
  }

  function enterCar(car) {
    if (!car || !state.onFoot) return false;
    state.onFoot = false;
    state.currentCar = car;
    state.speed = 0;
    group.visible = false;
    if (car) {
      car.occupied = true;
      car.driver = 'player';
    }
    return true;
  }

  function exitCar() {
    const car = state.currentCar;
    if (!car || state.onFoot) return false;
    const side = rng() < 0.5 ? 1 : -1;
    const cx = Math.cos(car.heading ?? 0);
    const sz = Math.sin(car.heading ?? 0);
    // Step out to the car
    state.pos.x = (car.pos?.x ?? car.x ?? 0) + -sz * 2.2 * side;
    state.pos.z = (car.pos?.z ?? car.z ?? 0) + cx * 2.2 * side;
    state.heading = car.heading ?? 0;
    state.onFoot = true;
    state.currentCar = null;
    state.speed = 0;
    group.visible = true;
    car.occupied = false;
    car.driver = null;
    return true;
  }

  function update(dt, input, ctx) {
    ctx = ctx || {};
    if (!state.onFoot) {
      // Driving: the rig
      const car = state.currentCar;
      if (car) {
        const cx = car.pos?.x ?? car.x ?? state.pos.x;
        const cz = car.pos?.z ?? car.z ?? state.pos.z;
        state.pos.x = cx;
        state.pos.z = cz;
        state.heading = car.heading ?? state.heading;
        state.speed = Math.abs(car.speed ?? 0);
      }
      group.position.set(state.pos.x, 0, state.pos.z);
      group.rotation.y = state.heading;
      return;
    }

    const yaw = ctx.cameraYaw ?? 0;
    // Camera-relative mov
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = -Math.cos(yaw);
    const rz = Math.sin(yaw);
    const f = input.axes.forward;
    const s = input.axes.strafe;
    let mx = fx * f + rx * s;
    let mz = fz * f + rz * s;
    const mLen = Math.hypot(mx, mz);
    const moving = mLen > 0.01;
    if (moving) {
      mx /= mLen;
      mz /= mLen;
      const targetSpeed = input.sprint ? PLAYER.runSpeed : PLAYER.walkSpeed;
      state.speed += (targetSpeed - state.speed) * Math.min(1, dt * 10);
      state.pos.x += mx * state.speed * dt;
      state.pos.z += mz * state.speed * dt;
      // Face the directio
      const targetHeading = Math.atan2(mx, mz);
      let dh = targetHeading - state.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      state.heading += THREE.MathUtils.clamp(dh, -PLAYER.turnRate * dt, PLAYER.turnRate * dt);
    } else {
      state.speed += (0 - state.speed) * Math.min(1, dt * 10);
    }

    // Jump / gravity.
    const actions = input._actions ?? 0;
    if ((actions & 8) && state._grounded) {
      state._vy = PLAYER.jumpSpeed;
      state._grounded = false;
    }
    if (!state._grounded) {
      state._vy -= PLAYER.gravity * dt;
      state._y += state._vy * dt;
      if (state._y <= 0) {
        state._y = 0;
        state._vy = 0;
        state._grounded = true;
      }
    }

    // Stay inside the cit
    const lim = CITY.half - 2;
    state.pos.x = THREE.MathUtils.clamp(state.pos.x, -lim, lim);
    state.pos.z = THREE.MathUtils.clamp(state.pos.z, -lim, lim);
    resolveColliders(ctx.city?.colliders);

    // Procedural walk cyc
    state._walkPhase += dt * state.speed * 2.2;
    const swing = moving ? Math.sin(state._walkPhase) * 0.55 : 0;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    armL.rotation.x = -swing * 0.8;
    armR.rotation.x = swing * 0.8;
    if (state._attackT > 0) {
      state._attackT -= dt;
      armR.rotation.x = -1.6 * Math.max(0, state._attackT / 0.25);
    }
    // Idle breathing.
    body.position.y = 1.15 + (moving ? Math.abs(Math.sin(state._walkPhase)) * 0.05 : Math.sin(performance.now() * 0.002) * 0.015);

    group.position.set(state.pos.x, state._y, state.pos.z);
    group.rotation.y = state.heading;
  }

  function attack() {
    state._attackT = 0.25;
  }

  // Return the live state
  // camera and the HUD
  return Object.assign(state, {
    mesh: group,
    update,
    enterCar,
    exitCar,
    attack,
    takeDamage(amount) {
      let left = amount;
      if (state.armor > 0) {
        const absorbed = Math.min(state.armor, left);
        state.armor -= absorbed;
        left -= absorbed;
      }
      state.health = Math.max(0, state.health - left);
      return state.health;
    },
  });
}
