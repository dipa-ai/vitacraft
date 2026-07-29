import * as THREE from 'three'
import { VILLAGE } from '../config/tuning'
import { Smurf } from '../entities/smurf'
import type { Player } from '../player/player'
import type { Fx } from '../render/fx'
import { Block } from '../world/blocks'
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

/**
 * Испытание «построй деревню для смурфиков».
 *
 * Логика симметрична и держится на одном правиле: дом — это кроватка внутри герметичной
 * комнаты, и это проверяется заново после каждого изменения блока рядом. Сломал стену —
 * дом перестал считаться, житель ушёл. Заделал обратно — дом снова засчитан, приезжает
 * новый житель.
 *
 * Симметрия здесь принципиальна. Если проверять только в сторону ухудшения, игрок,
 * случайно сбивший блок, оказывается наказан безвозвратно и правило выглядит сломанным.
 */
export class Village {
  /** Все кроватки, поставленные игроком, — и заселённые, и пока нет. */
  private readonly knownBeds = new Map<string, THREE.Vector3>()
  /** Кроватки, чья комната прошла проверку. Ключ тот же, что и у knownBeds. */
  private readonly houses = new Map<string, House>()
  /** Смурфики, снятые с учёта, но ещё идущие прочь из деревни. */
  private readonly departing = new Set<Smurf>()

  private readonly scratch = new THREE.Vector3()
  private announcedCompletion = false

  onProgress: ((done: number, total: number) => void) | null = null
  onSay: ((text: string) => void) | null = null
  onHint: ((id: string, text: string) => void) | null = null
  onCompleted: (() => void) | null = null
  onSettled: (() => void) | null = null

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
    return this.houses.size >= VILLAGE.housesRequired
  }

  get residents(): Smurf[] {
    return [...this.houses.values()].map((house) => house.smurf)
  }

  /** Центры признанных домов — по ним босс понимает, где деревня. */
  get houseCenters(): THREE.Vector3[] {
    return [...this.houses.values()].map((house) => house.center)
  }

  /**
   * Все известные кроватки для сохранения. Сами дома не сохраняем: после загрузки они
   * пересобираются прогоном той же проверки, поэтому расхождения между сохранением
   * и правилами игры возникнуть не может.
   */
  get bedPositions(): [number, number, number][] {
    return [...this.knownBeds.values()].map((bed) => [bed.x, bed.y, bed.z])
  }

  handleBlockPlaced(x: number, y: number, z: number, block: Block): void {
    if (block === Block.Bed) {
      this.knownBeds.set(bedKey(x, y, z), new THREE.Vector3(x, y, z))
      // Объясняем причину только для только что поставленной кроватки: иначе подсказка
      // выскакивала бы при любой стройке рядом с недостроенным домом.
      const result = validateRoom(this.world.reader, x, y, z)
      if (!result.ok) this.explain(result.reason)
    }
    this.reevaluateNear(x, y, z)
  }

  handleBlockBroken(x: number, y: number, z: number, block: Block): void {
    if (block === Block.Bed) {
      const key = bedKey(x, y, z)
      this.knownBeds.delete(key)
      this.deregister(key)
    }
    this.reevaluateNear(x, y, z)
  }

  /**
   * Пересматривает все кроватки рядом с изменившимся блоком — в обе стороны:
   * герметичная комната становится домом, разгерметизированная им перестаёт быть.
   */
  private reevaluateNear(x: number, y: number, z: number): void {
    this.scratch.set(x, y, z)
    for (const [key, bed] of this.knownBeds) {
      if (bed.distanceTo(this.scratch) > INFLUENCE_RADIUS) continue

      const result = validateRoom(this.world.reader, bed.x, bed.y, bed.z)
      const registered = this.houses.has(key)

      if (result.ok && !registered) {
        this.register(key, result.volume, roomCenter(result.cells))
      } else if (!result.ok && registered) {
        this.deregister(key)
      }
    }
  }

  private explain(reason: RoomFailure | null): void {
    if (reason === null) return
    // Одна подсказка на причину: повторять её при каждой неудаче — раздражает.
    this.onHint?.(`room-${reason}`, explainFailure(reason))
  }

  private register(
    key: string,
    volume: number,
    center: { x: number; y: number; z: number },
  ): void {
    const centerVec = new THREE.Vector3(center.x + 0.5, center.y, center.z + 0.5)

    // Житель приходит с окраины, а не появляется из воздуха: так заселение читается
    // как событие, а не как телепорт.
    const angle = Math.random() * Math.PI * 2
    const spawnX = centerVec.x + Math.cos(angle) * 16
    const spawnZ = centerVec.z + Math.sin(angle) * 16
    const spawn = new THREE.Vector3(spawnX, this.world.surfaceY(spawnX, spawnZ), spawnZ)

    // Цель — снаружи дома. Внутрь замкнутой комнаты смурфику не попасть, и это прямое
    // следствие правил: дверь сделала бы комнату негерметичной.
    const doorstep = centerVec.clone()
    doorstep.x += Math.cos(angle) * 2.5
    doorstep.z += Math.sin(angle) * 2.5
    doorstep.y = this.world.surfaceY(doorstep.x, doorstep.z)

    const smurf = new Smurf(spawn, doorstep)
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

  private deregister(key: string): void {
    const house = this.houses.get(key)
    if (house === undefined) return
    this.houses.delete(key)
    // Смурфик переезжает в departing: иначе он выпал бы из обновления и застыл на месте.
    house.smurf.evict()
    this.departing.add(house.smurf)
    this.reportProgress()
  }

  private removeSmurf(smurf: Smurf): void {
    this.departing.delete(smurf)
    this.scene.remove(smurf.group)
    smurf.dispose()
  }

  private reportProgress(): void {
    this.onProgress?.(this.houses.size, VILLAGE.housesRequired)
    if (this.completed && !this.announcedCompletion) {
      this.announcedCompletion = true
      this.onCompleted?.()
    }
  }

  update(dt: number, elapsed: number): void {
    for (const house of this.houses.values()) {
      house.smurf.update(dt, this.world, elapsed, this.player.position)
    }
    // Копия набора: уходящий смурфик по завершении удаляет себя отсюда же.
    for (const smurf of [...this.departing]) {
      smurf.update(dt, this.world, elapsed, this.player.position)
    }
  }

  start(): void {
    this.reportProgress()
  }
}
