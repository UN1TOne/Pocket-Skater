# 🛹 Pocket Skater

A portrait-first, toy-box styled 3D skateboarding web game. Build your own skate park on a grid,
then ride it yourself or let a NavMesh-driven AI shred it for you.

**Stack:** React 18 · TypeScript · Vite · BabylonJS 8 · Havok Physics · Recast/Detour (navmesh) · styled-components · Zustand

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production bundle in dist/
npm run preview   # serve the production build
```

> Assets: Kenney "Skate Park Kit" (CC0) — `public/assets/models/*.glb`, previews in `public/assets/images/preview/`.
> Backgrounds live in `public/assets/images/bg/`.

---

## Directory structure

```
pocket-skater/
├─ index.html
├─ vite.config.ts                 # @ alias, Havok wasm excluded from pre-bundling, chunking
├─ public/assets/
│  ├─ models/*.glb               # 43 Kenney skate-park pieces + 2 characters + 2 rides
│  ├─ models/Textures/colormap.png
│  ├─ images/preview/*.png       # item thumbnails for the builder sheet
│  └─ images/bg/{landing,sky,dusk}.png
└─ src/
   ├─ main.tsx / App.tsx         # ThemeProvider + page router (driven by the store)
   ├─ types/game.ts              # Page, CharacterId, RideId, PlayMode, CatalogItem, PlacedItem, MapData
   ├─ data/
   │  ├─ catalog.ts              # item catalog (id ⇄ glb/preview), categories, URL helpers
   │  └─ presets.ts              # "Sunset Plaza" & "Mini Bowl" preset maps (grid data)
   ├─ store/useGameStore.ts      # Zustand store (persisted: custom map + setup)
   ├─ styles/                    # theme tokens, global style, keyframes
   ├─ ui/primitives.tsx          # Stage (phone frame), Button, IconButton, Card, Chip…
   ├─ engine/                    # BabylonJS layer (framework-agnostic)
   │  ├─ createEngine.ts         # Engine factory + Havok loader (enableHavok)
   │  ├─ input.ts                # keyboard / joystick → gameInput bridge (no React re-renders)
   │  ├─ world/createWorld.ts    # scene, iso camera, warm sun + cool hemi, PCF shadows, fog, post chain
   │  ├─ world/GridGround.ts     # checkerboard slab w/ dashed grid overlay, apron, curb
   │  ├─ world/park.ts           # Park: MapData → instantiated pieces (grid ⇄ world helpers)
   │  ├─ assets/AssetLoader.ts   # GLB AssetContainers, clone-based instantiation, toonify
   │  ├─ materials/ToonMaterial.ts   # CustomMaterial cel shader (3 bands, cool shadow tint, rim)
   │  ├─ rendering/InkOutlinePostProcess.ts  # depth+normal edge "ink" post process
   │  ├─ rendering/StylizedPipeline.ts       # SSAO2 → Ink → DOF(tilt-shift)/Bloom/Grading/FXAA
   │  └─ effects/Particles.ts    # SkateFX: poof clouds, grind sparks, speed trail
   ├─ landing/LandingPage.tsx
   ├─ builder/
   │  ├─ BuilderPage.tsx         # top bar, menu (presets / clear / skate it), canvas host
   │  ├─ ItemSheet.tsx           # city-builder bottom sheet (tabs + thumbnail strip + tools)
   │  └─ BuilderScene.ts         # orbit camera, hover ghost, footprint cursor, tap-to-place/erase
   └─ skate/
      ├─ SkatePage.tsx           # setup flow → gameplay (HUD, toasts, pause, touch controls)
      ├─ SetupFlow.tsx           # 1) map  2) character  3) ride + play mode
      ├─ VirtualJoystick.tsx     # pointer-capture joystick + jump button
      ├─ SkateScene.ts           # world + Havok + park colliders + rider + AI orchestration
      ├─ PlayerController.ts     # Havok "rolling ball" controller (ramps, jumps, grinds, bail)
      ├─ Bail.ts                 # ragdoll: rider hips+torso (ball-socket) + board fly off
      └─ AiNavigator.ts          # Recast navmesh + Detour crowd agent; fallback steering
```

## How the pieces fit

### Zustand store (`store/useGameStore.ts`)
One store, three concerns:
* **navigation** – `page: "landing" | "builder" | "skate"`
* **builder** – `customMap` (grid size + `PlacedItem[]`), selected item, rotation, tool.
  `placeItem()` validates footprints (multi-cell items like the taxi / long slope) and replaces
  whatever is under the footprint; floors coexist with props.
* **skate** – `setup` (map / character / ride / mode), `setupStep`, `hud` (speed, score, airtime,
  grinding, bailed), `paused`.
Only `customMap` and `setup` are persisted to `localStorage`.

### Babylon canvas + Havok (`engine/createEngine.ts`, `engine/world/createWorld.ts`)
`createEngine(canvas)` builds a WebGL2 engine with a capped DPR. `createWorld()` returns a
`World` (scene, camera, sun, shadows, ground, pipeline). The camera is an `ArcRotateCamera` with a
0.4 rad FOV placed far away — a long lens that flattens perspective like a tilt-shift photo. Its
distance is derived from the viewport aspect so a fixed number of world units span the narrow
axis (`fitRadius`). `enableHavok(scene)` loads the wasm once and enables the plugin.

### Toon look
* **ToonMaterial** – a `CustomMaterial` (StandardMaterial + shader injection) so lights, PCF
  shadows, fog and the geometry buffer all keep working. In `Fragment_Before_Fog` the accumulated
  light (`diffuseBase`, which already includes shadowing) is quantised into 3 bands with a tiny
  smoothstep for AA, hue preserved, and the darkest band is floored to a cool purple tint.
  glTF textures arrive as sRGB buffers (linear in-shader), so a `toGammaSpace` fix keeps Kenney's
  palette exact.
* **InkOutlinePostProcess** – samples depth + view-space normals from the GeometryBufferRenderer,
  draws ink where either changes sharply. Runs *before* DOF so lines blur with the tilt-shift.
* **StylizedPipeline** – `SSAO2` (contact darkening) → ink → `DefaultRenderingPipeline` with
  depth-of-field (focal length kept proportional to focus distance ⇒ consistent blur at any zoom),
  soft bloom, colour curves (warm highlights / purple shadows), vignette, chromatic aberration, FXAA.
* **Lighting** – warm low sun (PCF shadows, 2048 map) + cool hemispheric fill; the sun comes from the
  camera's left-rear so long shadows stretch toward the viewer.
* **GridGround** – procedurally drawn checkerboard + dashed cell outlines (crisp single texture).

### Builder (`builder/BuilderScene.ts`)
Drag = orbit/zoom, tap = place/erase (Babylon's `POINTERTAP` already separates the two). The hovered
cell shows a translucent ghost of the selected item and a green/red footprint cursor. The scene
subscribes to the store and diff-syncs placed pieces, so presets, clear, and erase are instant.

### Skate (`skate/*`)
* **Colliders** – every piece gets a static Havok `MESH` shape (Kenney meshes are tiny), plus the slab,
  apron and invisible boundary walls tagged `wall`.
* **PlayerController** – rider = dynamic sphere with zeroed inertia (slides, never tumbles). Each
  frame the velocity is blended toward a target that is projected onto the ground normal, so ramps,
  bowls and quarter-pipes are ridden smoothly; leaving a lip is pure ballistics. Ground probing uses
  physics raycasts (5 rays for curved surfaces). Grind = grounded on a `rail`/`grind` tagged piece
  at speed → sparks + score. The character node is yawed/pitched/rolled to match velocity and slope.
  Animations come from the Kenney rigs: `skate`, `skate-stand`, `skate-air`, `skate-grab`, `fall`.
* **Bail** – a collision against a vertical surface (or any `wall` tagged piece) above `bailSpeed`
  triggers the ragdoll: hips + torso boxes joined by a `BallAndSocketConstraint` and a free-flying
  board, flung with the impact velocity. After ~2 s the controller respawns at its last safe spot.
* **AiNavigator** – bakes a Recast navmesh from the slab + pieces (walkable slope 68° so ramp
  faces are part of the mesh), adds a Detour crowd agent and picks targets from points of interest
  (ramps, rails, ledges). The physics rider chases the agent; a forward raycast pops an ollie onto
  grind pieces and speed on steep ramp faces triggers airs. If Recast fails to load it falls back to
  whisker-raycast steering.
* **Input** – `engine/input.ts` is a plain object written by the keyboard (WASD/arrows/Space) and the
  React joystick/jump button, read by the scene every frame — no React re-renders in the hot path.

## Controls
| | Move | Jump | Pause |
|---|---|---|---|
| PC | WASD / arrow keys | Space | Esc |
| Mobile | on-screen joystick | JUMP button | ❚❚ |

Toggle 🤖/🎮 in the HUD to switch between **AI auto-drive** and **Manual** at any time.

## Tuning knobs
* `PlayerController.DEFAULT_TUNING` – speed, acceleration, jump, bail threshold.
* `createWorld` – `ISO_BETA/ISO_FOV`, sun direction, `visibleUnits` per scene.
* `StylizedPipeline` – DOF strength (`focalLength = 0.06 × focusDistance`), bloom, curves, ink thresholds.
* `AiNavigator.bake()` – Recast voxel size / slope / climb; agent speed.
