// Renderer slice: WebGL renderer, scene, third-person camera and the day/night
// light rig for Teluk Cahaya (three.js r187). One sun directional light plus a
// hemisphere fill; ACES tone mapping, PCF shadows, shadow frustum tracks the
// player. A dim blue moon light takes over after dark.
import * as THREE from 'three';
import { skyColors, sunState, nightFactor } from '../core/clock.js';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fd3e8);
  scene.fog = new THREE.Fog(0xffe9c9, 220, 720);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1200);
  camera.position.set(-210, 12, -210);

  // Sky/ground fill light; its colour tracks the sky so dawn/dusk tint the city.
  const hemi = new THREE.HemisphereLight(0xbbddff, 0x8a6a55, 1.0);
  scene.add(hemi);

  // Key sun light. The shadow camera is a 180-unit box centred on the player
  // each frame (repositioned in update()), so shadows stay crisp nearby.
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.near = 1; sc.far = 400; sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun);
  scene.add(sun.target);

  // Night fill: only active once the sun has set.
  const moon = new THREE.DirectionalLight(0xa8b8ff, 0.0);
  moon.position.set(-40, 90, -30);
  scene.add(moon);

  function update(state) {
    const sky = skyColors(state.clock);
    const sunS = sunState(state.clock);
    const night = nightFactor(state.clock);
    scene.background.setRGB(sky.top[0], sky.top[1], sky.top[2]);
    scene.fog.color.setRGB(sky.horizon[0], sky.horizon[1], sky.horizon[2]);
    hemi.intensity = 1.0 - night * 0.45;
    hemi.color.setRGB(
      sky.top[0] * 0.9 + 0.1, sky.top[1] * 0.9 + 0.1, sky.top[2] * 0.9 + 0.1);
    sun.position.set(
      state.player.x + sunS.dir[0] * 160,
      sunS.dir[1] * 160,
      state.player.z + sunS.dir[2] * 160);
    sun.target.position.set(state.player.x, 0, state.player.z);
    sun.intensity = sunS.intensity;
    sun.color.setRGB(sunS.color[0], sunS.color[1], sunS.color[2]);
    sun.castShadow = sunS.isDay;
    moon.intensity = sunS.isDay ? 0 : 0.45;
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, sun, hemi, moon, update, resize };
}
