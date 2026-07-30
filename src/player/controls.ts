import { CAMERA } from '../config/tuning'
import type { MoveInput } from './player'
import type { Player } from './player'

export type CameraMode = 'first' | 'third'

export interface TouchStickVector {
  forward: number
  right: number
  run: boolean
  visualX: number
  visualY: number
}

interface WebkitFullscreenDocument extends Document {
  webkitExitFullscreen?: () => Promise<void> | void
  webkitFullscreenElement?: Element | null
}

interface WebkitFullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void
}

interface StandaloneNavigator extends Navigator {
  standalone?: boolean
}

/** Converts a touch offset into bounded movement and a normalized knob position. */
export function resolveTouchStick(dx: number, dy: number, radius: number): TouchStickVector {
  if (radius <= 0) {
    return { forward: 0, right: 0, run: false, visualX: 0, visualY: 0 }
  }

  const distance = Math.hypot(dx, dy)
  const scale = distance > radius ? radius / distance : 1
  const visualX = (dx * scale) / radius
  const visualY = (dy * scale) / radius
  const magnitude = Math.min(1, distance / radius)

  // A small dead zone keeps an untouched or slightly trembling thumb stationary.
  if (magnitude < 0.08) {
    return { forward: 0, right: 0, run: false, visualX: 0, visualY: 0 }
  }

  return {
    forward: -visualY,
    right: visualX,
    run: magnitude > 0.86,
    visualX,
    visualY,
  }
}

export function clampPitch(pitch: number): number {
  const limit = Math.PI / 2 - 0.01
  return Math.max(-limit, Math.min(limit, pitch))
}

/**
 * Input and pointer capture. Pointer lock stays on in both camera modes: switching
 * third person to drag-rotation makes desktop controls feel broken. Touch devices
 * skip pointer lock and use a left stick plus right-side drag look.
 */
export class Controls {
  readonly input: MoveInput = { forward: 0, right: 0, jump: false, run: false }
  readonly touchMode: boolean
  cameraMode: CameraMode = 'first'
  locked = false

  /** LMB held — the strike repeats on cooldown. */
  attackHeld = false

  onPlace: (() => void) | null = null
  onThrow: (() => void) | null = null
  onSelectSlot: ((index: number) => void) | null = null
  onCycleSlot: ((direction: number) => void) | null = null
  onCameraToggle: ((mode: CameraMode) => void) | null = null
  onUnlock: (() => void) | null = null
  onToggleResources: (() => void) | null = null
  onToggleHelp: (() => void) | null = null
  onPause: (() => void) | null = null
  onFullscreenUnavailable: (() => void) | null = null

