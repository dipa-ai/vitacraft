import { describe, expect, it } from 'vitest'
import { AO_LEVELS } from '../config/palette'
import { Block } from './blocks'
import { meshChunk, type VoxelReader } from './mesher'

/** Reader over a set of occupied coordinates — handy for tiny scenes. */
function readerOf(cells: Record<string, Block>): VoxelReader {
  return (x, y, z) => cells[`${x},${y},${z}`] ?? Block.Air
}

/**
 * Minimum brightness among vertices of one orientation. Faces of different
 * directions must not be compared: their FACE_TINT differs and would mask AO.
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
  it('a lone block yields 6 faces: 24 vertices and 36 indices', () => {
    const result = meshChunk(0, 0, readerOf({ '3,10,4': Block.Stone }))
    expect(result.opaque).not.toBeNull()
    expect(result.opaque!.positions.length / 3).toBe(24)
    expect(result.opaque!.indices.length).toBe(36)
    expect(result.transparent).toBeNull()
  })

  it('an empty chunk yields no geometry at all', () => {
    const result = meshChunk(0, 0, readerOf({}))
    expect(result.opaque).toBeNull()
    expect(result.transparent).toBeNull()
  })

  it('culls the face between two adjacent opaque blocks', () => {
    const two = meshChunk(
      0,
      0,
      readerOf({ '3,10,4': Block.Stone, '4,10,4': Block.Stone }),
    )
    // 12 faces minus the two touching ones = 10 faces of 6 indices each.
    expect(two.opaque!.indices.length).toBe(10 * 6)
  })

  it('routes water and glass into the transparent pass, dirt into the opaque one', () => {
    const result = meshChunk(
      0,
      0,
      readerOf({ '3,10,4': Block.Dirt, '5,10,4': Block.Water, '7,10,4': Block.Glass }),
    )
    expect(result.opaque!.positions.length / 3).toBe(24)
    expect(result.transparent!.positions.length / 3).toBe(48)
  })

  it('culls interior faces between two water blocks', () => {
    const result = meshChunk(
      0,
      0,
      readerOf({ '3,10,4': Block.Water, '4,10,4': Block.Water }),
    )
    expect(result.transparent!.indices.length).toBe(10 * 6)
  })

  it('darkens the top face where a taller wall stands nearby', () => {
    // A lone block: nothing to occlude it, the top face is uniform.
    const lone = meshChunk(0, 0, readerOf({ '3,10,4': Block.Stone }))
    const loneTop = minBrightnessOfFace(lone.opaque!.colors, lone.opaque!.normals, 0, 1, 0)

    // Same block with a one-higher wall nearby — the top-face corner must darken.
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

  it('uses the darkest AO level in an inner corner', () => {
    // A block in a well corner: both sides and the corner occluded — AO level 0.
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
    // The dark-to-bright ratio must reach down to the lowest AO level.
    expect(darkest / brightest).toBeLessThan(AO_LEVELS[1])
  })

  it('writes RGBA: opaque blocks get alpha 1, water gets its opacity', () => {
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

  it('lowers the water surface when air is above', () => {
    const result = meshChunk(0, 0, readerOf({ '3,10,4': Block.Water }))
    const positions = result.transparent!.positions
    let maxY = -Infinity
    for (let i = 1; i < positions.length; i += 3) {
      maxY = Math.max(maxY, positions[i])
    }
    // Water top sits below a full block — visibly a surface, not a cube.
    expect(maxY).toBeLessThan(11)
    expect(maxY).toBeGreaterThan(10.5)
  })

  it('vertex coordinates are chunk-local, not world', () => {
    // The same block in chunk (2,3) must yield the same local positions.
    const result = meshChunk(2, 3, readerOf({ '35,10,52': Block.Stone }))
    const positions = result.opaque!.positions
    let maxX = -Infinity
    for (let i = 0; i < positions.length; i += 3) {
      maxX = Math.max(maxX, positions[i])
    }
    expect(maxX).toBeLessThanOrEqual(16)
  })
})
