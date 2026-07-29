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
  /** Пасть босса. Есть только у Витруляна. */
  mouth: THREE.Object3D | null = null
  /** Уши кролика: прижимаются назад как телеграф прыжка. */
  readonly ears: THREE.Object3D[] = []
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

/** Ночная зверюшка: тёмный колобок со светящимися глазами. Милая и жуткая разом. */
export function createLurkerModel(): CharacterModel {
  const model = new CharacterModel()
  const c = CREATURE_COLORS

  for (const side of [-1, 1]) {
    const foot = roundedBox(0.16, 0.14, 0.18, c.lurkerBodyDark, 0.06)
    const pivot = new THREE.Group()
    foot.position.y = -0.07
    pivot.add(foot)
    pivot.position.set(side * 0.16, 0.14, 0)
    model.body.add(pivot)
    model.limbs.push(pivot)
  }

  const body = roundedBox(0.68, 0.62, 0.6, c.lurkerBody, 0.22)
  body.position.y = 0.48
  model.body.add(body)

  // Глаза светятся сами (emissive) — ночью видно именно их, и это правильно жутко.
  for (const side of [-1, 1]) {
    const eye = roundedBox(0.13, 0.16, 0.06, c.lurkerEye, 0.05)
    eye.position.set(side * 0.15, 0.56, -0.31)
    eye.castShadow = false
    ;(eye.material as THREE.MeshLambertMaterial).emissive.setHex(c.lurkerEye)
    ;(eye.material as THREE.MeshLambertMaterial).emissiveIntensity = 1.6
    model.body.add(eye)
  }

  // Рваные ушки, чтобы силуэт отличался от животных.
  for (const side of [-1, 1]) {
    const ear = roundedBox(0.12, 0.26, 0.08, c.lurkerBodyDark, 0.04)
    ear.position.set(side * 0.22, 0.86, 0.02)
    ear.rotation.z = side * 0.45
    model.body.add(ear)
  }

  return model.finalize()
}

export type AnimalKind = 'bunny' | 'sheep' | 'chick'

/** Дневная живность. Один конструктор на все виды — различаются пропорциями и цветом. */
export function createAnimalModel(kind: AnimalKind): CharacterModel {
  const model = new CharacterModel()
  const c = CREATURE_COLORS

  if (kind === 'sheep') {
    for (const side of [-1, 1]) {
      for (const front of [-1, 1]) {
        const leg = roundedBox(0.1, 0.2, 0.1, c.sheepFace, 0.03)
        const pivot = new THREE.Group()
        leg.position.y = -0.1
        pivot.add(leg)
        pivot.position.set(side * 0.16, 0.2, front * 0.18)
        model.body.add(pivot)
        model.limbs.push(pivot)
      }
    }
    const wool = roundedBox(0.56, 0.44, 0.72, c.sheepWool, 0.18)
    wool.position.y = 0.42
    model.body.add(wool)
    const head = roundedBox(0.26, 0.26, 0.24, c.sheepFace, 0.09)
    head.position.set(0, 0.56, -0.42)
    addEyes(head, 0.24, 0.07, 0x2b2340, 0.06, 0.07)
    model.body.add(head)
    const tuft = roundedBox(0.2, 0.12, 0.18, c.sheepWool, 0.06)
    tuft.position.set(0, 0.72, -0.42)
    model.body.add(tuft)
    return model.finalize()
  }

  if (kind === 'bunny') {
    for (const side of [-1, 1]) {
      const leg = roundedBox(0.12, 0.12, 0.2, c.rabbitFur, 0.04)
      const pivot = new THREE.Group()
      leg.position.y = -0.06
      pivot.add(leg)
      pivot.position.set(side * 0.11, 0.12, 0.08)
      model.body.add(pivot)
      model.limbs.push(pivot)
    }
    const body = roundedBox(0.36, 0.32, 0.44, c.rabbitFur, 0.13)
    body.position.set(0, 0.32, 0)
    model.body.add(body)
    const head = roundedBox(0.26, 0.24, 0.24, c.rabbitFur, 0.09)
    head.position.set(0, 0.52, -0.22)
    addEyes(head, 0.22, 0.07, 0x2b2340, 0.06, 0.07)
    model.body.add(head)
    for (const side of [-1, 1]) {
      const ear = roundedBox(0.08, 0.3, 0.05, c.rabbitFur, 0.03)
      ear.position.set(side * 0.08, 0.76, -0.2)
      model.body.add(ear)
      const inner = roundedBox(0.04, 0.2, 0.03, c.rabbitEar, 0.01)
      inner.position.set(side * 0.08, 0.75, -0.23)
      inner.castShadow = false
      model.body.add(inner)
    }
    const tail = roundedBox(0.12, 0.12, 0.1, 0xffffff, 0.05)
    tail.position.set(0, 0.3, 0.26)
    model.body.add(tail)
    return model.finalize()
  }

  // Цыплёнок.
  for (const side of [-1, 1]) {
    const leg = roundedBox(0.05, 0.12, 0.05, c.birdBeak, 0.015)
    const pivot = new THREE.Group()
    leg.position.y = -0.06
    pivot.add(leg)
    pivot.position.set(side * 0.07, 0.12, 0)
    model.body.add(pivot)
    model.limbs.push(pivot)
  }
  const body = roundedBox(0.28, 0.26, 0.3, c.birdBody, 0.1)
  body.position.y = 0.28
  model.body.add(body)
  const head = roundedBox(0.2, 0.18, 0.18, c.birdBody, 0.07)
  head.position.set(0, 0.46, -0.1)
  addEyes(head, 0.16, 0.055, 0x2b2340, 0.045, 0.055)
  model.body.add(head)
  const beak = roundedBox(0.07, 0.06, 0.08, c.birdBeak, 0.015)
  beak.position.set(0, 0.44, -0.22)
  model.body.add(beak)
  return model.finalize()
}

