import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { SKY } from '../config/palette'
import { CAMERA, DAY } from '../config/tuning'

const skyVertexShader = /* glsl */ `
varying float vHeight;
void main() {
  vHeight = normalize(position).y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const skyFragmentShader = /* glsl */ `
uniform vec3 topColor;
uniform vec3 bottomColor;
varying float vHeight;
void main() {
  float t = smoothstep(-0.2, 0.55, vHeight);
  gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Доля «ночи» в текущий момент суток: 0 — полный день, 1 — глухая ночь. */
export function nightness(dayFraction: number): number {
  const dusk = smoothstep(DAY.nightStart - 0.1, DAY.nightStart + 0.03, dayFraction)
  const dawn = 1 - smoothstep(0.92, 1.0, dayFraction)
  return Math.min(dusk, dawn)
}

/**
 * Держит рендерер, камеру, свет и небо. Вся «красота» настраивается здесь и в palette.ts:
 * мягкие тени, тёплый ambient, туман в цвет горизонта и градиентное небо, которое
 * растворяет даль вместо резкого обрыва мира.
 */
export class SceneRig {
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer

  private readonly sun: THREE.DirectionalLight
  private readonly sunTarget = new THREE.Object3D()
  private readonly ambient: THREE.AmbientLight
  private readonly hemi: THREE.HemisphereLight
  private readonly sky: THREE.Mesh
  private readonly skyUniforms: {
    topColor: { value: THREE.Color }
    bottomColor: { value: THREE.Color }
  }

  private readonly fog: THREE.FogExp2
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  /** Блум выключаем при просадке производительности или если он мешает картинке. */
  bloomEnabled = true

  // Переиспользуемые цвета, чтобы цикл дня не аллоцировал по кадру.
  private readonly tmpA = new THREE.Color()
  private readonly tmpB = new THREE.Color()

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    // Мягкие края теней — важная часть «миленького» вида.
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05

    this.camera = new THREE.PerspectiveCamera(
      CAMERA.fov,
      window.innerWidth / window.innerHeight,
      CAMERA.near,
      CAMERA.far,
    )

    // Плотность подобрана под WORLD.viewRadius: на границе прогруженной области туман
    // должен уже почти полностью скрывать геометрию, иначе виден обрыв мира.
    this.fog = new THREE.FogExp2(SKY.day.fog, 0.01)
    this.scene.fog = this.fog

    this.ambient = new THREE.AmbientLight(SKY.day.ambient, SKY.day.ambientIntensity)
    this.scene.add(this.ambient)

    this.hemi = new THREE.HemisphereLight(
      SKY.day.hemiSky,
      SKY.day.hemiGround,
      SKY.day.hemiIntensity,
    )
    this.scene.add(this.hemi)

    this.sun = new THREE.DirectionalLight(SKY.day.sun, SKY.day.sunIntensity)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    // Узкий фрустум вокруг игрока: тени резче, чем при попытке накрыть весь мир.
    const extent = 42
    this.sun.shadow.camera.left = -extent
    this.sun.shadow.camera.right = extent
    this.sun.shadow.camera.top = extent
    this.sun.shadow.camera.bottom = -extent
    this.sun.shadow.camera.near = 0.5
    this.sun.shadow.camera.far = 220
    // Без этого сдвига воксели покрываются полосатыми артефактами самозатенения.
    this.sun.shadow.bias = -0.0006
    this.sun.shadow.normalBias = 0.03
    this.sun.shadow.radius = 3
    this.scene.add(this.sun)
    this.scene.add(this.sunTarget)
    this.sun.target = this.sunTarget

    this.skyUniforms = {
      topColor: { value: new THREE.Color(SKY.day.top) },
      bottomColor: { value: new THREE.Color(SKY.day.bottom) },
    }
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(300, 24, 16),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms,
        vertexShader: skyVertexShader,
        fragmentShader: skyFragmentShader,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    )
    this.sky.frustumCulled = false
    this.scene.add(this.sky)

    // Постобработка. Порог намеренно выше единицы: светиться должны только снаряды и
    // глаза босса с их emissive, а не вся освещённая солнцем трава.
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    // Порог высокий, сила маленькая. Сцена и так ярко освещена, и при пороге около
    // единицы блум подхватывал белые глаза и зубы босса, превращая его в белое пятно.
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.28,
      0.3,
      2.4,
    )
    this.composer.addPass(this.bloom)
    // OutputPass сам делает тонмаппинг и перевод в sRGB на выходе композера — материалы
    // при рендере в промежуточный таргет этого не делают.
    this.composer.addPass(new OutputPass())
    this.composer.setSize(window.innerWidth, window.innerHeight)

    window.addEventListener('resize', this.onResize)
  }

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.composer.setSize(window.innerWidth, window.innerHeight)
  }

  /**
   * Перекрашивает небо, туман и свет под текущее время суток.
   * @param dayFraction доля суток в диапазоне [0, 1).
   */
  setTimeOfDay(dayFraction: number): void {
    const n = nightness(dayFraction)
    const day = SKY.day
    const night = SKY.night

    this.skyUniforms.topColor.value.copy(this.lerpHex(day.top, night.top, n))
    this.skyUniforms.bottomColor.value.copy(this.lerpHex(day.bottom, night.bottom, n))
    this.fog.color.copy(this.lerpHex(day.fog, night.fog, n))
    this.sun.color.copy(this.lerpHex(day.sun, night.sun, n))
    this.ambient.color.copy(this.lerpHex(day.ambient, night.ambient, n))
    this.hemi.color.copy(this.lerpHex(day.hemiSky, night.hemiSky, n))
    this.hemi.groundColor.copy(this.lerpHex(day.hemiGround, night.hemiGround, n))

    this.sun.intensity = day.sunIntensity + (night.sunIntensity - day.sunIntensity) * n
    this.ambient.intensity =
      day.ambientIntensity + (night.ambientIntensity - day.ambientIntensity) * n
    this.hemi.intensity = day.hemiIntensity + (night.hemiIntensity - day.hemiIntensity) * n

    // Солнце ходит по небу, чтобы тени двигались. Ниже горизонта не опускаем —
    // иначе ночью пропадают тени и картинка становится плоской.
    const angle = dayFraction * Math.PI * 2 - Math.PI / 2
    this.sunDirection.set(Math.cos(angle) * 0.7, Math.max(0.35, Math.sin(angle)), 0.42)
  }

  private readonly sunDirection = new THREE.Vector3(0.7, 1, 0.42)

  private lerpHex(a: number, b: number, t: number): THREE.Color {
    this.tmpA.setHex(a)
    this.tmpB.setHex(b)
    return this.tmpA.lerp(this.tmpB, t)
  }

  /** Привязывает фрустум тени и купол неба к игроку. */
  follow(position: THREE.Vector3): void {
    this.sunTarget.position.copy(position)
    this.sun.position.copy(position).addScaledVector(this.sunDirection, 90)
    this.sky.position.copy(position)
  }

  render(): void {
    if (this.bloomEnabled) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize)
    this.sky.geometry.dispose()
    ;(this.sky.material as THREE.Material).dispose()
    this.renderer.dispose()
  }
}
