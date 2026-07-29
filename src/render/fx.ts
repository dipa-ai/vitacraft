import * as THREE from 'three'
import { FX_COLORS } from '../config/palette'

/**
 * Мелкие эффекты: разлетающиеся кубики, сердечки и расходящееся кольцо ударной волны.
 *
 * Всё живёт в пуле переиспользуемых мешей: спавнить и выбрасывать геометрию на каждую
 * искру — верный способ поймать рывки от сборщика мусора прямо во время боя.
 */

const POOL_SIZE = 220

interface Particle {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
  maxLife: number
  spin: number
  gravity: number
  baseScale: number
  active: boolean
}

export class Fx {
  private readonly particles: Particle[] = []
  private readonly rings: { mesh: THREE.Mesh; life: number; maxLife: number; maxRadius: number }[] =
    []
  private readonly group = new THREE.Group()
  private readonly sharedGeometry = new THREE.BoxGeometry(1, 1, 1)
  private readonly ringGeometry = new THREE.RingGeometry(0.86, 1, 32)
  /** Смещение тряски камеры — main.ts прибавляет его к позиции камеры. */
  readonly shake = new THREE.Vector3()
  private shakeStrength = 0

  constructor(scene: THREE.Scene) {
    this.group.name = 'fx'
    scene.add(this.group)

    for (let i = 0; i < POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(
        this.sharedGeometry,
        new THREE.MeshLambertMaterial({ transparent: true }),
      )
      mesh.visible = false
      mesh.frustumCulled = false
      this.group.add(mesh)
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        spin: 0,
        gravity: 14,
        baseScale: 0.1,
        active: false,
      })
    }
  }

  private take(): Particle | null {
    for (const particle of this.particles) {
      if (!particle.active) return particle
    }
    // Пул кончился — лучше пропустить искру, чем расти без предела.
    return null
  }

  /** Облачко кубиков из точки. Универсальный эффект удара, установки и разрушения. */
  burst(
    position: THREE.Vector3,
    color: number,
    count = 10,
    options: { speed?: number; size?: number; life?: number; gravity?: number; spread?: number } = {},
  ): void {
    const speed = options.speed ?? 4
    const size = options.size ?? 0.12
    const life = options.life ?? 0.7
    const gravity = options.gravity ?? 14
    const spread = options.spread ?? 0.35

    for (let i = 0; i < count; i++) {
      const particle = this.take()
      if (particle === null) return

      particle.active = true
      particle.life = life * (0.7 + Math.random() * 0.6)
      particle.maxLife = particle.life
      particle.gravity = gravity
      particle.spin = (Math.random() - 0.5) * 12
      particle.baseScale = size * (0.6 + Math.random() * 0.8)

      // Разлёт полусферой вверх: вниз частицы всё равно сразу утянет гравитация.
      const angle = Math.random() * Math.PI * 2
      const up = 0.4 + Math.random() * 0.8
      particle.velocity.set(
        Math.cos(angle) * spread * speed,
        up * speed,
        Math.sin(angle) * spread * speed,
      )

      const mesh = particle.mesh
      mesh.position.copy(position)
      mesh.position.x += (Math.random() - 0.5) * 0.4
      mesh.position.y += (Math.random() - 0.5) * 0.4
      mesh.position.z += (Math.random() - 0.5) * 0.4
      mesh.scale.setScalar(particle.baseScale)
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3)
      mesh.visible = true
      const material = mesh.material as THREE.MeshLambertMaterial
      material.color.setHex(color)
      material.opacity = 1
    }
  }

  /** Сердечки: главный визуальный отклик на то, что смурфику понравился дом. */
  hearts(position: THREE.Vector3, count = 12): void {
    this.burst(position, FX_COLORS.heart, count, {
      speed: 2.6,
      size: 0.17,
      life: 1.3,
      // Отрицательная гравитация — сердечки всплывают, а не падают.
      gravity: -2.2,
      spread: 0.5,
    })
  }

  /** Кольцо ударной волны по земле — телеграф-последствие прыжка босса. */
  shockwave(position: THREE.Vector3, maxRadius: number, duration: number): void {
    const mesh = new THREE.Mesh(
      this.ringGeometry,
      new THREE.MeshBasicMaterial({
        color: FX_COLORS.shockwave,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    mesh.rotation.x = -Math.PI / 2
    mesh.position.copy(position)
    mesh.position.y += 0.12
    this.group.add(mesh)
    this.rings.push({ mesh, life: duration, maxLife: duration, maxRadius })
  }

  /** Тряска экрана. Значения складываются, но затухают экспоненциально. */
  addShake(strength: number): void {
    this.shakeStrength = Math.min(1.2, this.shakeStrength + strength)
  }

  update(dt: number): void {
    for (const particle of this.particles) {
      if (!particle.active) continue
      particle.life -= dt
      if (particle.life <= 0) {
        particle.active = false
        particle.mesh.visible = false
        continue
      }

      particle.velocity.y -= particle.gravity * dt
      particle.mesh.position.addScaledVector(particle.velocity, dt)
      particle.mesh.rotation.x += particle.spin * dt
      particle.mesh.rotation.y += particle.spin * dt

      // К концу жизни частица тает и уменьшается.
      const t = particle.life / particle.maxLife
      particle.mesh.scale.setScalar(particle.baseScale * (0.35 + t * 0.65))
      ;(particle.mesh.material as THREE.MeshLambertMaterial).opacity = Math.min(1, t * 1.8)
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i]
      ring.life -= dt
      const t = 1 - ring.life / ring.maxLife
      if (ring.life <= 0) {
        this.group.remove(ring.mesh)
        ;(ring.mesh.material as THREE.Material).dispose()
        this.rings.splice(i, 1)
        continue
      }
      ring.mesh.scale.setScalar(Math.max(0.001, t * ring.maxRadius))
      ;(ring.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t)
    }

    if (this.shakeStrength > 0.0005) {
      this.shakeStrength *= Math.pow(0.0016, dt)
      const s = this.shakeStrength * 0.4
      this.shake.set(
        (Math.random() - 0.5) * s,
        (Math.random() - 0.5) * s,
        (Math.random() - 0.5) * s,
      )
    } else {
      this.shakeStrength = 0
      this.shake.set(0, 0, 0)
    }
  }

  dispose(): void {
    this.sharedGeometry.dispose()
    this.ringGeometry.dispose()
    for (const particle of this.particles) {
      ;(particle.mesh.material as THREE.Material).dispose()
    }
    for (const ring of this.rings) {
      ;(ring.mesh.material as THREE.Material).dispose()
    }
  }
}
