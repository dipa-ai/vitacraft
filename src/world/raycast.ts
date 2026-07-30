import { Block } from './blocks'
import type { VoxelReader } from './mesher'

/**
 * DDA raycast over the voxel grid (Amanatides–Woo), adapted from the official Three.js
 * manual. It steps exactly along block boundaries, so it always finds the true first
 * block on the ray — something THREE.Raycaster over a chunk mesh cannot guarantee.
 *
 * Operates on plain numbers rather than THREE.Vector3 so tests don't pull in three.
 */

export interface VoxelHit {
  /** Integer coordinates of the hit block. */
  x: number
  y: number
  z: number
  /** Normal of the struck face. All zeros mean the ray started inside the block. */
  nx: number
  ny: number
  nz: number
  /** Hit point in world coordinates. */
  px: number
  py: number
  pz: number
  distance: number
  id: Block
}

const defaultTarget = (id: Block): boolean => id !== Block.Air

/**
 * @param direction must be normalized, or distance comes out in wrong units.
 * @param isTarget which blocks count as obstacles (default: everything but air).
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

  // Distance to the first block boundary along each axis.
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
