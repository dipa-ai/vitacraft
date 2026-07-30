import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { BLOCK_COLORS } from '../config/palette'
import { Block, isDoor, sealsRoom } from '../world/blocks'
import type { World } from '../world/world'

/**
 * Doors are not drawn by the mesher (a cube doesn't look like a door); they live as
 * separate meshes: a frame plus a panel that swings around its hinge when opened.
 *
 * A door's orientation is not stored in the id — it is inferred from surrounding
 * walls: the panel aligns with the wall run the door sits in. For normally built
 * houses this is always right; in an open field the door just faces along X.
 */

interface DoorVisual {
  group: THREE.Group
  hinge: THREE.Group
  open: boolean
  wallAlongX: boolean
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

  /** Called after every block change. Cheap: nearly always exits immediately. */
  onBlockChanged(x: number, y: number, z: number): void {
    // A door may occupy this column, or a neighboring wall may change its inferred
    // orientation. Check both vertical halves around all five relevant columns.
    for (const [dx, dz] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      this.refreshCell(x + dx, y - 1, z + dz)
      this.refreshCell(x + dx, y, z + dz)
      this.refreshCell(x + dx, y + 1, z + dz)
    }
  }

  /** Rebuilds doors from the player diff — needed once after loading a save. */
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
    const wallAlongX =
      sealsRoom(this.world.getVoxel(x - 1, y, z)) || sealsRoom(this.world.getVoxel(x + 1, y, z))
    if (existing !== undefined) {
      if (existing.open === open && existing.wallAlongX === wallAlongX) return
      // Rebuild wholesale: orientation is inferred from walls, and walls may have
      // been finished after the door was placed — otherwise the swung panel sinks
      // into the wall and an open door looks closed.
      this.remove(key)
    }

    const visual = this.build(x, y, z, wallAlongX)
    this.setOpen(visual, open)
    this.doors.set(key, visual)
  }

  /**
   * A safety reconciliation with blocks, once per second from the game loop: if the
   * visual and the voxels diverge (a broken door with a live picture is the worst
   * case: the player thinks they're safe while a monster walks through), the
   * picture heals itself.
   */
  audit(): void {
    for (const key of [...this.doors.keys()]) {
      const [x, y, z] = key.split(',').map(Number)
      this.refreshCell(x, y, z)
    }
    for (const [key, id] of this.world.edits) {
      if (!isDoor(id)) continue
      const [x, y, z] = key.split(',').map(Number)
      this.refreshCell(x, y, z)
    }
  }

  private build(x: number, y: number, z: number, wallAlongX: boolean): DoorVisual {
    // The panel runs along the axis of the walls around the door.
    const group = new THREE.Group()
    group.position.set(x + 0.5, y, z + 0.5)
    if (!wallAlongX) group.rotation.y = Math.PI / 2

    const material = new THREE.MeshLambertMaterial({ color: BLOCK_COLORS.door })
    const frameMaterial = new THREE.MeshLambertMaterial({ color: BLOCK_COLORS.doorDark })

    // The frame: two posts and a lintel.
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new RoundedBoxGeometry(0.12, 2.0, 0.16, 2, 0.04), frameMaterial)
      post.position.set(side * 0.44, 1.0, 0)
      post.castShadow = true
      group.add(post)
    }
    const lintel = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.14, 0.16, 2, 0.04), frameMaterial)
    lintel.position.set(0, 1.95, 0)
    group.add(lintel)

    // The panel hinged at the left post.
    const hinge = new THREE.Group()
    hinge.position.set(-0.38, 0, 0)
    const panel = new THREE.Mesh(new RoundedBoxGeometry(0.76, 1.84, 0.09, 2, 0.03), material)
    panel.position.set(0.38, 0.95, 0)
    panel.castShadow = true
    hinge.add(panel)

    // A knob so the door reads as a door, not a plank.
    const knob = new THREE.Mesh(
      new RoundedBoxGeometry(0.08, 0.08, 0.14, 2, 0.03),
      new THREE.MeshLambertMaterial({ color: 0xffe07a }),
    )
    knob.position.set(0.66, 0.95, 0)
    hinge.add(knob)

    group.add(hinge)
    this.root.add(group)
    return { group, hinge, open: false, wallAlongX }
  }

  private setOpen(visual: DoorVisual, open: boolean): void {
    visual.open = open
    // Instant rotation: animating would need per-frame updates for a rare event.
    visual.hinge.rotation.y = open ? -1.85 : 0
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
