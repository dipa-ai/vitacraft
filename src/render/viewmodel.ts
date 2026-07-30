import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { BLOCK_COLORS, CREATURE_COLORS } from '../config/palette'
import { Block, blockDef } from '../world/blocks'

/**
 * First-person hands: the right one holds the pickaxe and swings on LMB, the left one
 * holds the selected item and bumps forward on placement. Without them first person
 * feels empty, and the pickaxe swing is what makes a strike readable.
 *
 * The group is parented to the camera, so positions are in camera space (-Z forward).
 * Materials draw without depth testing on top of the world: otherwise hands would
 * sink into a wall the moment you step close.
 */

/** Viewmodel material: over the world, no shadows. */
function handMaterial(color: number, opacity = 1): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ color })
  material.depthTest = false
  if (opacity < 1) {
    material.transparent = true
    material.opacity = opacity
  }
  return material
}

function part(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 1000
  mesh.frustumCulled = false
  mesh.castShadow = false
  return mesh
}

function box(
  width: number,
  height: number,
  depth: number,
  color: number,
  radius = 0.02,
  opacity = 1,
): THREE.Mesh {
  const safe = Math.min(radius, Math.min(width, height, depth) / 2 - 0.001)
  return part(new RoundedBoxGeometry(width, height, depth, 2, Math.max(0.001, safe)), handMaterial(color, opacity))
}

export class Viewmodel {
  private readonly group = new THREE.Group()
  private readonly pickaxePivot = new THREE.Group()
  private readonly itemPivot = new THREE.Group()
  private readonly itemHolder = new THREE.Group()

  private currentItem: Block | null = null
  /** Pickaxe swing phase, 0…1; -1 is rest. */
  private swingPhase = -1
  /** Item bump on placement, 0…1 decaying. */
  private placeBumpAmount = 0

  constructor(camera: THREE.PerspectiveCamera) {
    camera.add(this.group)

    // The whole viewmodel is slightly shrunk and pushed to the corners, away from the crosshair.
    this.group.scale.setScalar(0.72)

    // Right hand with the pickaxe.
    this.pickaxePivot.position.set(0.56, -0.48, -0.82)
    this.pickaxePivot.rotation.set(-0.5, -0.35, 0.18)
    this.buildArmWithPickaxe(this.pickaxePivot)
    this.group.add(this.pickaxePivot)

    // Left hand with the item.
    this.itemPivot.position.set(-0.54, -0.42, -0.76)
    this.itemPivot.rotation.set(-0.25, 0.3, -0.1)
    const arm = box(0.13, 0.34, 0.13, CREATURE_COLORS.playerBody, 0.05)
    arm.position.set(0, -0.2, 0.1)
    arm.rotation.x = 0.7
    this.itemPivot.add(arm)
    this.itemHolder.position.set(0, 0.02, 0)
    this.itemPivot.add(this.itemHolder)
    this.group.add(this.itemPivot)
  }

  private buildArmWithPickaxe(pivot: THREE.Group): void {
    const arm = box(0.13, 0.36, 0.13, CREATURE_COLORS.playerBody, 0.05)
    arm.position.set(0, -0.22, 0.1)
    arm.rotation.x = 0.7
    pivot.add(arm)

    // Pickaxe: a handle and a crossbar head with two drooping tips.
    const handle = box(0.04, 0.36, 0.04, BLOCK_COLORS.woodSide, 0.015)
    handle.position.set(0, 0.1, 0)
    pivot.add(handle)

    const head = box(0.22, 0.05, 0.05, BLOCK_COLORS.stone, 0.02)
    head.position.set(0, 0.27, 0)
    pivot.add(head)

    for (const side of [-1, 1]) {
      const tip = box(0.07, 0.045, 0.045, BLOCK_COLORS.stone, 0.015)
      tip.position.set(side * 0.13, 0.245, 0)
      tip.rotation.z = side * -0.5
      pivot.add(tip)
    }
  }

  /** Rebuilds the left-hand item for the selected slot. */
  setItem(item: Block): void {
    if (item === this.currentItem) return
    this.currentItem = item

    for (const child of [...this.itemHolder.children]) {
      this.itemHolder.remove(child)
      child.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose()
          ;(node.material as THREE.Material).dispose()
        }
      })
    }

    this.itemHolder.add(this.buildItem(item))
  }

  private buildItem(item: Block): THREE.Object3D {
    if (item === Block.Carrot) {
      const carrot = new THREE.Group()
      const body = box(0.08, 0.22, 0.08, BLOCK_COLORS.carrot, 0.03)
      const leaf = box(0.05, 0.09, 0.05, BLOCK_COLORS.carrotLeaf, 0.02)
      leaf.position.y = 0.15
      carrot.add(body, leaf)
      carrot.rotation.z = 0.4
      return carrot
    }

    if (item === Block.Cloud) {
      const puff = box(0.22, 0.15, 0.18, BLOCK_COLORS.cloud, 0.07)
      ;(puff.material as THREE.MeshLambertMaterial).emissive.setHex(BLOCK_COLORS.cloud)
      ;(puff.material as THREE.MeshLambertMaterial).emissiveIntensity = 0.35
      return puff
    }

    if (item === Block.Water) {
      // Bucket: a gray cup with blue water on top.
      const bucket = new THREE.Group()
      const body = box(0.17, 0.15, 0.17, BLOCK_COLORS.stone, 0.03)
      const water = box(0.13, 0.04, 0.13, BLOCK_COLORS.water, 0.015, 0.85)
      water.position.y = 0.08
      bucket.add(body, water)
      return bucket
    }

    // A regular block — a mini cube of its color.
    const def = blockDef(item)
    return box(0.16, 0.16, 0.16, def.topColor ?? def.color, 0.025, def.opacity ?? 1)
  }

  /** Forward item bump — placement feedback. */
  placeBump(): void {
    this.placeBumpAmount = 1
  }

  update(dt: number, time: number, walkSpeed: number, attacking: boolean, visible: boolean): void {
    this.group.visible = visible
    if (!visible) return

    // Pickaxe swing: starts and loops while LMB is held.
    if (this.swingPhase < 0 && attacking) this.swingPhase = 0
    if (this.swingPhase >= 0) {
      this.swingPhase += dt / 0.26
      if (this.swingPhase >= 1) this.swingPhase = attacking ? 0 : -1
    }
    const swing = this.swingPhase >= 0 ? Math.sin(this.swingPhase * Math.PI) : 0
    this.pickaxePivot.rotation.x = -0.5 - swing * 1.15
    this.pickaxePivot.position.z = -0.82 - swing * 0.12

    this.placeBumpAmount = Math.max(0, this.placeBumpAmount - dt * 5)
    const bump = Math.sin(this.placeBumpAmount * Math.PI) * 0.14

    // Walk bobbing plus gentle idle breathing.
    const walk = Math.min(1, walkSpeed / 4)
    const bobY = Math.abs(Math.sin(time * 7.5)) * 0.03 * walk + Math.sin(time * 1.8) * 0.006
    const bobX = Math.sin(time * 3.75) * 0.02 * walk

    this.group.position.set(bobX, bobY - 0.02, 0)
    this.itemPivot.position.z = -0.76 - bump
  }

  dispose(): void {
    this.group.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose()
        ;(node.material as THREE.Material).dispose()
      }
    })
  }
}
