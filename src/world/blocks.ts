import { BLOCK_COLORS } from '../config/palette'

/**
 * Block registry. An id is the value stored in the chunk's Uint8Array, so existing ids
 * must never change (saves would break); new ones are appended strictly at the end.
 */
export const enum Block {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Sand = 3,
  Stone = 4,
  /** Full water level: sea, lakes and bucket water. */
  Water = 5,
  Wood = 6,
  Leaves = 7,
  Blossom = 8,
  Glass = 9,
  Pink = 10,
  Blue = 11,
  Yellow = 12,
  Lavender = 13,
  Mint = 14,
  /** Legacy single-cell bed. Kept for old saves. */
  Bed = 15,
  /** Decaying levels of spread water. */
  Water3 = 16,
  Water2 = 17,
  Water1 = 18,
  /** A door occupies two vertical cells with a single id. */
  DoorClosed = 19,
  DoorOpen = 20,
  /** Two-block bed: headboard and blanket. */
  BedHead = 21,
  BedFoot = 22,
  /** Carrot item: animal bait; cannot be placed in the world. */
  Carrot = 23,
  /** Carrot patch in the world — the source of carrots. */
  CarrotPlant = 24,
  /** Cloud — ammo for the throwable. Exists only in the inventory. */
  Cloud = 25,
  Lantern = 26,
}

export interface BlockDef {
  readonly id: Block
  readonly name: string
  /** Stops creatures (physics). */
  readonly solid: boolean
  /** Fully occludes neighboring faces during meshing. */
  readonly opaque: boolean
  /**
   * Whether it counts as a wall for the room-seal check. Defaults to solid;
   * doors are the key exception: an open door is passable yet still seals the room.
   */
  readonly seals?: boolean
  readonly color: number
  readonly topColor?: number
  readonly bottomColor?: number
  readonly transparent?: boolean
  readonly opacity?: number
  /** Block height within its cell for the mesher (water derives its own from level). */
  readonly height?: number
  /** Brightness multiplier: >1 crosses the bloom threshold and the block glows. */
  readonly glow?: number
  readonly placeable: boolean
  /** What drops into the inventory on break instead of the block itself. */
  readonly drops?: { readonly block: Block; readonly count: number }
  readonly variation?: number
  /** For the resources panel: what it is and how to get it. */
  readonly description?: string
  readonly source?: string
}

