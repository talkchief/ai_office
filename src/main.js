// Agents Office v2 — Three.js isometric office with zoom-driven LOD
// Far: clean pods + agent counts (Image 1 read). Near: diorama with 3D people + holo screens (Image 2 read).
import * as THREE from 'three';
import { TOKENS, DEPTS, DEPT_KEYS, AGENTS, LAYOUT } from './data.js';
import {
  PLINTH_H, mat, rbox, makePlinth, makeDesk, makeChair,
  makePerson, posePerson, poseWork, makePlant, makeWalkway, makeWarnSprite,
} from './builders.js';
import { initOfficeWork } from './office.js';
import { initBrain } from './brain.js';
import { initMeetings } from './meetings.js';
let tasks = null; // V3 task boards — initialised after the rail constants exist

/* ---------- renderer / scene / camera ---------- */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();

const FR = 42; // frustum half-height at zoom 1
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 800);
const ISO = new THREE.Vector3(1, 0.92, 1).normalize();
const CAM_DIST = 220;
// V3.2 overview (AJ, 5 Sep late): every dept card sits ON its own pod, over the wiring. With six
// pods the scene is pulled back to 0.86 and shifted down so the EMAILS and DELIVERY cards can
// float above their back rows instead of being shoved out to the screen edges.
// V3.3: the Task Status panel owns the right ~430px at every zoom, so the overview target slides
// along screen-right by half the panel width — the scene sits centred in what is left.
const OVERVIEW = { base: [-9, 0, -9], zoom: Math.min(0.8, 0.8 * 6 / Math.max(6,DEPT_KEYS.length)) }; // (-9,-9) shifts the scene straight DOWN the screen, no sideways drift
const SR_ = new THREE.Vector3(1, 0, -1).normalize();
function overviewPos() {
  const pw = (tasks ? tasks.panelWidth() : 400) + 30;
  const ppw = OVERVIEW.zoom * innerHeight / (2 * FR);
  const sh = (pw / 2) / ppw;
  return [OVERVIEW.base[0] + SR_.x * sh, 0, OVERVIEW.base[2] + SR_.z * sh];
}
const view = { target: new THREE.Vector3(...overviewPos()), zoom: OVERVIEW.zoom, arc: 0 };
let tween = null;
const UPV = new THREE.Vector3(0, 1, 0);
const isoWork = new THREE.Vector3();

function applyCamera() {
  const aspect = innerWidth / innerHeight;
  camera.left = -FR * aspect; camera.right = FR * aspect;
  camera.top = FR; camera.bottom = -FR;
  camera.zoom = view.zoom;
  isoWork.copy(ISO);
  if (view.arc) isoWork.applyAxisAngle(UPV, view.arc); // cinematic swing-in, settles back to locked iso
  camera.position.copy(view.target).addScaledVector(isoWork, CAM_DIST);
  camera.lookAt(view.target);
  camera.updateProjectionMatrix();
}

// house easing cubic-bezier(0.2, 0.8, 0.2, 1)
function bezier(t) {
  const cx = 3 * 0.2, bx = 3 * (0.2 - 0.2) - cx, ax = 1 - cx - bx;
  const cy = 3 * 0.8, by = 3 * (1 - 0.8) - cy, ay = 1 - cy - by;
  let u = t;
  for (let i = 0; i < 5; i++) {
    const x = ((ax * u + bx) * u + cx) * u - t;
    const dx = (3 * ax * u + 2 * bx) * u + cx;
    if (Math.abs(dx) < 1e-6) break;
    u -= x / dx;
  }
  return ((ay * u + by) * u + cy) * u;
}

function flyTo(targetPos, zoom, dur = 800, opts = {}) {
  tween = {
    t0: performance.now(), dur,
    fromT: view.target.clone(), toT: new THREE.Vector3(...targetPos),
    fromZ: view.zoom, toZ: zoom,
    arc: opts.arc || 0, onDone: opts.onDone,
  };
}
function tickTween(now) {
  if (!tween) return;
  const k = Math.min(1, (now - tween.t0) / tween.dur);
  const e = bezier(k);
  view.target.lerpVectors(tween.fromT, tween.toT, e);
  view.zoom = tween.fromZ + (tween.toZ - tween.fromZ) * e;
  view.arc = Math.sin(e * Math.PI) * tween.arc;
  if (k >= 1) {
    const cb = tween.onDone;
    view.arc = 0; tween = null;
    if (cb) cb();
  }
}

/* ---------- lights: one warm key top-left + soft fill ---------- */
const hemi = new THREE.HemisphereLight(0xfdfff8, 0xd8d4c8, 0.85);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff1dd, 2.2);
key.position.set(-60, 90, 20);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -95; key.shadow.camera.right = 95;
key.shadow.camera.top = 95; key.shadow.camera.bottom = -95;
key.shadow.camera.far = 400;
key.shadow.radius = 7; key.shadow.blurSamples = 12;
key.shadow.bias = -0.0004;
scene.add(key);

