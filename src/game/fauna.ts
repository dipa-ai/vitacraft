import * as THREE from 'three'
import { VILLAGE, WORLD } from '../config/tuning'
import { Animal } from '../entities/animal'
import type { AnimalKind } from '../render/models'
import type { World } from '../world/world'

const KINDS: readonly AnimalKind[] = ['bunny', 'sheep', 'chick', 'bunny', 'chick']
const WILD_CAP = 8
const SPAWN_INTERVAL = 4

/**
 * Дикая живность: спавнится на лугах вокруг игрока, пасётся, идёт за морковкой.
 * Животное, дошедшее до деревни, считается приведённым и переселяется насовсем.
 */
export class Fauna {
  readonly animals: Animal[] = []
  private spawnTimer = 2

  onDelivered: (() => void) | null = null

  constructor(
    private readonly world: World,
    private readonly scene: THREE.Scene,
  ) {}

  update(
    dt: number,
    elapsed: number,
    playerPosition: THREE.Vector3,
    holdingCarrot: boolean,
    villageCenter: THREE.Vector3 | null,
    threats: readonly THREE.Vector3[],
  ): void {
    this.spawnTimer -= dt
    if (this.spawnTimer <= 0) {
      this.spawnTimer = SPAWN_INTERVAL
      this.trySpawn(playerPosition)
    }

    const carrotHolder = holdingCarrot ? playerPosition : null

    for (let i = this.animals.length - 1; i >= 0; i--) {
      const animal = this.animals[i]

      animal.update(dt, this.world, elapsed, {
        carrotHolder,
        threat: this.nearestThreat(animal.position, threats),
      })

      // Дошёл до деревни за морковкой — переселяется.
      if (!animal.delivered && villageCenter !== null) {
        const distance = Math.hypot(
          animal.position.x - villageCenter.x,
          animal.position.z - villageCenter.z,
        )
        if (distance < VILLAGE.deliverRadius) {
          animal.delivered = true
          const angle = Math.random() * Math.PI * 2
          animal.home.set(
            villageCenter.x + Math.cos(angle) * 5,
            villageCenter.y,
            villageCenter.z + Math.sin(angle) * 5,
          )
          this.onDelivered?.()
        }
      }

      // Дикие звери далеко за спиной игрока не нужны.
      if (!animal.delivered && animal.position.distanceTo(playerPosition) > 90) {
        this.remove(i)
      }
    }
  }

  private nearestThreat(
    point: THREE.Vector3,
    threats: readonly THREE.Vector3[],
  ): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null
    let bestDistance = Infinity
    for (const threat of threats) {
      const distance = threat.distanceTo(point)
      if (distance < bestDistance) {
        bestDistance = distance
        best = threat
      }
    }
    return best
  }

  private trySpawn(playerPosition: THREE.Vector3): void {
    const wild = this.animals.filter((animal) => !animal.delivered).length
    if (wild >= WILD_CAP) return

    // Несколько попыток: точка должна быть на суше и на прогруженной земле.
    for (let attempt = 0; attempt < 4; attempt++) {
      const angle = Math.random() * Math.PI * 2
      const distance = 16 + Math.random() * 10
      const x = playerPosition.x + Math.cos(angle) * distance
      const z = playerPosition.z + Math.sin(angle) * distance
      const y = this.world.groundY(x, z)
      if (y <= WORLD.seaLevel + 1) continue
      if (!this.world.isChunkGenerated(x, z)) continue

      const kind = KINDS[Math.floor(Math.random() * KINDS.length)]
      this.spawnAt(kind, new THREE.Vector3(x, y, z))
      return
    }
  }

  spawnAt(kind: AnimalKind, position: THREE.Vector3, delivered = false): Animal {
    const animal = new Animal(kind, position)
    animal.delivered = delivered
    this.scene.add(animal.group)
    this.animals.push(animal)
    return animal
  }

  /** Восстановление приведённых животных после загрузки — сейв хранит только число. */
  restoreDelivered(count: number, villageCenter: THREE.Vector3 | null): void {
    if (villageCenter === null) return
    for (let i = 0; i < count; i++) {
      const angle = (i / Math.max(1, count)) * Math.PI * 2
      const x = villageCenter.x + Math.cos(angle) * 5
      const z = villageCenter.z + Math.sin(angle) * 5
      const kind = KINDS[i % KINDS.length]
      this.spawnAt(kind, new THREE.Vector3(x, this.world.groundY(x, z), z), true)
    }
  }

  private remove(index: number): void {
    const animal = this.animals[index]
    this.scene.remove(animal.group)
    animal.dispose()
    this.animals.splice(index, 1)
  }
}
