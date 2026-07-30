import * as THREE from 'three'
import { BOSS } from '../config/tuning'
import { isSolid } from '../world/blocks'
import type { World } from '../world/world'
import { createBossModel } from '../render/models'
import { Entity } from './entity'

export type BossState =
  | 'intro'
  | 'idle'
  | 'chase'
  | 'leap-telegraph'
  | 'leap-air'
  | 'dash-telegraph'
  | 'dash'
  | 'burrow-dig'
  | 'burrow-move'
  | 'recover'
  | 'dying'
  | 'dead'

/** Boss model height at unit scale — before multiplying by BOSS.scale. */
const MODEL_HEIGHT = 1.9
const MODEL_RADIUS = 0.7

/**
 * Vitruylan — a giant ginger rabbit. Attacks are rabbit-themed: a long leap with a
 * shockwave, a fast dash, and a burrow that emerges near the player.
 *
 * Two rules make the fight fair:
 *
 * 1. Every attack has a telegraph: before a leap he crouches and pins his ears,
 *    before a dash he leans forward, before a burrow he digs. Without warning the
 *    boss would be a lottery.
 * 2. The shockwave only hits standing on the ground, so it is dodged by jumping.
 *
 * The boss never deliberately breaks voxels: the player invested in the village,
 * and destroying it would feel like punishing them for playing.
 */
export class Boss extends Entity {
  state: BossState = 'intro'
  private timer = 1.6
  private hopTimer = 0
  private dashHit = false
  private readonly dashDirection = new THREE.Vector3()
  private readonly burrowTarget = new THREE.Vector3()
  private tremorTimer = 0
  private dyingProgress = 0

  onSlam: ((origin: THREE.Vector3, radius: number, damage: number) => void) | null = null
  /** Dash contact — melee damage. */
  onTouch: ((damage: number) => void) | null = null
  /** Ground tremor while the boss travels underground — telegraph for the emerge spot. */
  onTremor: ((position: THREE.Vector3) => void) | null = null
  onIntroDone: (() => void) | null = null
  onDefeated: (() => void) | null = null
  onRoar: ((text: string) => void) | null = null

  private readonly scratch = new THREE.Vector3()

  constructor(spawn: THREE.Vector3) {
    super(
      createBossModel(),
      BOSS.maxHealth,
      MODEL_RADIUS * BOSS.scale * 0.55,
      MODEL_HEIGHT * BOSS.scale,
    )
    this.position.copy(spawn)
    this.group.scale.setScalar(BOSS.scale)
  }

  get phase(): number {
    const fraction = this.health / this.maxHealth
    if (fraction > BOSS.phase2At) return 1
    if (fraction > BOSS.phase3At) return 2
    return 3
  }

  get healthFraction(): number {
    return this.health / this.maxHealth
  }

  /** With each phase the rabbit gets faster and meaner. */
  private get aggression(): number {
    return this.phase === 1 ? 1 : this.phase === 2 ? BOSS.enrageSpeedBonus : BOSS.enrageSpeedBonus * 1.25
  }

  takeDamage(amount: number): boolean {
    if (this.state === 'dying' || this.state === 'dead' || this.state === 'intro') return false
    // Untargetable underground — otherwise burrow would be free damage on the boss.
    if (this.state === 'burrow-move') return false
    const phaseBefore = this.phase
    const applied = super.takeDamage(amount)
    if (!applied) return false

    if (this.health === 0) {
      this.state = 'dying'
      this.timer = 1.4
      this.velocity.set(0, 0, 0)
      this.group.visible = true
    } else if (this.phase !== phaseBefore) {
      this.onRoar?.(
        this.phase === 2
          ? 'Витрулян прижал уши и разогнался!'
          : 'Витрулян в ярости! Осталось немного',
      )
    }
    return true
  }