// shadow catcher — makes the pods float over the cream page
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(500, 500),
  new THREE.ShadowMaterial({ opacity: 0.13 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -7;
ground.receiveShadow = true;
scene.add(ground);

/* ---------- build the office ---------- */
const hud = document.getElementById('hud');
const clickTargets = [];   // plinth meshes -> dept key
const personTargets = [];  // person meshes -> agent id
const R = {};              // runtime per agent
const deptRT = {};         // runtime per dept
const screenSets = [];

for (const [key_, L] of Object.entries(LAYOUT).filter(([k])=>k==='pm'||DEPT_KEYS.includes(k))) {
  const dept = DEPTS[key_];
  const g = new THREE.Group();
  g.position.set(L.pos[0], 0, L.pos[1]);
  const plinth = makePlinth(L.w, L.d, dept.floor);
  g.add(plinth);
  plinth.traverse(o => { if (o.isMesh) { o.userData.dept = key_; clickTargets.push(o); } });
  plinth.children[0].userData.part = 'plinth'; plinth.children[1].userData.part = 'floor'; plinth.children[1].userData.chip = dept.chip; // dark mode re-tints these

  // no floor titles — the billboards name each department (AJ's call, M2.3)
  scene.add(g);
  deptRT[key_] = { group: g, L };
}

// brain centre (V3.6, AJ 6 Sep 2026): the particle nebula is RETIRED. The vault's wiki-link graph
// is etched into the pod floor (src/brain.js); reads glint, writes add notes, G opens the full graph.
let brain;
{
  brain = initBrain({ scene, brainGroup: new THREE.Group(), getR: () => R, esc: (t) => esc(t), hud, toScreen: (p) => toScreen(p), getCamera: () => camera });
  brain.setQuiet(true);
  const plant = makePlant(); plant.position.set(6.2, 0.12, -5.8); deptRT.pm.group.add(plant);
  const brainBtn = document.createElement('button'); brainBtn.id = 'brainBtn'; brainBtn.type = 'button'; brainBtn.title = 'The Brain: your company knowledge (G)';
  brainBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="6" cy="7" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="12" cy="13" r="2.4"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="18" r="2"/><path d="M7.8 8.3 10.3 11.5M16.3 7.4 13.7 11.3M10.4 14.7 7.4 17.6M13.6 14.8 16.5 16.9"/></svg><span>Brain</span><b>0</b>';
  brainBtn.onclick = () => brain.open(); document.body.appendChild(brainBtn);
}

// walkways dept -> brain
for (const k of DEPT_KEYS) {
  const L = LAYOUT[k];
  const sx = Math.sign(L.pos[0]), sz = Math.sign(L.pos[1]);
  const from = [L.pos[0] - sx * (L.w / 2 - 1), L.pos[1] - sz * (L.d / 2 - 1)];
  const to = [sx * 6.5, sz * 6.5];
  const walk = makeWalkway(from, to);
  walk.userData.dept = k; walk.userData.part = 'walkway';
  scene.add(walk);
  deptRT[k].gate = new THREE.Vector3(from[0], 0, from[1]);
  deptRT[k].brainGate = new THREE.Vector3(to[0], 0, to[1]);
}
// tag remaining brain furnishings (plinth, plant) for the focus-dim pass — these DO go
// dark in galaxy mode, unlike the 'brainCore' nebula tagged above
deptRT.pm.group.traverse(o => { if ((o.isMesh || o.isSprite) && !o.userData.dept) o.userData.dept = 'pm'; });

/* (M5.3 per AJ: the bridge cables are gone — the walkways alone carry the connection;
   the brain↔dept relationship shows through the badge sweep + meetings.) */

// The CEO's desk at the front of the office. The Program Manager walks here when it needs you.
const CEO_AT = new THREE.Vector3(13, 0.12, 0);
let ceoPill = null, ceoScreen = null;
{
  const floor = makePlinth(8, 7, '#F1EBDD'); floor.position.set(CEO_AT.x, 0, CEO_AT.z);
  floor.traverse(o => { if (o.isMesh) { o.userData.dept = 'ceo'; clickTargets.push(o); } }); scene.add(floor);
  const station = new THREE.Group(); station.position.copy(CEO_AT); station.rotation.y = Math.PI / 4;
  const { group: desk, screenSet } = makeDesk('#2F3B4C', { lead: true }); station.add(desk); ceoScreen = screenSet;
  screenSet.draw(['Inbox', 'All clear'], 'idle'); screenSet.tex.needsUpdate = true;
  const chair = makeChair(); chair.position.set(0, 0, 1.75); station.add(chair);
  station.traverse(o => { if (o.isMesh) { o.userData.dept = 'ceo'; clickTargets.push(o); } }); scene.add(station);
  ceoPill = document.createElement('div'); ceoPill.className = 'pill ceo-pill';
  ceoPill.innerHTML = '<span class="pill-name">YOUR DESK</span><span class="pill-chip" hidden></span>';
  ceoPill.onclick = () => tasks?.openInbox(); hud.appendChild(ceoPill);
}
const PM_AGENT = { id: 'pm', name: 'PROGRAM MANAGER', dept: 'pm', lead: true, role: 'Program Manager', does: 'Plans the work, brings in the right team leads and closes tasks once they approve.', grid: [0.5, 1.15], hair: '#303038', skin: '#D7A37D' };

/* desks + people per dept */
const COLS = { emails: 2, sales: 2, marketing: 2, ops: 2, fin: 2, delivery: 2 };
for (const a of [...AGENTS, PM_AGENT]) {
  const dRT = deptRT[a.dept];
  const dept = DEPTS[a.dept];
  const L = dRT.L;
  const cols = AGENTS.filter(x => x.dept === a.dept).length > 8 ? 3 : (COLS[a.dept] || 2);
  const gx = (a.grid[0] - (cols - 1) / 2) * 8.6;
  const gz = (a.grid[1] - 1) * 6.4 - 1;
  const base = new THREE.Vector3(L.pos[0] + gx, 0.12, L.pos[1] + gz);

  // whole station rotated 45° so monitor screens face the camera square-on
  const ANG = Math.PI / 4;
  const rot = (v) => v.applyAxisAngle(new THREE.Vector3(0, 1, 0), ANG);

  const station = new THREE.Group();
  station.position.copy(base);
  station.rotation.y = ANG;
  const { group: desk, screenSet, activity } = makeDesk(dept.chip, { lead: !!a.lead });
  screenSet.draw(['Ready when you are'], 'idle'); screenSet.tex.needsUpdate = true;
  station.add(desk);
  screenSets.push({ screenSet, dept: a.dept });
  const chair = makeChair();
  chair.position.set(0, 0, 1.75);
  station.add(chair);
  station.traverse(o => { if (o.isMesh) o.userData.dept = a.dept; }); // focus-dim tagging
  scene.add(station);

  const person = makePerson({ hair: a.hair, skin: a.skin, chip: dept.chip, lead: a.lead });
  person.position.copy(base).add(rot(new THREE.Vector3(0, 0, 1.7)));
  person.rotation.y = ANG + Math.PI; // face the monitor
  person.traverse(o => { if (o.isMesh) { o.userData.agentId = a.id; o.userData.dept = a.dept; personTargets.push(o); } });
  scene.add(person);

  const warn = makeWarnSprite();
  warn.visible = false;
  scene.add(warn);

  // name pill (HTML) — clickable, same as clicking the agent
  const pill = document.createElement('div');
  pill.className = 'pill';
  pill.innerHTML = `<span class="pill-name">${a.lead ? '<span class="star">★</span>' : ''}${esc(a.name)}</span><span class="pill-chip" hidden></span>`;
  pill.addEventListener('click', () => openAgent(a.id, a.lead ? 'chat' : 'activity'));
  hud.appendChild(pill);

  R[a.id] = {
    a, person, warn, pill, desk, screenSet, activity, seat: person.position.clone(), seatRot: ANG + Math.PI,
    stand: person.position.clone().add(rot(new THREE.Vector3(1.5, 0, 0.15))),
    state: 'working', bob: Math.random() * 10, path: null, pathI: 0, speed: 9.5, ask: null,
    persona: { role: a.role || a.name, tagline: a.does || '', greeting: '', chips: [] }, feed: [],
  };
}

/* CONNECTORS — per-dept dock of MCP logos with back-and-forth traffic (AJ's spec, 2 Aug rev 2)
   V3.1: served, the list is the user's REAL MCP servers (GET /api/mcp) — the strip waits for it.
   Opened as a file the demo list plays at once. `mcp` is a thin proxy so the rest of the office
   never cares which it got. */
const mcp = { sprites: [], tick() {}, onToolsUsed() {}, showTip() {}, setDark() {} }; // connectors live in Settings → Tools

// plants on outer corners
for (const k of DEPT_KEYS) {
  const L = LAYOUT[k];
  const sx = Math.sign(L.pos[0]), sz = Math.sign(L.pos[1]);
  const p = makePlant();
  p.position.set(L.pos[0] + sx * (L.w / 2 - 1.6), 0.12, L.pos[1] + sz * (L.d / 2 - 1.6));
  p.traverse(o => { if (o.isMesh) o.userData.dept = k; });
  scene.add(p);
}

/* ---------- focus dim: unfocused depts genuinely darken/desaturate in-scene ---------- */
let focusDimTarget = 0, focusDim = 0;
const dimSwapped = [];
const dimCache = new Map();
function dimTwin(m) {
  if (!dimCache.has(m.uuid)) {
    const d = m.clone();
    d.userData.baseColor = m.color.clone();
    const l = (m.color.r + m.color.g + m.color.b) / 3;
    d.userData.dimColor = new THREE.Color(l * 0.40 + 0.10, l * 0.40 + 0.10, l * 0.38 + 0.09);
    dimCache.set(m.uuid, d);
  }
  return dimCache.get(m.uuid);
}
function applySceneDim(deptKey) {
  restoreSceneDim();
  scene.traverse(o => {
    if (!(o.isMesh || o.isLine || o.isSprite) || !o.material || o.material.isShadowMaterial || !o.userData.dept) return;
    if (o.userData.dept === deptKey) return;
    if (deptKey === 'brain' && o.userData.dept === 'brainCore') return; // brain focus keeps its nebula lit
    dimSwapped.push({ mesh: o, orig: o.material });
    o.material = dimTwin(o.material);
  });
}
function restoreSceneDim() {
  for (const s of dimSwapped) s.mesh.material = s.orig;
  dimSwapped.length = 0;
}
function tickDim(dt) {
  focusDim += (focusDimTarget - focusDim) * (1 - Math.exp(-dt * 5));
  if (focusDimTarget === 0 && focusDim < 0.02 && dimSwapped.length) restoreSceneDim();
  for (const m of dimCache.values())
    m.color.copy(m.userData.baseColor).lerp(m.userData.dimColor, focusDim);
}

/* ---------- department billboards — v1's exact agreed metric rows + amber approval row ---------- */
let brainNotes = brain.state.notes;
const BB_ROWS = Object.fromEntries([...DEPT_KEYS, 'pm'].map(k => [k, []]));
document.body.classList.add('live-office');
for (const k of [...DEPT_KEYS, 'pm']) {
  const dept = DEPTS[k];
  const n = AGENTS.filter(a => a.dept === k).length;
  const b = document.createElement('div');
  b.className = 'badge';
  b.innerHTML = `
    <div class="b-name"><span class="dot" style="background:${dept.chip}"></span>${esc(dept.short)}<span class="live"></span></div>
    <div class="b-count">${k === 'brain' ? '<span class="b-num">∞</span><span class="b-lab">KNOWLEDGE</span>' : `<span class="b-num">${n}</span><span class="b-lab">AGENTS</span>`}</div>
    <div class="b-metrics">${BB_ROWS[k].map((row, i) => `
      <div class="m-row"><span class="m-lab">${row[0]}</span><span class="m-val" data-m="${k}-${i}">${row[1]()}</span></div>`).join('')}
    </div>
    <div class="b-appr" style="display:none"><span class="ap-n">1</span> NEED YOU</div>`;
  b.addEventListener('click', (e) => {
    if (e.target.closest('.b-appr')) { zoomToApproval(k); e.stopPropagation(); }
    else zoomToDept(k);
  });
  if (k === 'pm') { b.className = 'badge pmTag'; b.innerHTML = `<div class="b-name"><span class="dot" style="background:${dept.chip}"></span>PROGRAM MANAGER</div>`; b.title = 'Talk to the Program Manager'; }
  hud.appendChild(b);
  deptRT[k].badge = b;
  deptRT[k].vals = BB_ROWS[k].map(row => String(row[1]()));
  deptRT[k].apprRow = b.querySelector('.b-appr');
  deptRT[k].apprN = b.querySelector('.ap-n');
  // anchor just above the FIRST DESK ROW (z-9.6), not the pod edge — keeps the card-to-agents
  // gap consistent across pods of different depths. Support docks to the side instead: its
  // natural spot is off-screen at overview and the clamp used to shove it onto its agents.
  // V3.2 (AJ): every card sits ON its own pod, over the wiring — screen-tuned per pod at the
  // 0.84 overview. Standard = centred above the anchor (back corner, y clears the pills);
  // side = hangs off the pod's edge, vertically centred (fin: its back corner is the Brain;
  // ops: its back corner is the marketing pod's front row).
  const ANCHOR = {
    marketing: [-36, 8.6, 13.4],
    emails:    [-30, 8.6, -32.6],
    delivery:  [0, 10.6, -57.6],   // y 10.6: the top-bar clamp otherwise lands it on the back-row pills
    sales:     [48, 8.6, -32],     // over the pod's right corner — past the DELIVERY pod's desks and the Sales Lead pill
    ops:       [-13.5, 4, 54],     // side LEFT
    fin:       [43.5, 4, 17],      // side RIGHT
    pm:        [-5.5, 3.2, -5.5],  // just above the pod's back corner
  };
  deptRT[k].badgeAnchor = new THREE.Vector3(...((DEPT_KEYS.length>6 && k!=='pm') || !ANCHOR[k] ? [LAYOUT[k].pos[0],9,LAYOUT[k].pos[1]-LAYOUT[k].d/2-2] : ANCHOR[k]));
  if (k === 'fin' && DEPT_KEYS.length<=6) deptRT[k].sideBadge = true;
  if (k === 'ops' && DEPT_KEYS.length<=6) { deptRT[k].sideBadge = true; deptRT[k].sideLeft = true; }
}
function updateBillboards() {
  for (const k of Object.keys(BB_ROWS).filter(k=>deptRT[k])) {
    BB_ROWS[k].forEach((row, i) => {
      const nv = String(row[1]());
      if (nv !== deptRT[k].vals[i]) {
        deptRT[k].vals[i] = nv;
        const el = deptRT[k].badge.querySelector(`[data-m="${k}-${i}"]`);
        if (!el) return; // the brain tag carries no metric rows
        el.textContent = nv;
        el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
        const rel = document.querySelector(`[data-rm="${k}-${i}"]`); // docked rail copy
        if (rel) {
          rel.textContent = nv;
          rel.classList.remove('flash'); void rel.offsetWidth; rel.classList.add('flash');
        }
      }
    });
  }
}

/* ---------- controls: wheel zoom-to-cursor, drag pan, click to fly ---------- */
const ray = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function worldAt(nx, ny) {
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const p = new THREE.Vector3();
  ray.ray.intersectPlane(groundPlane, p);
  return p;
}
let focused = null; // dept key when zoomed into a dept

addEventListener('wheel', (e) => {
  // Only the scene zooms. Wheel over the task panel, the rail, dialogs or settings scrolls them instead.
  const overScene = e.target === canvas || (e.target.closest && e.target.closest('#hud'));
  if (!overScene) return;
  e.preventDefault();
  tween = null;
  view.arc = 0;
  const nx = (e.clientX / innerWidth) * 2 - 1, ny = -(e.clientY / innerHeight) * 2 + 1;
  const before = worldAt(nx, ny);
  view.zoom = clamp(view.zoom * Math.exp(-e.deltaY * 0.0032), Math.min(0.72,OVERVIEW.zoom), 5.2);
  applyCamera();
  const after = worldAt(nx, ny);
  if (before && after) view.target.add(before.sub(after));
  if (view.zoom < 1.6 && focused) {
    if (focused === 'brain') focused = null; else exitFocus(false);
  }
  syncOverviewBtn();
}, { passive: false });

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: false };
});
addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
  if (drag.moved) {
    tween = null;
    const a = worldAt((drag.x / innerWidth) * 2 - 1, -(drag.y / innerHeight) * 2 + 1);
    const b = worldAt((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (a && b) view.target.add(a.sub(b));
    drag.x = e.clientX; drag.y = e.clientY;
  }
});
addEventListener('pointerup', (e) => {
  const wasDrag = drag && drag.moved;
  drag = null;
  if (wasDrag) return;
  if (e.target !== canvas) return; // HTML chrome handles its own clicks
  const nx = (e.clientX / innerWidth) * 2 - 1, ny = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const mHits = ray.intersectObjects(mcp.sprites, false);
  if (mHits.length) { // MCP logo tile → pulse + connection tooltip
    mcp.showTip(mHits[0].object, e.clientX, e.clientY, performance.now());
    return;
  }
  const pHits = ray.intersectObjects(personTargets, false);
  if (pHits.length) {
    // clicking an agent opens its rail — a stuck agent opens straight to Chat (v1 rule)
    { const id = pHits[0].object.userData.agentId; openAgent(id, R[id]?.a.lead ? 'chat' : 'activity'); }
    return;
  }
  const hits = ray.intersectObjects(clickTargets, false);
  if (hits.length) {
    const dk = hits[0].object.userData.dept;
    if (dk === 'ceo') { tasks?.openInbox(); return; }
    if (dk === 'brain') { brain.open(); return; } // V3.6: the Brain opens as the graph
    if (dk !== focused) enterFocus(dk);
  }
});
addEventListener('keydown', (e) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return; // typing in the bar, the big editor or a menu never fires a hotkey
  if (e.key === 'Escape') { if (brain.isOpen()) brain.close(); else if (tasks && tasks.isOpen()) tasks.close(); else zoomOut(); }
  else if (e.key === 'g' || e.key === 'G') brain.toggle(); // V3.6: the full-screen Brain graph
  else if (e.key === 'b' || e.key === 'B') { if (tasks) tasks.toggle(); } // V3: the company-wide board
  else if (e.key === '+' || e.key === '=') zoomStep(1.5);
  else if (e.key === '-' || e.key === '_') zoomStep(1 / 1.5);
  else if (e.key === '0') zoomOut();
  else if (e.key === 'i' || e.key === 'I') tasks?.openInbox();
  else if (e.key >= '1' && e.key <= '6') { // jump straight to a department
    const dept = ['marketing', 'emails', 'sales', 'ops', 'fin', 'delivery'][+e.key - 1];
    if (focused !== dept) enterFocus(dept);
  }
  else if (e.key === 'c' || e.key === 'C') { // in a department: open its (lead) agent's chat
    if (focused && focused !== 'brain') {
      const a = AGENTS.find(x => x.dept === focused && x.lead) || AGENTS.find(x => x.dept === focused);
      if (a) openAgentRail(a.id, 'chat');
    }
  }
  else if (e.key === 'v' || e.key === 'V') setCam(!document.body.classList.contains('cam'));
  else if (e.key === 'd' || e.key === 'D') setDark(!darkOn);
});

