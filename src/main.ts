import * as THREE from 'three'
import logoUrl from './assets/vitacraft-logo.png?url'
import { BOSS, CAMERA, DAY, NIGHT, PLAYER, WORLD } from './config/tuning'
import { Boss } from './entities/boss'
import { Combat } from './game/combat'
import { Fauna } from './game/fauna'
import { deathCard, type DamageSource } from './game/death'
import { NightManager } from './game/night'
import { Village } from './game/quest'
import { Controls } from './player/controls'
import { Interaction } from './player/interact'
import { Player } from './player/player'
import { Audio } from './render/audio'
import { DoorVisuals } from './render/doors'
import { Fx } from './render/fx'
import { createPlayerModel } from './render/models'
import { SceneRig } from './render/scene'
import { Viewmodel } from './render/viewmodel'
import {
  clearSave,
  loadGame,
  restoreInventory,
  saveGame,
  serializeInventory,
  type SaveData,
} from './save'
import { Hud } from './ui/hud'
import { FX_COLORS } from './config/palette'
import { Block, HOTBAR_BLOCKS, blockDef, isSolid } from './world/blocks'
import { raycastVoxels } from './world/raycast'
import { World, toChunkCoord } from './world/world'

const START_CARD = `
  <div class="start-art">
    <img src="${logoUrl}" alt="VitaCraft">
  </div>
`

const DESKTOP_HELP_CONTENT = `
  <h2>Управление</h2>
  <p>Мягкий воксельный мир, деревня для смурфиков, ночи с тёмными зверюшками
  и один очень большой рыжий кролик.</p>
  <div class="keys">
    <b>WASD</b><span>идти, <b>Shift</b> — бежать</span>
    <b>Space</b><span>прыжок</span>
    <b>ЛКМ</b><span>ломать блок или ударить</span>
    <b>ПКМ</b><span>поставить блок; по двери — открыть или закрыть</span>
    <b>F</b><span>метнуть облачко (добывается из ночных зверюшек)</span>
    <b>1–9</b><span>выбрать блок, колесо крутит все слоты</span>
    <b>Tab</b><span>панель ресурсов: что это и где взять</span>
    <b>Q</b><span>показать или скрыть эту справку</span>
    <b>F5</b><span>сменить вид: от первого лица ↔ от третьего (или <b>V</b>)</span>
    <b>Esc</b><span>пауза</span>
  </div>
  <p class="help-footer">Нажми <b>Q</b>, чтобы вернуться в игру</p>
`

const TOUCH_HELP_CONTENT = `
  <h2>Управление на телефоне</h2>
  <p>Мягкий воксельный мир, деревня для смурфиков, ночи с тёмными зверюшками
  и один очень большой рыжий кролик.</p>
  <div class="keys">
    <b>Левый стик</b><span>идти; отклони до края, чтобы бежать</span>
    <b>Свайп справа</b><span>поворачивать камеру</span>
    <b>↑</b><span>прыжок</span>
    <b>⛏</b><span>удерживать, чтобы ломать блок или атаковать</span>
    <b>＋</b><span>поставить блок; по двери — открыть или закрыть</span>
    <b>☁</b><span>метнуть облачко</span>
    <b>Хотбар</b><span>коснись слота; проведи по панели для прокрутки</span>
    <b>▦</b><span>панель ресурсов: что это и где взять</span>
    <b>◉</b><span>сменить вид от первого или третьего лица</span>
    <b>⛶</b><span>включить или выключить полный экран</span>
    <b>Ⅱ</b><span>пауза</span>
  </div>
  <p class="help-footer">Нажми <b>?</b>, чтобы вернуться в игру</p>
`

const PAUSE_CARD = `
  <h1>Пауза</h1>
  <p>Мир никуда не денется — он ждёт.</p>
`

