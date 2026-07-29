import * as THREE from 'three'
import { VILLAGE } from '../config/tuning'
import type { World } from '../world/world'
import { createAnimalModel, type AnimalKind } from '../render/models'
import { Entity } from './entity'

const SIZES: Record<AnimalKind, { radius: number; height: number; speed: number }> = {
  bunny: { radius: 0.2, height: 0.55, speed: 2.6 },
  sheep: { radius: 0.3, height: 0.75, speed: 1.8 },
  chick: { radius: 0.15, height: 0.4, speed: 2.0 },
}

/** Что животному нужно знать о мире в этом кадре. */
export interface AnimalContext {
  /** Позиция игрока, если у него в руке морковка, — иначе null. */
  carrotHolder: THREE.Vector3 | null
  /** Ближайший ночной враг — от него животное бежит. */
  threat: THREE.Vector3 | null
}

/**
 * Дневная живность: пасётся у своей точки, бежит от ночных врагов и идёт за морковкой
 * в руках игрока — так животных приводят в деревню.
 */
export class Animal extends Entity {
  /** Точка выпаса. После приведения в деревню переезжает туда. */
  readonly home = new THREE.Vector3()
  delivered = false

  private readonly target = new THREE.Vector3()
  private waitTimer = 0
  private hopTimer = 0

  constructor(
    readonly kind: AnimalKind,
    spawn: THREE.Vector3,
  ) {
    super(createAnimalModel(kind), 4, SIZES[kind].radius, SIZES[kind].height)
    this.position.copy(spawn)
    this.home.copy(spawn)
    this.target.copy(spawn)
  }

  update(dt: number, world: World, elapsed: number, ctx: AnimalContext): void {
    this.applyGravity(dt, world)

    const speed = SIZES[this.kind].speed

    if (ctx.threat !== null && this.horizontalDistance(ctx.threat) < 7) {
      // Бежим прочь от угрозы — прямо от неё, скорость с перепугу выше.
      const away = this.target
        .subVectors(this.position, ctx.threat)
        .setY(0)
      if (away.lengthSq() < 0.01) away.set(1, 0, 0)
      away.normalize()
      this.velocity.x = away.x * speed * 1.6
      this.velocity.z = away.z * speed * 1.6
      this.faceTowards(this.position.x + away.x, this.position.z + away.z, dt)
    } else if (
      ctx.carrotHolder !== null &&
      this.horizontalDistance(ctx.carrotHolder) < VILLAGE.animalFollowRadius &&
      this.horizontalDistance(ctx.carrotHolder) > 1.7
    ) {
      // Морковка! Идём за игроком.
      this.walkTo(ctx.carrotHolder.x, ctx.carrotHolder.z, speed * 1.25, dt)
    } else {
      this.graze(dt, speed)
    }

    // Кролики и цыплята передвигаются прыжками — это почти вся их «милота».
    this.hopTimer -= dt
    const moving = Math.hypot(this.velocity.x, this.velocity.z) > 0.3
    if (moving && this.onGround && this.hopTimer <= 0 && this.kind !== 'sheep') {
      this.hopTimer = 0.4 + Math.random() * 0.3
      this.velocity.y = 3.4
    }

    this.stepMove(world, dt)
    this.syncModel(elapsed, dt)
  }

  private graze(dt: number, speed: number): void {
    if (this.waitTimer > 0) {
      this.waitTimer -= dt
      this.velocity.x = 0
      this.velocity.z = 0
      return
    }
    if (this.horizontalDistance(this.target) < 0.8) {
      this.waitTimer = 1.5 + Math.random() * 3
      const angle = Math.random() * Math.PI * 2
      const distance = 1 + Math.random() * 5
      this.target.set(
        this.home.x + Math.cos(angle) * distance,
        this.home.y,
        this.home.z + Math.sin(angle) * distance,
      )
      return
    }
    this.walkTo(this.target.x, this.target.z, speed * 0.7, dt)
  }

  private walkTo(x: number, z: number, speed: number, dt: number): void {
    const dx = x - this.position.x
    const dz = z - this.position.z
    const length = Math.hypot(dx, dz)
    if (length < 0.001) return
    this.velocity.x = (dx / length) * speed
    this.velocity.z = (dz / length) * speed
    this.faceTowards(x, z, dt)
  }

  private horizontalDistance(point: THREE.Vector3): number {
    return Math.hypot(point.x - this.position.x, point.z - this.position.z)
  }
}
