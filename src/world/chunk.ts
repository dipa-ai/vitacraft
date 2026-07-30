import type * as THREE from 'three'
import { WORLD } from '../config/tuning'
import type { Block } from './blocks'

const { chunkSizeX, chunkSizeY, chunkSizeZ } = WORLD
const LAYER = chunkSizeX * chunkSizeZ

/** A 16×64×16 chunk column. Stores voxels only; knows nothing about rendering. */
export class Chunk {
  readonly data = new Uint8Array(chunkSizeX * chunkSizeY * chunkSizeZ)
  /** The mesh is stale and needs a rebuild. */
  dirty = true
  /** Data has been produced by the terrain generator. */
  generated = false
  opaqueMesh: THREE.Mesh | null = null
  transparentMesh: THREE.Mesh | null = null

  constructor(
    readonly cx: number,
    readonly cz: number,
  ) {}

  static index(x: number, y: number, z: number): number {
    return y * LAYER + z * chunkSizeX + x
  }

  /** Chunk-local coordinates. Staying in bounds is the caller's responsibility. */
  get(x: number, y: number, z: number): Block {
    return this.data[y * LAYER + z * chunkSizeX + x] as Block
  }

  set(x: number, y: number, z: number, id: Block): void {
    this.data[y * LAYER + z * chunkSizeX + x] = id
  }
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`
}
