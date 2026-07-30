import { PLAYER, WORLD } from './config/tuning'
import { Block, HOTBAR_BLOCKS } from './world/blocks'

/**
 * Saving to localStorage.
 *
 * The world is never written whole — it deterministically regenerates from the seed.
 * Only the diff goes to storage: blocks the player actually changed. For a typical
 * session that is hundreds of entries instead of hundreds of thousands of voxels.
 */

const STORAGE_KEY = 'vitacraft.save.v1'

/** Quest chain progress. Houses and the pond derive from the world; the rest lives here. */
export interface QuestSave {
  stage: number
  animals: number
  night: boolean
  clouds: number
}

export interface SaveData {
  version: 2
  seed: number
  /** Player-changed blocks as "x,y,z" → block id. */
  edits: Record<string, number>
  player: { x: number; y: number; z: number; yaw: number; pitch: number; health: number }
  inventory: Record<string, number>
  /** In-game seconds — restores the time of day. */
  dayTime: number
  stage: string
  /** Bed positions: the village rebuilds houses from them after loading. */
  beds: [number, number, number][]
  quest: QuestSave
}

type UnknownRecord = Record<string, unknown>

const SAVE_STAGES = new Set(['village', 'boss-incoming', 'boss', 'won'])
const EDIT_KEY = /^-?\d+,-?\d+,-?\d+$/

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

function isBlockId(value: unknown): value is Block {
  return Number.isInteger(value) && (value as number) >= Block.Air && (value as number) <= Block.Lantern
}

function parseEdits(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null
  const edits: Record<string, number> = {}
  for (const [key, id] of Object.entries(value)) {
    if (!EDIT_KEY.test(key) || !isBlockId(id)) return null
    const coordinates = key.split(',').map(Number)
    const y = coordinates[1]
    if (!coordinates.every(Number.isSafeInteger) || y < 0 || y >= WORLD.chunkSizeY) return null
    edits[key] = id
  }
  return edits
}

function parseInventory(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null
  const inventory: Record<string, number> = {}
  for (const [key, count] of Object.entries(value)) {
    if (!/^\d+$/.test(key) || !isBlockId(Number(key)) || !isNonNegativeInteger(count)) return null
    inventory[key] = count
  }
  return inventory
}

function parsePlayer(value: unknown): SaveData['player'] | null {
  if (!isRecord(value)) return null
  const { x, y, z, yaw, pitch, health } = value
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(z) ||
    !isFiniteNumber(yaw) ||
    !isFiniteNumber(pitch) ||
    !isFiniteNumber(health) ||
    health < 0 ||
    health > PLAYER.maxHealth
  ) {
    return null
  }
  return { x, y, z, yaw, pitch, health }
}

function parseBeds(value: unknown): [number, number, number][] | null {
  if (!Array.isArray(value)) return null
  const beds: [number, number, number][] = []
  for (const bed of value) {
    if (
      !Array.isArray(bed) ||
      bed.length !== 3 ||
      !bed.every(Number.isSafeInteger) ||
      bed[1] < 0 ||
      bed[1] >= WORLD.chunkSizeY
    ) {
      return null
    }
    beds.push([bed[0], bed[1], bed[2]])
  }
  return beds
}

function parseQuest(value: unknown): QuestSave | null {
  if (!isRecord(value)) return null
  const { stage, animals, night, clouds } = value
  if (
    !isNonNegativeInteger(stage) ||
    stage > 5 ||
    !isNonNegativeInteger(animals) ||
    typeof night !== 'boolean' ||
    !isNonNegativeInteger(clouds)
  ) {
    return null
  }
  return { stage, animals, night, clouds }
}

/** Validates and sanitizes untrusted JSON from localStorage, including legacy v1 saves. */
export function parseSaveData(value: unknown): SaveData | null {
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2)) return null

  const edits = parseEdits(value.edits)
  const player = parsePlayer(value.player)
  const inventory = parseInventory(value.inventory)
  const beds = parseBeds(value.beds)
  if (
    edits === null ||
    player === null ||
    inventory === null ||
    beds === null ||
    !Number.isSafeInteger(value.seed) ||
    !isFiniteNumber(value.dayTime) ||
    value.dayTime < 0 ||
    typeof value.stage !== 'string' ||
    !SAVE_STAGES.has(value.stage)
  ) {
    return null
  }

  const quest =
    value.version === 2
      ? parseQuest(value.quest)
      : {
          stage: value.stage === 'won' ? 5 : 0,
          animals: 0,
          night: false,
          clouds: 0,
        }
  if (quest === null) return null

  return {
    version: 2,
    seed: value.seed as number,
    edits,
    player,
    inventory,
    dayTime: value.dayTime,
    stage: value.stage,
    beds,
    quest,
  }
}

export function saveGame(data: SaveData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (error) {
    // Private mode or full storage — none of it prevents playing.
    console.warn('Failed to save game:', error)
  }
}

export function loadGame(): SaveData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    return parseSaveData(JSON.parse(raw))
  } catch (error) {
    console.warn('Save data corrupted, starting fresh:', error)
    return null
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear — fine.
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
  // Saved values REPLACE the starting stock rather than add to it — otherwise every
  // load would gift a full starting kit. Only entries within the save itself are
  // summed (the legacy bed merges into the new one).
  for (const block of HOTBAR_BLOCKS) inventory.set(block, 0)
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
