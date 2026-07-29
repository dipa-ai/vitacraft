import { describe, expect, it } from 'vitest'
import { VILLAGE } from '../config/tuning'
import { Block } from '../world/blocks'
import type { VoxelReader } from '../world/mesher'
import { validateRoom } from './houses'

/**
 * Строит полый ящик со стенами из указанного блока и кроваткой внутри.
 * Внутренний объём: (size-2)³ клеток.
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
  it('принимает замкнутую комнату с кроваткой', () => {
    const { reader, bed } = box(4)
    const result = validateRoom(reader, ...bed)

    expect(result.ok).toBe(true)
    expect(result.reason).toBeNull()
    // Внутренний объём ящика 4×4×4 — это 2×2×2 = 8 клеток.
    expect(result.volume).toBe(8)
  })

  it('отклоняет комнату без кроватки', () => {
    const { reader, bed } = box(5, Block.Pink, { bed: false })
    const result = validateRoom(reader, ...bed)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no-bed')
  })

  it('отклоняет дырку в крыше', () => {
    const { reader, bed } = box(5, Block.Pink, { holeAt: [2, 4, 2] })
    const result = validateRoom(reader, ...bed)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('leaks')
  })

  it('отклоняет дырку в стене', () => {
    const { reader, bed } = box(5, Block.Pink, { holeAt: [0, 2, 2] })
    const result = validateRoom(reader, ...bed)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('leaks')
  })

  it('отклоняет дырку в полу', () => {
    const { reader, bed } = box(5, Block.Pink, { holeAt: [2, 0, 2] })
    const result = validateRoom(reader, ...bed)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('leaks')
  })

  it('пропускает окна из стекла: стекло считается стеной', () => {
    // Ящик целиком из стекла — это оранжерея, но всё же герметичный дом.
    const { reader, bed } = box(4, Block.Glass)
    const result = validateRoom(reader, ...bed)

    expect(result.ok).toBe(true)
  })

  it('не считает стеной воду', () => {
    const { reader, bed } = box(5, Block.Water)
    const result = validateRoom(reader, ...bed)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('leaks')
  })

  it('отклоняет слишком тесную комнату', () => {
    // Ящик 3×3×3 даёт всего одну внутреннюю клетку.
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

  it('отклоняет кроватку в чистом поле', () => {
    const reader: VoxelReader = (x, y, z) =>
      y === 0 ? Block.Grass : x === 5 && y === 1 && z === 5 ? Block.Bed : Block.Air

    const result = validateRoom(reader, 5, 1, 5)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('leaks')
  })

  it('отклоняет комнату с открытым проёмом-дверью', () => {
    // Проём в два блока высотой — именно то, что игрок сделал бы дверью.
    const { reader, bed } = box(5, Block.Pink, { holeAt: [0, 1, 2] })
    const result = validateRoom(reader, ...bed)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('leaks')
  })

  it('отклоняет пещеру больше лимита, даже если она замкнута', () => {
    // Огромная полость: считать её домом нельзя, и именно лимит это ловит.
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

    // Внутри 10³ = 1000 клеток, лимит меньше.
    expect(VILLAGE.floodFillBudget).toBeLessThan(1000)
    const result = validateRoom(reader, 1, 1, 1)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('leaks')
  })

  it('возвращает клетки комнаты, чтобы было куда поселить смурфика', () => {
    const { reader, bed } = box(5)
    const result = validateRoom(reader, ...bed)

    expect(result.cells).toHaveLength(result.volume)
    // Все клетки внутри оболочки, ни одна не в стене.
    for (const cell of result.cells) {
      expect(cell.x).toBeGreaterThan(0)
      expect(cell.x).toBeLessThan(4)
      expect(cell.y).toBeGreaterThan(0)
      expect(cell.y).toBeLessThan(4)
    }
  })
})
