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

/** Дальше этого расстояния от кроватки изменение блока на её комнату не влияет. */
const INFLUENCE_RADIUS = 14

function bedKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}

/** Цепочка испытаний до прихода Витруляна. Каждое учит механике, нужной дальше. */
export const QUEST_CHAIN = [
  { id: 'village', title: 'Построй домики для смурфиков', total: VILLAGE.housesRequired },
  { id: 'animals', title: 'Приведи зверюшек морковкой', total: VILLAGE.animalsRequired },
  { id: 'pond', title: 'Выкопай и залей пруд у деревни', total: VILLAGE.pondCellsRequired },
  { id: 'night', title: 'Переживи ночь', total: 1 },
  { id: 'clouds', title: 'Собери облачка с ночных зверюшек', total: VILLAGE.cloudsRequired },
] as const

export type QuestId = (typeof QUEST_CHAIN)[number]['id']

/** Реплики старейшины на выдаче заданий. */
const ELDER_LINES: Record<QuestId, string> = {
  village: 'Старейшина: «Нам нужно пять домиков — с кроватками и без сквозняков!»',
  animals: 'Старейшина: «Деревне нужны зверюшки! Найди морковку и приведи трёх»',
  pond: 'Старейшина: «Хотим пруд! Выкопай яму рядом и налей воды из ведра»',
  night: 'Старейшина: «Ночью приходят тёмные зверюшки… переживи ночь. Дом спасает!»',
  clouds: 'Старейшина: «Их облачка — отличные снаряды! Собери десяток, пригодятся»',
}

/**
 * Деревня и цепочка испытаний.
 *
 * Дома держатся на одном правиле: кроватка в герметичной комнате, и оно перепроверяется
 * после каждого изменения блока рядом — симметрично в обе стороны. Сломал стену — дом
 * перестал считаться и житель ушёл; заделал — дом снова дом, приедет новый.
 *
 * Прогресс цепочки — тоже по возможности выводится из мира: дома из кроваток, пруд —
 * сканом воды у деревни. Только «пережитая ночь», приведённые животные и собранные
 * облачка приходят снаружи (их из вокселей не выведешь).
 */
export class Village {
  private readonly knownBeds = new Map<string, THREE.Vector3>()
  private readonly houses = new Map<string, House>()
  private readonly departing = new Set<Smurf>()

  /** Индекс текущего испытания в QUEST_CHAIN; равен длине цепочки, когда всё пройдено. */
  stage = 0
  animalsDelivered = 0
  cloudsGathered = 0
  nightSurvived = false
  private pondCells = 0
  private pondCenter: THREE.Vector3 | null = null
  private pondScanTimer = 0

  /** Позиции ночных врагов — подставляет менеджер ночи. */
  threats: readonly THREE.Vector3[] = []
  night = false

  private readonly scratch = new THREE.Vector3()
  private announcedCompletion = false
  private elderAssigned = false

  onProgress: ((title: string, done: number, total: number) => void) | null = null
  onSay: ((text: string) => void) | null = null
  onHint: ((id: string, text: string) => void) | null = null
  onCompleted: (() => void) | null = null
  onSettled: (() => void) | null = null
  /** Идемпотентное управление дверью — подставляет main через Interaction. */
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

  /** Центр деревни — среднее по домам. Пока домов нет, деревни нет. */
  center(): THREE.Vector3 | null {
    if (this.houses.size === 0) return null
    const sum = new THREE.Vector3()
    for (const house of this.houses.values()) sum.add(house.center)
    return sum.divideScalar(this.houses.size)
  }

  /** Точки интереса для прогулок смурфиков: крылечки, пруд, площадь. */
  private pois(): THREE.Vector3[] {
    const points = [...this.houses.values()].map((house) => house.smurf.home)
    const villageCenter = this.center()
    if (villageCenter !== null) points.push(villageCenter)
    if (this.pondCenter !== null) points.push(this.pondCenter)
    return points
  }

  // ------------------------------------------------------------------ дома

