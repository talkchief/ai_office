// Desks, chairs, plinths, walkways, plants: plain three.js builders the components wrap.
// Geometry and materials come from the shared caches; the screen texture is per desk.
import * as THREE from 'three';
import { mat, ownMat, rboxGeo, geo, canvasTexture, PLINTH_H, WHITE } from './materials.js';

export function rbox(w, d, h, color, r, own = false) {
  const m = new THREE.Mesh(rboxGeo(w, d, h, r), typeof color === 'string' ? (own ? ownMat(color) : mat(color)) : color);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/* ---------- plinth: floating white pod with a pastel floor slab ---------- */
export function makePlinth(w, d, floorColor, chip, key) {
  const g = new THREE.Group();
  const body = rbox(w, d, PLINTH_H, WHITE, 0.9, true);
  body.position.y = -PLINTH_H;
  body.userData = { dept: key, part: 'plinth' };
  g.add(body);
  const floor = rbox(w - 0.7, d - 0.7, 0.12, floorColor, 0.7, true);
  floor.castShadow = false;
  floor.userData = { dept: key, part: 'floor', chip };
  g.add(floor);
  // hairline reveal in the department colour along the slab edge
  const edge = new THREE.Mesh(rboxGeo(w - 0.5, d - 0.5, 0.03, 0.75), mat(chip, { rough: 0.6, transparent: true, opacity: 0.55 }));
  edge.position.y = 0.1; edge.castShadow = edge.receiveShadow = false; edge.userData = { dept: key, part: 'edge' };
  g.add(edge);
  return g;
}

/* ---------- the desk screen: a live canvas texture ---------- */
export function makeDeskScreenTexture(chip) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const x = c.getContext('2d');
  let scroll = 0;
  const colors = { idle: '#FDFFF8', working: '#BBE8FF', planning: '#FFE6A0', verifying: '#D9C4FF', submitted: '#DAECDC', done: '#63DBA2', blocked: '#FFE3B3' };
  const draw = (lines, status = 'working', now = 0) => {
    x.fillStyle = colors[status] || '#FDFFF8'; x.fillRect(0, 0, 256, 160);
    x.fillStyle = status === 'idle' ? '#E5E8E1' : colors[status] || chip; x.fillRect(0, 0, 256, 26);
    x.fillStyle = '#151414'; x.font = 'bold 15px Menlo, monospace';
    x.fillText((status === 'idle' ? '○ ' : status === 'done' || status === 'submitted' ? '✓ ' : status === 'blocked' ? '⚠ ' : '● ') + status, 10, 18);
    if (['working', 'planning', 'verifying'].includes(status)) { x.strokeStyle = '#285568'; x.lineWidth = 6; x.beginPath(); x.arc(128, 125, 17, now / 240, now / 240 + 4.7); x.stroke(); }
    if (status === 'done') { x.fillStyle = '#12633E'; x.font = 'bold 55px sans-serif'; x.fillText('✓', 108, 142); }
    x.font = '13px Menlo, monospace';
    lines.forEach((l, i) => { x.fillStyle = i === lines.length - 1 ? '#1E9070' : 'rgba(21,20,20,.78)'; x.fillText(l, 10, 48 + i * 22); });
    if (status === 'idle') { // dim idle glyph, 20 % cursor blink (design)
      x.fillStyle = Math.floor(now / 800) % 2 ? 'rgba(21,20,20,.2)' : 'rgba(21,20,20,.05)'; x.fillRect(12, 44, 8, 16);
    }
    if (status === 'working') { // the live draft scrolls: green code-lines under the title
      scroll = (scroll + 1) % 14;
      x.save(); x.beginPath(); x.rect(0, 92, 256, 60); x.clip();
      for (let i = 0; i < 6; i++) { x.fillStyle = 'rgba(30,144,112,.55)'; x.fillRect(12, 96 + i * 14 - scroll, 40 + ((i * 53) % 120), 4); }
      x.restore();
    }
  };
  draw(['▸ …', '▸ …', '▸ …']);
  const tex = canvasTexture(c, 4);
  return { tex, canvas: c, ctx: x, draw };
}

