import { BLOCK_COLORS } from '../config/palette'

/**
 * Реестр блоков. Id — это значение в Uint8Array чанка, поэтому порядок менять нельзя
 * без ломки сохранений (см. save.ts).
 */
export const enum Block {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Sand = 3,
  Stone = 4,
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
  /** Грибная кроватка — ключевой предмет квеста деревни. */
  Bed = 15,
}

export interface BlockDef {
  readonly id: Block
  readonly name: string
  /** Останавливает игрока и считается стеной при проверке замкнутости комнаты. */
  readonly solid: boolean
  /** Полностью перекрывает соседние грани (непрозрачные блоки скрывают грани друг друга). */
  readonly opaque: boolean
  /** Цвет боковых граней. */
  readonly color: number
  /** Цвет верхней грани, если отличается от боковой. */
  readonly topColor?: number
  /** Цвет нижней грани, если отличается от боковой. */
  readonly bottomColor?: number
  /** Рисуется в прозрачном проходе рендера. */
  readonly transparent?: boolean
  /** Прозрачность материала для прозрачного прохода. */
  readonly opacity?: number
  /** Можно взять в инвентарь и поставить. */
  readonly placeable: boolean
  /**
   * Амплитуда случайного разброса яркости на воксель. У природных блоков она заметная:
   * это разбивает большие однотонные плоскости и делает мир читаемым без текстур.
   * У блоков для стройки — почти нулевая, чтобы дома игрока выглядели аккуратно,
   * а не грязно.
   */
  readonly variation?: number
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
  },
  { id: Block.Dirt, name: 'земля', solid: true, opaque: true, color: BLOCK_COLORS.dirt, variation: 0.06, placeable: true },
  { id: Block.Sand, name: 'песок', solid: true, opaque: true, color: BLOCK_COLORS.sand, variation: 0.05, placeable: true },
  { id: Block.Stone, name: 'камень', solid: true, opaque: true, color: BLOCK_COLORS.stone, variation: 0.08, placeable: true },
  {
    id: Block.Water,
    name: 'вода',
    // Вода не solid: сквозь неё плывут, и комната с водой вместо стены не герметична.
    solid: false,
    opaque: false,
    color: BLOCK_COLORS.water,
    transparent: true,
    opacity: 0.72,
    placeable: false,
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
  },
  { id: Block.Leaves, name: 'листва', solid: true, opaque: true, color: BLOCK_COLORS.leaves, variation: 0.1, placeable: true },
  { id: Block.Blossom, name: 'цветущая листва', solid: true, opaque: true, color: BLOCK_COLORS.blossom, variation: 0.08, placeable: true },
  {
    id: Block.Glass,
    name: 'стекло',
    // Стекло solid, но не opaque: окна в доме не ломают герметичность, а грани за ним видны.
    solid: true,
    opaque: false,
    color: BLOCK_COLORS.glass,
    transparent: true,
    opacity: 0.35,
    placeable: true,
  },
  { id: Block.Pink, name: 'розовый блок', solid: true, opaque: true, color: BLOCK_COLORS.paintedPink, variation: 0.02, placeable: true },
  { id: Block.Blue, name: 'голубой блок', solid: true, opaque: true, color: BLOCK_COLORS.paintedBlue, variation: 0.02, placeable: true },
  { id: Block.Yellow, name: 'жёлтый блок', solid: true, opaque: true, color: BLOCK_COLORS.paintedYellow, variation: 0.02, placeable: true },
  { id: Block.Lavender, name: 'лавандовый блок', solid: true, opaque: true, color: BLOCK_COLORS.paintedLavender, variation: 0.02, placeable: true },
  { id: Block.Mint, name: 'мятный блок', solid: true, opaque: true, color: BLOCK_COLORS.paintedMint, variation: 0.02, placeable: true },
  {
    id: Block.Bed,
    name: 'грибная кроватка',
    // Не solid, чтобы кроватка не считалась стеной своей же комнаты при flood-fill.
    solid: false,
    opaque: false,
    color: BLOCK_COLORS.bedStem,
    topColor: BLOCK_COLORS.bedCap,
    variation: 0.02,
    placeable: true,
  },
]

/** Быстрые таблицы вместо поиска по массиву — мешер зовёт их миллионы раз. */
const SOLID = new Uint8Array(256)
const OPAQUE = new Uint8Array(256)
for (const def of DEFS) {
  SOLID[def.id] = def.solid ? 1 : 0
  OPAQUE[def.id] = def.opaque ? 1 : 0
}

export function blockDef(id: Block): BlockDef {
  return DEFS[id] ?? DEFS[Block.Air]
}

export function isSolid(id: Block): boolean {
  return SOLID[id] === 1
}

export function isOpaque(id: Block): boolean {
  return OPAQUE[id] === 1
}

export function isTransparentDrawn(id: Block): boolean {
  return blockDef(id).transparent === true
}

/** Блоки, доступные игроку в хотбаре, по порядку слотов. */
export const HOTBAR_BLOCKS: readonly Block[] = [
  Block.Bed,
  Block.Pink,
  Block.Blue,
  Block.Yellow,
  Block.Lavender,
  Block.Mint,
  Block.Glass,
  Block.Wood,
  Block.Stone,
]

export const ALL_BLOCKS = DEFS