  update(dt: number, world: World, elapsed: number, playerPosition: THREE.Vector3): void {
    if (this.state === 'dead') return

    this.timer -= dt
    this.hopTimer -= dt

    if (this.onGround) {
      this.velocity.x *= 0.86
      this.velocity.z *= 0.86
    }

    switch (this.state) {
      case 'intro':
        this.model.squash = 0
        if (this.timer <= 0) {
          this.state = 'idle'
          this.timer = 0.8
          this.onIntroDone?.()
        }
        break

      case 'idle':
        this.faceTowards(playerPosition.x, playerPosition.z, dt, 4)
        if (this.timer <= 0) this.chooseAttack(playerPosition)
        break

      case 'chase':
        this.chase(dt, playerPosition)
        if (this.timer <= 0) this.chooseAttack(playerPosition)
        break

      case 'leap-telegraph': {
        // Crouches and pins ears — that is how the leap reads in advance.
        const t = 1 - Math.max(0, this.timer) / BOSS.leapTelegraph
        this.model.squash = t
        this.setEars(-t * 1.1)
        this.faceTowards(playerPosition.x, playerPosition.z, dt, 6)
        if (this.timer <= 0) {
          this.model.squash = 0
          this.setEars(0)
          this.state = 'leap-air'
          this.velocity.y = 13
          // Horizontal speed is tuned to flight time so the leap lands on the player.
          const toPlayer = this.scratch.subVectors(playerPosition, this.position).setY(0)
          const distance = toPlayer.length()
          if (distance > 0.01) {
            const airTime = 1.1
            const speed = Math.min(BOSS.leapSpeed, distance / airTime)
            toPlayer.normalize().multiplyScalar(speed)
            this.velocity.x = toPlayer.x
            this.velocity.z = toPlayer.z
          }
        }
        break
      }

      case 'leap-air':
        // A heavy fall reads better than a gentle descent.
        if (this.velocity.y < 0) this.velocity.y -= 18 * dt
        break

      case 'dash-telegraph': {
        const t = 1 - Math.max(0, this.timer) / BOSS.dashTelegraph
        // Lean forward instead of crouching — dash telegraphs differently from leap.
        this.body.rotation.x = t * 0.35
        this.faceTowards(playerPosition.x, playerPosition.z, dt, 8)
        if (this.timer <= 0) {
          this.state = 'dash'
          this.timer = BOSS.dashDuration
          this.dashHit = false
          this.dashDirection.subVectors(playerPosition, this.position).setY(0)
          if (this.dashDirection.lengthSq() < 0.01) this.dashDirection.set(0, 0, 1)
          this.dashDirection.normalize()
        }
        break
      }

      case 'dash': {
        this.velocity.x = this.dashDirection.x * BOSS.dashSpeed
        this.velocity.z = this.dashDirection.z * BOSS.dashSpeed
        // Contact damage once per dash; i-frames protect after that.
        if (!this.dashHit) {
          const distance = Math.hypot(
            playerPosition.x - this.position.x,
            playerPosition.z - this.position.z,
          )
          if (distance < this.radius + 0.9) {
            this.dashHit = true
            this.onTouch?.(BOSS.dashDamage)
          }
        }
        if (this.timer <= 0) {
          this.body.rotation.x = 0
          this.state = 'recover'
          this.timer = 0.5
        }
        break
      }

      case 'burrow-dig': {
        const t = 1 - Math.max(0, this.timer) / BOSS.burrowTelegraph
        this.model.squash = t
        if (this.timer <= 0) {
          this.model.squash = 0
          this.state = 'burrow-move'
          this.timer = BOSS.burrowTravel
          this.group.visible = false
          this.burrowTarget.copy(this.position)
        }
        break
      }

      case 'burrow-move': {
        // Tremor crawls from the dig site toward the player — they see where he will emerge.
        this.tremorTimer -= dt
        const progress = 1 - Math.max(0, this.timer) / BOSS.burrowTravel
        this.burrowTarget.lerpVectors(this.burrowStart, playerPosition, progress)
        if (this.tremorTimer <= 0) {
          this.tremorTimer = 0.14
          this.onTremor?.(
            this.scratch.set(
              this.burrowTarget.x,
              world.groundY(this.burrowTarget.x, this.burrowTarget.z),
              this.burrowTarget.z,
            ),
          )
        }
        if (this.timer <= 0) this.emerge(world, playerPosition)
        break
      }

      case 'recover':
        this.setEars(0)
        this.body.rotation.x = 0
        if (this.timer <= 0) {
          this.state = 'chase'
          this.timer = BOSS.attackCooldown / this.aggression
        }
        break

      case 'dying':
        this.dyingProgress = Math.min(1, this.dyingProgress + dt / 1.4)
        this.group.scale.setScalar(BOSS.scale * (1 - this.dyingProgress * 0.85))
        this.group.rotation.y += dt * 5
        if (this.timer <= 0) {
          this.state = 'dead'
          this.onDefeated?.()
        }
        break
    }

    // No physics underground: the boss moves as a tremor, not as a body.
    if (this.state !== 'burrow-move') {
      const justLanded = this.applyGravity(dt, world)
      this.stepMove(world, dt)

      if (justLanded && this.state === 'leap-air') {
        this.onSlam?.(this.position.clone(), BOSS.slamRadius, BOSS.slamDamage)
        this.state = 'recover'
        this.timer = 0.7
      }
    }

    this.syncModel(elapsed, dt)
  }

