import { describe, expect, it } from 'vitest'
import { clampPitch, resolveTouchStick } from './controls'

describe('touch controls', () => {
  it('keeps the stick centered inside its dead zone', () => {
    expect(resolveTouchStick(2, -2, 50)).toEqual({
      forward: 0,
      right: 0,
      run: false,
      visualX: 0,
      visualY: 0,
    })
  })

  it('normalizes diagonal movement and enables running at the rim', () => {
    const input = resolveTouchStick(100, -100, 50)

    expect(input.right).toBeCloseTo(Math.SQRT1_2)
    expect(input.forward).toBeCloseTo(Math.SQRT1_2)
    expect(input.run).toBe(true)
    expect(Math.hypot(input.visualX, input.visualY)).toBeCloseTo(1)
  })

  it('keeps partial stick movement below running speed', () => {
    const input = resolveTouchStick(20, 0, 50)

    expect(input.right).toBeCloseTo(0.4)
    expect(input.forward).toBeCloseTo(0)
    expect(input.run).toBe(false)
  })

  it('prevents touch look from flipping the camera', () => {
    const limit = Math.PI / 2 - 0.01

    expect(clampPitch(10)).toBe(limit)
    expect(clampPitch(-10)).toBe(-limit)
    expect(clampPitch(0.4)).toBe(0.4)
  })
})