const DEFS: readonly BlockDef[] = [
  { id: Block.Air, name: 'воздух', solid: false, opaque: false, color: 0x000000, placeable: false },
  {
    id: Block.Grass,
    name: 'трава',
    solid: true,
    opaque: true,
    color: BLOCK_COLORS.grassSide,
    topColor: BLOCK_COLORS.grassTop,
    bottomColor: BLOCK_COLORS.dirt,
    variation: 0.07,
    placeable: true,
    description: 'Мягкий зелёный блок, из которого сделаны холмы.',
    source: 'Ломается киркой где угодно.',
  },
  { id: Block.Dirt, name: 'земля', solid: true, opaque: true, color: BLOCK_COLORS.dirt, variation: 0.06, placeable: true },
  { id: Block.Sand, name: 'песок', solid: true, opaque: true, color: BLOCK_COLORS.sand, variation: 0.05, placeable: true },
  {
    id: Block.Stone,
    name: 'камень',
    solid: true,
    opaque: true,
    color: BLOCK_COLORS.stone,
    variation: 0.08,
    placeable: true,
    description: 'Прочный блок для фундамента и стен.',
    source: 'Копается в глубине холмов.',
  },
  {
    id: Block.Water,
    name: 'вода',
    // Water is not solid: you swim through it, and a water wall cannot seal a house.
    solid: false,
    opaque: false,
    color: BLOCK_COLORS.water,
    transparent: true,
    opacity: 0.72,
    placeable: true,
    description: 'Течёт, заполняет ямы и растекается. Нужна для пруда.',
    source: 'Черпается из любого водоёма: возьми воду в руку и щёлкни ЛКМ по воде.',
  },
  {
    id: Block.Wood,
    name: 'дерево',
    solid: true,
    opaque: true,
    color: BLOCK_COLORS.woodSide,
    topColor: BLOCK_COLORS.woodTop,
    bottomColor: BLOCK_COLORS.woodTop,
    variation: 0.06,
    placeable: true,
    description: 'Тёплый строительный блок.',
    source: 'Ломай стволы деревьев.',
  },
  { id: Block.Leaves, name: 'листва', solid: true, opaque: true, color: BLOCK_COLORS.leaves, variation: 0.1, placeable: true },
  { id: Block.Blossom, name: 'цветущая листва', solid: true, opaque: true, color: BLOCK_COLORS.blossom, variation: 0.08, placeable: true },
  {
    id: Block.Glass,
    name: 'стекло',
    // Glass is solid and seals: windows do not break a house's air-tightness.
    solid: true,
    opaque: false,
    color: BLOCK_COLORS.glass,
    transparent: true,
    opacity: 0.35,
    placeable: true,
    description: 'Прозрачная стена: свет пропускает, а сквозняк нет — окна можно.',
    source: 'Есть в стартовом запасе.',
  },
  { id: Block.Pink, name: 'розовый блок', solid: true, opaque: true, color: BLOCK_COLORS.paintedPink, variation: 0.02, placeable: true, description: 'Крашеный блок для стройки.', source: 'Стартовый запас; возвращается при поломке.' },
  { id: Block.Blue, name: 'голубой блок', solid: true, opaque: true, color: BLOCK_COLORS.paintedBlue, variation: 0.02, placeable: true },
  { id: Block.Yellow, name: 'жёлтый блок', solid: true, opaque: true, color: BLOCK_COLORS.paintedYellow, variation: 0.02, placeable: true },
  { id: Block.Lavender, name: 'лавандовый блок', solid: true, opaque: true, color: BLOCK_COLORS.paintedLavender, variation: 0.02, placeable: true },
  { id: Block.Mint, name: 'мятный блок', solid: true, opaque: true, color: BLOCK_COLORS.paintedMint, variation: 0.02, placeable: true },
  {
    id: Block.Bed,
    name: 'старая кроватка',
    solid: false,
    opaque: false,
    color: BLOCK_COLORS.bedStem,
    topColor: BLOCK_COLORS.bedCap,
    height: 0.5,
    variation: 0.02,
    // No longer placeable from the inventory, but lives on and works in old worlds.
    placeable: false,
    drops: { block: Block.BedHead, count: 1 },
  },
  { id: Block.Water3, name: 'вода', solid: false, opaque: false, color: BLOCK_COLORS.water, transparent: true, opacity: 0.66, placeable: false },
  { id: Block.Water2, name: 'вода', solid: false, opaque: false, color: BLOCK_COLORS.water, transparent: true, opacity: 0.6, placeable: false },
  { id: Block.Water1, name: 'вода', solid: false, opaque: false, color: BLOCK_COLORS.water, transparent: true, opacity: 0.54, placeable: false },
  {
    id: Block.DoorClosed,
    name: 'дверца',
    solid: true,
    opaque: false,
    seals: true,
    color: BLOCK_COLORS.door,
    placeable: true,
    description: 'Закрытая дверца запечатывает дом, но открывается по ПКМ. Смурфики заходят сами.',
    source: 'Есть в стартовом запасе.',
  },
  {
    id: Block.DoorOpen,
    name: 'дверца (открыта)',
    // An open door is passable yet still seals the room — that is the whole point.
    solid: false,
    opaque: false,
    seals: true,
    color: BLOCK_COLORS.door,
    placeable: false,
    drops: { block: Block.DoorClosed, count: 1 },
  },
  {
    id: Block.BedHead,
    name: 'грибная кроватка',
    solid: false,
    opaque: false,
    color: BLOCK_COLORS.bedStem,
    topColor: BLOCK_COLORS.bedCap,
    height: 0.45,
    variation: 0.02,
    placeable: true,
    description: 'Кроватка на два блока. Поставь её в закрытой комнате — заселится смурфик.',
    source: 'Есть в стартовом запасе.',
  },
  {
    id: Block.BedFoot,
    name: 'грибная кроватка',
    solid: false,
    opaque: false,
    color: BLOCK_COLORS.bedStem,
    topColor: BLOCK_COLORS.bedBlanket,
    height: 0.45,
    variation: 0.02,
    placeable: false,
    drops: { block: Block.BedHead, count: 1 },
  },
  {
    id: Block.Carrot,
    name: 'морковка',
    solid: false,
    opaque: false,
    color: BLOCK_COLORS.carrot,
    placeable: false,
    description: 'Возьми в руку — ближайшие зверюшки пойдут следом. Так их приводят в деревню.',
    source: 'Ломай морковные грядки на равнинах.',
  },
  {
    id: Block.CarrotPlant,
    name: 'морковная грядка',
    solid: false,
    opaque: false,
    // Orange sides on purpose: a green patch on green grass is invisible,
    // and finding it is part of the quest.
    color: BLOCK_COLORS.carrot,
    topColor: BLOCK_COLORS.carrotLeaf,
    height: 0.4,
    variation: 0.08,
    placeable: false,
    drops: { block: Block.Carrot, count: 2 },
    description: 'Сломай — получишь морковки для приманки зверюшек.',
    source: 'Растёт оранжевыми пятнами на лугах, чуть в стороне от деревни.',
  },
  {
    id: Block.Cloud,
    name: 'облачко',
    solid: false,
    opaque: false,
    color: BLOCK_COLORS.cloud,
    placeable: false,
    description: 'Заряд для метательного (клавиша F). Без облачка бросить нечего.',
    source: 'Выпадает из ночных зверюшек.',
  },
  {
    id: Block.Lantern,
    name: 'фонарик',
    solid: true,
    opaque: true,
    color: BLOCK_COLORS.lantern,
    glow: 2.0,
    placeable: true,
    description: 'Тёплый светящийся блок — размечай деревню на ночь.',
    source: 'Есть в стартовом запасе.',
  },
]

