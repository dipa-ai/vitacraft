import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { CREATURE_COLORS } from '../config/palette'

/**
 * Модели существ. Блоки мира остаются острыми кубами — это и есть майнкрафт, — а живность
 * собирается из скруглённых боксов и получает покачивание. Скругление плюс анимация дают
 * почти всё ощущение «миленько», при том что внешних ассетов в проекте нет вообще.
 */

/**
 * Скруглённый бокс. segments=2 достаточно: при плавном шейдинге углы уже читаются
 * мягкими, а полигонов остаётся мало даже на десяток существ.
 */
export function roundedBox(
  width: number,
  height: number,
  depth: number,
  color: number,
  radius = 0.07,
): THREE.Mesh {
  const safeRadius = Math.min(radius, Math.min(width, height, depth) / 2 - 0.001)
  const geometry = new RoundedBoxGeometry(width, height, depth, 2, safeRadius)
  // Материал на экземпляр, а не общий: существа мигают при попадании, меняя свой цвет.
  const material = new THREE.MeshLambertMaterial({ color })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  return mesh
}

/** Собирает все материалы поддерева, чтобы мигать попаданием и корректно освобождать память. */
function collectMaterials(root: THREE.Object3D): THREE.MeshLambertMaterial[] {
  const materials: THREE.MeshLambertMaterial[] = []
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      materials.push(node.material as THREE.MeshLambertMaterial)
    }
  })
  return materials
}

export class CharacterModel {
  readonly group = new THREE.Group()
  /** Всё тело: его мы качаем и сплющиваем, не трогая group, чтобы не ломать позицию. */
  readonly body = new THREE.Group()

  readonly limbs: THREE.Object3D[] = []
  /** Пасть босса: раскрывается как телеграф перед плевком. Есть только у Витруляна. */
  mouth: THREE.Object3D | null = null
  /**
   * Дополнительное приседание, 0…1. Босс приседает перед прыжком — это и есть телеграф,
   * по которому игрок понимает, что пора уклоняться.
   */
  squash = 0
  private readonly materials: THREE.MeshLambertMaterial[] = []
  private readonly baseColors: number[] = []
  private flash = 0

  constructor() {
    this.group.add(this.body)
  }

  /** Запоминает исходные цвета — по ним возвращаемся после вспышки попадания. */
  finalize(): this {
    for (const material of collectMaterials(this.group)) {
      this.materials.push(material)
      this.baseColors.push(material.color.getHex())
    }
    return this
  }

  /** Короткая белая вспышка: без неё непонятно, попал ли удар. */
  hitFlash(duration = 0.16): void {
    this.flash = duration
  }

  /**
   * @param time общее время в секундах — для покачивания на месте.
   * @param moveSpeed текущая горизонтальная скорость: чем быстрее, тем сильнее шаг.
   */
  animate(time: number, moveSpeed: number, dt: number): void {
    const walking = Math.min(1, moveSpeed / 4)
    const stride = Math.sin(time * 9) * 0.55 * walking
    for (let i = 0; i < this.limbs.length; i++) {
      // Руки и ноги ходят в противофазе через чётность индекса.
      this.limbs[i].rotation.x = i % 2 === 0 ? stride : -stride
    }

    // Дыхание на месте, подпрыгивание при ходьбе и приседание-телеграф сверху.
    const idle = Math.sin(time * 2.2) * 0.02 * (1 - walking)
    const bounce = Math.abs(Math.sin(time * 9)) * 0.06 * walking
    this.body.position.y = idle + bounce
    const wide = 1 + idle * 0.5 + this.squash * 0.32
    const tall = 1 - idle * 0.5 - this.squash * 0.4
    this.body.scale.set(wide, tall, wide)

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt)
      const t = this.flash > 0 ? 1 : 0
      for (let i = 0; i < this.materials.length; i++) {
        if (t === 1) this.materials[i].color.setHex(0xffffff)
        else this.materials[i].color.setHex(this.baseColors[i])
      }
    }
  }

  dispose(): void {
    this.group.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose()
        ;(node.material as THREE.Material).dispose()
      }
    })
  }
}

/**
 * Пара глаз-бусин на передней грани головы (перёд — это -Z), каждая с белым бликом.
 * Блик стоит несоразмерно дорого по вниманию к деталям и почти ничего по коду: без него
 * глаза выглядят мёртвыми дырками, с ним лицо оживает.
 */
