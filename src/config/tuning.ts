/** Every gameplay number in one place so balance is tuned without a code hunt. */

export const WORLD = {
  /** A chunk is 16×64×16 voxels. */
  chunkSizeX: 16,
  chunkSizeY: 64,
  chunkSizeZ: 16,
  /** Chunk streaming radius around the player. Matched to the fog density in scene.ts:
   * fog must hide the edge of the loaded area, or the world visibly ends. */
  viewRadius: 6,
  /** Smaller touch-device radius keeps generation and mesh count reasonable on phones. */
  mobileViewRadius: 4,
  seaLevel: 26,
  /** At most this many mesh rebuilds per frame — more causes hitches while building. */
  remeshPerFrame: 2,
  seed: 1337,
  /** Water simulation tick period, seconds (5 Hz). */
  waterTick: 0.2,
  /** At most this many water cells per tick — water flows calmly, not eating the frame. */
  waterBudget: 48,
} as const

export const PLAYER = {
  width: 0.6,
  height: 1.8,
  /** Eyes sit slightly below the top of the head. */
  eyeHeight: 1.62,
  walkSpeed: 4.6,
  runSpeed: 7.0,
  jumpSpeed: 8.4,
  gravity: 26.0,
  /** Slower in water, with upward buoyancy. */
  swimSpeed: 3.0,
  swimBuoyancy: 6.0,
  maxHealth: 10,
  /** Invulnerability after taking damage, seconds. */
  invulnerable: 0.5,
  /** Regen: delay after the last hit and the per-heart recovery interval. */
  regenDelay: 6.0,
  regenInterval: 3.0,
  reach: 5.0,
  /** Breaking is much faster than hitting: held LMB should chew through a wall. */
  blockBreakCooldown: 0.2,
  meleeRange: 3.2,
  meleeDamage: 2,
  meleeCooldown: 0.45,
  throwCooldown: 0.6,
  throwSpeed: 22.0,
  throwDamage: 3,
} as const

export const CAMERA = {
  fov: 72,
  near: 0.1,
  far: 400,
  /** Third-person camera distance and its minimum pull-in at a wall. */
  thirdPersonDistance: 5.0,
  thirdPersonHeight: 0.6,
  thirdPersonMinDistance: 1.2,
  mouseSensitivity: 0.0022,
  touchSensitivity: 0.004,
} as const

export const VILLAGE = {
  /** Houses required for the village to count as complete. */
  housesRequired: 5,
  /** Flood-fill budget: exceeding it means the room "leaks" — not a house. */
  floodFillBudget: 300,
  /** Minimum interior room volume in voxel cells. */
  minRoomVolume: 8,
  smurfSpeed: 1.9,
  /** Smurf wander radius around a point of interest. */
  wanderRadius: 7,
  /** Smurfs walk in from this distance — "from the horizon", not out of thin air. */
  arriveDistance: 48,
  /** "Menagerie" quest: how many animals to bring. */
  animalsRequired: 3,
  /** Animals follow a held carrot within this radius. */
  animalFollowRadius: 8,
  /** An animal counts as delivered within this radius of the village center. */
  deliverRadius: 14,
  /** "Pond" quest: this many water cells above sea level near the village. */
  pondCellsRequired: 9,
  pondScanRadius: 22,
  /** "Clouds" quest: how many charges to gather from night enemies. */
  cloudsRequired: 10,
} as const

export const NIGHT = {
  /** Concurrent enemy cap by quest stage: gentle before the night quest. */
  maxEnemiesEarly: 2,
  maxEnemiesQuest: 4,
  maxEnemiesLate: 6,
  spawnInterval: 5.0,
  spawnMin: 22,
  spawnMax: 38,
  lurkerHealth: 4,
  lurkerSpeed: 2.7,
  lurkerDamage: 1,
  lurkerTouchCooldown: 1.0,
  /** A smurf panics and runs home when an enemy is closer than this. */
  scareRadius: 9,
  cloudDropMin: 1,
  cloudDropMax: 2,
} as const

export const BOSS = {
  maxHealth: 60,
  /** HP thresholds (fractions) where phases change. */
  phase2At: 0.66,
  phase3At: 0.33,
  scale: 3.2,
  chaseSpeed: 3.4,
  enrageSpeedBonus: 1.6,
  /** Telegraphs — the fight is unfair without them. Rabbit moves: leap, dash, burrow. */
  leapTelegraph: 0.7,
  leapSpeed: 14.0,
  dashTelegraph: 0.45,
  dashSpeed: 16.0,
  dashDuration: 0.55,
  dashDamage: 2,
  burrowTelegraph: 0.5,
  /** Time spent underground — the tremor travels toward the player. */
  burrowTravel: 1.1,
  /** Surfaces no farther than this from the player. */
  emergeRadius: 4.0,
  emergeShockRadius: 4.5,
  emergeDamage: 1,
  slamDamage: 3,
  slamRadius: 9.0,
  shockwaveSpeed: 11.0,
  attackCooldown: 2.2,
  spawnDistance: 18,
} as const

export const DAY = {
  /** Full day length in seconds. */
  lengthSeconds: 240,
  /** Fraction of the day at which night begins. */
  nightStart: 0.55,
} as const
