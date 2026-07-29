import * as THREE from 'three'
import { BOSS, CAMERA, DAY, NIGHT, PLAYER, WORLD } from './config/tuning'
import { Boss } from './entities/boss'
import { Combat } from './game/combat'
import { Fauna } from './game/fauna'
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
  <h1>Vita<span class="accent">Craft</span></h1>
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
    <b>F5</b><span>сменить вид: от первого лица ↔ от третьего (или <b>V</b>)</span>
    <b>Esc</b><span>пауза</span>
  </div>
`

const PAUSE_CARD = `
  <h1>Пауза</h1>
  <p>Мир никуда не денется — он ждёт.</p>
`

const DEATH_CARD = `
  <h1>Ой…</h1>
  <p>Витрулян оказался быстрее. Деревня цела — она тебя дождётся.</p>
  <p>Подсказка: от ударной волны спасает <b>прыжок</b> в момент, когда она до тебя доходит.</p>
`

const WIN_CARD = `
  <h1>Витрулян <span class="accent">побеждён!</span></h1>
  <p>Деревня смурфиков в безопасности: большой рыжий кролик ускакал в закат,
  оставив после себя горку разноцветных блоков.</p>
  <p>Мир остаётся твоим: строй дальше сколько хочешь.</p>
`

/** Фазы прохождения. */
type Stage = 'village' | 'boss-incoming' | 'boss' | 'won'

class Game {
  private readonly canvas = document.getElementById('game') as HTMLCanvasElement
  private readonly rig = new SceneRig(this.canvas)
  private readonly world = new World()
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
  /**
   * Разрешено ли писать сохранение при закрытии страницы. Сбрасывается кнопкой
   * «Начать заново»: без этого флага обработчик beforeunload успевает записать старое
   * состояние обратно уже после clearSave(), и сброс не работает вообще.
   */
  private saveOnExit = true

  private stage: Stage = 'village'
  private boss: Boss | null = null
  /** Задержка между «деревня готова» и появлением босса. */
  private bossCountdown = 0
  private readonly spawnPoint = new THREE.Vector3()

  private readonly clock = new THREE.Clock()
  private dayTime = DAY.lengthSeconds * 0.15
  private elapsed = 0
  private paused = true

  private lastChunkX = Number.NaN
  private lastChunkZ = Number.NaN
  private lastHealth = -1
  private lastHotbarKey = ''

  // Переиспользуемые векторы: в цикле кадра аллокации ни к чему.
  private readonly head = new THREE.Vector3()
  private readonly back = new THREE.Vector3()

  constructor() {
    this.rig.scene.add(this.world.group)
    // Порядок YXZ — стандартный для управления от первого лица: рыскание вокруг мировой
    // вертикали, тангаж вокруг локальной оси камеры.
    this.rig.camera.rotation.order = 'YXZ'

    this.controls = new Controls(this.canvas, this.player)
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
    this.wireControls()
    this.wireVillage()
    this.wireCombat()
    this.wireNight()
    this.spawn()
  }

  private wireCombat(): void {
    // ЛКМ обслуживает и бой, и копание: Interaction сам решает по дистанции, что ближе.
    this.interact.entityRaycaster = (origin, direction, maxDistance) =>
      this.combat.raycastEntities(origin, direction, maxDistance)
    this.controls.onThrow = () => {
      // Сначала заряд, потом бросок: облачки — добываемый ресурс, а не бесконечная кнопка.
      if (!this.interact.consumeCloud()) {
        this.hud.toastOnce('no-cloud', 'Нет облачков! Они выпадают из ночных зверюшек')
        return
      }
      if (!this.combat.throwFromPlayer()) {
        // Бросок не случился из-за кулдауна — заряд возвращаем.
        this.interact.add(Block.Cloud)
        return
      }
      this.audio.throwBlob()
      this.hud.toastOnce('throw', 'Облачко летит по дуге — целься чуть выше')
    }
    this.interact.onMelee = () => this.audio.hitBoss()
    this.combat.onBossHurt = () => this.audio.hitBoss()
    this.combat.onPlayerHurt = () => {
      this.audio.hurt()
      if (this.player.dead) {
        this.night.markPlayerDied()
        this.showDeath()
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
      // Первая добытая морковка — подсказка, как ей пользоваться.
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
      // Для одношаговых заданий счётчик «1 из 1» — шум, а не информация.
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
      // Ночь наступает вместе с боссом: смена освещения делает событие событием.
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
    this.night.onBite = (damage) => this.combat.touchPlayer(damage)
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
      // Открыта панель ресурсов — колесо листает её, а не слоты: в захваченном
      // курсоре это единственный способ добраться до нижних строк.
      if (this.hud.resourcesOpen) {
        this.hud.scrollResources(direction * 110)
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
    this.controls.onToggleResources = () => this.hud.toggleResources()
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
    // Единая точка правды для дверных мешей: любое изменение блока может создать,
    // убрать или переключить дверь.
    this.interact.onBlockChanged = (x, y, z) => this.doors.onBlockChanged(x, y, z)
  }

  /** Имя и краткое описание того, что сейчас в руке. */
  private showItemLabel(): void {
    const def = blockDef(this.interact.activeBlock)
    this.hud.showItemName(def.name, def.description)
  }

  private spawn(): void {
    // Правки игрока заряжаем ДО генерации: чанки применяют их при создании, иначе
    // постройки восстановились бы только в тех чанках, что сгенерируются позже.
    const saved = loadGame()
    const restorable = saved !== null && saved.seed === WORLD.seed
    if (restorable) {
      for (const [key, id] of Object.entries(saved.edits)) {
        this.world.edits.set(key, id as Block)
      }
      this.dayTime = saved.dayTime
    }

    this.world.ensureAround(0, 0)
    this.world.flushRemesh(25)
    const y = this.world.surfaceY(0.5, 0.5)
    this.spawnPoint.set(0.5, y, 0.5)
    this.player.respawn(0.5, y, 0.5)

    if (restorable) this.restore(saved)

    this.rig.setTimeOfDay(this.dayFraction())
    this.rig.follow(this.player.position)

    // Камера и HUD обновляются только в update(), а он не идёт на паузе. Без этого
    // за стартовым экраном был бы пустой кадр вместо мира.
    this.updateCamera()
    this.updatePlayerModel(0)
    this.hud.setHealth(this.player.health)
    this.hud.setHotbar(this.interact.activeSlot, this.interact.hotbarCounts())
    this.village.start()
  }

  /** Восстанавливает партию. Мир к этому моменту уже собран с правками игрока. */
  private restore(saved: SaveData): void {
    this.player.position.set(saved.player.x, saved.player.y, saved.player.z)
    this.player.yaw = saved.player.yaw
    this.player.pitch = saved.player.pitch
    this.player.health = saved.player.health
    restoreInventory(this.interact.inventory, saved.inventory)

    // Стадию ставим до пересборки домов: иначе пятый дом снова запустил бы приход босса
    // у игрока, который его уже победил.
    this.stage = saved.stage === 'won' ? 'won' : 'village'

    // Дома пересобираем прогоном той же проверки, что и при обычной установке кроватки —
    // отдельного формата для домов не держим, чтобы правила были ровно одни.
    // Блок читаем из мира: в старых сохранениях кроватка одноклеточная, в новых — парная.
    this.village.restoreProgress(saved.quest)
    for (const [x, y, z] of saved.beds) {
      this.village.handleBlockPlaced(x, y, z, this.world.getVoxel(x, y, z))
    }
    this.doors.rebuildFromEdits()
    // Приведённые животные хранятся числом — расставляем их заново по деревне.
    this.fauna.restoreDelivered(saved.quest.animals, this.village.center())

    // Незаконченный бой не сохраняем: босс придёт заново, а не окажется полумёртвым
    // и невидимым.
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
    // Сохраняемся и при закрытии вкладки, а не только по таймеру.
    window.addEventListener('beforeunload', () => {
      if (this.saveOnExit) saveGame(this.collectSave())
    })
    this.loop()
  }

  private showStart(): void {
    this.paused = true
    const hasSave = this.world.edits.size > 0
    const labels = hasSave ? ['Играть', 'Начать заново'] : ['Играть']
    const [play, reset] = this.hud.showCard(START_CARD, labels)
    play.addEventListener('click', () => this.resume())
    reset?.addEventListener('click', () => {
      // Порядок важен: сначала запрещаем запись на выходе, потом чистим и перезагружаем.
      this.saveOnExit = false
      clearSave()
      location.reload()
    })
  }

  private showPause(): void {
    this.paused = true
    saveGame(this.collectSave())
    const [button] = this.hud.showCard(PAUSE_CARD, ['Продолжить'])
    button.addEventListener('click', () => this.resume())
  }

  private showDeath(): void {
    this.paused = true
    document.exitPointerLock()
    this.audio.defeat()
    const [button] = this.hud.showCard(DEATH_CARD, ['Ещё раз'])
    button.addEventListener('click', () => {
      this.respawnAfterDeath()
      this.resume()
    })
  }

  private showWin(): void {
    this.paused = true
    document.exitPointerLock()
    this.hud.setBoss(false)
    this.audio.victory()
    saveGame(this.collectSave())
    const [button] = this.hud.showCard(WIN_CARD, ['Гулять дальше'])
    button.addEventListener('click', () => this.resume())
  }

  /**
   * После смерти игрок возвращается на точку спавна, а босс отходит к своей и успокаивается.
   * Здоровье босса намеренно не восстанавливается: терять весь прогресс боя из-за одной
   * ошибки — слишком суровое наказание для игры с таким настроением.
   */
  private respawnAfterDeath(): void {
    this.combat.clear()
    this.night.scatter()
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

  /** Витрулян приходит из темноты в стороне от деревни. */
  private spawnBoss(): void {
    const angle = Math.random() * Math.PI * 2
    const x = this.player.position.x + Math.cos(angle) * BOSS.spawnDistance
    const z = this.player.position.z + Math.sin(angle) * BOSS.spawnDistance
    // Прогружаем чанки под боссом, иначе он появится над необсчитанной пустотой и упадёт.
    this.world.ensureAround(x, z)
    this.world.flushRemesh(9)

    const boss = new Boss(new THREE.Vector3(x, this.world.surfaceY(x, z) + 1, z))
    boss.onSlam = (origin, radius, damage) => {
      this.combat.slam(origin, radius, damage)
      this.audio.bossSlam()
    }
    boss.onTouch = (damage) => {
      this.combat.touchPlayer(damage)
      this.audio.bossSpit()
    }
    boss.onTremor = (position) => {
      // Дрожь земли — телеграф подкопа: игрок видит, куда кролик вынырнет.
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

    // Босс разлетается на безобидные цветные блоки — их можно забрать себе.
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
    // Возвращаем день: победа должна ощущаться как рассвет.
    this.dayTime = DAY.lengthSeconds * 0.12
    this.showWin()
  }

  private resume(): void {
    this.hud.hideCard()
    this.paused = false
    // Только из обработчика клика браузер разрешает запустить аудиоконтекст.
    this.audio.unlock()
    this.controls.requestLock()
  }

  private readonly loop = (): void => {
    // Ограничение шага: на просадке кадра длинный dt мог бы протащить игрока сквозь пол.
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
    // Звук прыжка по факту отрыва от земли, а не по нажатию: в воздухе Space ничего не даёт.
    if (wasOnGround && !this.player.onGround && this.player.velocity.y > 0) this.audio.jump()

    this.interact.update(dt, this.controls.attackHeld)

    // Ночь: лимит врагов растёт со стадией квеста, чтобы первая ночь была обучающей.
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

    // Сверка дверных мешей с блоками: визуал никогда не должен врать про дверь.
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

  /** Прогружает мир только при переходе в новый чанк, а не каждый кадр. */
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
    // Перед модели смотрит в -Z, и в этой же системе задан yaw — поворот берётся напрямую.
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
      // Тряска нужна в обоих видах, поэтому прибавляется и здесь тоже.
      camera.position.add(this.fx.shake)
      return
    }

    this.playerModel.group.visible = true
    this.player.lookDirection(this.back).negate()

    // Поджимаем камеру, если позади стена: иначе она уезжает внутрь геометрии.
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

  /** Трогаем DOM только когда значения реально изменились. */
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

// Ссылку держим, чтобы игру не собрал сборщик мусора и её было видно из консоли.
const game = new Game()
game.start()
Object.assign(window, { game, WORLD, PLAYER })
