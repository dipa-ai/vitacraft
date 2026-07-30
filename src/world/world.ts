import * as THREE from 'three'
import { WORLD } from '../config/tuning'
import { Block, isSolid } from './blocks'
import { Chunk, chunkKey } from './chunk'
import { COLOR_COMPONENTS, meshChunk, type MeshData, type VoxelReader } from './mesher'
import { TerrainGenerator } from './terrain'
import { WaterSim, type WaterWorld } from './water'

const { chunkSizeX, chunkSizeY, chunkSizeZ, viewRadius, remeshPerFrame } = WORLD

/** World coordinate to chunk coordinate. */
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

  /** Blocks changed by the player — the only thing that goes into the save. */
  readonly edits = new Map<string, Block>()

  readonly water = new WaterSim()
  /** Narrow access for the water sim: writes without touching the player's diff. */
  private readonly waterAccess: WaterWorld = {
    getVoxel: (x, y, z) => this.reader(x, y, z),
    setFluid: (x, y, z, id) => this.setVoxel(x, y, z, id, false),
  }

  constructor(seed: number = WORLD.seed) {
    this.terrain = new TerrainGenerator(seed)
    this.group.name = 'world'

    // flatShading keeps voxel faces crisp; vertexColors carry block color and AO.
    this.opaqueMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
    })
    this.transparentMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      transparent: true,
      depthWrite: false,
      // So the water surface is visible from below too, when underwater.
      side: THREE.DoubleSide,
    })
  }

  /** Voxel reader in world coordinates. Handed to the mesher and the raycaster. */
  readonly reader: VoxelReader = (x, y, z) => {
    // Below the world is stone: acts as a floor and culls bottom faces at y=0.
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
   * Places a block and marks all affected chunks for a rebuild. Neighboring chunks
   * are included: a border block affects both face culling and the neighbor's AO.
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

    // Any change wakes nearby water: dig by a lake and water flows into the pit.
    this.water.wake(this.waterAccess, x, y, z)

    // 3×3 around the changed block: covers edges and corners that drive AO.
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
   * Keeps a loaded area around the player. Data generates one radius beyond the
   * visible range: the mesher needs real neighbors, or the area border grows a wall
   * of stray faces and ragged AO.
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

    // Mesh near chunks first so the world pops in around the player immediately.
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

  /** Creates and generates a chunk if it does not exist yet. */
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

  /** Re-applies player edits to a freshly generated chunk. */
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

  /** Unloads distant chunks so memory and mesh count don't grow forever. */
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

  /** Rebuilds a bounded number of meshes per frame and ticks the water sim. */
  update(dt = 0): void {
    if (dt > 0) this.water.update(dt, this.waterAccess)

    let built = 0
    while (built < remeshPerFrame && this.remeshQueue.length > 0) {
      const chunk = this.remeshQueue.shift()
      if (chunk === undefined) break
      // The chunk may have been unloaded while sitting in the queue.
      if (!this.chunks.has(chunkKey(chunk.cx, chunk.cz))) continue
      this.buildMesh(chunk)
      built++
    }
  }

  /**
   * Builds pending meshes synchronously. Needed at startup so the first frame isn't
   * empty. The queue is sorted near-to-far, so the limit yields a ready area around
   * the player while the distance streams in later via update().
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

  /** Top of any solid geometry in a column — tree crowns and buildings included. */
  surfaceY(x: number, z: number): number {
    const ix = Math.floor(x)
    const iz = Math.floor(z)
    for (let y = chunkSizeY - 1; y >= 0; y--) {
      if (isSolid(this.reader(ix, y, iz))) return y + 1
    }
    return 1
  }

  /**
   * TERRAIN height without vegetation — for creature spawns. surfaceY won't do here:
   * leaves are solid, and arrival points used to land on tree crowns that smurfs then
   * fell off. Computed as pure terrain math, so it works beyond loaded chunks too.
   */
  groundY(x: number, z: number): number {
    return this.terrain.surfaceHeight(Math.floor(x), Math.floor(z)) + 1
  }

  /** Whether the chunk under this world coordinate has been generated. */
  isChunkGenerated(x: number, z: number): boolean {
    const chunk = this.chunks.get(chunkKey(toChunkCoord(Math.floor(x)), toChunkCoord(Math.floor(z))))
    return chunk !== undefined && chunk.generated
  }

  /**
   * Generates chunks around a point without touching far-chunk unloading (unlike
   * ensureAround, which would recenter the whole stream). Needed to spawn creatures
   * on approach to the village.
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
