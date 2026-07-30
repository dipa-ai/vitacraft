import * as THREE from 'three'
import { VILLAGE, WORLD } from '../config/tuning'
import { Smurf, type SmurfContext } from '../entities/smurf'
import type { Player } from '../player/player'
import type { Fx } from '../render/fx'
import { Block, isBed, isDoor, isWater } from '../world/blocks'
import type { World } from '../world/world'
import { explainFailure, roomCenter, validateRoom, type RoomFailure } from './houses'

interface House {
  center: THREE.Vector3
  volume: number
  smurf: Smurf
}

function bedKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}

/** Quest chain before Vitruylan arrives. Each step teaches a mechanic used later. */
export const QUEST_CHAIN = [
  { id: 'village', title: 'Построй домики для смурфиков', total: VILLAGE.housesRequired },
  { id: 'animals', title: 'Приведи зверюшек морковкой', total: VILLAGE.animalsRequired },
  { id: 'pond', title: 'Выкопай и залей пруд у деревни', total: VILLAGE.pondCellsRequired },
  { id: 'night', title: 'Переживи ночь', total: 1 },
  { id: 'clouds', title: 'Собери облачка с ночных зверюшек', total: VILLAGE.cloudsRequired },
] as const

export type QuestId = (typeof QUEST_CHAIN)[number]['id']

/** Elder lines spoken when a quest is assigned. */
const ELDER_LINES: Record<QuestId, string> = {
  village: 'Старейшина: «Нам нужно пять домиков — с кроватками и без сквозняков!»',
  animals:
    'Старейшина: «Нужны зверюшки! Морковка растёт оранжевыми грядками на лугах — сломай грядку и приведи трёх»',
  pond: 'Старейшина: «Хотим пруд! Выкопай яму рядом и налей воды из ведра»',
  night: 'Старейшина: «Ночью приходят тёмные зверюшки… переживи ночь. Дом спасает!»',
  clouds: 'Старейшина: «Их облачка — отличные снаряды! Собери десяток, пригодятся»',
}

/**
 * Village and quest chain.
 *
 * Houses follow one rule: a bed inside a sealed room, rechecked after every nearby
 * block change — symmetrically both ways. Break a wall and the house stops counting
 * and the resident leaves; seal it again and a new resident arrives.
 *
 * Quest progress is derived from the world when possible: houses from beds, the pond
 * from a water scan near the village. Only “survived the night”, delivered animals,
 * and gathered clouds come from outside (you cannot derive those from voxels).
 */
export class Village {
  private readonly knownBeds = new Map<string, THREE.Vector3>()
  private readonly houses = new Map<string, House>()
  private readonly departing = new Set<Smurf>()

  /** Index of the current quest in QUEST_CHAIN; equals the chain length when done. */
  stage = 0
  animalsDelivered = 0
  cloudsGathered = 0
  nightSurvived = false
  private pondCells = 0
  private pondCenter: THREE.Vector3 | null = null
  private pondScanTimer = 0

  /** Night-enemy positions — filled in by the night manager. */
  threats: readonly THREE.Vector3[] = []
  night = false

  private announcedCompletion = false
  private elderAssigned = false

  onProgress: ((title: string, done: number, total: number) => void) | null = null
  onSay: ((text: string) => void) | null = null
  onHint: ((id: string, text: string) => void) | null = null
  onCompleted: (() => void) | null = null
  onSettled: (() => void) | null = null
  /** Idempotent door control — wired from main via Interaction. */
  setDoor: (x: number, y: number, z: number, open: boolean) => void = () => {}

  constructor(
    private readonly world: World,
    private readonly scene: THREE.Scene,
    private readonly player: Player,
    private readonly fx: Fx,
  ) {}

  get housesBuilt(): number {
    return this.houses.size
  }

  get completed(): boolean {
    return this.stage >= QUEST_CHAIN.length
  }

  get residents(): Smurf[] {
    return [...this.houses.values()].map((house) => house.smurf)
  }

  get bedPositions(): [number, number, number][] {
    return [...this.knownBeds.values()].map((bed) => [bed.x, bed.y, bed.z])
  }

  /** Village center — average of house centers. No houses means no village. */
  center(): THREE.Vector3 | null {
    if (this.houses.size === 0) return null
    const sum = new THREE.Vector3()
    for (const house of this.houses.values()) sum.add(house.center)
    return sum.divideScalar(this.houses.size)
  }

  /** Points of interest for smurf walks: doorsteps, pond, square. */
  private pois(): THREE.Vector3[] {
    const points = [...this.houses.values()].map((house) => house.smurf.home)
    const villageCenter = this.center()
    if (villageCenter !== null) points.push(villageCenter)
    if (this.pondCenter !== null) points.push(this.pondCenter)
    return points
  }

  // ------------------------------------------------------------------ houses