/** Fast lookup tables instead of array search — the mesher calls these millions of times. */
const SOLID = new Uint8Array(256)
const OPAQUE = new Uint8Array(256)
const SEALS = new Uint8Array(256)
const WATER_LEVEL = new Uint8Array(256)
for (const def of DEFS) {
  SOLID[def.id] = def.solid ? 1 : 0
  OPAQUE[def.id] = def.opaque ? 1 : 0
  SEALS[def.id] = (def.seals ?? def.solid) ? 1 : 0
}
WATER_LEVEL[Block.Water] = 4
WATER_LEVEL[Block.Water3] = 3
WATER_LEVEL[Block.Water2] = 2
WATER_LEVEL[Block.Water1] = 1

const WATER_BY_LEVEL: readonly Block[] = [
  Block.Air,
  Block.Water1,
  Block.Water2,
  Block.Water3,
  Block.Water,
]

export function blockDef(id: Block): BlockDef {
  return DEFS[id] ?? DEFS[Block.Air]
}

export function isSolid(id: Block): boolean {
  return SOLID[id] === 1
}

export function isOpaque(id: Block): boolean {
  return OPAQUE[id] === 1
}

/** A wall in the room-seal sense. NOT the same as solid: see doors. */
export function sealsRoom(id: Block): boolean {
  return SEALS[id] === 1
}

export function isWater(id: Block): boolean {
  return WATER_LEVEL[id] > 0
}

/** Water level 4…1; 0 means not water. */
export function waterLevel(id: Block): number {
  return WATER_LEVEL[id]
}

export function waterByLevel(level: number): Block {
  return WATER_BY_LEVEL[Math.max(0, Math.min(4, level))]
}

export function isDoor(id: Block): boolean {
  return id === Block.DoorClosed || id === Block.DoorOpen
}

export function isBed(id: Block): boolean {
  return id === Block.Bed || id === Block.BedHead || id === Block.BedFoot
}

/**
 * Hotbar blocks in slot order. Digits select the first nine, the wheel cycles all.
 * Carrot and cloud are not placeable — they are held-in-hand items.
 */
export const HOTBAR_BLOCKS: readonly Block[] = [
  // First nine sit on digits: everything quest-critical must be one tap away.
  Block.BedHead,
  Block.DoorClosed,
  Block.Water,
  Block.Carrot,
  Block.Pink,
  Block.Blue,
  Block.Yellow,
  Block.Glass,
  Block.Wood,
  // The rest is wheel-only.
  Block.Stone,
  Block.Lavender,
  Block.Mint,
  Block.Lantern,
  Block.Cloud,
]

export const ALL_BLOCKS = DEFS
