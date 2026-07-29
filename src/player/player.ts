import * as THREE from 'three'
import { PLAYER } from '../config/tuning'
import { isWater, type Block } from '../world/blocks'

/**
 * Всё, что физике игрока нужно от мира. World удовлетворяет этому интерфейсу структурно,
 * а тесты могут подсунуть крошечную сцену из пары блоков вместо целого террагена.
 */
export interface CollisionSource {
  getVoxel(x: number, y: number, z: number): Block
  isSolidAt(x: number, y: number, z: number): boolean
}

/** Что игрок хочет сделать в этом кадре. Заполняется в controls.ts. */
export interface MoveInput {
  /** -1 назад, +1 вперёд. */
  forward: number
  /** -1 влево, +1 вправо. */
  right: number
  jump: boolean
  run: boolean
}

const HALF = PLAYER.width / 2
/** Отступ, чтобы после упора игрок не оставался ровно в плоскости блока. */
const EPS = 1e-3
/** Максимальный шаг интегрирования в блоках: защита от проскока сквозь стену на лагах. */
const MAX_STEP = 0.25

interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

/**
 * Игрок как AABB-капсула в воксельной сетке. Позиция — центр ступней: по X и Z центр
 * коробки, по Y её низ.
 *
 * Столкновения разрешаются по каждой оси отдельно. Если двигать и разрешать всё сразу,
 * игрок застревает во внутренних углах и не может скользить вдоль стены.
 */
export class Player {
  readonly position = new THREE.Vector3()
  readonly velocity = new THREE.Vector3()

  /** Направление взгляда. Им же поворачивается модель в третьем лице. */
  yaw = 0
  pitch = 0

  onGround = false
  inWater = false
  // Явная аннотация обязательна: значения в tuning.ts помечены as const, и без неё
  // тип сузился бы до литерала и запретил любое другое количество здоровья.
  health: number = PLAYER.maxHealth
  /** Остаток неуязвимости после получения урона, секунды. */
  invulnerable = 0
  dead = false

  /** Сколько прошло с последнего урона — от этого зависит регенерация. */
  private sinceDamage = Infinity
  private regenAccumulator = 0
  /** Зовётся при восстановлении сердечка — HUD может отреагировать. */
  onRegen: (() => void) | null = null

  respawn(x: number, y: number, z: number): void {
    this.position.set(x, y, z)
    this.velocity.set(0, 0, 0)
    this.health = PLAYER.maxHealth
    this.invulnerable = 0
    this.dead = false
    this.sinceDamage = Infinity
    this.regenAccumulator = 0
  }

  /** Позиция глаз — она же позиция камеры в первом лице. */
  eyePosition(target: THREE.Vector3): THREE.Vector3 {
    return target.set(this.position.x, this.position.y + PLAYER.eyeHeight, this.position.z)
  }

  /** Направление взгляда как единичный вектор. */
  lookDirection(target: THREE.Vector3): THREE.Vector3 {
    const cosPitch = Math.cos(this.pitch)
    return target
      .set(-Math.sin(this.yaw) * cosPitch, Math.sin(this.pitch), -Math.cos(this.yaw) * cosPitch)
      .normalize()
  }

  bounds(): Bounds {
    const { x, y, z } = this.position
    return {
      minX: x - HALF,
      maxX: x + HALF,
      minY: y,
      maxY: y + PLAYER.height,
      minZ: z - HALF,
      maxZ: z + HALF,
    }
  }

  /** Наносит урон с учётом неуязвимости. Возвращает true, если удар прошёл. */
  takeDamage(amount: number): boolean {
    if (this.dead || this.invulnerable > 0) return false
    this.health = Math.max(0, this.health - amount)
    this.invulnerable = PLAYER.invulnerable
    this.sinceDamage = 0
    this.regenAccumulator = 0
    if (this.health === 0) this.dead = true
    return true
  }

