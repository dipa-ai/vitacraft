import * as THREE from 'three'
import { isWater } from '../world/blocks'
import type { CharacterModel } from '../render/models'
import type { CollisionSource } from '../player/player'

/** Creature gravity. Slightly softer than the player's — critters look fluffier. */
const GRAVITY = 22

/**
 * Base for smurfs and the boss: a grounded box, simple gravity, health and a model.
 *
 * Physics here is deliberately simpler than the player's: creatures roam the village
 * and open fields and need neither precise wall sliding nor swimming. They do get a
 * one-block step-up — without it a smurf sticks on every bump.
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
    /** Half of the box width. */
    readonly radius: number,
    readonly height: number,
  ) {
    this.health = maxHealth
  }

  get group(): THREE.Group {
    return this.model.group
  }

  /** The point aimed at and flown to by projectiles. */
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

  /** Whether the creature is in water (measured mid-body). */
  protected inWater = false

  // --- Navigation without pathfinding: stuck detector + detour maneuver. ---
  // Shared by all creatures: a smurf at a house wall and a sheep wedged into a
  // corner are cured the same way — no movement for a second means swerve aside.
  private readonly navLastPosition = new THREE.Vector3(Number.NaN, 0, Number.NaN)
  private navCheckTimer = 1
  private detourTimer = 0
  private detourSign = 1

  /** Called every frame while the creature is actually trying to walk somewhere. */
  protected updateNav(dt: number, targetDistance: number): void {
    this.detourTimer = Math.max(0, this.detourTimer - dt)
    this.navCheckTimer -= dt
    if (this.navCheckTimer > 0) return
    this.navCheckTimer = 1

    const moved = Number.isNaN(this.navLastPosition.x)
      ? Infinity
      : Math.hypot(
          this.position.x - this.navLastPosition.x,
          this.position.z - this.navLastPosition.z,
        )
    if (moved < 0.35 && targetDistance > 2) {
      this.detourTimer = 1.6
      this.detourSign = Math.random() < 0.5 ? 1 : -1
    }
    this.navLastPosition.copy(this.position)
  }

  /** Rotates the desired direction ~75° while a detour is active. */
  protected steer(dx: number, dz: number): readonly [number, number] {
    if (this.detourTimer <= 0) return [dx, dz]
    const angle = this.detourSign * 1.3
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    return [dx * cos - dz * sin, dx * sin + dz * cos]
  }

  /** Gravity and support. Returns true if the creature just touched the ground. */
  protected applyGravity(dt: number, world: CollisionSource): boolean {
    // In water creatures float up and swim on top: a smurf drowning mid-lake and
    // stuck at an underwater slope is exactly the bug this exists for.
    this.inWater = isWater(
      world.getVoxel(this.position.x, this.position.y + this.height * 0.5, this.position.z),
    )
    if (this.inWater) {
      this.velocity.y = Math.min(this.velocity.y + 30 * dt, 2.2)
      this.position.y += this.velocity.y * dt
      this.onGround = false
      return false
    }

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

  /** Top of the nearest solid block beneath the creature. */
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
   * Horizontal movement from velocity, with a one-block step-up — without it a
   * creature bumps into any mound and treads in place. Axes are handled separately
   * so hitting a wall produces sliding along it.
   *
   * Velocity is the movement source on purpose: stride animation speed reads it too.
   */
  protected stepMove(world: CollisionSource, dt: number): void {
    // Anti-stuck: a creature ending up inside a solid block (spawned into a tree
    // trunk, block settled on it) is gently pushed upward — otherwise it is locked
    // forever and no detour can help.
    if (this.blockedAt(world, this.position.x, this.position.y, this.position.z)) {
      this.position.y += 4 * dt
      this.velocity.y = 0
      return
    }

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

    // A one-block obstacle — step over it. From water too: shoring up is a step-up.
    if ((this.onGround || this.inWater) && !this.blockedAt(world, nextX, this.position.y + 1, nextZ)) {
      this.position.x = nextX
      this.position.z = nextZ
      this.position.y += 1
      return false
    }

    return true
  }

  /** Whether the creature's box overlaps solid blocks at the given point. */
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
   * Ray hit distance to the creature, or null. The shape is a sphere: it forgives
   * imprecise aim, which feels better in first-person combat than an exact box.
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

  /** Turns the model toward its movement or target. */
  protected faceTowards(x: number, z: number, dt: number, speed = 9): void {
    const desired = Math.atan2(-(x - this.position.x), -(z - this.position.z))
    const current = this.group.rotation.y
    // Shortest-arc turn, or the model spins the long way around.
    let delta = ((desired - current + Math.PI) % (Math.PI * 2)) - Math.PI
    if (delta < -Math.PI) delta += Math.PI * 2
    this.group.rotation.y = current + delta * Math.min(1, speed * dt)
  }

  /** Syncs the mesh with the position and drives the animation. */
  protected syncModel(elapsed: number, dt: number): void {
    this.group.position.copy(this.position)
    const speed = Math.hypot(this.velocity.x, this.velocity.z)
    this.model.animate(elapsed, speed, dt)
  }

  dispose(): void {
    this.model.dispose()
  }
}
