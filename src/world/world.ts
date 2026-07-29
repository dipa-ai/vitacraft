import * as THREE from 'three'
import { WORLD } from '../config/tuning'
import { Block, isSolid } from './blocks'
import { Chunk, chunkKey } from './chunk'
import { COLOR_COMPONENTS, meshChunk, type MeshData, type VoxelReader } from './mesher'
import { TerrainGenerator } from './terrain'
import { WaterSim, type WaterWorld } from './water'

const { chunkSizeX, chunkSizeY, chunkSizeZ, viewRadius, remeshPerFrame } = WORLD

/** Из мировой координаты в координату чанка. */
export function toChunkCoord(v: number): number {
  return Math.floor(v / chunkSizeX)
}

export class World {
  readonly group = new THREE.Group()
  readonly terrain: TerrainGenerator

  private readonly chunks = new Map<string, Chunk>()
  private readonly remeshQueue: Chunk[] = []
  private readonly opaqueMaterial: THREE.MeshLambertMaterial
  private readonly transparentMaterial: THREE.MeshLambertMaterial

  /** Блоки, изменённые игроком — только они попадают в сохранение. */
  readonly edits = new Map<string, Block>()

  readonly water = new WaterSim()
  /** Узкий доступ для симуляции воды: пишет без записи в дифф игрока. */
  private readonly waterAccess: WaterWorld = {
    getVoxel: (x, y, z) => this.reader(x, y, z),
    setFluid: (x, y, z, id) => this.setVoxel(x, y, z, id, false),
  }

