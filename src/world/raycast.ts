import { Block } from './blocks'
import type { VoxelReader } from './mesher'

/**
 * DDA-рейкаст по воксельной сетке (алгоритм Amanatides–Woo), адаптированный из
 * официального мануала Three.js. Шагает строго по границам блоков, поэтому всегда
 * находит именно первый блок на луче — обычный THREE.Raycaster по мешу чанка так не умеет.
 *
 * Работает на простых числах, а не на THREE.Vector3, чтобы тесты не тянули за собой three.
 */

export interface VoxelHit {
  /** Целочисленные координаты блока, в который попали. */
  x: number
  y: number
  z: number
  /** Нормаль задетой грани. Нули означают, что луч начался внутри блока. */
  nx: number
  ny: number
  nz: number
  /** Точка попадания в мировых координатах. */
  px: number
  py: number
  pz: number
  distance: number
  id: Block
}

const defaultTarget = (id: Block): boolean => id !== Block.Air

/**
 * @param direction должен быть нормализован, иначе distance посчитается в неверных единицах.
 * @param isTarget какие блоки считать препятствием (по умолчанию — всё, кроме воздуха).
 */
export function raycastVoxels(
  reader: VoxelReader,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistance: number,
  isTarget: (id: Block) => boolean = defaultTarget,
): VoxelHit | null {
  let ix = Math.floor(ox)
  let iy = Math.floor(oy)
  let iz = Math.floor(oz)

  const stepX = dx > 0 ? 1 : -1
  const stepY = dy > 0 ? 1 : -1
  const stepZ = dz > 0 ? 1 : -1

  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity

  // Расстояние до первой границы блока по каждой оси.
  let tMaxX = dx !== 0 ? ((dx > 0 ? ix + 1 : ix) - ox) / dx : Infinity
  let tMaxY = dy !== 0 ? ((dy > 0 ? iy + 1 : iy) - oy) / dy : Infinity
  let tMaxZ = dz !== 0 ? ((dz > 0 ? iz + 1 : iz) - oz) / dz : Infinity

  let steppedAxis = -1
  let t = 0

  while (t <= maxDistance) {
    const id = reader(ix, iy, iz)
    if (isTarget(id)) {
      return {
        x: ix,
        y: iy,
        z: iz,
        nx: steppedAxis === 0 ? -stepX : 0,
        ny: steppedAxis === 1 ? -stepY : 0,
        nz: steppedAxis === 2 ? -stepZ : 0,
        px: ox + dx * t,
        py: oy + dy * t,
        pz: oz + dz * t,
        distance: t,
        id,
      }
    }

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        ix += stepX
        t = tMaxX
        tMaxX += tDeltaX
        steppedAxis = 0
      } else {
        iz += stepZ
        t = tMaxZ
        tMaxZ += tDeltaZ
        steppedAxis = 2
      }
    } else {
      if (tMaxY < tMaxZ) {
        iy += stepY
        t = tMaxY
        tMaxY += tDeltaY
        steppedAxis = 1
      } else {
        iz += stepZ
        t = tMaxZ
        tMaxZ += tDeltaZ
        steppedAxis = 2
      }
    }
  }

  return null
}
