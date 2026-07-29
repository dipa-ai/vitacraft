import { PLAYER } from '../config/tuning'
import { ALL_BLOCKS, type Block, blockDef } from '../world/blocks'

/** Работа с DOM-оверлеем: сердечки, хотбар, задания, реплики и полноэкранные карточки. */
export class Hud {
  private readonly heartsEl = requireEl('hearts')
  private readonly hotbarEl = requireEl('hotbar')
  private readonly crosshairEl = requireEl('crosshair')
  private readonly questEl = requireEl('quest')
  private readonly questGoalEl = requireEl('quest').querySelector<HTMLElement>('.goal')!
  private readonly questFillEl = requireEl('quest').querySelector<HTMLElement>('.fill')!
  private readonly bossEl = requireEl('bossbar')
  private readonly bossPhaseEl = requireEl('bossbar').querySelector<HTMLElement>('.phase')!
  private readonly bossFillEl = requireEl('bossbar').querySelector<HTMLElement>('.fill')!
  private readonly toastsEl = requireEl('toasts')
  private readonly overlayEl = requireEl('overlay')
  private readonly overlayCardEl = requireEl('overlay-card')
  private readonly vignetteEl = requireEl('vignette')
  private readonly resourcesEl = requireEl('resources')

  private heartEls: HTMLElement[] = []
  private slotEls: HTMLElement[] = []
  private lastHealth: number = PLAYER.maxHealth
  /** Реплики, показанные однажды: подсказки не должны повторяться при каждой ошибке. */
  private readonly shownOnce = new Set<string>()

  constructor() {
    this.buildHearts()
    this.buildResources()
  }

  /** Панель ресурсов (Tab): собирается из описаний в реестре блоков. */
  private buildResources(): void {
    const list = this.resourcesEl.querySelector<HTMLElement>('.list')!
    list.textContent = ''
    for (const def of ALL_BLOCKS) {
      if (def.description === undefined) continue
      const row = document.createElement('div')
      row.className = 'res-row'

      const swatch = document.createElement('div')
      swatch.className = 'swatch'
      swatch.style.background = `#${(def.topColor ?? def.color).toString(16).padStart(6, '0')}`

      const name = document.createElement('div')
      name.className = 'name'
      name.textContent = def.name

      const info = document.createElement('div')
      info.className = 'info'
      info.textContent = def.description
      if (def.source !== undefined) {
        const source = document.createElement('span')
        source.className = 'src'
        source.textContent = def.source
        info.append(source)
      }

      row.append(swatch, name, info)
      list.append(row)
    }
  }

  toggleResources(): boolean {
    const visible = this.resourcesEl.classList.toggle('show')
    return visible
  }

  hideResources(): void {
    this.resourcesEl.classList.remove('show')
  }

  private buildHearts(): void {
    this.heartsEl.textContent = ''
    this.heartEls = []
    for (let i = 0; i < PLAYER.maxHealth; i++) {
      const heart = document.createElement('div')
      heart.className = 'heart'
      this.heartsEl.append(heart)
      this.heartEls.push(heart)
    }
  }

  /** Строит слоты хотбара один раз; дальше меняются только количества и подсветка. */
  buildHotbar(blocks: readonly Block[]): void {
    this.hotbarEl.textContent = ''
    this.slotEls = []
    blocks.forEach((block, index) => {
      const def = blockDef(block)
      const slot = document.createElement('div')
      slot.className = 'slot'
      slot.title = def.description !== undefined ? `${def.name} — ${def.description}` : def.name

      const key = document.createElement('span')
      key.className = 'key'
      // Цифрами выбираются только первые девять слотов; дальше — колесом.
      key.textContent = index < 9 ? String(index + 1) : ''

      const swatch = document.createElement('div')
      swatch.className = 'swatch'
      swatch.style.background = `#${(def.topColor ?? def.color).toString(16).padStart(6, '0')}`

      const count = document.createElement('span')
      count.className = 'count'

      slot.append(key, swatch, count)
      this.hotbarEl.append(slot)
      this.slotEls.push(slot)
    })
  }

