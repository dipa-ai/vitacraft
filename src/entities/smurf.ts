import * as THREE from 'three'
import { VILLAGE } from '../config/tuning'
import type { World } from '../world/world'
import { createSmurfModel } from '../render/models'
import { Entity } from './entity'

export type SmurfState =
  | 'arriving'
  | 'idle'
  | 'fleeing'
  | 'entering'
  | 'hiding'
  | 'exiting'
  | 'leaving'

/** Реплики при заселении. */
const GREETINGS = [
  'Ух ты, у меня теперь есть дом!',
  'Тут тепло и не дует. Спасибо!',
  'Я тут поживу, если ты не против',
  'Какая уютная комнатка!',
  'Кроватка мягкая, проверил',
]

const CHATTER = [
  'Привет-привет!',
  'Тебе идёт эта кирка',
  'Слышал, за холмами кто-то большой шумит…',
  'Построй ещё домик, у меня есть друзья',
  'Люблю нашу деревню',
  'Видел зверюшек на лугу? Приведи их морковкой!',
]

const NIGHT_CRIES = ['Ой-ой, темнеет!', 'Скорее домой!', 'Они идут!']

const FAREWELLS = [
  'Мой дом сломался… я пойду',
  'Ой! Стена пропала. Пока…',
  'Тут теперь дует, я не могу так спать',
]

function pick(list: readonly string[]): string {
  return list[Math.floor(Math.random() * list.length)]
}

/** Что смурфику нужно знать о деревне в этом кадре. */
export interface SmurfContext {
  player: THREE.Vector3
  /** Точки интереса: крылечки всех домов, пруд, центр площади. */
  pois: readonly THREE.Vector3[]
  others: readonly Smurf[]
  /** Ближайшая ночная угроза. */
  threat: THREE.Vector3 | null
  night: boolean
  /** Открыть/закрыть дверь — тем же путём, что делает игрок. */
  setDoor: (x: number, y: number, z: number, open: boolean) => void
}

/**
 * Смурфик — житель деревни.
 *
 * Днём гуляет по всей деревне между точками интереса (а не топчется у своего дома),
 * болтает с соседями и игроком. Ночью или при виде ночной зверюшки бежит домой, заходит
 * через дверь внутрь и пересиживает до рассвета. Если дом сломали — грустит и уходит.
 *
 * Приходит пешком от горизонта: точка спавна далеко, и пока чанки там не прогружены,
 * смурфик идёт «по рельефу» кинематически — гравитация включается на прогруженной земле.
 */
export class Smurf extends Entity {
  state: SmurfState = 'arriving'
  /** Крылечко своего дома. */
  readonly home = new THREE.Vector3()
  /** Нижняя клетка двери дома, если дверь есть. */
  door: THREE.Vector3 | null = null
  /** Клетка внутри комнаты — туда смурфик прячется на ночь. */
  inside: THREE.Vector3 | null = null
  readonly elder: boolean

  private readonly target = new THREE.Vector3()
  private waitTimer = 0
  private chatterCooldown = 4
  private leavingTimer = 0
  private enterTimer = 0
  private doorOpened = false

  /** Сколько ещё идти к текущей цели прогулки, прежде чем плюнуть и выбрать новую. */
  private wanderTimeout = 0
  /** Задержка внутри дома при дневном визите. */
  private hideTimer = 0
  /** Неудачные попытки зайти в дверь подряд. */
  private enterAttempts = 0

  onSay: ((text: string) => void) | null = null
  onGone: (() => void) | null = null
  onSettled: (() => void) | null = null

  constructor(spawn: THREE.Vector3, home: THREE.Vector3, elder = false) {
    super(createSmurfModel(elder), 6, 0.22, 1.2)
    this.elder = elder
    this.position.copy(spawn)
    this.home.copy(home)
    this.target.copy(home)
  }

  /** Дом сломался: смурфик прощается и уходит. */
  evict(): void {
    if (this.state === 'leaving') return
    this.state = 'leaving'
    this.leavingTimer = 12
    this.group.visible = true
    this.onSay?.(pick(FAREWELLS))
    const away = this.position.clone().sub(this.home).setY(0)
    if (away.lengthSq() < 0.01) away.set(1, 0, 0)
    away.normalize().multiplyScalar(40)
    this.target.copy(this.position).add(away)
  }

