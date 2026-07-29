/**
 * Звук целиком синтезируется через WebAudio: ни одного файла в проекте нет, а значит
 * нет и вопросов с лицензиями на ассеты.
 *
 * Контекст создаётся лениво, при первом действии игрока: браузеры не дают запустить
 * аудио до жеста пользователя, и попытка сделать это раньше просто уходит в ошибку.
 */
export class Audio {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  muted = false

  /** Вызывается из обработчика клика — только там браузер разрешает старт аудио. */
  unlock(): void {
    if (this.context !== null) return
    try {
      this.context = new AudioContext()
      this.master = this.context.createGain()
      this.master.gain.value = 0.22
      this.master.connect(this.context.destination)
    } catch (error) {
      console.warn('Звук недоступен:', error)
    }
  }

  private tone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    options: { toFrequency?: number; gain?: number; delay?: number } = {},
  ): void {
    const context = this.context
    const master = this.master
    if (context === null || master === null || this.muted) return

    const start = context.currentTime + (options.delay ?? 0)
    const oscillator = context.createOscillator()
    const envelope = context.createGain()

    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, start)
    if (options.toFrequency !== undefined) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(1, options.toFrequency),
        start + duration,
      )
    }

    // Мягкая атака и спад: резкий обрыв даёт щёлк в динамиках.
    const peak = options.gain ?? 0.5
    envelope.gain.setValueAtTime(0.0001, start)
    envelope.gain.exponentialRampToValueAtTime(peak, start + 0.012)
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration)

    oscillator.connect(envelope)
    envelope.connect(master)
    oscillator.start(start)
    oscillator.stop(start + duration + 0.02)
  }

  /** Шум через короткий буфер — для пыли и приземлений. */
  private noise(duration: number, gain: number, filterHz: number): void {
    const context = this.context
    const master = this.master
    if (context === null || master === null || this.muted) return

    const length = Math.floor(context.sampleRate * duration)
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) {
      // Затухающий белый шум.
      channel[i] = (Math.random() * 2 - 1) * (1 - i / length)
    }

    const source = context.createBufferSource()
    source.buffer = buffer
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = filterHz
    const envelope = context.createGain()
    envelope.gain.value = gain

    source.connect(filter)
    filter.connect(envelope)
    envelope.connect(master)
    source.start()
  }

  placeBlock(): void {
    this.tone(420, 0.09, 'sine', { toFrequency: 620, gain: 0.35 })
  }

  breakBlock(): void {
    this.noise(0.14, 0.3, 1400)
  }

  jump(): void {
    this.tone(320, 0.1, 'sine', { toFrequency: 500, gain: 0.22 })
  }

  hurt(): void {
    this.tone(240, 0.22, 'triangle', { toFrequency: 90, gain: 0.5 })
  }

  /** Заселение смурфика: короткий восходящий арпеджио — самая радостная нота в игре. */
  smurfSettled(): void {
    this.tone(523, 0.12, 'sine', { gain: 0.4 })
    this.tone(659, 0.12, 'sine', { gain: 0.4, delay: 0.1 })
    this.tone(784, 0.2, 'sine', { gain: 0.4, delay: 0.2 })
  }

  smurfChatter(): void {
    this.tone(700 + Math.random() * 200, 0.07, 'square', { toFrequency: 900, gain: 0.12 })
  }

  hitBoss(): void {
    this.tone(180, 0.1, 'square', { toFrequency: 120, gain: 0.3 })
  }

  bossRoar(): void {
    this.tone(90, 0.7, 'sawtooth', { toFrequency: 55, gain: 0.4 })
    this.noise(0.5, 0.2, 500)
  }

  bossSlam(): void {
    this.tone(70, 0.4, 'sine', { toFrequency: 40, gain: 0.6 })
    this.noise(0.35, 0.4, 700)
  }

  bossSpit(): void {
    this.tone(300, 0.14, 'sawtooth', { toFrequency: 160, gain: 0.22 })
  }

  throwBlob(): void {
    this.tone(520, 0.1, 'triangle', { toFrequency: 760, gain: 0.2 })
  }

  victory(): void {
    const notes = [523, 659, 784, 1047]
    notes.forEach((frequency, index) => {
      this.tone(frequency, 0.34, 'sine', { gain: 0.42, delay: index * 0.14 })
    })
  }

  defeat(): void {
    const notes = [400, 330, 260, 190]
    notes.forEach((frequency, index) => {
      this.tone(frequency, 0.32, 'triangle', { gain: 0.36, delay: index * 0.16 })
    })
  }
}
