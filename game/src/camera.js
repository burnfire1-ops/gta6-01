// Third-person chase camera: mouse orbits yaw/pitch on a pivot, the camera
// follows with frame-rate-independent exponential smoothing (1 - exp(-rate*dt)),
// a simple spring arm pulls it in when a building would block it, driving mode
// sits farther/lower, and the FOV widens smoothly with speed (55 -> 70).

import * as THREE from 'three';
import { CITY } from './config.js';

const PITCH_MIN = -0.12; // nearly level
const PITCH_MAX = 0.85; // looking down steeply
const FOOT_DIST = 7;
const FOOT_HEIGHT = 3;
const DRIVE_DIST = 10.5;
const DRIVE_HEIGHT = 3.6;

export function createChaseCamera(camera) {
  let yaw = 0;
  let pitch = 0.32;
  let fov = 55;
  let first = true;
  const smoothed = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();

  function update(dt, target, mode, mouseDX, mouseDY) {
    yaw -= (mouseDX || 0) * 0.0028;
    pitch = THREE.MathUtils.clamp(pitch + (mouseDY || 0) * 0.0022, PITCH_MIN, PITCH_MAX);
    const driving = mode === 'drive';
    const dist = driving ? DRIVE_DIST : FOOT_DIST;
    const height = driving ? DRIVE_HEIGHT : FOOT_HEIGHT;
    const rate = driving ? 6 : 8;

    // Orbit offset behind the target, from yaw/pitch.
    const cosP = Math.cos(pitch);
    const ox = -Math.sin(yaw) * cosP * dist;
    const oz = -Math.cos(yaw) * cosP * dist;
    const oy = height + Math.sin(pitch) * dist;
    desired.set(target.pos.x + ox, oy, target.pos.z + oz);

    // Spring arm (manual): if a building collider would swallow the camera,
    // pull it toward the target until it clears the collider + margin.
    const colliders = target.colliders || [];
    for (const c of colliders) {
      const dx = desired.x - c.x;
      const dz = desired.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + 1.2;
      if (d < min && desired.y < 30) {
        const pull = min - d;
        const dirX = d > 0.001 ? dx / d : 1;
        const dirZ = d > 0.001 ? dz / d : 0;
        desired.x += dirX * pull;
        desired.z += dirZ * pull;
        desired.y = Math.max(desired.y, 6);
      }
    }
    // Never leave the city bounds or go under the ground.
    desired.x = THREE.MathUtils.clamp(desired.x, -CITY.half - 30, CITY.half + 30);
    desired.z = THREE.MathUtils.clamp(desired.z, -CITY.half - 30, CITY.half + 30);
    desired.y = Math.max(desired.y, 1.2);

    if (first) {
      smoothed.copy(desired);
      first = false;
    } else {
      const t = 1 - Math.exp(-rate * dt);
      smoothed.lerp(desired, t);
    }
    camera.position.copy(smoothed);

    // Look ahead of the target along its heading, with a small speed lead.
    const speed = target.speed || 0;
    const lead = THREE.MathUtils.clamp(speed * 0.35, 0, 6);
    lookTarget.set(
      target.pos.x + Math.sin(target.heading || 0) * lead,
      1.6,
      target.pos.z + Math.cos(target.heading || 0) * lead,
    );
    camera.lookAt(lookTarget);

    // FOV widens smoothly with speed while driving.
    const targetFov = driving ? 55 + Math.min(15, (speed / 38) * 15) : 55;
    fov += (targetFov - fov) * Math.min(1, dt * 4);
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  function snapTo(target, mode) {
    const driving = mode === 'drive';
    const dist = driving ? DRIVE_DIST : FOOT_DIST;
    yaw = target.heading ?? 0;
    camera.position.set(
      target.pos.x - Math.sin(yaw) * dist,
      (driving ? DRIVE_HEIGHT : FOOT_HEIGHT) + 1,
      target.pos.z - Math.cos(yaw) * dist,
    );
    smoothed.copy(camera.position);
    first = false;
  }

  return {
    update,
    snapTo,
    get yaw() {
      return yaw;
    },
    set yaw(v) {
      yaw = v;
    },
    get pitch() {
      return pitch;
    },
  };
}
