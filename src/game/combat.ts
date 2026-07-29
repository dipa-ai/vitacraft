import * as THREE from 'three'
import { BOSS, PLAYER } from '../config/tuning'
import { FX_COLORS } from '../config/palette'
import type { Boss } from '../entities/boss'
import { Projectile } from '../entities/projectile'
import type { EntityRayHit } from '../player/interact'
import type { Player } from '../player/player'
import type { Fx } from '../render/fx'
import type { World } from '../world/world'

/**
 * Расходящаяся ударная волна от прыжка босса.
 *
 * Урон наносится в момент, когда фронт волны проходит через игрока, и только если тот
 * стоит на земле. Именно из этого и рождается способ уклонения: подпрыгнуть в нужный
 * момент. Проверять всю зону сразу нельзя — тогда прыжок ничего не давал бы.
 */
class Shockwave {
  radius = 0
  hitPlayer = false

  constructor(
    readonly origin: THREE.Vector3,
    readonly maxRadius: number,
    readonly damage: number,
  ) {}
}

/** Толщина фронта волны. Слишком тонкий фронт игрок бы просто перескакивал по случайности. */
const WAVE_THICKNESS = 1.6

/**
 * Кратчайшее расстояние от точки до отрезка. Нужно, чтобы быстрый снаряд проверялся
 * по всему пройденному за кадр пути: сверка одних конечных точек пропускает попадания.
 */
function distanceToSegment(
  point: THREE.Vector3,
  from: THREE.Vector3,
  to: THREE.Vector3,
  scratch: THREE.Vector3,
): number {
  const segX = to.x - from.x
  const segY = to.y - from.y
  const segZ = to.z - from.z
  const lengthSq = segX * segX + segY * segY + segZ * segZ
  if (lengthSq < 1e-9) return point.distanceTo(from)

  let t = ((point.x - from.x) * segX + (point.y - from.y) * segY + (point.z - from.z) * segZ) / lengthSq
  t = Math.max(0, Math.min(1, t))
  scratch.set(from.x + segX * t, from.y + segY * t, from.z + segZ * t)
  return point.distanceTo(scratch)
}

export class Combat {
  private readonly projectiles: Projectile[] = []
  private readonly waves: Shockwave[] = []
  private readonly scratch = new THREE.Vector3()
  private readonly scratchB = new THREE.Vector3()

  private throwCooldown = 0
  boss: Boss | null = null

  onPlayerHurt: (() => void) | null = null
  onBossHurt: ((amount: number) => void) | null = null

  constructor(
    private readonly world: World,
    private readonly scene: THREE.Scene,
    private readonly player: Player,
    private readonly fx: Fx,
  ) {}

  /** Метательное игрока по клавише F. */
  throwFromPlayer(): boolean {
    if (this.throwCooldown > 0) return false
    this.throwCooldown = PLAYER.throwCooldown

    const origin = this.player.eyePosition(this.scratch).clone()
    const direction = this.player.lookDirection(this.scratchB).clone()
    // Небольшой подъём: без него комок падает раньше, чем долетит до цели.
    const velocity = direction.multiplyScalar(PLAYER.throwSpeed)
    velocity.y += 3.5

    this.spawn(
      new Projectile(origin, velocity, PLAYER.throwDamage, FX_COLORS.playerBlob, true, 0.3),
    )
    return true
  }

  /** Плевок босса по дуге в указанную точку. */
  bossSpit(origin: THREE.Vector3, target: THREE.Vector3): void {
    const velocity = this.ballisticVelocity(origin, target, BOSS.spitSpeed)
    this.spawn(
      new Projectile(origin.clone(), velocity, BOSS.spitDamage, FX_COLORS.bossSpit, false, 0.5),
    )
  }

  /**
   * Начальная скорость, чтобы снаряд по дуге пришёл примерно в цель.
   * Точное баллистическое решение здесь не нужно: снаряд должен быть уклоняемым,
   * а не самонаводящимся.
   */
  private ballisticVelocity(
    origin: THREE.Vector3,
    target: THREE.Vector3,
    speed: number,
  ): THREE.Vector3 {
    const to = new THREE.Vector3().subVectors(target, origin)
    const horizontal = Math.hypot(to.x, to.z)
    const flightTime = Math.max(0.35, horizontal / speed)
    return new THREE.Vector3(
      to.x / flightTime,
      to.y / flightTime + 0.5 * 14 * flightTime,
      to.z / flightTime,
    )
  }

