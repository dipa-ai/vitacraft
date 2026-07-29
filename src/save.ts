import { Block, HOTBAR_BLOCKS } from './world/blocks'

/**
 * Сохранение в localStorage.
 *
 * Мир целиком не пишем — он детерминированно восстанавливается из сида. В хранилище идёт
 * только дифф: блоки, которые игрок реально изменил. Для обычной партии это сотни записей
 * вместо сотен тысяч вокселей.
 */

const STORAGE_KEY = 'vitacraft.save.v1'

/** Прогресс цепочки испытаний. Дома и пруд выводятся из мира, остальное — отсюда. */
export interface QuestSave {
  stage: number
  animals: number
  night: boolean
  clouds: number
}

export interface SaveData {
  version: 2
  seed: number
  /** Изменённые игроком блоки в виде "x,y,z" → id блока. */
  edits: Record<string, number>
  player: { x: number; y: number; z: number; yaw: number; pitch: number; health: number }
  inventory: Record<string, number>
  /** Секунды внутриигрового времени — восстанавливает время суток. */
  dayTime: number
  stage: string
  /** Позиции кроваток: по ним деревня пересобирает дома после загрузки. */
  beds: [number, number, number][]
  quest: QuestSave
}

export function saveGame(data: SaveData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (error) {
    // Приватный режим или переполненное хранилище — играть это не мешает.
    console.warn('Не удалось сохранить игру:', error)
  }
}

export function loadGame(): SaveData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as SaveData & { version: number }
    if (parsed.version === 2) return parsed

    if (parsed.version === 1) {
      // Партия первой версии: постройки и инвентарь целы, цепочка выводится из старой
      // стадии — «won» значит всё пройдено, иначе прогресс начинается с домов.
      return {
        ...parsed,
        version: 2,
        quest: {
          stage: parsed.stage === 'won' ? 5 : 0,
          animals: 0,
          night: false,
          clouds: 0,
        },
      }
    }
    return null
  } catch (error) {
    console.warn('Сохранение повреждено, начинаем заново:', error)
    return null
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Нечего чистить — и не надо.
  }
}

export function serializeInventory(inventory: Map<Block, number>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const block of HOTBAR_BLOCKS) {
    result[String(block)] = inventory.get(block) ?? 0
  }
  return result
}

export function restoreInventory(
  inventory: Map<Block, number>,
  saved: Record<string, number>,
): void {
  // Сохранённые значения ЗАМЕНЯЮТ стартовый запас, а не прибавляются к нему — иначе
  // каждая загрузка бесплатно дарила бы полный стартовый набор. Складываются только
  // записи внутри самого сейва (старая кроватка сливается в новую).
  const merged = new Map<Block, number>()
  for (const [key, count] of Object.entries(saved)) {
    let block = Number(key) as Block
    if (block === Block.Bed) block = Block.BedHead
    merged.set(block, (merged.get(block) ?? 0) + count)
  }
  for (const [block, count] of merged) {
    inventory.set(block, count)
  }
}
