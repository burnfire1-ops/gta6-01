// Renderer slice: WebGL renderer, scene, third-person camera and the day/night
// light rig for Teluk Cahaya (three.js r187). One sun directional light plus a
// hemisphere fill; ACES tone mapping, PCF shadows, shadow frustum tracks the
// player. A dim blue moon light takes over after dark.
//
// Sky: a gradient dome (driven by clock.js skyColors, tinted by the weather
// state machine) replaces the old flat background colour; scene.background is
// kept as a fallback behind it. Fog range/colour and the sun/hemi intensity
// follow the weather. Rain is a single THREE.Points cloud (~800 drops) in a
// box that follows the player, visible only while it rains.
import * as THREE from 'three';
import { skyColors, sunState, nightFactor } from '../core/clock.js';
import { createWeather, updateWeather } from '../core/weather.js';

const RAIN_COUNT = 800;
const RAIN_BOX = 60; // drops live in a 60 x ~40 x 60 box around the player

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

  // Gradient sky dome: horizon colour at the rim, top colour overhead.
  // Follows the player so the rim never comes into view; radius 900 stays
  // inside the camera far plane (1200). Background colour behind it is only
  // a fallback for the brief moment before the first frame renders.
  const skyUniforms = {
    topColor: { value: new THREE.Color(0x8fd3e8) },
    horizonColor: { value: new THREE.Color(0xffe9c9) },
  };
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vDir;
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        void main() {
          float h = clamp(vDir.y * 1.6 + 0.12, 0.0, 1.0);
          vec3 c = mix(horizonColor, topColor, pow(h, 0.8));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  skyDome.frustumCulled = false;
  skyDome.renderOrder = -1;
  scene.add(skyDome);

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

  // Weather state machine (pure core module); deterministic seed so the
  // cover shot is reproducible. dt is derived from state.time, since
  // update() is called with state only.
  const weather = createWeather(20261118);
  let prevTime = -1;

  // Rain: one Points object, one material, preallocated buffers.
  // Positions recycle inside the player-centred box; nothing allocates
  // per frame (only needsUpdate is flagged).
  const rainPos = new Float32Array(RAIN_COUNT * 3);
  const rainSpeed = new Float32Array(RAIN_COUNT);
  for (let i = 0; i < RAIN_COUNT; i++) {
    rainPos[i * 3] = (Math.random() - 0.5) * RAIN_BOX;
    rainPos[i * 3 + 1] = Math.random() * 40;
    rainPos[i * 3 + 2] = (Math.random() - 0.5) * RAIN_BOX;
    rainSpeed[i] = 18 + Math.random() * 12; // 18-30 units/s fall speed
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.PointsMaterial({
    color: 0xaebfd0, size: 0.18, transparent: true, opacity: 0,
    sizeAttenuation: true, depthWrite: false,
  });
  const rain = new THREE.Points(rainGeo, rainMat);
  rain.frustumCulled = false;
  rain.visible = false;
  scene.add(rain);

  // Scratch colours — reused every frame, never allocated in update().
  const _top = new THREE.Color();
  const _horizon = new THREE.Color();
  const _grey = new THREE.Color();
  const _fog = new THREE.Color();

  // Desaturate a colour in place toward its own luminance grey.
  function desat(color, amount) {
    if (amount <= 0) return color;
    const l = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
    _grey.setRGB(l, l, l);
    return color.lerp(_grey, amount);
  }

  function updateRain(dt, px, pz, amount) {
    rain.visible = amount > 0.02;
    if (!rain.visible) return;
    rainMat.opacity = 0.55 * amount;
    const half = RAIN_BOX / 2;
    for (let i = 0; i < RAIN_COUNT; i++) {
      const i3 = i * 3;
      let y = rainPos[i3 + 1] - rainSpeed[i] * dt;
      if (y < 0) {
        // Recycle to the top of the box, re-scattered around the player.
        y = 28 + Math.random() * 12;
        rainPos[i3] = px + (Math.random() - 0.5) * RAIN_BOX;
        rainPos[i3 + 2] = pz + (Math.random() - 0.5) * RAIN_BOX;
      }
      // Wrap x/z so the box follows the player instead of being left behind.
      let dx = rainPos[i3] - px;
      if (dx > half) rainPos[i3] -= RAIN_BOX;
      else if (dx < -half) rainPos[i3] += RAIN_BOX;
      let dz = rainPos[i3 + 2] - pz;
      if (dz > half) rainPos[i3 + 2] -= RAIN_BOX;
      else if (dz < -half) rainPos[i3 + 2] += RAIN_BOX;
      rainPos[i3 + 1] = y;
    }
    rainGeo.attributes.position.needsUpdate = true;
  }

  function update(state) {
    const dt = prevTime < 0 ? 0.016 : Math.min(Math.max(state.time - prevTime, 0), 0.1);
    prevTime = state.time;

    const eff = updateWeather(weather, dt);
    const sky = skyColors(state.clock);
    const sunS = sunState(state.clock);
    const night = nightFactor(state.clock);

    // Sky dome colours: day/night base from clock.js, desaturated by weather.
    _top.setRGB(sky.top[0], sky.top[1], sky.top[2]);
    _horizon.setRGB(sky.horizon[0], sky.horizon[1], sky.horizon[2]);
    desat(_top, eff.desat);
    desat(_horizon, eff.desat);
    skyUniforms.topColor.value.copy(_top);
    skyUniforms.horizonColor.value.copy(_horizon);
    skyDome.position.set(state.player.x, 0, state.player.z);
    // Fallback background tracks the horizon so a missing dome still looks right.
    scene.background.setRGB(_horizon.r, _horizon.g, _horizon.b);

    // Fog follows the horizon colour (plus the weather fog tint) and the
    // weather fog range: clear 220/720, rain 150/500, fog 120/350.
    _fog.copy(_horizon);
    if (eff.fogTintAmt > 0) {
      _grey.setRGB(eff.fogTint[0], eff.fogTint[1], eff.fogTint[2]);
      _fog.lerp(_grey, eff.fogTintAmt);
    }
    scene.fog.color.copy(_fog);
    scene.fog.near = eff.fogNear;
    scene.fog.far = eff.fogFar;

    hemi.intensity = (1.0 - night * 0.45) * eff.hemi;
    hemi.color.setRGB(
      sky.top[0] * 0.9 + 0.1, sky.top[1] * 0.9 + 0.1, sky.top[2] * 0.9 + 0.1);
    desat(hemi.color, eff.desat);
    sun.position.set(
      state.player.x + sunS.dir[0] * 160,
      sunS.dir[1] * 160,
      state.player.z + sunS.dir[2] * 160);
    sun.target.position.set(state.player.x, 0, state.player.z);
    sun.intensity = sunS.intensity * eff.sun;
    sun.color.setRGB(sunS.color[0], sunS.color[1], sunS.color[2]);
    desat(sun.color, eff.desat);
    sun.castShadow = sunS.isDay;
    moon.intensity = sunS.isDay ? 0 : 0.45 * eff.hemi;

    updateRain(dt, state.player.x, state.player.z, eff.rain);
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, sun, hemi, moon, update, resize, weather };
}