  /** Прыжок босса приземлился: пускаем волну и трясём экран. */
  slam(origin: THREE.Vector3, radius: number): void {
    this.waves.push(new Shockwave(origin.clone(), radius, BOSS.slamDamage))
    this.fx.shockwave(origin, radius, radius / BOSS.shockwaveSpeed)
    this.fx.burst(origin.clone().setY(origin.y + 0.4), FX_COLORS.dust, 26, {
      speed: 7,
      size: 0.22,
      spread: 1.2,
      life: 0.9,
    })
    this.fx.addShake(0.75)
  }

  private spawn(projectile: Projectile): void {
    this.projectiles.push(projectile)
    this.scene.add(projectile.mesh)
  }

  /** Ближайшая цель на луче для ЛКМ. Смурфиков намеренно не задеть. */
  raycastEntities(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
  ): EntityRayHit | null {
    const boss = this.boss
    if (boss === null || boss.dead) return null

    const distance = boss.rayDistance(origin, direction, maxDistance, this.scratch)
    if (distance === null) return null

    return {
      distance,
      applyDamage: () => this.damageBoss(PLAYER.meleeDamage, boss.center(this.scratchB).clone()),
    }
  }

  private damageBoss(amount: number, at: THREE.Vector3): void {
    const boss = this.boss
    if (boss === null || boss.dead) return
    if (!boss.takeDamage(amount)) return
    this.fx.burst(at, FX_COLORS.hitFlash, 10, { speed: 4, size: 0.18, life: 0.5 })
    this.fx.addShake(0.12)
    this.onBossHurt?.(amount)
  }

  private hurtPlayer(amount: number): void {
    if (!this.player.takeDamage(amount)) return
    this.fx.addShake(0.35)
    this.onPlayerHurt?.()
  }

  update(dt: number): void {
    this.throwCooldown = Math.max(0, this.throwCooldown - dt)
    this.updateProjectiles(dt)
    this.updateWaves(dt)
  }

  private updateProjectiles(dt: number): void {
    const boss = this.boss

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i]
      const hitBlock = projectile.update(dt, this.world)

      if (!projectile.spent) {
        if (projectile.fromPlayer) {
          if (boss !== null && !boss.dead) {
            const center = boss.center(this.scratch)
            // Радиус попадания щедрый: в босса размером с дом должно быть легко попасть.
            const reach = projectile.radius + Math.max(boss.radius, boss.height * 0.4)
            const distance = distanceToSegment(
              center,
              projectile.previousPosition,
              projectile.position,
              this.scratchB,
            )
            if (distance < reach) {
              this.damageBoss(projectile.damage, projectile.position.clone())
              projectile.spent = true
            }
          }
        } else {
          const target = this.scratch.set(
            this.player.position.x,
            this.player.position.y + PLAYER.height * 0.5,
            this.player.position.z,
          )
          const distance = distanceToSegment(
            target,
            projectile.previousPosition,
            projectile.position,
            this.scratchB,
          )
          if (distance < projectile.radius + 0.7) {
            this.hurtPlayer(projectile.damage)
            projectile.spent = true
          }
        }
      }

      if (projectile.spent) {
        this.fx.burst(
          projectile.position,
          projectile.fromPlayer ? FX_COLORS.playerBlob : FX_COLORS.bossSpit,
          8,
          { speed: 3, size: 0.13, life: 0.5 },
        )
        this.scene.remove(projectile.mesh)
        projectile.dispose()
        this.projectiles.splice(i, 1)
        continue
      }

      // hitBlock уже помечает снаряд израсходованным; отдельной ветки не нужно.
      void hitBlock
    }
  }

  private updateWaves(dt: number): void {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const wave = this.waves[i]
      wave.radius += BOSS.shockwaveSpeed * dt

      if (!wave.hitPlayer) {
        const distance = Math.hypot(
          this.player.position.x - wave.origin.x,
          this.player.position.z - wave.origin.z,
        )
        if (Math.abs(distance - wave.radius) < WAVE_THICKNESS) {
          wave.hitPlayer = true
          // Ключевое правило боя: волна цепляет только стоящего на земле.
          if (this.player.onGround) {
            this.hurtPlayer(wave.damage)
          }
        }
      }

      if (wave.radius >= wave.maxRadius) this.waves.splice(i, 1)
    }
  }

  /** Полностью сбрасывает бой — нужно при смерти и респавне игрока. */
  clear(): void {
    for (const projectile of this.projectiles) {
      this.scene.remove(projectile.mesh)
      projectile.dispose()
    }
    this.projectiles.length = 0
    this.waves.length = 0
  }
}
