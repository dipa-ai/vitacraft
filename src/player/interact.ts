import * as THREE from 'three'
import { PLAYER } from '../config/tuning'
import { Block, HOTBAR_BLOCKS, blockDef, isBed, isDoor, isWater } from '../world/blocks'
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

/** Через воду смотрят и целятся насквозь — ломать её обычной киркой нельзя. */
function isTargetable(id: Block): boolean {
  return id !== Block.Air && !isWater(id)
}

/**
 * Ломание и установка блоков плюс инвентарь.
 *
 * ЛКМ имеет два смысла и разбирается по дистанции: если сущность ближе найденного блока —
 * это удар, иначе — копание. С водой в руке ЛКМ вместо копания черпает воду.
 *
 * Парные блоки (кроватка из двух клеток, дверь в две клетки высотой) ставятся и ломаются
 * целиком: половина без пары невозможна по построению.
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

  /** Держит ли игрок сейчас морковку — за ней ходят животные. */
  get holdingCarrot(): boolean {
    return this.activeBlock === Block.Carrot && (this.inventory.get(Block.Carrot) ?? 0) > 0
  }

  add(block: Block, count = 1): void {
    this.inventory.set(block, (this.inventory.get(block) ?? 0) + count)
  }

  /** Тратит одно облачко под бросок. false — бросать нечего. */
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

    // С водой в руке ЛКМ черпает: вода не цель для кирки, но цель для ведра.
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
        // В ведро идёт только источник. Растёкшаяся вода — производная от источника:
        // давать за неё заряд значило бы бесконечно копировать воду, а так ЛКМ по ней —
        // просто способ подсушить лужу.
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

    // Парные блоки уходят целиком.
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

  /** @param withDrop половина пары не даёт второй предмет — иначе дюп. */
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
    // Старая одноклеточная кроватка пары не имеет.
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

    // ПКМ по двери — открыть/закрыть, а не поставить блок рядом.
    if (isDoor(hit.id)) {
      this.toggleDoor(hit.x, hit.y, hit.z)
      return
    }

    // Нулевая нормаль значит, что луч начался внутри блока — грани для установки нет.
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

    // Иначе можно замуровать себя внутри собственного блока и застрять.
    if (blockDef(block).solid && playerOverlapsBlock(this.player.position, x, y, z)) {
      this.onNoRoom?.()
      return
    }

    this.commitPlace(x, y, z, block)
    this.inventory.set(block, available - 1)
  }

  /** Кроватка занимает две клетки по направлению взгляда: изголовье ближе к игроку. */
  private placeBed(x: number, y: number, z: number, available: number): void {
    this.player.lookDirection(this.direction)
    // Уводим одеяло по доминирующей горизонтальной оси взгляда.
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

  /** Дверь — две клетки в высоту, чтобы в проём проходил и игрок, и смурфик. */
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

  /** Переключает обе клетки двери. Доступно и смурфикам через Village. */
  toggleDoor(x: number, y: number, z: number): void {
    const id = this.world.getVoxel(x, y, z)
    if (!isDoor(id)) return
    const bottomY = isDoor(this.world.getVoxel(x, y - 1, z)) ? y - 1 : y
    const next = id === Block.DoorClosed ? Block.DoorOpen : Block.DoorClosed

    for (const cy of [bottomY, bottomY + 1]) {
      const cell = this.world.getVoxel(x, cy, z)
      if (!isDoor(cell)) continue
      // Закрыть дверь на себе нельзя — иначе игрок застревает в её объёме.
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
