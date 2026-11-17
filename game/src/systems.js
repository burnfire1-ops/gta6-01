// Slice registry: dynamic-loads each gameplay slice if its file exists, so
// slices can land independently without touching main.js. A slice module may
// export init(ctx), update(state, input, dt, ctx) and/or sync(state, dt).
// Load order is the update order: vehicles physics first, then the drivers
// (traffic, police), then wanted, missions, and finally UI/audio/save.
const SLICES = [
  ['vehicles', './core/vehicles.js'],
  ['vehiclesRender', './render/vehicles-render.js'],
  ['traffic', './core/traffic.js'],
  ['pedestrians', './core/pedestrians.js'],
  ['pedestriansRender', './render/pedestrians-render.js'],
  ['wanted', './core/wanted.js'],
  ['police', './core/police.js'],
  ['missions', './core/missions.js'],
  ['missionMarkers', './render/mission-markers.js'],
  ['hud', './ui/hud.js'],
  ['menus', './ui/menus.js'],
  ['audio', './audio/audio.js'],
  ['save', './save/save.js'],
];

export async function loadSystems(ctx) {
  const loaded = new Map();
  for (const [key, path] of SLICES) {
    try {
      // HEAD-check first: a missing file skips silently instead of logging
      // a console 404 from the dynamic import.
      const probe = await fetch(path, { method: 'HEAD' });
      if (!probe.ok) { console.warn(`[systems] ${key} absent, skipped`); continue; }
      const mod = await import(path);
      if (mod.init) await mod.init(ctx);
      loaded.set(key, mod);
      console.log(`[systems] loaded ${key}`);
    } catch (e) {
      console.warn(`[systems] ${key} not loaded (${path}): ${e.message}`);
    }
  }
  return {
    loaded,
    update(state, input, dt) {
      for (const m of loaded.values()) if (m.update) m.update(state, input, dt, ctx);
    },
    sync(state, dt) {
      for (const m of loaded.values()) if (m.sync) m.sync(state, dt);
    },
  };
}