const FULLSCREEN_HELP = `
  <h1>Полный экран</h1>
  <p>Этот браузер не разрешает странице самостоятельно скрыть адресную строку и кнопки.</p>
  <p><b>iPhone / iPad:</b> нажми «Поделиться» → «На экран Домой», затем запускай
  VitaCraft с новой иконки.</p>
  <p><b>Android:</b> открой меню браузера → «Установить приложение» или
  «Добавить на главный экран».</p>
`

const WIN_CARD = `
  <h1>Витрулян <span class="accent">побеждён!</span></h1>
  <p>Деревня смурфиков в безопасности: большой рыжий кролик ускакал в закат,
  оставив после себя горку разноцветных блоков.</p>
  <p>Мир остаётся твоим: строй дальше сколько хочешь.</p>
`

/** Playthrough stages. */
type Stage = 'village' | 'boss-incoming' | 'boss' | 'won'

class Game {
  private readonly touchPreview =
    import.meta.env.DEV && new URLSearchParams(location.search).get('touch-preview') === '1'
  private readonly fullscreenUnavailablePreview =
    import.meta.env.DEV &&
    new URLSearchParams(location.search).get('fullscreen-unavailable') === '1'
  private readonly touchMode =
    window.matchMedia('(pointer: coarse)').matches ||
    window.matchMedia('(any-pointer: coarse)').matches ||
    navigator.maxTouchPoints > 0 ||
    this.touchPreview
  private readonly portraitMode = window.matchMedia('(orientation: portrait)')
  private readonly canvas = document.getElementById('game') as HTMLCanvasElement
  private readonly rig = new SceneRig(this.canvas, this.touchMode)
  private readonly world = new World(
    WORLD.seed,
    this.touchMode ? WORLD.mobileViewRadius : WORLD.viewRadius,
  )
  private readonly player = new Player()
  private readonly hud = new Hud()
  private readonly controls: Controls
  private readonly interact: Interaction
  private readonly playerModel = createPlayerModel()
  private readonly fx = new Fx(this.rig.scene)
  private readonly audio = new Audio()
  private readonly village: Village
  private readonly combat: Combat
  private readonly doors: DoorVisuals
  private readonly viewmodel: Viewmodel
  private readonly fauna: Fauna
  private readonly night: NightManager
  private saveTimer = 0
  private doorAuditTimer = 1
  private hasStoredSave = false
  /**
   * Whether saving on page close is allowed. Cleared by the "Start over" button:
   * without this flag the beforeunload handler would write the old state back
   * right after clearSave(), and the reset would never work at all.
   */
  private saveOnExit = true

  private stage: Stage = 'village'
  private boss: Boss | null = null
  /** Delay between "village completed" and the boss showing up. */
  private bossCountdown = 0
  private readonly spawnPoint = new THREE.Vector3()

  private readonly clock = new THREE.Clock()
  private dayTime = DAY.lengthSeconds * 0.15
  private elapsed = 0
  private paused = true
  private orientationPaused = false

  private lastChunkX = Number.NaN
  private lastChunkZ = Number.NaN
  private lastHealth = -1
  private lastHotbarKey = ''

  // Reusable vectors: no allocations inside the frame loop.
  private readonly head = new THREE.Vector3()
  private readonly back = new THREE.Vector3()

  constructor() {
    this.rig.scene.add(this.world.group)
    // YXZ order is the standard for first-person controls: yaw around the world
    // vertical, pitch around the camera's local axis.
    this.rig.camera.rotation.order = 'YXZ'

    this.controls = new Controls(
      this.canvas,
      this.player,
      this.touchMode,
      this.fullscreenUnavailablePreview,
    )
    if (this.touchMode) {
      this.portraitMode.addEventListener('change', () => this.handleOrientationChange())
    }
    this.interact = new Interaction(this.world, this.player)
    this.village = new Village(this.world, this.rig.scene, this.player, this.fx)
    this.combat = new Combat(this.world, this.rig.scene, this.player, this.fx)
    this.doors = new DoorVisuals(this.rig.scene, this.world)
    this.viewmodel = new Viewmodel(this.rig.camera)
    this.fauna = new Fauna(this.world, this.rig.scene)
    this.night = new NightManager(this.world, this.rig.scene, this.fx)

    this.rig.scene.add(this.playerModel.group)
    this.playerModel.group.visible = false

    this.hud.buildHotbar(HOTBAR_BLOCKS)
    this.hud.setHelpContent(this.touchMode ? TOUCH_HELP_CONTENT : DESKTOP_HELP_CONTENT)
    this.wireControls()
    this.hud.onSelectSlot = (index) => {
      if (this.touchMode) this.controls.onSelectSlot?.(index)
    }
    this.wireVillage()
    this.wireCombat()
    this.wireNight()
    this.spawn()
  }

