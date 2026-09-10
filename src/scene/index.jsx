// mountScene(): the office scene on React Three Fiber, mounted on the page's canvas.
// Returns the imperative handle the page (src/main.js) and the task panel already speak:
// R, deptRT, view, flyTo, toScreen, spawnEmote, setDark… — nothing outside src/scene/ imports three.
import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { createRoot, extend, useThree, useFrame, advance } from '@react-three/fiber';
import { rig, applyCamera, flyTo, tickTween, toScreen, overviewPos, pxPerWorld, FR, rotateTo, screenRight } from './rig.js';
import { store } from './store.js';
import { PHASES, PHASE_KEYS, phaseFor } from './daylight.js';
import { Lights, Ground, Pod, Station, ProgramOffice, Theme, Building } from './office.jsx';
import { makeOverlays } from './overlays.js';
import { tickScreens } from './screens.js';
import { buildNav } from './nav.js';
import { makeMug } from './furniture.js';
import { rightNowRows } from '../rightnow.js';
import { createSim } from './sim.js';
import { applySceneDim, restoreSceneDim, clearDimCache, tickDim } from './dim.js';
import { bindInput } from './input.js';
import { canvasTexture } from './materials.js';
import { initBrain } from '../brain.js';
import { initMcp } from '../mcp.js';

extend(THREE);

/* ---------- floating emoji work-bubbles over a desk ---------- */
const emoteTex = {};
function getEmoteTex(icon) {
  if (!emoteTex[icon]) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    x.beginPath(); x.arc(64, 60, 52, 0, 7); x.fillStyle = 'rgba(253,255,248,0.97)'; x.fill();
    x.lineWidth = 3; x.strokeStyle = 'rgba(21,20,20,0.25)'; x.stroke();
    x.beginPath(); x.moveTo(50, 106); x.lineTo(64, 124); x.lineTo(74, 104); x.closePath(); x.fillStyle = 'rgba(253,255,248,0.97)'; x.fill();
    x.font = '58px "Apple Color Emoji", serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#151414'; x.fillText(icon, 64, 64);
    emoteTex[icon] = canvasTexture(c, 2);
  }
  return emoteTex[icon];
}

function Bridge({ ctx }) {
  const { scene } = useThree();
  useEffect(() => { ctx.scene = scene; ctx.onReady(scene); }, []);
  useFrame(() => { ctx.frame(); });
  return null;
}

function Office({ ctx, DEPTS, DEPT_KEYS, AGENTS, LAYOUT, V1 }) {
  const cols = useMemo(() => Object.fromEntries(DEPT_KEYS.map(k => [k, !rig.DEMO && AGENTS.filter(x => x.dept === k).length > 8 ? 3 : 2])), []);
  return (
    <>
      <Lights />
      <Ground />
      <Theme />
      <Building LAYOUT={LAYOUT} DEPT_KEYS={DEPT_KEYS} clickTargets={ctx.clickTargets} />
      {Object.entries(LAYOUT).filter(([k]) => k === 'brain' || DEPT_KEYS.includes(k)).map(([k, L]) => (
        <Pod key={k} k={k} L={L} dept={DEPTS[k]} clickTargets={ctx.clickTargets} isCentre={k === 'brain'} />
      ))}
      <ProgramOffice L={LAYOUT.brain} personTargets={ctx.personTargets} />
      {AGENTS.map(a => (
        <Station key={a.id} a={a} dept={DEPTS[a.dept]} L={LAYOUT[a.dept]} cols={cols[a.dept]} personTargets={ctx.personTargets}
          v1={V1 && V1.find(x => x.id === a.id)} />
      ))}
      <Bridge ctx={ctx} />
    </>
  );
}