// camera mode: mid-tone backdrop for filming the screen (#cam=1 / V toggles)
function setCam(on) { document.body.classList.toggle('cam', !!on); }
// DARK MODE (AJ, 6 Sep 2026: "make another one in dark mode as I will show both"): D toggles, #dark=1
// forces it, /dark on the server opens in it. The chrome follows the CSS tokens; the scene
// re-tints its shared materials (plinths, floors, walkways), relights, and the Brain/wires swap ink.
let darkOn = false;
const DARK = { plinth: 0x2c2d2b, walkway: 0x303230, ground: 0x1b1c1a };
function mix(hex, base, k) { const a = new THREE.Color(hex), b = new THREE.Color(base); return b.lerp(a, k); }
function setDark(on) {
  darkOn = !!on;
  document.body.classList.toggle('dark', darkOn);
  restoreSceneDim(); dimCache.clear(); // the dim twins cache base colours — rebuild them for the new palette
  scene.traverse(o => {
    if (!o.isMesh || !o.userData.part) return;
    const m = o.material; if (!m.userData.base) m.userData.base = m.color.clone();
    if (o.userData.part === 'plinth') m.color.set(darkOn ? DARK.plinth : m.userData.base);
    else if (o.userData.part === 'walkway') m.color.set(darkOn ? DARK.walkway : m.userData.base);
    else if (o.userData.part === 'floor') m.color.copy(darkOn ? mix(o.userData.chip, '#1b1c1a', o.userData.dept === 'pm' ? 0.07 : 0.22) : m.userData.base); // the Brain's pale sage needs a lighter touch
  });
  hemi.color.set(darkOn ? 0x8e95a3 : 0xfdfff8); hemi.groundColor.set(darkOn ? 0x14151a : 0xd8d4c8); hemi.intensity = darkOn ? 0.75 : 0.85;
  key.color.set(darkOn ? 0xe4e9f2 : 0xfff1dd); key.intensity = darkOn ? 1.5 : 2.2;
  ground.material.opacity = darkOn ? 0.35 : 0.13;
  if (focused && focused !== 'brain') applySceneDim(focused);
  if (brain) brain.setTheme(darkOn);
  mcp.setDark(darkOn);
}

