import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { CREATURE_COLORS } from '../config/palette'

/**
 * Creature models. World blocks stay sharp cubes — that IS the minecraft look — while
 * critters assemble from rounded boxes and get a sway. Rounding plus animation delivers
 * nearly all of the cuteness, with zero external assets in the project.
 */

/**
 * A rounded box. segments=2 is enough: with smooth shading corners already read as
 * soft, and the polygon count stays low even for a dozen creatures.
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
  // Per-instance material, not shared: creatures flash on hit by changing their color.
  const material = new THREE.MeshLambertMaterial({ color })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  return mesh
}

/** Collects all subtree materials for hit flashes and correct memory disposal. */
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
  /** The whole body: swayed and squashed without touching group, keeping position intact. */
  readonly body = new THREE.Group()

  readonly limbs: THREE.Object3D[] = []
  /** The boss's mouth. Only Vitrulyan has one. */
  mouth: THREE.Object3D | null = null
  /** Rabbit ears: pinned back as the leap telegraph. */
  readonly ears: THREE.Object3D[] = []
  /**
   * Extra squash, 0…1. The boss crouches before a leap — this is the telegraph that
   * tells the player it is time to dodge.
   */
  squash = 0
  private readonly materials: THREE.MeshLambertMaterial[] = []
  private readonly baseColors: number[] = []
  private flash = 0

  constructor() {
    this.group.add(this.body)
  }

  /** Records base colors — restored after the hit flash. */
  finalize(): this {
    for (const material of collectMaterials(this.group)) {
      this.materials.push(material)
      this.baseColors.push(material.color.getHex())
    }
    return this
  }

  /** A brief white flash: without it a landed hit is unreadable. */
  hitFlash(duration = 0.16): void {
    this.flash = duration
  }

  /**
   * @param time total time in seconds — drives the idle sway.
   * @param moveSpeed current horizontal speed: the faster, the stronger the stride.
   */
  animate(time: number, moveSpeed: number, dt: number): void {
    const walking = Math.min(1, moveSpeed / 4)
    const stride = Math.sin(time * 9) * 0.55 * walking
    for (let i = 0; i < this.limbs.length; i++) {
      // Arms and legs move in antiphase via index parity.
      this.limbs[i].rotation.x = i % 2 === 0 ? stride : -stride
    }

    // Idle breathing, walk bounce, and the telegraph squash on top.
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
 * A pair of bead eyes on the head's front face (front is -Z), each with a white glint.
 * The glint buys outsized attention-to-detail for almost no code: without it the eyes
 * look like dead holes, with it the face comes alive.
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
 * A three-cube smile: middle lower than the edges. A single bar does not read as a
 * smile — it is just a stripe.
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

/** The third-person player. Hidden in first person. */
export function createPlayerModel(): CharacterModel {
  const model = new CharacterModel()
  const c = CREATURE_COLORS

  const legs = new THREE.Group()
  for (const side of [-1, 1]) {
    const leg = roundedBox(0.22, 0.55, 0.24, c.playerPants, 0.06)
    // The leg rotates around the hip, so the mesh shifts down within its group.
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

/** Night critter: a dark blob with glowing eyes. Cute and creepy at once. */
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

  // The eyes are self-lit (emissive) — at night you see exactly them; properly creepy.
  for (const side of [-1, 1]) {
    const eye = roundedBox(0.13, 0.16, 0.06, c.lurkerEye, 0.05)
    eye.position.set(side * 0.15, 0.56, -0.31)
    eye.castShadow = false
    ;(eye.material as THREE.MeshLambertMaterial).emissive.setHex(c.lurkerEye)
    ;(eye.material as THREE.MeshLambertMaterial).emissiveIntensity = 1.6
    model.body.add(eye)
  }

  // Ragged little ears so the silhouette differs from the animals.
  for (const side of [-1, 1]) {
    const ear = roundedBox(0.12, 0.26, 0.08, c.lurkerBodyDark, 0.04)
    ear.position.set(side * 0.22, 0.86, 0.02)
    ear.rotation.z = side * 0.45
    model.body.add(ear)
  }

  return model.finalize()
}

export type AnimalKind = 'bunny' | 'sheep' | 'chick'

/** Daytime wildlife. One constructor for all kinds — they differ in proportion and color. */
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

  // The chick.
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
 * A smurf — a small blue fellow in a white cap. The model is original, assembled from
 * rounded boxes: not a reproduction of the licensed characters, only the name the
 * player asked for.
 *
 * @param elder the elder wears a red cap — he hands out quests.
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

  // The head is large relative to the body — the primary cuteness trick.
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
 * Vitrulyan — a giant ginger rabbit: fluffy, with huge eyes, buck teeth, long ears
 * and a pompom tail. Cute and slightly creepy at once. The model is built at unit
 * scale; BOSS.scale blows it up to fighting size.
 */
export function createBossModel(): CharacterModel {
  const model = new CharacterModel()
  const c = CREATURE_COLORS

  // Hind legs bigger than front ones — the rabbit silhouette even without detail.
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

  // Huge eyes with glints — cuteness and mild creepiness at once.
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

  // A little nose and a mouth with two big buck teeth.
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

  // Long hinged ears: pinned back as the leap telegraph.
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

  // A pompom tail at the back.
  const tail = roundedBox(0.34, 0.34, 0.3, c.bossTail, 0.15)
  tail.position.set(0, 0.82, 0.66)
  model.body.add(tail)

  return model.finalize()
}
