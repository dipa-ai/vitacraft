import * as THREE from 'three'
import { PLAYER } from '../config/tuning'
import { Block, HOTBAR_BLOCKS, blockDef, isBed, isDoor, isWater } from '../world/blocks'
import { raycastVoxels, type VoxelHit } from '../world/raycast'
import type { World } from '../world/world'
import { playerOverlapsBlock, type Player } from './player'

/** Nearest entity on the ray — combat.ts plugs its own check in here. */
export interface EntityRayHit {
  distance: number
  applyDamage: () => void
}

export type EntityRaycaster = (
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance: number,
) => EntityRayHit | null

/** Starting stock: the village must be buildable right away, no grinding. */
const STARTING_INVENTORY: ReadonlyArray<readonly [Block, number]> = [
  [Block.BedHead, 8],
  [Block.DoorClosed, 8],
  [Block.Water, 8],
  [Block.Pink, 96],
  [Block.Blue, 96],
  [Block.Yellow, 96],
  [Block.Mint, 96],
  [Block.Glass, 48],
  [Block.Wood, 64],
  [Block.Stone, 64],
  [Block.Lantern, 12],
  [Block.Carrot, 0],
  [Block.Cloud, 0],
]

/** Water is looked and aimed through — the plain pickaxe cannot break it. */
function isTargetable(id: Block): boolean {
  return id !== Block.Air && !isWater(id)
}

/**
 * Block breaking, placement and the inventory.
 *
 * LMB has two meanings resolved by distance: an entity closer than the found block
 * means a strike, otherwise it digs. With water in hand LMB scoops instead of digging.
 *
 * Paired blocks (the two-cell bed, the two-cell-tall door) place and break as a
 * whole: an unpaired half is impossible by construction.
 */
export class Interaction {
  activeSlot = 0
  readonly inventory = new Map<Block, number>()

  /** Fires after any block change — quest.ts revalidates houses off of it. */
  onBlockChanged: ((x: number, y: number, z: number, previous: Block, next: Block) => void) | null =
    null
  /** Injected by the combat system; before that a strike simply breaks blocks. */
  entityRaycaster: EntityRaycaster | null = null
  onMelee: (() => void) | null = null
  onPlaced: ((x: number, y: number, z: number, block: Block) => void) | null = null
  onBroken: ((x: number, y: number, z: number, block: Block) => void) | null = null
  onNoRoom: (() => void) | null = null
  onDoorToggled: ((open: boolean) => void) | null = null
  onScooped: (() => void) | null = null

  private breakCooldown = 0
  private meleeCooldown = 0
  private readonly origin = new THREE.Vector3()
  private readonly direction = new THREE.Vector3()

  constructor(
    private readonly world: World,
    private readonly player: Player,
  ) {
    for (const [block, count] of STARTING_INVENTORY) {
      this.inventory.set(block, count)
    }
  }

  get activeBlock(): Block {
    return HOTBAR_BLOCKS[this.activeSlot] ?? Block.Pink
  }

  hotbarCounts(): number[] {
    return HOTBAR_BLOCKS.map((block) => this.inventory.get(block) ?? 0)
  }

  /** Whether the player currently holds a carrot — animals follow it. */
  get holdingCarrot(): boolean {
    return this.activeBlock === Block.Carrot && (this.inventory.get(Block.Carrot) ?? 0) > 0
  }

  add(block: Block, count = 1): void {
    this.inventory.set(block, (this.inventory.get(block) ?? 0) + count)
  }

  /** Spends one cloud for a throw. False — nothing to throw. */
  consumeCloud(): boolean {
    const count = this.inventory.get(Block.Cloud) ?? 0
    if (count <= 0) return false
    this.inventory.set(Block.Cloud, count - 1)
    return true
  }

  selectSlot(index: number): void {
    if (index < 0 || index >= HOTBAR_BLOCKS.length) return
    this.activeSlot = index
  }

  cycleSlot(direction: number): void {
    const count = HOTBAR_BLOCKS.length
    this.activeSlot = (this.activeSlot + direction + count) % count
  }