  private wireCombat(): void {
    // LMB serves both combat and digging: Interaction picks whichever is closer.
    this.interact.entityRaycaster = (origin, direction, maxDistance) =>
      this.combat.raycastEntities(origin, direction, maxDistance)
    this.controls.onThrow = () => {
      // Ammo first, throw second: clouds are a gathered resource, not an infinite button.
      if (!this.interact.consumeCloud()) {
        this.hud.toastOnce('no-cloud', 'Нет облачков! Они выпадают из ночных зверюшек')
        return
      }
      if (!this.combat.throwFromPlayer()) {
        // The throw was rejected by the cooldown — refund the charge.
        this.interact.add(Block.Cloud)
        return
      }
      this.audio.throwBlob()
      this.hud.toastOnce('throw', 'Облачко летит по дуге — целься чуть выше')
    }
    this.interact.onMelee = () => this.audio.hitBoss()
    this.combat.onBossHurt = () => this.audio.hitBoss()
    this.combat.onPlayerHurt = (source) => {
      this.audio.hurt()
      if (this.player.dead) {
        this.night.markPlayerDied()
        this.showDeath(source)
      }
    }
  }

  private wireVillage(): void {
    this.interact.onPlaced = (x, y, z, block) => {
      const def = blockDef(block)
      this.fx.burst(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), def.topColor ?? def.color, 6, {
        speed: 2,
        size: 0.1,
        life: 0.45,
      })
      this.village.handleBlockPlaced(x, y, z, block)
      this.audio.placeBlock()
      this.viewmodel.placeBump()
    }
    this.interact.onBroken = (x, y, z, block) => {
      const def = blockDef(block)
      this.fx.burst(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), def.topColor ?? def.color, 9, {
        speed: 3,
        size: 0.13,
      })
      this.village.handleBlockBroken(x, y, z, block)
      this.audio.breakBlock()
      // First carrot ever harvested — hint at what it is for.
      if (block === Block.CarrotPlant) {
        this.hud.toastOnce('carrot', 'Морковка! Возьми её в руку — зверюшки пойдут за тобой')
      }
    }

    this.village.onSay = (text) => {
      this.hud.toast(text)
      this.audio.smurfChatter()
    }
    this.village.onHint = (id, text) => this.hud.toastOnce(id, text)
    this.village.onSettled = () => this.audio.smurfSettled()
    this.village.onProgress = (title, done, total) => {
      // For single-step quests a "1 of 1" counter is noise, not information.
      this.hud.setQuest(total > 1 ? `${title}: ${done} из ${total}` : title, done, total)
    }
    this.village.setDoor = (x, y, z, open) => {
      const id = this.world.getVoxel(x, y, z)
      const wantToggle =
        (open && id === Block.DoorClosed) || (!open && id === Block.DoorOpen)
      if (wantToggle) this.interact.toggleDoor(x, y, z)
    }
    this.village.onCompleted = () => {
      if (this.stage !== 'village') return
      this.stage = 'boss-incoming'
      this.bossCountdown = 5
      // Night falls together with the boss: the lighting change makes it an event.
      this.dayTime = DAY.lengthSeconds * 0.72
      this.hud.toast('Все испытания пройдены! Но за холмами кто-то большой и рыжий…', 6000)
      this.fx.addShake(0.5)
    }

    this.fauna.onDelivered = () => {
      this.audio.smurfSettled()
      this.village.markAnimalDelivered()
    }
  }

  private wireNight(): void {
    this.night.onDusk = () => {
      this.hud.toast('Темнеет… Ночью лезут тёмные зверюшки — в доме безопасно', 5000)
      this.audio.bossRoar()
    }
    this.night.onDawn = (survived) => {
      this.hud.toast('Рассвет! Зверюшки растаяли', 3500)
      if (survived) this.village.markNightSurvived()
    }
    this.night.onBite = (damage) => this.combat.touchPlayer(damage, 'night-creature')
    this.night.onCloudDrop = (count, at) => {
      this.interact.add(Block.Cloud, count)
      this.village.markCloudsGathered(count)
      this.fx.hearts(at.clone().setY(at.y + 1), 4)
      this.hud.toast(`+${count} облачк${count === 1 ? 'о' : 'а'}`, 1800)
    }
  }

  private wireControls(): void {
    this.controls.onPlace = () => this.interact.place()
    this.controls.onSelectSlot = (index) => {
      this.interact.selectSlot(index)
      this.showItemLabel()
    }
    this.controls.onCycleSlot = (direction) => {
      // While the resources panel is open the wheel scrolls it instead of the
      // hotbar: with the pointer locked this is the only way to reach lower rows.
      if (this.hud.resourcesOpen) {
        this.hud.scrollResources(direction * 110)
        return
      }
      if (this.hud.helpOpen) {
        this.hud.scrollHelp(direction * 110)
        return
      }
      this.interact.cycleSlot(direction)
      this.showItemLabel()
    }
    this.controls.onUnlock = () => {
      if (!this.paused) this.showPause()
    }
    this.controls.onCameraToggle = (mode) => {
      this.hud.toast(mode === 'first' ? 'Вид: от первого лица' : 'Вид: от третьего лица', 1600)
    }
    this.controls.onToggleResources = () => {
      const open = this.hud.toggleResources()
      this.controls.setTouchPanelOpen(open)
      if (this.touchMode) this.paused = open
    }
    this.controls.onToggleHelp = () => {
      const open = this.hud.toggleHelp()
      this.controls.setTouchPanelOpen(open)
      if (this.touchMode) this.paused = open
    }
    this.controls.onPause = () => {
      if (!this.paused) this.showPause()
    }
    this.controls.onFullscreenUnavailable = () => this.showFullscreenHelp()
    this.interact.onNoRoom = () => {
      this.hud.toastOnce('no-room', 'Тут не встанет — или блоков нет, или ты сам мешаешь')
    }
    this.interact.onScooped = () => {
      this.audio.placeBlock()
      this.viewmodel.placeBump()
    }
    this.interact.onDoorToggled = () => {
      this.audio.placeBlock()
      this.viewmodel.placeBump()
    }
    // Single source of truth for door meshes: any block change may create,
    // remove or toggle a door.
    this.interact.onBlockChanged = (x, y, z) => this.doors.onBlockChanged(x, y, z)
  }

  /** Stops the simulation while a phone is being rotated back to landscape. */
  private handleOrientationChange(): void {
    if (this.portraitMode.matches) {
      if (!this.paused) {
        this.orientationPaused = true
        this.paused = true
        this.controls.release()
      }
      return
    }

    if (this.orientationPaused) {
      this.orientationPaused = false
      this.paused = false
      this.controls.requestLock()
    }
  }

  /** Name and short description of whatever is currently held. */
  private showItemLabel(): void {
    const def = blockDef(this.interact.activeBlock)
    this.hud.showItemName(def.name, def.description)
  }

  private spawn(): void {
    // Player edits are loaded BEFORE generation: chunks apply them on creation;
    // otherwise buildings would only restore in chunks generated later.
    const saved = loadGame()
    this.hasStoredSave = saved !== null
    const restorable = saved !== null && saved.seed === WORLD.seed
    if (restorable) {
      for (const [key, id] of Object.entries(saved.edits)) {
        this.world.edits.set(key, id as Block)
      }
      this.dayTime = saved.dayTime
    }

    // Generate where the restored player actually is. Always generating the origin
    // first leaves a distant save over unloaded void until the first live frame.
    const initialX = restorable ? saved.player.x : 0.5
    const initialZ = restorable ? saved.player.z : 0.5
    this.world.ensureAround(initialX, initialZ)
    this.world.flushRemesh(25)
    this.spawnPoint.set(0.5, this.world.groundY(0.5, 0.5), 0.5)
    this.player.respawn(this.spawnPoint.x, this.spawnPoint.y, this.spawnPoint.z)

    if (restorable) this.restore(saved)
    this.night.restoreAtTime(this.dayFraction())

    this.rig.setTimeOfDay(this.dayFraction())
    this.rig.follow(this.player.position)

    // The camera and the HUD only update in update(), which does not run while
    // paused. Without this the start screen would sit over an empty frame.
    this.updateCamera()
    this.updatePlayerModel(0)
    this.hud.setHealth(this.player.health)
    this.hud.setHotbar(this.interact.activeSlot, this.interact.hotbarCounts())
    this.village.start()
  }

  /** Restores a session. By now the world is already built with player edits. */
  private restore(saved: SaveData): void {
    this.player.position.set(saved.player.x, saved.player.y, saved.player.z)
    this.player.yaw = saved.player.yaw
    this.player.pitch = saved.player.pitch
    this.player.health = saved.player.health
    restoreInventory(this.interact.inventory, saved.inventory)

    // Set the stage before rebuilding houses: otherwise the fifth house would
    // re-trigger the boss arrival for a player who has already beaten him.
    this.stage = saved.stage === 'won' ? 'won' : 'village'

    // Houses are rebuilt by running the same check as a regular bed placement —
    // there is no separate save format for houses, so the rules stay singular.
    // The block is read from the world: old saves hold single-cell beds, new ones pairs.
    // Their chunks may be far from the saved player, so load the room neighborhood
    // before validating it instead of treating unloaded voxels as open air.
    for (const [x, , z] of saved.beds) this.world.ensureChunkAt(x, z)
    this.village.restoreProgress(saved.quest)
    for (const [x, y, z] of saved.beds) {
      this.village.handleBlockPlaced(x, y, z, this.world.getVoxel(x, y, z))
    }
    this.doors.rebuildFromEdits()
    // Delivered animals are stored as a count — place them around the village anew.
    this.fauna.restoreDelivered(saved.quest.animals, this.village.center())

    // An unfinished fight is not saved: the boss arrives fresh instead of
    // popping in half-dead and invisible.
    if (saved.stage === 'boss' || saved.stage === 'boss-incoming') {
      this.stage = 'boss-incoming'
      this.bossCountdown = 6
    }

    if (this.stage === 'won') this.hud.hideQuest()
    this.hud.toast('Партия восстановлена', 2500)
  }

  private collectSave(): SaveData {
    const edits: Record<string, number> = {}
    for (const [key, id] of this.world.edits) edits[key] = id

    return {
      version: 2,
      seed: WORLD.seed,
      edits,
      player: {
        x: this.player.position.x,
        y: this.player.position.y,
        z: this.player.position.z,
        yaw: this.player.yaw,
        pitch: this.player.pitch,
        health: this.player.health,
      },
      inventory: serializeInventory(this.interact.inventory),
      dayTime: this.dayTime,
      stage: this.stage,
      beds: this.village.bedPositions,
      quest: {
        stage: this.village.stage,
        animals: this.village.animalsDelivered,
        night: this.village.nightSurvived,
        clouds: this.village.cloudsGathered,
      },
    }
  }

  private dayFraction(): number {
    return (this.dayTime / DAY.lengthSeconds) % 1
  }

  start(): void {
    document.getElementById('loading')?.remove()
    this.showStart()
    // Save on tab close too, not only on the timer.
    const saveBeforeExit = (): void => {
      if (this.saveOnExit) saveGame(this.collectSave())
    }
    window.addEventListener('beforeunload', saveBeforeExit)
    // Mobile browsers often skip beforeunload when a tab is backgrounded or discarded.
    window.addEventListener('pagehide', saveBeforeExit)
    this.loop()
  }

  private showStart(): void {
    this.paused = true
    const hasSave = this.hasStoredSave
    const labels = hasSave ? ['Играть', 'Начать заново'] : ['Играть']
    const [play, reset] = this.hud.showCard(START_CARD, labels, 'start-card')
    play.addEventListener('click', () => this.resume(true))
    reset?.addEventListener('click', () => {
      // Order matters: forbid save-on-exit first, then clear and reload.
      this.saveOnExit = false
      clearSave()
      location.reload()
    })
  }

  private showPause(): void {
    this.paused = true
    this.controls.release()
    saveGame(this.collectSave())
    const [button] = this.hud.showCard(PAUSE_CARD, ['Продолжить'])
    button.addEventListener('click', () => this.resume())
  }

  private showFullscreenHelp(): void {
    this.paused = true
    this.controls.release()
    const [button] = this.hud.showCard(FULLSCREEN_HELP, ['Продолжить'])
    button.addEventListener('click', () => this.resume())
  }

  private showDeath(source: DamageSource): void {
    this.paused = true
    this.controls.release()
    this.audio.defeat()
    const [button] = this.hud.showCard(deathCard(source), ['Ещё раз'])
    button.addEventListener('click', () => {
      this.respawnAfterDeath()
      this.resume()
    })
  }

  private showWin(): void {
    this.paused = true
    this.controls.release()
    this.hud.setBoss(false)
    this.audio.victory()
    saveGame(this.collectSave())
    const [button] = this.hud.showCard(WIN_CARD, ['Гулять дальше'])
    button.addEventListener('click', () => this.resume())
  }

  /**
   * After death the player returns to the spawn point and the boss backs off and
   * calms down. Boss health deliberately does not reset: losing all fight progress
   * to a single mistake is too harsh for a game with this mood.
   */
  private respawnAfterDeath(): void {
    this.combat.clear()
    this.night.scatter()
    // A long boss chase can unload the original spawn. Recenter before asking
    // surfaceY for collision geometry, or it returns the fallback height over void.
    this.world.ensureAround(this.spawnPoint.x, this.spawnPoint.z)
    this.world.flushRemesh(9)
    this.player.respawn(
      this.spawnPoint.x,
      this.world.surfaceY(this.spawnPoint.x, this.spawnPoint.z),
      this.spawnPoint.z,
    )
    this.lastHealth = -1

    const boss = this.boss
    if (boss !== null && !boss.dead) {
      const angle = Math.random() * Math.PI * 2
      const x = this.spawnPoint.x + Math.cos(angle) * BOSS.spawnDistance
      const z = this.spawnPoint.z + Math.sin(angle) * BOSS.spawnDistance
      boss.position.set(x, this.world.surfaceY(x, z), z)
      boss.velocity.set(0, 0, 0)
      boss.state = 'idle'
    }
  }

  /** Vitrulyan arrives out of the dark, away from the village. */
  private spawnBoss(): void {
    const angle = Math.random() * Math.PI * 2
    const x = this.player.position.x + Math.cos(angle) * BOSS.spawnDistance
    const z = this.player.position.z + Math.sin(angle) * BOSS.spawnDistance
    // Preload chunks under the boss, or he would spawn over ungenerated void and fall.
    this.world.ensureAround(x, z)
    this.world.flushRemesh(9)

    const boss = new Boss(new THREE.Vector3(x, this.world.surfaceY(x, z) + 1, z))
    boss.onSlam = (origin, radius, damage) => {
      this.combat.slam(origin, radius, damage)
      this.audio.bossSlam()
    }
    boss.onTouch = (damage) => {
      this.combat.touchPlayer(damage, 'boss')
      this.audio.bossSpit()
    }
    boss.onTremor = (position) => {
      // Ground tremor telegraphs the burrow: the player sees where the rabbit surfaces.
      this.fx.burst(position, FX_COLORS.dust, 3, { speed: 2.2, size: 0.14, life: 0.4 })
    }
    boss.onRoar = (text) => {
      this.hud.toast(text, 3000)
      this.audio.bossRoar()
    }
    boss.onIntroDone = () => {
      this.hud.toast('Витрулян: «кто трогал мои холмы?!»', 4000)
    }
    boss.onDefeated = () => this.defeatBoss()

    this.rig.scene.add(boss.group)
    this.boss = boss
    this.combat.boss = boss
    this.stage = 'boss'

    this.hud.hideQuest()
    this.hud.setBoss(true, 1, 1)
    this.hud.toast('Витрулян пришёл! Уклоняйся от волны прыжком', 6000)
    this.fx.addShake(1)
  }

  private defeatBoss(): void {
    const boss = this.boss
    if (boss === null) return

    // The boss bursts into harmless colored blocks — free to collect.
    this.fx.burst(boss.center(new THREE.Vector3()), 0xd5b8ff, 40, {
      speed: 9,
      size: 0.4,
      life: 1.6,
      spread: 1.1,
    })
    this.fx.addShake(0.9)
    this.rig.scene.remove(boss.group)
    boss.dispose()
    this.boss = null
    this.combat.boss = null
    this.combat.clear()

    this.stage = 'won'
    // Bring the day back: victory should feel like a sunrise.
    this.dayTime = DAY.lengthSeconds * 0.12
    this.showWin()
  }

  private resume(enterFullscreen = false): void {
    this.hud.hideCard()
    this.paused = false
    this.controls.setTouchPanelOpen(false)
    // Browsers only allow starting an audio context from a click handler.
    this.audio.unlock()
    if (
      enterFullscreen &&
      !this.touchPreview &&
      !this.controls.requestFullscreen()
    ) {
      this.hud.toastOnce(
        'fullscreen-home-screen',
        'Для игры без панелей нажми ⛶ и добавь VitaCraft на экран Домой',
        6200,
      )
    }
    this.controls.requestLock()
  }

  private readonly loop = (): void => {
    // Step clamp: on a frame hitch a long dt could drag the player through the floor.
    const dt = Math.min(this.clock.getDelta(), 1 / 30)
    if (!this.paused) this.update(dt)
    this.rig.render()
    requestAnimationFrame(this.loop)
  }

  private update(dt: number): void {
    this.elapsed += dt
    this.dayTime += dt

    const wasOnGround = this.player.onGround
    this.player.update(dt, this.controls.input, this.world)
    // Jump sound on actual liftoff, not on key press: Space does nothing mid-air.
    if (wasOnGround && !this.player.onGround && this.player.velocity.y > 0) this.audio.jump()

    this.interact.update(dt, this.controls.attackHeld)

    // Night: the enemy cap grows with quest stage so the first night stays a tutorial.
    this.night.maxEnemies = this.village.completed
      ? NIGHT.maxEnemiesLate
      : this.village.stage >= 3
        ? NIGHT.maxEnemiesQuest
        : NIGHT.maxEnemiesEarly
    this.night.update(dt, this.elapsed, this.dayFraction(), this.player.position, this.village.residents)
    this.combat.enemies = this.night.lurkers

    this.village.threats = this.night.threatPositions
    this.village.night = this.night.isNight
    this.village.update(dt, this.elapsed)

    this.fauna.update(
      dt,
      this.elapsed,
      this.player.position,
      this.interact.holdingCarrot,
      this.village.center(),
      this.village.threats,
    )

    this.updateBossStage(dt)
    this.combat.update(dt)
    this.fx.update(dt)

    this.streamChunks()
    this.world.update(dt)

    this.updatePlayerModel(dt)
    this.updateCamera()

    this.viewmodel.setItem(this.interact.activeBlock)
    this.viewmodel.update(
      dt,
      this.elapsed,
      Math.hypot(this.player.velocity.x, this.player.velocity.z),
      this.controls.attackHeld,
      this.controls.cameraMode === 'first',
    )

    this.rig.setTimeOfDay(this.dayFraction())
    this.rig.follow(this.player.position)
    this.refreshHud()

    this.saveTimer -= dt
    if (this.saveTimer <= 0) {
      this.saveTimer = 15
      saveGame(this.collectSave())
    }

    // Reconcile door meshes with blocks: visuals must never lie about a door.
    this.doorAuditTimer -= dt
    if (this.doorAuditTimer <= 0) {
      this.doorAuditTimer = 1
      this.doors.audit()
    }
  }

  private updateBossStage(dt: number): void {
    if (this.stage === 'boss-incoming') {
      this.bossCountdown -= dt
      if (this.bossCountdown <= 0) this.spawnBoss()
      return
    }

    const boss = this.boss
    if (boss === null) return

    boss.update(dt, this.world, this.elapsed, this.player.position)
    this.hud.setBoss(!boss.dead, boss.healthFraction, boss.phase)
  }

  /** Streams the world only when entering a new chunk, not every frame. */
  private streamChunks(): void {
    const cx = toChunkCoord(this.player.position.x)
    const cz = toChunkCoord(this.player.position.z)
    if (cx === this.lastChunkX && cz === this.lastChunkZ) return
    this.lastChunkX = cx
    this.lastChunkZ = cz
    this.world.ensureAround(this.player.position.x, this.player.position.z)
  }

  private updatePlayerModel(dt: number): void {
    const model = this.playerModel
    model.group.position.copy(this.player.position)
    // The model faces -Z and yaw is defined in the same frame — used directly.
    model.group.rotation.y = this.player.yaw
    const speed = Math.hypot(this.player.velocity.x, this.player.velocity.z)
    model.animate(this.elapsed, speed, dt)
  }

  private updateCamera(): void {
    const camera = this.rig.camera
    const head = this.player.eyePosition(this.head)

    if (this.controls.cameraMode === 'first') {
      this.playerModel.group.visible = false
      camera.position.copy(head)
      camera.rotation.set(this.player.pitch, this.player.yaw, 0)
      // Shake applies in both camera modes, so it is added here as well.
      camera.position.add(this.fx.shake)
      return
    }

    this.playerModel.group.visible = true
    this.player.lookDirection(this.back).negate()

    // Pull the camera in when a wall is behind: otherwise it dives into geometry.
    let distance: number = CAMERA.thirdPersonDistance
    const blocked = raycastVoxels(
      this.world.reader,
      head.x,
      head.y,
      head.z,
      this.back.x,
      this.back.y,
      this.back.z,
      distance,
      isSolid,
    )
    if (blocked !== null) {
      distance = Math.max(CAMERA.thirdPersonMinDistance, blocked.distance - 0.35)
    }

    camera.position.copy(head).addScaledVector(this.back, distance)
    camera.position.y += CAMERA.thirdPersonHeight
    camera.lookAt(head)
    camera.position.add(this.fx.shake)
  }

  /** Touch the DOM only when values actually changed. */
  private refreshHud(): void {
    if (this.player.health !== this.lastHealth) {
      this.lastHealth = this.player.health
      this.hud.setHealth(this.player.health)
    }

    const counts = this.interact.hotbarCounts()
    const key = `${this.interact.activeSlot}|${counts.join(',')}`
    if (key !== this.lastHotbarKey) {
      this.lastHotbarKey = key
      this.hud.setHotbar(this.interact.activeSlot, counts)
    }

    this.hud.setCrosshairActive(this.interact.currentTarget() !== null)
  }
}

// Keep the reference so the game is not GC'd and stays reachable from the console.
const game = new Game()
game.start()
Object.assign(window, { game, WORLD, PLAYER })