  update(dt: number, input: MoveInput, world: CollisionSource): void {
    if (this.invulnerable > 0) this.invulnerable = Math.max(0, this.invulnerable - dt)
    this.regenerate(dt)

    // Плаваем, когда в воде середина тела, а не только ступни: иначе на мелководье
    // игрок то плывёт, то идёт.
    this.inWater = isWater(
      world.getVoxel(this.position.x, this.position.y + PLAYER.height * 0.5, this.position.z),
    )

    this.applyMovement(dt, input)
    this.integrate(dt, world)
    this.onGround = this.probeGround(world)
  }

  /** Сердечки восстанавливаются сами — но не сразу после удара, чтобы бой оставался боем. */
  private regenerate(dt: number): void {
    if (this.dead || this.health >= PLAYER.maxHealth) return
    this.sinceDamage += dt
    if (this.sinceDamage < PLAYER.regenDelay) return
    this.regenAccumulator += dt
    if (this.regenAccumulator >= PLAYER.regenInterval) {
      this.regenAccumulator -= PLAYER.regenInterval
      this.health = Math.min(PLAYER.maxHealth, this.health + 1)
      this.onRegen?.()
    }
  }

  private applyMovement(dt: number, input: MoveInput): void {
    // Ось Z смотрит назад — так устроена камера в three.js, поэтому «вперёд» отрицательное.
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)
    let wishX = -sin * input.forward + cos * input.right
    let wishZ = -cos * input.forward - sin * input.right

    const length = Math.hypot(wishX, wishZ)
    if (length > 1) {
      wishX /= length
      wishZ /= length
    }

    const speed = this.inWater
      ? PLAYER.swimSpeed
      : input.run
        ? PLAYER.runSpeed
        : PLAYER.walkSpeed

    // В воздухе разгон слабее, чем на земле: прыжок перестаёт быть свободным полётом.
    const accel = this.onGround || this.inWater ? 14 : 4
    const blend = Math.min(1, accel * dt)
    this.velocity.x += (wishX * speed - this.velocity.x) * blend
    this.velocity.z += (wishZ * speed - this.velocity.z) * blend

    if (this.inWater) {
      // Вода тормозит падение и слегка выталкивает наверх.
      this.velocity.y += (PLAYER.swimBuoyancy - PLAYER.gravity * 0.42) * dt
      this.velocity.y *= 0.92
      if (input.jump) this.velocity.y = PLAYER.swimSpeed
    } else {
      this.velocity.y -= PLAYER.gravity * dt
      if (input.jump && this.onGround) this.velocity.y = PLAYER.jumpSpeed
    }