  constructor(seed: number = WORLD.seed) {
    this.terrain = new TerrainGenerator(seed)
    this.group.name = 'world'

    // flatShading даёт чёткие воксельные грани, vertexColors несут цвет блока и AO.
    this.opaqueMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
    })
    this.transparentMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      transparent: true,
      depthWrite: false,
      // Чтобы поверхность воды была видна и снизу, из-под воды.
      side: THREE.DoubleSide,
    })
  }

  /** Читалка вокселей в мировых координатах. Передаётся мешеру и рейкасту. */
  readonly reader: VoxelReader = (x, y, z) => {
    // Ниже мира — камень: и как пол, и чтобы не рисовать нижние грани у y=0.
    if (y < 0) return Block.Stone
    if (y >= chunkSizeY) return Block.Air
    const chunk = this.chunks.get(chunkKey(toChunkCoord(x), toChunkCoord(z)))
    if (chunk === undefined || !chunk.generated) return Block.Air
    const lx = x - chunk.cx * chunkSizeX
    const lz = z - chunk.cz * chunkSizeZ
    return chunk.get(lx, y, lz)
  }

  getVoxel(x: number, y: number, z: number): Block {
    return this.reader(Math.floor(x), Math.floor(y), Math.floor(z))
  }

  isSolidAt(x: number, y: number, z: number): boolean {
    return isSolid(this.getVoxel(x, y, z))
  }

  /**
   * Ставит блок и помечает на перестройку все затронутые чанки. Соседние чанки тоже
   * попадают в список: от блока на границе зависят и отсечение граней, и AO у соседа.
   */
  setVoxel(x: number, y: number, z: number, id: Block, recordEdit = true): void {
    x = Math.floor(x)
    y = Math.floor(y)
    z = Math.floor(z)
    if (y < 0 || y >= chunkSizeY) return

    const chunk = this.chunks.get(chunkKey(toChunkCoord(x), toChunkCoord(z)))
    if (chunk === undefined) return

    chunk.set(x - chunk.cx * chunkSizeX, y, z - chunk.cz * chunkSizeZ, id)
    if (recordEdit) this.edits.set(`${x},${y},${z}`, id)

    // Любое изменение будит воду рядом: копнул у озера — вода затекает в яму.
    this.water.wake(this.waterAccess, x, y, z)

    // 3×3 вокруг изменённого блока: захватывает и рёбра, и углы, от которых зависит AO.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const neighbor = this.chunks.get(
          chunkKey(toChunkCoord(x + dx), toChunkCoord(z + dz)),
        )
        if (neighbor !== undefined) this.markDirty(neighbor)
      }
    }
  }

  private markDirty(chunk: Chunk): void {
    if (chunk.dirty) return
    chunk.dirty = true
    this.remeshQueue.push(chunk)
  }

  /**
   * Держит вокруг игрока прогруженную область. Данные генерируются на радиус на единицу
   * больше видимого: мешеру нужны настоящие соседи, иначе на границах области возникает
   * стена лишних граней и рваный AO.
   */
  ensureAround(worldX: number, worldZ: number): void {
    const ccx = toChunkCoord(worldX)
    const ccz = toChunkCoord(worldZ)
    const genRadius = viewRadius + 1

    for (let dz = -genRadius; dz <= genRadius; dz++) {
      for (let dx = -genRadius; dx <= genRadius; dx++) {
        this.chunkAt(ccx + dx, ccz + dz)
      }
    }

    // Ближние чанки мешим первыми, чтобы мир вокруг игрока появлялся сразу.
    const pending: { chunk: Chunk; dist: number }[] = []
    for (let dz = -viewRadius; dz <= viewRadius; dz++) {
      for (let dx = -viewRadius; dx <= viewRadius; dx++) {
        const chunk = this.chunks.get(chunkKey(ccx + dx, ccz + dz))
        if (chunk !== undefined && chunk.dirty && !this.remeshQueue.includes(chunk)) {
          pending.push({ chunk, dist: dx * dx + dz * dz })
        }
      }
    }
    pending.sort((a, b) => a.dist - b.dist)
    for (const item of pending) this.remeshQueue.push(item.chunk)

    this.unloadFar(ccx, ccz)
  }

  /** Создаёт и генерирует чанк, если его ещё нет. */
  private chunkAt(cx: number, cz: number): Chunk {
    const key = chunkKey(cx, cz)
    let chunk = this.chunks.get(key)
    if (chunk === undefined) {
      chunk = new Chunk(cx, cz)
      this.chunks.set(key, chunk)
      this.terrain.generate(chunk)
      chunk.generated = true
      this.applyEditsTo(chunk)
    }
    return chunk
  }

  /** Возвращает правки игрока в заново сгенерированный чанк. */
  private applyEditsTo(chunk: Chunk): void {
    if (this.edits.size === 0) return
    const minX = chunk.cx * chunkSizeX
    const minZ = chunk.cz * chunkSizeZ
    for (const [key, id] of this.edits) {
      const parts = key.split(',')
      const x = Number(parts[0])
      const y = Number(parts[1])
      const z = Number(parts[2])
      if (x < minX || x >= minX + chunkSizeX) continue
      if (z < minZ || z >= minZ + chunkSizeZ) continue
      chunk.set(x - minX, y, z - minZ, id)
    }
  }

  /** Выгружает далёкие чанки, чтобы память и число мешей не росли бесконечно. */
  private unloadFar(ccx: number, ccz: number): void {
    const limit = viewRadius + 3
    for (const [key, chunk] of this.chunks) {
      if (Math.abs(chunk.cx - ccx) <= limit && Math.abs(chunk.cz - ccz) <= limit) continue
      this.disposeMesh(chunk.opaqueMesh)
      this.disposeMesh(chunk.transparentMesh)
      chunk.opaqueMesh = null
      chunk.transparentMesh = null
      this.chunks.delete(key)
    }
  }

  /** Перестраивает ограниченное число мешей за кадр и тикает воду. */
  update(dt = 0): void {
    if (dt > 0) this.water.update(dt, this.waterAccess)

    let built = 0
    while (built < remeshPerFrame && this.remeshQueue.length > 0) {
      const chunk = this.remeshQueue.shift()
      if (chunk === undefined) break
      // Чанк мог быть выгружен, пока стоял в очереди.
      if (!this.chunks.has(chunkKey(chunk.cx, chunk.cz))) continue
      this.buildMesh(chunk)
      built++
    }
  }

  /**
   * Строит ожидающие меши синхронно. Нужно на старте, чтобы первый кадр не был пустым.
   * Очередь отсортирована от ближних чанков к дальним, поэтому лимит даёт готовую
   * область вокруг игрока, а даль догружается уже в игре через update().
   */
  flushRemesh(maxChunks = Infinity): void {
    let built = 0
    while (built < maxChunks && this.remeshQueue.length > 0) {
      const chunk = this.remeshQueue.shift()
      if (chunk === undefined) break
      if (!this.chunks.has(chunkKey(chunk.cx, chunk.cz))) continue
      this.buildMesh(chunk)
      built++
    }
  }

  private buildMesh(chunk: Chunk): void {
    const result = meshChunk(chunk.cx, chunk.cz, this.reader)
    chunk.opaqueMesh = this.applyMesh(chunk, chunk.opaqueMesh, result.opaque, this.opaqueMaterial, true)
    chunk.transparentMesh = this.applyMesh(
      chunk,
      chunk.transparentMesh,
      result.transparent,
      this.transparentMaterial,
      false,
    )
    chunk.dirty = false
  }

  private applyMesh(
    chunk: Chunk,
    existing: THREE.Mesh | null,
    data: MeshData | null,
    material: THREE.Material,
    shadows: boolean,
  ): THREE.Mesh | null {
    if (data === null) {
      this.disposeMesh(existing)
      return null
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, COLOR_COMPONENTS))
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1))
    geometry.computeBoundingSphere()

    if (existing !== null) {
      existing.geometry.dispose()
      existing.geometry = geometry
      return existing
    }

    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(chunk.cx * chunkSizeX, 0, chunk.cz * chunkSizeZ)
    mesh.castShadow = shadows
    mesh.receiveShadow = shadows
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    this.group.add(mesh)
    return mesh
  }

  private disposeMesh(mesh: THREE.Mesh | null): void {
    if (mesh === null) return
    this.group.remove(mesh)
    mesh.geometry.dispose()
  }

  /** Верх любой твёрдой геометрии в столбце — включая кроны деревьев и постройки. */
  surfaceY(x: number, z: number): number {
    const ix = Math.floor(x)
    const iz = Math.floor(z)
    for (let y = chunkSizeY - 1; y >= 0; y--) {
      if (isSolid(this.reader(ix, y, iz))) return y + 1
    }
    return 1
  }

  /**
   * Высота РЕЛЬЕФА без растительности — для спавна существ. surfaceY здесь не годится:
   * листва solid, и точка прихода попадала на крону дерева, откуда смурфик падал.
   * Считается чистой математикой террагена, поэтому работает и вне прогруженных чанков.
   */
  groundY(x: number, z: number): number {
    return this.terrain.surfaceHeight(Math.floor(x), Math.floor(z)) + 1
  }

  /** Сгенерирован ли чанк под этой мировой координатой. */
  isChunkGenerated(x: number, z: number): boolean {
    const chunk = this.chunks.get(chunkKey(toChunkCoord(Math.floor(x)), toChunkCoord(Math.floor(z))))
    return chunk !== undefined && chunk.generated
  }

  /**
   * Догенерирует чанки вокруг точки, не трогая выгрузку дальних (в отличие от
   * ensureAround, который перецентрировал бы весь прогруз). Нужно для спавна существ
   * на подходе к деревне.
   */
  ensureChunkAt(x: number, z: number, radius = 1): void {
    const ccx = toChunkCoord(Math.floor(x))
    const ccz = toChunkCoord(Math.floor(z))
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const chunk = this.chunkAt(ccx + dx, ccz + dz)
        if (chunk.dirty && !this.remeshQueue.includes(chunk)) this.remeshQueue.push(chunk)
      }
    }
  }

  dispose(): void {
    for (const chunk of this.chunks.values()) {
      this.disposeMesh(chunk.opaqueMesh)
      this.disposeMesh(chunk.transparentMesh)
    }
    this.chunks.clear()
    this.opaqueMaterial.dispose()
    this.transparentMaterial.dispose()
  }
}
