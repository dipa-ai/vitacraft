import { describe, expect, it } from 'vitest'
import { parseSaveData, restoreInventory } from './save'
import { Block } from './world/blocks'

function validSave(): Record<string, unknown> {
  return {
    version: 2,
    seed: 1337,
    edits: { '1,2,3': Block.Pink },
    player: { x: 1.5, y: 31, z: -2.5, yaw: 0.4, pitch: -0.2, health: 8 },
    inventory: { [Block.Pink]: 12, [Block.BedHead]: 3 },
    dayTime: 42,
    stage: 'village',
    beds: [[1, 2, 3]],
    quest: { stage: 1, animals: 0, night: false, clouds: 0 },
  }
}

describe('save parsing', () => {
  it('accepts and sanitizes a valid v2 save', () => {
    expect(parseSaveData(validSave())).toEqual(validSave())
  })

  it('rejects structurally incomplete or invalid saves', () => {
    expect(parseSaveData({ version: 2 })).toBeNull()
    expect(parseSaveData({ ...validSave(), edits: { '1,999,3': Block.Pink } })).toBeNull()
    expect(parseSaveData({ ...validSave(), inventory: { [Block.Pink]: -1 } })).toBeNull()
    expect(parseSaveData({ ...validSave(), stage: 'unknown' })).toBeNull()
  })

  it('migrates a valid v1 save without trusting missing quest data', () => {
    const legacy: Record<string, unknown> = { ...validSave(), version: 1, stage: 'won' }
    delete legacy.quest

    expect(parseSaveData(legacy)?.quest).toEqual({
      stage: 5,
      animals: 0,
      night: false,
      clouds: 0,
    })
  })

  it('replaces starting inventory even when a saved slot is absent', () => {
    const inventory = new Map<Block, number>([
      [Block.BedHead, 8],
      [Block.Pink, 96],
    ])

    restoreInventory(inventory, { [Block.Pink]: 4 })

    expect(inventory.get(Block.BedHead)).toBe(0)
    expect(inventory.get(Block.Pink)).toBe(4)
  })
})
