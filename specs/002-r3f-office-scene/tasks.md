# Tasks: The office scene on React Three Fiber

**Input**: specs/002-r3f-office-scene/{spec.md,plan.md}
**Format**: `- [ ] T### [P?] [US#] description with file path` — [P] = parallelisable, [US#] = user story
**Status**: built 2026-09-10 on the owner's "go". Unchecked lines below are what remains.

## Phase 0: Prerequisites (done or owner action)
- [x] T000 Node 22 on the dev box (dnf `nodejs:22`, 2026-09-10); `setup`, `package.json` engines, README say 22+
- [x] T000b Owner runs `/design-login`; import `Enhancements.dc.html`, `assets/scene-clean.png`, `assets/scene-focus.png`, `support.js`; fill spec Story 2 / FR-011 and plan section 6

## Phase 1: S0 Prepare
- [x] T101 [P] package.json: add react, react-dom, @react-three/fiber, @react-three/drei, zustand; `npm install`
- [x] T102 [P] build.mjs: `.jsx` loader, automatic JSX runtime, production `NODE_ENV` define; keep single-file output and dev.html
- [ ] T103 [P] [US3] (not done — LAYOUT from data.js still lays out the ring; no unit test) src/scene/layout.js: pure `layout(teams, agents, opts)` reproducing today's ring/grid (data.js LAYOUT + main.js COLS/grid maths) with PM centre and CEO front slots; tests/layout.test.mjs (6 teams = today's positions; 7 teams on the ring; 12 agents → 3 columns)
- [x] T104 [US1] check.mjs: headless screenshots of the current build at overview, `#view=sales`, `#zoom=2.2` saved as the parity baseline; bundle-size assertion (ceiling per plan)

## Phase 2: S1 Port with parity (US1, US4)
- [x] T201 src/scene/store.js: zustand store (focused, view, tween, theme, hover, roster, activity)
- [x] T202 src/scene/materials.js: move mat()/rboxGeo() caches unchanged
- [x] T203 src/scene/camera.jsx: IsoCamera + tween + overview offset + wheel (canvas-only, closes 001 T001) + drag + click guard + dblclick
- [x] T204 [P] src/scene/lights.jsx, ground.jsx: theme-driven
- [x] T205 [P] src/scene/pod.jsx, walkway.jsx, plant.jsx, props.jsx from builders.js
- [x] T206 [P] src/scene/desk.jsx: Desk, Monitor with useScreenTexture, Chair, activity glow
- [x] T207 src/scene/person.jsx: rig + usePose (poseWork/posePerson/applyStandAndFacing/walkStep) in useFrame on refs
- [x] T208 src/scene/overlays.jsx: NamePill, DeptBadge, WarnSprite, ProgramPill, Bubble as `<Html>` (or projected DOM per clarification 3) with clamping and panel right-edge rules
- [x] T209 src/scene/dim.jsx: focus dim via material lerp from store (replaces dimTwin)
- [ ] T210 (kept as is: src/mcp.js runs inside the R3F scene through the handle) src/scene/connectors.jsx: port src/mcp.js (docks, packets, tooltip, usage gauge, dark)
- [ ] T211 (kept as is: src/brain.js runs inside the scene; its floor sprite is hidden) src/scene/brain-floor.jsx; overlay canvas stays in src/brain.js
- [x] T212 src/scene/index.jsx: mountScene(), handle = today's window.CC + task-panel callbacks; src/main.js reduced to page wiring
- [x] T213 Delete src/builders.js and the old scene code in src/main.js; no DEMO branches ported (FR-014/015)
- [x] T214 [US1][US4] check.mjs: pixel diff vs T104 baseline < 1.5 %; frame-time p95 sample; Playwright: pod click, person click, wheel-over-rail no zoom, D dark, window.CC.flyTo

## Phase 3: S2 001 scene tasks on the new tree (US3)
- [x] T301 PM office at the centre (001 T032): lead desk + person id `pm`, walkways to PM, side program plinth and pill removed
- [x] T302 [P] Brain icon top-left (001 T033) opens the overlay; brain-floor drops the floor sprite; overview button shifts
- [ ] T303 [P] CEO desk at the front (001 T055) — the lobby has a reception desk; the inbox click waits for 001's inbox
- [~] T304 (walk-and-talk exists in sim.js: lead → worker, PM → lead, with bubbles; the SSE-driven queue waits for 001's engine) src/scene/meetings.js (001 T056): per-person queues, walk-to-target, bubbles ≤ 80 chars, ≤ 2 per person, whole meeting < 6 s, return; "Needs you" bubble clears on acknowledgement
- [x] T305 Renderer pauses when body[data-view] hides the scene (001 T028)

## Phase 4: S3 Enhancements (US2) — GENERATED AFTER T000b
- [x] T4xx one task per row of plan section 6: `src/scene/enhancements/<name>.jsx`, reference image, owner sign-off

## Phase 5: Close
- [x] T501 README.md and CLAUDE.md: scene section describes `src/scene/` and the handle; CHANGELOG entry
- [~] T502 `npm run check` 37/38 (the one failure, /api/health agents 36 ≠ 35, predates this work); release is the owner's; release per scripts/release.mjs (owner)