  setHotbar(activeIndex: number, counts: readonly number[]): void {
    this.slotEls.forEach((slot, index) => {
      slot.classList.toggle('active', index === activeIndex)
      const count = slot.querySelector<HTMLElement>('.count')
      if (count !== null) {
        const value = counts[index] ?? 0
        count.textContent = value > 0 ? String(value) : ''
        slot.style.opacity = value > 0 ? '1' : '0.4'
      }
    })
  }

  setHealth(health: number): void {
    this.heartEls.forEach((heart, index) => {
      heart.classList.toggle('empty', index >= health)
    })
    // Пульс только при потере здоровья — иначе сердечки дёргаются без причины.
    if (health < this.lastHealth) {
      const lost = this.heartEls[Math.max(0, health)]
      lost?.classList.add('pulse')
      window.setTimeout(() => lost?.classList.remove('pulse'), 150)
      this.vignetteEl.style.opacity = '1'
      window.setTimeout(() => (this.vignetteEl.style.opacity = '0'), 160)
    }
    this.lastHealth = health
  }

  /** Прицел раздувается, когда под ним есть цель — понятно, докуда дотягивается рука. */
  setCrosshairActive(active: boolean): void {
    this.crosshairEl.classList.toggle('hit', active)
  }

  setQuest(goal: string, done: number, total: number): void {
    this.questEl.classList.add('show')
    this.questGoalEl.textContent = goal
    this.questFillEl.style.width = `${total === 0 ? 0 : (done / total) * 100}%`
  }

  hideQuest(): void {
    this.questEl.classList.remove('show')
  }

  setBoss(visible: boolean, healthFraction = 1, phase = 1): void {
    this.bossEl.classList.toggle('show', visible)
    this.bossFillEl.style.width = `${Math.max(0, healthFraction) * 100}%`
    this.bossPhaseEl.textContent = `Фаза ${phase}`
  }

  /** Короткая реплика внизу экрана. */
  toast(text: string, durationMs = 3200): void {
    const el = document.createElement('div')
    el.className = 'toast'
    el.textContent = text
    this.toastsEl.append(el)
    window.setTimeout(() => {
      el.classList.add('leaving')
      window.setTimeout(() => el.remove(), 400)
    }, durationMs)
  }

  /** Реплика, которая показывается только в первый раз — для подсказок. */
  toastOnce(id: string, text: string, durationMs = 4200): void {
    if (this.shownOnce.has(id)) return
    this.shownOnce.add(id)
    this.toast(text, durationMs)
  }

  /**
   * Полноэкранная карточка. Возвращает кнопки в том же порядке, что и подписи, — что делать
   * по нажатию, решает вызывающий.
   */
  showCard(html: string, buttonLabels: readonly string[]): HTMLButtonElement[] {
    this.overlayCardEl.innerHTML = html
    const row = document.createElement('div')
    row.style.display = 'flex'
    row.style.gap = '12px'
    row.style.justifyContent = 'center'
    row.style.flexWrap = 'wrap'

    const buttons = buttonLabels.map((label, index) => {
      const button = document.createElement('button')
      button.className = 'btn'
      button.textContent = label
      // Второстепенные действия делаем визуально тише, чтобы главное читалось сразу.
      if (index > 0) {
        button.style.background = '#fff'
        button.style.color = 'var(--ink)'
        button.style.boxShadow = '0 5px 0 rgba(74, 63, 85, 0.2)'
        button.style.fontSize = '16px'
      }
      row.append(button)
      return button
    })

    this.overlayCardEl.append(row)
    this.overlayEl.classList.remove('hidden')
    return buttons
  }

  hideCard(): void {
    this.overlayEl.classList.add('hidden')
  }

  get cardVisible(): boolean {
    return !this.overlayEl.classList.contains('hidden')
  }
}

function requireEl(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (el === null) throw new Error(`В разметке нет элемента #${id}`)
  return el
}
