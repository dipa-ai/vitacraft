# Repository Guidelines

## Project Structure & Module Organization

VitaCraft is a browser-based voxel game built with TypeScript, Three.js, and Vite. Application code lives in `src/`, organized by responsibility:

- `config/` contains the visual palette and gameplay tuning constants.
- `world/` implements blocks, chunks, terrain, water, meshing, and raycasting.
- `player/`, `entities/`, and `game/` contain controls, actors, quests, combat, and simulation rules.
- `render/` owns scene setup, models, effects, doors, and generated audio.
- `ui/` contains the HUD and full-screen cards.
- `assets/` contains bundled images such as the title logo.

Tests are colocated with their modules as `*.test.ts`. The root `index.html` is the Vite entry page; production output goes to `dist/`. Most graphics and sound are generated in code; imported image files belong in `src/assets/`.

## Build, Test, and Development Commands

- `npm ci` installs the exact dependency versions from `package-lock.json`.
- `npm run dev` starts the development server at `http://localhost:5173`.
- `npm run typecheck` runs strict TypeScript checks without emitting files.
- `npm test` runs the Vitest suite once.
- `npm run build` creates the production bundle in `dist/`.
- `npm run preview` serves the built bundle for a final local check.

Before opening a pull request, run `npm run typecheck`, `npm test`, and `npm run build`.

## Coding Style & Naming Conventions

Follow the existing TypeScript style: two-space indentation, single quotes, no semicolons, and trailing commas in multiline constructs. Keep files and folders lowercase; use `camelCase` for functions and variables, `PascalCase` for classes and types, and uppercase names for shared tuning objects such as `PLAYER` or `WORLD`. Preserve strict typing and avoid unused declarations. Put balance values in `src/config/tuning.ts` and colors in `src/config/palette.ts` rather than scattering literals through gameplay code.

## Testing Guidelines

Use Vitest with `describe`, `it`, and `expect`. Name tests after observable behavior and keep regression tests beside the affected module. There is no enforced coverage threshold; prioritize deterministic tests for world rules, geometry, saving, and gameplay edge cases.

## Commit & Pull Request Guidelines

Recent commits use short, specific English subject lines describing the player-visible change. Keep each commit focused and use the same concise, sentence-style convention. Pull requests should summarize behavior changes, list verification commands, and note save-data or tuning impacts. Link relevant issues and include screenshots or a short capture for visible gameplay or UI changes.