// double-click empty space → straight back to overview
canvas.addEventListener('dblclick', (e) => {
  const nx = (e.clientX / innerWidth) * 2 - 1, ny = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
  if (!ray.intersectObjects(clickTargets, false).length) zoomOut();
});

// on-screen zoom controls
function zoomStep(f) {
  flyTo([view.target.x, 0, view.target.z], clamp(view.zoom * f, Math.min(0.72,OVERVIEW.zoom), 5.2), 350);
  if (view.zoom * f < 1.6 && focused) {
    if (focused === 'brain') focused = null; else exitFocus(false);
  }
  syncOverviewBtn();
}
document.getElementById('zIn').addEventListener('click', () => zoomStep(1.5));
document.getElementById('zOut').addEventListener('click', () => zoomStep(1 / 1.5));
document.getElementById('zHome').addEventListener('click', zoomOut);

function zoomToDept(k) { enterFocus(k); }
function zoomOut() {
  if (focused && focused !== 'brain') { exitFocus(true); return; }
  focused = null;
  flyTo(overviewPos(), OVERVIEW.zoom, 550);
  syncOverviewBtn();
}
document.getElementById('overviewBtn').addEventListener('click', zoomOut);
function syncOverviewBtn() {
  document.getElementById('overviewBtn').classList.toggle('show',
    (view.zoom > 1.45 && !(tween && tween.toZ <= OVERVIEW.zoom + 0.05)) || !!focused);
}

/* ---------- focus rail: dept billboard + activity rows; agent CHAT & ACTIVITY slide-over ---------- */
const chatHist = {};
const rail = document.getElementById('rail');
const vignette = document.getElementById('vignette');
const mMsgs = document.getElementById('mMsgs');
let modalOpen = null, modalTab = 'chat'; // modalOpen = agent id open in the rail slide-over
// V3.3: the rail docks LEFT for every department — the task panel has the right side
const RAIL_SIDE = Object.fromEntries([...DEPT_KEYS, 'pm'].map(k=>[k,'left']));
const SCREEN_RIGHT = new THREE.Vector3(1, 0, -1).normalize();