  update(dt: number, world: World, elapsed: number, ctx: SmurfContext): void {
    // Вне прогруженных чанков — кинематика по рельефу: reader там вернул бы воздух,
    // и смурфик провалился бы в бездну.
    if (!world.isChunkGenerated(this.position.x, this.position.z)) {
      this.position.y = world.groundY(this.position.x, this.position.z)
      this.velocity.y = 0
    } else {
      this.applyGravity(dt, world)
    }


    switch (this.state) {
      case 'arriving':
        this.walkTo(dt, VILLAGE.smurfSpeed * 1.25)
        // Порог с запасом: крылечко может оказаться на полблока в склоне, и смурфик,
        // дошедший вплотную, не должен вечно топтаться в сантиметре от цели.
        if (this.horizontalDistanceTo(this.target) < 2.2) {
          this.state = 'idle'
          this.velocity.x = 0
          this.velocity.z = 0
          this.onSay?.(pick(GREETINGS))
          this.onSettled?.()
        }
        break

      case 'idle':
        if (this.shouldHide(ctx)) {
          this.startHome(true)
          break
        }
        this.wander(dt, world, ctx)
        this.maybeChatter(dt, ctx)
        break

      case 'fleeing':
        this.walkTo(dt, VILLAGE.smurfSpeed * 1.8)
        if (this.horizontalDistanceTo(this.target) < 2.0) {
          if (this.door !== null && this.inside !== null) {
            // Открываем дверь и заходим.
            if (!this.doorOpened) {
              ctx.setDoor(this.door.x, this.door.y, this.door.z, true)
              this.doorOpened = true
            }
            this.state = 'entering'
            this.enterTimer = 4
            this.target.set(this.inside.x + 0.5, this.inside.y, this.inside.z + 0.5)
          } else {
            // Дома без двери: внутрь не попасть, дрожим на крылечке.
            this.state = 'hiding'
          }
        }
        break

      case 'entering': {
        this.walkTo(dt, VILLAGE.smurfSpeed * 1.4, true)
        this.enterTimer -= dt
        const arrived = this.horizontalDistanceTo(this.target) < 0.8

        if (arrived) {
          this.state = 'hiding'
          this.enterAttempts = 0
          // Дневной визит короткий; ночью сидим до рассвета (таймер не мешает:
          // выход всё равно требует «не ночь и не страшно»).
          this.hideTimer = 2.4
          this.velocity.x = 0
          this.velocity.z = 0
          if (this.door !== null && this.doorOpened) {
            ctx.setDoor(this.door.x, this.door.y, this.door.z, false)
            this.doorOpened = false
          }
        } else if (this.enterTimer <= 0) {
          // Не зашли — пробуем заново с крылечка. Раньше здесь было «спрятаться»,
          // и смурфик замирал столбиком снаружи у стены — это и видел игрок.
          this.enterAttempts++
          if (this.enterAttempts < 4) {
            this.startHome(false)
          } else {
            // Совсем не выходит (дверь замурована?) — хотя бы не бросаем дверь открытой.
            if (this.door !== null && this.doorOpened) {
              ctx.setDoor(this.door.x, this.door.y, this.door.z, false)
              this.doorOpened = false
            }
            this.state = 'hiding'
            this.hideTimer = 4
          }
        }
        break
      }

      case 'hiding':
        this.velocity.x = 0
        this.velocity.z = 0
        this.hideTimer -= dt
        if (this.hideTimer <= 0 && !ctx.night && ctx.threat === null) {
          if (this.door !== null && this.inside !== null) {
            ctx.setDoor(this.door.x, this.door.y, this.door.z, true)
            this.doorOpened = true
            this.state = 'exiting'
            this.target.copy(this.home)
          } else {
            this.state = 'idle'
          }
        }
        break

      case 'exiting':
        this.walkTo(dt, VILLAGE.smurfSpeed, true)
        if (this.horizontalDistanceTo(this.target) < 1.0) {
          if (this.door !== null && this.doorOpened) {
            ctx.setDoor(this.door.x, this.door.y, this.door.z, false)
            this.doorOpened = false
          }
          this.state = 'idle'
        }
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

  private shouldHide(ctx: SmurfContext): boolean {
    if (ctx.night) return true
    if (ctx.threat === null) return false
    return this.horizontalDistanceTo(ctx.threat) < 12
  }

  /** Идти домой: с криком — спасаясь, молча — просто заглянуть в гости к себе. */
  private startHome(cry: boolean): void {
    this.state = 'fleeing'
    this.doorOpened = false
    this.target.copy(this.home)
    if (cry) {
      this.enterAttempts = 0
      this.onSay?.(pick(NIGHT_CRIES))
    }
  }

  /**
   * Прогулки по всей деревне: цель выбирается из точек интереса (чужие крылечки, пруд,
   * площадь), а не из окрестностей своего дома, — деревня выглядит живой.
   */
  private wander(dt: number, world: World, ctx: SmurfContext): void {
    if (this.waitTimer > 0) {
      this.waitTimer -= dt
      this.velocity.x = 0
      this.velocity.z = 0
      return
    }

    // Цель не даётся — выбираем новую, а не тараним стену до конца времён.
    this.wanderTimeout -= dt
    const needNewTarget = this.horizontalDistanceTo(this.target) < 0.7 || this.wanderTimeout <= 0

    if (needNewTarget) {
      this.waitTimer = 1.2 + Math.random() * 2.6
      this.wanderTimeout = 9

      // Иногда — заглянуть домой через дверь: деревня выглядит живой,
      // а игрок видит, что двери работают.
      if (this.door !== null && this.inside !== null && Math.random() < 0.14) {
        this.startHome(false)
        return
      }

      const pois = ctx.pois.length > 0 ? ctx.pois : [this.home]
      const poi = pois[Math.floor(Math.random() * pois.length)]
      const angle = Math.random() * Math.PI * 2
      const distance = 1 + Math.random() * (VILLAGE.wanderRadius * 0.6)
      const tx = poi.x + Math.cos(angle) * distance
      const tz = poi.z + Math.sin(angle) * distance

      // Цель внутри стены или дома не годится: ждём и в следующий раз бросаем кубик заново.
      const ty = world.groundY(tx, tz)
      if (world.isSolidAt(tx, ty, tz) || world.isSolidAt(tx, ty + 1, tz)) {
        this.wanderTimeout = 0
        return
      }

      this.target.set(tx, poi.y, tz)
      return
    }

    this.walkTo(dt, VILLAGE.smurfSpeed)
  }

  /**
   * @param direct без детектора застревания и обходов — для коротких точных путей
   * через дверной проём, где манёвр «свернуть вбок» только уводит с курса.
   */
  private walkTo(dt: number, speed: number, direct = false): void {
    let dx = this.target.x - this.position.x
    let dz = this.target.z - this.position.z
    const length = Math.hypot(dx, dz)
    if (length < 0.001) {
      this.velocity.x = 0
      this.velocity.z = 0
      return
    }

    if (!direct) {
      this.updateNav(dt, length)
      ;[dx, dz] = this.steer(dx, dz)
    }

    this.velocity.x = (dx / length) * speed
    this.velocity.z = (dz / length) * speed
    this.faceTowards(this.position.x + dx, this.position.z + dz, dt)
  }

  private maybeChatter(dt: number, ctx: SmurfContext): void {
    this.chatterCooldown -= dt
    if (this.chatterCooldown > 0) return

    // Поболтать с соседом: оба останавливаются друг напротив друга.
    for (const other of ctx.others) {
      if (other === this || other.state !== 'idle') continue
      if (this.horizontalDistanceTo(other.position) < 2.4) {
        this.chatterCooldown = 16 + Math.random() * 10
        this.waitTimer = Math.max(this.waitTimer, 2.5)
        other.waitTimer = Math.max(other.waitTimer, 2.5)
        this.faceTowards(other.position.x, other.position.z, 1, 99)
        other.faceTowards(this.position.x, this.position.z, 1, 99)
        return
      }
    }

    if (this.horizontalDistanceTo(ctx.player) > 3.5) return
    this.chatterCooldown = 14 + Math.random() * 12
    this.onSay?.(pick(CHATTER))
  }

  private horizontalDistanceTo(point: THREE.Vector3): number {
    return Math.hypot(point.x - this.position.x, point.z - this.position.z)
  }
}
