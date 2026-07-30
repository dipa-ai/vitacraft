import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { CollisionSource } from '../player/player'

/** Projectile gravity: much weaker than the player's, keeping the arc readable. */
const PROJECTILE_GRAVITY = 14

/**
 * A flying blob. One class serves both the player's throwable (F key) and boss
 * projectiles — they differ only in color, damage and owner.
 */
export class Projectile {
  readonly position = new THREE.Vector3()
  /**
   * Last frame's position. Collisions are checked along the inter-frame segment:
   * at 22 blocks per second a projectile moves nearly a third of a block per frame,
   * and endpoint-only checks would fly straight through the target.
   */
  readonly previousPosition = new THREE.Vector3()
  readonly velocity = new THREE.Vector3()
  readonly mesh: THREE.Mesh
  /** The projectile is spent and should be removed from the scene. */
  spent = false

  private life: number

  constructor(
    origin: THREE.Vector3,
    velocity: THREE.Vector3,
    readonly damage: number,
    color: number,
    /** Player projectiles hit the boss; boss projectiles hit the player. */
    readonly fromPlayer: boolean,
    readonly radius = 0.4,
    lifetime = 5,
  ) {
    this.position.copy(origin)
    this.previousPosition.copy(origin)
    this.velocity.copy(velocity)
    this.life = lifetime

    this.mesh = new THREE.Mesh(
      new RoundedBoxGeometry(radius * 2, radius * 2, radius * 2, 2, radius * 0.5),
      // emissiveIntensity above 1 on purpose: only then the projectile crosses the
      // bloom threshold and actually glows instead of just looking brighter. The
      // value is matched to the threshold in scene.ts — the blob should glow,
      // nothing else should.
      new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 3.2 }),
    )
    this.mesh.position.copy(origin)
  }

  /** @returns true if the projectile hit a block. */
  update(dt: number, world: CollisionSource): boolean {
    this.life -= dt
    if (this.life <= 0) {
      this.spent = true
      return false
    }

    this.previousPosition.copy(this.position)
    this.velocity.y -= PROJECTILE_GRAVITY * dt
    this.position.addScaledVector(this.velocity, dt)
    this.mesh.position.copy(this.position)
    this.mesh.rotation.x += dt * 6
    this.mesh.rotation.y += dt * 4

    if (world.isSolidAt(this.position.x, this.position.y, this.position.z)) {
      this.spent = true
      return true
    }
    return false
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}
