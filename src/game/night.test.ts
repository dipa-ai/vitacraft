import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { Fx } from '../render/fx'
import type { World } from '../world/world'
import { NightManager } from './night'

function manager(): NightManager {
  return new NightManager({} as World, new THREE.Scene(), {} as Fx)
}

describe('NightManager restoration', () => {
  it('does not award a whole night after loading shortly before dawn', () => {
    const night = manager()
    const onDawn = vi.fn()
    night.onDawn = onDawn

    night.restoreAtTime(0.7)
    night.update(0, 0, 0.05, new THREE.Vector3(), [])

    expect(onDawn).toHaveBeenCalledWith(false)
  })

  it('still awards a night entered normally at dusk', () => {
    const night = manager()
    const onDawn = vi.fn()
    night.onDawn = onDawn

    night.update(0, 0, 0.7, new THREE.Vector3(), [])
    night.update(0, 0, 0.05, new THREE.Vector3(), [])

    expect(onDawn).toHaveBeenCalledWith(true)
  })
})
