import { VILLAGE, WORLD } from '../config/tuning'
import { isBed, sealsRoom } from '../world/blocks'
import type { VoxelReader } from '../world/mesher'

/**
 * The "is this a smurf house?" check.
 *
 * The player builds walls and a roof however they like and puts a mushroom bed
 * inside. A flood-fill then runs from the bed: if the air escapes nowhere and fits
 * the budget, the room is sealed and a smurf moves in.
 *
 * The budget IS the definition of "sealed": the connected region cannot be counted
 * to completion because outside it is infinite. Exceeding the budget means a draft.
 *
 * A wall is whatever "seals" (sealsRoom), not whatever is solid: glass is a wall
 * (windows allowed), a door is a wall in BOTH states (doors couldn't exist
 * otherwise), and water is not a wall: a house of water holds nothing.
 */

export type RoomFailure =
  /** No bed at the given spot. */
  | 'no-bed'
  /** Air escapes outside: no roof, a hole in a wall, or an open gap. */
  | 'leaks'
  /** Sealed, but too cramped inside to call it a house. */
  | 'too-small'

export interface RoomCell {
  x: number
  y: number
  z: number
}

export interface RoomResult {
  ok: boolean
  /** Number of interior room cells. */
  volume: number
  reason: RoomFailure | null
  /** The room's cells. Empty when the room failed the check. */
  cells: RoomCell[]
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

function fail(reason: RoomFailure, volume = 0): RoomResult {
  return { ok: false, volume, reason, cells: [] }
}

/** Human explanation of the failure — delivered to the player as a toast. */
export function explainFailure(reason: RoomFailure): string {
  switch (reason) {
    case 'no-bed':
      return 'Сначала поставь грибную кроватку — смурфику нужно на чём-то спать'
    case 'leaks':
      return 'Тут дует! Нужны стены со всех сторон и крыша сверху'
    case 'too-small':
      return `Тесновато. Комнате нужно хотя бы ${VILLAGE.minRoomVolume} клеток внутри`
  }
}

/**
 * @param bedX coordinates of the bed cell.
 */
export function validateRoom(
  reader: VoxelReader,
  bedX: number,
  bedY: number,
  bedZ: number,
): RoomResult {
  // Any bed half works as a start — the legacy single-cell bed too.
  if (!isBed(reader(bedX, bedY, bedZ))) return fail('no-bed')

  const visited = new Set<string>([`${bedX},${bedY},${bedZ}`])
  const queue: RoomCell[] = [{ x: bedX, y: bedY, z: bedZ }]
  const cells: RoomCell[] = []

  while (queue.length > 0) {
    const cell = queue.pop()!
    cells.push(cell)

    for (const [dx, dy, dz] of NEIGHBOURS) {
      const x = cell.x + dx
      const y = cell.y + dy
      const z = cell.z + dz

      const key = `${x},${y},${z}`
      if (visited.has(key)) continue

      // Sealing is checked before world bounds, and the order matters: a house
      // floor resting on the bottom layer is a wall, not a leak.
      if (sealsRoom(reader(x, y, z))) continue

      // A passable cell beyond the world's vertical bounds is a real hole though:
      // there are no walls above the world ceiling or below its floor.
      if (y < 0 || y >= WORLD.chunkSizeY) return fail('leaks', cells.length)

      visited.add(key)
      // The region outgrew the budget — it must connect to the outside.
      if (visited.size > VILLAGE.floodFillBudget) return fail('leaks', visited.size)
      queue.push({ x, y, z })
    }
  }

  const volume = cells.length
  if (volume < VILLAGE.minRoomVolume) return fail('too-small', volume)

  return { ok: true, volume, reason: null, cells }
}

/**
 * The room's horizontal midpoint and its floor — where to put the smurf
 * when it moves in.
 */
export function roomCenter(cells: readonly RoomCell[]): RoomCell {
  let sumX = 0
  let sumZ = 0
  let minY = Infinity
  for (const cell of cells) {
    sumX += cell.x
    sumZ += cell.z
    minY = Math.min(minY, cell.y)
  }
  return {
    x: sumX / cells.length,
    y: minY,
    z: sumZ / cells.length,
  }
}
