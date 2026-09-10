# Feature Specification: The office scene on React Three Fiber, with the Claude Design enhancements

**Feature Branch**: `002-r3f-office-scene` (artifacts on `main`, as for 001)
**Created**: 2026-09-10
**Status**: Implemented 2026-09-10 (owner said "go"; the four clarifications took their recommended defaults). Design imported.
**Input**: Owner request: "take the current office design and revamp it using R3F, as well as the code design here" — Claude Design project `adda190a-e8e8-45b1-8cd8-e8e9e81f8cf3`, file `Enhancements.dc.html`, with `assets/scene-clean.png`, `assets/scene-focus.png` and `support.js`.

## Clarifications

### Session 2026-09-10
- Design import: done after `/design-login`. `Enhancements.dc.html` is the CEO view: direction 1a (live floor) chosen; the PM at the centre pod; the Brain an icon top-left; pod cards *N of M working* + lead line + ACTIVE/QUEUED/APPROVED; desk pills with state tag, context and a real bar (1d); the PM pill with state and where it heads; the panel as Right now / Your call (inline actions) / Ready to read (1a); the agent rail now → live draft → chain → chat (1h); the result document with WHO / CHECKS / LEAD'S NOTE and the decision at the bottom (1e); empty / loading / disconnected states (1f); characters alive: idle breath and glances, working lean and taps, lead assisting walks over, PM on route with a dotted trail, selected stands and waves (1i); day and night follow the clock with the exact hemi / sun / screen values (1l). `scene-clean.png` / `scene-focus.png` came back truncated by the 256 KiB API cap; `screenshots/1a-centre.jpg` was the usable reference. `support.js` is the design runtime (no product constants).
- Owner additions during the build (10 Sep): the office is a building, not pods (rooms, walls, glass, corridors, corner rooms); free 360° turn and tilt with the mouse; cards must not cover another team; coffee breaks, chats, meetings, wall screens with information and market charts; walkers respect walls; night with lights from the real clock.
- Q: Does the R3F port replace, or sit beside, the scene tasks already planned in 001 (T001 wheel scoping, T028 router hides the scene, T032 PM at the centre, T033 Brain icon, T055 CEO desk, T056 walk-and-talk)? → pending (recommended: replace; 001's scene tasks are implemented once, as R3F components, and their task lines point here).
- Q: How much of the app moves to React? → pending (recommended: the scene only; the task panel, rail, settings and Brain overlay stay vanilla and talk to the scene through the same imperative handle `window.CC` exposes today).
- Q: Where do name pills, department badges and speech bubbles live? → pending (recommended: inside the scene tree as `drei` `<Html>` overlays, so they move with their object and the walk-and-talk bubbles of 001 are ordinary components).
- Q: Build tool? → pending (recommended: keep esbuild and the single-file `dist/command-centre-v2.html`; esbuild compiles JSX natively, no Vite).

## User Scenarios & Testing

### User Story 1 - The same office, on a component scene graph (Priority: P1)
The CEO opens the office and sees the same isometric office they use today: six department pods on a ring, the Brain pod at the centre, desks with live screens, 35 people at work, connector docks, walkways, plants, name pills and department badges. Overview, zoom to cursor, drag pan, click a pod to focus, click a person to open the rail, the department hotkeys, the D dark mode, the V camera mode, and the `#view= #zoom= #dark=` screenshot hooks all behave as before. Under the hood the scene is a React Three Fiber component tree instead of one 1,400-line imperative file, so every later scene change (001's PM desk, CEO desk, walk-and-talk, and the enhancements in Story 2) is a component, not a patch.

**Why this priority**: Nothing in Story 2 or in 001's scene work can be done cleanly on the current code; the port is the foundation. It must land with zero visible regression or the CEO loses trust in the office.

**Independent Test**: Build, open `dist/dev.html#view=sales` and `#zoom=2.2` headless, screenshot, and compare to the same shots on the current build (pixel diff under an agreed threshold on the scene region; identical HUD element positions within 2 px). `npm run check` Playwright smoke: click pod → focused, click person → rail open, wheel over rail → zoom unchanged, D → dark, `window.CC.flyTo` still works.

**Acceptance Scenarios**:
1. **Given** the built page, **When** it loads, **Then** every department, desk, person, walkway, plant, dock and badge from today's build is present at the same world position, and the first frame appears within 1.5 s on the owner's machine.
2. **Given** the overview, **When** the CEO wheels over the canvas, **Then** the zoom is anchored to the cursor and clamped to today's limits; **When** they wheel over the rail, the feed or a dialog, **Then** the zoom does not change (001 T001 lands here).
3. **Given** a focused department, **When** the CEO presses Escape or double-clicks empty floor, **Then** the camera flies back to the overview with the house easing and the dim on other pods lifts.
4. **Given** a live task, **When** its agent's phase changes, **Then** that desk's screen, activity glow, pill state and pose change exactly as today, driven by the same activity data from the task panel.
5. **Given** `window.CC`, **When** the task panel, the rail or the check script calls `flyTo`, `zoomToDept`, `zoomOut`, `openAgent`, `setDark`, `setCam`, `requestApproval`, **Then** the scene responds as before; no other module needed a change to keep working.

### User Story 2 - The Claude Design enhancements (Priority: P1)
The office looks the way the approved design shows it: `scene-clean.png` is the overview, `scene-focus.png` is a focused department. Whatever `Enhancements.dc.html` adds on top of today's look (materials, lighting, shadows, post-processing, motion, HUD styling, new set pieces) is applied as components in the R3F tree.

**Why this priority**: This is the visible outcome the owner asked for; the port alone changes nothing they can see.

**Independent Test**: Side-by-side of the two reference images against headless screenshots at the matching camera states; the owner signs off on the pair. Each enhancement in the design file has one line in this spec once imported, and one component or hook in the plan.

**Acceptance Scenarios** (from the design, as built):
1. **Given** the overview, **When** compared with `scene-clean.png`, **Then** layout, palette, lighting direction and HUD chrome match the reference.
2. **Given** a focused pod, **When** compared with `scene-focus.png`, **Then** the focus treatment (dim, camera framing, rail placement) matches the reference.
3. **Given** `support.js`, **When** it defines behaviour (interaction, timing, easing), **Then** that behaviour is implemented once, in the scene, with the same constants.

### User Story 3 - 001's scene work lands as components (Priority: P2)
The Program Manager desk at the centre, the Brain as a top-left icon, the CEO desk at the front, the ring layout for any number of teams and the desk grid for any number of agents, and the walk-and-talk handovers with speech bubbles are built as components on the new scene, not against the old file.

**Why this priority**: These are already approved in 001 (FR-016, FR-036, FR-037, FR-043); doing them twice is waste.

**Independent Test**: The 001 engine tests are untouched; the Playwright checks named in 001 T046 (PM pill, brain icon, CEO desk) pass on the R3F build; a `layout()` unit test returns seven pods on the ring plus the PM centre for a seventh team.

**Acceptance Scenarios**:
1. **Given** a roster with any number of teams and agents from `data/office.json`, **When** the scene mounts, **Then** pods, desks and people are laid out from a pure layout function with no hard-coded department list.
2. **Given** an SSE event `run_finished(specialist)`, **When** it arrives, **Then** the specialist walks to the lead, two bubbles show, both return, and events that arrive faster than animations play are queued per person.

### User Story 4 - No regression in weight or feel (Priority: P2)
The office stays light: one HTML file, the 30 fps cap, no per-frame React re-render, and the same or lower CPU use on the owner's machine.

**Independent Test**: `check.mjs` records the bundle size and fails above the agreed ceiling; a 20 s headless run reports frame time p95 under 33 ms at the overview and in focus.

**Acceptance Scenarios**:
1. **Given** 35 people animating, **When** one frame renders, **Then** zero React commits happen (per-frame work is in `useFrame` on refs).
2. **Given** the built file, **When** measured, **Then** it is under the ceiling set in the plan.

### Edge Cases
- WebGL unavailable or context lost: the page shows the HUD, the task panel and a plain message on the canvas, and recovers when the context returns.
- The window resizes while a fly-to tween runs: the overview target is recomputed for the panel width without a jump.
- A roster change (rename, model) arrives while a person is walking: the pill updates, the walk continues.
- Dark mode toggled while a department is focused: the dim twins are rebuilt for the dark palette, as today.
- The tab is hidden or the settings page is open (001 T028): the render loop pauses and resumes without a frame skip.

## Requirements

### Functional Requirements
- **FR-001**: The scene MUST be a React Three Fiber component tree mounted on the existing `#scene` canvas position, with the rest of the page unchanged in markup and behaviour.
- **FR-002**: Camera MUST stay orthographic isometric with today's constants (frustum 42, iso vector (1, 0.92, 1), distance 220, zoom clamp), tween easing cubic-bezier(0.2, 0.8, 0.2, 1), the swing-in arc on focus, and the overview offset for the task panel width.
- **FR-003**: Every builder in `src/builders.js` (plinth, floor title, desk, screen texture, chair, person, plant, server rack, meeting table, walkway, warning sprite) MUST become a component or a hook with the same geometry and materials; shared geometry and material caches MUST be kept (memoised at module level), not recreated per instance.
- **FR-004**: Per-frame animation (poses, walking, tween, dim, emotes, screen textures, badge and pill projection) MUST run in `useFrame` against refs; React state MUST change only on discrete events (focus, dark, roster, activity phase).
- **FR-005**: The imperative handle `window.CC` MUST keep its current members and semantics (`flyTo, zoomToDept, zoomOut, zoomToApproval, requestApproval, openAgent, view, applyCamera, R, emotes, setCam, setDark, brain, connectorReveal, toggleBoard, addTask, tasks, routines`) so `tasks.js`, `office.js`, `check.mjs` and the release scripts keep working.
- **FR-006**: Picking MUST use R3F pointer events on meshes (`onClick`, `onPointerDown`) with the same targets: pod → focus, person → rail, connector tile → tooltip, Brain pod → graph, empty floor double-click → overview; drag over 4 px MUST cancel the click.
- **FR-007**: Wheel zoom MUST be bound to the canvas element only and MUST never `preventDefault` when the event target is inside scrollable UI (001 FR-015).
- **FR-008**: Dark mode and camera mode MUST re-tint through material props driven by a theme value, not by traversing the scene; the Brain and connector modules MUST receive the theme through the same value.
- **FR-009**: The connectors dock (`src/mcp.js`) and the Brain floor (`src/brain.js`) MUST be ported as components in the same tree; the full-screen Brain overlay (2D canvas) stays as is.
- **FR-010**: HUD overlays (pills, badges, bubbles, the program pill) MUST be positioned by the scene, either as `drei` `<Html>` children or by today's projection, per the clarification; they MUST keep the on-screen clamping rules and the task-panel right edge.
- **FR-011**: The enhancements listed in `Enhancements.dc.html` MUST each map to one component or hook, named in the plan, with the reference images as the acceptance oracle. [PLACEHOLDER until import]
- **FR-012**: The build MUST stay a single self-contained HTML plus the dev variant; the bundle MUST include react, react-dom, @react-three/fiber and only the `drei` helpers actually used (tree-shaken).
- **FR-013**: The scene MUST render from a layout function that accepts any team and agent count (001 FR-043) with today's ring and grid rules as the default.
- **FR-014**: Demo-mode branches (`DEMO`, `v1data` theatre, fake approvals, emoji emotes on a timer) MUST NOT be ported (constitution VI; 001 removes demo mode).
- **FR-015**: Dead code MUST be deleted with the port: `src/builders.js` and the scene half of `src/main.js` go once their components exist; no two implementations of a builder may coexist after the milestone.

### Key Entities
- **SceneStore**: focused department, zoom and target, theme (light/dark/cam), tween in flight, hover; the single source for scene state, read by components and by the imperative handle.
- **AgentRuntime** (today's `R[id]`): seat, stand spot, walk path, state, activity phase, feed; kept as a ref map, not React state.
- **Layout**: pure function `layout(teams, agents) → { pods[], desks[], walkways[], docks[], pm, ceo }`.
- **Enhancement**: one named visual or behavioural addition from the design file, with a component, its inputs and its reference image. [filled after import]

## Success Criteria
- **SC-001**: Pixel diff between the current build and the ported build at `#view=sales`, `#zoom=2.2` and the overview is under 1.5 % of the scene region before any enhancement is applied.
- **SC-002**: Zero changes are needed in `tasks.js`, `office.js`, `auth.js` or `check.mjs` beyond the bundle-size assertion.
- **SC-003**: Frame time p95 at the overview and in focus is at or under today's, measured headless over 20 s.
- **SC-004**: The built HTML stays under the ceiling set in the plan (today 1.1 MB; proposal: 1.6 MB).
- **SC-005**: The owner signs off the overview and focus screenshots against `scene-clean.png` and `scene-focus.png`.
- **SC-006**: `src/builders.js` and the scene section of `src/main.js` are deleted; `npm run check` and `npm test` are green.

## Gaps
1. **Design file not read** — `Enhancements.dc.html`, the two images and `support.js` are behind `/design-login`. Story 2, FR-011 and the Enhancement entity are placeholders. Once the owner has logged in, re-run the import and fill them in before tasks are generated.
2. **Sequencing with 001** — 001 M2 (UI) touches the same file; two implementations of the PM desk, CEO desk and walk-and-talk would be waste. Needs the owner's call (clarification 2).
3. **Node version** — the dev box runs Node 18; `engines` says 20+ and the runtime is 22. esbuild JSX works on 18, but the `npm run check` Playwright step and 001's deps expect 22. Not blocking for the plan; note for the implementer.
4. **Bundle ceiling** — react + react-dom + fiber add roughly 200–260 KB minified; drei is tree-shakeable but `<Html>` pulls in react-dom's client renderer. The 1.6 MB proposal needs the owner's yes.
