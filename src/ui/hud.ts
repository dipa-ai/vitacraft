import { PLAYER } from '../config/tuning'
import { ALL_BLOCKS, type Block, blockDef } from '../world/blocks'

/** DOM overlay: hearts, hotbar, quests, speech toasts and full-screen cards. */
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
  private readonly helpEl = requireEl('help')
  private readonly itemLabelEl = requireEl('itemlabel')
  private itemLabelTimer = 0

  private heartEls: HTMLElement[] = []
  private slotEls: HTMLElement[] = []
  private lastHealth: number = PLAYER.maxHealth
  /** Lines shown once: hints must not repeat on every mistake. */
  private readonly shownOnce = new Set<string>()

  constructor() {
    this.buildHearts()
    this.buildResources()
  }

  /** Resources panel (Tab): assembled from descriptions in the block registry. */
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
    if (visible) this.hideHelp()
    return visible
  }

  get resourcesOpen(): boolean {
    return this.resourcesEl.classList.contains('show')
  }

  /** Wheel-scrolls the resources panel: in pointer lock the scrollbar can't be grabbed. */
  scrollResources(delta: number): void {
    this.resourcesEl.scrollTop += delta
  }

  setHelpContent(html: string): void {
    this.helpEl.innerHTML = html
  }

  toggleHelp(): boolean {
    const visible = this.helpEl.classList.toggle('show')
    if (visible) this.hideResources()
    return visible
  }

  get helpOpen(): boolean {
    return this.helpEl.classList.contains('show')
  }

  scrollHelp(delta: number): void {
    this.helpEl.scrollTop += delta
  }

  hideHelp(): void {
    this.helpEl.classList.remove('show')
  }

  /**
   * Selected-item label above the hotbar. There is no cursor in pointer lock and
   * tooltips don't work — this is the only way to explain what is in hand.
   */
  showItemName(name: string, description?: string): void {
    this.itemLabelEl.textContent = name
    if (description !== undefined) {
      const desc = document.createElement('span')
      desc.className = 'desc'
      desc.textContent = description
      this.itemLabelEl.append(desc)
    }
    this.itemLabelEl.classList.add('show')
    window.clearTimeout(this.itemLabelTimer)
    this.itemLabelTimer = window.setTimeout(() => {
      this.itemLabelEl.classList.remove('show')
    }, 2600)
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

  /** Builds hotbar slots once; only counts and highlight change afterwards. */
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
      // Digits select only the first nine slots; the rest is wheel-only.
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
    // Pulse only on health loss — otherwise hearts twitch for no reason.
    if (health < this.lastHealth) {
      const lost = this.heartEls[Math.max(0, health)]
      lost?.classList.add('pulse')
      window.setTimeout(() => lost?.classList.remove('pulse'), 150)
      this.vignetteEl.style.opacity = '1'
      window.setTimeout(() => (this.vignetteEl.style.opacity = '0'), 160)
    }
    this.lastHealth = health
  }

  /** The crosshair inflates over a target — showing how far the arm reaches. */
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

  /** A short toast at the bottom of the screen. */
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

  /** A toast shown only the first time — for hints. */
  toastOnce(id: string, text: string, durationMs = 4200): void {
    if (this.shownOnce.has(id)) return
    this.shownOnce.add(id)
    this.toast(text, durationMs)
  }

  /**
   * Full-screen card. Returns buttons in label order — the caller decides what
   * each click does.
   */
  showCard(html: string, buttonLabels: readonly string[], variant?: string): HTMLButtonElement[] {
    this.hideResources()
    this.hideHelp()
    this.overlayCardEl.className = variant === undefined ? 'card' : `card ${variant}`
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
      // Secondary actions are visually quieter so the primary one reads instantly.
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
  if (el === null) throw new Error(`Missing element #${id} in the markup`)
  return el
}