  /** The block under the crosshair. Used for both highlight and actions. */
  currentTarget(): VoxelHit | null {
    this.player.eyePosition(this.origin)
    this.player.lookDirection(this.direction)
    return raycastVoxels(
      this.world.reader,
      this.origin.x,
      this.origin.y,
      this.origin.z,
      this.direction.x,
      this.direction.y,
      this.direction.z,
      PLAYER.reach,
      isTargetable,
    )
  }

  update(dt: number, attackHeld: boolean): void {
    this.breakCooldown = Math.max(0, this.breakCooldown - dt)
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt)
    if (attackHeld) this.attack()
  }

  private attack(): void {
    this.player.eyePosition(this.origin)
    this.player.lookDirection(this.direction)

    const entity = this.entityRaycaster?.(this.origin, this.direction, PLAYER.meleeRange) ?? null
    const block = this.currentTarget()

    // An entity in front of the block — strike it, don't dig the wall behind.
    if (entity !== null && (block === null || entity.distance <= block.distance)) {
      if (this.meleeCooldown > 0) return
      this.meleeCooldown = PLAYER.meleeCooldown
      entity.applyDamage()
      this.onMelee?.()
      return
    }

    // With water in hand LMB scoops: water is no pickaxe target, but a bucket one.
    if (this.activeBlock === Block.Water) {
      if (this.breakCooldown > 0) return
      const waterHit = raycastVoxels(
        this.world.reader,
        this.origin.x,
        this.origin.y,
        this.origin.z,
        this.direction.x,
        this.direction.y,
        this.direction.z,
        PLAYER.reach,
        (id) => id !== Block.Air,
      )
      if (waterHit !== null && isWater(waterHit.id)) {
        this.breakCooldown = PLAYER.blockBreakCooldown
        this.world.setVoxel(waterHit.x, waterHit.y, waterHit.z, Block.Air)
        // Only a source goes into the bucket. Spread water derives from a source:
        // rewarding it would copy water forever; this way LMB on it just dries
        // the puddle.
        if (waterHit.id === Block.Water) this.add(Block.Water)
        this.onScooped?.()
        this.onBlockChanged?.(waterHit.x, waterHit.y, waterHit.z, waterHit.id, Block.Air)
        return
      }
    }

    if (block === null || this.breakCooldown > 0) return
    this.breakCooldown = PLAYER.blockBreakCooldown
    this.breakBlock(block)
  }

  private breakBlock(hit: VoxelHit): void {
    this.removeCell(hit.x, hit.y, hit.z, hit.id)

    // Paired blocks go as a whole.
    if (isBed(hit.id)) {
      const partner = this.findBedPartner(hit.x, hit.y, hit.z, hit.id)
      if (partner !== null) this.removeCell(partner.x, partner.y, partner.z, partner.id, false)
    } else if (isDoor(hit.id)) {
      const belowIsDoor = isDoor(this.world.getVoxel(hit.x, hit.y - 1, hit.z))
      const otherY = belowIsDoor ? hit.y - 1 : hit.y + 1
      const other = this.world.getVoxel(hit.x, otherY, hit.z)
      if (isDoor(other)) this.removeCell(hit.x, otherY, hit.z, other, false)
    }
  }

  /** @param withDrop the pair's second half yields no item — that would dupe. */
  private removeCell(x: number, y: number, z: number, id: Block, withDrop = true): void {
    this.world.setVoxel(x, y, z, Block.Air)
    if (withDrop) {
      const def = blockDef(id)
      const drop = def.drops ?? (def.placeable ? { block: id, count: 1 } : null)
      if (drop !== null) this.add(drop.block, drop.count)
    }
    this.onBroken?.(x, y, z, id)
    this.onBlockChanged?.(x, y, z, id, Block.Air)
  }

  private findBedPartner(
    x: number,
    y: number,
    z: number,
    id: Block,
  ): { x: number; y: number; z: number; id: Block } | null {
    // The legacy single-cell bed has no pair.
    if (id === Block.Bed) return null
    const want = id === Block.BedHead ? Block.BedFoot : Block.BedHead
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      if (this.world.getVoxel(x + dx, y, z + dz) === want) {
        return { x: x + dx, y, z: z + dz, id: want }
      }
    }
    return null
  }

  place(): void {
    const hit = this.currentTarget()
    if (hit === null) return

    // RMB on a door toggles it rather than placing a block next to it.
    if (isDoor(hit.id)) {
      this.toggleDoor(hit.x, hit.y, hit.z)
      return
    }

    // A zero normal means the ray started inside a block — no face to place against.
    if (hit.nx === 0 && hit.ny === 0 && hit.nz === 0) return

    const block = this.activeBlock
    if (!blockDef(block).placeable) return

    const available = this.inventory.get(block) ?? 0
    if (available <= 0) {
      this.onNoRoom?.()
      return
    }

    const x = hit.x + hit.nx
    const y = hit.y + hit.ny
    const z = hit.z + hit.nz

    if (!this.cellFree(x, y, z)) return

    if (block === Block.BedHead) {
      this.placeBed(x, y, z, available)
      return
    }
    if (block === Block.DoorClosed) {
      this.placeDoor(x, y, z, available)
      return
    }

    // Otherwise you could entomb yourself inside your own block and get stuck.
    if (blockDef(block).solid && playerOverlapsBlock(this.player.position, x, y, z)) {
      this.onNoRoom?.()
      return
    }

    this.commitPlace(x, y, z, block)
    this.inventory.set(block, available - 1)
  }

  /** The bed takes two cells along the look direction: headboard closer to the player. */
  private placeBed(x: number, y: number, z: number, available: number): void {
    this.player.lookDirection(this.direction)
    // Extend the blanket along the dominant horizontal look axis.
    const alongX = Math.abs(this.direction.x) >= Math.abs(this.direction.z)
    const dx = alongX ? Math.sign(this.direction.x) || 1 : 0
    const dz = alongX ? 0 : Math.sign(this.direction.z) || 1

    if (!this.cellFree(x + dx, y, z + dz)) {
      this.onNoRoom?.()
      return
    }

    this.commitPlace(x, y, z, Block.BedHead)
    this.commitPlace(x + dx, y, z + dz, Block.BedFoot)
    this.inventory.set(Block.BedHead, available - 1)
  }

  /** The door is two cells tall so both the player and a smurf fit through. */
  private placeDoor(x: number, y: number, z: number, available: number): void {
    if (!this.cellFree(x, y + 1, z)) {
      this.onNoRoom?.()
      return
    }
    if (
      playerOverlapsBlock(this.player.position, x, y, z) ||
      playerOverlapsBlock(this.player.position, x, y + 1, z)
    ) {
      this.onNoRoom?.()
      return
    }

    this.commitPlace(x, y, z, Block.DoorClosed)
    this.commitPlace(x, y + 1, z, Block.DoorClosed)
    this.inventory.set(Block.DoorClosed, available - 1)
  }

  private cellFree(x: number, y: number, z: number): boolean {
    const existing = this.world.getVoxel(x, y, z)
    return existing === Block.Air || isWater(existing)
  }

  private commitPlace(x: number, y: number, z: number, block: Block): void {
    const previous = this.world.getVoxel(x, y, z)
    this.world.setVoxel(x, y, z, block)
    this.onPlaced?.(x, y, z, block)
    this.onBlockChanged?.(x, y, z, previous, block)
  }

  /** Toggles both door cells. Also available to smurfs via Village. */
  toggleDoor(x: number, y: number, z: number): void {
    const id = this.world.getVoxel(x, y, z)
    if (!isDoor(id)) return
    const bottomY = isDoor(this.world.getVoxel(x, y - 1, z)) ? y - 1 : y
    const next = id === Block.DoorClosed ? Block.DoorOpen : Block.DoorClosed

    for (const cy of [bottomY, bottomY + 1]) {
      const cell = this.world.getVoxel(x, cy, z)
      if (!isDoor(cell)) continue
      // You cannot close a door on yourself — the player would stick in its volume.
      if (next === Block.DoorClosed && playerOverlapsBlock(this.player.position, x, cy, z)) {
        this.onNoRoom?.()
        return
      }
    }

    for (const cy of [bottomY, bottomY + 1]) {
      const cell = this.world.getVoxel(x, cy, z)
      if (!isDoor(cell)) continue
      this.world.setVoxel(x, cy, z, next)
      this.onBlockChanged?.(x, cy, z, cell, next)
    }
    this.onDoorToggled?.(next === Block.DoorOpen)
  }
}
