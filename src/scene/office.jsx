// The office as a React Three Fiber tree. Static set pieces are built once (useMemo) from the
// plain three.js builders and mounted as primitives; the sim mutates them through rig.R.
import React, { useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { rig, applyCamera } from './rig.js';
import { store } from './store.js';
import { PHASES, sunDir } from './daylight.js';
import { mat, geo, ownMat } from './materials.js';
import { makePlinth, makeDesk, makeChair, makePlant, makeWalkway, makeWarnSprite, makeSelectRing, makeTrail, makeFloorPlate, makeRoom, makeCorridor, makeCentreOffice, makeLobby, makeKitchen, makeMeetingRoom, makeGarden, makeWallScreen, makeMug, WALL_H } from './furniture.js';
import { makeScreen } from './screens.js';
import { makeLightPool } from './furniture.js';
import { doorOf } from './nav.js';
import { buildPerson } from './person.js';

/* ---------- lights: hemi + one warm key, both re-tuned per daylight phase ---------- */
export function Lights() {
  const hemi = useRef(), key = useRef();
  const cur = useRef({ hc: new THREE.Color(), gc: new THREE.Color(), hi: 0.85, kc: new THREE.Color(), ki: 2.2, dir: new THREE.Vector3(-60, 90, 20), init: false });
  useFrame((_, dt) => {
    const P = PHASES[store.getState().phase] || PHASES.day;
    const c = cur.current, k = c.init ? 1 - Math.exp(-dt * 1.2) : 1; c.init = true;
    c.hc.lerp(new THREE.Color(P.hemi[0]), k); c.gc.lerp(new THREE.Color(P.hemi[1]), k); c.hi += (P.hemi[2] - c.hi) * k;
    c.kc.lerp(new THREE.Color(P.sun.col), k); c.ki += (P.sun.i - c.ki) * k;
    const d = sunDir(P.sun.az, P.sun.el); c.dir.lerp(new THREE.Vector3(d[0] * 110, d[1] * 110, d[2] * 110), k);
    if (hemi.current) { hemi.current.color.copy(c.hc); hemi.current.groundColor.copy(c.gc); hemi.current.intensity = c.hi; }
    if (key.current) { key.current.color.copy(c.kc); key.current.intensity = c.ki; key.current.position.copy(c.dir); }
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={[0xfdfff8, 0xd8d4c8, 0.85]} />
      <directionalLight ref={key} position={[-60, 90, 20]} intensity={2.2} color={0xfff1dd} castShadow
        shadow-mapSize={[2048, 2048]} shadow-camera-left={-95} shadow-camera-right={95} shadow-camera-top={95} shadow-camera-bottom={95 * -1}
        shadow-camera-far={400} shadow-radius={7} shadow-blurSamples={12} shadow-bias={-0.0004} />
    </>
  );
}

/* ---------- ground: the shadow catcher that makes the pods float over the page ---------- */
export function Ground() {
  const m = useRef();
  useFrame(() => { const P = PHASES[store.getState().phase] || PHASES.day; if (m.current) m.current.opacity += (P.shadow - m.current.opacity) * 0.05; });
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={-7} receiveShadow>
      <planeGeometry args={[500, 500]} />
      <shadowMaterial ref={m} opacity={0.13} />
    </mesh>
  );
}

/* ---------- the building: one floor plate with the corner rooms (lobby, kitchen, meeting, garden) ---------- */
export function Building({ LAYOUT, DEPT_KEYS, clickTargets }) {
  const built = useMemo(() => {
    const pods = Object.entries(LAYOUT).filter(([k]) => k === 'brain' || DEPT_KEYS.includes(k)).map(([, L]) => L);
    const minX = Math.min(...pods.map(L => L.pos[0] - L.w / 2)), maxX = Math.max(...pods.map(L => L.pos[0] + L.w / 2));
    const minZ = Math.min(...pods.map(L => L.pos[1] - L.d / 2)), maxZ = Math.max(...pods.map(L => L.pos[1] + L.d / 2));
    const w = maxX - minX + 12, d = maxZ - minZ + 12;
    const plate = makeFloorPlate(w, d);
    plate.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    const corners = [];
    // the four corners of the plate host the lobby (front), the kitchen, the meeting room and a garden —
    // any team count: a corner is used only when no room sits on it
    const free = (x, z) => !pods.some(L => Math.abs(L.pos[0] - x) < L.w / 2 + 9 && Math.abs(L.pos[1] - z) < L.d / 2 + 8);
    const cx = (maxX - minX) / 2 + 2, cz = (maxZ - minZ) / 2 + 2, mx = (minX + maxX) / 2, mz = (minZ + maxZ) / 2;
    const spots = [[mx + cx - 9, mz + cz - 8, 'lobby'], [mx - cx + 9, mz + cz - 8, 'kitchen'], [mx + cx - 9, mz - cz + 8, 'meeting'], [mx - cx + 9, mz - cz + 8, 'garden']];
    const stage = (x, z, kind) => {
      const room = kind === 'lobby' ? makeLobby() : kind === 'kitchen' ? makeKitchen() : kind === 'meeting' ? makeMeetingRoom() : makeGarden();
      room.position.set(x, 0, z); room.rotation.y = z > mz ? Math.PI : 0; corners.push(room);
      rig.corners = rig.corners || []; rig.corners.push({ kind, x, z, rot: z > mz ? Math.PI : 0, w: 14, d: 12 });
      const dir = new THREE.Vector2(mx - x, mz - z).normalize();
      corners.push(makeCorridor([x + dir.x * 7, z + dir.y * 7], [x + dir.x * 19, z + dir.y * 19], 'ring', 3.0));
      if (kind === 'kitchen') { // where a break is taken: three spots by the counter, one approach from the corridor
        const rot = z > mz ? Math.PI : 0, R = a => new THREE.Vector3(a.x * Math.cos(rot) + a.z * Math.sin(rot), 0.12, -a.x * Math.sin(rot) + a.z * Math.cos(rot)).add(new THREE.Vector3(x, 0, z));
        rig.kitchen = { approach: new THREE.Vector3(x + dir.x * 8.5, 0.12, z + dir.y * 8.5), spots: [R(new THREE.Vector3(-2.2, 0, 1.4)), R(new THREE.Vector3(0, 0, 1.6)), R(new THREE.Vector3(2.2, 0, 1.4)), R(new THREE.Vector3(3.6, 0, 4.6))], counter: R(new THREE.Vector3(0, 0, -2.4)), pos: new THREE.Vector3(x, 0, z) };
        const sc = makeScreen('market', 6.4, 3.6, { px: 640 }); const ws = makeWallScreen(sc, 6.4, 3.6); ws.position.copy(R(new THREE.Vector3(0, 0, -5.6))); ws.position.y = WALL_H + 1.4; ws.rotation.y = rot; room.add(ws); ws.position.sub(new THREE.Vector3(x, 0, z)); ws.position.set(0, WALL_H + 1.4, -5.6);
      }
      if (kind === 'lobby') { const sc = makeScreen('lobby', 8.2, 4.2, { px: 768 }); const ws = makeWallScreen(sc, 8.2, 4.2); ws.position.set(0, WALL_H + 1.6, -5.7); room.add(ws); }
      if (kind === 'meeting') {
        const rot = z > mz ? Math.PI : 0, R = a => new THREE.Vector3(a.x * Math.cos(rot) + a.z * Math.sin(rot), 0.12, -a.x * Math.sin(rot) + a.z * Math.cos(rot)).add(new THREE.Vector3(x, 0, z));
        rig.meetingRoom = { approach: new THREE.Vector3(x + dir.x * 8.5, 0.12, z + dir.y * 8.5), table: R(new THREE.Vector3(0, 0, 0)), pos: new THREE.Vector3(x, 0, z),
          seats: [-2.4, 0, 2.4].flatMap(sx => [-1, 1].map(sz => ({ at: R(new THREE.Vector3(sx, 0, sz * 2.4)), face: R(new THREE.Vector3(sx, 0, 0)) }))) };
      }
      if (kind === 'meeting') { const sc = makeScreen('market', 5.6, 3.2, { px: 640 }); const ws = makeWallScreen(sc, 5.6, 3.2); ws.position.set(0, WALL_H + 1.5, -5.6); room.add(ws); room.children.filter(o => o.isMesh && o.geometry.type === 'PlaneGeometry' && o.material.color && o.material.color.getHexString() === 'daecdc').forEach(o => o.visible = false); }
    };
    for (const [x, z, kind] of spots) if (free(x, z)) stage(x, z, kind);
    if (!rig.kitchen) { const [x, z] = [mx - cx + 9, mz + cz - 8]; stage(x, z, 'kitchen'); }
    if (!rig.meetingRoom) { const [x, z] = [mx + cx - 9, mz - cz + 8]; stage(x, z, 'meeting'); }
    // night: warm ceiling lights over the corridors, the lobby and the kitchen (the sim turns them up after dark)
    const lights = [];
    for (const [x, z] of [[mx + 9, mz + 9], [mx - 9, mz - 9], [mx + 9, mz - 9], [mx - 9, mz + 9], ...spots.map(([x, z]) => [x, z])]) {
      const l = new THREE.PointLight('#FFD9A0', 0, 44, 2); l.position.set(x, 9, z); l.visible = false; lights.push(l);
      const pool = makeLightPool(26, '#FFC978'); pool.position.set(x, 0.14, z); l.userData.pool = pool; corners.push(pool);
    }
    rig.nightLights = lights;
    rig.bounds = { minX: minX - 6, maxX: maxX + 6, minZ: minZ - 6, maxZ: maxZ + 6 };
    rig.centreRing = { x: LAYOUT.brain.pos[0], z: LAYOUT.brain.pos[1], r: LAYOUT.brain.w / 2 - 0.3 };
    return { plate, corners };
  }, []);
  return (
    <>
      <primitive object={built.plate} />
      {built.corners.map((o, i) => <primitive key={i} object={o} />)}
      {(rig.nightLights || []).map((l, i) => <primitive key={'l' + i} object={l} />)}
    </>
  );
}

/* ---------- one department room: carpet, walls, glass, corridor to the centre, a plant ---------- */
export function Pod({ k, L, dept, clickTargets, isCentre }) {
  const group = useMemo(() => {
    const g = new THREE.Group();
    g.position.set(L.pos[0], 0, L.pos[1]);
    const door = isCentre ? null : doorOf(L);
    const room = isCentre ? makeCentreOffice(L.w) : makeRoom(L.w, L.d, dept.floor, dept.chip, k, door && { ...door, edge: door.edge, sign: door.sign, width: door.width });
    g.add(room);
    if (!isCentre) { // the team's board on the back wall: name, who is working, throughput, the live list
      const sc = makeScreen('dept', 5.2, 3.0, { px: 512, key: k, name: dept.short, chip: dept.chip });
      const ws = makeWallScreen(sc, 5.2, 3.0);
      ws.position.set(L.w / 2 - 4.2, WALL_H + 1.3, -L.d / 2 + 0.55); g.add(ws);
      ws.traverse(o => { if (o.isMesh) o.userData.dept = k; });
    }
    room.traverse(o => { if (o.isMesh) { o.userData.dept = k; if (o.userData.part === 'floor' || o.userData.part === 'edge') clickTargets.push(o); } });
    return g;
  }, [k]);
  useEffect(() => {
    rig.deptRT[k] = { ...(rig.deptRT[k] || {}), group, L };
    if (isCentre) return;
    const door = doorOf(L);
    const ang = Math.atan2(L.pos[1], L.pos[0]);
    rig.deptRT[k].door = door;
    rig.deptRT[k].gate = door.outside.clone();                                   // just outside the door
    rig.deptRT[k].brainGate = new THREE.Vector3(Math.cos(ang) * (LAYOUT_CENTRE / 2 + 2.2), 0.12, Math.sin(ang) * (LAYOUT_CENTRE / 2 + 2.2)); // outside the ring, on this room's approach
    rig.rooms = rig.rooms || {}; rig.rooms[k] = { x: L.pos[0], z: L.pos[1], w: L.w, d: L.d, door };
  }, [k]);
  const corridor = useMemo(() => { // from the door to the ring, along this room's approach
    if (isCentre) return null;
    const door = doorOf(L), ang = Math.atan2(L.pos[1], L.pos[0]);
    const from = [door.at.x, door.at.z];
    const to = [Math.cos(ang) * (LAYOUT_CENTRE / 2 - 0.5), Math.sin(ang) * (LAYOUT_CENTRE / 2 - 0.5)];
    const g = new THREE.Group();
    g.add(makeCorridor(from, [door.outside.x, door.outside.z], k));
    g.add(makeCorridor([door.outside.x, door.outside.z], to, k));
    return g;
  }, [k]);
  const plant = useMemo(() => {
    const p = makePlant();
    const sx = Math.sign(L.pos[0]) || 1, sz = Math.sign(L.pos[1]) || -1;
    p.position.set(isCentre ? 6.2 : L.pos[0] + sx * (L.w / 2 - 1.8), 0.12, isCentre ? -5.8 : L.pos[1] + sz * (L.d / 2 - 1.8));
    p.traverse(o => { if (o.isMesh) o.userData.dept = k; });
    return p;
  }, [k]);
  return (
    <>
      <primitive object={group} />
      {corridor && <primitive object={corridor} />}
      <primitive object={plant} />
    </>
  );
}
const LAYOUT_CENTRE = 16;

/* ---------- a workstation: desk + chair + person, rotated 45° so screens face the camera ---------- */
const ANG = Math.PI / 4;
const rot = v => v.applyAxisAngle(new THREE.Vector3(0, 1, 0), ANG);
export function Station({ a, dept, L, cols, personTargets, v1 }) {
  const built = useMemo(() => {
    const gx = (a.grid[0] - (cols - 1) / 2) * 8.6;
    const gz = (a.grid[1] - 1) * 6.4 - 1;
    const base = new THREE.Vector3(L.pos[0] + gx, 0.12, L.pos[1] + gz);
    const station = new THREE.Group();
    station.position.copy(base); station.rotation.y = ANG;
    const desk = makeDesk(dept.chip, { lead: !!a.lead });
    station.add(desk.group);
    const chair = makeChair(); chair.position.set(0, 0, 1.75); station.add(chair);
    station.traverse(o => { if (o.isMesh) o.userData.dept = a.dept; });
    const person = buildPerson({ id: a.id, hair: a.hair, skin: a.skin, chip: dept.chip, lead: a.lead });
    person.position.copy(base).add(rot(new THREE.Vector3(0, 0, 1.7)));
    person.rotation.y = ANG + Math.PI;
    person.traverse(o => { if (o.isMesh) { o.userData.agentId = a.id; o.userData.dept = a.dept; personTargets.push(o); } });
    const warn = makeWarnSprite(); warn.visible = false;
    const ring = makeSelectRing(); ring.position.set(person.position.x, 0.16, person.position.z);
    const lamp = new THREE.PointLight('#FFD9A0', 0, 12, 2); lamp.position.copy(base).add(rot(desk.lampAt.clone())); lamp.visible = false;
    return { station, desk, chair, person, warn, ring, lamp, base };
  }, [a.id]);
  useEffect(() => {
    const { station, desk, chair, person, warn, ring, lamp, base } = built;
    if (!rig.DEMO) { desk.screenSet.draw(['Ready when you are'], 'idle'); desk.screenSet.tex.needsUpdate = true; }
    rig.R[a.id] = {
      a, person, warn, ring, lamp, chair, desk: desk.group, screenSet: desk.screenSet, activity: desk.activity, glow: desk.glow, lampBulb: desk.lampBulb, lampHalo: desk.lampHalo, pool: desk.pool,
      seat: person.position.clone(), seatRot: ANG + Math.PI,
      stand: person.position.clone().add(rot(new THREE.Vector3(1.5, 0, 0.15))),
      beside: person.position.clone().add(rot(new THREE.Vector3(-2.6, 0, 0.6))), // where a visiting lead / the PM stands
      state: 'working', bob: Math.random() * 10, path: null, pathI: 0, speed: 9.5, ask: null,
      nextGlance: performance.now() + 2000 + Math.random() * 6000, nextStretch: performance.now() + 20000 + Math.random() * 60000,
      v1: v1 || { role: a.role || a.name, tagline: a.does || '', greeting: 'Ready for your task.', chips: [], stats: [], chart: [], tasks: [] }, feed: [],
      pill: null,
    };
    return () => { delete rig.R[a.id]; };
  }, [a.id]);
  return (
    <>
      <primitive object={built.station} />
      <primitive object={built.person} />
      <primitive object={built.warn} />
      <primitive object={built.ring} />
      <primitive object={built.lamp} />
    </>
  );
}

/* ---------- the Program Manager's office at the centre pod (design 1a) ---------- */
export function ProgramOffice({ L, personTargets }) {
  const built = useMemo(() => {
    const base = new THREE.Vector3(L.pos[0], 0.12, L.pos[1] + 0.5);
    const station = new THREE.Group();
    station.position.copy(base); station.rotation.y = ANG;
    const desk = makeDesk('#B9A775', { lead: true });
    station.add(desk.group);
    const chair = makeChair(); chair.position.set(0, 0, 1.75); station.add(chair);
    station.traverse(o => { if (o.isMesh) o.userData.dept = 'brain'; });
    const person = buildPerson({ id: 'pm', hair: '#303038', skin: '#D7A37D', chip: '#B9A775', lead: true });
    person.position.copy(base).add(rot(new THREE.Vector3(0, 0, 1.7)));
    person.rotation.y = ANG + Math.PI;
    person.traverse(o => { if (o.isMesh) { o.userData.agentId = 'program-manager'; o.userData.dept = 'brain'; personTargets.push(o); } });
    const trail = makeTrail(10);
    const ring = makeSelectRing(); ring.position.set(person.position.x, 0.16, person.position.z);
    return { station, desk, chair, person, trail, ring, base };
  }, []);
  useEffect(() => {
    const { station, desk, chair, person, trail, ring } = built;
    desk.screenSet.draw(['Coordinating teams'], 'idle'); desk.screenSet.tex.needsUpdate = true;
    rig.pm = { person, chair, ring, trail, desk: desk.group, screenSet: desk.screenSet, activity: desk.activity, glow: desk.glow, lampBulb: desk.lampBulb,
      seat: person.position.clone(), seatRot: ANG + Math.PI, state: 'working', path: null, pathI: 0, speed: 11, target: null, pill: null, bob: 3 };
    return () => { rig.pm = null; };
  }, []);
  return (
    <>
      <primitive object={built.station} />
      <primitive object={built.person} />
      <primitive object={built.trail} />
      <primitive object={built.ring} />
    </>
  );
}

/* ---------- the camera: orthographic iso, sized from the rig every frame ---------- */
export function IsoCamera() {
  const { set, size, gl } = useThree();
  const cam = useMemo(() => { const c = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 800); c.zoom = rig.view.zoom; return c; }, []);
  useLayoutEffect(() => { rig.camera = cam; set({ camera: cam }); applyCamera(cam); }, [cam]);
  useLayoutEffect(() => { rig.size = { w: size.width, h: size.height }; applyCamera(cam); }, [size.width, size.height]);
  return null;
}