/**
 * Смурфик — маленький синий человечек в белом колпачке. Модель оригинальная, собранная
 * из скруглённых боксов: это не воспроизведение лицензированных персонажей, только имя,
 * которое просил игрок.
 *
 * @param elder старейшина носит красный колпачок — он выдаёт задания.
 */
export function createSmurfModel(elder = false): CharacterModel {
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

  const capColor = elder ? c.smurfCapElder : c.smurfCap
  const cap = roundedBox(0.4, 0.22, 0.38, capColor, 0.1)
  cap.position.y = 1.03
  model.body.add(cap)
  const capTip = roundedBox(0.16, 0.14, 0.16, capColor, 0.07)
  capTip.position.set(0, 1.17, 0.06)
  model.body.add(capTip)

  return model.finalize()
}

/**
 * Витрулян — гигантский рыжий кролик: пушистый, с огромными глазами, резцами, длинными
 * ушами и хвостом-помпоном. Милый и слегка жуткий одновременно. Модель строится
 * в единичном масштабе, а до боевого размера её увеличивает BOSS.scale.
 */
export function createBossModel(): CharacterModel {
  const model = new CharacterModel()
  const c = CREATURE_COLORS

  // Задние лапы больше передних — это кроличий силуэт даже без деталей.
  for (const side of [-1, 1]) {
    const front = roundedBox(0.3, 0.32, 0.32, c.bossFurDark, 0.13)
    const frontPivot = new THREE.Group()
    front.position.y = -0.16
    frontPivot.add(front)
    frontPivot.position.set(side * 0.36, 0.42, -0.34)
    model.body.add(frontPivot)
    model.limbs.push(frontPivot)

    const rear = roundedBox(0.44, 0.34, 0.52, c.bossFurDark, 0.16)
    const rearPivot = new THREE.Group()
    rear.position.set(0, -0.17, 0.06)
    rearPivot.add(rear)
    rearPivot.position.set(side * 0.42, 0.44, 0.36)
    model.body.add(rearPivot)
    model.limbs.push(rearPivot)
  }

  const belly = roundedBox(1.24, 1.16, 1.2, c.bossFur, 0.34)
  belly.position.y = 1.0
  model.body.add(belly)

  const patch = roundedBox(0.5, 0.44, 0.1, c.bossBelly, 0.18)
  patch.position.set(0, 0.7, -0.6)
  model.body.add(patch)

  // Огромные глаза с бликами — милота и лёгкая жуть одновременно.
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

  // Носик и пасть с двумя большими резцами.
  const nose = roundedBox(0.16, 0.12, 0.1, c.bossMouth, 0.05)
  nose.position.set(0, 1.08, -0.64)
  model.body.add(nose)

  const mouth = roundedBox(0.44, 0.16, 0.12, c.bossMouth, 0.06)
  mouth.position.set(0, 0.92, -0.62)
  model.body.add(mouth)
  model.mouth = mouth

  for (const side of [-1, 1]) {
    const tooth = roundedBox(0.12, 0.18, 0.06, c.bossTooth, 0.03)
    tooth.position.set(side * 0.08, 0.86, -0.67)
    model.body.add(tooth)
  }

  // Длинные уши на шарнирах: прижимаются назад как телеграф прыжка.
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group()
    const ear = roundedBox(0.26, 0.85, 0.16, c.bossFurDark, 0.11)
    ear.position.y = 0.42
    pivot.add(ear)
    const inner = roundedBox(0.14, 0.6, 0.06, c.bossEarInner, 0.06)
    inner.position.set(0, 0.4, -0.07)
    inner.castShadow = false
    pivot.add(inner)
    pivot.position.set(side * 0.3, 1.58, 0.08)
    pivot.rotation.z = side * 0.12
    model.body.add(pivot)
    model.ears.push(pivot)
  }

  // Хвост-помпон сзади.
  const tail = roundedBox(0.34, 0.34, 0.3, c.bossTail, 0.15)
  tail.position.set(0, 0.82, 0.66)
  model.body.add(tail)

  return model.finalize()
}
