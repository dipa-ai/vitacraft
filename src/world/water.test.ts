import { describe, expect, it } from 'vitest'
import { Block, isWater, waterLevel } from './blocks'
import { WaterSim, type WaterWorld } from './water'

/** Map-backed world: a floor at y=0 plus the listed blocks. */
function makeWorld(cells: Record<string, Block> = {}, floorY = 0) {
  const map = new Map<string, Block>(Object.entries(cells))
  const world: WaterWorld = {
    getVoxel: (x, y, z) => {
      if (y === floorY) return Block.Stone
      return map.get(`${x},${y},${z}`) ?? Block.Air
    },
    setFluid: (x, y, z, id) => {
      map.set(`${x},${y},${z}`, id)
    },
  }
  return { world, map }
}

/** Runs ticks until the queue settles. */
function settle(sim: WaterSim, world: WaterWorld, maxTicks = 200): number {
  let ticks = 0
  while (sim.pending > 0 && ticks < maxTicks) {
    sim.tick(world)
    ticks++
  }
  return ticks
}

function countWater(map: Map<string, Block>): number {
  let count = 0
  for (const id of map.values()) if (isWater(id)) count++
  return count
}

describe('WaterSim', () => {
  it('water flows into an adjacent pit', () => {
    // A source at y=1 next to a one-deep pit (simpler put: the source stands on
    // the floor and the neighboring same-level cell is empty).
    const { world, map } = makeWorld({ '0,1,0': Block.Water })
    const sim = new WaterSim()
    sim.wake(world, 0, 1, 0)
    settle(sim, world)

    // Cells at source level received water one level lower.
    expect(isWater(world.getVoxel(1, 1, 0))).toBe(true)
    expect(waterLevel(world.getVoxel(1, 1, 0))).toBe(3)
    expect(countWater(map)).toBeGreaterThan(1)
  })

  it('does not spread forever: the level decays over 3 steps', () => {
    const { world } = makeWorld({ '0,1,0': Block.Water })
    const sim = new WaterSim()
    sim.wake(world, 0, 1, 0)
    settle(sim, world)

    // 4 → 3 → 2 → 1: by the fourth step there is no water left.
    expect(waterLevel(world.getVoxel(1, 1, 0))).toBe(3)
    expect(waterLevel(world.getVoxel(2, 1, 0))).toBe(2)
    expect(waterLevel(world.getVoxel(3, 1, 0))).toBe(1)
    expect(world.getVoxel(4, 1, 0)).toBe(Block.Air)
  })

  it('downward water moves rather than copies: volume is conserved', () => {
    // A 1×1 walled shaft: source on top, empty down to the floor at y=0.
    const cells: Record<string, Block> = { '0,5,0': Block.Water }
    for (let y = 1; y <= 5; y++) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        cells[`${dx},${y},${dz}`] = Block.Stone
      }
    }
    const { world, map } = makeWorld(cells)
    const sim = new WaterSim()
    sim.wake(world, 0, 5, 0)
    settle(sim, world)

    // The source drained to the bottom; the top is empty; exactly one cell remains.
    expect(waterLevel(world.getVoxel(0, 1, 0))).toBe(4)
    expect(world.getVoxel(0, 5, 0)).toBe(Block.Air)
    expect(countWater(map)).toBe(1)
  })

  it('breaking the block under a source: water drains down, none stays above', () => {
    // The source stands on a block with a void below it down to the floor.
    const { world } = makeWorld({ '0,3,0': Block.Water, '0,2,0': Block.Stone })
    const sim = new WaterSim()
    sim.wake(world, 0, 3, 0)
    settle(sim, world)
    expect(waterLevel(world.getVoxel(0, 3, 0))).toBe(4)

    // Break the support — the source must fall to the floor, not multiply.
    world.setFluid(0, 2, 0, Block.Air)
    sim.wake(world, 0, 2, 0)
    settle(sim, world)

    expect(waterLevel(world.getVoxel(0, 1, 0))).toBe(4)
    expect(world.getVoxel(0, 3, 0)).toBe(Block.Air)
    expect(world.getVoxel(0, 2, 0)).toBe(Block.Air)
  })

  it('scooping the source dries out all spread water', () => {
    const { world, map } = makeWorld({ '0,1,0': Block.Water })
    const sim = new WaterSim()
    sim.wake(world, 0, 1, 0)
    settle(sim, world)
    expect(countWater(map)).toBeGreaterThan(1)

    // Scoop the source with the bucket.
    world.setFluid(0, 1, 0, Block.Air)
    sim.wake(world, 0, 1, 0)
    settle(sim, world)

    // Without feed, all spread water has dried.
    expect(countWater(map)).toBe(0)
  })

  it('water in a sealed basin stays and does not vanish', () => {
    // A 1×3 walled basin.
    const cells: Record<string, Block> = {}
    for (let x = -1; x <= 3; x++) {
      cells[`${x},1,-1`] = Block.Stone
      cells[`${x},1,1`] = Block.Stone
    }
    cells['-1,1,0'] = Block.Stone
    cells['3,1,0'] = Block.Stone
    cells['0,1,0'] = Block.Water
    const { world, map } = makeWorld(cells)
    const sim = new WaterSim()
    sim.wake(world, 0, 1, 0)
    settle(sim, world)

    expect(isWater(world.getVoxel(1, 1, 0))).toBe(true)
    expect(isWater(world.getVoxel(2, 1, 0))).toBe(true)
    // Nothing escaped past the walls.
    expect(world.getVoxel(4, 1, 0)).toBe(Block.Air)
    expect(countWater(map)).toBe(3)
  })

  it('wakes on a neighboring block change', () => {
    // Water behind a wall; remove the wall — water must flow in.
    const { world } = makeWorld({ '0,1,0': Block.Water, '1,1,0': Block.Stone })
    const sim = new WaterSim()
    sim.wake(world, 0, 1, 0)
    settle(sim, world)
    expect(world.getVoxel(2, 1, 0)).toBe(Block.Air)

    // Break the wall — wake is invoked from the world's setVoxel.
    world.setFluid(1, 1, 0, Block.Air)
    sim.wake(world, 1, 1, 0)
    settle(sim, world)
    expect(isWater(world.getVoxel(1, 1, 0))).toBe(true)
  })

  it('does not spread sideways while below is empty', () => {
    // A source at a cliff edge: the neighbor cell has a hole down to the floor.
    const { world } = makeWorld({ '0,3,0': Block.Water, '0,2,0': Block.Stone, '0,1,0': Block.Stone })
    const sim = new WaterSim()
    sim.wake(world, 0, 3, 0)
    settle(sim, world)

    // The neighbor at y=3 got water (spread over its support)…
    expect(isWater(world.getVoxel(1, 3, 0))).toBe(true)
    // …and it fell down as a same-level column instead of hanging.
    expect(waterLevel(world.getVoxel(1, 1, 0))).toBe(3)
  })

  it('respects the per-tick budget', () => {
    const { world } = makeWorld({ '0,1,0': Block.Water })
    const sim = new WaterSim()
    sim.wake(world, 0, 1, 0)
    // Budget 1: exactly one cell is processed per tick.
    sim.tick(world, 1)
    expect(sim.pending).toBeGreaterThan(0)
  })
})
