import { describe, expect, it } from 'vitest'
import { AO_LEVELS } from '../config/palette'
import { Block } from './blocks'
import { meshChunk, type VoxelReader } from './mesher'

/** Читалка по набору занятых координат — удобно описывать крошечные сцены. */
function readerOf(cells: Record<string, Block>): VoxelReader {
  return (x, y, z) => cells[`${x},${y},${z}`] ?? Block.Air
}

/**
 * Минимальная яркость среди вершин одной ориентации. Сравнивать грани разных
 * направлений нельзя: у них разный FACE_TINT, и он замаскирует эффект AO.
 */
function minBrightnessOfFace(
  colors: Float32Array,
  normals: Float32Array,
  nx: number,
  ny: number,
  nz: number,
): number {
  let min = Infinity
  for (let v = 0; v < normals.length / 3; v++) {
    if (normals[v * 3] !== nx || normals[v * 3 + 1] !== ny || normals[v * 3 + 2] !== nz) continue
    min = Math.min(min, colors[v * 4] + colors[v * 4 + 1] + colors[v * 4 + 2])
  }
  return min
}

describe('meshChunk', () => {
  it('одиночный блок даёт 6 граней: 24 вершины и 36 индексов', () => {
    const result = meshChunk(0, 0, readerOf({ '3,10,4': Block.Stone }))
    expect(result.opaque).not.toBeNull()
    expect(result.opaque!.positions.length / 3).toBe(24)
    expect(result.opaque!.indices.length).toBe(36)
    expect(result.transparent).toBeNull()
  })

  it('пустой чанк не даёт геометрии вообще', () => {
    const result = meshChunk(0, 0, readerOf({}))
    expect(result.opaque).toBeNull()
    expect(result.transparent).toBeNull()
  })

  it('гасит грань между двумя соседними непрозрачными блоками', () => {
    const two = meshChunk(
      0,
      0,
      readerOf({ '3,10,4': Block.Stone, '4,10,4': Block.Stone }),
    )
    // 12 граней минус две соприкасающиеся = 10 граней по 6 индексов.
    expect(two.opaque!.indices.length).toBe(10 * 6)
  })

  it('раскладывает воду и стекло в прозрачный проход, а землю — в непрозрачный', () => {
    const result = meshChunk(
      0,
      0,
      readerOf({ '3,10,4': Block.Dirt, '5,10,4': Block.Water, '7,10,4': Block.Glass }),
    )
    expect(result.opaque!.positions.length / 3).toBe(24)
    expect(result.transparent!.positions.length / 3).toBe(48)
  })

  it('гасит внутренние грани между двумя блоками воды', () => {
    const result = meshChunk(
      0,
      0,
      readerOf({ '3,10,4': Block.Water, '4,10,4': Block.Water }),
    )
    expect(result.transparent!.indices.length).toBe(10 * 6)
  })

  it('затеняет верхнюю грань там, где рядом стоит стенка выше', () => {
    // Одинокий блок: затенять нечем, верхняя грань ровная.
    const lone = meshChunk(0, 0, readerOf({ '3,10,4': Block.Stone }))
    const loneTop = minBrightnessOfFace(lone.opaque!.colors, lone.opaque!.normals, 0, 1, 0)

    // Тот же блок, но рядом стенка на блок выше — угол верхней грани должен потемнеть.
    const shaded = meshChunk(
      0,
      0,
      readerOf({
        '3,10,4': Block.Stone,
        '4,10,4': Block.Stone,
        '4,11,4': Block.Stone,
      }),
    )
    const shadedTop = minBrightnessOfFace(
      shaded.opaque!.colors,
      shaded.opaque!.normals,
      0,
      1,
      0,
    )
    expect(shadedTop).toBeLessThan(loneTop * 0.95)
  })

  it('во внутреннем углу использует самый тёмный уровень AO', () => {
    // Блок в углу колодца: два бока и угол перекрыты — это уровень AO 0.
    const result = meshChunk(
      0,
      0,
      readerOf({
        '3,10,4': Block.Stone,
        '4,11,4': Block.Stone,
        '3,11,5': Block.Stone,
        '4,11,5': Block.Stone,
      }),
    )
    const colors = result.opaque!.colors
    let darkest = Infinity
    let brightest = 0
    for (let i = 0; i < colors.length; i += 4) {
      const sum = colors[i] + colors[i + 1] + colors[i + 2]
      darkest = Math.min(darkest, sum)
      brightest = Math.max(brightest, sum)
    }
    // Отношение тёмного к светлому должно дотягиваться до нижнего уровня AO.
    expect(darkest / brightest).toBeLessThan(AO_LEVELS[1])
  })

  it('пишет RGBA: у непрозрачных блоков альфа 1, у воды — её прозрачность', () => {
    const result = meshChunk(
      0,
      0,
      readerOf({ '3,10,4': Block.Stone, '6,10,4': Block.Water }),
    )
    const opaqueColors = result.opaque!.colors
    expect(opaqueColors.length % 4).toBe(0)
    for (let i = 3; i < opaqueColors.length; i += 4) {
      expect(opaqueColors[i]).toBe(1)
    }
    const waterColors = result.transparent!.colors
    for (let i = 3; i < waterColors.length; i += 4) {
      expect(waterColors[i]).toBeLessThan(1)
    }
  })

  it('опускает поверхность воды, если сверху воздух', () => {
    const result = meshChunk(0, 0, readerOf({ '3,10,4': Block.Water }))
    const positions = result.transparent!.positions
    let maxY = -Infinity
    for (let i = 1; i < positions.length; i += 3) {
      maxY = Math.max(maxY, positions[i])
    }
    // Верх воды ниже целого блока — так видно, что это поверхность, а не куб.
    expect(maxY).toBeLessThan(11)
    expect(maxY).toBeGreaterThan(10.5)
  })

  it('координаты вершин локальны для чанка, а не мировые', () => {
    // Тот же блок в чанке (2,3) должен дать те же локальные позиции.
    const result = meshChunk(2, 3, readerOf({ '35,10,52': Block.Stone }))
    const positions = result.opaque!.positions
    let maxX = -Infinity
    for (let i = 0; i < positions.length; i += 3) {
      maxX = Math.max(maxX, positions[i])
    }
    expect(maxX).toBeLessThanOrEqual(16)
  })
})
