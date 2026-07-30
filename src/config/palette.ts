/**
 * The single source of truth for colors. Since the game has no textures, all of its
 * cuteness rests on this palette, on baked AO in the mesher and on lighting — so tune
 * the game's look here, not across the code.
 */

/** Pastel colors of world blocks. */
export const BLOCK_COLORS = {
  grassTop: 0x9ee493,
  grassSide: 0x8bd583,
  dirt: 0xc9a57b,
  sand: 0xfbe7a1,
  stone: 0xc6cbd8,
  water: 0x7fd7f0,
  woodSide: 0xb98d62,
  woodTop: 0xd8b48a,
  leaves: 0xb8e986,
  blossom: 0xffb7d5,
  glass: 0xe8f7ff,
  paintedPink: 0xffaec9,
  paintedBlue: 0xa8d8ff,
  paintedYellow: 0xffe59e,
  paintedLavender: 0xd5b8ff,
  paintedMint: 0xa8f0d8,
  bedCap: 0xff8fa3,
  bedStem: 0xfff1dc,
  bedBlanket: 0xa9c8ff,
  flowerPink: 0xff9ec7,
  flowerYellow: 0xffe07a,
  door: 0xd08a5a,
  doorDark: 0xb87244,
  carrot: 0xff9d4d,
  carrotLeaf: 0x86d17a,
  cloud: 0xf4fbff,
  lantern: 0xffcf7d,
} as const

/** Sky, fog and light — day and night. The day cycle interpolates between them. */
export const SKY = {
  day: {
    top: 0x6fc6f5,
    // Keep the horizon slightly saturated, or the distance washes out to white.
    bottom: 0xffd8e8,
    fog: 0xdce9f7,
    sun: 0xfff6e0,
    sunIntensity: 2.1,
    ambient: 0xffe8d6,
    ambientIntensity: 0.55,
    hemiSky: 0xbfe6ff,
    hemiGround: 0xf2d9b5,
    hemiIntensity: 0.6,
  },
  night: {
    top: 0x1b2352,
    bottom: 0x4b3a6b,
    fog: 0x2c3160,
    sun: 0xaab8ff,
    sunIntensity: 0.5,
    ambient: 0x5f6699,
    ambientIntensity: 0.4,
    hemiSky: 0x3a4680,
    hemiGround: 0x2a2440,
    hemiIntensity: 0.45,
  },
} as const

/** Creature colors. */
export const CREATURE_COLORS = {
  smurfBody: 0x6fb7e8,
  smurfSkin: 0x9fd8ff,
  smurfCap: 0xffffff,
  smurfCapElder: 0xff8073,
  smurfPants: 0xffffff,
  playerBody: 0xffc48a,
  playerShirt: 0x7fc9a0,
  playerPants: 0x6a7fc0,
  // Vitrulyan is a ginger rabbit.
  bossFur: 0xeb9a5f,
  bossFurDark: 0xcf7d43,
  bossBelly: 0xffeeda,
  bossEarInner: 0xffb9c8,
  bossTail: 0xfff6ec,
  bossEye: 0xfffdf7,
  bossPupil: 0x2b2340,
  bossMouth: 0xff7d9c,
  bossTooth: 0xfffdf7,
  bossGlow: 0xffe1f4,
  // Night critters.
  lurkerBody: 0x4b4364,
  lurkerBodyDark: 0x3a3450,
  lurkerEye: 0xffd9f2,
  // Daytime wildlife.
  rabbitFur: 0xe3d5c4,
  rabbitEar: 0xffc9d4,
  sheepWool: 0xfdf4ec,
  sheepFace: 0xc9a57b,
  birdBody: 0xffd98a,
  birdBeak: 0xff9d4d,
} as const

/** Effect and UI colors. */
export const FX_COLORS = {
  heart: 0xff7d9c,
  sparkle: 0xfff3b0,
  dust: 0xd8c9a8,
  shockwave: 0xffd0e0,
  playerBlob: 0xa8f0d8,
  bossSpit: 0xc9a0ff,
  hitFlash: 0xffffff,
} as const

/** Brightness multipliers for baked AO: index 0 is the darkest corner, 3 is open. */
export const AO_LEVELS = [0.55, 0.72, 0.87, 1.0] as const

/**
 * Per-direction face tinting. Gives volume even before lighting — without it
 * flat-colored blocks read as flat. Values are deliberately spread apart: with
 * close opposite faces, neighboring blocks merge into a single blob.
 */
export const FACE_TINT = {
  top: 1.0,
  bottom: 0.55,
  north: 0.79,
  south: 0.9,
  east: 0.87,
  west: 0.71,
} as const
