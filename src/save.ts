import { HOTBAR_BLOCKS, type Block } from './world/blocks'

/**
 * Сохранение в localStorage.
 *
 * Мир целиком не пишем — он детерминированно восстанавливается из сида. В хранилище идёт
 * только дифф: блоки, которые игрок реально изменил. Для обычной партии это сотни записей
 * вместо сотен тысяч вокселей.
 */

const STORAGE_KEY = 'vitacraft.save.v1'

export interface SaveData {
  version: 1
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
    const parsed = JSON.parse(raw) as SaveData
    if (parsed.version !== 1) return null
    return parsed
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
  for (const [key, count] of Object.entries(saved)) {
    inventory.set(Number(key) as Block, count)
  }
}