  private get body(): THREE.Group {
    return this.model.body
  }

  private setEars(angle: number): void {
    for (const ear of this.model.ears) ear.rotation.x = angle
  }

  private readonly burrowStart = new THREE.Vector3()

  private chase(dt: number, playerPosition: THREE.Vector3): void {
    this.faceTowards(playerPosition.x, playerPosition.z, dt, 5)
    const dx = playerPosition.x - this.position.x
    const dz = playerPosition.z - this.position.z
    const distance = Math.hypot(dx, dz)
    if (distance < 0.001) return

    const speed = BOSS.chaseSpeed * this.aggression
    // In hops, not a smooth slide — he is a rabbit.
    if (this.onGround && this.hopTimer <= 0) {
      this.hopTimer = 0.55
      this.velocity.y = 6
      this.velocity.x = (dx / distance) * speed
      this.velocity.z = (dz / distance) * speed
    }
  }

  private chooseAttack(playerPosition: THREE.Vector3): void {
    const distance = Math.hypot(
      playerPosition.x - this.position.x,
      playerPosition.z - this.position.z,
    )

    // Far away — leap; up close — dash; burrow mixes in at mid range so the player
    // has a reason to manage distance.
    const roll = Math.random()
    if (distance > 13) {
      this.state = roll < 0.3 ? 'burrow-dig' : 'leap-telegraph'
    } else if (distance > 6) {
      this.state = roll < 0.35 ? 'burrow-dig' : roll < 0.7 ? 'dash-telegraph' : 'leap-telegraph'
    } else {
      this.state = roll < 0.5 ? 'dash-telegraph' : 'leap-telegraph'
    }

    if (this.state === 'leap-telegraph') this.timer = BOSS.leapTelegraph
    else if (this.state === 'dash-telegraph') this.timer = BOSS.dashTelegraph
    else {
      this.timer = BOSS.burrowTelegraph
      this.burrowStart.copy(this.position)
    }
  }

  /** Emerges near the player — but only where there is room above ground. */
  private emerge(world: World, playerPosition: THREE.Vector3): void {
    let bestX = this.burrowStart.x
    let bestZ = this.burrowStart.z

    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = Math.random() * Math.PI * 2
      const radius = 2 + Math.random() * (BOSS.emergeRadius - 2)
      const x = playerPosition.x + Math.cos(angle) * radius
      const z = playerPosition.z + Math.sin(angle) * radius
      const y = world.groundY(x, z)
      // Check clearance above ground: do not emerge inside a building.
      let clear = true
      for (let dy = 0; dy < 4 && clear; dy++) {
        if (isSolid(world.getVoxel(x, y + dy, z))) clear = false
      }
      if (clear) {
        bestX = x
        bestZ = z
        break
      }
    }

    this.position.set(bestX, world.groundY(bestX, bestZ), bestZ)
    this.velocity.set(0, 9, 0)
    this.group.visible = true
    this.onSlam?.(this.position.clone(), BOSS.emergeShockRadius, BOSS.emergeDamage)
    this.state = 'recover'
    this.timer = 0.6
  }
}