    // Ограничение скорости падения, чтобы на любом кадре не проскочить сквозь пол.
    this.velocity.y = Math.max(this.velocity.y, -55)
  }

  /**
   * Двигает игрока подшагами. Один длинный шаг на просадке кадра мог бы перескочить
   * блок целиком, и игрок провалился бы через пол.
   */
  private integrate(dt: number, world: CollisionSource): void {
    const longest =
      Math.max(Math.abs(this.velocity.x), Math.abs(this.velocity.y), Math.abs(this.velocity.z)) * dt
    const steps = Math.max(1, Math.ceil(longest / MAX_STEP))
    const sub = dt / steps

    for (let i = 0; i < steps; i++) {
      this.moveX(world, this.velocity.x * sub)
      this.moveY(world, this.velocity.y * sub)
      this.moveZ(world, this.velocity.z * sub)
    }
  }

  private moveX(world: CollisionSource, delta: number): void {
    if (delta === 0) return
    this.position.x += delta
    const b = this.bounds()
    const y0 = Math.floor(b.minY)
    const y1 = Math.floor(b.maxY - EPS)
    const z0 = Math.floor(b.minZ)
    const z1 = Math.floor(b.maxZ - EPS)

    if (delta > 0) {
      const tx = Math.floor(b.maxX - EPS)
      if (anySolid(world, tx, tx, y0, y1, z0, z1)) {
        this.position.x = tx - HALF - EPS
        this.velocity.x = 0
      }
    } else {
      const tx = Math.floor(b.minX)
      if (anySolid(world, tx, tx, y0, y1, z0, z1)) {
        this.position.x = tx + 1 + HALF + EPS
        this.velocity.x = 0
      }
    }
  }

  private moveZ(world: CollisionSource, delta: number): void {
    if (delta === 0) return
    this.position.z += delta
    const b = this.bounds()
    const y0 = Math.floor(b.minY)
    const y1 = Math.floor(b.maxY - EPS)
    const x0 = Math.floor(b.minX)
    const x1 = Math.floor(b.maxX - EPS)

    if (delta > 0) {
      const tz = Math.floor(b.maxZ - EPS)
      if (anySolid(world, x0, x1, y0, y1, tz, tz)) {
        this.position.z = tz - HALF - EPS
        this.velocity.z = 0
      }
    } else {
      const tz = Math.floor(b.minZ)
      if (anySolid(world, x0, x1, y0, y1, tz, tz)) {
        this.position.z = tz + 1 + HALF + EPS
        this.velocity.z = 0
      }
    }
  }

  private moveY(world: CollisionSource, delta: number): void {
    if (delta === 0) return
    this.position.y += delta
    const b = this.bounds()
    const x0 = Math.floor(b.minX)
    const x1 = Math.floor(b.maxX - EPS)
    const z0 = Math.floor(b.minZ)
    const z1 = Math.floor(b.maxZ - EPS)

    if (delta > 0) {
      const ty = Math.floor(b.maxY - EPS)
      if (anySolid(world, x0, x1, ty, ty, z0, z1)) {
        this.position.y = ty - PLAYER.height - EPS
        this.velocity.y = 0
      }
    } else {
      const ty = Math.floor(b.minY)
      if (anySolid(world, x0, x1, ty, ty, z0, z1)) {
        // Ставим ровно на поверхность блока: onGround отдельно проверяется зондом ниже,
        // поэтому зазор здесь только помешал бы.
        this.position.y = ty + 1
        this.velocity.y = 0
      }
    }
  }

  /**
   * Отдельный зонд опоры чуть ниже ступней. Судить о земле по факту столкновения нельзя:
   * стоя ровно на блоке, игрок формально ни с чем не пересекается, и onGround мерцал бы.
   */
  private probeGround(world: CollisionSource): boolean {
    if (this.velocity.y > 0.01) return false
    const b = this.bounds()
    const y = Math.floor(b.minY - 0.06)
    return anySolid(
      world,
      Math.floor(b.minX),
      Math.floor(b.maxX - EPS),
      y,
      y,
      Math.floor(b.minZ),
      Math.floor(b.maxZ - EPS),
    )
  }

  /** Пересекает ли коробка игрока хоть один твёрдый блок в текущей позиции. */
  intersectsSolid(world: CollisionSource): boolean {
    const b = this.bounds()
    return anySolid(
      world,
      Math.floor(b.minX),
      Math.floor(b.maxX - EPS),
      Math.floor(b.minY),
      Math.floor(b.maxY - EPS),
      Math.floor(b.minZ),
      Math.floor(b.maxZ - EPS),
    )
  }
}

/** Есть ли твёрдый блок в целочисленном диапазоне (границы включительно). */
function anySolid(
  world: CollisionSource,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
): boolean {
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        if (world.isSolidAt(x, y, z)) return true
      }
    }
  }
  return false
}

/** Пересекается ли коробка игрока с конкретным блоком — нужно, чтобы не замуровать себя. */
export function playerOverlapsBlock(
  position: THREE.Vector3,
  bx: number,
  by: number,
  bz: number,
): boolean {
  return (
    position.x + HALF > bx &&
    position.x - HALF < bx + 1 &&
    position.y + PLAYER.height > by &&
    position.y < by + 1 &&
    position.z + HALF > bz &&
    position.z - HALF < bz + 1
  )
}