  handleBlockPlaced(x: number, y: number, z: number, block: Block): void {
    // Only the head of a bed pair (or the legacy single-cell bed) is registered —
    // otherwise one bed would count as two houses.
    if (block === Block.BedHead || block === Block.Bed) {
      this.knownBeds.set(bedKey(x, y, z), new THREE.Vector3(x, y, z))
      const result = validateRoom(this.world.reader, x, y, z)
      if (!result.ok) this.explain(result.reason)
    }
    this.reevaluateAll()
  }

  handleBlockBroken(x: number, y: number, z: number, block: Block): void {
    if (isBed(block)) {
      const key = bedKey(x, y, z)
      this.knownBeds.delete(key)
      this.deregister(key)
    }
    this.reevaluateAll()
  }

  private reevaluateAll(): void {
    // At most a handful of beds can exist at once. Rechecking all of them is cheap
    // and, unlike a fixed distance cutoff, remains correct for long narrow rooms.
    for (const [key, bed] of this.knownBeds) {
      const result = validateRoom(this.world.reader, bed.x, bed.y, bed.z)
      const registered = this.houses.has(key)

      if (result.ok && !registered) {
        this.register(key, bed, result.volume, roomCenter(result.cells), result.cells)
      } else if (!result.ok && registered) {
        this.deregister(key)
      }
    }
  }

  private explain(reason: RoomFailure | null): void {
    if (reason === null) return
    this.onHint?.(`room-${reason}`, explainFailure(reason))
  }

  private register(
    key: string,
    bed: THREE.Vector3,
    volume: number,
    center: { x: number; y: number; z: number },
    cells: readonly { x: number; y: number; z: number }[],
  ): void {
    const centerVec = new THREE.Vector3(center.x + 0.5, center.y, center.z + 0.5)

    // House door: a door cell adjacent to the room. Smurfs enter through it at night.
    const door = this.findDoor(cells)
    const doorstep = this.findDoorstep(door, centerVec)

    // Residents walk in from the horizon so settling reads as an event.
    const angle = Math.random() * Math.PI * 2
    const spawnX = centerVec.x + Math.cos(angle) * VILLAGE.arriveDistance
    const spawnZ = centerVec.z + Math.sin(angle) * VILLAGE.arriveDistance
    const spawn = new THREE.Vector3(spawnX, this.world.groundY(spawnX, spawnZ), spawnZ)

    // First settler is the elder: assigns quests and wears a red hat.
    const elder = !this.elderAssigned
    this.elderAssigned = true

    const smurf = new Smurf(spawn, doorstep, elder)
    smurf.door = door
    // Floor cell to hide on: next to the bed, not the geometric room center.
    smurf.inside = new THREE.Vector3(bed.x, bed.y, bed.z)
    smurf.onSay = (text) => this.onSay?.(text)
    smurf.onSettled = () => {
      this.fx.hearts(smurf.position.clone().setY(smurf.position.y + 1.4))
      this.onSettled?.()
    }
    smurf.onGone = () => this.removeSmurf(smurf)

    this.scene.add(smurf.group)
    this.houses.set(key, { center: centerVec, volume, smurf })

    this.fx.burst(centerVec.clone().setY(centerVec.y + 1), 0xfff3b0, 14, { speed: 3, size: 0.14 })
    this.reportProgress()
  }

