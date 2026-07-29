import * as THREE from 'three'
import { NIGHT } from '../config/tuning'
import type { World } from '../world/world'
import { createLurkerModel } from '../render/models'
import { Entity } from './entity'

/**
 * Ночная зверюшка. Идёт к ближайшей цели по прямой, скользя вдоль стен через stepMove.
 * Полноценного поиска пути нет намеренно: враг, скребущийся в стену закрытого дома, —
 * ровно та картинка, ради которой ночь и делалась. Блоки не ломает, через закрытую
 * дверь не проходит — «в доме безопасно» обеспечивается физикой, а не проверками.
 */
export class Lurker extends Entity {
  private touchCooldown = 0
  /** Рассвет: зверюшка тает и её пора убирать. */
  dissolving = false
  private dissolveProgress = 0

  constructor(spawn: THREE.Vector3) {
    super(createLurkerModel(), NIGHT.lurkerHealth, 0.32, 0.95)
    this.position.copy(spawn)
  }

  /**
   * @param target ближайшая цель (игрок или смурфик).
   * @returns true, если в этом кадре зверюшка коснулась цели-игрока и должен пройти урон.
   */
  update(
    dt: number,
    world: World,
    elapsed: number,
    target: THREE.Vector3,
    targetIsPlayer: boolean,
  ): boolean {
    if (this.dissolving) {
      this.dissolveProgress = Math.min(1, this.dissolveProgress + dt * 2)
      this.group.scale.setScalar(1 - this.dissolveProgress)
      this.syncModel(elapsed, dt)
      return false
    }

    this.applyGravity(dt, world)
    this.touchCooldown = Math.max(0, this.touchCooldown - dt)

    const dx = target.x - this.position.x
    const dz = target.z - this.position.z
    const distance = Math.hypot(dx, dz)

    if (distance > 0.6) {
      this.velocity.x = (dx / distance) * NIGHT.lurkerSpeed
      this.velocity.z = (dz / distance) * NIGHT.lurkerSpeed
      this.faceTowards(target.x, target.z, dt, 6)
    } else {
      this.velocity.x = 0
      this.velocity.z = 0
    }

    this.stepMove(world, dt)
    this.syncModel(elapsed, dt)

    // Кусается только игрок: смурфиков зверюшки пугают, но не трогают.
    if (targetIsPlayer && distance < this.radius + 0.75 && this.touchCooldown <= 0) {
      this.touchCooldown = NIGHT.lurkerTouchCooldown
      return true
    }
    return false
  }

  get dissolved(): boolean {
    return this.dissolveProgress >= 1
  }

  startDissolve(): void {
    this.dissolving = true
  }
}