  handleBlockPlaced(x: number, y: number, z: number, block: Block): void {
    // Регистрируется только изголовье пары (или старая одноклеточная кроватка) — иначе
    // одна кроватка давала бы два дома.
    if (block === Block.BedHead || block === Block.Bed) {
      this.knownBeds.set(bedKey(x, y, z), new THREE.Vector3(x, y, z))
      const result = validateRoom(this.world.reader, x, y, z)
      if (!result.ok) this.explain(result.reason)
    }
    this.reevaluateNear(x, y, z)
  }

  handleBlockBroken(x: number, y: number, z: number, block: Block): void {
    if (isBed(block)) {
      const key = bedKey(x, y, z)
      this.knownBeds.delete(key)
      this.deregister(key)
    }
    this.reevaluateNear(x, y, z)
  }

  private reevaluateNear(x: number, y: number, z: number): void {
    this.scratch.set(x, y, z)
    for (const [key, bed] of this.knownBeds) {
      if (bed.distanceTo(this.scratch) > INFLUENCE_RADIUS) continue

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

    // Дверь дома: клетка двери, примыкающая к комнате. Через неё смурфик заходит на ночь.
    const door = this.findDoor(cells)
    const doorstep = this.findDoorstep(door, centerVec)

    // Житель приходит пешком от горизонта — так заселение читается как событие.
    const angle = Math.random() * Math.PI * 2
    const spawnX = centerVec.x + Math.cos(angle) * VILLAGE.arriveDistance
    const spawnZ = centerVec.z + Math.sin(angle) * VILLAGE.arriveDistance
    const spawn = new THREE.Vector3(spawnX, this.world.groundY(spawnX, spawnZ), spawnZ)

    // Первый заселившийся — старейшина: он выдаёт задания и носит красный колпачок.
    const elder = !this.elderAssigned
    this.elderAssigned = true

    const smurf = new Smurf(spawn, doorstep, elder)
    smurf.door = door
    // Клетка пола комнаты, куда прятаться: у кроватки, а не в геометрическом центре.
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

  /** Ищет дверь на границе комнаты: клетка двери, соседняя с внутренней клеткой. */
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
          // Нижняя клетка двери.
          const y = isDoor(this.world.getVoxel(x, cell.y - 1, z)) ? cell.y - 1 : cell.y
          return new THREE.Vector3(x, y, z)
        }
      }
    }
    return null
  }

  /** Крылечко: клетка снаружи от двери, а без двери — случайная сторона дома. */
  private findDoorstep(door: THREE.Vector3 | null, center: THREE.Vector3): THREE.Vector3 {
    if (door !== null) {
      // Наружу — в сторону от центра комнаты.
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

  // ------------------------------------------------------------------ цепочка

  /** Прогресс текущего испытания. */
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
        // Следующее задание объявляет старейшина.
        this.onSay?.(ELDER_LINES[QUEST_CHAIN[this.stage].id])
        const next = this.questProgress()
        this.onProgress?.(next.title, next.done, next.total)
        // Прогресс мог быть уже выполнен заранее (пруд выкопан до задания) — досчитываем.
        this.reportProgress()
      }
    }
  }

  /** Животное дошло до деревни. */
  markAnimalDelivered(): void {
    this.animalsDelivered++
    this.onSay?.('В деревне новая зверюшка!')
    this.reportProgress()
  }

  /** Рассвет после целой ночи. Считается только когда испытание активно. */
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

  /** Пруд ищем сканом: клетки воды выше уровня моря рядом с деревней. Terrain-озёра
   * все на уровне моря и ниже, поэтому насчитать чужую воду нельзя. */
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

  /** Восстановление после загрузки: числовой прогресс из сейва, дома — из мира. */
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

  // ------------------------------------------------------------------ кадр

  update(dt: number, elapsed: number): void {
    // Пруд сканируется редко: полный проход по кубу — не для каждого кадра.
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
      // Угроза для каждого смурфика своя — ближайшая к нему, а не к игроку.
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
