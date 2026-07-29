import type * as THREE from 'three'
import { WORLD } from '../config/tuning'
import type { Block } from './blocks'

const { chunkSizeX, chunkSizeY, chunkSizeZ } = WORLD
const LAYER = chunkSizeX * chunkSizeZ

/** Столбец чанка 16×64×16. Хранит только воксели, ничего не знает про рендер. */
export class Chunk {
  readonly data = new Uint8Array(chunkSizeX * chunkSizeY * chunkSizeZ)
  /** Меш устарел и его надо перестроить. */
  dirty = true
  /** Данные сгенерированы террагеном. */
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

  /** Локальные координаты внутри чанка. Выход за границы — ответственность вызывающего. */
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
