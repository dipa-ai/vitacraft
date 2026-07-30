import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { World } from '../world/world'
import { Block } from '../world/blocks'
import { Lurker } from './lurker'

const emptyWorld = {
  getVoxel: () => Block.Air,
  isSolidAt: () => false,
} as unknown as World

describe('Lurker contact damage', () => {
  it('does not bite a player on a different vertical level', () => {
    const lurker = new Lurker(new THREE.Vector3(0, 0, 0))

    expect(lurker.update(0, emptyWorld, 0, new THREE.Vector3(0, 3, 0), true)).toBe(false)
    lurker.dispose()
  })

  it('still bites an overlapping player', () => {
    const lurker = new Lurker(new THREE.Vector3(0, 0, 0))

    expect(lurker.update(0, emptyWorld, 0, new THREE.Vector3(0, 0, 0), true)).toBe(true)
    lurker.dispose()
  })
})
