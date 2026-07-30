import { AO_LEVELS, FACE_TINT } from '../config/palette'
import { WORLD } from '../config/tuning'
import { Block, blockDef, isBed, isDoor, isOpaque, isWater, waterLevel } from './blocks'

/**
 * Chunk mesher: builds geometry with hidden-face culling and ambient occlusion baked
 * into vertex colors. Based on the official Three.js manual
 * (manual/examples/voxel-geometry-culled-faces-ui.html), adapted for our case:
 * there are no textures, so we write a color attribute instead of uv.
 *
 * AO is not decoration here but a necessity: without it two same-colored neighbors
 * merge into an unreadable mush and the world stops parsing visually.
 *
 * The function is pure — it sees the world only through the reader, which makes it
 * easy to test and, if needed, to move into a Web Worker.
 */

/** Voxel access in world coordinates. Lets chunk borders mesh correctly. */
export type VoxelReader = (x: number, y: number, z: number) => Block

export interface MeshData {
  positions: Float32Array
  normals: Float32Array
  /**
   * Per-vertex RGBA, itemSize 4. Alpha lets glass and water have different opacity
   * within a single render pass and a single material.
   */
  colors: Float32Array
  indices: Uint32Array
}

/** Component count of the color attribute. */
export const COLOR_COMPONENTS = 4

export interface ChunkMeshResult {
  /** Opaque geometry. Null when the chunk is empty. */
  opaque: MeshData | null
  /** Water and glass — drawn in a separate pass for correct transparency. */
  transparent: MeshData | null
}

type Vec3 = readonly [number, number, number]

interface FaceDef {
  readonly dir: Vec3
  /** Corner order defines triangulation (0,1,2) + (2,1,3) with outward winding. */
  readonly corners: readonly Vec3[]
  readonly tint: number
  /** The two axes the face lies along — AO neighbors are sampled along them. */
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

/** sRGB component to linear space — otherwise colors wash out in the light. */
function srgbToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4)
}

/**
 * Per-voxel brightness micro-variation. Deterministic so meshes don't shimmer on
 * rebuild. It breaks up large flat-colored planes that would otherwise read as one
 * flat blob. The amplitude comes from the block: noticeable on natural blocks and
 * near-zero on building blocks — otherwise player houses look dirty.
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
 * Face-corner AO from the three neighbors in the face's plane.
 * The classic scheme: both sides occluded → maximum darkening.
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

/** Geometry accumulator for one render pass. */
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
 * Builds chunk geometry. Vertex coordinates are chunk-local — the world offset comes
 * from the mesh position, so floats keep precision at large coordinates.
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
        // Doors are drawn as separate meshes (see render/doors.ts), not cubes.
        if (isDoor(id)) continue

        const def = blockDef(id)
        const target = def.transparent === true ? transparent : opaque
        const water = isWater(id)
        // Surface height: water derives it from its level (a puddle reads as a
        // puddle); partial blocks (bed, carrot patch) take it from the registry.
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
          // The face is unnecessary if the neighbor fully covers it or is the same
          // block (this culls interior faces of water and glass).
          if (isOpaque(neighbor) || neighbor === id) continue
          // Between two waters only the higher side draws the face, or two coplanar
          // quads z-fight at the level boundary.
          if (water && isWater(neighbor) && waterLevel(neighbor) >= waterLevel(id)) continue
          // Bed halves are one item: no interior face between them.
          if (isBed(id) && isBed(neighbor)) continue

          const hex = face.isTop
            ? def.topColor ?? def.color
            : face.isBottom
              ? def.bottomColor ?? def.color
              : def.color
          const alpha = def.opacity ?? 1
          // glow > 1 pushes color past 1.0 — the bloom threshold picks it up.
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

            // AO looks dirty on water and glass, so it is computed only for
            // opaque blocks.
            const level =
              def.transparent === true
                ? 1
                : AO_LEVELS[cornerAO(reader, nx, ny, nz, corner, face.axisA, face.axisB)]
            ao.push(level)
            target.colors.push(baseR * level, baseG * level, baseB * level, alpha)
          }

          // The quad splits into two triangles, and unequal diagonal AO creates the
          // telltale crease. Flipping the diagonal removes it.
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
