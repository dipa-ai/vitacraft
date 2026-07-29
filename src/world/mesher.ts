import { AO_LEVELS, FACE_TINT } from '../config/palette'
import { WORLD } from '../config/tuning'
import { Block, blockDef, isBed, isDoor, isOpaque, isWater, waterLevel } from './blocks'

/**
 * Мешер чанка: строит геометрию с отсечением невидимых граней и запечённым в vertex colors
 * ambient occlusion. Основа взята из официального мануала Three.js
 * (manual/examples/voxel-geometry-culled-faces-ui.html) и доработана под наш случай:
 * текстур нет, поэтому вместо атрибута uv пишем color.
 *
 * AO здесь не украшение, а необходимость: без него два соседних блока одного цвета
 * сливаются в неразличимую кашу, и мир перестаёт читаться.
 *
 * Функция чистая — знает о мире только через reader, поэтому её легко тестировать
 * и при необходимости унести в Web Worker.
 */

/** Доступ к воксeлю в мировых координатах. Позволяет корректно смешивать границы чанков. */
export type VoxelReader = (x: number, y: number, z: number) => Block

export interface MeshData {
  positions: Float32Array
  normals: Float32Array
  /**
   * RGBA по вершине, itemSize 4. Альфа нужна, чтобы стекло и вода имели разную
   * прозрачность внутри одного прохода рендера и одного материала.
   */
  colors: Float32Array
  indices: Uint32Array
}

/** Число компонент в атрибуте color. */
export const COLOR_COMPONENTS = 4

export interface ChunkMeshResult {
  /** Непрозрачная геометрия. null, если чанк пустой. */
  opaque: MeshData | null
  /** Вода и стекло — рисуются отдельным проходом для корректной прозрачности. */
  transparent: MeshData | null
}

type Vec3 = readonly [number, number, number]

interface FaceDef {
  readonly dir: Vec3
  /** Порядок углов задаёт триангуляцию (0,1,2) + (2,1,3) с наружной намоткой. */
  readonly corners: readonly Vec3[]
  readonly tint: number
  /** Две оси, вдоль которых лежит грань — по ним ищем соседей для AO. */
  readonly axisA: 0 | 1 | 2
  readonly axisB: 0 | 1 | 2
  readonly isTop: boolean
  readonly isBottom: boolean
}

const FACES: readonly FaceDef[] = [
  {
    dir: [-1, 0, 0],
    corners: [
      [0, 1, 0],
      [0, 0, 0],
      [0, 1, 1],
      [0, 0, 1],
    ],
    tint: FACE_TINT.west,
    axisA: 1,
    axisB: 2,
    isTop: false,
    isBottom: false,
  },
  {
    dir: [1, 0, 0],
    corners: [
      [1, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
      [1, 0, 0],
    ],
    tint: FACE_TINT.east,
    axisA: 1,
    axisB: 2,
    isTop: false,
    isBottom: false,
  },
  {
    dir: [0, -1, 0],
    corners: [
      [1, 0, 1],
      [0, 0, 1],
      [1, 0, 0],
      [0, 0, 0],
    ],
    tint: FACE_TINT.bottom,
    axisA: 0,
    axisB: 2,
    isTop: false,
    isBottom: true,
  },
  {
    dir: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [0, 1, 0],
      [1, 1, 0],
    ],
    tint: FACE_TINT.top,
    axisA: 0,
    axisB: 2,
    isTop: true,
    isBottom: false,
  },
  {
    dir: [0, 0, -1],
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
    tint: FACE_TINT.north,
    axisA: 0,
    axisB: 1,
    isTop: false,
    isBottom: false,
  },
  {
    dir: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
    ],
    tint: FACE_TINT.south,
    axisA: 0,
    axisB: 1,
    isTop: false,
    isBottom: false,
  },
]

const AXIS: readonly Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

/** Перевод sRGB-компоненты в линейное пространство — иначе цвета выцветают на свету. */
function srgbToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4)
}

/**
 * Микро-вариация яркости на воксель. Детерминированная, чтобы меш не мерцал при
 * перестройке. Разбивает крупные однотонные плоскости, которые иначе читаются как
 * одно плоское пятно цвета. Амплитуда берётся из блока: у природных блоков заметная,
 * у блоков для стройки почти нулевая — иначе дома игрока выглядят грязными.
 */
function voxelJitter(x: number, y: number, z: number, amplitude: number): number {
  if (amplitude === 0) return 1
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h = h ^ (h >>> 16)
  const unit = ((h >>> 0) % 1024) / 1023 - 0.5
  return 1 + unit * 2 * amplitude
}

/**
 * AO угла грани по трём соседям в плоскости этой грани.
 * Классическая схема: два бока перекрыты → максимальное затенение.
 */
