import * as THREE from 'three'
import { BOSS } from '../config/tuning'
import type { CollisionSource } from '../player/player'
import { createBossModel } from '../render/models'
import { Entity } from './entity'

export type BossState =
  | 'intro'
  | 'idle'
  | 'chase'
  | 'slam-telegraph'
  | 'slam-rise'
  | 'slam-fall'
  | 'spit-telegraph'
  | 'spit'
  | 'recover'
  | 'dying'
  | 'dead'

/** Высота модели босса в единичном масштабе — до умножения на BOSS.scale. */
const MODEL_HEIGHT = 1.9
const MODEL_RADIUS = 0.7

/**
 * Витрулян — гигантская милая-жуткая зверюшка. Скачет к игроку, бьёт прыжком с ударной
 * волной по земле и плюётся комками.
 *
 * Два правила определяют, честный ли это бой:
 *
 * 1. У каждой атаки есть телеграф — приседание перед прыжком, раскрытая пасть перед
 *    плевком. Без предупреждения босс превращается в лотерею.
 * 2. Ударная волна бьёт только стоящего на земле, поэтому от неё уклоняются прыжком.
 *    Игрок должен один раз это понять и дальше уже играть, а не угадывать.
 *
 * Воксели босс не ломает намеренно: игрок вложился в деревню, и её разрушение
 * ощущалось бы наказанием за то, что он играл.
 */
export class Boss extends Entity {
  state: BossState = 'intro'
  private timer = 1.6
  private hopTimer = 0
  private readonly spawnPoint = new THREE.Vector3()

  /** Ударная волна: центр и радиус разлёта. */
  onSlam: ((origin: THREE.Vector3, radius: number) => void) | null = null
  /** Плевок: откуда и в какую точку. */
  onSpit: ((origin: THREE.Vector3, target: THREE.Vector3) => void) | null = null
  onIntroDone: (() => void) | null = null
  onDefeated: (() => void) | null = null
  onRoar: ((text: string) => void) | null = null

  private readonly mouthBaseScale = new THREE.Vector3(1, 1, 1)
  private readonly scratch = new THREE.Vector3()
  private dyingProgress = 0

  constructor(spawn: THREE.Vector3) {
    super(
      createBossModel(),
      BOSS.maxHealth,
      MODEL_RADIUS * BOSS.scale * 0.55,
      MODEL_HEIGHT * BOSS.scale,
    )
    this.position.copy(spawn)
    this.spawnPoint.copy(spawn)
    this.group.scale.setScalar(BOSS.scale)
    if (this.model.mouth !== null) {
      this.mouthBaseScale.copy(this.model.mouth.scale)
    }
  }

  /** Фаза 1, 2 или 3 — по порогам здоровья. Показывается в полосе здоровья босса. */
  get phase(): number {
    const fraction = this.health / this.maxHealth
    if (fraction > BOSS.phase2At) return 1
    if (fraction > BOSS.phase3At) return 2
    return 3
  }

  get healthFraction(): number {
    return this.health / this.maxHealth
  }

  /** С фазой босс ускоряется и сокращает паузы между атаками. */
  private get aggression(): number {
    return this.phase === 1 ? 1 : this.phase === 2 ? BOSS.enrageSpeedBonus : BOSS.enrageSpeedBonus * 1.25
  }

  takeDamage(amount: number): boolean {
    if (this.state === 'dying' || this.state === 'dead' || this.state === 'intro') return false
    const phaseBefore = this.phase
    const applied = super.takeDamage(amount)
    if (!applied) return false

    if (this.health === 0) {
      this.state = 'dying'
      this.timer = 1.4
      this.velocity.set(0, 0, 0)
    } else if (this.phase !== phaseBefore) {
      // Смена фазы — событие: игрок должен заметить, что стало опаснее.
      this.onRoar?.(
        this.phase === 2
          ? 'Витрулян злится и разгоняется!'
          : 'Витрулян в ярости! Осталось немного',
      )
    }
    return true
  }

