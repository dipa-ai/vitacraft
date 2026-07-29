import { WORLD } from '../config/tuning'
import { Block, isWater, waterByLevel, waterLevel } from './blocks'

/**
 * Симуляция воды.
 *
 * Вода двух сортов: ИСТОЧНИК (полный уровень, только из террагена и ведра) и
 * РАСТЁКШАЯСЯ (уровни 3…1), которую источник порождает вокруг себя.
 *
 * Три правила, дающие управляемую воду:
 *
 * 1. Вниз вода ПЕРЕМЕЩАЕТСЯ, а не копируется: разбил блок под водой — она утекла
 *    туда, наверху пусто. Никакого бесплатного удвоения.
 * 2. По горизонтали источник растекается с потерей уровня (4 → 3 → 2 → 1), поэтому
 *    пруд ограничивает себя сам.
 * 3. Растёкшаяся вода живёт только пока её кто-то подпитывает — сосед уровнем выше
 *    или вода сверху. Вычерпал источник — всё растёкшееся высыхает само. Затопленный
 *    дом лечится ведром, а не сносом.
 *
 * Работает очередью активных клеток с бюджетом на тик. Все изменения идут с
 * recordEdit=false — вода не пишется в сохранение, после загрузки она стечёт заново
 * из источников.
 */

/** Всё, что нужно симуляции от мира. Узкий интерфейс — тесты подсовывают Map. */
export interface WaterWorld {
  getVoxel(x: number, y: number, z: number): Block
  /** Ставит блок без записи в дифф игрока. */
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
   * Будит клетку и её водных соседей. Зовётся при любом изменении блока: копнул рядом
   * с озером — соседняя вода просыпается и затекает в яму.
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

  /** Сколько клеток ждёт обработки — удобно для тестов и отладки. */
  get pending(): number {
    return this.queue.length / 3
  }

  update(dt: number, world: WaterWorld): void {
    this.accumulator += dt
    // Не даём накопителю разгоняться после лага: максимум два тика за кадр.
    this.accumulator = Math.min(this.accumulator, WORLD.waterTick * 2)
    while (this.accumulator >= WORLD.waterTick) {
      this.accumulator -= WORLD.waterTick
      this.tick(world)
    }
  }

  /** Один тик с бюджетом. Отдельным методом — тесты гоняют его напрямую. */
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

    // 1. Вниз — перемещением, а не копией: объём сохраняется, вода «утекает».
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

    // 2. Высыхание: растёкшаяся вода без подпитки исчезает. Источник не сохнет никогда.
    if (level < 4) {
      const support = this.supportFor(world, x, y, z)
      if (level > support) {
        world.setFluid(x, y, z, waterByLevel(support))
        this.wakeWaterAround(world, x, y, z)
        if (support > 0) this.enqueue(x, y, z)
        return
      }
    }

    // 3. По горизонтали — с потерей уровня, пока есть что терять.
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

  /** Чем клетку подпитывают соседи: вода сверху или сосед уровнем выше сбоку. */
  private supportFor(world: WaterWorld, x: number, y: number, z: number): number {
    let support = isWater(world.getVoxel(x, y + 1, z)) ? 3 : 0
    for (const [dx, dz] of DIRS) {
      support = Math.max(support, waterLevel(world.getVoxel(x + dx, y, z + dz)) - 1)
    }
    return support
  }

  /** Будит водных соседей клетки — после перемещения или высыхания они пересчитываются. */
  private wakeWaterAround(world: WaterWorld, x: number, y: number, z: number): void {
    this.wakeIfWater(world, x + 1, y, z)
    this.wakeIfWater(world, x - 1, y, z)
    this.wakeIfWater(world, x, y, z + 1)
    this.wakeIfWater(world, x, y, z - 1)
    this.wakeIfWater(world, x, y + 1, z)
    this.wakeIfWater(world, x, y - 1, z)
  }
}
