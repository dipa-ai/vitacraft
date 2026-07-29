import { describe, expect, it } from 'vitest'
import { PLAYER } from '../config/tuning'
import { Block, isSolid } from '../world/blocks'
import { Player, playerOverlapsBlock, type CollisionSource, type MoveInput } from './player'

/** Крошечный мир из перечисленных блоков плюс бесконечный пол на y=0. */
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

/** Прогоняет фиксированные шаги — так тест не зависит от реального времени. */
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

describe('физика игрока', () => {
  it('падает под гравитацией и встаёт на пол', () => {
    const world = worldOf({})
    const player = new Player()
    player.respawn(0.5, 10, 0.5)

    simulate(player, world, idle, 2)

    // Пол занимает y=0, значит ступни оказываются на y=1.
    expect(player.position.y).toBeCloseTo(1, 5)
    expect(player.onGround).toBe(true)
    expect(player.velocity.y).toBe(0)
  })

  it('идёт вперёд по -Z при yaw = 0', () => {
    const world = worldOf({})
    const player = new Player()
    player.respawn(0.5, 1, 0.5)

    simulate(player, world, input({ forward: 1 }), 1)

    expect(player.position.z).toBeLessThan(-3)
    expect(player.position.x).toBeCloseTo(0.5, 5)
  })

  it('поворот на 90° разворачивает направление хода', () => {
    const world = worldOf({})
    const player = new Player()
    player.respawn(0.5, 1, 0.5)
    // Положительный yaw поворачивает влево, значит «вперёд» уходит в -X.
    player.yaw = Math.PI / 2

    simulate(player, world, input({ forward: 1 }), 1)

    expect(player.position.x).toBeLessThan(-3)
    expect(player.position.z).toBeCloseTo(0.5, 5)
  })

  it('бег быстрее шага', () => {
    const world = worldOf({})
    const walker = new Player()
    walker.respawn(0.5, 1, 0.5)
    const runner = new Player()
    runner.respawn(0.5, 1, 0.5)

    simulate(walker, world, input({ forward: 1 }), 1)
    simulate(runner, world, input({ forward: 1, run: true }), 1)

    expect(Math.abs(runner.position.z)).toBeGreaterThan(Math.abs(walker.position.z))
  })

  it('не проходит сквозь стену', () => {
    // Стена из двух блоков в высоту перед игроком, поперёк его пути.
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

    // Упор в грань стены z=-3 с учётом полутолщины игрока.
    expect(player.position.z).toBeGreaterThan(-3)
    expect(player.position.z).toBeCloseTo(-3 + PLAYER.width / 2, 2)
  })

  it('скользит вдоль стены, а не застревает в углу', () => {
    // Стена вдоль X: движение по -Z блокируется, по -X должно остаться свободным.
    const cells: Record<string, Block> = {}
    for (let x = -20; x <= 20; x++) {
      for (let y = 1; y <= 3; y++) {
        cells[`${x},${y},-4`] = Block.Stone
      }
    }
    const world = worldOf(cells)
    const player = new Player()
    player.respawn(0.5, 1, 0.5)
    // Идём вперёд и влево одновременно, упираясь в стену.
    simulate(player, world, input({ forward: 1, right: -1 }), 2)

    expect(player.position.z).toBeGreaterThan(-3)
    // Несмотря на упор, вдоль стены игрок уехал заметно далеко.
    expect(player.position.x).toBeLessThan(-2)
  })

  it('прыгает и возвращается на ту же высоту', () => {
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

  it('в прыжке упирается головой в потолок', () => {
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

    // Макушка не должна пробить блок на y=4.
    expect(player.position.y + PLAYER.height).toBeLessThanOrEqual(4)
  })

  it('не проваливается сквозь пол даже при огромном шаге времени', () => {
    const world = worldOf({})
    const player = new Player()
    player.respawn(0.5, 40, 0.5)

    // Один чудовищный кадр: без подшагов игрок пролетел бы пол насквозь.
    for (let i = 0; i < 10; i++) player.update(0.5, idle, world)

    expect(player.position.y).toBeCloseTo(1, 5)
  })

  it('в воде падает медленнее, чем в воздухе', () => {
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

  it('неуязвимость глотает второй удар подряд', () => {
    const player = new Player()
    player.respawn(0, 1, 0)

    expect(player.takeDamage(2)).toBe(true)
    expect(player.health).toBe(PLAYER.maxHealth - 2)
    // Сразу же второй удар не должен пройти.
    expect(player.takeDamage(2)).toBe(false)
    expect(player.health).toBe(PLAYER.maxHealth - 2)

    simulate(player, worldOf({}), idle, PLAYER.invulnerable + 0.1)
    expect(player.takeDamage(2)).toBe(true)
  })

  it('умирает при нулевом здоровье', () => {
    const player = new Player()
    player.respawn(0, 1, 0)
    player.takeDamage(PLAYER.maxHealth)
    expect(player.dead).toBe(true)
    expect(player.health).toBe(0)
  })
})

describe('playerOverlapsBlock', () => {
  it('находит блок, попадающий внутрь коробки игрока', () => {
    const position = { x: 0.5, y: 10, z: 0.5 } as never
    // Блок ровно под ногами игрока и на уровне его тела.
    expect(playerOverlapsBlock(position, 0, 10, 0)).toBe(true)
    expect(playerOverlapsBlock(position, 0, 11, 0)).toBe(true)
  })

  it('не считает пересечением блок под ногами или в стороне', () => {
    const position = { x: 0.5, y: 10, z: 0.5 } as never
    expect(playerOverlapsBlock(position, 0, 9, 0)).toBe(false)
    expect(playerOverlapsBlock(position, 3, 10, 0)).toBe(false)
    // Игрок высотой 1.8 не достаёт до блока на y=12.
    expect(playerOverlapsBlock(position, 0, 12, 0)).toBe(false)
  })
})
