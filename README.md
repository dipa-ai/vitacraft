# VitaCraft

A soft voxel game in the browser: build a village for smurfs, bring animals home,
dig a pond, survive nights with dark creatures — then defeat Vitruylan, the big
ginger rabbit. Game graphics and sound are generated in code; the title logo is
the only bundled image asset.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
```

Other commands:

```bash
npm run build      # production bundle in dist/
npm run typecheck  # tsc --noEmit
npm test           # unit tests (vitest)
```

## Controls

| Key | Action |
|---|---|
| `WASD` | walk, `Shift` — sprint |
| `Space` | jump (and swim up in water) |
| LMB | break a block or hit; with water in hand — scoop water |
| RMB | place a block; on a door — open/close |
| `F` | throw a cloud (charges drop from night creatures) |
| `1`–`9`, mouse wheel | select a block; wheel cycles all slots |
| `Tab` | resources panel: what it is and where to get it |
| `Q` | show or hide the controls help |
| `F5` or `V` | toggle view: first person ↔ third person |
| `Esc` | pause |

On touch devices, use the left stick to move and drag the right side of the
screen to look. The four action buttons jump, break/attack, place/use, and throw
a cloud. Tap or swipe the hotbar to select items; the top-right buttons open
pause, camera, resources, and controls.

## How to play

Quests come from the **elder** — the first settled smurf in a red hat:

1. **Village.** A house is a mushroom bed (two blocks) in a sealed room. Glass
   counts as a wall (windows are fine), and so does a **door** — open or closed:
   place a door so smurfs can walk inside. Break a wall and the resident leaves;
   seal it again and a new one arrives. You need 5 houses.
2. **Menagerie.** Hold a carrot (from carrot patches) — nearby animals follow.
   Lead three into the village.
3. **Pond.** Dig a hole near the village and pour water from a bucket. Water
   flows and fills pits on its own; scoop from any body of water.
4. **Night.** With darkness come dark creatures. Inside a sealed house you are
   safe: they do not pass through walls or closed doors. Smurfs hide on their
   own. Survive the night.
5. **Clouds.** Night creatures drop clouds — collect 10. These are charges for
   the throwable (`F`).

After that **Vitruylan** arrives — a giant ginger rabbit. Attacks are fair; each
has a telegraph: before a **leap** he crouches and pins his ears (the landing
shockwave only hits you on the ground — dodge by jumping), before a **dash** he
leans forward, before a **burrow** he digs — tremor crawls toward the emerge
spot. He does not destroy buildings.

Health regenerates on its own after a few seconds without damage. Progress is
saved to localStorage automatically; the start screen has “Начать заново”
(Start over).

## Code layout

```
src/
├── assets/        bundled image assets
├── config/        palette and gameplay numbers — tweak look and balance here
├── world/         blocks, chunks, mesher, terrain, water, voxel raycast
├── player/        physics, input, break/place, paired blocks, bucket
├── entities/      entity base, smurf, animals, night creatures, boss, projectiles
├── game/          house validator, quest chain, fauna, night, combat
├── render/        scene and light, creature models, doors, particles, audio
└── ui/            HUD, resources panel, and full-screen cards
```

Design decisions the game rests on:

1. **Vertex AO instead of textures.** The mesher writes color and baked shading
   into vertex attributes. Natural blocks get per-voxel brightness variation;
   build blocks almost none.
2. **House = flood-fill from a bed with a limit**, and the “wall” rule is split
   into two predicates: `isSolid` (physics) and `sealsRoom` (airtightness). A
   closed door is impassable, an open door is passable — but both seal the room.
   That is what lets houses have doors and smurfs walk inside.
3. **Leveled water (4…1).** Flows down without losing level, sideways with a
   loss, so a pond bounds itself. Water is not written to the save: after load
   it reflows from sources.
4. **“Safe indoors at night” is physics**, not an “player is inside” check:
   enemies simply do not pass through walls or closed doors. Enemies do not
   break blocks.
5. **Creature spawn from terrain height** (`groundY` from pure terrain math),
   not the top solid block: otherwise smurfs spawned on treetops and fell. Outside
   loaded chunks, arrivals walk the terrain kinematically.
6. **Rounded shapes only on creatures.** World blocks are sharp cubes; smurfs,
   animals, night creatures, and the rabbit are built from `RoundedBoxGeometry`.

The world is not saved whole: it is deterministically rebuilt from a seed;
localStorage only stores a diff of player-changed blocks plus quest progress.

The voxel core (face-culling mesher, DDA raycast) is based on the official
Three.js manual and adapted for vertex colors.
