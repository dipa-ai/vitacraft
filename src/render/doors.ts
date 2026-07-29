import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { BLOCK_COLORS } from '../config/palette'
import { Block, isDoor, sealsRoom } from '../world/blocks'
import type { World } from '../world/world'

/**
 * Двери не рисуются мешером (куб не выглядит дверью), а живут отдельными мешами:
 * рама + полотно, при открытии полотно распахивается вокруг петли.
 *
 * Ориентация у двери не хранится в id — она угадывается по стенам вокруг: полотно
 * встаёт вдоль ряда стены, в которой дверь стоит. Для нормально построенных домов
 * это всегда верно, а в чистом поле дверь просто смотрит по X.
 */

interface DoorVisual {
  group: THREE.Group
  hinge: THREE.Group
  open: boolean
}

export class DoorVisuals {
  private readonly doors = new Map<string, DoorVisual>()
  private readonly root = new THREE.Group()

  constructor(
    scene: THREE.Scene,
    private readonly world: World,
  ) {
    this.root.name = 'doors'
    scene.add(this.root)
  }

  /** Зовётся после каждого изменения блока. Дёшево: почти всегда выходит сразу. */
  onBlockChanged(x: number, y: number, z: number): void {
    // Дверь может появиться/исчезнуть в самой клетке или клеткой выше/ниже.
    this.refreshCell(x, y, z)
    this.refreshCell(x, y - 1, z)
    this.refreshCell(x, y + 1, z)
  }

  /** Пересобирает двери по диффу игрока — нужно один раз после загрузки сохранения. */
  rebuildFromEdits(): void {
    for (const key of this.doors.keys()) this.remove(key)
    for (const [key, id] of this.world.edits) {
      if (!isDoor(id)) continue
      const [x, y, z] = key.split(',').map(Number)
      this.refreshCell(x, y, z)
    }
  }

  private refreshCell(x: number, y: number, z: number): void {
    const id = this.world.getVoxel(x, y, z)
    const isBottom = isDoor(id) && !isDoor(this.world.getVoxel(x, y - 1, z))
    const key = `${x},${y},${z}`
    const existing = this.doors.get(key)

    if (!isBottom) {
      if (existing !== undefined) this.remove(key)
      return
    }

    const open = id === Block.DoorOpen
    if (existing !== undefined) {
      if (existing.open !== open) this.setOpen(existing, open)
      return
    }

    const visual = this.build(x, y, z)
    this.setOpen(visual, open)
    this.doors.set(key, visual)
  }

  private build(x: number, y: number, z: number): DoorVisual {
    // Полотно вдоль оси, по которой идут стены вокруг двери.
    const wallAlongX =
      sealsRoom(this.world.getVoxel(x - 1, y, z)) || sealsRoom(this.world.getVoxel(x + 1, y, z))

    const group = new THREE.Group()
    group.position.set(x + 0.5, y, z + 0.5)
    if (!wallAlongX) group.rotation.y = Math.PI / 2

    const material = new THREE.MeshLambertMaterial({ color: BLOCK_COLORS.door })
    const frameMaterial = new THREE.MeshLambertMaterial({ color: BLOCK_COLORS.doorDark })

    // Рама: две стойки и перекладина.
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new RoundedBoxGeometry(0.12, 2.0, 0.16, 2, 0.04), frameMaterial)
      post.position.set(side * 0.44, 1.0, 0)
      post.castShadow = true
      group.add(post)
    }
    const lintel = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.14, 0.16, 2, 0.04), frameMaterial)
    lintel.position.set(0, 1.95, 0)
    group.add(lintel)

    // Полотно на петле у левой стойки.
    const hinge = new THREE.Group()
    hinge.position.set(-0.38, 0, 0)
    const panel = new THREE.Mesh(new RoundedBoxGeometry(0.76, 1.84, 0.09, 2, 0.03), material)
    panel.position.set(0.38, 0.95, 0)
    panel.castShadow = true
    hinge.add(panel)

    // Ручка, чтобы дверь читалась как дверь, а не доска.
    const knob = new THREE.Mesh(
      new RoundedBoxGeometry(0.08, 0.08, 0.14, 2, 0.03),
      new THREE.MeshLambertMaterial({ color: 0xffe07a }),
    )
    knob.position.set(0.66, 0.95, 0)
    hinge.add(knob)

    group.add(hinge)
    this.root.add(group)
    return { group, hinge, open: false }
  }

  private setOpen(visual: DoorVisual, open: boolean): void {
    visual.open = open
    // Мгновенный поворот: анимация потребовала бы апдейта каждый кадр ради редкого события.
    visual.hinge.rotation.y = open ? -Math.PI / 2 + 0.2 : 0
  }

  private remove(key: string): void {
    const visual = this.doors.get(key)
    if (visual === undefined) return
    this.doors.delete(key)
    this.root.remove(visual.group)
    visual.group.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose()
        ;(node.material as THREE.Material).dispose()
      }
    })
  }
}
