// Every tuning number and colour in one place. Teluk Cahaya is a ~440x440 coastal
// city on a road grid (roads every 40 units) with four districts. No rule below
// depends on the screen size.

export const SEED = 1337;

/** One in-game day lasts 12 real minutes. */
export const DAY_LENGTH_SECONDS = 720;

export const CITY = {
  half: 220,
  size: 440,
  roadSpacing: 40,
  roadHalfWidth: 3.5,
  /** West edge of the land; the sea starts here. */
  seaEdgeX: -220,
  /** Lighthouse island at the end of the harbour bridge. */
  lighthouse: { x: -300, z: 120 },
  bridge: { x: -260, z: 120 },
};

export const DISTRICTS = {
  artdeco: { name: 'Boulevard Art-Deco', color: 0xff9a7a },
  neon: { name: 'Distrik Neon', color: 0xff5da2 },
  port: { name: 'Pelabuhan & Industri', color: 0x8a7f72 },
  residential: { name: 'Bukit Residensial', color: 0x9fc98a },
};

/** Pastel tropical palette (thesis §3): coral, sea teal, sun yellow, night navy, neon pink. */
export const PALETTE = {
  coral: 0xff9a7a,
  coralDeep: 0xe86a5a,
  tealSea: 0x2ec4b6,
  tealDeep: 0x0e7c86,
  sunYellow: 0xffd166,
  nightNavy: 0x101a33,
  neonPink: 0xff5da2,
  neonCyan: 0x4de3ff,
  sand: 0xe8d9b0,
  grass: 0xa8d08d,
  asphalt: 0x333a4a,
  sidewalk: 0xcfc4ae,
  facadeCream: 0xffe8c9,
  glassTeal: 0x7fd4d0,
  concrete: 0x9a938a,
  hudPanel: '#101a33',
  hudText: '#f4f1e6',
  hudMuted: '#9fb3c8',
};

export const PLAYER = {
  walkSpeed: 4,
  runSpeed: 7.5,
  jumpSpeed: 8,
  gravity: 22,
  radius: 0.6,
  health: 100,
  maxHealth: 100,
  armor: 0,
  maxArmor: 100,
  /** How fast the on-foot heading turns toward the camera yaw, per second. */
  turnRate: 12,
};

export const VEHICLE = {
  /** Arcade car tuning: accel, braking, top speed per type (units/s). */
  types: {
    sedan: { accel: 14, brake: 26, topSpeed: 26, reverseSpeed: 9, color: 0xe8e4d8 },
    taxi: { accel: 15, brake: 26, topSpeed: 27, reverseSpeed: 9, color: 0xffd166 },
    van: { accel: 10, brake: 22, topSpeed: 20, reverseSpeed: 8, color: 0x9a938a },
    pickup: { accel: 13, brake: 24, topSpeed: 24, reverseSpeed: 9, color: 0xc96f4a },
    sport: { accel: 22, brake: 30, topSpeed: 38, reverseSpeed: 10, color: 0x2ec4b6 },
    patrol: { accel: 20, brake: 30, topSpeed: 36, reverseSpeed: 10, color: 0x1c2733 },
  },
  steerRate: 1.9,
  /** Police top speed stays just below the player sport car so escape is always possible. */
  policeTopSpeed: 36,
  playerTopSpeed: 38,
  handbrakeGrip: 0.35,
  damagePerHardHit: 8,
};

/** Police band: how far from the player a pursuit unit may spawn / despawn. */
export const POLICE = {
  roadBand: 3.0,
  spawnMinDist: 45,
  spawnMaxDist: 90,
  despawnDist: 140,
  /** Units per wanted level, index = wanted stars. */
  unitsPerWanted: [0, 1, 2, 3, 4, 5],
  /** Seconds out of sight before the escape timer starts, per wanted level. */
  escapeDelay: [0, 6, 9, 12, 15, 18],
  catchRadius: 3.5,
};

export const MISSIONS = {
  total: 8,
  startMoney: 250,
  fineOnCaught: 100,
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Save slots live in localStorage under these keys (see save.js). */
export const SAVE_KEY = 'teluk-cahaya.save';
