import { describe, expect, it } from 'vitest'
import { Block } from './blocks'
import type { VoxelReader } from './mesher'
import { raycastVoxels } from './raycast'

function readerOf(cells: Record<string, Block>): VoxelReader {
  return (x, y, z) => cells[`${x},${y},${z}`] ?? Block.Air
}

describe('raycastVoxels', () => {
  it('finds the nearest block, not an arbitrary one along the ray', () => {
    const reader = readerOf({ '5,0,0': Block.Stone, '8,0,0': Block.Dirt })
    const hit = raycastVoxels(reader, 0.5, 0.5, 0.5, 1, 0, 0, 20)

    expect(hit).not.toBeNull()
    expect(hit!.x).toBe(5)
    expect(hit!.id).toBe(Block.Stone)
  })

  it('returns the normal of the entered face', () => {
    const reader = readerOf({ '5,0,0': Block.Stone })
    // Flying along +X, so we hit the face looking toward -X.
    const fromWest = raycastVoxels(reader, 0.5, 0.5, 0.5, 1, 0, 0, 20)
    expect([fromWest!.nx, fromWest!.ny, fromWest!.nz]).toEqual([-1, 0, 0])

    // Top-down — we hit the top face.
    const fromAbove = raycastVoxels(reader, 5.5, 9, 0.5, 0, -1, 0, 20)
    expect([fromAbove!.nx, fromAbove!.ny, fromAbove!.nz]).toEqual([0, 1, 0])

    // And from the east — the face looking toward +X.
    const fromEast = raycastVoxels(reader, 12.5, 0.5, 0.5, -1, 0, 0, 20)
    expect([fromEast!.nx, fromEast!.ny, fromEast!.nz]).toEqual([1, 0, 0])
  })

  it('the normal points at the empty cell where a new block goes', () => {
    const reader = readerOf({ '5,0,0': Block.Stone })
    const hit = raycastVoxels(reader, 0.5, 0.5, 0.5, 1, 0, 0, 20)!
    // Placement goes along the normal from the hit block — it must be empty there.
    expect(reader(hit.x + hit.nx, hit.y + hit.ny, hit.z + hit.nz)).toBe(Block.Air)
  })

  it('misses in a void', () => {
    expect(raycastVoxels(readerOf({}), 0.5, 0.5, 0.5, 1, 0, 0, 50)).toBeNull()
  })

  it('does not reach past the given distance', () => {
    const reader = readerOf({ '10,0,0': Block.Stone })
    expect(raycastVoxels(reader, 0.5, 0.5, 0.5, 1, 0, 0, 5)).toBeNull()
    expect(raycastVoxels(reader, 0.5, 0.5, 0.5, 1, 0, 0, 20)).not.toBeNull()
  })

  it('measures distance in blocks and yields the hit point on the face', () => {
    const reader = readerOf({ '5,0,0': Block.Stone })
    const hit = raycastVoxels(reader, 0.5, 0.5, 0.5, 1, 0, 0, 20)!
    // From x=0.5 to the face at x=5 is exactly 4.5.
    expect(hit.distance).toBeCloseTo(4.5, 6)
    expect(hit.px).toBeCloseTo(5, 6)
  })

  it('works on a diagonal ray', () => {
    const reader = readerOf({ '4,4,0': Block.Stone })
    const s = Math.SQRT1_2
    const hit = raycastVoxels(reader, 0.5, 0.5, 0.5, s, s, 0, 30)
    expect(hit).not.toBeNull()
    expect(hit!.x).toBe(4)
    expect(hit!.y).toBe(4)
  })

  it('skips blocks rejected by the target filter', () => {
    const reader = readerOf({ '3,0,0': Block.Water, '7,0,0': Block.Stone })
    const throughWater = raycastVoxels(
      reader,
      0.5,
      0.5,
      0.5,
      1,
      0,
      0,
      20,
      (id) => id !== Block.Air && id !== Block.Water,
    )
    // The ray must pass through water and stop at stone.
    expect(throughWater!.x).toBe(7)
    expect(throughWater!.id).toBe(Block.Stone)

    // While the default filter stops at the water already.
    expect(raycastVoxels(reader, 0.5, 0.5, 0.5, 1, 0, 0, 20)!.x).toBe(3)
  })

  it('a ray from inside a block hits it at once with no placement normal', () => {
    const reader = readerOf({ '0,0,0': Block.Stone })
    const hit = raycastVoxels(reader, 0.5, 0.5, 0.5, 1, 0, 0, 20)!
    expect(hit.distance).toBe(0)
    // A zero normal signals the caller there is no face to place against.
    expect([hit.nx, hit.ny, hit.nz]).toEqual([0, 0, 0])
  })

  it('works the same on negative coordinates', () => {
    const reader = readerOf({ '-5,-3,-2': Block.Stone })
    const hit = raycastVoxels(reader, -0.5, -2.5, -1.5, -1, 0, 0, 20)
    expect(hit).not.toBeNull()
    expect(hit!.x).toBe(-5)
    expect(hit!.y).toBe(-3)
  })
})
