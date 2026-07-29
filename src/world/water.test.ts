import { describe, expect, it } from 'vitest'
import { Block, isWater, waterLevel } from './blocks'
import { WaterSim, type WaterWorld } from './water'

/** Мир на Map: пол на y=0 и перечисленные блоки. */
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

/** Гоняет тики до успокоения очереди. */
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
  it('вода затекает в соседнюю яму', () => {
    // Источник на y=1, рядом яма глубиной 1 (пол только на y=-1 под ямой… проще:
    // источник стоит на полу, соседняя клетка на том же уровне пуста).
    const { world, map } = makeWorld({ '0,1,0': Block.Water })
    const sim = new WaterSim()
    sim.wake(world, 0, 1, 0)
    settle(sim, world)

    // Соседние клетки на уровне источника получили воду уровнем ниже.
    expect(isWater(world.getVoxel(1, 1, 0))).toBe(true)
    expect(waterLevel(world.getVoxel(1, 1, 0))).toBe(3)
    expect(countWater(map)).toBeGreaterThan(1)
  })

  it('не растекается бесконечно: уровень затухает за 3 шага', () => {
    const { world } = makeWorld({ '0,1,0': Block.Water })
    const sim = new WaterSim()
    sim.wake(world, 0, 1, 0)
    settle(sim, world)

    // 4 → 3 → 2 → 1: на четвёртом шаге воды уже нет.
    expect(waterLevel(world.getVoxel(1, 1, 0))).toBe(3)
    expect(waterLevel(world.getVoxel(2, 1, 0))).toBe(2)
    expect(waterLevel(world.getVoxel(3, 1, 0))).toBe(1)
    expect(world.getVoxel(4, 1, 0)).toBe(Block.Air)
  })

  it('вниз течёт без потери уровня и заполняет колодец', () => {
    // Колодец: столб пустоты с y=1 до y=5, источник наверху. Пол y=0.
    const { world } = makeWorld({ '0,5,0': Block.Water })
    const sim = new WaterSim()
    sim.wake(world, 0, 5, 0)
    settle(sim, world)

    for (let y = 1; y <= 5; y++) {
      expect(waterLevel(world.getVoxel(0, y, 0))).toBe(4)
    }
  })

  it('в замкнутом бассейне вода остаётся и не исчезает', () => {
    // Бассейн 1×3 со стенами.
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
    // За стены не вышло.
    expect(world.getVoxel(4, 1, 0)).toBe(Block.Air)
    expect(countWater(map)).toBe(3)
  })

  it('пробуждается от изменения соседнего блока', () => {
    // Вода за стенкой; стенку убрали — вода должна затечь.
    const { world } = makeWorld({ '0,1,0': Block.Water, '1,1,0': Block.Stone })
    const sim = new WaterSim()
    sim.wake(world, 0, 1, 0)
    settle(sim, world)
    expect(world.getVoxel(2, 1, 0)).toBe(Block.Air)

    // Ломаем стенку — wake зовётся из setVoxel мира.
    world.setFluid(1, 1, 0, Block.Air)
    sim.wake(world, 1, 1, 0)
    settle(sim, world)
    expect(isWater(world.getVoxel(1, 1, 0))).toBe(true)
  })

  it('пока внизу пусто, вбок не растекается', () => {
    // Источник на краю обрыва: под соседней клеткой дыра до пола.
    const { world } = makeWorld({ '0,3,0': Block.Water, '0,2,0': Block.Stone, '0,1,0': Block.Stone })
    const sim = new WaterSim()
    sim.wake(world, 0, 3, 0)
    settle(sim, world)

    // Соседняя клетка на y=3 получила воду (растеклась по опоре)…
    expect(isWater(world.getVoxel(1, 3, 0))).toBe(true)
    // …и упала вниз столбом того же уровня, а не осталась висеть.
    expect(waterLevel(world.getVoxel(1, 1, 0))).toBe(3)
  })

  it('соблюдает бюджет на тик', () => {
    const { world } = makeWorld({ '0,1,0': Block.Water })
    const sim = new WaterSim()
    sim.wake(world, 0, 1, 0)
    // Бюджет 1: за один тик обрабатывается ровно одна клетка.
    sim.tick(world, 1)
    expect(sim.pending).toBeGreaterThan(0)
  })
})