function ensureChat(id) {
  if (chatHist[id]) return;
  const r = R[id];
  const greeting = id === 'pm' ? 'I coordinate every team. Tell me what you need and I will bring in the right leads, or ask me about any task.'
    : r.a.lead ? `I lead ${DEPTS[r.a.dept].name}. Tell me what you need and I will plan it, delegate it and review the result. Type @ to pick a task to correct or ask about.`
    : `I am ${r.a.name}. Ask me about my work. Corrections to a task go through my team lead.`;
  chatHist[id] = [{ who: 'agent', text: greeting }];
  tasks?.loadHistory?.(id).then(messages => { if (messages?.length) { chatHist[id].push(...messages); if (modalOpen === id && modalTab === 'chat') renderChat(id); } }).catch(() => {});
}
function chatPush(id, msg) {
  ensureChat(id);
  chatHist[id].push(msg);
  if (chatHist[id].length > 80) chatHist[id].splice(2, 1);
  if (modalOpen === id && modalTab === 'chat') renderChat(id);
}
function renderChat(id) {
  const r = R[id];
  mMsgs.innerHTML = chatHist[id].map((m, i) => {
    if (m.who === 'agent') return `<div class="m-agent">${esc(m.text)}${m.taskId ? `<button class="space-chat-task" data-chat-task="${esc(m.taskId)}">Open the task ↗</button>` : ''}${m.suggestedTask ? `<div class="chat-suggest"><button type="button" data-make-task="${i}">Make this a task</button><button type="button" class="secondary" data-ask-lead="${i}">Send to my lead</button></div>` : ''}</div>`;
    if (m.who === 'user') return `<div class="m-user">${m.about ? `<span class="chat-about">${esc(m.about)}</span>` : ''}${esc(m.text)}</div>`;
    if (m.who === 'work') return `<div class="m-work"><span class="wi">${m.i || '▸'}</span>${esc(m.text)}</div>`;
    if (m.who === 'file') return `
      <div class="m-file" data-i="${i}">
        <div class="f-head"><span>${m.icon}</span><div><div class="f-name">${esc(m.name)}</div><div class="f-meta">${esc(m.meta)}</div></div></div>
        <pre>${esc(m.content)}</pre>
      </div>`;
    if (m.who === 'appr') return `
      <div class="m-appr" data-i="${i}">
        <div class="a-who">needs your approval</div>
        <div class="a-ask">${esc(m.text)}</div>
        ${m.mock ? `<div class="a-mock">${m.mock}</div>` : ''}
        ${m.pending
          ? '<div class="a-btns"><button class="a-yes">APPROVE</button><button class="a-no">REJECT</button></div>'
          : `<div class="a-done">${m.approved ? '✓ Approved' : '✗ Rejected'} by AJ</div>`}
      </div>`;
    return '';
  }).join('');
  mMsgs.querySelectorAll('[data-chat-task]').forEach(el=>el.onclick=()=>tasks.openTask(el.dataset.chatTask));
  mMsgs.querySelectorAll('.m-file').forEach(el =>
    el.addEventListener('click', () => el.classList.toggle('exp')));
  mMsgs.querySelectorAll('[data-make-task]').forEach(el => el.onclick = () => tasks.makeTaskFrom(chatHist[id][+el.dataset.makeTask].suggestedTask));
  mMsgs.querySelectorAll('[data-ask-lead]').forEach(el => el.onclick = () => { const s = chatHist[id][+el.dataset.askLead].suggestedTask, lead = AGENTS.find(x => x.dept === s.dept && x.lead); if (lead) { openAgent(lead.id, 'chat'); setTimeout(() => { const box = document.getElementById('mIn'); box.value = s.text; box.focus(); }, 700); } });
  mMsgs.scrollTop = mMsgs.scrollHeight;
}
function renderActivity(id) { tasks.renderAgent(id); }
/* camera target offset so the pod sits beside the rail, not behind it */
function focusTarget(k, atPos) {
  const base = atPos ? [atPos.x, 0, atPos.z] : [LAYOUT[k].pos[0], 0, LAYOUT[k].pos[1] + 1];
  const boardW = (tasks ? tasks.panelWidth() : 400) + 30; // V3.3: the task panel is always on the right
  const zoom = atPos ? 3.3 : 2.5;
  const pxPerWorld = zoom * innerHeight / (2 * FR);
  const railW = Math.min(400, innerWidth * 0.92);
  // pod sits in the middle of whatever screen is left: rail on one side, board (if open) on the other
  const shift = ((railW - boardW) / 2 + (boardW ? 0 : 30)) / pxPerWorld;
  const dir = RAIL_SIDE[k] === 'left' ? -shift : shift;
  return { pos: [base[0] + SCREEN_RIGHT.x * dir, 0, base[2] + SCREEN_RIGHT.z * dir], zoom };
}
function enterFocus(k, pendingAgentId) {
  if (k === 'brain') { // the Brain keeps its plain fly-in (AJ's call)
    focused = 'brain';
    if (tasks) tasks.onFocusChange('brain');
    flyTo([LAYOUT.brain.pos[0], 0, LAYOUT.brain.pos[1] + 1.5], 3.1, 700);
    syncOverviewBtn();
    return;
  }
  if (focused === k && !pendingAgentId) return;
  if (focused && focused !== k) { rail.classList.remove('open', 'agentOpen'); modalOpen = null; }
  focused = k;
  if (tasks) tasks.onFocusChange(k);
  focusDimTarget = 1;
  applySceneDim(k);
  vignette.classList.add('on');
  const t = focusTarget(k);
  flyTo(t.pos, t.zoom, 950, {
    arc: RAIL_SIDE[k] === 'left' ? 0.10 : -0.10,
    onDone: () => { if (pendingAgentId) openAgentRail(pendingAgentId, pendingTab, true); pendingTab = 'chat'; },
  });
  buildDeptRail(k);
  rail.className = RAIL_SIDE[k];
  rail.style.display = 'block';
  // V3.4: the rail IS the chat — it opens on the department lead (or first agent) at once
  // (after the className reset above, which would otherwise drop the agentOpen state)
  const first = pendingAgentId || (k === 'pm' ? 'pm' : (AGENTS.find(x => x.dept === k && x.lead) || AGENTS.find(x => x.dept === k)).id);
  openAgentRail(first, pendingAgentId ? pendingTab : 'chat', false);
  document.getElementById('overviewBtn').classList.toggle('right', RAIL_SIDE[k] === 'left');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    rail.classList.add('open');
    flyBillboardIntoRail(k);
    cascadeRows();
  }));
  syncOverviewBtn();
}
function exitFocus(flyOut = true) {
  if (!focused) return;
  const k = focused;
  focused = null;
  modalOpen = null;
  if (tasks) tasks.onFocusChange(null);
  focusDimTarget = 0;
  vignette.classList.remove('on');
  rail.classList.remove('open', 'agentOpen');
  setTimeout(() => { if (!focused) rail.style.display = 'none'; }, 650);
  document.getElementById('overviewBtn').classList.remove('right');
  if (k !== 'brain' && deptRT[k] && deptRT[k].badge) deptRT[k].badge.style.display = '';
  if (flyOut) flyTo(overviewPos(), OVERVIEW.zoom, 700);
  syncOverviewBtn();
}
function buildDeptRail(k) {
  const dept = DEPTS[k];
  const n = k === 'pm' ? DEPT_KEYS.length : AGENTS.filter(a => a.dept === k).length;
  const rh = document.getElementById('railHeader');
  rh.classList.remove('show');
  rh.innerHTML = `
    <div class="b-name"><span class="dot" style="background:${dept.chip}"></span>${esc(dept.name)}<span class="live"></span></div>
    <div class="b-count"><span class="b-num">${n}</span><span class="b-lab">${k === 'pm' ? 'TEAMS' : 'AGENTS'}</span></div>
    <div class="b-metrics">${BB_ROWS[k].map((row, i) => `
      <div class="m-row"><span class="m-lab">${row[0]}</span><span class="m-val" data-rm="${k}-${i}">${row[1]()}</span></div>`).join('')}</div>
    ${tasks ? tasks.rowHTML(k) : ''}
    <div class="b-appr" style="display:${stuckIn(k).length ? 'flex' : 'none'}"><span class="ap-n">${stuckIn(k).length}</span> NEED YOU</div>`;
  rh.querySelector('.b-appr').addEventListener('click', () => {
    const s = stuckIn(k)[0];
    if (s) openAgentRail(s.a.id, 'activity');
  });
  // V3.7 (AJ, 6 Sep): the agent-chip strip is gone — click an agent in the scene to talk to them
}
function cascadeRows() {
  document.querySelectorAll('#railRows .arow').forEach((el, i) => {
    el.style.transitionDelay = (280 + i * 85) + 'ms';
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { el.style.transitionDelay = '0ms'; }, 1600);
  });
}
/* the floating billboard physically FLIES and docks as the rail header (the hero beat) */
function flyBillboardIntoRail(k) {
  const badge = deptRT[k].badge;
  const from = badge.getBoundingClientRect();
  badge.style.display = 'none';
  const side = RAIL_SIDE[k];
  const railW = rail.offsetWidth;
  const tLeft = side === 'left' ? 18 : innerWidth - railW + 18;
  const clone = badge.cloneNode(true);
  clone.style.cssText = `position:fixed;box-sizing:border-box;left:${from.left}px;top:${from.top}px;` +
    `width:${from.width}px;margin:0;transform:none;transition:all .72s var(--ease);z-index:40;pointer-events:none;opacity:1;`;
  document.body.appendChild(clone);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    clone.style.left = tLeft + 'px';
    clone.style.top = (52 + 18) + 'px';
    clone.style.width = (railW - 36) + 'px';
  }));
  setTimeout(() => {
    clone.remove();
    document.getElementById('railHeader').classList.add('show');
  }, 740);
}
function openAgentRail(id, tab = 'chat', fly = true) {
  const r = R[id];
  ensureChat(id);
  modalOpen = id;
  const dept = DEPTS[r.a.dept];
  document.querySelector('#railAgent .mh-dot').style.background = dept.chip;
  document.querySelector('#railAgent .mh-name').innerHTML =
    (r.a.lead ? '<span class="star">★ </span>' : '') + r.a.name;
  document.querySelector('#railAgent .mh-role').textContent = `${r.persona.role} · ${dept.name}`;
  document.querySelector('#railAgent .mh-tag').textContent = r.persona.tagline;
  tasks?.chatContext?.(id, true);
  document.getElementById('mChips').innerHTML = (r.persona.chips || []).map(c =>
    `<button>${esc(c)}</button>`).join('');
  document.getElementById('mChips').querySelectorAll('button').forEach(b =>
    b.addEventListener('click', () => sendChat(b.textContent)));
  rail.classList.add('agentOpen');
  setTab(tab);
  if (tasks && tasks.railFor) tasks.railFor(id); // V3.5: the agent's routines strip
  if (fly) { const t = focusTarget(r.a.dept, r.seat); flyTo(t.pos, t.zoom, 500); }
}
// V3: the board opening/closing re-centres the pod without leaving focus
function reframe() {
  if (!focused || focused === 'brain' || modalOpen) return;
  const t = focusTarget(focused);
  flyTo(t.pos, t.zoom, 600);
}
function railBack() { // V3.4: "back" = back to the pod view, chat stays on the lead
  if (!focused || focused === 'brain') return;
  const lead = focused === 'pm' ? R.pm.a : AGENTS.find(x => x.dept === focused && x.lead) || AGENTS.find(x => x.dept === focused);
  openAgentRail(lead.id, 'chat', false);
  const t = focusTarget(focused);
  flyTo(t.pos, t.zoom, 500);
}
document.getElementById('railBack').addEventListener('click', railBack);
let pendingTab = 'chat';
// compat entry point (person clicks, pills, CC export): route through focus mode
function openAgent(id, tab = 'activity') {
  const dept = R[id].a.dept;
  if (focused === dept) { openAgentRail(id, tab); return; }
  pendingTab = tab;
  enterFocus(dept, id);
}
function setTab(tab) {
  modalTab = tab;
  document.querySelectorAll('#rail .mtabs button').forEach(b =>
    b.classList.toggle('on', b.dataset.tab === tab));
  document.getElementById('mChat').style.display = tab === 'chat' ? 'flex' : 'none';
  document.getElementById('mAct').style.display = tab === 'activity' ? 'flex' : 'none';
  if (tab === 'chat') renderChat(modalOpen); else renderActivity(modalOpen);
}
document.querySelectorAll('#rail .mtabs button').forEach(b =>
  b.addEventListener('click', () => setTab(b.dataset.tab)));