export function mountScene({ canvas, hud, DEMO, DEPTS, DEPT_KEYS, AGENTS, LAYOUT, WORKLINES, V1, rnd, sample, esc, page }) {
  rig.DEMO = DEMO; rig.hud = hud;
  rig.overview.zoom = Math.min(0.8, 0.8 * 6 / Math.max(6, DEPT_KEYS.length));
  rig.size = { w: innerWidth, h: innerHeight };
  rig.panelWidth = () => (page.tasks() ? page.tasks().panelWidth() : 400);
  rig.view.target.set(...overviewPos()); rig.view.zoom = rig.overview.zoom;

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 800);
  rig.camera = camera; applyCamera(camera);

  const ctx = { clickTargets: [], personTargets: [], scene: null, onReady: null, frame: null };
  const emotes = [];
  let brain = null, mcpImpl = null, mcpDark = false, mcpUsage = null, sim = null, overlays = null, ready = false;
  const mcp = {
    sprites: [],
    tick: (...a) => mcpImpl && mcpImpl.tick(...a),
    onAgentEvent: (...a) => mcpImpl && mcpImpl.onAgentEvent(...a),
    onToolsUsed: (...a) => mcpImpl && mcpImpl.onToolsUsed(...a),
    showTip: (...a) => mcpImpl && mcpImpl.showTip(...a),
    startReveal: (...a) => mcpImpl && mcpImpl.startReveal(...a),
    setDark: on => { mcpDark = on; if (mcpImpl) mcpImpl.setDark(on); },
    setUsage: u => { mcpUsage = u; if (mcpImpl) mcpImpl.setUsage(u); },
    isLive: () => !!(mcpImpl && mcpImpl.live),
    init: (connectors) => { if (!ctx.scene) return; mcpImpl = initMcp({ scene: ctx.scene, hud, LAYOUT, DEPTS, FR, R: rig.R, connectors }); if (mcpDark) mcpImpl.setDark(true); if (mcpUsage) mcpImpl.setUsage(mcpUsage); },
  };

  function spawnEmote(r, icon) {
    if (!ctx.scene || !r) return;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: getEmoteTex(icon), depthTest: false, transparent: true }));
    const p = r.person.position;
    s.position.set(p.x + 0.7, p.y + 5.6, p.z); s.scale.set(2.9, 2.9, 1);
    ctx.scene.add(s); emotes.push({ s, born: performance.now() });
  }
  function tickEmotes(now, dt) {
    for (let i = emotes.length - 1; i >= 0; i--) {
      const e = emotes[i], age = (now - e.born) / 1700;
      if (age >= 1) { ctx.scene.remove(e.s); e.s.material.dispose(); emotes.splice(i, 1); }
      else { e.s.position.y += dt * 1.7; e.s.material.opacity = age < 0.15 ? age / 0.15 : 1 - (age - 0.15) / 0.85; }
    }
  }

  /* ---------- theme + daylight ---------- */
  function setDark(on) {
    const dark = !!on;
    store.setState({ dark, manualDark: dark });
    document.body.classList.toggle('dark', dark);
    clearDimCache();
    if (dark && store.getState().phase !== 'night') store.setState({ phase: 'night', manualPhase: 'night' });
    if (!dark && store.getState().phase === 'night') store.setState({ phase: phaseFor() === 'night' ? 'evening' : phaseFor(), manualPhase: phaseFor() === 'night' ? 'evening' : null });
    const f = store.getState().focused; if (f && f !== 'brain' && ctx.scene) applySceneDim(ctx.scene, f);
    if (brain) brain.setTheme(dark);
    mcp.setDark(dark);
    document.body.dataset.phase = store.getState().phase;
  }
  function setPhase(name, pin = true) {
    if (name == null) { // back to the clock: no pinned phase, no forced dark
      store.setState({ manualPhase: null, manualDark: null });
      const p = phaseFor(); store.setState({ phase: p, dark: PHASES[p].dark }); document.body.classList.toggle('dark', PHASES[p].dark); clearDimCache();
      const f = store.getState().focused; if (f && f !== 'brain' && ctx.scene) applySceneDim(ctx.scene, f); if (brain) brain.setTheme(PHASES[p].dark); mcp.setDark(PHASES[p].dark); document.body.dataset.phase = p; return;
    }
    if (!PHASES[name]) return;
    store.setState({ phase: name, manualPhase: pin ? name : null });
    const dark = PHASES[name].dark;
    if (store.getState().manualDark == null || pin) {
      if (pin) store.setState({ manualDark: null }); store.setState({ dark }); document.body.classList.toggle('dark', dark); clearDimCache(); const f = store.getState().focused; if (f && f !== 'brain' && ctx.scene) applySceneDim(ctx.scene, f); if (brain) brain.setTheme(dark); mcp.setDark(dark); }
    document.body.dataset.phase = name;
  }
  function tickClock() {
    const S = store.getState();
    if (S.manualPhase) return;
    const p = phaseFor();
    if (p !== S.phase) setPhase(p, false);
  }
  function setCam(on) { store.setState({ cam: !!on }); document.body.classList.toggle('cam', !!on); }

  /* ---------- focus ---------- */
  function focus(k) { store.setState({ focused: k }); if (k && k !== 'brain') { rig.focusDimTarget = 1; if (ctx.scene) applySceneDim(ctx.scene, k); } }
  function unfocus() { store.setState({ focused: null }); rig.focusDimTarget = 0; }
  function select(id) { store.setState({ selected: id }); }

  /* ---------- the frame ---------- */
  let last = performance.now();
  ctx.frame = () => {};
  ctx.onReady = (scene) => {
    overlays = makeOverlays({ hud, DEPTS, DEPT_KEYS, AGENTS, LAYOUT,
      onDept: k => page.zoomToDept(k), onAgent: id => page.openAgent(id), onApproval: k => page.zoomToApproval(k), onBrain: () => brain && brain.open(), onPM: () => page.openPM() });
    for (const r of Object.values(rig.R)) r.pill = overlays.pills[r.a.id];
    if (rig.pm) rig.pm.pill = overlays.pmPill;
    const bg = rig.deptRT.brain.group;
    brain = initBrain({ scene, brainGroup: bg, getR: () => rig.R, esc, hud, toScreen, getCamera: () => camera });
    bg.traverse(o => { if (o.isSprite) o.visible = false; }); // the Brain is an icon now (design 1a); the floor sprite retires
    if (!DEMO) brain.setQuiet(true);
    bg.traverse(o => { if ((o.isMesh || o.isSprite) && !o.userData.dept) o.userData.dept = 'brain'; });
    // the walking grid: rooms with their doors, the centre ring with its openings, the meeting room's glass
    const rooms = Object.values(rig.rooms || {});
    for (const c of (rig.corners || [])) if (c.kind === 'meeting') rooms.push({ x: c.x, z: c.z, w: c.w, d: c.d, door: { edge: 'z', sign: c.rot ? -1 : 1, width: 5 } });
    rig.nav = buildNav({ bounds: rig.bounds, rooms, centre: rig.centreRing });
    const simPage = { spawnEmote };
    sim = createSim({ DEMO, tasks: null, overlays, DEPTS, DEPT_KEYS, AGENTS, LAYOUT, rnd, WORKLINES, sample, page: simPage });
    for (const r of Object.values(rig.R)) { r.mug = makeMug(DEPTS[r.a.dept].chip); r.mug.position.set(0, -0.86 * r.person.userData.S, 0.1); r.person.userData.handR.add(r.mug); }
    bindInput(canvas, {
      clickTargets: ctx.clickTargets, personTargets: ctx.personTargets,
      onPerson: id => { if (id === 'program-manager') page.openPM(); else page.openAgent(id); },
      onDept: dk => { if (dk === 'brain') { page.openPM(); return; } if (dk === 'lobby') { page.openInbox && page.openInbox(); return; } page.zoomToDept(dk); },
      onEmptyDouble: () => page.zoomOut(), onZoomChange: z => page.onZoom(z),
    });
    ready = true;
    ctx.frame = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const tasks = page.tasks();
      if (sim && sim._tasks !== tasks) { sim._tasks = tasks; sim = createSim({ DEMO, tasks, overlays, DEPTS, DEPT_KEYS, AGENTS, LAYOUT, rnd, WORKLINES, sample, page: simPage }); sim._tasks = tasks; }
      tickTween(now); applyCamera(camera);
      tickDim(dt);
      const focused = store.getState().focused;
      sim.tick(now, dt, focused);
      tickEmotes(now, dt);
      brain.tick(now);
      overlays.tick(now, focused, rig.focusDim, !DEMO);
      if (tasks && tasks.tick) tasks.tick(now);
      mcp.tick(now, dt, rig.view, camera, focused, rig.focusDim);
      if (Math.floor(now / 30000) !== ctx.lastClock) { ctx.lastClock = Math.floor(now / 30000); tickClock(); }
      if (now - (ctx.lastScreens || 0) > 650) { // the wall screens: who is working, the lobby ticker
        ctx.lastScreens = now;
        const rows = rightNowRows({ R: rig.R, pm: rig.pm, DEPTS, live: !DEMO, rnd, max: 6 });
        const byDept = {}; for (const r of rows) (byDept[Object.values(rig.R).find(x => x.a.id === r.agent)?.a.dept || 'pm'] ||= []).push({ t: r.line, c: DEPTS[Object.values(rig.R).find(x => x.a.id === r.agent)?.a.dept]?.chip });
        const clock = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        tickScreens(now, { clock, brand: document.title || 'Cloud AI Office', rows: rows.map(r => ({ t: r.line, c: r.st === 'stuck' || r.st === 'blocked' ? '#F2B84B' : '#5ADEB7' })),
          working: Object.values(rig.R).filter(r => ['working', 'planning', 'verifying', 'reviewing', 'helping'].includes(r.livePhase)).length, needsYou: Object.values(rig.R).filter(r => r.state === 'stuck').length,
          rowsFor: k => byDept[k] || [], workingFor: k => Object.values(rig.R).filter(r => r.a.dept === k && ['working', 'planning', 'verifying', 'reviewing', 'helping'].includes(r.livePhase)).length });
      }
      page.afterFrame && page.afterFrame();
    };
    page.onReady && page.onReady();
  };

  const root = createRoot(canvas);
  const configure = () => root.configure({
    gl: { antialias: true, alpha: true, toneMapping: THREE.NoToneMapping },
    shadows: { type: THREE.PCFShadowMap }, dpr: Math.min(devicePixelRatio, 1.5), frameloop: 'never', flat: true,
    camera, events: undefined, size: { width: innerWidth, height: innerHeight, top: 0, left: 0 },
  });
  configure();
  root.render(<Office ctx={ctx} DEPTS={DEPTS} DEPT_KEYS={DEPT_KEYS} AGENTS={AGENTS} LAYOUT={LAYOUT} V1={V1} />);
  addEventListener('resize', () => { rig.size = { w: innerWidth, h: innerHeight }; configure(); applyCamera(camera); });

  // the render loop, capped at 30 fps as before; the tab hidden or the scene hidden → paused
  let lastRaf = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    if (now - lastRaf < 1000 / 30) return;
    if (document.hidden || document.body.dataset.view) return;
    lastRaf = now;
    advance(now);
  }
  requestAnimationFrame(loop);
  tickClock(); document.body.dataset.phase = store.getState().phase;

  return {
    R: rig.R, deptRT: rig.deptRT, view: rig.view, rig, store, camera,
    get pm() { return rig.pm; },
    flyTo, applyCamera: () => applyCamera(camera), overviewPos, toScreen, pxPerWorld, FR, screenRight,
    rotateBy: (rad) => rotateTo((rig.yawTween ? rig.yawTween.to : rig.view.yaw) + rad), rotateTo: (yaw, pitch) => rotateTo(yaw, 600, pitch), get yaw() { return rig.view.yaw; }, get pitch() { return rig.view.pitch; },
    resetView: () => rotateTo(0, 700, Math.asin(0.92 / Math.hypot(1, 0.92, 1))),
    isTweening: () => !!rig.tween, tweenTo: () => rig.tween && rig.tween.toZ,
    setDark, setCam, setPhase, phases: PHASE_KEYS, get phase() { return store.getState().phase; }, get dark() { return store.getState().dark; },
    focus, unfocus, select, get focusDim() { return rig.focusDim; },
    spawnEmote, emotes, get brain() { return brain; }, mcp, get sim() { return sim; }, get overlays() { return overlays; },
    isReady: () => ready, route: (a, b) => rig.nav ? rig.nav.route(a, b) : [b.clone()],
    zoomStep: (f) => { flyTo([rig.view.target.x, 0, rig.view.target.z], Math.max(Math.min(rig.minZoom, rig.overview.zoom), Math.min(rig.maxZoom, rig.view.zoom * f)), 350); },
    renamePill: (id, name, lead) => { const p = overlays && overlays.pills[id]; if (p) p.querySelector('.p-n').textContent = name; },
    setBrainCount: n => { const b = overlays && overlays.brainTag.querySelector('b'); if (b) b.textContent = Number(n || 0).toLocaleString('en-NZ'); },
  };
}
