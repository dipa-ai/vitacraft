export type DamageSource = 'boss' | 'night-creature'

const BOSS_DEATH_CARD = `
  <h1>Ой…</h1>
  <p>Витрулян оказался быстрее. Деревня цела — она тебя дождётся.</p>
  <p>Подсказка: от ударной волны спасает <b>прыжок</b> в момент, когда она до тебя доходит.</p>
`

const NIGHT_CREATURE_DEATH_CARD = `
  <h1>Ой…</h1>
  <p>Ночной чубрик оказался проворнее. Деревня цела — она тебя дождётся.</p>
  <p>Подсказка: держись ближе к свету и не давай тёмным зверюшкам окружить тебя.</p>
`

export function deathCard(source: DamageSource): string {
  return source === 'boss' ? BOSS_DEATH_CARD : NIGHT_CREATURE_DEATH_CARD
}