function sendChat(text) {
  const id = modalOpen;
  if (!id || !text.trim()) return;
  const r = R[id], context = tasks.chatContext(id);
  chatPush(id, { who: 'user', text, about: context.about });
  document.getElementById('mIn').value = '';
  const thinking = `${r.a.name} is thinking`;
  const clear = () => { const h = chatHist[id], k = h.findIndex(m => m.who === 'work' && m.text === thinking); if (k >= 0) h.splice(k, 1); };
  (async () => {
    if (!context.taskId) { const handled = await tasks.handleChat(id, text); if (handled) { chatPush(id, { who: 'agent', text: handled }); return; } }
    chatPush(id, { who: 'work', i: '…', text: thinking });
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent: id, text, taskId: context.taskId, refs: context.refs, kind: context.kind, remember: context.remember }) });
      const j = await res.json(); if (!res.ok) throw new Error(j.error || res.statusText);
      clear(); chatPush(id, { who: 'agent', text: j.reply, taskId: j.taskId, suggestedTask: j.suggestedTask });
      tasks.chatSent(id);
      if (j.taskId || j.routines) tasks.refresh();
      if (j.read) for (const n of j.read.slice(0, 2)) brain.readNote(id, n);
    } catch (e) { clear(); chatPush(id, { who: 'agent', text: `I could not answer that: ${e.message}` }); }
  })();
}
document.getElementById('mSend').addEventListener('click', () =>
  sendChat(document.getElementById('mIn').value));
document.getElementById('mIn').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (tasks?.chatPickerKey?.(e)) return; // the @ task picker takes arrows and Enter while it is open
  if (e.key === 'Enter') sendChat(e.target.value);
});
document.getElementById('mIn').addEventListener('input', (e) => tasks?.chatInput?.(modalOpen, e.target));
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'now' : m < 60 ? m + 'm ago' : Math.round(m / 60) + 'h ago';
}

/* ---------- needs you: people waiting on the CEO show on their team's card ---------- */
function stuckIn(dept) { return Object.values(R).filter(r => r.a.dept === dept && r.livePhase === 'needs'); }
function syncApprovals() {
  for (const k of DEPT_KEYS) { const n = stuckIn(k).length; if (deptRT[k].apprRow) { deptRT[k].apprRow.style.display = n ? 'flex' : 'none'; deptRT[k].apprN.textContent = n; } }
  if (focused && focused !== 'brain') { const ap = document.querySelector('#railHeader .b-appr'); if (ap) { const n = stuckIn(focused).length; ap.style.display = n ? 'flex' : 'none'; ap.querySelector('.ap-n').textContent = n; } }
}
function zoomToApproval(dept) {
  const s = stuckIn(dept)[0];
  if (!s) { enterFocus(dept); return; }
  if (focused === dept) openAgentRail(s.a.id, 'activity'); else { pendingTab = 'activity'; enterFocus(dept, s.a.id); }
}

/* ---------- minimal sim: work bobs, screen updates, brain meetings ---------- */
function walkStep(r, dt) {
  const cur = r.person.position, tgt = r.path[r.pathI];
  const d = new THREE.Vector3().subVectors(tgt, cur); d.y = 0;
  const dist = d.length();
  const step = r.speed * dt;
  if (dist <= step) {
    cur.copy(tgt);
    r.pathI++;
    if (r.pathI >= r.path.length) return true;
  } else {
    d.normalize();
    cur.addScaledVector(d, step);
    r.person.rotation.y = Math.atan2(d.x, d.z);
  }
  return false;
}

