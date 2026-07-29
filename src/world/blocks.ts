import { BLOCK_COLORS } from '../config/palette'

/**
 * Реестр блоков. Id — это значение в Uint8Array чанка, поэтому существующие id менять
 * нельзя (сломаются сохранения); новые добавляются строго в конец.
 */
export const enum Block {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Sand = 3,
  Stone = 4,
  /** Полный уровень воды: море, озёра и вода из ведра. */
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
  /** Старая одноклеточная кроватка. Оставлена ради старых сохранений. */
  Bed = 15,
  /** Затухающие уровни растёкшейся воды. */
  Water3 = 16,
  Water2 = 17,
  Water1 = 18,
  /** Дверь занимает две клетки по вертикали одним id. */
  DoorClosed = 19,
  DoorOpen = 20,
  /** Кроватка из двух блоков: изголовье и одеяло. */
  BedHead = 21,
  BedFoot = 22,
  /** Морковка-предмет: приманка для животных, в мир не ставится. */
  Carrot = 23,
  /** Морковная грядка в мире — из неё добывается морковка. */
  CarrotPlant = 24,
  /** Облачко — заряд для метательного. Существует только в инвентаре. */
  Cloud = 25,
  Lantern = 26,
}

export interface BlockDef {
  readonly id: Block
  readonly name: string
  /** Останавливает существ (физика). */
  readonly solid: boolean
  /** Полностью перекрывает соседние грани при мешинге. */
  readonly opaque: boolean
  /**
   * Считается ли стеной при проверке герметичности комнаты. По умолчанию равно solid;
   * двери — главное исключение: открытая дверь проходима, но комнату запечатывает.
   */
  readonly seals?: boolean
  readonly color: number
  readonly topColor?: number
  readonly bottomColor?: number
  readonly transparent?: boolean
  readonly opacity?: number
  /** Высота блока в клетке для мешера (вода считает свою по уровню). */
  readonly height?: number
  /** Множитель яркости: >1 пробивает порог блума, и блок светится. */
  readonly glow?: number
  readonly placeable: boolean
  /** Что падает в инвентарь при поломке вместо самого блока. */
  readonly drops?: { readonly block: Block; readonly count: number }
  readonly variation?: number
  /** Для панели ресурсов: что это и как добыть. */
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
    // Вода не solid: сквозь неё плывут, и стена из воды дом не держит.
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
    // Стекло solid и запечатывает: окна не ломают герметичность дома.
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
    // Из инвентаря больше не ставится, но в старых мирах живёт и работает.
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
    // Открытая дверь проходима, но комнату по-прежнему запечатывает — в этом весь смысл.
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
    // Бока оранжевые нарочно: зелёная грядка на зелёной траве неразличима,
    // а искать её — часть квеста.
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

/** Быстрые таблицы вместо поиска по массиву — мешер зовёт их миллионы раз. */
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

/** Стена с точки зрения герметичности комнаты. НЕ то же самое, что solid: см. двери. */
export function sealsRoom(id: Block): boolean {
  return SEALS[id] === 1
}

export function isWater(id: Block): boolean {
  return WATER_LEVEL[id] > 0
}

/** Уровень воды 4…1; 0 — не вода. */
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
 * Блоки хотбара по порядку слотов. Цифры выбирают первые девять, колесо крутит все.
 * Морковка и облачко не ставятся — это предметы «в руке».
 */
export const HOTBAR_BLOCKS: readonly Block[] = [
  Block.BedHead,
  Block.DoorClosed,
  Block.Water,
  Block.Pink,
  Block.Blue,
  Block.Yellow,
  Block.Lavender,
  Block.Mint,
  Block.Glass,
  Block.Wood,
  Block.Stone,
  Block.Lantern,
  Block.Carrot,
  Block.Cloud,
]

export const ALL_BLOCKS = DEFS