function addEyes(
  head: THREE.Object3D,
  headDepth: number,
  spread: number,
  pupil: number,
  eyeWidth = 0.1,
  eyeHeight = 0.12,
): void {
  const front = -headDepth / 2
  for (const side of [-1, 1]) {
    const eye = roundedBox(eyeWidth, eyeHeight, 0.06, pupil, 0.03)
    eye.position.set(side * spread, headDepth * 0.08, front - 0.01)
    eye.castShadow = false
    head.add(eye)

    const glint = roundedBox(eyeWidth * 0.36, eyeHeight * 0.3, 0.04, 0xffffff, 0.012)
    glint.position.set(
      side * spread - eyeWidth * 0.2,
      headDepth * 0.08 + eyeHeight * 0.26,
      front - 0.035,
    )
    glint.castShadow = false
    head.add(glint)
  }
}

/**
 * Улыбка из трёх кубиков: середина ниже краёв. Одной планкой улыбка не читается —
 * получается просто полоска.
 */
function addSmile(
  head: THREE.Object3D,
  headDepth: number,
  y: number,
  color: number,
  scale = 1,
): void {
  const front = -headDepth / 2 - 0.01
  const step = 0.055 * scale
  const size = 0.05 * scale
  for (const [dx, dy] of [
    [-1, 0.028 * scale],
    [0, 0],
    [1, 0.028 * scale],
  ]) {
    const piece = roundedBox(size, size * 0.72, 0.05, color, 0.012)
    piece.position.set(dx * step, y + dy, front)
    piece.castShadow = false
    head.add(piece)
  }
}

/** Игрок в третьем лице. В первом лице модель скрывается. */
export function createPlayerModel(): CharacterModel {
  const model = new CharacterModel()
  const c = CREATURE_COLORS

  const legs = new THREE.Group()
  for (const side of [-1, 1]) {
    const leg = roundedBox(0.22, 0.55, 0.24, c.playerPants, 0.06)
    // Поворачиваем ногу вокруг бедра, поэтому сдвигаем меш вниз внутри своей группы.
    const pivot = new THREE.Group()
    leg.position.y = -0.275
    pivot.add(leg)
    pivot.position.set(side * 0.14, 0.55, 0)
    legs.add(pivot)
    model.limbs.push(pivot)
  }
  model.body.add(legs)

  const torso = roundedBox(0.55, 0.6, 0.32, c.playerShirt, 0.08)
  torso.position.y = 0.85
  model.body.add(torso)

  for (const side of [-1, 1]) {
    const arm = roundedBox(0.16, 0.5, 0.18, c.playerBody, 0.06)
    const pivot = new THREE.Group()
    arm.position.y = -0.25
    pivot.add(arm)
    pivot.position.set(side * 0.35, 1.08, 0)
    model.body.add(pivot)
    model.limbs.push(pivot)
  }

  const head = roundedBox(0.62, 0.6, 0.58, c.playerBody, 0.12)
  head.position.y = 1.46
  addEyes(head, 0.58, 0.15, 0x3a3050, 0.09, 0.11)
  addSmile(head, 0.58, -0.1, 0x9b6a5c, 1.1)
  model.body.add(head)

  return model.finalize()
}

/**
 * Смурфик — маленький синий человечек в белом колпачке. Модель оригинальная, собранная
 * из скруглённых боксов: это не воспроизведение лицензированных персонажей, только имя,
 * которое просил игрок.
 */
