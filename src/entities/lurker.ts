import * as THREE from 'three'
import { NIGHT, PLAYER } from '../config/tuning'
import type { World } from '../world/world'
import { createLurkerModel } from '../render/models'
import { Entity } from './entity'

/**
 * A night critter. Walks straight at the nearest target, sliding along walls via
 * stepMove. No real pathfinding on purpose: an enemy scratching at the wall of a
 * sealed house is exactly the image the night was built for. It breaks no blocks
 * and cannot pass a closed door — "safe indoors" is enforced by physics, not checks.
 */
export class Lurker extends Entity {
  private touchCooldown = 0
  /** Dawn: the critter melts away and should be removed. */
  dissolving = false
  private dissolveProgress = 0

  constructor(spawn: THREE.Vector3) {
    super(createLurkerModel(), NIGHT.lurkerHealth, 0.32, 0.95)
    this.position.copy(spawn)
  }

  /**
   * @param target the nearest target (player or smurf).
   * @returns true if the critter touched a player target this frame and damage applies.
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

    // Only the player gets bitten: critters scare smurfs but never touch them.
    const overlapsPlayerVertically =
      this.position.y < target.y + PLAYER.height && this.position.y + this.height > target.y
    if (
      targetIsPlayer &&
      overlapsPlayerVertically &&
      distance < this.radius + 0.75 &&
      this.touchCooldown <= 0
    ) {
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