  update(dt: number, world: CollisionSource, elapsed: number, playerPosition: THREE.Vector3): void {
    if (this.state === 'dead') return

    this.timer -= dt
    this.hopTimer -= dt

    // На земле трение гасит горизонтальный разгон, в полёте инерция сохраняется.
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

      case 'slam-telegraph':
        // Приседает всё глубже — по этому и читается готовящийся прыжок.
        this.model.squash = 1 - Math.max(0, this.timer) / BOSS.slamTelegraph
        this.faceTowards(playerPosition.x, playerPosition.z, dt, 6)
        if (this.timer <= 0) {
          this.model.squash = 0
          this.state = 'slam-rise'
          this.timer = 1.2
          this.velocity.y = 15
          // Подлетает в сторону игрока, чтобы прыжок был угрозой, а не салютом.
          const toPlayer = this.scratch.subVectors(playerPosition, this.position).setY(0)
          if (toPlayer.lengthSq() > 0.01) {
            toPlayer.normalize().multiplyScalar(Math.min(9, toPlayer.length() * 2.2))
            this.velocity.x = toPlayer.x
            this.velocity.z = toPlayer.z
          }
        }
        break

      case 'slam-rise':
        if (this.velocity.y <= 0) this.state = 'slam-fall'
        break

      case 'slam-fall':
        // Падение ускоряем: тяжёлое приземление читается лучше, чем плавный спуск.
        this.velocity.y -= 26 * dt
        break

      case 'spit-telegraph':
        this.faceTowards(playerPosition.x, playerPosition.z, dt, 7)
        this.openMouth(1 - Math.max(0, this.timer) / BOSS.spitTelegraph)
        if (this.timer <= 0) {
          this.spit(playerPosition)
          this.state = 'recover'
          this.timer = 0.5
        }
        break

      case 'spit':
      case 'recover':
        this.openMouth(0)
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

    const justLanded = this.applyGravity(dt, world)
    this.stepMove(world, dt)

    // Приземление после прыжка — момент удара волной.
    if (justLanded && this.state === 'slam-fall') {
      this.onSlam?.(this.position.clone(), BOSS.slamRadius)
      this.state = 'recover'
      this.timer = 0.7
    }

    this.syncModel(elapsed, dt)
  }

  private chase(dt: number, playerPosition: THREE.Vector3): void {
    this.faceTowards(playerPosition.x, playerPosition.z, dt, 5)
    const dx = playerPosition.x - this.position.x
    const dz = playerPosition.z - this.position.z
    const distance = Math.hypot(dx, dz)
    if (distance < 0.001) return

    const speed = BOSS.chaseSpeed * this.aggression
    // Скачками, а не ровным скольжением: пушистому колобку идёт именно прыгучий ход.
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

    // Вблизи прыжок опаснее, издалека — плевок. Так у игрока есть смысл менять дистанцию.
    const preferSlam = distance < 11
    if (preferSlam) {
      this.state = 'slam-telegraph'
      this.timer = BOSS.slamTelegraph
    } else {
      this.state = 'spit-telegraph'
      this.timer = BOSS.spitTelegraph
    }
  }

  private spit(playerPosition: THREE.Vector3): void {
    // С фазой снарядов больше: та же атака, но плотнее.
    const count = this.phase === 1 ? 1 : this.phase === 2 ? 2 : 3
    const mouthOrigin = this.position
      .clone()
      .setY(this.position.y + this.height * 0.55)

    for (let i = 0; i < count; i++) {
      const target = playerPosition.clone()
      // Разброс, чтобы веер накрывал площадь, а не бил в одну точку.
      const spread = (i - (count - 1) / 2) * 2.4
      target.x += spread
      target.z += spread * 0.4
      this.onSpit?.(mouthOrigin, target)
    }
  }

  private openMouth(amount: number): void {
    const mouth = this.model.mouth
    if (mouth === null) return
    mouth.scale.set(
      this.mouthBaseScale.x * (1 + amount * 0.5),
      this.mouthBaseScale.y * (1 + amount * 2.6),
      this.mouthBaseScale.z,
    )
  }
}
