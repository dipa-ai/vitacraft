import * as THREE from 'three'
import { BOSS, PLAYER } from '../config/tuning'
import { FX_COLORS } from '../config/palette'
import type { Boss } from '../entities/boss'
import type { Entity } from '../entities/entity'
import { Projectile } from '../entities/projectile'
import type { EntityRayHit } from '../player/interact'
import type { Player } from '../player/player'
import type { Fx } from '../render/fx'
import type { World } from '../world/world'

/**
 * Расходящаяся ударная волна от прыжка босса.
 *
 * Урон наносится в момент, когда фронт волны проходит через игрока, и только если тот
 * стоит на земле. Именно из этого рождается способ уклонения: подпрыгнуть в нужный
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
  /** Дополнительные цели (ночные враги). Список подставляет менеджер ночи. */
  enemies: readonly Entity[] = []

  onPlayerHurt: (() => void) | null = null
  onBossHurt: ((amount: number) => void) | null = null

  constructor(
    private readonly world: World,
    private readonly scene: THREE.Scene,
    private readonly player: Player,
    private readonly fx: Fx,
  ) {}

  /** Все живые цели для ЛКМ и снарядов игрока. */
  private *targets(): Iterable<Entity> {
    if (this.boss !== null && !this.boss.dead) yield this.boss
    for (const enemy of this.enemies) {
      if (!enemy.dead) yield enemy
    }
  }

  /**
   * Метательное игрока по клавише F. Заряд (облачко) проверяет и тратит вызывающий:
   * у боевой системы нет доступа к инвентарю, и это правильно.
   */
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

  /** Ударная волна: прыжок и выныривание босса зовут её с разной силой. */
  slam(origin: THREE.Vector3, radius: number, damage: number = BOSS.slamDamage): void {
    this.waves.push(new Shockwave(origin.clone(), radius, damage))
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

  /** Ближайшая цель на луче для ЛКМ. Смурфиков и животных намеренно не задеть. */
  raycastEntities(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
  ): EntityRayHit | null {
    let best: { distance: number; entity: Entity } | null = null
    for (const entity of this.targets()) {
      const distance = entity.rayDistance(origin, direction, maxDistance, this.scratch)
      if (distance !== null && (best === null || distance < best.distance)) {
        best = { distance, entity }
      }
    }
    if (best === null) return null

    const target = best.entity
    return {
      distance: best.distance,
      applyDamage: () =>
        this.damageEntity(target, PLAYER.meleeDamage, target.center(this.scratchB).clone()),
    }
  }

  private damageEntity(entity: Entity, amount: number, at: THREE.Vector3): void {
    if (entity.dead) return
    if (!entity.takeDamage(amount)) return
    this.fx.burst(at, FX_COLORS.hitFlash, 10, { speed: 4, size: 0.18, life: 0.5 })
    this.fx.addShake(0.12)
    if (entity === this.boss) this.onBossHurt?.(amount)
  }

  /** Контактный урон по игроку — рывок босса и укусы ночных врагов. */
  touchPlayer(amount: number): void {
    this.hurtPlayer(amount)
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
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i]
      projectile.update(dt, this.world)

      if (!projectile.spent && projectile.fromPlayer) {
        for (const entity of this.targets()) {
          const center = entity.center(this.scratch)
          // Радиус попадания щедрый: в цель размером с дом должно быть легко попасть.
          const reach = projectile.radius + Math.max(entity.radius, entity.height * 0.4)
          const distance = distanceToSegment(
            center,
            projectile.previousPosition,
            projectile.position,
            this.scratchB,
          )
          if (distance < reach) {
            this.damageEntity(entity, projectile.damage, projectile.position.clone())
            projectile.spent = true
            break
          }
        }
      }

      if (projectile.spent) {
        this.fx.burst(projectile.position, FX_COLORS.playerBlob, 8, {
          speed: 3,
          size: 0.13,
          life: 0.5,
        })
        this.scene.remove(projectile.mesh)
        projectile.dispose()
        this.projectiles.splice(i, 1)
      }
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