// standing modes drift the agent from the chair to a spot beside the desk, and can re-face the camera
const FACE_CAM = Math.PI / 4;
function applyStandAndFacing(r, mode, now, dt) {
  const u = r.person.userData;
  const sk = (u.cur && u.cur.standK) || 0;
  r.person.position.x = r.seat.x + (r.stand.x - r.seat.x) * sk;
  r.person.position.z = r.seat.z + (r.stand.z - r.seat.z) * sk;
  if (mode === 'spin') {
    const span = Math.max(400, (r.modeUntil - r.modeStart) || 1500);
    r.person.rotation.y = r.seatRot + ((now - r.modeStart) / span) * Math.PI * 2;
    return;
  }
  const target = (mode === 'stretch' || mode === 'cheer' || mode === 'wave') ? FACE_CAM : r.seatRot;
  let d = target - r.person.rotation.y;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  r.person.rotation.y += d * (1 - Math.exp(-dt * 6));
}
// floating emoji work-bubbles — constant visible "something is happening" at any zoom
const emoteTex = {};
function getEmoteTex(icon) {
  if (!emoteTex[icon]) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    // cream bubble disc so the icon reads at any zoom
    x.beginPath(); x.arc(64, 60, 52, 0, 7);
    x.fillStyle = 'rgba(253,255,248,0.97)'; x.fill();
    x.lineWidth = 3; x.strokeStyle = 'rgba(21,20,20,0.25)'; x.stroke();
    x.beginPath(); x.moveTo(50, 106); x.lineTo(64, 124); x.lineTo(74, 104); x.closePath();
    x.fillStyle = 'rgba(253,255,248,0.97)'; x.fill();
    x.font = '58px "Apple Color Emoji", serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#151414';
    x.fillText(icon, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    emoteTex[icon] = t;
  }
  return emoteTex[icon];
}
const emotes = [];
function spawnEmote(r, icon) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: getEmoteTex(icon), depthTest: false, transparent: true }));
  const p = r.person.position;
  s.position.set(p.x + 0.7, p.y + 5.6, p.z);
  s.scale.set(2.9, 2.9, 1);
  scene.add(s);
  emotes.push({ s, born: performance.now() });
}
function tickEmotes(now, dt) {
  for (let i = emotes.length - 1; i >= 0; i--) {
    const e = emotes[i], age = (now - e.born) / 1700;
    if (age >= 1) {
      scene.remove(e.s); e.s.material.dispose(); emotes.splice(i, 1);
    } else {
      e.s.position.y += dt * 1.7;
      e.s.material.opacity = age < 0.15 ? age / 0.15 : 1 - (age - 0.15) / 0.85;
    }
  }
}
function tickSim(now, dt) {

  for (const r of Object.values(R)) {
    if (r.state === 'working') {
      {
        const work = tasks?.agentActivity(r.a.id);
        const phase = work?.phase || 'idle', active = ['working', 'planning', 'reviewing'].includes(phase);
        const motion = phase === 'needs' ? 'wave' : active ? (phase === 'reviewing' || phase === 'planning' ? 'read' : 'type') : 'idle';
        poseWork(r.person, motion, now + r.bob * 500, dt);
        applyStandAndFacing(r, motion, now, dt);
        r.activity.material.color.set(phase==='done'?'#36C98B':phase==='reviewing'?'#B491ED':phase==='needs'?'#F0A43A':'#62BCEA');
        r.activity.material.opacity = active || phase === 'needs' ? 0.38 + 0.18 * Math.sin(now / 500 + r.bob) : phase==='done' ? 0.32 : 0;
        const screenKey = phase + (work?.title || '') + (active ? Math.floor(now/400) : '');
        if (r.screenKey !== screenKey) {
          const changed = r.livePhase !== phase;
          r.screenKey = screenKey; r.livePhase = phase;
          const status = phase === 'reviewing' ? 'verifying' : phase === 'planning' ? 'planning' : phase === 'done' ? 'done' : phase === 'needs' ? 'needs' : active ? 'working' : 'idle';
          r.screenSet.draw(work ? [work.title.slice(0,26), work.title.slice(26,52)] : ['Ready when you are'], status, now); r.screenSet.tex.needsUpdate = true;
          // One short chip: Working, Reviewing, Needs you or Done. Nothing when idle.
          const chip = { working: 'Working', planning: 'Working', reviewing: 'Reviewing', needs: 'Needs you', done: 'Done' }[phase] || '';
          const el = r.pill.querySelector('.pill-chip'); if (el) { el.hidden = !chip; el.textContent = chip; el.dataset.state = phase; }
          r.pill.dataset.state = chip ? phase : 'idle';
          r.pill.title = work ? `${chip || 'Ready'}: ${work.title}` : 'Ready for a task';
          if (changed) syncApprovals();
        }
        continue;
      }
    } else if (r.state === 'walking' || r.state === 'returning') {
      posePerson(r.person, 'walk', now);
      if (walkStep(r, dt)) {
        if (r.state === 'walking') {
          r.state = 'atBrain';
          r.person.rotation.y = r.person.position.x < 2 ? Math.PI / 2 : -Math.PI / 2;
        } else {
          r.state = 'working';
          r.person.position.copy(r.seat);
          r.person.rotation.y = r.seatRot;
        }
      }
    } else if (r.state === 'atBrain') {
      posePerson(r.person, 'stand', now);
    }
  }
  tickEmotes(now, dt);
  for (const k of DEPT_KEYS) { const active = Object.values(R).some(r => r.a.dept === k && ['working', 'planning', 'reviewing'].includes(r.livePhase)); deptRT[k].badge.classList.toggle('team-working', active); }
  brain.tick(now);
  meetings.tick(now);
  tickCeo(now);
}
// The CEO desk's screen and pill show how many things wait on you.
let ceoTick = 0;
function tickCeo(now) {
  if (now - ceoTick < 1000) return; ceoTick = now;
  const n = tasks?.needsYouCount?.() || 0, chip = ceoPill.querySelector('.pill-chip');
  chip.hidden = !n; chip.textContent = n === 1 ? '1 needs you' : `${n} need you`; chip.dataset.state = 'needs'; ceoPill.dataset.state = n ? 'needs' : 'idle';
  const key = String(n); if (ceoScreen.key !== key) { ceoScreen.key = key; ceoScreen.draw(['Inbox', n ? `${n} waiting on you` : 'All clear'], n ? 'needs' : 'idle', now); ceoScreen.tex.needsUpdate = true; }
}

/* ---------- zoom LOD + HTML overlay projection ---------- */
const v3 = new THREE.Vector3();
function toScreen(p) {
  v3.copy(p).project(camera);
  return [(v3.x * 0.5 + 0.5) * innerWidth, (-v3.y * 0.5 + 0.5) * innerHeight];
}
function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

