# Implementation Plan: The office scene on React Three Fiber

**Branch**: `002-r3f-office-scene` | **Date**: 2026-09-10 | **Spec**: specs/002-r3f-office-scene/spec.md
**Status**: Implemented 2026-09-10. Section 6 lists what each design enhancement became.

## Summary
Port the isometric office scene from one imperative three.js file (`src/main.js` scene half, `src/builders.js`, `src/brain.js`, `src/mcp.js`) to a React Three Fiber component tree with a small scene store, keep every current behaviour and the `window.CC` imperative handle so the rest of the page needs no change, then apply the enhancements from the Claude Design file `Enhancements.dc.html` as components. 001's scene tasks (PM at centre, Brain icon, CEO desk, walk-and-talk, any-count layout) are built once, here.

## Prerequisites
- **Node 22+** on the dev box and the runtime (the service already runs 22.23.2 from `/opt/agents-office-runtime`; the system Node was moved from the `nodejs:18` to the `nodejs:22` dnf module on 2026-09-10; `setup`, `package.json` engines and README now say 22+).
- **Design access**: the owner runs `/design-login` in Claude Code so the registered `claude_design` MCP (and the built-in DesignSync tool) can read project `adda190a-e8e8-45b1-8cd8-e8e9e81f8cf3`. Until then section 6 is empty.
- **001 decisions honoured**: demo mode is gone (no `DEMO` branches ported), one UI code path, states come from the engine.

## Technical Context
**Language/Version**: Node 22 ESM; browser ES2020 target; JSX compiled by esbuild (`jsx: 'automatic'`, `loader: { '.jsx': 'jsx' }`)
**Primary Dependencies**: three ^0.185 (already), react ^19, react-dom ^19, @react-three/fiber ^9, @react-three/drei ^10 (only `Html`, `useTexture` if needed; no `OrbitControls`, the camera is ours), zustand ^5 for the scene store (2 KB; the R3F-idiomatic store, avoids prop drilling into `useFrame`)
**Storage**: none new; roster and layout still come from `data.js` / `/api/health` (001: `data/office.json`)
**Testing**: `npm run check` (build size assertion, Playwright smoke on the live server, headless screenshot diff at three camera states); `node --test tests/layout.test.mjs` for the pure layout function
**Target Platform**: desktop browsers with WebGL 2, the owner's machine first
**Project Type**: single SPA bundled to one HTML
**Performance Goals**: 30 fps cap kept; frame time p95 at or under today's; zero React commits per frame
**Constraints**: built file under 1.6 MB (today 1.1 MB, proposal to owner); `window.CC` API unchanged; no change to `tasks.js`, `office.js`, `auth.js`, `check.mjs` beyond the size assertion
**Scale/Scope**: 1 PM + 1 CEO desk + up to 12 teams × 12 agents; today 35 people

## Constitution Check
- I One store per fact: PASS — scene state in one zustand store; agent runtime in one ref map; no copies in DOM data attributes.
- II States enforced: PASS — the scene only renders phases the engine sends; it never infers state.
- III Nothing leaves without the CEO: N/A (rendering only).
- IV Provider-agnostic: N/A.
- V Test-first for the engine: N/A for the scene; the layout function gets a unit test before components use it.
- VI One UI code path: PASS — no demo branches ported; old builders deleted in the same milestone (FR-015).
- VII Every CEO-relevant event is a notification: PASS — the "Needs you" bubble reads the inbox item's acknowledged state (001 FR-037).

## Architecture

### 1. Boundary: the scene is one component with an imperative handle
`src/scene/index.jsx` exports `mountScene(canvasHost, deps) → handle`. `main.js` keeps the page wiring (rail, chat, hotkeys, hash hooks, clock) and calls `mountScene`; the handle carries exactly today's `window.CC` members plus the callbacks `tasks.js` / `office.js` already receive (`toScreen`, `reframe`, `getFocused`, `getZoom`, `getFocusDim`, `spawnEmote`, `enterFocus`, `zoomToApproval`). Nothing outside `src/scene/` imports three.

### 2. Files
```
src/scene/
  index.jsx           mountScene(): createRoot on #scene, builds the handle, bridges the store
  store.js            zustand: focused, view {target, zoom, arc}, tween, theme {dark, cam}, hover, roster, activity by agent
  layout.js           pure layout(teams, agents, opts) → pods, desks, walkways, docks, pm, ceo  (001 FR-043)
  camera.jsx          IsoCamera: ortho frustum, iso vector, tween tick, overview offset for panel width, wheel/drag/click on the canvas only
  lights.jsx          hemi + key with shadow camera; theme-driven colours
  ground.jsx          shadow catcher
  materials.js        mat()/rboxGeo() caches (module-level, unchanged maths)
  pod.jsx             Plinth + floor slab + pointer handlers (focus / brain open)
  desk.jsx            Desk, Monitor (canvas texture hook useScreenTexture), Chair, activity glow
  person.jsx          Person rig (same capsules), usePose(): poseWork/posePerson/walkStep in useFrame on refs
  walkway.jsx, plant.jsx, props.jsx (server rack, meeting table)
  overlays.jsx        NamePill, DeptBadge, WarnSprite, Bubble, ProgramPill as <Html> with the clamping rules (or projected DOM, per clarification 3)
  dim.jsx             focus dim: per-mesh material colour lerp from the store's focused key (replaces dimTwin cloning)
  connectors.jsx      port of src/mcp.js: dock tiles, packets, tooltips, usage gauge
  brain-floor.jsx     port of src/brain.js scene half: floor sprite, read glints, write notes; overlay canvas stays in src/brain.js
  meetings.js         001 T056: per-person animation queues driven by SSE events (walk, bubble, return)
  enhancements/       one file per design enhancement (section 6)
src/main.js           page wiring only (target ≤ 500 lines)
src/builders.js       DELETED
build.mjs             + jsx loader, + size print already there
```

