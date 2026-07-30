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

/** Lines spoken on settling. */
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

/** What a smurf needs to know about the village this frame. */
export interface SmurfContext {
  player: THREE.Vector3
  /** Points of interest: every house doorstep, the pond, the square center. */
  pois: readonly THREE.Vector3[]
  others: readonly Smurf[]
  /** Nearest night threat. */
  threat: THREE.Vector3 | null
  night: boolean
  /** Open/close a door — same path the player uses. */
  setDoor: (x: number, y: number, z: number, open: boolean) => void
}

/**
 * Smurf — a village resident.
 *
 * By day they wander the whole village between points of interest (not just their
 * own doorstep), chat with neighbors and the player. At night or when they see a
 * night creature they run home, enter through the door, and wait until dawn. If
 * the house breaks they leave sadly.
 *
 * They walk in from the horizon: spawn is far away, and while those chunks are
 * unloaded the smurf moves “along the terrain” kinematically — gravity kicks in
 * once the ground is loaded.
 */
export class Smurf extends Entity {
  state: SmurfState = 'arriving'
  /** Own house doorstep. */
  readonly home = new THREE.Vector3()
  /** Lower door cell of the house, if a door exists. */
  door: THREE.Vector3 | null = null
  /** Interior floor cell — where the smurf hides at night. */
  inside: THREE.Vector3 | null = null
  readonly elder: boolean

  private readonly target = new THREE.Vector3()
  private waitTimer = 0
  private chatterCooldown = 4
  private leavingTimer = 0
  private enterTimer = 0
  private doorOpened = false

  /** How long to keep walking toward the current wander goal before picking a new one. */
  private wanderTimeout = 0
  /** Stay time inside the house during a daytime visit. */
  private hideTimer = 0
  /** Consecutive failed door-entry attempts. */
  private enterAttempts = 0
  /** Flee-home timeout: without it a smurf who cannot pathfind would run until dawn. */
  private fleeTimer = 0

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

  /** House broke: the smurf says goodbye and leaves. */
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
    // Outside loaded chunks — kinematic terrain follow: the reader would return air
    // there and the smurf would fall into the void.
    if (!world.isChunkGenerated(this.position.x, this.position.z)) {
      this.position.y = world.groundY(this.position.x, this.position.z)
      this.velocity.y = 0
    } else {
      this.applyGravity(dt, world)
    }

    switch (this.state) {
      case 'arriving':
        this.walkTo(dt, VILLAGE.smurfSpeed * 1.25)
        // Generous threshold: the doorstep may sit half a block into a slope, and a
        // smurf who arrived should not shuffle forever a centimetre from the goal.
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
        this.fleeTimer -= dt
        // No path to the doorstep — squeeze inside instead of running into a wall until dawn.
        if (this.fleeTimer <= 0 && this.inside !== null) {
          this.squeezeInside(ctx)
          break
        }
        if (this.horizontalDistanceTo(this.target) < 2.0) {
          if (this.door !== null && this.inside !== null) {
            // Open the door and go in.
            if (!this.doorOpened) {
              ctx.setDoor(this.door.x, this.door.y, this.door.z, true)
              this.doorOpened = true
            }
            this.state = 'entering'
            this.enterTimer = 4
            this.target.set(this.inside.x + 0.5, this.inside.y, this.inside.z + 0.5)
          } else {
            // Houses without a door: cannot get inside, shiver on the doorstep.
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
          // Daytime visits are short; at night we stay until dawn (the timer does not
          // matter: leaving still requires “not night and not scared”).
          this.hideTimer = 2.4
          this.velocity.x = 0
          this.velocity.z = 0
          if (this.door !== null && this.doorOpened) {
            ctx.setDoor(this.door.x, this.door.y, this.door.z, false)
            this.doorOpened = false
          }
        } else if (this.enterTimer <= 0) {
          // Did not get in — retry from the doorstep; after three fails, squeeze inside.
          this.enterAttempts++
          if (this.enterAttempts < 3) {
            this.startHome(false)
          } else {
            this.squeezeInside(ctx)
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

  /** Head home: with a cry when fleeing, silently when just dropping by. */
  private startHome(cry: boolean): void {
    this.state = 'fleeing'
    this.doorOpened = false
    this.fleeTimer = 10
    this.target.copy(this.home)
    if (cry) {
      this.enterAttempts = 0
      this.onSay?.(pick(NIGHT_CRIES))
    }
  }

  /**
   * Guaranteed entry: the smurf “squeezes” inside. Last resort against standing
   * frozen by a wall all night — a tiny teleport beats a stuck resident.
   */
  private squeezeInside(ctx: SmurfContext): void {
    if (this.inside !== null) {
      this.position.set(this.inside.x + 0.5, this.inside.y, this.inside.z + 0.5)
      this.velocity.set(0, 0, 0)
    }
    if (this.door !== null && this.doorOpened) {
      ctx.setDoor(this.door.x, this.door.y, this.door.z, false)
      this.doorOpened = false
    }
    this.state = 'hiding'
    this.hideTimer = 2.4
    this.enterAttempts = 0
  }

  /**
   * Village-wide walks: the goal is chosen from points of interest (other doorsteps,
   * the pond, the square), not the area around their own house — so the village feels alive.
   */
  private wander(dt: number, world: World, ctx: SmurfContext): void {
    if (this.waitTimer > 0) {
      this.waitTimer -= dt
      this.velocity.x = 0
      this.velocity.z = 0
      return
    }

    // Goal unreachable — pick a new one instead of ramming a wall forever.
    this.wanderTimeout -= dt
    const needNewTarget = this.horizontalDistanceTo(this.target) < 0.7 || this.wanderTimeout <= 0

    if (needNewTarget) {
      this.waitTimer = 1.2 + Math.random() * 2.6
      this.wanderTimeout = 9

      // Sometimes drop by home through the door: the village feels alive,
      // and the player sees that doors work.
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

      // Goals inside a wall or house are invalid: wait and roll again next time.
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
   * @param direct skip stuck detection and sidesteps — for short precise paths
   * through a doorway, where a “veer sideways” manoeuvre only throws them off course.
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

    // Chat with a neighbor: both stop facing each other.
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
