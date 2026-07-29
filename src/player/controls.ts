import { CAMERA } from '../config/tuning'
import type { MoveInput } from './player'
import type { Player } from './player'

export type CameraMode = 'first' | 'third'

/**
 * Ввод и захват курсора. Pointer lock включён в обоих режимах камеры: если в третьем
 * лице переключаться на вращение перетаскиванием, управление начинает ощущаться
 * сломанным. Поэтому третье лицо — это только смещение камеры, а мышь работает одинаково.
 */
export class Controls {
  readonly input: MoveInput = { forward: 0, right: 0, jump: false, run: false }
  cameraMode: CameraMode = 'first'
  locked = false

  /** ЛКМ удерживают — удар повторяется по кулдауну. */
  attackHeld = false

  onPlace: (() => void) | null = null
  onThrow: (() => void) | null = null
  onSelectSlot: ((index: number) => void) | null = null
  onCycleSlot: ((direction: number) => void) | null = null
  onCameraToggle: ((mode: CameraMode) => void) | null = null
  onUnlock: (() => void) | null = null

  private readonly keys = new Set<string>()

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly player: Player,
  ) {
    document.addEventListener('keydown', this.onKeyDown)
    document.addEventListener('keyup', this.onKeyUp)
    document.addEventListener('pointerlockchange', this.onLockChange)
    document.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('mousedown', this.onMouseDown)
    document.addEventListener('mouseup', this.onMouseUp)
    document.addEventListener('wheel', this.onWheel, { passive: false })
    // Иначе ПКМ открывает контекстное меню вместо установки блока.
    this.canvas.addEventListener('contextmenu', this.onContextMenu)
  }

  requestLock(): void {
    void this.canvas.requestPointerLock()
  }

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault()
  }

  private readonly onLockChange = (): void => {
    this.locked = document.pointerLockElement === this.canvas
    if (!this.locked) {
      this.keys.clear()
      this.attackHeld = false
      this.syncInput()
      this.onUnlock?.()
    }
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.locked) return
    this.player.yaw -= event.movementX * CAMERA.mouseSensitivity
    this.player.pitch -= event.movementY * CAMERA.mouseSensitivity
    // Чуть меньше 90°, иначе на зените камера переворачивается.
    const limit = Math.PI / 2 - 0.01
    this.player.pitch = Math.max(-limit, Math.min(limit, this.player.pitch))
  }

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!this.locked) return
    if (event.button === 0) this.attackHeld = true
    if (event.button === 2) this.onPlace?.()
  }

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) this.attackHeld = false
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.locked) return
    event.preventDefault()
    this.onCycleSlot?.(event.deltaY > 0 ? 1 : -1)
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // F5 в браузере перезагружает страницу — без preventDefault смена вида убивала бы игру.
    if (event.code === 'F5' || event.code === 'KeyV') {
      event.preventDefault()
      if (event.repeat) return
      this.cameraMode = this.cameraMode === 'first' ? 'third' : 'first'
      this.onCameraToggle?.(this.cameraMode)
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

  private syncInput(): void {
    const held = (...codes: string[]): boolean => codes.some((code) => this.keys.has(code))
    this.input.forward = (held('KeyW', 'ArrowUp') ? 1 : 0) - (held('KeyS', 'ArrowDown') ? 1 : 0)
    this.input.right = (held('KeyD', 'ArrowRight') ? 1 : 0) - (held('KeyA', 'ArrowLeft') ? 1 : 0)
    this.input.jump = held('Space')
    this.input.run = held('ShiftLeft', 'ShiftRight')
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown)
    document.removeEventListener('keyup', this.onKeyUp)
    document.removeEventListener('pointerlockchange', this.onLockChange)
    document.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('mousedown', this.onMouseDown)
    document.removeEventListener('mouseup', this.onMouseUp)
    document.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('contextmenu', this.onContextMenu)
  }
}
