import * as THREE from 'three'
import { PLAYER } from '../config/tuning'
import { isWater, type Block } from '../world/blocks'

/**
 * Everything player physics needs from the world. World satisfies this structurally,
 * while tests can supply a tiny two-block scene instead of a whole terrain generator.
 */
export interface CollisionSource {
  getVoxel(x: number, y: number, z: number): Block
  isSolidAt(x: number, y: number, z: number): boolean
}

/** What the player wants to do this frame. Filled in by controls.ts. */
export interface MoveInput {
  /** -1 backward, +1 forward. */
  forward: number
  /** -1 left, +1 right. */
  right: number
  jump: boolean
  run: boolean
}

const HALF = PLAYER.width / 2
/** Margin so the player doesn't end up exactly in a block's plane after a stop. */
const EPS = 1e-3
/** Max integration step in blocks: guards against tunneling through walls on lag. */
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
 * The player as an AABB in the voxel grid. Position is the feet center: box center
 * on X and Z, box bottom on Y.
 *
 * Collisions resolve per axis. Moving and resolving everything at once makes the
 * player stick in inner corners and unable to slide along walls.
 */
export class Player {
  readonly position = new THREE.Vector3()
  readonly velocity = new THREE.Vector3()

  /** Look direction. Also used to rotate the third-person model. */
  yaw = 0
  pitch = 0

  onGround = false
  inWater = false
  // The explicit annotation is required: tuning.ts values are as const, and without
  // it the type would narrow to a literal and forbid any other health value.
  health: number = PLAYER.maxHealth
  /** Remaining invulnerability after taking damage, seconds. */
  invulnerable = 0
  dead = false

  /** Time since the last hit — regeneration depends on it. */
  private sinceDamage = Infinity
  private regenAccumulator = 0
  /** Called when a heart regenerates — the HUD may react. */
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

  /** Eye position — also the first-person camera position. */
  eyePosition(target: THREE.Vector3): THREE.Vector3 {
    return target.set(this.position.x, this.position.y + PLAYER.eyeHeight, this.position.z)
  }

  /** Look direction as a unit vector. */
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

  /** Applies damage honoring invulnerability. Returns true if the hit landed. */
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

    // Swim when mid-body is in water, not just the feet: in shallows the player
    // would otherwise flip between swimming and walking.
    this.inWater = isWater(
      world.getVoxel(this.position.x, this.position.y + PLAYER.height * 0.5, this.position.z),
    )

    this.applyMovement(dt, input)
    this.integrate(dt, world)
    this.onGround = this.probeGround(world)
  }

  /** Hearts regenerate on their own — but not right after a hit, so combat stays combat. */
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
    // The Z axis points backward — that's how three.js cameras work, so forward is negative.
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

    // Weaker acceleration mid-air than on the ground: jumping is not free flight.
    const accel = this.onGround || this.inWater ? 14 : 4
    const blend = Math.min(1, accel * dt)
    this.velocity.x += (wishX * speed - this.velocity.x) * blend
    this.velocity.z += (wishZ * speed - this.velocity.z) * blend

    if (this.inWater) {
      // Water slows the fall and gently pushes upward.
      this.velocity.y += (PLAYER.swimBuoyancy - PLAYER.gravity * 0.42) * dt
      this.velocity.y *= 0.92
      if (input.jump) this.velocity.y = PLAYER.swimSpeed
    } else {
      this.velocity.y -= PLAYER.gravity * dt
      if (input.jump && this.onGround) this.velocity.y = PLAYER.jumpSpeed
    }

    // Cap fall speed so no frame can tunnel through the floor.
    this.velocity.y = Math.max(this.velocity.y, -55)
  }

  /**
   * Moves the player in substeps. One long step on a frame hitch could skip a whole
   * block and drop the player through the floor.
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
        // Land exactly on the block surface: onGround is probed separately below,
        // so a gap here would only get in the way.
        this.position.y = ty + 1
        this.velocity.y = 0
      }
    }
  }

  /**
   * A separate support probe just below the feet. Ground cannot be judged from
   * collisions: standing exactly on a block, the player overlaps nothing, and
   * onGround would flicker.
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

  /** Whether the player box overlaps any solid block at the current position. */
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

/** Whether any solid block exists in the integer range (bounds inclusive). */
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

/** Whether the player box overlaps a specific block — prevents self-entombment. */
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
