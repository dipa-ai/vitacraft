import { describe, expect, it } from 'vitest'
import { Block } from './blocks'
import type { VoxelReader } from './mesher'
import { raycastVoxels } from './raycast'

function readerOf(cells: Record<string, Block>): VoxelReader {
  return (x, y, z) => cells[`${x},${y},${z}`] ?? Block.Air
}

describe('raycastVoxels', () => {
  it('находит ближайший блок, а не первый попавшийся на луче', () => {
    const reader = readerOf({ '5,0,0': Block.Stone, '8,0,0': Block.Dirt })
    const hit = raycastVoxels(reader, 0.5, 0.5, 0.5, 1, 0, 0, 20)

    expect(hit).not.toBeNull()
    expect(hit!.x).toBe(5)
    expect(hit!.id).toBe(Block.Stone)
  })

  it('возвращает нормаль грани, в которую вошёл луч', () => {
    const reader = readerOf({ '5,0,0': Block.Stone })
    // Летим по +X, значит попадаем в грань, смотрящую в -X.
    const fromWest = raycastVoxels(reader, 0.5, 0.5, 0.5, 1, 0, 0, 20)
    expect([fromWest!.nx, fromWest!.ny, fromWest!.nz]).toEqual([-1, 0, 0])

    // Сверху вниз — попадаем в верхнюю грань.
    const fromAbove = raycastVoxels(reader, 5.5, 9, 0.5, 0, -1, 0, 20)
    expect([fromAbove!.nx, fromAbove!.ny, fromAbove!.nz]).toEqual([0, 1, 0])

    // И с востока — в грань, смотрящую в +X.
    const fromEast = raycastVoxels(reader, 12.5, 0.5, 0.5, -1, 0, 0, 20)
    expect([fromEast!.nx, fromEast!.ny, fromEast!.nz]).toEqual([1, 0, 0])
  })

  it('нормаль указывает на пустую клетку, куда встанет новый блок', () => {
    const reader = readerOf({ '5,0,0': Block.Stone })
    const hit = raycastVoxels(reader, 0.5, 0.5, 0.5, 1, 0, 0, 20)!
    // Установка идёт по нормали от найденного блока — там должно быть пусто.
    expect(reader(hit.x + hit.nx, hit.y + hit.ny, hit.z + hit.nz)).toBe(Block.Air)
  })

  it('промахивается в пустоте', () => {
    expect(raycastVoxels(readerOf({}), 0.5, 0.5, 0.5, 1, 0, 0, 50)).toBeNull()
  })

  it('не достаёт дальше заданной дистанции', () => {
    const reader = readerOf({ '10,0,0': Block.Stone })
    expect(raycastVoxels(reader, 0.5, 0.5, 0.5, 1, 0, 0, 5)).toBeNull()
    expect(raycastVoxels(reader, 0.5, 0.5, 0.5, 1, 0, 0, 20)).not.toBeNull()
  })

  it('считает дистанцию в блоках и даёт точку попадания на грани', () => {
    const reader = readerOf({ '5,0,0': Block.Stone })
    const hit = raycastVoxels(reader, 0.5, 0.5, 0.5, 1, 0, 0, 20)!
    // От x=0.5 до грани x=5 ровно 4.5.
    expect(hit.distance).toBeCloseTo(4.5, 6)
    expect(hit.px).toBeCloseTo(5, 6)
  })

  it('работает на диагональном луче', () => {
    const reader = readerOf({ '4,4,0': Block.Stone })
    const s = Math.SQRT1_2
    const hit = raycastVoxels(reader, 0.5, 0.5, 0.5, s, s, 0, 30)
    expect(hit).not.toBeNull()
    expect(hit!.x).toBe(4)
    expect(hit!.y).toBe(4)
  })

  it('пропускает блоки, отсеянные фильтром цели', () => {
    const reader = readerOf({ '3,0,0': Block.Water, '7,0,0': Block.Stone })
    const throughWater = raycastVoxels(
      reader,
      0.5,
      0.5,
      0.5,
      1,
      0,
      0,
      20,
      (id) => id !== Block.Air && id !== Block.Water,
    )
    // Луч должен пройти воду насквозь и упереться в камень.
    expect(throughWater!.x).toBe(7)
    expect(throughWater!.id).toBe(Block.Stone)

    // А фильтр по умолчанию остановится уже на воде.
    expect(raycastVoxels(reader, 0.5, 0.5, 0.5, 1, 0, 0, 20)!.x).toBe(3)
  })

  it('луч из блока сразу попадает в него и не даёт нормали для установки', () => {
    const reader = readerOf({ '0,0,0': Block.Stone })
    const hit = raycastVoxels(reader, 0.5, 0.5, 0.5, 1, 0, 0, 20)!
    expect(hit.distance).toBe(0)
    // Нулевая нормаль — сигнал вызывающему, что грани для установки нет.
    expect([hit.nx, hit.ny, hit.nz]).toEqual([0, 0, 0])
  })

  it('одинаково работает на отрицательных координатах', () => {
    const reader = readerOf({ '-5,-3,-2': Block.Stone })
    const hit = raycastVoxels(reader, -0.5, -2.5, -1.5, -1, 0, 0, 20)
    expect(hit).not.toBeNull()
    expect(hit!.x).toBe(-5)
    expect(hit!.y).toBe(-3)
  })
})
