import * as THREE from 'three'
import { PLAYER } from '../config/tuning'
import { Block, HOTBAR_BLOCKS, blockDef } from '../world/blocks'
import { raycastVoxels, type VoxelHit } from '../world/raycast'
import type { World } from '../world/world'
import { playerOverlapsBlock, type Player } from './player'

/** Ближайшая сущность на луче — combat.ts подставляет сюда свою проверку. */
export interface EntityRayHit {
  distance: number
  applyDamage: () => void
}

export type EntityRaycaster = (
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance: number,
) => EntityRayHit | null

/** Стартовый запас: деревню должно быть из чего строить сразу, без гринда. */
const STARTING_INVENTORY: ReadonlyArray<readonly [Block, number]> = [
  [Block.Bed, 8],
  [Block.Pink, 96],
  [Block.Blue, 96],
  [Block.Yellow, 96],
  [Block.Lavender, 96],
  [Block.Mint, 96],
  [Block.Glass, 48],
  [Block.Wood, 64],
  [Block.Stone, 64],
]

/** Через воду смотрят и целятся насквозь — ломать её нельзя. */
function isTargetable(id: Block): boolean {
  return id !== Block.Air && id !== Block.Water
}

/**
 * Ломание и установка блоков плюс инвентарь.
 *
 * ЛКМ имеет два смысла и разбирается по дистанции: если сущность ближе найденного блока —
 * это удар, иначе — копание. Так одна кнопка обслуживает и бой, и стройку, и игроку
 * не приходится помнить лишнюю клавишу.
 */
export class Interaction {
  activeSlot = 0
  readonly inventory = new Map<Block, number>()

  /** Зовётся после любого изменения блока — по нему quest.ts перепроверяет дома. */
  onBlockChanged: ((x: number, y: number, z: number, previous: Block, next: Block) => void) | null =
    null
  /** Подставляется боевой системой; до её появления удар просто ломает блоки. */
  entityRaycaster: EntityRaycaster | null = null
  onMelee: (() => void) | null = null
  onPlaced: ((x: number, y: number, z: number, block: Block) => void) | null = null
  onBroken: ((x: number, y: number, z: number, block: Block) => void) | null = null
  onNoRoom: (() => void) | null = null

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

  selectSlot(index: number): void {
    if (index < 0 || index >= HOTBAR_BLOCKS.length) return
    this.activeSlot = index
  }

  cycleSlot(direction: number): void {
    const count = HOTBAR_BLOCKS.length
    this.activeSlot = (this.activeSlot + direction + count) % count
  }

  /** Блок под прицелом. Используется и для подсветки прицела, и для действий. */
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

    // Сущность перед блоком — значит бьём по ней, а не копаем стену за ней.
    if (entity !== null && (block === null || entity.distance <= block.distance)) {
      if (this.meleeCooldown > 0) return
      this.meleeCooldown = PLAYER.meleeCooldown
      entity.applyDamage()
      this.onMelee?.()
      return
    }

    if (block === null || this.breakCooldown > 0) return
    this.breakCooldown = PLAYER.blockBreakCooldown
    this.breakBlock(block)
  }

  private breakBlock(hit: VoxelHit): void {
    const previous = hit.id
    this.world.setVoxel(hit.x, hit.y, hit.z, Block.Air)
    if (blockDef(previous).placeable) {
      this.inventory.set(previous, (this.inventory.get(previous) ?? 0) + 1)
    }
    this.onBroken?.(hit.x, hit.y, hit.z, previous)
    this.onBlockChanged?.(hit.x, hit.y, hit.z, previous, Block.Air)
  }

  place(): void {
    const hit = this.currentTarget()
    if (hit === null) return
    // Нулевая нормаль значит, что луч начался внутри блока — грани для установки нет.
    if (hit.nx === 0 && hit.ny === 0 && hit.nz === 0) return

    const block = this.activeBlock
    const available = this.inventory.get(block) ?? 0
    if (available <= 0) {
      this.onNoRoom?.()
      return
    }

    const x = hit.x + hit.nx
    const y = hit.y + hit.ny
    const z = hit.z + hit.nz

    const existing = this.world.getVoxel(x, y, z)
    if (existing !== Block.Air && existing !== Block.Water) return

    // Иначе можно замуровать себя внутри собственного блока и застрять.
    if (blockDef(block).solid && playerOverlapsBlock(this.player.position, x, y, z)) {
      this.onNoRoom?.()
      return
    }

    this.world.setVoxel(x, y, z, block)
    this.inventory.set(block, available - 1)
    this.onPlaced?.(x, y, z, block)
    this.onBlockChanged?.(x, y, z, existing, block)
  }
}
