// Central game state (plain data) + a tiny event bus. HUD, menus and audio
// subscribe to events; they never poll sim state every frame.
export function createEventBus() {
  const map = new Map();
  return {
    on(name, fn) {
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(fn);
    },
    off(name, fn) {
      const arr = map.get(name);
      if (arr) { const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); }
    },
    emit(name, data) {
      const arr = map.get(name);
      if (arr) for (const fn of arr.slice()) fn(data);
    },
  };
}

export function createState(seed) {
  return {
    seed,
    time: 0,            // seconds since session start (drives the city clock)
    clock: 0.08,        // city clock 0..1 (starts ~08:00 morning)
    money: 150,
    health: 100,
    armor: 0,
    player: {
      x: -200, z: -200, y: 0, vy: 0, grounded: true,
      heading: Math.PI * 0.75, speed: 0, onFoot: true, vehicleId: null,
      punchT: 0, punchKind: 0, ammo: 24, hasPistol: false,
    },
    vehicles: [],       // {id,type,x,z,heading,speed,steer,color,health,driver,parked,locked,stolen,wantedMarked}
    traffic: [],        // {id, vehicleId, route, nodeIdx, state, waitT}
    peds: [],           // {id,x,z,heading,state,speed,isWitness,reportT,panicT}
    police: [],         // {id, vehicleId, state, lastKnown, perceptionT, searchT, stuckT}
    wanted: { stars: 0, hideT: 0, blinkT: 0, searchCircle: null, captureT: 0 },
    mission: { id: 0, objectiveIdx: 0, state: 'none', timer: 0, data: {} },
    flags: {
      districtsUnlocked: 1, // 1 = Boulevard only; missions unlock more
      packagesFound: 0, packagesTotal: 12,
      vehiclesOwned: [], storyDone: false, missionsDone: [],
    },
    settings: { music: 0.7, sfx: 0.8, ambience: 0.6, ui: 0.8, sensitivity: 1, invertY: false, shadows: 1 },
    mode: 'title',      // title | playing | paused | busted | wasted
    events: createEventBus(),
    debug: { fps: 0, drawCalls: 0 },
  };
}
