
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
};

/** Pastel tropical palette (thesis §3): coral, sea teal, sun yellow, night navy, neon pink. */
export const PALETTE = {
  tealSea: 0x2ec4b6,
  neonPink: 0xff5da2,
  sand: 0xe8d9b0,
  sidewalk: 0xcfc4ae,
  glassTeal: 0x7fd4d0,
};

export const PLAYER = {
  walkSpeed: 4,
  runSpeed: 7.5,
  jumpSpeed: 8,
  gravity: 22,
  radius: 0.6,
  health: 100,
  armor: 0,
  /** How fast the on-foot heading turns toward the camera yaw, per second. */
  turnRate: 12,
};

/** Police band: max lateral distance of a pursuit unit from the road centerline. */
export const POLICE = {
  roadBand: 3.0,
};

export const MISSIONS = {
  startMoney: 250,
  fineOnCaught: 100,
};
