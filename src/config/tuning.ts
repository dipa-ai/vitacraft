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
  /** Период тика симуляции воды, секунды (5 Гц). */
  waterTick: 0.2,
  /** Не больше столько водяных клеток за тик — вода течёт спокойно и не съедает кадр. */
  waterBudget: 48,
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
  /** Регенерация: пауза после последнего урона и период восстановления сердечка. */
  regenDelay: 6.0,
  regenInterval: 3.0,
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
  /** Радиус блуждания смурфика вокруг точки интереса. */
  wanderRadius: 7,
  /** Смурфики приходят пешком с этого расстояния — «от горизонта», а не из воздуха. */
  arriveDistance: 48,
  /** Квест «зверинец»: сколько животных привести. */
  animalsRequired: 3,
  /** Животные идут за морковкой в руках в этом радиусе. */
  animalFollowRadius: 8,
  /** Животное считается приведённым внутри этого радиуса от центра деревни. */
  deliverRadius: 14,
  /** Квест «пруд»: столько клеток воды выше уровня моря рядом с деревней. */
  pondCellsRequired: 9,
  pondScanRadius: 22,
  /** Квест «облачка»: сколько зарядов собрать с ночных врагов. */
  cloudsRequired: 10,
} as const

export const NIGHT = {
  /** Лимит одновременных врагов по стадии квеста: до ночного квеста мягко. */
  maxEnemiesEarly: 2,
  maxEnemiesQuest: 4,
  maxEnemiesLate: 6,
  spawnInterval: 5.0,
  spawnMin: 22,
  spawnMax: 38,
  lurkerHealth: 4,
  lurkerSpeed: 2.7,
  lurkerDamage: 1,
  lurkerTouchCooldown: 1.0,
  /** Смурфик пугается и бежит домой, когда враг ближе. */
  scareRadius: 9,
  cloudDropMin: 1,
  cloudDropMax: 2,
} as const

export const BOSS = {
  maxHealth: 60,
  /** Пороги HP (в долях), на которых меняются фазы. */
  phase2At: 0.66,
  phase3At: 0.33,
  scale: 3.2,
  chaseSpeed: 3.4,
  enrageSpeedBonus: 1.6,
  /** Телеграфы — без них бой нечестный. Кроличьи атаки: прыжок, рывок, подкоп. */
  leapTelegraph: 0.7,
  leapSpeed: 14.0,
  dashTelegraph: 0.45,
  dashSpeed: 16.0,
  dashDuration: 0.55,
  dashDamage: 2,
  burrowTelegraph: 0.5,
  /** Время «под землёй» — дрожь идёт к игроку. */
  burrowTravel: 1.1,
  /** Выныривает не дальше этого от игрока. */
  emergeRadius: 4.0,
  emergeShockRadius: 4.5,
  emergeDamage: 1,
  slamDamage: 3,
  slamRadius: 9.0,
  shockwaveSpeed: 11.0,
  attackCooldown: 2.2,
  spawnDistance: 18,
} as const

export const DAY = {
  /** Длина полных суток в секундах. */
  lengthSeconds: 240,
  /** Доля суток, начиная с которой наступает ночь. */
  nightStart: 0.55,
} as const