function cornerAO(
  reader: VoxelReader,
  bx: number,
  by: number,
  bz: number,
  corner: Vec3,
  axisA: 0 | 1 | 2,
  axisB: 0 | 1 | 2,
): number {
  const da = corner[axisA] * 2 - 1
  const db = corner[axisB] * 2 - 1
  const oa = AXIS[axisA]
  const ob = AXIS[axisB]

  const s1 = isOpaque(reader(bx + oa[0] * da, by + oa[1] * da, bz + oa[2] * da)) ? 1 : 0
  const s2 = isOpaque(reader(bx + ob[0] * db, by + ob[1] * db, bz + ob[2] * db)) ? 1 : 0
  if (s1 === 1 && s2 === 1) return 0

  const cn = isOpaque(
    reader(
      bx + oa[0] * da + ob[0] * db,
      by + oa[1] * da + ob[1] * db,
      bz + oa[2] * da + ob[2] * db,
    ),
  )
    ? 1
    : 0
  return 3 - (s1 + s2 + cn)
}

/** Накопитель геометрии одного прохода рендера. */
class Builder {
  positions: number[] = []
  normals: number[] = []
  colors: number[] = []
  indices: number[] = []

  get empty(): boolean {
    return this.indices.length === 0
  }

  toMeshData(): MeshData {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
      indices: new Uint32Array(this.indices),
    }
  }
}

/**
 * Строит геометрию чанка. Координаты вершин локальны для чанка — мировое смещение
 * задаётся позицией меша, так что float не теряет точность на больших координатах.
 */
export function meshChunk(chunkX: number, chunkZ: number, reader: VoxelReader): ChunkMeshResult {
  const { chunkSizeX, chunkSizeY, chunkSizeZ } = WORLD
  const opaque = new Builder()
  const transparent = new Builder()

  const originX = chunkX * chunkSizeX
  const originZ = chunkZ * chunkSizeZ

  for (let y = 0; y < chunkSizeY; y++) {
    for (let z = 0; z < chunkSizeZ; z++) {
      for (let x = 0; x < chunkSizeX; x++) {
        const wx = originX + x
        const wy = y
        const wz = originZ + z
        const id = reader(wx, wy, wz)
        if (id === Block.Air) continue
        // Двери рисуются отдельными мешами (см. render/doors.ts), а не кубами.
        if (isDoor(id)) continue

        const def = blockDef(id)
        const target = def.transparent === true ? transparent : opaque
        const water = isWater(id)
        // Высота поверхности: у воды зависит от уровня (лужа читается как лужа),
        // у частичных блоков (кроватка, грядка) берётся из реестра.
        let yTop = def.height ?? 1.0
        if (water) {
          const waterAbove = isWater(reader(wx, wy + 1, wz))
          yTop = waterAbove ? 1.0 : 0.4 + waterLevel(id) * 0.12
        }
        const jitter = voxelJitter(wx, wy, wz, def.variation ?? 0)

        for (const face of FACES) {
          const nx = wx + face.dir[0]
          const ny = wy + face.dir[1]
          const nz = wz + face.dir[2]
          const neighbor = reader(nx, ny, nz)
          // Грань не нужна, если сосед её полностью закрывает или это тот же блок
          // (так гасятся внутренние грани воды и стекла).
          if (isOpaque(neighbor) || neighbor === id) continue
          // Между двумя водами грань рисует только более высокая сторона, иначе на
          // границе уровней два копланарных квада мерцают друг о друга.
          if (water && isWater(neighbor) && waterLevel(neighbor) >= waterLevel(id)) continue
          // Половины кроватки — один предмет: внутренняя грань между ними не нужна.
          if (isBed(id) && isBed(neighbor)) continue

          const hex = face.isTop
            ? def.topColor ?? def.color
            : face.isBottom
              ? def.bottomColor ?? def.color
              : def.color
          const alpha = def.opacity ?? 1
          // glow > 1 выводит цвет за единицу — его подхватывает порог блума.
          const shade = face.tint * jitter * (def.glow ?? 1)
          const baseR = srgbToLinear(((hex >> 16) & 0xff) / 255) * shade
          const baseG = srgbToLinear(((hex >> 8) & 0xff) / 255) * shade
          const baseB = srgbToLinear((hex & 0xff) / 255) * shade

          const ndx = target.positions.length / 3
          const ao: number[] = []

          for (const corner of face.corners) {
            target.positions.push(
              x + corner[0],
              y + (corner[1] === 1 ? yTop : 0),
              z + corner[2],
            )
            target.normals.push(face.dir[0], face.dir[1], face.dir[2])

            // У воды и стекла AO выглядит грязно, поэтому считаем его только для
            // непрозрачных блоков.
            const level =
              def.transparent === true
                ? 1
                : AO_LEVELS[cornerAO(reader, nx, ny, nz, corner, face.axisA, face.axisB)]
            ao.push(level)
            target.colors.push(baseR * level, baseG * level, baseB * level, alpha)
          }

          // Квад режется на два треугольника, и при разном AO по диагоналям появляется
          // характерный «излом». Разворот диагонали убирает его.
          const flip = ao[0] + ao[3] > ao[1] + ao[2]
          if (flip) {
            target.indices.push(ndx, ndx + 1, ndx + 3, ndx, ndx + 3, ndx + 2)
          } else {
            target.indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3)
          }
        }
      }
    }
  }

  return {
    opaque: opaque.empty ? null : opaque.toMeshData(),
    transparent: transparent.empty ? null : transparent.toMeshData(),
  }
}