### 3. State and frames
- Discrete state (focus, theme, roster, activity phase, hover) → store; components subscribe with selectors.
- Continuous state (positions, poses, tween progress, textures, overlay transforms) → refs mutated in `useFrame`; the loop is throttled to 30 fps with `frameloop="demand"` off and a manual dt gate, as today.
- Agent runtime `R[id]` stays an object map on the handle (many callers read `R`), created once from the layout and updated in place.

### 4. Picking and input
- Meshes carry `userData.dept` / `userData.agentId` as now; `onClick` handlers on `<Pod>`, `<Person>`, `<ConnectorTile>`; a shared drag guard (4 px) lives in the camera controller.
- Wheel: listener on the canvas element only; `preventDefault` only when `event.target === canvas`. Closes 001 T001.
- Hotkeys stay in `main.js` and call the handle.

### 5. Theme
- Store `theme.dark` and `theme.cam`; each material-owning component derives its colour from `(base, dark)` in a `useMemo`; lights and ground read the same value. No `scene.traverse`.

### 6. Enhancements from `Enhancements.dc.html` — TO FILL AFTER IMPORT
| # | Enhancement (design name) | Where it lives | Reference |
|---|---|---|---|
| 1 | PM at the centre pod, Brain as a top-bar icon | `office.jsx` ProgramOffice; `overlays.js` brainTag | 1a |
| 2 | Pod cards: N of M working, state, lead line, counts, no overlap | `overlays.js` (cards + push-apart) | 1a |
| 3 | Desk pills: tag, context, bar; PM pill with state and next | `overlays.js` setPillState; shell CSS | 1d, 1a |
| 4 | Characters alive: idle, working, assisting, PM route, selected | `person.js`, `sim.js` | 1i |
| 5 | Day and night follow the clock | `daylight.js`, `office.jsx` Lights, `sim.js` lamps | 1l |
| 6 | Right now · Your call · Ready to read; empty / loading / offline | `rightnow.js`, `office.js` render, `tasks.js` | 1a, 1f |
| 7 | Agent rail: now → live draft → chain → chat | `main.js` renderNowCard | 1h |
| 8 | Result document with WHO / CHECKS / LEAD'S NOTE, decision bar | `task-output.js` | 1e |
| 9 | Building: rooms, doors, glass, corridors, corners; wall screens; 360° view; coffee, chats, meetings; A* walking | `furniture.js`, `office.jsx`, `screens.js`, `nav.js`, `sim.js`, `rig.js`, `input.js` | owner, 10 Sep |

`support.js` is read for constants (easing, durations, colours) and reproduced in `store.js` / `camera.jsx`, never bundled as is.

### 7. Build
- `build.mjs`: `loader: { '.jsx': 'jsx' }`, `jsx: 'automatic'`, `define: { 'process.env.NODE_ENV': '"production"' }` so React ships its production build.
- Size assertion in `check.mjs` (ceiling 1.6 MB, owner to confirm).
- Dev: `dist/dev.html` unchanged.

## Milestones
- **S0 Prepare** (½ day): deps, esbuild JSX, `layout.js` + test, screenshot baseline of the current build at three camera states.
- **S1 Port, parity** (3–4 days): sections 1–5; pixel diff under 1.5 %; delete `builders.js` and the old scene code; `check` green.
- **S2 001 scene tasks** (1–2 days): PM centre, Brain icon, CEO desk, walk-and-talk, any-count layout — on the new tree.
- **S3 Enhancements** (sized after import): one component per row of section 6; owner signs off against the two images.

## Risks
- **Bundle growth**: React + fiber ≈ 200–260 KB min; mitigated by production define, no drei beyond `Html`, and the ceiling check.
- **Canvas textures per frame**: 35 monitor textures redrawn on phase change only, as today; `needsUpdate` set from the hook, not from render.
- **`<Html>` cost**: one React portal per overlay; ~45 overlays is fine, but if clarification 3 picks projected DOM the current `tickLOD` code moves into a `useFrame` unchanged.
- **Two teams in one file**: 001 M2 also edits `src/main.js`; the sequencing decision (clarification 2) avoids a merge fight.
- **Node**: settled — 22.23.2 everywhere.

## Complexity Tracking
| Item | Why | Simpler alternative rejected because |
|---|---|---|
| zustand | idiomatic R3F store, selectors keep re-renders out of `useFrame` | React context re-renders every subscriber on any change |
| `<Html>` overlays | bubbles and pills move with their object; 001 T056 becomes trivial | keeping DOM projection means two positioning systems for the same objects |
