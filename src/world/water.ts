import { WORLD } from '../config/tuning'
import { Block, isWater, waterByLevel, waterLevel } from './blocks'

/**
 * Симуляция воды.
 *
 * Правила намеренно простые: вниз вода течёт без потери уровня, по горизонтали — с
 * потерей (4 → 3 → 2 → 1), поэтому налитый пруд ограничивает себя сам, а не заливает
 * весь мир по одной высоте. Если под клеткой пусто, вбок она не растекается — сначала
 * падает. Обратного «высыхания» нет: для этой игры важно, чтобы вода вела себя
 * предсказуемо, а не реалистично.
 *
 * Работает очередью активных клеток с бюджетом на тик (по образцу очереди перестройки
 * мешей в World): вода течёт спокойно и не съедает кадр. Все изменения идут с
 * recordEdit=false — вода не пишется в сохранение, иначе дифф распух бы на порядок,
 * а после загрузки она всё равно стечёт заново из источников.
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

    // Вниз — без потери уровня. Пока внизу пусто, вбок не растекаемся.
    if (y > 0) {
      const below = world.getVoxel(x, y - 1, z)
      if (below === Block.Air || (isWater(below) && waterLevel(below) < level)) {
        world.setFluid(x, y - 1, z, id)
        this.enqueue(x, y - 1, z)
        // Источник остаётся активным: колонна воды заполняет яму до дна.
        this.enqueue(x, y, z)
        return
      }
    }

    // По горизонтали — с потерей уровня, пока есть что терять.
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
}
