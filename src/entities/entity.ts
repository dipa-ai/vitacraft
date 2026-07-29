import * as THREE from 'three'
import type { CharacterModel } from '../render/models'
import type { CollisionSource } from '../player/player'

/** Гравитация существ. Чуть мягче игроцкой — так живность выглядит «пушистее». */
const GRAVITY = 22

/**
 * База для смурфика и босса: коробка на земле, простая гравитация, здоровье и модель.
 *
 * Физика здесь нарочно проще игроцкой: существа ходят по деревне и по открытому полю,
 * им не нужны ни точное скольжение по стенам, ни плавание. Зато есть шаг на блок вверх —
 * без него смурфик застревает на любой кочке.
 */
export abstract class Entity {
  readonly position = new THREE.Vector3()
  readonly velocity = new THREE.Vector3()
  health: number
  onGround = false
  dead = false

  constructor(
    readonly model: CharacterModel,
    readonly maxHealth: number,
    /** Половина ширины коробки. */
    readonly radius: number,
    readonly height: number,
  ) {
    this.health = maxHealth
  }

  get group(): THREE.Group {
    return this.model.group
  }

  /** Точка, по которой целятся и в которую летят снаряды. */
  center(target: THREE.Vector3): THREE.Vector3 {
    return target.set(this.position.x, this.position.y + this.height * 0.5, this.position.z)
  }

  takeDamage(amount: number): boolean {
    if (this.dead) return false
    this.health = Math.max(0, this.health - amount)
    this.model.hitFlash()
    if (this.health === 0) this.dead = true
    return true
  }

  /** Гравитация и опора. Возвращает true, если существо только что коснулось земли. */
  protected applyGravity(dt: number, world: CollisionSource): boolean {
    this.velocity.y -= GRAVITY * dt
    this.position.y += this.velocity.y * dt

    const wasAirborne = !this.onGround
    this.onGround = false

    if (this.velocity.y <= 0) {
      const groundY = this.groundBelow(world)
      if (groundY !== null && this.position.y <= groundY) {
        this.position.y = groundY
        this.velocity.y = 0
        this.onGround = true
        return wasAirborne
      }
    }
    return false
  }

  /** Верхняя граница ближайшего твёрдого блока под существом. */
  private groundBelow(world: CollisionSource): number | null {
    const x = Math.floor(this.position.x)
    const z = Math.floor(this.position.z)
    const from = Math.ceil(this.position.y)
    for (let y = from; y >= from - 4; y--) {
      if (world.isSolidAt(x, y - 1, z)) return y
    }
    return null
  }

  /**
   * Горизонтальное перемещение из velocity, с шагом на один блок вверх — без него
   * существо упирается в любую кочку и топчется на месте. Оси обрабатываются
   * порознь, чтобы упор в стену давал скольжение вдоль неё.
   *
   * Источник движения — именно velocity: от неё же зависит скорость анимации шага.
   */
  protected stepMove(world: CollisionSource, dt: number): void {
    this.tryMove(world, this.velocity.x * dt, 0)
    this.tryMove(world, 0, this.velocity.z * dt)
  }

  private tryMove(world: CollisionSource, dx: number, dz: number): boolean {
    if (dx === 0 && dz === 0) return false
    const nextX = this.position.x + dx
    const nextZ = this.position.z + dz

    if (!this.blockedAt(world, nextX, this.position.y, nextZ)) {
      this.position.x = nextX
      this.position.z = nextZ
      return false
    }

    // Препятствие в один блок — переступаем через него.
    if (this.onGround && !this.blockedAt(world, nextX, this.position.y + 1, nextZ)) {
      this.position.x = nextX
      this.position.z = nextZ
      this.position.y += 1
      return false
    }

    return true
  }

  /** Пересекает ли коробка существа твёрдые блоки в указанной точке. */
  private blockedAt(world: CollisionSource, x: number, y: number, z: number): boolean {
    const top = y + this.height - 0.05
    for (let cy = Math.floor(y + 0.05); cy <= Math.floor(top); cy++) {
      for (let cx = Math.floor(x - this.radius); cx <= Math.floor(x + this.radius); cx++) {
        for (let cz = Math.floor(z - this.radius); cz <= Math.floor(z + this.radius); cz++) {
          if (world.isSolidAt(cx, cy, cz)) return true
        }
      }
    }
    return false
  }

  /**
   * Расстояние до попадания луча в существо, или null. Форма — сфера: она прощает
   * неточный прицел, что для боя от первого лица приятнее точной коробки.
   */
  rayDistance(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
    scratch: THREE.Vector3,
  ): number | null {
    const center = this.center(scratch)
    const ocX = center.x - origin.x
    const ocY = center.y - origin.y
    const ocZ = center.z - origin.z

    const along = ocX * direction.x + ocY * direction.y + ocZ * direction.z
    if (along < 0) return null

    const radius = Math.max(this.radius, this.height * 0.5)
    const distanceSq = ocX * ocX + ocY * ocY + ocZ * ocZ - along * along
    const radiusSq = radius * radius
    if (distanceSq > radiusSq) return null

    const entry = along - Math.sqrt(radiusSq - distanceSq)
    const hit = Math.max(0, entry)
    return hit <= maxDistance ? hit : null
  }

  /** Разворачивает модель в сторону движения или цели. */
  protected faceTowards(x: number, z: number, dt: number, speed = 9): void {
    const desired = Math.atan2(-(x - this.position.x), -(z - this.position.z))
    const current = this.group.rotation.y
    // Кратчайший поворот, иначе модель разворачивается «через весь круг».
    let delta = ((desired - current + Math.PI) % (Math.PI * 2)) - Math.PI
    if (delta < -Math.PI) delta += Math.PI * 2
    this.group.rotation.y = current + delta * Math.min(1, speed * dt)
  }

  /** Синхронизирует меш с позицией и крутит анимацию. */
  protected syncModel(elapsed: number, dt: number): void {
    this.group.position.copy(this.position)
    const speed = Math.hypot(this.velocity.x, this.velocity.z)
    this.model.animate(elapsed, speed, dt)
  }

  dispose(): void {
    this.model.dispose()
  }
}
