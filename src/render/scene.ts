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

/** Night fraction at the current time of day: 0 is full day, 1 is dead of night. */
export function nightness(dayFraction: number): number {
  const dusk = smoothstep(DAY.nightStart - 0.1, DAY.nightStart + 0.03, dayFraction)
  const dawn = 1 - smoothstep(0.92, 1.0, dayFraction)
  return Math.min(dusk, dawn)
}

/**
 * Owns the renderer, camera, lights and sky. All of the prettiness is tuned here and
 * in palette.ts: soft shadows, warm ambient, horizon-colored fog and a gradient sky
 * that dissolves the distance instead of cutting the world off.
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
  /** Bloom can be disabled on performance drops or when it hurts the image. */
  bloomEnabled = true

  // Reusable colors so the day cycle does not allocate per frame.
  private readonly tmpA = new THREE.Color()
  private readonly tmpB = new THREE.Color()

  constructor(canvas: HTMLCanvasElement, mobileMode = false) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobileMode ? 1.25 : 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    // Soft shadow edges are a key part of the cute look.
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05

    this.camera = new THREE.PerspectiveCamera(
      CAMERA.fov,
      window.innerWidth / window.innerHeight,
      CAMERA.near,
      CAMERA.far,
    )
    // The camera must be in the scene for its children — first-person hands — to render.
    this.scene.add(this.camera)

    // Density is matched to WORLD.viewRadius: at the loaded-area border fog must
    // almost fully hide geometry, or the world's edge shows.
    this.fog = new THREE.FogExp2(SKY.day.fog, mobileMode ? 0.015 : 0.01)
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
    const shadowMapSize = mobileMode ? 1024 : 2048
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize)
    // A tight frustum around the player: sharper shadows than covering the whole world.
    const extent = 42
    this.sun.shadow.camera.left = -extent
    this.sun.shadow.camera.right = extent
    this.sun.shadow.camera.top = extent
    this.sun.shadow.camera.bottom = -extent
    this.sun.shadow.camera.near = 0.5
    this.sun.shadow.camera.far = 220
    // Without this bias voxels get striped self-shadowing artifacts.
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

    // Post-processing. The threshold is deliberately above 1: only projectiles and
    // the boss's emissive eyes should glow, not every sunlit patch of grass.
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    // High threshold, low strength. The scene is already brightly lit, and around a
    // threshold of 1 bloom grabbed the boss's white eyes and teeth, blowing him out.
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.28,
      0.3,
      2.4,
    )
    this.composer.addPass(this.bloom)
    // OutputPass performs tonemapping and the sRGB conversion at composer output —
    // materials don't do that when rendering into an intermediate target.
    this.composer.addPass(new OutputPass())
    this.composer.setSize(window.innerWidth, window.innerHeight)
    this.bloomEnabled = !mobileMode

    window.addEventListener('resize', this.onResize)
  }

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.composer.setSize(window.innerWidth, window.innerHeight)
  }

  /**
   * Recolors the sky, fog and lights for the current time of day.
   * @param dayFraction fraction of the day in [0, 1).
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

    // The sun travels the sky so shadows move. It never dips below the horizon —
    // otherwise shadows vanish at night and the image goes flat.
    const angle = dayFraction * Math.PI * 2 - Math.PI / 2
    this.sunDirection.set(Math.cos(angle) * 0.7, Math.max(0.35, Math.sin(angle)), 0.42)
  }

  private readonly sunDirection = new THREE.Vector3(0.7, 1, 0.42)

  private lerpHex(a: number, b: number, t: number): THREE.Color {
    this.tmpA.setHex(a)
    this.tmpB.setHex(b)
    return this.tmpA.lerp(this.tmpB, t)
  }

  /** Anchors the shadow frustum and the sky dome to the player. */
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
