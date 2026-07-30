import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { Player } from '../player/player'
import type { Fx } from '../render/fx'
import { Block } from '../world/blocks'
import type { World } from '../world/world'
import { Village } from './quest'

function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}

describe('Village house revalidation', () => {
  it('invalidates a long room when a wall far from its bed is broken', () => {
    const cells = new Map<string, Block>()

    for (let x = -1; x <= 20; x++) {
      for (let z = -1; z <= 1; z++) {
        cells.set(key(x, 0, z), Block.Stone)
        cells.set(key(x, 3, z), Block.Stone)
      }
      for (let y = 1; y <= 2; y++) {
        cells.set(key(x, y, -1), Block.Stone)
        cells.set(key(x, y, 1), Block.Stone)
      }
    }
    for (let y = 1; y <= 2; y++) {
      cells.set(key(-1, y, 0), Block.Stone)
      cells.set(key(20, y, 0), Block.Stone)
    }
    cells.set(key(0, 1, 0), Block.BedHead)
    cells.set(key(1, 1, 0), Block.BedFoot)

    const reader = (x: number, y: number, z: number): Block =>
      cells.get(key(x, y, z)) ?? Block.Air
    const world = {
      reader,
      getVoxel: reader,
      groundY: () => 1,
    } as unknown as World
    const fx = { burst: vi.fn(), hearts: vi.fn() } as unknown as Fx
    const village = new Village(world, new THREE.Scene(), new Player(), fx)

    village.handleBlockPlaced(0, 1, 0, Block.BedHead)
    expect(village.housesBuilt).toBe(1)

    cells.delete(key(20, 1, 0))
    village.handleBlockBroken(20, 1, 0, Block.Stone)
    expect(village.housesBuilt).toBe(0)
  })
})