export function createSmurfModel(): CharacterModel {
  const model = new CharacterModel()
  const c = CREATURE_COLORS

  for (const side of [-1, 1]) {
    const leg = roundedBox(0.15, 0.26, 0.16, c.smurfPants, 0.05)
    const pivot = new THREE.Group()
    leg.position.y = -0.13
    pivot.add(leg)
    pivot.position.set(side * 0.1, 0.26, 0)
    model.body.add(pivot)
    model.limbs.push(pivot)
  }

  const torso = roundedBox(0.36, 0.34, 0.26, c.smurfBody, 0.08)
  torso.position.y = 0.43
  model.body.add(torso)

  for (const side of [-1, 1]) {
    const arm = roundedBox(0.12, 0.28, 0.13, c.smurfBody, 0.05)
    const pivot = new THREE.Group()
    arm.position.y = -0.14
    pivot.add(arm)
    pivot.position.set(side * 0.24, 0.56, 0)
    model.body.add(pivot)
    model.limbs.push(pivot)
  }

  // Голова крупная относительно тела — главный приём «миленькости».
  const head = roundedBox(0.44, 0.4, 0.42, c.smurfSkin, 0.11)
  head.position.y = 0.78
  addEyes(head, 0.42, 0.105, 0x2b2340, 0.105, 0.13)
  addSmile(head, 0.42, -0.09, 0x3f6f8f, 0.9)
  model.body.add(head)

  const cap = roundedBox(0.4, 0.22, 0.38, c.smurfCap, 0.1)
  cap.position.y = 1.03
  model.body.add(cap)
  const capTip = roundedBox(0.16, 0.14, 0.16, c.smurfCap, 0.07)
  capTip.position.set(0, 1.17, 0.06)
  model.body.add(capTip)

  return model.finalize()
}

/**
 * Витрулян — гигантская милая-жуткая зверюшка: пушистый колобок с огромными глазами,
 * зубастой пастью и короткими лапками. Модель строится в единичном масштабе, а до боевого
 * размера её увеличивает BOSS.scale.
 */
export function createBossModel(): CharacterModel {
  const model = new CharacterModel()
  const c = CREATURE_COLORS

  // Лапки заходят внутрь туловища: если поставить их вплотную, скруглённое днище
  // отходит от них и зверюшка выглядит разобранной на части.
  for (const side of [-1, 1]) {
    for (const front of [-1, 1]) {
      const leg = roundedBox(0.36, 0.36, 0.36, c.bossBodyDark, 0.15)
      const pivot = new THREE.Group()
      leg.position.y = -0.18
      pivot.add(leg)
      pivot.position.set(side * 0.4, 0.44, front * 0.32)
      model.body.add(pivot)
      model.limbs.push(pivot)
    }
  }

  const belly = roundedBox(1.24, 1.16, 1.16, c.bossBody, 0.34)
  belly.position.y = 1.0
  model.body.add(belly)

  // Светлое пятно небольшое и низкое: во всю грудь оно выглядит как слюнявчик
  // и перебивает лавандовый корпус.
  const patch = roundedBox(0.46, 0.4, 0.1, c.bossBelly, 0.16)
  patch.position.set(0, 0.66, -0.6)
  model.body.add(patch)

  // Огромные глаза — от них зверюшка одновременно милая и слегка жуткая.
  for (const side of [-1, 1]) {
    const eye = roundedBox(0.36, 0.42, 0.16, c.bossEye, 0.15)
    eye.position.set(side * 0.28, 1.32, -0.58)
    model.body.add(eye)
    const pupil = roundedBox(0.17, 0.22, 0.08, c.bossPupil, 0.07)
    pupil.position.set(side * 0.28, 1.28, -0.66)
    model.body.add(pupil)
    const glint = roundedBox(0.06, 0.07, 0.05, 0xffffff, 0.02)
    glint.position.set(side * 0.28 - 0.045, 1.34, -0.7)
    glint.castShadow = false
    model.body.add(glint)
  }

  const mouth = roundedBox(0.5, 0.2, 0.12, c.bossMouth, 0.07)
  mouth.position.set(0, 0.94, -0.63)
  model.body.add(mouth)
  model.mouth = mouth

  // Зубы по верхней кромке пасти — так они читаются как клыки, а не как отдельная деталь.
  for (let i = 0; i < 4; i++) {
    const tooth = roundedBox(0.08, 0.12, 0.06, c.bossTooth, 0.02)
    tooth.position.set(-0.18 + i * 0.12, 0.99, -0.68)
    model.body.add(tooth)
  }

  // Ушки-рожки: силуэт становится узнаваемым даже издалека.
  for (const side of [-1, 1]) {
    const ear = roundedBox(0.24, 0.3, 0.22, c.bossBodyDark, 0.1)
    ear.position.set(side * 0.44, 1.62, 0.06)
    ear.rotation.z = side * 0.3
    model.body.add(ear)
  }

  return model.finalize()
}