let poolTex = null;
export function makeLightPool(size = 7, color = '#FFD27A') {
  if (!poolTex) {
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
    const g = x.createRadialGradient(128, 128, 6, 128, 128, 126); g.addColorStop(0, 'rgba(255,224,160,1)'); g.addColorStop(0.35, 'rgba(255,210,120,.55)'); g.addColorStop(1, 'rgba(255,200,100,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256); poolTex = canvasTexture(c, 2);
  }
  const m = new THREE.Mesh(geo('PlaneGeometry', size, size), new THREE.MeshBasicMaterial({ map: poolTex, color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 1;
  return m;
}
export function makeDesk(chip, { lead = false } = {}) {
  const g = new THREE.Group();
  const width = lead ? 7.2 : 5.2;
  const top = rbox(width, lead ? 3.0 : 2.6, 0.22, lead ? '#B99A70' : '#DCC29A', lead ? 0.65 : 0.18); top.position.y = 2.1; g.add(top);
  const ped1 = rbox(lead ? 1.3 : 0.9, 2.2, 1.9, WHITE, 0.12); ped1.position.set(lead ? -2.7 : -2, 0.1, 0); g.add(ped1);
  const ped2 = rbox(lead ? 1.3 : 0.9, 2.2, 1.9, WHITE, 0.12); ped2.position.set(lead ? 2.7 : 2, 0.1, 0); g.add(ped2);
  if (lead) {
    const side = rbox(1.6, 2.6, 0.22, '#B99A70', 0.45); side.position.set(2.8, 2.1, 1.2); g.add(side);
    const trim = rbox(7.0, 0.045, 0.055, mat('#B69857', { metal: 0.5, rough: 0.4 }), 0.02); trim.position.set(0, 2.27, -1.47); g.add(trim);
    const blotter = rbox(2.0, 1.25, 0.025, '#475A50', 0.12); blotter.position.set(-2.2, 2.33, 0); g.add(blotter);
    const plaque = rbox(1.75, 0.22, 0.42, '#B69857', 0.06); plaque.position.set(1.85, 2.33, -0.88); g.add(plaque);
    const label = document.createElement('canvas'); label.width = 256; label.height = 64; const pen = label.getContext('2d');
    pen.fillStyle = '#B69857'; pen.fillRect(0, 0, 256, 64); pen.fillStyle = '#30291E'; pen.font = '600 29px sans-serif'; pen.textAlign = 'center'; pen.fillText('TEAM LEAD', 128, 43);
    const face = new THREE.Mesh(geo('PlaneGeometry', 1.65, 0.38), new THREE.MeshBasicMaterial({ map: canvasTexture(label, 2) }));
    face.position.set(1.85, 2.55, -0.755); g.add(face);
  }
  // monitor: dark bezel, live screen, a soft glow plane behind that the phase turns up at night
  const screenSet = makeDeskScreenTexture(chip);
  const monBack = rbox(2.3, 0.14, 1.5, '#26262A', 0.08); monBack.position.set(0, 2.75, -0.85); g.add(monBack);
  const screenMat = new THREE.MeshBasicMaterial({ map: screenSet.tex });
  const screen = new THREE.Mesh(geo('PlaneGeometry', 2.1, 1.3), screenMat);
  screen.position.set(0, 3.5, -0.77); g.add(screen);
  const glow = new THREE.Mesh(geo('PlaneGeometry', 3.6, 2.4), new THREE.MeshBasicMaterial({ color: chip, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.position.set(0, 3.4, -0.6); g.add(glow);
  const stand = rbox(0.16, 0.16, 0.45, '#3A3A3E', 0.05); stand.position.set(0, 2.32, -0.9); g.add(stand);
  const kb = rbox(1.5, 0.5, 0.07, '#EFEFEA', 0.06); kb.position.set(0, 2.22, 0.35); g.add(kb);
  const mug = new THREE.Mesh(geo('CylinderGeometry', 0.16, 0.14, 0.3, 12), mat(chip));
  mug.position.set(1.9, 2.36, 0.4); mug.castShadow = true; g.add(mug);
  // a small desk lamp: the pool of light per working desk at night (design 1l)
  const lampBase = new THREE.Mesh(geo('CylinderGeometry', 0.22, 0.26, 0.06, 12), mat('#2E2E33')); lampBase.position.set(-1.9, 2.24, -0.6); g.add(lampBase);
  const lampArm = new THREE.Mesh(geo('CylinderGeometry', 0.03, 0.03, 1.0, 6), mat('#2E2E33')); lampArm.position.set(-1.9, 2.75, -0.6); lampArm.rotation.z = 0.25; g.add(lampArm);
  const lampShade = new THREE.Mesh(geo('ConeGeometry', 0.28, 0.32, 12, 1, true), mat('#2E2E33', { rough: 0.5 })); lampShade.position.set(-1.75, 3.2, -0.6); lampShade.rotation.z = -0.5; g.add(lampShade);
  const lampBulb = new THREE.Mesh(geo('SphereGeometry', 0.1, 8, 6), new THREE.MeshBasicMaterial({ color: '#FFF1C8', transparent: true, opacity: 0 })); lampBulb.position.set(-1.7, 3.1, -0.6); g.add(lampBulb);
  const lampHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: (makeLightPool(1).material.map), color: '#FFD27A', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); lampHalo.position.set(-1.7, 3.1, -0.6); lampHalo.scale.set(2.6, 2.6, 1); g.add(lampHalo);
  const pool = makeLightPool(9); pool.position.set(-0.6, 0.16, -0.2); g.add(pool);
  const activity = new THREE.Mesh(geo('PlaneGeometry', 2.5, 0.55), new THREE.MeshBasicMaterial({ color: chip, transparent: true, opacity: 0, depthWrite: false }));
  activity.rotation.x = -Math.PI / 2; activity.position.set(0, 2.335, -0.42); g.add(activity);
  g.userData.leadDesk = lead;
  return { group: g, screenSet, activity, glow, lampBulb, lampHalo, pool, lampAt: new THREE.Vector3(-1.7, 3.0, -0.6) };
}

export function makeChair() {
  const g = new THREE.Group();
  const seat = rbox(1.3, 1.2, 0.22, '#8E998B', 0.35); seat.position.y = 1.25; g.add(seat);
  const back = rbox(1.25, 0.2, 1.35, '#7C8779', 0.3); back.position.set(0, 1.5, 0.62); g.add(back);
  const pole = new THREE.Mesh(geo('CylinderGeometry', 0.07, 0.07, 0.85, 8), mat('#55555A')); pole.position.y = 0.82; g.add(pole);
  const base = new THREE.Mesh(geo('CylinderGeometry', 0.55, 0.6, 0.1, 10), mat('#55555A')); base.position.y = 0.4; base.castShadow = true; g.add(base);
  return g;
}

export function makePlant() {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(geo('CylinderGeometry', 0.55, 0.42, 0.8, 10), mat('#B96A4B')); pot.position.y = 0.4; pot.castShadow = true; g.add(pot);
  const foliage = mat('#5F8A5C', { rough: 1 }), foliage2 = mat('#6F9B68', { rough: 1 });
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(geo('SphereGeometry', +(0.42 + Math.sin(i * 7) * 0.12).toFixed(3), 10, 8), i % 2 ? foliage : foliage2);
    s.position.set(Math.sin(i * 2.4) * 0.35, 1.15 + i * 0.28, Math.cos(i * 2.4) * 0.35);
    s.castShadow = true; g.add(s);
  }
  return g;
}

export function makeWalkway(from, to, key) {
  const dx = to[0] - from[0], dz = to[1] - from[1];
  const len = Math.hypot(dx, dz);
  const g = rbox(len, 3.2, 0.35, '#EFEFE8', 0.16, true);
  g.position.set((from[0] + to[0]) / 2, -0.35, (from[1] + to[1]) / 2);
  g.rotation.y = -Math.atan2(dz, dx);
  g.userData = { dept: key, part: 'walkway' };
  return g;
}

export function makeWarnSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.beginPath(); x.moveTo(64, 12); x.lineTo(120, 112); x.lineTo(8, 112); x.closePath();
  x.fillStyle = '#F2B84B'; x.fill();
  x.lineWidth = 7; x.strokeStyle = '#151414'; x.lineJoin = 'round'; x.stroke();
  x.fillStyle = '#151414'; x.font = '900 64px Inter, sans-serif'; x.textAlign = 'center'; x.fillText('!', 64, 98);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTexture(c, 2), depthTest: false }));
  s.scale.set(2.6, 2.6, 1);
  return s;
}

// the ink selection ring on the floor under a selected agent (design 1i · "Selected")
export function makeSelectRing() {
  const ring = new THREE.Mesh(geo('RingGeometry', 1.25, 1.42, 40), new THREE.MeshBasicMaterial({ color: '#151414', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.renderOrder = 3;
  const halo = new THREE.Mesh(geo('RingGeometry', 1.42, 1.75, 40), new THREE.MeshBasicMaterial({ color: '#FDFFF8', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  halo.rotation.x = -Math.PI / 2; halo.renderOrder = 2;
  const g = new THREE.Group(); g.add(halo, ring); g.userData = { ring, halo };
  return g;
}

// the Program Manager's dotted trail: a pool of small discs that fade over 3 s
export function makeTrail(n = 10) {
  const g = new THREE.Group();
  const dots = [];
  for (let i = 0; i < n; i++) {
    const d = new THREE.Mesh(geo('CircleGeometry', 0.22, 12), new THREE.MeshBasicMaterial({ color: '#B9A775', transparent: true, opacity: 0, depthWrite: false }));
    d.rotation.x = -Math.PI / 2; d.renderOrder = 3; d.visible = false; g.add(d); dots.push({ m: d, born: -1e9 });
  }
  g.userData = { dots, next: 0 };
  return g;
}

/* ---------- the office as a building floor (10 Sep 2026: "a 3D office space, not pods") ----------
   One floor plate carries everything. Each department is a ROOM on it: a carpet in the team
   colour, low partition walls with a door gap toward the corridor, glass on the outer walls.
   Corridors run from every door to the centre, where the Program Manager sits in a glass office. */
export const WALL_H = 1.7, WALL_T = 0.28, GLASS_H = 1.9;
export const WALL_COL = '#ECEAE2', GLASS_COL = '#CFE3E8';
export function glassMat() { return mat(GLASS_COL, { rough: 0.15, metal: 0.05, transparent: true, opacity: 0.28 }); }

export function makeFloorPlate(w, d) {
  const g = new THREE.Group();
  const plate = rbox(w, d, PLINTH_H, WHITE, 2.4, true);
  plate.position.y = -PLINTH_H;
  plate.userData = { part: 'plinth', building: true };
  g.add(plate);
  const floor = rbox(w - 1.2, d - 1.2, 0.08, '#F1EFE7', 2.0, true);
  floor.castShadow = false; floor.userData = { part: 'ground', building: true };
  g.add(floor);
  return g;
}

// wall segment along X (len) at (x, z) — rotated for Z edges
function wallSeg(len, x, z, rotY, key, h = WALL_H, own = false) {
  const m = rbox(len, WALL_T, h, WALL_COL, 0.05, own);
  m.position.set(x, 0.08, z); m.rotation.y = rotY; m.userData = { dept: key, part: 'wall' };
  return m;
}
function glassSeg(len, x, z, rotY, key) {
  const m = new THREE.Mesh(rboxGeo(len, 0.08, GLASS_H, 0.02), glassMat());
  m.position.set(x, 0.08 + WALL_H, z); m.rotation.y = rotY; m.userData = { dept: key, part: 'glass' };
  m.castShadow = false; m.receiveShadow = false; m.renderOrder = 2;
  return m;
}
// a low wall with a door gap in it; `door` = [offset from the segment centre, width]
function wallWithDoor(len, x, z, rotY, key, door) {
  const g = new THREE.Group();
  if (!door) { g.add(wallSeg(len, x, z, rotY, key)); return g; }
  const [off, dw] = door;
  const a = len / 2 + off - dw / 2, b = len / 2 - off - dw / 2; // lengths either side of the door
  const dir = new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY));
  if (a > 0.3) { const p = new THREE.Vector3(x, 0, z).addScaledVector(dir, -len / 2 + a / 2); g.add(wallSeg(a, p.x, p.z, rotY, key)); }
  if (b > 0.3) { const p = new THREE.Vector3(x, 0, z).addScaledVector(dir, len / 2 - b / 2); g.add(wallSeg(b, p.x, p.z, rotY, key)); }
  // door posts
  for (const s of [-1, 1]) { const p = new THREE.Vector3(x, 0, z).addScaledVector(dir, off + s * dw / 2); const post = new THREE.Mesh(geo('CylinderGeometry', 0.14, 0.14, WALL_H + 0.5, 8), mat('#B9B5A8')); post.position.set(p.x, (WALL_H + 0.5) / 2 + 0.08, p.z); post.castShadow = true; post.userData = { dept: key, part: 'post' }; g.add(post); }
  return g;
}

// a department room centred at (0,0) of its group: carpet + walls + glass on the outer edges.
// `toCentre` = [sx, sz] unit signs pointing at the office centre; the door opens on that side.
export function makeRoom(w, d, floorColor, chip, key, door) {
  const g = new THREE.Group();
  const carpet = rbox(w - 0.4, d - 0.4, 0.12, floorColor, 0.5, true);
  carpet.castShadow = false; carpet.userData = { dept: key, part: 'floor', chip };
  g.add(carpet);
  const edge = new THREE.Mesh(rboxGeo(w - 0.2, d - 0.2, 0.03, 0.55), mat(chip, { rough: 0.6, transparent: true, opacity: 0.5 }));
  edge.position.y = 0.11; edge.castShadow = edge.receiveShadow = false; edge.userData = { dept: key, part: 'edge' };
  g.add(edge);
  // four edges: +z / -z run along X, +x / -x run along Z. One carries the door (the edge facing the
  // centre); the two edges facing away from the centre carry glass above the low wall.
  for (const e of [{ axis: 'z', sign: 1 }, { axis: 'z', sign: -1 }, { axis: 'x', sign: 1 }, { axis: 'x', sign: -1 }]) {
    const hasDoor = door && door.edge === e.axis && door.sign === e.sign;
    const outer = door ? (e.axis === door.edge ? e.sign === -door.sign : true) : false;
    if (e.axis === 'z') {
      const len = w, x = 0, z = e.sign * (d / 2 - WALL_T / 2);
      g.add(wallWithDoor(len, x, z, 0, key, hasDoor ? [0, door.width] : null));
      if (outer && !hasDoor) g.add(glassSeg(len, x, z, 0, key));
    } else {
      const len = d, z = 0, x = e.sign * (w / 2 - WALL_T / 2);
      g.add(wallWithDoor(len, x, z, Math.PI / 2, key, hasDoor ? [0, door.width] : null));
      if (outer && !hasDoor) g.add(glassSeg(len, x, z, Math.PI / 2, key));
    }
  }
  for (const cx of [-1, 1]) for (const cz of [-1, 1]) {
    const p = new THREE.Mesh(geo('CylinderGeometry', 0.32, 0.32, WALL_H + GLASS_H + 0.3, 10), mat('#D9D6CB'));
    p.position.set(cx * (w / 2 - 0.4), (WALL_H + GLASS_H + 0.3) / 2 + 0.08, cz * (d / 2 - 0.4)); p.castShadow = true; p.userData = { dept: key, part: 'post' }; g.add(p);
  }
  return g;
}

// corridor: a flat strip on the plate between two points
export function makeCorridor(from, to, key, width = 4.2) {
  const dx = to[0] - from[0], dz = to[1] - from[1];
  const len = Math.hypot(dx, dz);
  const g = rbox(len, width, 0.06, '#E4E1D6', 0.2, true);
  g.position.set((from[0] + to[0]) / 2, 0.09, (from[1] + to[1]) / 2);
  g.rotation.y = -Math.atan2(dz, dx);
  g.castShadow = false; g.userData = { dept: key, part: 'walkway' };
  return g;
}

// the glass office at the centre: round rug, ring of glass with two openings, a meeting table
export function makeCentreOffice(size) {
  const g = new THREE.Group();
  const rug = new THREE.Mesh(geo('CylinderGeometry', size / 2 - 0.6, size / 2 - 0.6, 0.12, 48), ownMat('#E9EFE4'));
  rug.position.y = 0.06; rug.receiveShadow = true; rug.userData = { dept: 'brain', part: 'floor', chip: '#D1DECD' }; g.add(rug);
  const ring = new THREE.Mesh(geo('TorusGeometry', size / 2 - 0.3, 0.1, 6, 64), mat('#B9A775', { rough: 0.5, transparent: true, opacity: 0.6 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.14; ring.userData = { dept: 'brain', part: 'edge' }; g.add(ring);
  // glass ring in 8 panels with an opening on every approach (the axes and the diagonals)
  for (let i = 0; i < 8; i++) {
    const a0 = i * Math.PI / 4 + 0.26, a1 = (i + 1) * Math.PI / 4 - 0.26;
    const shape = new THREE.Shape();
    const r0 = size / 2 - 0.35, r1 = r0 + 0.1;
    shape.absarc(0, 0, r1, a0, a1, false); shape.absarc(0, 0, r0, a1, a0, true);
    const geoP = new THREE.ExtrudeGeometry(shape, { depth: GLASS_H + 0.6, bevelEnabled: false, curveSegments: 12 }); geoP.rotateX(-Math.PI / 2);
    const pane = new THREE.Mesh(geoP, glassMat()); pane.position.y = 0.1; pane.userData = { dept: 'brain', part: 'glass' }; pane.castShadow = false; pane.renderOrder = 2; g.add(pane);
    for (const a of [a0, a1]) { const post = new THREE.Mesh(geo('CylinderGeometry', 0.12, 0.12, GLASS_H + 0.7, 8), mat('#B9B5A8')); post.position.set(Math.cos(a) * (r0 + 0.05), (GLASS_H + 0.7) / 2 + 0.1, Math.sin(a) * (r0 + 0.05)); post.userData = { dept: 'brain', part: 'post' }; g.add(post); }
  }
  // small round meeting table with three chairs, off to one side of the PM desk
  const table = new THREE.Group(); table.position.set(-4.6, 0.12, 3.4);
  const top = new THREE.Mesh(geo('CylinderGeometry', 1.7, 1.7, 0.16, 28), mat('#EFEADF')); top.position.y = 1.9; top.castShadow = top.receiveShadow = true; table.add(top);
  const leg = new THREE.Mesh(geo('CylinderGeometry', 0.18, 0.26, 1.85, 12), mat('#C9C4B8')); leg.position.y = 0.95; table.add(leg);
  for (let i = 0; i < 3; i++) { const c = makeChair(); const a = i * Math.PI * 2 / 3 + 0.6; c.position.set(Math.cos(a) * 2.5, 0, Math.sin(a) * 2.5); c.rotation.y = -a + Math.PI / 2; c.scale.setScalar(0.85); table.add(c); }
  table.traverse(o => { if (o.isMesh) o.userData.dept = 'brain'; });
  g.add(table);
  return g;
}

/* ---------- the four corners: lobby, kitchen, meeting room, quiet garden ---------- */
export function makeLobby() { // reception desk, two lounge chairs, a low table, a plant
  const g = new THREE.Group();
  const rug = rbox(14, 12, 0.1, '#EEE7D5', 1.2, true); rug.castShadow = false; rug.userData = { part: 'floor', chip: '#D9C9A8', dept: 'lobby' }; g.add(rug);
  const desk = rbox(6.4, 1.6, 2.2, '#B99A70', 0.5); desk.position.set(0, 0.1, -3.4); g.add(desk);
  const deskTop = rbox(6.8, 2.0, 0.18, '#DCC29A', 0.5); deskTop.position.set(0, 2.3, -3.4); g.add(deskTop);
  const sign = rbox(3.2, 0.12, 0.7, '#151414', 0.06); sign.position.set(0, 2.5, -3.5); g.add(sign);
  for (const x of [-3.2, 3.2]) { const seat = rbox(2.2, 2.2, 0.9, '#8E998B', 0.6); seat.position.set(x, 0.1, 2.8); g.add(seat); const back = rbox(2.2, 0.5, 1.6, '#7C8779', 0.5); back.position.set(x, 0.1, 3.8); g.add(back); }
  const low = new THREE.Mesh(geo('CylinderGeometry', 1.1, 1.1, 0.14, 24), mat('#EFEADF')); low.position.set(0, 1.0, 2.8); low.castShadow = true; g.add(low);
  const lowLeg = new THREE.Mesh(geo('CylinderGeometry', 0.12, 0.16, 0.9, 10), mat('#C9C4B8')); lowLeg.position.set(0, 0.55, 2.8); g.add(lowLeg);
  const plant = makePlant(); plant.position.set(5.6, 0.12, -1.5); g.add(plant);
  const plant2 = makePlant(); plant2.position.set(-5.6, 0.12, 4.2); plant2.scale.setScalar(0.8); g.add(plant2);
  g.traverse(o => { if (o.isMesh && !o.userData.part) o.userData.dept = 'lobby'; });
  return g;
}
export function makeKitchen() { // a counter, stools, a tall fridge, a coffee machine
  const g = new THREE.Group();
  const rug = rbox(14, 12, 0.1, '#EDE9E0', 1.2, true); rug.castShadow = false; rug.userData = { part: 'floor', chip: '#D8D3C4', dept: 'kitchen' }; g.add(rug);
  const counter = rbox(7.6, 1.8, 2.1, '#F2F1EC', 0.3); counter.position.set(0, 0.1, -2.6); g.add(counter);
  const top = rbox(7.9, 2.1, 0.16, '#4A4A48', 0.3); top.position.set(0, 2.2, -2.6); g.add(top);
  const machine = rbox(1.1, 0.9, 1.0, '#26262A', 0.12); machine.position.set(2.4, 2.36, -2.7); g.add(machine);
  const fridge = rbox(1.8, 1.6, 4.4, '#DADAD4', 0.2); fridge.position.set(-5.4, 0.1, -3.4); g.add(fridge);
  for (const x of [-2.2, 0, 2.2]) { const s = new THREE.Mesh(geo('CylinderGeometry', 0.5, 0.5, 0.18, 14), mat('#8E998B')); s.position.set(x, 1.55, 0.2); s.castShadow = true; g.add(s); const p = new THREE.Mesh(geo('CylinderGeometry', 0.08, 0.08, 1.45, 8), mat('#55555A')); p.position.set(x, 0.82, 0.2); g.add(p); }
  const tbl = new THREE.Mesh(geo('CylinderGeometry', 1.5, 1.5, 0.14, 24), mat('#EFEADF')); tbl.position.set(1.5, 1.9, 3.2); tbl.castShadow = true; g.add(tbl);
  const tl = new THREE.Mesh(geo('CylinderGeometry', 0.16, 0.24, 1.85, 10), mat('#C9C4B8')); tl.position.set(1.5, 0.95, 3.2); g.add(tl);
  for (let i = 0; i < 3; i++) { const c = makeChair(); const a = i * 2.1 + 0.4; c.position.set(1.5 + Math.cos(a) * 2.3, 0.1, 3.2 + Math.sin(a) * 2.3); c.rotation.y = -a + Math.PI / 2; c.scale.setScalar(0.85); g.add(c); }
  const plant = makePlant(); plant.position.set(-5.4, 0.12, 3.6); g.add(plant);
  g.traverse(o => { if (o.isMesh && !o.userData.part) o.userData.dept = 'kitchen'; });
  return g;
}
export function makeMeetingRoom() { // glass box, long table, six chairs, a wall screen
  const g = new THREE.Group();
  const rug = rbox(14, 12, 0.1, '#E9EFE4', 1.2, true); rug.castShadow = false; rug.userData = { part: 'floor', chip: '#D1DECD', dept: 'meeting' }; g.add(rug);
  // three glass walls and, on the +z side (toward the centre), two glass panes either side of the door
  const walls = [[14, 0, -5.9, 0], [12, -6.9, 0, Math.PI / 2], [12, 6.9, 0, Math.PI / 2], [4.5, -4.75, 5.9, 0], [4.5, 4.75, 5.9, 0]];
  walls.forEach(([len, x, z, r]) => { g.add(wallSeg(len, x, z, r, 'meeting', 0.5)); const gl = new THREE.Mesh(rboxGeo(len, 0.08, GLASS_H + 1.2, 0.02), glassMat()); gl.position.set(x, 0.58, z); gl.rotation.y = r; gl.castShadow = false; gl.renderOrder = 2; gl.userData = { dept: 'meeting', part: 'glass' }; g.add(gl); });
  for (const px of [-2.5, 2.5]) { const post = new THREE.Mesh(geo('CylinderGeometry', 0.14, 0.14, GLASS_H + 1.9, 8), mat('#B9B5A8')); post.position.set(px, (GLASS_H + 1.9) / 2 + 0.08, 5.9); post.userData = { dept: 'meeting', part: 'post' }; g.add(post); }
  const table = rbox(7.5, 2.6, 0.2, '#EFEADF', 0.9); table.position.set(0, 2.0, 0); g.add(table);
  for (const x of [-2.6, 2.6]) { const leg = rbox(0.5, 1.8, 1.9, '#C9C4B8', 0.1); leg.position.set(x, 0.1, 0); g.add(leg); }
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) { const c = makeChair(); c.position.set(-2.4 + i * 2.4, 0.1, s * 2.4); c.rotation.y = s > 0 ? 0 : Math.PI; c.scale.setScalar(0.85); g.add(c); } // a chair faces −z; the far row turns to face the table
  const screen = rbox(3.4, 0.16, 2.0, '#26262A', 0.08); screen.position.set(0, 2.6, -5.5); g.add(screen);
  const glow = new THREE.Mesh(geo('PlaneGeometry', 3.1, 1.7), new THREE.MeshBasicMaterial({ color: '#DAECDC' })); glow.position.set(0, 3.6, -5.4); g.add(glow);
  g.traverse(o => { if (o.isMesh && !o.userData.part) o.userData.dept = 'meeting'; });
  return g;
}
export function makeGarden() { // a quiet corner: bench, planters, a tree
  const g = new THREE.Group();
  const rug = rbox(14, 12, 0.1, '#E6EDDF', 1.2, true); rug.castShadow = false; rug.userData = { part: 'floor', chip: '#CBD8C2', dept: 'garden' }; g.add(rug);
  for (const [x, z, s] of [[-4.5, -3, 1.3], [3.5, -3.5, 1.1], [-3, 3.5, 0.9], [4.5, 3, 1.2], [0, 0, 1.6]]) { const p = makePlant(); p.position.set(x, 0.12, z); p.scale.setScalar(s); g.add(p); }
  for (const z of [-1.6, 1.6]) { const b = rbox(4.8, 1.1, 0.7, '#B99A70', 0.2); b.position.set(-0.2 + (z > 0 ? 3 : -3), 0.9, z * 2.6); g.add(b); for (const x of [-1.9, 1.9]) { const l = rbox(0.3, 1.0, 0.85, '#8A7A5C', 0.05); l.position.set(-0.2 + (z > 0 ? 3 : -3) + x, 0.1, z * 2.6); g.add(l); } }
  g.traverse(o => { if (o.isMesh && !o.userData.part) o.userData.dept = 'garden'; });
  return g;
}

/* ---------- a wall screen: dark frame on a slim post, the live canvas in front ---------- */
export function makeWallScreen(screen, w, h) {
  const g = new THREE.Group();
  const frame = rbox(w + 0.3, 0.16, h + 0.3, '#1E1F24', 0.08); frame.position.set(0, 0, 0); g.add(frame);
  screen.mesh.position.set(0, (h + 0.3) / 2, 0.1); g.add(screen.mesh);
  const glow = new THREE.Mesh(geo('PlaneGeometry', w * 1.5, h * 1.6), new THREE.MeshBasicMaterial({ color: '#8FD3F4', transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending })); glow.position.set(0, (h + 0.3) / 2, 0.12); g.add(glow);
  const post = new THREE.Mesh(geo('CylinderGeometry', 0.08, 0.08, 1.4, 8), mat('#3A3A3E')); post.position.set(0, -0.7, 0); g.add(post);
  g.userData.glow = glow;
  return g;
}
// the mug an agent carries to the kitchen
export function makeMug(chip) {
  const g = new THREE.Group();
  const cup = new THREE.Mesh(geo('CylinderGeometry', 0.13, 0.11, 0.24, 10), mat(chip)); g.add(cup);
  const handle = new THREE.Mesh(geo('TorusGeometry', 0.08, 0.025, 6, 10), mat(chip)); handle.position.x = 0.14; g.add(handle);
  g.visible = false;
  return g;
}
