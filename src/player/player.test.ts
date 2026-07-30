import { describe, expect, it } from 'vitest'
import { PLAYER } from '../config/tuning'
import { Block, isSolid } from '../world/blocks'
import { Player, playerOverlapsBlock, type CollisionSource, type MoveInput } from './player'

/** Tiny world of listed blocks plus an infinite floor at y=0. */
function worldOf(cells: Record<string, Block>, floorY = 0): CollisionSource {
  const get = (x: number, y: number, z: number): Block => {
    if (y === floorY) return Block.Stone
    return cells[`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`] ?? Block.Air
  }
  return {
    getVoxel: get,
    isSolidAt: (x, y, z) => isSolid(get(x, y, z)),
  }
}

const idle: MoveInput = { forward: 0, right: 0, jump: false, run: false }

function input(partial: Partial<MoveInput>): MoveInput {
  return { ...idle, ...partial }
}

/** Runs fixed steps so the test does not depend on wall-clock time. */
function simulate(
  player: Player,
  world: CollisionSource,
  moveInput: MoveInput,
  seconds: number,
  dt = 1 / 60,
): void {
  const steps = Math.round(seconds / dt)
  for (let i = 0; i < steps; i++) player.update(dt, moveInput, world)
}

describe('player physics', () => {
  it('falls under gravity and lands on the floor', () => {
    const world = worldOf({})
    const player = new Player()
    player.respawn(0.5, 10, 0.5)

    simulate(player, world, idle, 2)

    // The floor occupies y=0, so the feet end up at y=1.
    expect(player.position.y).toBeCloseTo(1, 5)
    expect(player.onGround).toBe(true)
    expect(player.velocity.y).toBe(0)
  })

  it('walks forward along -Z at yaw = 0', () => {
    const world = worldOf({})
    const player = new Player()
    player.respawn(0.5, 1, 0.5)

    simulate(player, world, input({ forward: 1 }), 1)

    expect(player.position.z).toBeLessThan(-3)
    expect(player.position.x).toBeCloseTo(0.5, 5)
  })

  it('a 90° turn redirects movement', () => {
    const world = worldOf({})
    const player = new Player()
    player.respawn(0.5, 1, 0.5)
    // Positive yaw turns left, so forward heads toward -X.
    player.yaw = Math.PI / 2

    simulate(player, world, input({ forward: 1 }), 1)

    expect(player.position.x).toBeLessThan(-3)
    expect(player.position.z).toBeCloseTo(0.5, 5)
  })

  it('running is faster than walking', () => {
    const world = worldOf({})
    const walker = new Player()
    walker.respawn(0.5, 1, 0.5)
    const runner = new Player()
    runner.respawn(0.5, 1, 0.5)

    simulate(walker, world, input({ forward: 1 }), 1)
    simulate(runner, world, input({ forward: 1, run: true }), 1)

    expect(Math.abs(runner.position.z)).toBeGreaterThan(Math.abs(walker.position.z))
  })

  it('does not pass through a wall', () => {
    // A two-block-tall wall in front of the player, across the path.
    const cells: Record<string, Block> = {}
    for (let x = -3; x <= 3; x++) {
      for (let y = 1; y <= 3; y++) {
        cells[`${x},${y},-4`] = Block.Stone
      }
    }
    const world = worldOf(cells)
    const player = new Player()
    player.respawn(0.5, 1, 0.5)

    simulate(player, world, input({ forward: 1, run: true }), 3)

    // Stopped at the wall face z=-3, accounting for the player half-width.
    expect(player.position.z).toBeGreaterThan(-3)
    expect(player.position.z).toBeCloseTo(-3 + PLAYER.width / 2, 2)
  })

  it('slides along a wall instead of sticking in a corner', () => {
    // A wall along X: -Z movement is blocked, -X must remain free.
    const cells: Record<string, Block> = {}
    for (let x = -20; x <= 20; x++) {
      for (let y = 1; y <= 3; y++) {
        cells[`${x},${y},-4`] = Block.Stone
      }
    }
    const world = worldOf(cells)
    const player = new Player()
    player.respawn(0.5, 1, 0.5)
    // Walk forward and left at once, pressing into the wall.
    simulate(player, world, input({ forward: 1, right: -1 }), 2)

    expect(player.position.z).toBeGreaterThan(-3)
    // Despite the stop, the player slid a good distance along the wall.
    expect(player.position.x).toBeLessThan(-2)
  })

  it('jumps and returns to the same height', () => {
    const world = worldOf({})
    const player = new Player()
    player.respawn(0.5, 1, 0.5)
    simulate(player, world, idle, 0.2)

    player.update(1 / 60, input({ jump: true }), world)
    expect(player.velocity.y).toBeGreaterThan(0)

    simulate(player, world, idle, 2)
    expect(player.position.y).toBeCloseTo(1, 5)
    expect(player.onGround).toBe(true)
  })

  it('bumps its head on the ceiling mid-jump', () => {
    const cells: Record<string, Block> = {}
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        cells[`${x},4,${z}`] = Block.Stone
      }
    }
    const world = worldOf(cells)
    const player = new Player()
    player.respawn(0.5, 1, 0.5)
    simulate(player, world, idle, 0.2)
    simulate(player, world, input({ jump: true }), 0.5)

    // The head must not punch through the block at y=4.
    expect(player.position.y + PLAYER.height).toBeLessThanOrEqual(4)
  })

  it('does not fall through the floor even with a huge timestep', () => {
    const world = worldOf({})
    const player = new Player()
    player.respawn(0.5, 40, 0.5)

    // One monstrous frame: without substeps the player would fly through the floor.
    for (let i = 0; i < 10; i++) player.update(0.5, idle, world)

    expect(player.position.y).toBeCloseTo(1, 5)
  })

  it('falls slower in water than in air', () => {
    const water: Record<string, Block> = {}
    for (let y = 1; y <= 20; y++) water[`0,${y},0`] = Block.Water
    const inWater = new Player()
    inWater.respawn(0.5, 18, 0.5)
    const inAir = new Player()
    inAir.respawn(0.5, 18, 0.5)

    simulate(inWater, worldOf(water), idle, 0.5)
    simulate(inAir, worldOf({}), idle, 0.5)

    expect(inWater.position.y).toBeGreaterThan(inAir.position.y)
    expect(inWater.inWater).toBe(true)
  })

  it('invulnerability swallows a second consecutive hit', () => {
    const player = new Player()
    player.respawn(0, 1, 0)

    expect(player.takeDamage(2)).toBe(true)
    expect(player.health).toBe(PLAYER.maxHealth - 2)
    // An immediate second hit must not land.
    expect(player.takeDamage(2)).toBe(false)
    expect(player.health).toBe(PLAYER.maxHealth - 2)

    simulate(player, worldOf({}), idle, PLAYER.invulnerable + 0.1)
    expect(player.takeDamage(2)).toBe(true)
  })

  it('dies at zero health', () => {
    const player = new Player()
    player.respawn(0, 1, 0)
    player.takeDamage(PLAYER.maxHealth)
    expect(player.dead).toBe(true)
    expect(player.health).toBe(0)
  })
})

describe('playerOverlapsBlock', () => {
  it('detects a block inside the player box', () => {
    const position = { x: 0.5, y: 10, z: 0.5 } as never
    // A block right under the feet and one at body level.
    expect(playerOverlapsBlock(position, 0, 10, 0)).toBe(true)
    expect(playerOverlapsBlock(position, 0, 11, 0)).toBe(true)
  })

  it('does not count a block underfoot or to the side as overlap', () => {
    const position = { x: 0.5, y: 10, z: 0.5 } as never
    expect(playerOverlapsBlock(position, 0, 9, 0)).toBe(false)
    expect(playerOverlapsBlock(position, 3, 10, 0)).toBe(false)
    // A 1.8-tall player cannot reach the block at y=12.
    expect(playerOverlapsBlock(position, 0, 12, 0)).toBe(false)
  })
})
