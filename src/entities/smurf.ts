import * as THREE from 'three'
import { VILLAGE } from '../config/tuning'
import type { CollisionSource } from '../player/player'
import { createSmurfModel } from '../render/models'
import { Entity } from './entity'

export type SmurfState = 'arriving' | 'settled' | 'leaving'

/** Реплики при заселении. */
const GREETINGS = [
  'Ух ты, у меня теперь есть дом!',
  'Тут тепло и не дует. Спасибо!',
  'Я тут поживу, если ты не против',
  'Какая уютная комнатка!',
  'Кроватка мягкая, проверил',
]

/** Реплики, когда игрок подходит близко. */
const CHATTER = [
  'Привет-привет!',
  'Тебе идёт эта кирка',
  'Слышал, за холмами кто-то большой шумит…',
  'Построй ещё домик, у меня есть друзья',
  'Люблю нашу деревню',
]

const FAREWELLS = [
  'Мой дом сломался… я пойду',
  'Ой! Стена пропала. Пока…',
  'Тут теперь дует, я не могу так спать',
]

function pick(list: readonly string[]): string {
  return list[Math.floor(Math.random() * list.length)]
}

/**
 * Смурфик — житель деревни. Приходит к новому дому, потом бродит рядом с ним,
 * а если дом сломали, грустит и уходит.
 *
 * Дом герметичен по определению (flood-fill не пустил бы иначе), поэтому внутрь смурфик
 * не заходит: он живёт «при доме» и гуляет по деревне. Дверь ломала бы проверку
 * замкнутости, так что дверей в этой игре нет — и это осознанное следствие правил.
 */
export class Smurf extends Entity {
  state: SmurfState = 'arriving'
  /** Дом, к которому привязан этот смурфик. */
  readonly home = new THREE.Vector3()

  private readonly target = new THREE.Vector3()
  private waitTimer = 0
  private chatterCooldown = 4
  private leavingTimer = 0

  /** Заполняется деревней: показать реплику игроку. */
  onSay: ((text: string) => void) | null = null
  /** Смурфик ушёл окончательно и его можно убрать со сцены. */
  onGone: (() => void) | null = null
  onSettled: (() => void) | null = null

  constructor(spawn: THREE.Vector3, home: THREE.Vector3) {
    super(createSmurfModel(), 6, 0.22, 1.2)
    this.position.copy(spawn)
    this.home.copy(home)
    this.target.copy(home)
  }

  /** Дом сломался: смурфик прощается и уходит. */
  evict(): void {
    if (this.state === 'leaving') return
    this.state = 'leaving'
    this.leavingTimer = 12
    this.onSay?.(pick(FAREWELLS))
    // Уходит прочь от деревни — направление берём от дома к себе.
    const away = this.position.clone().sub(this.home).setY(0)
    if (away.lengthSq() < 0.01) away.set(1, 0, 0)
    away.normalize().multiplyScalar(40)
    this.target.copy(this.position).add(away)
  }

  update(dt: number, world: CollisionSource, elapsed: number, playerPosition: THREE.Vector3): void {
    this.applyGravity(dt, world)

    switch (this.state) {
      case 'arriving':
        this.walkTo(dt, VILLAGE.smurfSpeed * 1.25)
        if (this.horizontalDistanceTo(this.target) < 1.6) {
          this.state = 'settled'
          this.velocity.x = 0
          this.velocity.z = 0
          this.onSay?.(pick(GREETINGS))
          this.onSettled?.()
        }
        break

      case 'settled':
        this.wander(dt)
        this.maybeChatter(dt, playerPosition)
        break

      case 'leaving':
        this.walkTo(dt, VILLAGE.smurfSpeed)
        this.leavingTimer -= dt
        if (this.leavingTimer <= 0) this.onGone?.()
        break
    }

    this.stepMove(world, dt)
    this.syncModel(elapsed, dt)
  }

  private wander(dt: number): void {
    if (this.waitTimer > 0) {
      this.waitTimer -= dt
      // Стоим и покачиваемся — постоянная беготня выглядит нервно.
      this.velocity.x = 0
      this.velocity.z = 0
      return
    }

    if (this.horizontalDistanceTo(this.target) < 0.7) {
      this.waitTimer = 1.2 + Math.random() * 2.6
      const angle = Math.random() * Math.PI * 2
      const distance = 1.5 + Math.random() * VILLAGE.wanderRadius
      this.target.set(
        this.home.x + Math.cos(angle) * distance,
        this.home.y,
        this.home.z + Math.sin(angle) * distance,
      )
      return
    }

    this.walkTo(dt, VILLAGE.smurfSpeed)
  }

  private walkTo(dt: number, speed: number): void {
    const dx = this.target.x - this.position.x
    const dz = this.target.z - this.position.z
    const length = Math.hypot(dx, dz)
    if (length < 0.001) {
      this.velocity.x = 0
      this.velocity.z = 0
      return
    }
    this.velocity.x = (dx / length) * speed
    this.velocity.z = (dz / length) * speed
    this.faceTowards(this.target.x, this.target.z, dt)
  }

  private maybeChatter(dt: number, playerPosition: THREE.Vector3): void {
    this.chatterCooldown -= dt
    if (this.chatterCooldown > 0) return
    if (this.horizontalDistanceTo(playerPosition) > 3.5) return
    // Пауза большая: болтовня каждые пару секунд быстро надоедает.
    this.chatterCooldown = 14 + Math.random() * 12
    this.onSay?.(pick(CHATTER))
  }

  private horizontalDistanceTo(point: THREE.Vector3): number {
    return Math.hypot(point.x - this.position.x, point.z - this.position.z)
  }
}
