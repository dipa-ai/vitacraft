import { VILLAGE, WORLD } from '../config/tuning'
import { Block, isSolid } from '../world/blocks'
import type { VoxelReader } from '../world/mesher'

/**
 * Проверка «это домик для смурфика?».
 *
 * Игрок строит стены и крышу как хочет, а внутрь ставит грибную кроватку. Дальше от
 * кроватки запускается flood-fill по непроходимым клеткам: если воздух никуда не утекает
 * и уложился в лимит — комната герметична, и смурфик заселяется.
 *
 * Лимит здесь и есть определение «замкнутости»: считать связную область до конца нельзя,
 * потому что снаружи она бесконечна. Вышли за лимит — значит где-то дует.
 *
 * Стекло считается стеной (окна делать можно), вода — нет: стена из воды дом не держит.
 */

export type RoomFailure =
  /** На указанном месте нет кроватки. */
  | 'no-bed'
  /** Воздух утекает наружу: нет крыши, дыра в стене или открытый проём. */
  | 'leaks'
  /** Замкнуто, но внутри слишком тесно, чтобы называть это домом. */
  | 'too-small'

export interface RoomCell {
  x: number
  y: number
  z: number
}

export interface RoomResult {
  ok: boolean
  /** Число внутренних клеток комнаты. */
  volume: number
  reason: RoomFailure | null
  /** Клетки комнаты. Пусто, если комната не прошла проверку. */
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

/** Человеческое объяснение отказа — уходит игроку репликой. */
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
 * @param bedX координаты клетки с кроваткой.
 */
export function validateRoom(
  reader: VoxelReader,
  bedX: number,
  bedY: number,
  bedZ: number,
): RoomResult {
  if (reader(bedX, bedY, bedZ) !== Block.Bed) return fail('no-bed')

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

      // Твёрдость проверяется до границ мира, и порядок здесь важен: пол дома,
      // лежащий на самом нижнем слое, — это стена, а не утечка.
      if (isSolid(reader(x, y, z))) continue

      // А вот проходимая клетка за пределами мира по вертикали — настоящая дыра:
      // выше потолка мира и ниже дна стен нет.
      if (y < 0 || y >= WORLD.chunkSizeY) return fail('leaks', cells.length)

      visited.add(key)
      // Область разрослась сверх лимита — значит она соединена с улицей.
      if (visited.size > VILLAGE.floodFillBudget) return fail('leaks', visited.size)
      queue.push({ x, y, z })
    }
  }

  const volume = cells.length
  if (volume < VILLAGE.minRoomVolume) return fail('too-small', volume)

  return { ok: true, volume, reason: null, cells }
}

/**
 * Средняя точка комнаты по горизонтали и её пол — куда ставить смурфика,
 * когда он заселяется.
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
