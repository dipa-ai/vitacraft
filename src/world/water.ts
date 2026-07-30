import { WORLD } from '../config/tuning'
import { Block, isWater, waterByLevel, waterLevel } from './blocks'

/**
 * Water simulation.
 *
 * Water comes in two kinds: SOURCE (full level, only from terrain and the bucket) and
 * SPREAD water (levels 3…1) that a source produces around itself.
 *
 * Three rules make water controllable:
 *
 * 1. Downward, water MOVES rather than copies: break the block under water and it
 *    drains there, leaving the top empty. No free duplication.
 * 2. Horizontally a source spreads with level decay (4 → 3 → 2 → 1), so a pond
 *    limits itself.
 * 3. Spread water lives only while something feeds it — a higher-level neighbor or
 *    water above. Scoop the source and all spread water dries up on its own.
 *    A flooded house is fixed with a bucket, not demolition.
 *
 * Runs as a queue of active cells with a per-tick budget. All writes use
 * recordEdit=false — water is never saved; after loading it re-flows from sources.
 */

/** Everything the simulation needs from the world. Narrow so tests can pass a Map. */
export interface WaterWorld {
  getVoxel(x: number, y: number, z: number): Block
  /** Places a block without recording it into the player's edit diff. */
  setFluid(x: number, y: number, z: number, id: Block): void
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

export class WaterSim {
  private readonly queue: number[] = []
  private readonly queued = new Set<string>()
  private accumulator = 0

  /**
   * Wakes a cell and its water neighbors. Called on any block change: dig next to
   * a lake and the adjacent water wakes up and flows into the hole.
   */
  wake(world: WaterWorld, x: number, y: number, z: number): void {
    this.wakeIfWater(world, x, y, z)
    this.wakeIfWater(world, x + 1, y, z)
    this.wakeIfWater(world, x - 1, y, z)
    this.wakeIfWater(world, x, y + 1, z)
    this.wakeIfWater(world, x, y - 1, z)
    this.wakeIfWater(world, x, y, z + 1)
    this.wakeIfWater(world, x, y, z - 1)
  }

  private wakeIfWater(world: WaterWorld, x: number, y: number, z: number): void {
    if (isWater(world.getVoxel(x, y, z))) this.enqueue(x, y, z)
  }

  private enqueue(x: number, y: number, z: number): void {
    const key = `${x},${y},${z}`
    if (this.queued.has(key)) return
    this.queued.add(key)
    this.queue.push(x, y, z)
  }

  /** How many cells are pending — handy for tests and debugging. */
  get pending(): number {
    return this.queue.length / 3
  }

  update(dt: number, world: WaterWorld): void {
    this.accumulator += dt
    // Don't let the accumulator run away after a lag spike: at most two ticks per frame.
    this.accumulator = Math.min(this.accumulator, WORLD.waterTick * 2)
    while (this.accumulator >= WORLD.waterTick) {
      this.accumulator -= WORLD.waterTick
      this.tick(world)
    }
  }

  /** One budgeted tick. A separate method so tests can drive it directly. */
  tick(world: WaterWorld, budget: number = WORLD.waterBudget): void {
    let processed = 0
    while (processed < budget && this.queue.length >= 3) {
      const x = this.queue.shift()!
      const y = this.queue.shift()!
      const z = this.queue.shift()!
      this.queued.delete(`${x},${y},${z}`)
      this.flow(world, x, y, z)
      processed++
    }
  }

  private flow(world: WaterWorld, x: number, y: number, z: number): void {
    const id = world.getVoxel(x, y, z)
    if (!isWater(id)) return
    const level = waterLevel(id)

    // 1. Downward by moving, not copying: volume is conserved, water drains.
    if (y > 0) {
      const below = world.getVoxel(x, y - 1, z)
      if (below === Block.Air || (isWater(below) && waterLevel(below) < level)) {
        world.setFluid(x, y - 1, z, id)
        world.setFluid(x, y, z, Block.Air)
        this.enqueue(x, y - 1, z)
        this.wakeWaterAround(world, x, y, z)
        return
      }
    }

    // 2. Drying: unfed spread water disappears. A source never dries.
    if (level < 4) {
      const support = this.supportFor(world, x, y, z)
      if (level > support) {
        world.setFluid(x, y, z, waterByLevel(support))
        this.wakeWaterAround(world, x, y, z)
        if (support > 0) this.enqueue(x, y, z)
        return
      }
    }

    // 3. Horizontally with level decay, while there is level left to lose.
    if (level <= 1) return
    const spreadId = waterByLevel(level - 1)
    for (const [dx, dz] of DIRS) {
      const nx = x + dx
      const nz = z + dz
      const neighbor = world.getVoxel(nx, y, nz)
      if (neighbor === Block.Air || (isWater(neighbor) && waterLevel(neighbor) < level - 1)) {
        world.setFluid(nx, y, nz, spreadId)
        this.enqueue(nx, y, nz)
      }
    }
  }

  /** What feeds a cell: water above or a higher-level neighbor to the side. */
  private supportFor(world: WaterWorld, x: number, y: number, z: number): number {
    let support = isWater(world.getVoxel(x, y + 1, z)) ? 3 : 0
    for (const [dx, dz] of DIRS) {
      support = Math.max(support, waterLevel(world.getVoxel(x + dx, y, z + dz)) - 1)
    }
    return support
  }

  /** Wakes a cell's water neighbors — they recompute after a move or dry-out. */
  private wakeWaterAround(world: WaterWorld, x: number, y: number, z: number): void {
    this.wakeIfWater(world, x + 1, y, z)
    this.wakeIfWater(world, x - 1, y, z)
    this.wakeIfWater(world, x, y, z + 1)
    this.wakeIfWater(world, x, y, z - 1)
    this.wakeIfWater(world, x, y + 1, z)
    this.wakeIfWater(world, x, y - 1, z)
  }
}
