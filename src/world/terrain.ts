import { createNoise2D } from 'simplex-noise'
import { WORLD } from '../config/tuning'
import { Block } from './blocks'
import { Chunk } from './chunk'

const { chunkSizeX, chunkSizeY, chunkSizeZ, seaLevel } = WORLD

/** Детерминированный PRNG, чтобы один и тот же сид всегда давал один и тот же мир. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Детерминированный хеш столбца — для деревьев и кустов без хранения состояния. */
function hash2(x: number, z: number, salt: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(salt, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Максимальный вылет кроны за пределы столбца — на столько расширяем зону обхода. */
const TREE_REACH = 3

export class TerrainGenerator {
  private readonly hills: ReturnType<typeof createNoise2D>
  private readonly rough: ReturnType<typeof createNoise2D>
  private readonly detail: ReturnType<typeof createNoise2D>

  constructor(seed: number = WORLD.seed) {
    const rng = mulberry32(seed)
    this.hills = createNoise2D(rng)
    this.rough = createNoise2D(rng)
    this.detail = createNoise2D(rng)
  }

  /** Высота верхнего твёрдого блока в столбце. */
  surfaceHeight(x: number, z: number): number {
    let h =
      seaLevel +
      2 +
      this.hills(x * 0.008, z * 0.008) * 12 +
      this.rough(x * 0.03, z * 0.03) * 4 +
      this.detail(x * 0.09, z * 0.09) * 1.5

    // Площадку вокруг спавна выравниваем и поднимаем над водой: вся деревня строится
    // именно здесь, и стартовать в океане или на отвесном склоне — плохой первый кадр.
    const distance = Math.hypot(x, z)
    const blend = smoothstep(16, 48, distance)
    h = (seaLevel + 4) * (1 - blend) + h * blend

    return Math.max(1, Math.min(chunkSizeY - 10, Math.round(h)))
  }

  /** Заполняет чанк рельефом, водой и растительностью. */
  generate(chunk: Chunk): void {
    const originX = chunk.cx * chunkSizeX
    const originZ = chunk.cz * chunkSizeZ

    for (let z = 0; z < chunkSizeZ; z++) {
      for (let x = 0; x < chunkSizeX; x++) {
        const wx = originX + x
        const wz = originZ + z
        const h = this.surfaceHeight(wx, wz)
        const underwater = h < seaLevel

        for (let y = 0; y <= h; y++) {
          let id: Block
          if (y === 0) id = Block.Stone
          else if (y < h - 3) id = Block.Stone
          else if (y < h) id = Block.Dirt
          else id = underwater || h <= seaLevel + 1 ? Block.Sand : Block.Grass
          chunk.set(x, y, z, id)
        }

        for (let y = h + 1; y <= seaLevel; y++) {
          chunk.set(x, y, z, Block.Water)
        }
      }
    }

    this.decorate(chunk)
  }

  /**
   * Деревья и кустики. Обходим область шире чанка, чтобы дерево, выросшее у соседа,
   * дотягивалось кроной в этот чанк — иначе на границах чанков кроны обрубались бы.
   */
  private decorate(chunk: Chunk): void {
    const originX = chunk.cx * chunkSizeX
    const originZ = chunk.cz * chunkSizeZ

    for (let dz = -TREE_REACH; dz < chunkSizeZ + TREE_REACH; dz++) {
      for (let dx = -TREE_REACH; dx < chunkSizeX + TREE_REACH; dx++) {
        const wx = originX + dx
        const wz = originZ + dz
        const h = this.surfaceHeight(wx, wz)
        if (h <= seaLevel + 1) continue

        // Рядом со спавном деревья не ставим — площадка должна остаться свободной
        // под стройку деревни.
        if (Math.hypot(wx, wz) < 14) continue

        if (hash2(wx, wz, 7) < 0.014) {
          this.placeTree(chunk, wx, h + 1, wz)
        } else if (hash2(wx, wz, 23) < 0.01) {
          this.setWorld(chunk, wx, h + 1, wz, Block.Blossom)
        } else if (hash2(Math.floor(wx / 3), Math.floor(wz / 3), 67) < 0.045 && hash2(wx, wz, 71) < 0.65) {
          // Морковные грядки кустятся пятнами 3×3 (хеш по ячейке), а не поодиночке:
          // одну грядку в поле не найти, а пятно видно издалека.
          this.setWorld(chunk, wx, h + 1, wz, Block.CarrotPlant)
        }
      }
    }
  }

  private placeTree(chunk: Chunk, wx: number, baseY: number, wz: number): void {
    const trunkHeight = 4 + Math.floor(hash2(wx, wz, 41) * 3)
    const blossomTree = hash2(wx, wz, 59) < 0.35

    for (let i = 0; i < trunkHeight; i++) {
      this.setWorld(chunk, wx, baseY + i, wz, Block.Wood)
    }

    const crownY = baseY + trunkHeight
    const leaf = blossomTree ? Block.Blossom : Block.Leaves

    // Крона — сглаженный блоб: срезаем углы, иначе получается куб на палке.
    for (let dy = -1; dy <= 2; dy++) {
      const radius = dy === 2 ? 1 : dy === -1 ? 2 : 2
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) === radius && Math.abs(dz) === radius && radius > 1) continue
          if (dy === 2 && Math.abs(dx) + Math.abs(dz) > 1) continue
          this.setWorld(chunk, wx + dx, crownY + dy, wz + dz, leaf, true)
        }
      }
    }
  }

  /**
   * Пишет блок в мировых координатах, молча игнорируя всё за пределами этого чанка.
   * Так одна и та же процедура постройки дерева работает из любого соседнего чанка.
   */
  private setWorld(
    chunk: Chunk,
    wx: number,
    wy: number,
    wz: number,
    id: Block,
    onlyIfEmpty = false,
  ): void {
    if (wy < 0 || wy >= chunkSizeY) return
    const lx = wx - chunk.cx * chunkSizeX
    const lz = wz - chunk.cz * chunkSizeZ
    if (lx < 0 || lx >= chunkSizeX || lz < 0 || lz >= chunkSizeZ) return
    if (onlyIfEmpty && chunk.get(lx, wy, lz) !== Block.Air) return
    chunk.set(lx, wy, lz, id)
  }
}