  private readonly keys = new Set<string>()
  private touchPanelOpen = false
  private touchForward = 0
  private touchRight = 0
  private touchRun = false
  private touchJump = false
  private movePointerId: number | null = null
  private lookPointerId: number | null = null
  private attackPointerId: number | null = null
  private jumpPointerId: number | null = null
  private lookX = 0
  private lookY = 0
  private moveBaseEl: HTMLElement | null = null
  private moveKnobEl: HTMLElement | null = null
  private fullscreenButtonEl: HTMLButtonElement | null = null
  private readonly touchDisposers: (() => void)[] = []

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly player: Player,
    touchMode = false,
    private readonly fullscreenUnavailable = false,
  ) {
    this.touchMode = touchMode
    document.body.classList.toggle('touch-mode', touchMode)

    document.addEventListener('keydown', this.onKeyDown)
    document.addEventListener('keyup', this.onKeyUp)
    document.addEventListener('pointerlockchange', this.onLockChange)
    document.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('mousedown', this.onMouseDown)
    document.addEventListener('mouseup', this.onMouseUp)
    document.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('blur', this.onWindowBlur)
    // Otherwise RMB opens the context menu instead of placing a block.
    this.canvas.addEventListener('contextmenu', this.onContextMenu)

    if (this.touchMode) this.bindTouchControls()
  }

  requestLock(): void {
    if (this.touchMode) {
      this.locked = true
      return
    }
    void this.canvas.requestPointerLock()
  }

  /** Enters browser fullscreen from the Play tap when the platform supports it. */
  requestFullscreen(): boolean {
    if (!this.touchMode) return false
    if (this.standaloneMode || this.fullscreenElement !== null) return true
    const root = document.documentElement as WebkitFullscreenElement
    const request = root.requestFullscreen?.bind(root) ?? root.webkitRequestFullscreen?.bind(root)
    if (request === undefined) return false
    try {
      void Promise.resolve(request()).catch(() => this.onFullscreenUnavailable?.())
      return true
    } catch {
      return false
    }
  }

  /** Stops gameplay input before a pause/death/win card is shown. */
  release(): void {
    if (this.touchMode) {
      this.locked = false
      this.touchPanelOpen = false
      document.body.classList.remove('touch-panel-open')
      this.resetTouchInput()
      return
    }
    if (document.pointerLockElement === this.canvas) document.exitPointerLock()
  }

  /** Touch help/resource panels are modal to gameplay but keep their toolbar usable. */
  setTouchPanelOpen(open: boolean): void {
    this.touchPanelOpen = this.touchMode && open
    document.body.classList.toggle('touch-panel-open', this.touchPanelOpen)
    if (this.touchPanelOpen) this.resetTouchInput()
  }

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault()
  }

  private readonly onWindowBlur = (): void => {
    this.resetTouchInput()
  }

  private readonly onLockChange = (): void => {
    if (this.touchMode) return
    this.locked = document.pointerLockElement === this.canvas
    if (!this.locked) {
      this.keys.clear()
      this.attackHeld = false
      this.syncInput()
      this.onUnlock?.()
    }
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (this.touchMode || !this.locked) return
    this.player.yaw -= event.movementX * CAMERA.mouseSensitivity
    this.player.pitch -= event.movementY * CAMERA.mouseSensitivity
    this.player.pitch = clampPitch(this.player.pitch)
  }

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (this.touchMode || !this.locked) return
    if (event.button === 0) this.attackHeld = true
    if (event.button === 2) this.onPlace?.()
  }

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (this.touchMode) return
    if (event.button === 0) this.attackHeld = false
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.locked) return
    event.preventDefault()
    this.onCycleSlot?.(event.deltaY > 0 ? 1 : -1)
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Tab moves focus off the canvas — without preventDefault the panel would break input.
    if (event.code === 'Tab') {
      event.preventDefault()
      if (!event.repeat) this.onToggleResources?.()
      return
    }

    if (event.code === 'KeyQ') {
      if (!this.locked) return
      event.preventDefault()
      if (!event.repeat) this.onToggleHelp?.()
      return
    }

    // Browser F5 reloads the page — without preventDefault the view toggle would kill the game.
    if (event.code === 'F5' || event.code === 'KeyV') {
      event.preventDefault()
      if (event.repeat) return
      this.toggleCamera()
      return
    }

    if (!this.locked) return

    if (event.code.startsWith('Digit')) {
      const index = Number(event.code.slice(5)) - 1
      if (index >= 0) this.onSelectSlot?.(index)
      return
    }

    if (event.code === 'KeyF' && !event.repeat) {
      this.onThrow?.()
      return
    }

    this.keys.add(event.code)
    this.syncInput()
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code)
    this.syncInput()
  }

  private toggleCamera(): void {
    this.cameraMode = this.cameraMode === 'first' ? 'third' : 'first'
    this.onCameraToggle?.(this.cameraMode)
  }

  private syncInput(): void {
    const held = (...codes: string[]): boolean => codes.some((code) => this.keys.has(code))
    const keyForward =
      (held('KeyW', 'ArrowUp') ? 1 : 0) - (held('KeyS', 'ArrowDown') ? 1 : 0)
    const keyRight =
      (held('KeyD', 'ArrowRight') ? 1 : 0) - (held('KeyA', 'ArrowLeft') ? 1 : 0)
    this.input.forward = Math.max(-1, Math.min(1, keyForward + this.touchForward))
    this.input.right = Math.max(-1, Math.min(1, keyRight + this.touchRight))
    this.input.jump = held('Space') || this.touchJump
    this.input.run = held('ShiftLeft', 'ShiftRight') || this.touchRun
  }

  private bindTouchControls(): void {
    const controls = this.requireTouchEl('mobile-controls')
    controls.setAttribute('aria-hidden', 'false')
    const moveZone = this.requireTouchEl('touch-stick')
    this.moveBaseEl = this.requireTouchEl('touch-stick-base')
    this.moveKnobEl = this.requireTouchEl('touch-stick-knob')
    const lookZone = this.requireTouchEl('touch-look')
    const attack = this.requireTouchEl('touch-attack')
    const jump = this.requireTouchEl('touch-jump')

    this.listenTouch(moveZone, 'pointerdown', this.onMovePointerDown)
    this.listenTouch(moveZone, 'pointermove', this.onMovePointerMove)
    this.listenTouch(moveZone, 'pointerup', this.onMovePointerEnd)
    this.listenTouch(moveZone, 'pointercancel', this.onMovePointerEnd)

    this.listenTouch(lookZone, 'pointerdown', this.onLookPointerDown)
    this.listenTouch(lookZone, 'pointermove', this.onLookPointerMove)
    this.listenTouch(lookZone, 'pointerup', this.onLookPointerEnd)
    this.listenTouch(lookZone, 'pointercancel', this.onLookPointerEnd)

    this.listenTouch(attack, 'pointerdown', this.onAttackPointerDown)
    this.listenTouch(attack, 'pointerup', this.onAttackPointerEnd)
    this.listenTouch(attack, 'pointercancel', this.onAttackPointerEnd)
    this.listenTouch(jump, 'pointerdown', this.onJumpPointerDown)
    this.listenTouch(jump, 'pointerup', this.onJumpPointerEnd)
    this.listenTouch(jump, 'pointercancel', this.onJumpPointerEnd)

    this.bindTouchTap('touch-place', () => this.onPlace?.())
    this.bindTouchTap('touch-throw', () => this.onThrow?.())
    this.bindTouchTap('touch-camera', () => this.toggleCamera())
    this.bindTouchTap('touch-resources', () => this.onToggleResources?.(), true)
    this.bindTouchTap('touch-help', () => this.onToggleHelp?.(), true)
    this.fullscreenButtonEl = this.requireTouchEl('touch-fullscreen') as HTMLButtonElement
    // Browsers without the API still get a useful button with Home Screen instructions.
    this.fullscreenButtonEl.classList.toggle('supported', !this.standaloneMode)
    this.bindTouchTap('touch-fullscreen', () => this.toggleFullscreen(), true)
    document.addEventListener('fullscreenchange', this.onFullscreenChange)
    document.addEventListener('webkitfullscreenchange', this.onFullscreenChange)
    this.touchDisposers.push(() =>
      document.removeEventListener('fullscreenchange', this.onFullscreenChange),
    )
    this.touchDisposers.push(() =>
      document.removeEventListener('webkitfullscreenchange', this.onFullscreenChange),
    )
    this.onFullscreenChange()
    this.bindTouchTap(
      'touch-pause',
      () => {
        this.release()
        this.onPause?.()
      },
      true,
    )
  }

  private get fullscreenElement(): Element | null {
    const fullscreenDocument = document as WebkitFullscreenDocument
    return document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null
  }

  private get fullscreenSupported(): boolean {
    if (this.fullscreenUnavailable) return false
    const root = document.documentElement as WebkitFullscreenElement
    return (
      typeof root.requestFullscreen === 'function' ||
      typeof root.webkitRequestFullscreen === 'function'
    )
  }

  private get standaloneMode(): boolean {
    const standaloneNavigator = navigator as StandaloneNavigator
    return (
      standaloneNavigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches
    )
  }

  private toggleFullscreen(): void {
    if (this.standaloneMode) return
    if (this.fullscreenElement === null) {
      if (!this.fullscreenSupported) {
        this.onFullscreenUnavailable?.()
        return
      }
      if (!this.requestFullscreen()) this.onFullscreenUnavailable?.()
      return
    }

    const fullscreenDocument = document as WebkitFullscreenDocument
    const exit =
      document.exitFullscreen?.bind(document) ??
      fullscreenDocument.webkitExitFullscreen?.bind(fullscreenDocument)
    if (exit === undefined) return
    try {
      void Promise.resolve(exit()).catch(() => undefined)
    } catch {
      // Ignore browser-specific fullscreen failures; gameplay remains usable.
    }
  }

  private readonly onFullscreenChange = (): void => {
    const button = this.fullscreenButtonEl
    if (button === null) return
    const active = this.standaloneMode || this.fullscreenElement !== null
    button.textContent = active ? '↙' : '⛶'
    button.setAttribute('aria-label', active ? 'Выйти из полного экрана' : 'На весь экран')
    button.setAttribute('aria-pressed', String(active))
  }

  private bindTouchTap(id: string, action: () => void, allowWhilePanel = false): void {
    const element = this.requireTouchEl(id)
    this.listenTouch(element, 'pointerdown', (event) => {
      if (!this.canUseTouch(allowWhilePanel)) return
      event.preventDefault()
      event.stopPropagation()
      action()
    })
  }

  private readonly onMovePointerDown = (event: PointerEvent): void => {
    if (!this.canUseTouch() || this.movePointerId !== null) return
    event.preventDefault()
    event.stopPropagation()
    this.movePointerId = event.pointerId
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    this.updateTouchMove(event)
  }

  private readonly onMovePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.movePointerId) return
    event.preventDefault()
    this.updateTouchMove(event)
  }

  private readonly onMovePointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.movePointerId) return
    event.preventDefault()
    this.movePointerId = null
    this.touchForward = 0
    this.touchRight = 0
    this.touchRun = false
    this.moveKnobEl?.style.removeProperty('transform')
    this.syncInput()
  }

  private updateTouchMove(event: PointerEvent): void {
    const base = this.moveBaseEl
    const knob = this.moveKnobEl
    if (base === null || knob === null) return
    const rect = base.getBoundingClientRect()
    const dx = event.clientX - (rect.left + rect.width / 2)
    const dy = event.clientY - (rect.top + rect.height / 2)
    const vector = resolveTouchStick(dx, dy, rect.width * 0.5)
    this.touchForward = vector.forward
    this.touchRight = vector.right
    this.touchRun = vector.run
    const knobTravel = rect.width * 0.27
    knob.style.transform = `translate(${vector.visualX * knobTravel}px, ${vector.visualY * knobTravel}px)`
    this.syncInput()
  }

  private readonly onLookPointerDown = (event: PointerEvent): void => {
    if (!this.canUseTouch() || this.lookPointerId !== null) return
    event.preventDefault()
    this.lookPointerId = event.pointerId
    this.lookX = event.clientX
    this.lookY = event.clientY
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  private readonly onLookPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.lookPointerId) return
    event.preventDefault()
    const dx = event.clientX - this.lookX
    const dy = event.clientY - this.lookY
    this.lookX = event.clientX
    this.lookY = event.clientY
    this.player.yaw -= dx * CAMERA.touchSensitivity
    this.player.pitch = clampPitch(this.player.pitch - dy * CAMERA.touchSensitivity)
  }

  private readonly onLookPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.lookPointerId) return
    event.preventDefault()
    this.lookPointerId = null
  }

  private readonly onAttackPointerDown = (event: PointerEvent): void => {
    if (!this.canUseTouch() || this.attackPointerId !== null) return
    event.preventDefault()
    event.stopPropagation()
    this.attackPointerId = event.pointerId
    this.attackHeld = true
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  private readonly onAttackPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.attackPointerId) return
    event.preventDefault()
    this.attackPointerId = null
    this.attackHeld = false
  }

  private readonly onJumpPointerDown = (event: PointerEvent): void => {
    if (!this.canUseTouch() || this.jumpPointerId !== null) return
    event.preventDefault()
    event.stopPropagation()
    this.jumpPointerId = event.pointerId
    this.touchJump = true
    this.syncInput()
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  private readonly onJumpPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.jumpPointerId) return
    event.preventDefault()
    this.jumpPointerId = null
    this.touchJump = false
    this.syncInput()
  }

  private canUseTouch(allowWhilePanel = false): boolean {
    return this.touchMode && this.locked && (allowWhilePanel || !this.touchPanelOpen)
  }

  private resetTouchInput(): void {
    this.keys.clear()
    this.movePointerId = null
    this.lookPointerId = null
    this.attackPointerId = null
    this.jumpPointerId = null
    this.touchForward = 0
    this.touchRight = 0
    this.touchRun = false
    this.touchJump = false
    this.attackHeld = false
    this.moveKnobEl?.style.removeProperty('transform')
    this.syncInput()
  }

  private requireTouchEl(id: string): HTMLElement {
    const element = document.getElementById(id)
    if (element === null) throw new Error(`Missing touch control #${id}`)
    return element
  }

  private listenTouch(
    target: EventTarget,
    type: string,
    handler: (event: PointerEvent) => void,
  ): void {
    const listener = handler as EventListener
    target.addEventListener(type, listener, { passive: false })
    this.touchDisposers.push(() => target.removeEventListener(type, listener))
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown)
    document.removeEventListener('keyup', this.onKeyUp)
    document.removeEventListener('pointerlockchange', this.onLockChange)
    document.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('mousedown', this.onMouseDown)
    document.removeEventListener('mouseup', this.onMouseUp)
    document.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('blur', this.onWindowBlur)
    this.canvas.removeEventListener('contextmenu', this.onContextMenu)
    for (const dispose of this.touchDisposers) dispose()
    document.body.classList.remove('touch-mode', 'touch-panel-open')
  }
}
