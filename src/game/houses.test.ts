import { describe, expect, it } from 'vitest'
import { VILLAGE } from '../config/tuning'
import { Block } from '../world/blocks'
import type { VoxelReader } from '../world/mesher'
import { validateRoom } from './houses'

/**
 * Builds a hollow box with walls of the given block and a bed inside.
 * Interior volume: (size-2)³ cells.
 */
function box(
  size: number,
  wall: Block = Block.Pink,
  options: { bed?: boolean; holeAt?: [number, number, number] } = {},
): { reader: VoxelReader; bed: [number, number, number] } {
  const cells = new Map<string, Block>()
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        const onShell =
          x === 0 || y === 0 || z === 0 || x === size - 1 || y === size - 1 || z === size - 1
        if (onShell) cells.set(`${x},${y},${z}`, wall)
      }
    }
  }

  if (options.holeAt !== undefined) {
    const [hx, hy, hz] = options.holeAt
    cells.delete(`${hx},${hy},${hz}`)
  }

  const bed: [number, number, number] = [1, 1, 1]
  if (options.bed !== false) cells.set(`${bed[0]},${bed[1]},${bed[2]}`, Block.Bed)

  return {
    reader: (x, y, z) => cells.get(`${x},${y},${z}`) ?? Block.Air,
    bed,
  }
}

describe('validateRoom', () => {
  it('accepts a sealed room with a bed', () => {
    const { reader, bed } = box(4)
    const result = validateRoom(reader, ...bed)

    expect(result.ok).toBe(true)
    expect(result.reason).toBeNull()
    // A 4×4×4 box interior is 2×2×2 = 8 cells.
    expect(result.volume).toBe(8)
  })

  it('rejects a room without a bed', () => {
    const { reader, bed } = box(5, Block.Pink, { bed: false })
    const result = validateRoom(reader, ...bed)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no-bed')
  })

  it('rejects a hole in the roof', () => {
    const { reader, bed } = box(5, Block.Pink, { holeAt: [2, 4, 2] })
    const result = validateRoom(reader, ...bed)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('leaks')
  })

  it('rejects a hole in a wall', () => {
    const { reader, bed } = box(5, Block.Pink, { holeAt: [0, 2, 2] })
    const result = validateRoom(reader, ...bed)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('leaks')
  })

  it('rejects a hole in the floor', () => {
    const { reader, bed } = box(5, Block.Pink, { holeAt: [2, 0, 2] })
    const result = validateRoom(reader, ...bed)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('leaks')
  })

  it('allows glass windows: glass counts as a wall', () => {
    // A box entirely of glass is a greenhouse — yet still a sealed house.
    const { reader, bed } = box(4, Block.Glass)
    const result = validateRoom(reader, ...bed)

    expect(result.ok).toBe(true)
  })

  it('does not count water as a wall', () => {
    const { reader, bed } = box(5, Block.Water)
    const result = validateRoom(reader, ...bed)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('leaks')
  })

  it('rejects a room that is too cramped', () => {
    // A 3×3×3 box yields just one interior cell.
    const cells = new Map<string, Block>()
    for (let x = 0; x < 3; x++) {
      for (let y = 0; y < 3; y++) {
        for (let z = 0; z < 3; z++) {
          const onShell = x === 0 || y === 0 || z === 0 || x === 2 || y === 2 || z === 2
          if (onShell) cells.set(`${x},${y},${z}`, Block.Pink)
        }
      }
    }
    cells.set('1,1,1', Block.Bed)
    const reader: VoxelReader = (x, y, z) => cells.get(`${x},${y},${z}`) ?? Block.Air

    const result = validateRoom(reader, 1, 1, 1)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('too-small')
  })

  it('rejects a bed in an open field', () => {
    const reader: VoxelReader = (x, y, z) =>
      y === 0 ? Block.Grass : x === 5 && y === 1 && z === 5 ? Block.Bed : Block.Air

    const result = validateRoom(reader, 5, 1, 5)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('leaks')
  })

  it('rejects a room with an open doorway gap', () => {
    // A two-block-tall gap — exactly what a player would use as a door.
    const { reader, bed } = box(5, Block.Pink, { holeAt: [0, 1, 2] })
    const result = validateRoom(reader, ...bed)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('leaks')
  })

  it('rejects a cave beyond the budget even if sealed', () => {
    // A huge cavity: it must not count as a house, and the budget catches that.
    const size = 12
    const cells = new Map<string, Block>()
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        for (let z = 0; z < size; z++) {
          const onShell =
            x === 0 || y === 0 || z === 0 || x === size - 1 || y === size - 1 || z === size - 1
          if (onShell) cells.set(`${x},${y},${z}`, Block.Stone)
        }
      }
    }
    cells.set('1,1,1', Block.Bed)
    const reader: VoxelReader = (x, y, z) => cells.get(`${x},${y},${z}`) ?? Block.Air

    // 10³ = 1000 cells inside; the budget is smaller.
    expect(VILLAGE.floodFillBudget).toBeLessThan(1000)
    const result = validateRoom(reader, 1, 1, 1)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('leaks')
  })

  it('a room with a closed door is a sealed house', () => {
    const { reader: base, bed } = box(5)
    // A door in the wall: two vertical cells.
    const withDoor: VoxelReader = (x, y, z) => {
      if (x === 0 && z === 2 && (y === 1 || y === 2)) return Block.DoorClosed
      return base(x, y, z)
    }
    const result = validateRoom(withDoor, ...bed)
    expect(result.ok).toBe(true)
  })

  it('an open door still seals: the smurf can leave and the house stays a house', () => {
    const { reader: base, bed } = box(5)
    const withDoor: VoxelReader = (x, y, z) => {
      if (x === 0 && z === 2 && (y === 1 || y === 2)) return Block.DoorOpen
      return base(x, y, z)
    }
    const result = validateRoom(withDoor, ...bed)
    expect(result.ok).toBe(true)
  })

  it('the two-block bed is recognized from either half', () => {
    const { reader: base } = box(5, Block.Pink, { bed: false })
    const withPair: VoxelReader = (x, y, z) => {
      if (x === 1 && y === 1 && z === 1) return Block.BedHead
      if (x === 2 && y === 1 && z === 1) return Block.BedFoot
      return base(x, y, z)
    }
    expect(validateRoom(withPair, 1, 1, 1).ok).toBe(true)
    expect(validateRoom(withPair, 2, 1, 1).ok).toBe(true)
  })

  it('returns room cells so there is somewhere to settle the smurf', () => {
    const { reader, bed } = box(5)
    const result = validateRoom(reader, ...bed)

    expect(result.cells).toHaveLength(result.volume)
    // All cells are inside the shell, none in a wall.
    for (const cell of result.cells) {
      expect(cell.x).toBeGreaterThan(0)
      expect(cell.x).toBeLessThan(4)
      expect(cell.y).toBeGreaterThan(0)
      expect(cell.y).toBeLessThan(4)
    }
  })
})