  /** Finds a door on the room boundary: a door cell adjacent to an interior cell. */
  private findDoor(cells: readonly { x: number; y: number; z: number }[]): THREE.Vector3 | null {
    for (const cell of cells) {
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const x = cell.x + dx
        const z = cell.z + dz
        if (isDoor(this.world.getVoxel(x, cell.y, z))) {
          // Lower door cell.
          const y = isDoor(this.world.getVoxel(x, cell.y - 1, z)) ? cell.y - 1 : cell.y
          return new THREE.Vector3(x, y, z)
        }
      }
    }
    return null
  }

  /** Doorstep: cell outside the door, or a random side of the house if there is none. */
  private findDoorstep(door: THREE.Vector3 | null, center: THREE.Vector3): THREE.Vector3 {
    if (door !== null) {
      // Outward — away from the room center.
      const dx = Math.sign(door.x + 0.5 - center.x)
      const dz = Math.sign(door.z + 0.5 - center.z)
      const x = door.x + (Math.abs(dx) >= Math.abs(dz) ? dx : 0) + 0.5
      const z = door.z + (Math.abs(dz) > Math.abs(dx) ? dz : 0) + 0.5
      return new THREE.Vector3(x, this.world.groundY(x, z), z)
    }
    const angle = Math.random() * Math.PI * 2
    const x = center.x + Math.cos(angle) * 2.5
    const z = center.z + Math.sin(angle) * 2.5
    return new THREE.Vector3(x, this.world.groundY(x, z), z)
  }

  private deregister(key: string): void {
    const house = this.houses.get(key)
    if (house === undefined) return
    this.houses.delete(key)
    house.smurf.evict()
    this.departing.add(house.smurf)
    this.reportProgress()
  }

  private removeSmurf(smurf: Smurf): void {
    this.departing.delete(smurf)
    this.scene.remove(smurf.group)
    smurf.dispose()
  }

  // ------------------------------------------------------------------ quest chain

  /** Progress of the current quest. */
  private questProgress(): { title: string; done: number; total: number } {
    if (this.completed) {
      return { title: 'Все испытания пройдены!', done: 1, total: 1 }
    }
    const quest = QUEST_CHAIN[this.stage]
    const done =
      quest.id === 'village'
        ? this.housesBuilt
        : quest.id === 'animals'
          ? this.animalsDelivered
          : quest.id === 'pond'
            ? this.pondCells
            : quest.id === 'night'
              ? this.nightSurvived
                ? 1
                : 0
              : this.cloudsGathered
    return { title: quest.title, done: Math.min(done, quest.total), total: quest.total }
  }

  private reportProgress(): void {
    const { title, done, total } = this.questProgress()
    this.onProgress?.(title, done, total)

    if (!this.completed && done >= total) {
      this.stage++
      if (this.completed) {
        if (!this.announcedCompletion) {
          this.announcedCompletion = true
          this.onCompleted?.()
        }
      } else {
        // The elder announces the next quest.
        this.onSay?.(ELDER_LINES[QUEST_CHAIN[this.stage].id])
        const next = this.questProgress()
        this.onProgress?.(next.title, next.done, next.total)
        // Progress may already be done (pond dug before the quest) — catch up.
        this.reportProgress()
      }
    }
  }

  /** An animal reached the village. */
  markAnimalDelivered(): void {
    this.animalsDelivered++
    this.onSay?.('В деревне новая зверюшка!')
    this.reportProgress()
  }

  /** Dawn after a full night. Counts only while the night quest is active. */
  markNightSurvived(): void {
    if (!this.completed && QUEST_CHAIN[this.stage].id === 'night') {
      this.nightSurvived = true
      this.reportProgress()
    }
  }

  markCloudsGathered(count: number): void {
    this.cloudsGathered += count
    if (!this.completed && QUEST_CHAIN[this.stage].id === 'clouds') this.reportProgress()
  }

  /** Pond scan: water cells above sea level near the village. Terrain lakes sit at
   * sea level or below, so foreign water cannot inflate the count. */
  private scanPond(): void {
    const center = this.center()
    if (center === null) return
    const r = VILLAGE.pondScanRadius
    let count = 0
    let sumX = 0
    let sumZ = 0
    const seaLevel = WORLD.seaLevel
    for (let x = Math.floor(center.x - r); x <= center.x + r; x += 1) {
      for (let z = Math.floor(center.z - r); z <= center.z + r; z += 1) {
        for (let y = seaLevel + 1; y <= seaLevel + 12; y++) {
          if (isWater(this.world.getVoxel(x, y, z))) {
            count++
            sumX += x
            sumZ += z
            break
          }
        }
      }
    }
    this.pondCells = count
    if (count >= VILLAGE.pondCellsRequired) {
      const px = sumX / count + 0.5
      const pz = sumZ / count + 0.5
      this.pondCenter = new THREE.Vector3(px, this.world.groundY(px, pz), pz)
      if (!this.completed && QUEST_CHAIN[this.stage].id === 'pond') this.reportProgress()
    }
  }

  /** Restore after load: numeric progress from the save, houses from the world. */
  restoreProgress(saved: {
    stage: number
    animals: number
    night: boolean
    clouds: number
  }): void {
    this.stage = Math.min(saved.stage, QUEST_CHAIN.length)
    this.animalsDelivered = saved.animals
    this.nightSurvived = saved.night
    this.cloudsGathered = saved.clouds
    if (this.completed) this.announcedCompletion = true
  }

  // ------------------------------------------------------------------ frame

  update(dt: number, elapsed: number): void {
    // Pond is scanned infrequently: a full cube walk is not for every frame.
    this.pondScanTimer -= dt
    if (this.pondScanTimer <= 0) {
      this.pondScanTimer = 2
      this.scanPond()
    }

    const residents = this.residents
    const ctx: SmurfContext = {
      player: this.player.position,
      pois: this.pois(),
      others: residents,
      threat: this.nearestThreatTo(this.player.position),
      night: this.night,
      setDoor: (x, y, z, open) => this.setDoor(x, y, z, open),
    }

    for (const house of this.houses.values()) {
      // Each smurf’s threat is the nearest to them, not to the player.
      ctx.threat = this.nearestThreatTo(house.smurf.position)
      house.smurf.update(dt, this.world, elapsed, ctx)
    }
    for (const smurf of [...this.departing]) {
      ctx.threat = null
      smurf.update(dt, this.world, elapsed, ctx)
    }
  }

  private nearestThreatTo(point: THREE.Vector3): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null
    let bestDistance = Infinity
    for (const threat of this.threats) {
      const distance = threat.distanceTo(point)
      if (distance < bestDistance) {
        bestDistance = distance
        best = threat
      }
    }
    return best
  }

  start(): void {
    this.onSay?.(ELDER_LINES[QUEST_CHAIN[Math.min(this.stage, QUEST_CHAIN.length - 1)].id])
    const { title, done, total } = this.questProgress()
    this.onProgress?.(title, done, total)
  }
}
