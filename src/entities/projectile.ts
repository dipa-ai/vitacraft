import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { CollisionSource } from '../player/player'

/** Гравитация снарядов: заметно слабее игроцкой, чтобы дуга полёта была читаемой. */
const PROJECTILE_GRAVITY = 14

/**
 * Летящий комок. Один класс обслуживает и метательное игрока (клавиша F), и плевки
 * босса — различаются только цветом, уроном и владельцем.
 */
export class Projectile {
  readonly position = new THREE.Vector3()
  /**
   * Позиция на прошлом кадре. Столкновения проверяются по отрезку между кадрами:
   * на скорости 22 блока в секунду снаряд смещается за кадр почти на треть блока и,
   * если сверять только конечные точки, пролетает мимо цели сквозь неё.
   */
  readonly previousPosition = new THREE.Vector3()
  readonly velocity = new THREE.Vector3()
  readonly mesh: THREE.Mesh
  /** Снаряд израсходован и его надо убрать со сцены. */
  spent = false

  private life: number

  constructor(
    origin: THREE.Vector3,
    velocity: THREE.Vector3,
    readonly damage: number,
    color: number,
    /** Снаряды игрока бьют босса, снаряды босса — игрока. */
    readonly fromPlayer: boolean,
    readonly radius = 0.4,
    lifetime = 5,
  ) {
    this.position.copy(origin)
    this.previousPosition.copy(origin)
    this.velocity.copy(velocity)
    this.life = lifetime

    this.mesh = new THREE.Mesh(
      new RoundedBoxGeometry(radius * 2, radius * 2, radius * 2, 2, radius * 0.5),
      // emissiveIntensity выше единицы намеренно: только так снаряд перешагивает порог
      // блума и начинает светиться, а не просто выглядит ярче. Значение согласовано
      // с порогом в scene.ts — комок должен светиться, всё остальное нет.
      new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 3.2 }),
    )
    this.mesh.position.copy(origin)
  }

  /** @returns true, если снаряд врезался в блок. */
  update(dt: number, world: CollisionSource): boolean {
    this.life -= dt
    if (this.life <= 0) {
      this.spent = true
      return false
    }

    this.previousPosition.copy(this.position)
    this.velocity.y -= PROJECTILE_GRAVITY * dt
    this.position.addScaledVector(this.velocity, dt)
    this.mesh.position.copy(this.position)
    this.mesh.rotation.x += dt * 6
    this.mesh.rotation.y += dt * 4

    if (world.isSolidAt(this.position.x, this.position.y, this.position.z)) {
      this.spent = true
      return true
    }
    return false
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}
