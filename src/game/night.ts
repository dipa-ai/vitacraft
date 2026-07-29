import * as THREE from 'three'
import { NIGHT, WORLD } from '../config/tuning'
import { Lurker } from '../entities/lurker'
import type { Smurf } from '../entities/smurf'
import type { Fx } from '../render/fx'
import { nightness } from '../render/scene'
import type { World } from '../world/world'

/** Порог, после которого «уже ночь» и лезут враги. */
const NIGHT_THRESHOLD = 0.55

/**
 * Ночной режим: с темнотой вокруг игрока и деревни появляются тёмные зверюшки.
 * В герметичном доме безопасно — не потому что есть проверка «игрок внутри», а потому
 * что враг физически не проходит сквозь стены и закрытую дверь.
 * На рассвете все растворяются; из убитых выпадают облачка.
 */
export class NightManager {
  readonly lurkers: Lurker[] = []
  isNight = false
  private spawnTimer = 0
  /** Ночь целиком без смерти игрока — для квеста «переживи ночь». */
  private wholeNight = true

  /** Максимум одновременных врагов — зависит от стадии квеста, ставит main. */
  maxEnemies: number = NIGHT.maxEnemiesEarly

  onDusk: (() => void) | null = null
  onDawn: ((survivedWholeNight: boolean) => void) | null = null
  /** Игрока укусили. */
  onBite: ((damage: number) => void) | null = null
  /** Из убитой зверюшки выпали облачка. */
  onCloudDrop: ((count: number, at: THREE.Vector3) => void) | null = null

  constructor(
    private readonly world: World,
    private readonly scene: THREE.Scene,
    private readonly fx: Fx,
  ) {}

  /** Позиции живых врагов — для испуга смурфиков и бегства животных. */
  get threatPositions(): THREE.Vector3[] {
    return this.lurkers.filter((lurker) => !lurker.dead && !lurker.dissolving).map((l) => l.position)
  }

  /** Игрок умер ночью — эта ночь квест не закрывает. */
  markPlayerDied(): void {
    this.wholeNight = false
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
      // Рассвет: все растворяются без дропа.
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

      // Убит игроком — облачка и салют. Растворение на рассвете дропа не даёт.
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

  /** Цель — ближайший из игрока и гуляющих смурфиков (спрятавшихся не видно). */
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

      // На подходе может не быть чанков — догружаем без перецентровки мира.
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

  /** При смерти игрока враги отступают — честнее, чем толпа у точки возрождения. */
  scatter(): void {
    for (const lurker of this.lurkers) lurker.startDissolve()
  }
}