/* ---------- theme: re-tint the shared pod / walkway / floor materials on dark ---------- */
const DARK = { plinth: 0x33342f, walkway: 0x3a3b38, ground: 0x2a2b27 };
function mix(hex, base, k) { const a = new THREE.Color(hex), b = new THREE.Color(base); return b.lerp(a, k); }
export function Theme() {
  const { scene } = useThree();
  const last = useRef(null);
  useFrame(() => {
    const dark = store.getState().dark;
    if (dark === last.current) return;
    last.current = dark;
    scene.traverse(o => {
      if (!o.isMesh || !o.userData.part) return;
      const m = o.material; if (!m.userData.base) m.userData.base = m.color.clone();
      if (o.userData.part === 'plinth') m.color.set(dark ? DARK.plinth : m.userData.base);
      else if (o.userData.part === 'walkway') m.color.set(dark ? DARK.walkway : m.userData.base);
      else if (o.userData.part === 'ground') m.color.set(dark ? DARK.ground : m.userData.base);
      else if (o.userData.part === 'wall') m.color.set(dark ? 0x45463f : m.userData.base);
      else if (o.userData.part === 'floor') m.color.copy(dark ? mix(o.userData.chip, '#24251f', o.userData.dept === 'brain' ? 0.1 : 0.3) : m.userData.base);
    });
  });
  return null;
}
