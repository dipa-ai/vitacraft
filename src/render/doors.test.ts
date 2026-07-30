import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { Block } from '../world/blocks'
import type { World } from '../world/world'
import { DoorVisuals } from './doors'

function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}

describe('DoorVisuals', () => {
  it('reorients an existing door when neighboring walls are added', () => {
    const cells = new Map<string, Block>([
      [key(0, 0, 0), Block.DoorClosed],
      [key(0, 1, 0), Block.DoorClosed],
    ])
    const world = {
      edits: new Map<string, Block>(),
      getVoxel: (x: number, y: number, z: number) => cells.get(key(x, y, z)) ?? Block.Air,
    } as unknown as World
    const scene = new THREE.Scene()
    const doors = new DoorVisuals(scene, world)

    doors.onBlockChanged(0, 0, 0)
    const root = scene.getObjectByName('doors') as THREE.Group
    expect(root.children).toHaveLength(1)
    expect(root.children[0].rotation.y).toBeCloseTo(Math.PI / 2)

    cells.set(key(-1, 0, 0), Block.Stone)
    doors.onBlockChanged(-1, 0, 0)

    expect(root.children).toHaveLength(1)
    expect(root.children[0].rotation.y).toBeCloseTo(0)
  })
})
