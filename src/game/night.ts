import * as THREE from 'three'
import { NIGHT, WORLD } from '../config/tuning'
import { Lurker } from '../entities/lurker'
import type { Smurf } from '../entities/smurf'
import type { Fx } from '../render/fx'
import { nightness } from '../render/scene'
import type { World } from '../world/world'

/** Threshold past which it is "night proper" and enemies come out. */
const NIGHT_THRESHOLD = 0.55

/**
 * Night mode: with darkness, dark critters appear around the player and the village.
 * A sealed house is safe — not because of an "is the player inside" check, but
 * because enemies physically cannot pass walls and closed doors.
 * At dawn they all dissolve; killed ones drop clouds.
 */
export class NightManager {
  readonly lurkers: Lurker[] = []
  isNight = false
  private spawnTimer = 0
  /** A whole night without the player dying — for the "survive the night" quest. */
  private wholeNight = true

  /** Max concurrent enemies — depends on quest stage; set by main. */
  maxEnemies: number = NIGHT.maxEnemiesEarly

  onDusk: (() => void) | null = null
  onDawn: ((survivedWholeNight: boolean) => void) | null = null
  /** The player got bitten. */
  onBite: ((damage: number) => void) | null = null
  /** Clouds dropped from a killed critter. */
  onCloudDrop: ((count: number, at: THREE.Vector3) => void) | null = null

  constructor(
    private readonly world: World,
    private readonly scene: THREE.Scene,
    private readonly fx: Fx,
  ) {}

  /** Positions of live enemies — for scaring smurfs and routing animals. */
  get threatPositions(): THREE.Vector3[] {
    return this.lurkers.filter((lurker) => !lurker.dead && !lurker.dissolving).map((l) => l.position)
  }

  /** The player died tonight — this night does not complete the quest. */
  markPlayerDied(): void {
    this.wholeNight = false
  }

  /**
   * Aligns the manager with a restored time of day. Loading in the middle of a night
   * must not count the remaining seconds as surviving a whole night.
   */
  restoreAtTime(dayFraction: number): void {
    this.isNight = nightness(dayFraction) > NIGHT_THRESHOLD
    this.wholeNight = !this.isNight
    this.spawnTimer = this.isNight ? 2 : 0
  }

  update(
    dt: number,
    elapsed: number,
    dayFraction: number,
    playerPosition: THREE.Vector3,
    smurfs: readonly Smurf[],
  ): void {
    const darkness = nightness(dayFraction)
    const nightNow = darkness > NIGHT_THRESHOLD

    if (nightNow && !this.isNight) {
      this.isNight = true
      this.wholeNight = true
      this.spawnTimer = 2
      this.onDusk?.()
    } else if (!nightNow && this.isNight) {
      this.isNight = false
      // Dawn: everyone dissolves with no drops.
      for (const lurker of this.lurkers) lurker.startDissolve()
      this.onDawn?.(this.wholeNight)
    }

    if (this.isNight) {
      this.spawnTimer -= dt
      const alive = this.lurkers.filter((l) => !l.dead && !l.dissolving).length
      if (this.spawnTimer <= 0 && alive < this.maxEnemies) {
        this.spawnTimer = NIGHT.spawnInterval
        this.trySpawn(playerPosition)
      }
    }

    for (let i = this.lurkers.length - 1; i >= 0; i--) {
      const lurker = this.lurkers[i]

      // Killed by the player — clouds and confetti. Dawn dissolution drops nothing.
      if (lurker.dead && !lurker.dissolving) {
        const drop =
          NIGHT.cloudDropMin +
          Math.floor(Math.random() * (NIGHT.cloudDropMax - NIGHT.cloudDropMin + 1))
        this.onCloudDrop?.(drop, lurker.position.clone())
        this.fx.burst(lurker.center(new THREE.Vector3()), 0xf4fbff, 14, {
          speed: 4,
          size: 0.16,
          life: 0.8,
        })
        this.remove(i)
        continue
      }

      if (lurker.dissolving && lurker.dissolved) {
        this.remove(i)
        continue
      }

      const { target, isPlayer } = this.pickTarget(lurker, playerPosition, smurfs)
      const bit = lurker.update(dt, this.world, elapsed, target, isPlayer)
      if (bit) this.onBite?.(NIGHT.lurkerDamage)
    }
  }

  /** Target: the nearest of the player and strolling smurfs (hidden ones unseen). */
  private pickTarget(
    lurker: Lurker,
    playerPosition: THREE.Vector3,
    smurfs: readonly Smurf[],
  ): { target: THREE.Vector3; isPlayer: boolean } {
    let target = playerPosition
    let isPlayer = true
    let best = lurker.position.distanceTo(playerPosition)
    for (const smurf of smurfs) {
      if (smurf.state === 'hiding' || smurf.state === 'entering') continue
      const distance = lurker.position.distanceTo(smurf.position)
      if (distance < best) {
        best = distance
        target = smurf.position
        isPlayer = false
      }
    }
    return { target, isPlayer }
  }

  private trySpawn(playerPosition: THREE.Vector3): void {
    for (let attempt = 0; attempt < 5; attempt++) {
      const angle = Math.random() * Math.PI * 2
      const distance = NIGHT.spawnMin + Math.random() * (NIGHT.spawnMax - NIGHT.spawnMin)
      const x = playerPosition.x + Math.cos(angle) * distance
      const z = playerPosition.z + Math.sin(angle) * distance
      const y = this.world.groundY(x, z)
      if (y <= WORLD.seaLevel + 1) continue

      // Chunks may be missing on approach — generate them without recentering the world.
      this.world.ensureChunkAt(x, z)

      const lurker = new Lurker(new THREE.Vector3(x, y, z))
      this.scene.add(lurker.group)
      this.lurkers.push(lurker)
      return
    }
  }

  private remove(index: number): void {
    const lurker = this.lurkers[index]
    this.scene.remove(lurker.group)
    lurker.dispose()
    this.lurkers.splice(index, 1)
  }

  /** Enemies back off when the player dies — fairer than a mob at the respawn point. */
  scatter(): void {
    for (const lurker of this.lurkers) lurker.startDissolve()
  }
}
