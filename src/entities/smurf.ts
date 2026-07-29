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

  // Обход препятствий без поиска пути: застряли — на пару секунд уходим вбок.
  private readonly lastPosition = new THREE.Vector3(NaN, 0, NaN)
  private stuckCheckTimer = 1
  private detourTimer = 0
  private detourSign = 1

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

    // Детектор застревания: если за секунду ходьбы почти не сдвинулись — прямая
    // упёрлась в стену или угол, и надо на пару секунд свернуть вбок. Это дешёвая
    // замена поиску пути, которой хватает для домиков и берегов.
    this.detourTimer = Math.max(0, this.detourTimer - dt)
    this.stuckCheckTimer -= dt
    if (this.stuckCheckTimer <= 0) {
      const walking =
        (this.state === 'arriving' || this.state === 'fleeing' || this.state === 'leaving' ||
          this.state === 'idle') &&
        this.waitTimer <= 0
      const moved = Number.isNaN(this.lastPosition.x)
        ? Infinity
        : Math.hypot(
            this.position.x - this.lastPosition.x,
            this.position.z - this.lastPosition.z,
          )
      if (walking && moved < 0.35 && this.horizontalDistanceTo(this.target) > 2) {
        this.detourTimer = 1.6
        this.detourSign = Math.random() < 0.5 ? 1 : -1
      }
      this.lastPosition.copy(this.position)
      this.stuckCheckTimer = 1
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
          this.startFleeing(ctx)
          break
        }
        this.wander(dt, ctx)
        this.maybeChatter(dt, ctx)
        break

      case 'fleeing':
        this.walkTo(dt, VILLAGE.smurfSpeed * 1.8)
        if (this.horizontalDistanceTo(this.target) < 1.3) {
          if (this.door !== null && this.inside !== null) {
            // Открываем дверь и заходим.
            if (!this.doorOpened) {
              ctx.setDoor(this.door.x, this.door.y, this.door.z, true)
              this.doorOpened = true
            }
            this.state = 'entering'
            this.enterTimer = 1.6
            this.target.set(this.inside.x + 0.5, this.inside.y, this.inside.z + 0.5)
          } else {
            // Дома без двери: внутрь не попасть, дрожим на крылечке.
            this.state = 'hiding'
          }
        }
        break

      case 'entering':
        this.walkTo(dt, VILLAGE.smurfSpeed * 1.4)
        this.enterTimer -= dt
        if (this.horizontalDistanceTo(this.target) < 0.7 || this.enterTimer <= 0) {
          this.state = 'hiding'
          this.velocity.x = 0
          this.velocity.z = 0
          if (this.door !== null && this.doorOpened) {
            ctx.setDoor(this.door.x, this.door.y, this.door.z, false)
            this.doorOpened = false
          }
        }
        break

      case 'hiding':
        this.velocity.x = 0
        this.velocity.z = 0
        if (!ctx.night && ctx.threat === null) {
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
        this.walkTo(dt, VILLAGE.smurfSpeed)
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

  private startFleeing(ctx: SmurfContext): void {
    this.state = 'fleeing'
    this.doorOpened = false
    this.target.copy(this.home)
    this.onSay?.(pick(NIGHT_CRIES))
    void ctx
  }

  /**
   * Прогулки по всей деревне: цель выбирается из точек интереса (чужие крылечки, пруд,
   * площадь), а не из окрестностей своего дома, — деревня выглядит живой.
   */
  private wander(dt: number, ctx: SmurfContext): void {
    if (this.waitTimer > 0) {
      this.waitTimer -= dt
      this.velocity.x = 0
      this.velocity.z = 0
      return
    }

    if (this.horizontalDistanceTo(this.target) < 0.7) {
      this.waitTimer = 1.2 + Math.random() * 2.6
      const pois = ctx.pois.length > 0 ? ctx.pois : [this.home]
      const poi = pois[Math.floor(Math.random() * pois.length)]
      const angle = Math.random() * Math.PI * 2
      const distance = 1 + Math.random() * (VILLAGE.wanderRadius * 0.6)
      this.target.set(
        poi.x + Math.cos(angle) * distance,
        poi.y,
        poi.z + Math.sin(angle) * distance,
      )
      return
    }

    this.walkTo(dt, VILLAGE.smurfSpeed)
  }

  private walkTo(dt: number, speed: number): void {
    let dx = this.target.x - this.position.x
    let dz = this.target.z - this.position.z
    const length = Math.hypot(dx, dz)
    if (length < 0.001) {
      this.velocity.x = 0
      this.velocity.z = 0
      return
    }

    // В обходном манёвре направление повёрнуто на ~75° — так огибаются стены и берега.
    if (this.detourTimer > 0) {
      const angle = this.detourSign * 1.3
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const rx = dx * cos - dz * sin
      const rz = dx * sin + dz * cos
      dx = rx
      dz = rz
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