function tickLOD() {
  { const [x, y] = toScreen(new THREE.Vector3(CEO_AT.x, 5.4, CEO_AT.z)); ceoPill.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%) scale(${0.62 + 0.38 * smooth(1.2, 2.4, view.zoom)})`; ceoPill.style.opacity = focused ? 0.35 : 1; }

  const z = view.zoom;
  const detail = smooth(1.75, 2.5, z);
  const pillA = smooth(1.45, 1.85, z); // pills stay on at near — they name the agents
  // billboards persist at every zoom (v1 rule) — slightly larger when far, compact when near
  const badgeScale = 1.02 - 0.3 * smooth(1.2, 2.6, z);
  for (const [k, d] of Object.entries(deptRT)) {
    if (focused === k && k !== 'brain') continue; // this billboard is docked in the rail
    let [sx, sy] = toScreen(d.badgeAnchor);
    // keep billboards fully on screen (camera-readability rule)
    const bh = d.badge.offsetHeight * badgeScale, bw = d.badge.offsetWidth * badgeScale;
    let xf;
    if (d.sideBadge) { // anchored by an edge, vertically centred (emails/sales/fin/delivery)
      const rightEdge = innerWidth - ((tasks ? tasks.panelWidth() : 400) + 26); // V3.3: never under the panel
      sy = clamp(sy, 64 + bh / 2, innerHeight - bh / 2 - 8);
      if (d.sideLeft) { sx = clamp(sx, bw + 8, rightEdge); xf = 'translate(-100%,-50%)'; }
      else { sx = clamp(sx, 8, rightEdge - bw); xf = 'translate(0,-50%)'; }
    } else {
      const rightEdge = innerWidth - ((tasks ? tasks.panelWidth() : 400) + 26);
      sy = clamp(sy, bh + 64, innerHeight - 12);
      sx = clamp(sx, bw / 2 + 8, rightEdge - bw / 2);
      xf = 'translate(-50%,-100%)';
    }
    d.badge.style.transform = `translate(${sx}px,${sy}px) ${xf} scale(${badgeScale})`;
    d.badge.style.opacity = 1 - 0.75 * focusDim; // unfocused boards recede with the scene
    d.badge.style.pointerEvents = 'auto';
  }
  // name pills stay on at EVERY zoom (AJ's call) — smaller when far, full-size when near
  const pillScale = 0.62 + 0.38 * smooth(1.2, 2.4, z);
  for (const r of Object.values(R)) {
    const p = r.person.position;
    const [sx, sy] = toScreen(v3.set(p.x, p.y + 5.9 * (r.a.lead ? 1.12 : 1), p.z).clone());
    r.pill.style.display = 'block';
    r.pill.style.transform = `translate(${sx}px,${sy}px) translate(-50%,-100%) scale(${r.pill.classList.contains('is-supervising') ? Math.max(.95,pillScale) : pillScale})`;
    const dimmed = focused && focused !== 'brain' && r.a.dept !== focused;
    r.pill.style.opacity = dimmed ? 1 - 0.85 * focusDim : 1;
  }
}

/* ---------- clock (REAL local time — locked rule) ---------- */
function tickClock() {
  const d = new Date();
  document.getElementById('clock').textContent =
    d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(tickClock, 1000); tickClock();

/* ---------- helpers ---------- */
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function sample(arr, n) {
  const out = [...arr].sort(() => Math.random() - 0.5).slice(0, n);
  return out;
}

/* ---------- V3 task boards ---------- */
function feedPush(r, i, text) {
  r.feed.unshift({ i, text, ts: Date.now() });
  if (r.feed.length > 30) r.feed.pop();
  if (focused === r.a.dept) {
    const line = document.querySelector(`[data-line="${r.a.id}"]`);
    if (line) line.textContent = i + ' ' + text;
  }
  if (modalOpen === r.a.id && modalTab === 'activity') renderActivity(r.a.id);
}
// V3.1 LIVE: the served roster (office.agents.json) renames the seats and rewrites what each
// agent says about itself; the demo's fake greetings and stat chips are wrong in a real office
function applyRoster(agents) {
  if (!Array.isArray(agents)) return;
  for (const a of agents) {
    const r = R[a.id]; if (!r) continue;
    r.a.name = a.name;
    r.pill.querySelector('.pill-name').innerHTML = (r.a.lead ? '<span class="star">★</span>' : '') + esc(a.name);
    r.persona.role = a.role || r.persona.role; r.persona.tagline = a.does || r.persona.tagline;
    r.persona.chips = a.lead ? ['What is the team working on?', 'What needs my attention?'] : ['What are you working on?', 'What can you do for me?'];
    if (modalOpen === a.id) openAgentRail(a.id, modalTab, false);
  }
}
// Hand-overs animate: people walk to whoever they need, say a line, and go back.
const walkGates = Object.fromEntries(DEPT_KEYS.map(k => [k, { edge: deptRT[k].gate.clone(), centre: deptRT[k].brainGate.clone() }]));
walkGates.pm = { edge: new THREE.Vector3(0, 0.12, 6.5), centre: new THREE.Vector3(0, 0.12, 6.5) };
const meetings = initMeetings({ R, hud, toScreen: p => toScreen(p), points: { gates: walkGates, ceo: CEO_AT.clone().add(new THREE.Vector3(-2.4, 0, 2.4)) }, reducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches });
const lookupJob = Object.assign(id => tasks?.job?.(id), { leadOf: agentId => { const a = AGENTS.find(x => x.id === agentId); return a ? AGENTS.find(x => x.dept === a.dept && x.lead)?.id : null; } });
tasks = initOfficeWork({
  hud, R, deptRT, RAIL_SIDE, spawnEmote, chatPush, chatHist, feedPush, zoomToApproval, enterFocus, openAgent, esc,
  brainWrite: (id, title) => brain.write(id, title), brain,
  onLive: (h) => { document.querySelector('#topbar .brand .ver').textContent = ''; document.title = h.name; brainNotes = h.notes; document.querySelector('#brainBtn b').textContent = h.notes; brain.setOwner(h.name); brain.setQuiet(true); applyRoster(h.agents); },
  onTaskEvent: event => meetings.onTaskEvent(event, lookupJob),
  onTaskState: change => { if (['awaiting_ceo', 'escalated'].includes(change.from) && !['awaiting_ceo', 'escalated'].includes(change.to)) meetings.release(change.id); },
  onBrainNotes: n => { brainNotes = n; document.querySelector('#brainBtn b').textContent = n; },
  getFocused: () => focused, getZoom: () => view.zoom, getFocusDim: () => focusDim,
  toScreen: (p) => toScreen(p), reframe,
});
view.target.set(...overviewPos());
addEventListener('resize', () => { if (!focused && !tween) view.target.set(...overviewPos()); });

/* ---------- boot ---------- */
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  applyCamera();
}
addEventListener('resize', resize);
resize();

// deterministic view hooks for headless screenshots: #view=sales | #zoom=2.2
{
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('zoom')) view.zoom = parseFloat(h.get('zoom')) || 1;
  if (h.get('view') && LAYOUT[h.get('view')]) enterFocus(h.get('view'));
  if (h.get('cam')) setCam(h.get('cam') === '1');
  if (h.get('dark') === '1' || document.body.classList.contains('dark')) setDark(true);
  // typing #dark=1 into an OPEN tab is a same-document hash change (no reload) — react to it live
  addEventListener('hashchange', () => { const d = new URLSearchParams(location.hash.slice(1)).get('dark'); if (d === '1') setDark(true); else if (d === '0') setDark(false); });
  if (h.get('board')) { // #board=1 → company board · #board=marketing → that dept's board
    const b = h.get('board');
    tasks.open();
  }
  syncOverviewBtn();
}
window.CC = { flyTo, zoomToDept, zoomOut, zoomToApproval, openAgent, view, applyCamera, R, emotes, setCam, setDark, brain, meetings, toggleBoard: () => tasks.toggle(), tasks };

let last = performance.now();
function loop(now) {
  if (now - last < 1000 / 30) { requestAnimationFrame(loop); return; }
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (document.body.dataset.view === 'settings') { requestAnimationFrame(loop); return; } // the scene rests while settings are open
  tickTween(now);
  applyCamera();
  tickDim(dt);
  tickSim(now, dt);
  tickLOD();
  tasks.tick(now);
  mcp.tick(now, dt, view, camera, focused, focusDim);
  syncOverviewBtn();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
