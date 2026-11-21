
import * as THREE from 'three';
import { DAY_LENGTH_SECONDS } from './config.js';

const SKY_KEYS = [
  [0, 0x0d1530],
  [5, 0x1a2340],
  [6.5, 0xffb37a],
  [9, 0xaee3f5],
  [16, 0xffe3a3],
  [17.5, 0xff9a5a],
  [19, 0x4a4a7a],
  [21, 0x101a33],
  [24, 0x0d1530],
];

function skyColorAt(hour) {
  let i = 0;
  while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1][0] <= hour) i += 1;
  const [h0, c0] = SKY_KEYS[i];
  const [h1, c1] = SKY_KEYS[i + 1];
  const t = THREE.MathUtils.clamp((hour - h0) / (h1 - h0), 0, 1);
  return new THREE.Color(c0).lerp(new THREE.Color(c1), t);
}

function nightFactorAt(hour) { if (hour >= 19.5 || hour < 5) return 1; if (hour >= 8 && hour <= 16.5) return 0; if (hour > 16.5 && hour < 19.5) return (hour - 16.5) / 3; return (8 - hour) / 3; }

export function createDayNight(scene) {
  scene.background = new THREE.Color(0xaee3f5);

  const sun = new THREE.DirectionalLight(0xffe9c4, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -90;
  sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90;
  sun.shadow.camera.bottom = -90;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 500;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 0.75);
  scene.add(hemi);

  const glowMats = new Set();
  const beams = [];
  scene.traverse((obj) => {
    if (obj.material && obj.material.userData && obj.material.userData.glow) {
      glowMats.add(obj.material);
    }
    if (obj.userData && obj.userData.spinBeam) beams.push(obj);
  });

  let timeHours = 17.5; // CP24 M1: golden hour default

  function apply(hour) {
    const sky = skyColorAt(hour);
    scene.background.copy(sky);
    const dayFrac = THREE.MathUtils.clamp((hour - 6) / 12, 0, 1);
    const el = Math.sin(dayFrac * Math.PI);
    const az = Math.PI * (1 - dayFrac);
    const night = nightFactorAt(hour);
    if (night >= 1) {
      sun.intensity = 0.35;
      sun.color.setHex(0x8fa8d8);
      sun.position.set(-60, 140, -80);
    } else {
      const warm = hour < 10 || hour > 16 ? 0xffd9a0 : 0xfff2d8;
      sun.intensity = 2.5 * (0.35 + 0.65 * Math.max(el, 0.12));
      sun.color.setHex(warm);
      sun.position.set(Math.cos(az) * 180, 30 + el * 170, 60 + Math.sin(az) * 40);
    }
    sun.target.position.set(0, 0, 0);
    hemi.intensity = 0.75 * (1 - 0.6 * night);
    for (const mat of glowMats) mat.emissiveIntensity = night * 1.6;
    for (const beam of beams) beam.visible = night > 0.15;
  }

  apply(timeHours);

  return {
    get timeHours() {
      return timeHours;
    },
    setTime(h) {
      timeHours = ((h % 24) + 24) % 24;
      apply(timeHours);
    },
    isNight() {
      return timeHours < 6 || timeHours >= 18;
    },
    update(dt) {
      timeHours = (timeHours + (dt * 24) / DAY_LENGTH_SECONDS) % 24;
      apply(timeHours);
      for (const beam of beams) {
        if (beam.visible) beam.rotation.y += dt * 0.9;
      }
    },
  };
}
