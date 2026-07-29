/** Все игровые числа в одном месте, чтобы баланс правился без охоты по коду. */

export const WORLD = {
  /** Чанк 16×64×16 вокселей. */
  chunkSizeX: 16,
  chunkSizeY: 64,
  chunkSizeZ: 16,
  /** Радиус прогрузки чанков вокруг игрока. Согласован с плотностью тумана в scene.ts:
   * туман должен скрывать край прогруженной области, иначе виден обрыв мира. */
  viewRadius: 6,
  seaLevel: 26,
  /** Не больше столько перестроек мешей за кадр — иначе фризы при активной стройке. */
  remeshPerFrame: 2,
  seed: 1337,
} as const

export const PLAYER = {
  width: 0.6,
  height: 1.8,
  /** Глаза чуть ниже макушки. */
  eyeHeight: 1.62,
  walkSpeed: 4.6,
  runSpeed: 7.0,
  jumpSpeed: 8.4,
  gravity: 26.0,
  /** В воде медленнее и с выталкиванием наверх. */
  swimSpeed: 3.0,
  swimBuoyancy: 6.0,
  maxHealth: 10,
  /** Неуязвимость после получения урона, секунды. */
  invulnerable: 0.5,
  reach: 5.0,
  /** Ломать блоки заметно быстрее, чем бить: удержание ЛКМ должно сносить стену потоком. */
  blockBreakCooldown: 0.2,
  meleeRange: 3.2,
  meleeDamage: 2,
  meleeCooldown: 0.45,
  throwCooldown: 0.6,
  throwSpeed: 22.0,
  throwDamage: 3,
} as const

export const CAMERA = {
  fov: 72,
  near: 0.1,
  far: 400,
  /** Отступ камеры в третьем лице и её минимальное поджатие у стены. */
  thirdPersonDistance: 5.0,
  thirdPersonHeight: 0.6,
  thirdPersonMinDistance: 1.2,
  mouseSensitivity: 0.0022,
} as const

export const VILLAGE = {
  /** Сколько домов нужно, чтобы деревня считалась готовой. */
  housesRequired: 5,
  /** Лимит flood-fill: вышли за него — комната «протекает», это не дом. */
  floodFillBudget: 300,
  /** Минимальный внутренний объём комнаты в воксельных клетках. */
  minRoomVolume: 8,
  smurfSpeed: 1.9,
  /** Радиус блуждания смурфика вокруг своего дома. */
  wanderRadius: 7,
} as const

export const BOSS = {
  maxHealth: 60,
  /** Пороги HP (в долях), на которых меняются фазы. */
  phase2At: 0.66,
  phase3At: 0.33,
  scale: 3.2,
  chaseSpeed: 3.4,
  enrageSpeedBonus: 1.6,
  /** Телеграфы — без них бой нечестный. */
  slamTelegraph: 0.6,
  spitTelegraph: 0.4,
  slamDamage: 3,
  spitDamage: 2,
  slamRadius: 9.0,
  shockwaveSpeed: 11.0,
  spitSpeed: 15.0,
  attackCooldown: 2.2,
  enrageCooldownScale: 0.6,
  spawnDistance: 18,
} as const

export const DAY = {
  /** Длина полных суток в секундах. */
  lengthSeconds: 240,
  /** Доля суток, начиная с которой наступает ночь. */
  nightStart: 0.55,
} as const
