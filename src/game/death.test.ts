import { describe, expect, it } from 'vitest'
import { deathCard } from './death'

describe('death card', () => {
  it('names Vitrulyan after boss damage', () => {
    expect(deathCard('boss')).toContain('Витрулян оказался быстрее')
  })

  it('names a night creature after its bite', () => {
    const card = deathCard('night-creature')

    expect(card).toContain('Ночной чубрик')
    expect(card).not.toContain('Витрулян оказался быстрее')
  })
})
