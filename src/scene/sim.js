// The simulation: every figure's life, once per frame, on refs. Idle life (breath, glances,
// a rare stretch), visible work (typing lean, live screen), the lead walking over to help
// a worker, the Program Manager routing between teams with a dotted trail, the selected
// agent standing to wave, night lamps over busy desks. Nothing here touches React state.
import * as THREE from 'three';
import { rig } from './rig.js';
import { store } from './store.js';
import { PHASES } from './daylight.js';
import { poseWork, posePerson } from './person.js';

const WORK_MODES = [ // demo desk-life variety (AJ: no stand-up stretches)
  ['type', 0.30, 4000, 7500], ['read', 0.18, 3500, 6500], ['phone', 0.16, 4000, 8000],
  ['glance', 0.17, 2000, 3500], ['sip', 0.11, 2500, 4000], ['spin', 0.08, 1400, 2000],
];
const FACE_CAM = Math.PI / 4;
const LINES = {
  coffee: ['Coffee?', 'Long morning.', 'Almost done with mine.', 'Client loved the draft.', 'Numbers look good this week.', 'Did you see the new brief?', 'Back in five.', 'Need the printer fixed.', 'This one’s a strong one.', 'Ship it today?'],
  desk: ['Can you check my draft?', 'On it.', 'Sending it over now.', 'One sec — finishing this.', 'Looks good to me.', 'What did the lead say?', 'Approved this morning.', 'I’ll take the follow-up.', 'Two left in the queue.', 'Nice work on that.'],
  meeting: ['Quick sync on the week.', 'Priorities first.', 'The client wants it Friday.', 'I can take the research.', 'Let’s split the list.', 'Any blockers?', 'None on my side.', 'We ship Thursday.', 'Agreed.', 'Next steps are clear.'],
  pass: ['Morning!', 'Hey.', 'Busy day?', 'Coffee later?', 'Nice one.', 'Hi!'],
  greet: ['Hey!', 'Hi there.', 'Welcome back.'],
};
const pick = a => a[Math.floor(Math.random() * a.length)];
const route = (from, to) => rig.nav ? rig.nav.route(from, to) : [to.clone().setY(0.12)];
const tmp = new THREE.Vector3();

export function createSim({ DEMO, tasks, overlays, DEPTS, DEPT_KEYS, AGENTS, LAYOUT, rnd, WORKLINES, sample, page }) {
  const screenSets = () => Object.values(rig.R).map(r => ({ screenSet: r.screenSet, dept: r.a.dept }));
  let nextTheatre = performance.now() + 14000, nextPmTheatre = performance.now() + 9000, nextBreak = performance.now() + 6000, nextChat = 0;
  const onBreak = () => Object.values(rig.R).filter(r => r.walkKind === 'coffee');
  let meeting = null, nextMeeting = performance.now() + 40000 + Math.random() * 60000, nextDeskChat = performance.now() + 8000;
  const say = (r, t, ms) => overlays && overlays.say && overlays.say(r, t, ms);

  function pickWorkMode(r, now) {
    let x = Math.random();
    for (const [mode, w, dMin, dMax] of WORK_MODES) {
      x -= w;
      if (x <= 0 || mode === WORK_MODES[WORK_MODES.length - 1][0]) {
        r.workMode = mode; r.modeStart = now; r.modeUntil = now + dMin + Math.random() * (dMax - dMin);
        if (mode === 'glance') r.person.userData.glanceDir = (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.25);
        return;
      }
    }
  }
  // idle life (design): a glance every 5–8 s, a stretch every 40–90 s
  function idleLife(r, now) {
    const u = r.person.userData;
    if (now > r.nextGlance) { r.glanceUntil = now + 900 + Math.random() * 700; r.nextGlance = now + 5000 + Math.random() * 3000; u.glanceDir = (Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.15); }
    u.glanceK = r.glanceUntil && now < r.glanceUntil ? Math.sin(Math.min(1, (r.glanceUntil - now) / 800) * Math.PI) : 0;
    if (now > r.nextStretch) { r.stretchUntil = now + 1400; r.nextStretch = now + 40000 + Math.random() * 50000; }
    return r.stretchUntil && now < r.stretchUntil ? 'stretch' : 'idle';
  }
  // standing modes drift the agent from the chair to a spot beside the desk and can re-face the camera
  function applyStandAndFacing(r, mode, now, dt) {
    const u = r.person.userData;
    const sk = (u.cur && u.cur.standK) || 0;
    r.person.position.x = r.seat.x + (r.stand.x - r.seat.x) * sk;
    r.person.position.z = r.seat.z + (r.stand.z - r.seat.z) * sk;
    if (r.chair) r.chair.position.z = 1.75 + 0.55 * sk; // the chair slides back when they stand
    if (mode === 'spin') {
      const span = Math.max(400, (r.modeUntil - r.modeStart) || 1500);
      r.person.rotation.y = r.seatRot + ((now - r.modeStart) / span) * Math.PI * 2;
      return;
    }
    const target = (mode === 'stretch' && sk > 0.5) || mode === 'cheer' || mode === 'wave' || mode === 'stand' ? FACE_CAM : r.seatRot;
    let d = target - r.person.rotation.y;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    r.person.rotation.y += d * (1 - Math.exp(-dt * 6));
  }
  function walkStep(r, dt) {
    const cur = r.person.position, tgt = r.path[r.pathI];
    const d = tmp.subVectors(tgt, cur); d.y = 0;
    const dist = d.length();
    const step = r.speed * dt;
    if (dist <= step) { cur.x = tgt.x; cur.z = tgt.z; r.pathI++; if (r.pathI >= r.path.length) return true; }
    else { d.normalize(); cur.x += d.x * step; cur.z += d.z * step; r.person.rotation.y = Math.atan2(d.x, d.z); }
    return false;
  }
  function faceToward(r, p, dt) {
    const target = Math.atan2(p.x - r.person.position.x, p.z - r.person.position.z);
    let d = target - r.person.rotation.y;
    while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    r.person.rotation.y += d * (1 - Math.exp(-dt * 6));
  }

  /* ---------- lead assisting: walk the pod aisle to a worker's desk, stand beside it ---------- */
  function sendLeadTo(lead, workerId) {
    const w = rig.R[workerId]; if (!w || lead.state !== 'working') return;
    lead.assistTarget = workerId;
    lead.path = [lead.seat.clone().add(tmp.set(0, 0, 0)), lead.stand.clone(), w.beside.clone()];
    lead.pathI = 0; lead.state = 'walking'; lead.walkKind = 'assist'; lead.speed = 8.5;
    if (lead.chair) lead.chair.position.z = 2.3;
  }
  /* ---------- coffee: an idle agent walks to the kitchen, takes a mug, chats, comes back ---------- */
  function sendToKitchen(r) {
    const K = rig.kitchen; if (!K) return false;
    const taken = new Set(onBreak().map(x => x.spotI));
    const spotI = K.spots.findIndex((_, i) => !taken.has(i)); if (spotI < 0) return false;
    const d = rig.deptRT[r.a.dept]; if (!d || !d.gate) return false;
    r.spotI = spotI; r.walkKind = 'coffee';
    r.path = [r.seat.clone(), r.stand.clone(), ...route(r.stand, K.spots[spotI])];
    r.pathI = 0; r.state = 'walking'; r.speed = 8 + Math.random() * 2;
    if (r.chair) r.chair.position.z = 2.3;
    return true;
  }
  /* ---------- meetings: a lead takes two or three of the team to the meeting room ---------- */
  function callMeeting(lead, members) {
    const M = rig.meetingRoom; if (!M) return false;
    const group = [lead, ...members].slice(0, M.seats.length);
    group.forEach((r, i) => {
      const d = rig.deptRT[r.a.dept]; if (!d || !d.gate) return;
      r.walkKind = 'meeting'; r.seatI = i;
      r.path = [r.seat.clone(), r.stand.clone(), ...route(r.stand, M.seats[i].at)];
      r.pathI = 0; r.state = 'walking'; r.speed = 8.5 + Math.random() * 1.5;
      if (r.chair) r.chair.position.z = 2.3;
    });
    meeting = { group, startAt: performance.now(), lead, endAt: performance.now() + 45000 + Math.random() * 30000, nextLine: performance.now() + 4000 };
    say(lead, pick(['Quick sync — meeting room?', 'Five minutes, everyone.', 'Let’s huddle.']), 3200);
    return true;
  }
  function sendHome(r) {
    if (!r.path) { r.state = 'working'; return; }
    const d = rig.deptRT[r.a.dept];
    r.path = [r.person.position.clone(), ...route(r.person.position, r.stand), r.seat.clone()];
    r.pathI = 0; r.state = 'returning';
    if (r.mug) r.mug.visible = false;
  }

  /* ---------- the Program Manager: home at the centre, routes along the walkways ---------- */
  function sendPmTo(dept, title) {
    const pm = rig.pm; if (!pm || pm.state !== 'working') return;
    const d = rig.deptRT[dept]; if (!d || !d.gate) return;
    const lead = Object.values(rig.R).find(r => r.a.dept === dept && r.a.lead) || Object.values(rig.R).find(r => r.a.dept === dept);
    if (!lead) return;
    pm.target = dept; pm.title = title || '';
    pm.path = [pm.seat.clone(), pm.seat.clone().add(new THREE.Vector3(1.6, 0, 1.2)), ...route(pm.seat.clone().add(new THREE.Vector3(1.6, 0, 1.2)), lead.beside)];
    pm.pathI = 0; pm.state = 'walking'; pm.leadId = lead.a.id;
    if (pm.chair) pm.chair.position.z = 2.3;
  }
  function pmHome() {
    const pm = rig.pm; const d = rig.deptRT[pm.target];
    pm.path = [pm.person.position.clone(), ...route(pm.person.position, pm.seat)];
    pm.pathI = 0; pm.state = 'returning';
  }
  function tickTrail(pm, now, dt) {
    const t = pm.trail.userData;
    if (pm.state === 'walking' || pm.state === 'returning') {
      if (!pm.lastDot || pm.person.position.distanceTo(pm.lastDot) > 1.6) {
        const d = t.dots[t.next]; t.next = (t.next + 1) % t.dots.length;
        d.m.position.set(pm.person.position.x, 0.2, pm.person.position.z); d.m.visible = true; d.born = now;
        pm.lastDot = pm.person.position.clone();
      }
    }
    for (const d of t.dots) { if (!d.m.visible) continue; const k = (now - d.born) / 3000; if (k >= 1) d.m.visible = false; else d.m.material.opacity = 0.8 * (1 - k); }
  }

  /* ---------- the frame ---------- */
  let ctxLastLook = 0;
  function tick(now, dt, focused) {
    const S = store.getState();
    // night lights: warm pools over the corridors and the corners after dark
    if (rig.nightLights) { const P0 = PHASES[S.phase] || PHASES.day; const on = P0.screen > 0.5; for (const l of rig.nightLights) { l.intensity += ((on ? 160 : 0) - l.intensity) * 0.06; l.visible = l.intensity > 0.5; if (l.userData.pool) l.userData.pool.material.opacity = 0.42 * l.intensity / 160; } }
    const P = PHASES[S.phase] || PHASES.day;
    const night = P.screen > 0.5;
    let lamps = 0;
    // ---- the Program Manager
    const pm = rig.pm;
    if (pm) {
      const live = !DEMO && tasks;
      const pa = live ? tasks.projectActivity?.() : null;
      pm.busy = !!pa || (live && Object.values(rig.R).some(r => ['planning', 'reviewing', 'verifying'].includes(r.livePhase)));
      if (pm.state === 'working') {
        // LIVE: a lead planning or verifying somewhere → the PM walks over to coordinate
        if (live) {
          const lead = Object.values(rig.R).find(r => r.a.lead && ['planning', 'reviewing', 'verifying'].includes(r.livePhase));
          const due = lead && (!pm.lastVisit || now - pm.lastVisit > 45000 || pm.lastDept !== lead.a.dept);
          pm.next = lead ? { dept: lead.a.dept, title: lead.liveTitle } : null;
          if (due) sendPmTo(lead.a.dept, lead.liveTitle);
        } else if (now > nextPmTheatre && !focused) {
          const k = DEPT_KEYS[Math.floor(Math.random() * DEPT_KEYS.length)];
          pm.next = { dept: k, title: rnd(['weekly plan', 'blocked item', 'client hand-off', 'scope check']) };
          sendPmTo(k, pm.next.title);
          nextPmTheatre = now + 30000 + Math.random() * 40000;
        }
        const busyMode = pm.busy ? 'read' : idleLifeFor(pm, now);
        poseWork(pm.person, busyMode, now + pm.bob * 500, dt);
        pm.person.position.x = pm.seat.x; pm.person.position.z = pm.seat.z;
        let d = pm.seatRot - pm.person.rotation.y; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; pm.person.rotation.y += d * (1 - Math.exp(-dt * 6));
        if (pm.chair) pm.chair.position.z += (1.75 - pm.chair.position.z) * (1 - Math.exp(-dt * 5));
      } else if (pm.state === 'walking' || pm.state === 'returning') {
        pm.speed = 11; posePerson(pm.person, 'walk', now);
        if (walkStep(pm, dt)) {
          if (pm.state === 'walking') { pm.state = 'atDesk'; pm.arrivedAt = now; pm.lastVisit = now; pm.lastDept = pm.target; }
          else { pm.state = 'working'; pm.person.position.copy(pm.seat); pm.person.rotation.y = pm.seatRot; pm.target = null; }
        }
      } else if (pm.state === 'atDesk') {
        posePerson(pm.person, 'stand', now);
        const lead = rig.R[pm.leadId]; if (lead) faceToward(pm, lead.person.position, dt);
        const stay = live ? (lead && ['planning', 'reviewing', 'verifying'].includes(lead.livePhase) && now - pm.arrivedAt < 90000) : now - pm.arrivedAt < 8000;
        if (!stay) pmHome();
      }
      tickTrail(pm, now, dt);
      pm.ring.userData.ring.material.opacity += ((S.selected === 'program-manager' ? 0.9 : 0) - pm.ring.userData.ring.material.opacity) * 0.15;
      pm.ring.userData.halo.material.opacity = pm.ring.userData.ring.material.opacity * 0.7;
      pm.ring.position.set(pm.person.position.x, 0.16, pm.person.position.z);
    }
    // ---- every agent
    for (const r of Object.values(rig.R)) {
      const selected = S.selected === r.a.id;
      // selection ring follows the figure
      const ringA = selected ? 0.9 : 0;
      r.ring.userData.ring.material.opacity += (ringA - r.ring.userData.ring.material.opacity) * 0.15;
      r.ring.userData.halo.material.opacity = r.ring.userData.ring.material.opacity * 0.7;
      r.ring.position.set(r.person.position.x, 0.16, r.person.position.z);
      const live = !DEMO && tasks;
      const work = live ? tasks.agentActivity?.(r.a.id) : null;
      const phase = live ? (work?.phase || 'idle') : (r.state === 'stuck' ? 'stuck' : 'working');
      const active = !!work && !['done', 'submitted'].includes(work.phase);
      // the pod card counts "working": live phases, or in the demo the desk modes that read as work
      r.livePhase = live ? (r.state === 'stuck' ? 'blocked' : phase) : (r.state === 'stuck' ? 'blocked' : r.state === 'assisting' || r.walkKind === 'assist' ? 'helping' : ['type', 'read', 'phone'].includes(r.workMode) ? 'working' : 'idle'); r.liveTitle = work?.title || '';
      if (r.state === 'working') {
        if (selected) { poseWork(r.person, 'wave', now + r.bob * 500, dt); applyStandAndFacing(r, 'wave', now, dt); }
        else if (live) {
          const motion = active ? (phase === 'reviewing' || phase === 'planning' ? 'read' : 'type') : idleLife(r, now);
          poseWork(r.person, motion, now + r.bob * 500, dt);
          applyStandAndFacing(r, motion, now, dt);
          // LIVE lead-assist: a lead verifying walks to the worker whose step it is checking
          if (r.a.lead && phase === 'reviewing' && !r.assistTarget) {
            const worker = Object.values(rig.R).find(x => x.a.dept === r.a.dept && !x.a.lead && x.livePhase === 'submitted') || Object.values(rig.R).find(x => x.a.dept === r.a.dept && !x.a.lead && x.livePhase === 'working');
            if (worker) sendLeadTo(r, worker.a.id);
          }
        } else {
          let mode;
          if (r.cheerUntil && now < r.cheerUntil) mode = 'cheer';
          else if (r.slumpUntil && now < r.slumpUntil) mode = 'slump';
          else {
            if (!r.modeUntil) { pickWorkMode(r, now); r.modeUntil = now + 400 + Math.random() * 4000; }
            else if (now > r.modeUntil) pickWorkMode(r, now);
            mode = r.workMode;
            if (mode === 'type' || mode === 'read') { const il = idleLife(r, now); if (il === 'stretch') mode = 'stretch'; }
          }
          poseWork(r.person, mode, now + r.bob * 500, dt);
          applyStandAndFacing(r, mode, now, dt);
        }
        // the desk screen, activity glow, pill state
        const st = r.state === 'stuck' ? 'blocked' : phase === 'reviewing' ? 'verifying' : phase === 'planning' ? 'planning' : phase === 'done' ? 'done' : phase === 'submitted' ? 'submitted' : active ? 'working' : (live ? 'idle' : 'working');
        const screenKey = st + (work?.title || '') + Math.floor(now / 400);
        if (r.screenKey !== screenKey) {
          r.screenKey = screenKey;
          if (live) { r.screenSet.draw(work ? [work.title.slice(0, 26), work.title.slice(26, 52)] : ['Ready when you are'], st, now); r.screenSet.tex.needsUpdate = true; }
          else if (Math.floor(now / 1800) !== r.lastDemoScreen && Math.random() < 0.12) { r.lastDemoScreen = Math.floor(now / 1800); r.screenSet.draw(sample(WORKLINES[r.a.dept] || ['▸ …'], 3).map(l => l.slice(0, 28)), 'working', now); r.screenSet.tex.needsUpdate = true; }
        }
        r.activity.material.color.set(st === 'done' ? '#36C98B' : st === 'verifying' ? '#B491ED' : st === 'planning' ? '#E5B54A' : st === 'blocked' ? '#F2B84B' : '#62BCEA');
        r.activity.material.opacity = (active || st === 'blocked') ? 0.38 + 0.18 * Math.sin(now / 500 + r.bob) : st === 'done' ? 0.32 : 0;
        if (overlays && r.pill) {
          const pct = work && work.total ? (work.done || 0) / work.total : (active && work?.pct != null ? work.pct : null);
          const leadName = (Object.values(rig.R).find(x => x.a.dept === r.a.dept && x.a.lead) || {}).a?.name;
          const sub = r.state === 'stuck' ? (r.ask ? r.ask.slice(0, 44) : 'Needs your OK') : st === 'verifying' ? `Verifying ${r.liveTitle.slice(0, 30)}` : st === 'planning' ? 'Planning · reading the Brain' : st === 'submitted' ? 'Submitted · waiting for lead review' : st === 'done' ? `Verified${leadName && !r.a.lead ? ' by ' + leadName : ''} · ${r.liveTitle.slice(0, 26) || 'ready'}` : active ? (work.step ? `Step ${work.step} · ` : '') + r.liveTitle.slice(0, 34) : '';
          overlays.setPillState(r.pill, r, live ? (r.state === 'stuck' ? 'stuck' : st) : (r.state === 'stuck' ? 'stuck' : 'idle'), sub, live && (st === 'done' || st === 'submitted') ? 1 : live && (active || st === 'verifying') ? (pct ?? 0.4 + 0.3 * Math.abs(Math.sin(now / 9000 + r.bob))) : null);
        }
      } else if (r.state === 'walking' || r.state === 'returning') {
        posePerson(r.person, 'walk', now);
        if (walkStep(r, dt)) {
          if (r.state === 'walking') { r.state = r.walkKind === 'assist' ? 'assisting' : r.walkKind === 'coffee' ? 'coffee' : r.walkKind === 'meeting' ? 'meeting' : 'atBrain'; if (r.state === 'meeting') { r.person.userData.cur = null; } r.arrivedAt = now; r.breakFor = 16000 + Math.random() * 18000; if (r.state === 'atBrain') r.person.rotation.y = r.person.position.x < 2 ? Math.PI / 2 : -Math.PI / 2; if (r.state === 'coffee' && r.mug) { r.mug.visible = true; const there = onBreak().filter(x => x !== r && x.state === 'coffee'); if (there.length) say(there[0], pick(LINES.greet), 1800); } }
          else { r.state = 'working'; r.person.position.copy(r.seat); r.person.rotation.y = r.seatRot; r.person.userData.cur = null; r.assistTarget = null; r.walkKind = null; r.spotI = null; r.seatI = null; if (r.chair) r.chair.position.z = 1.75; if (r.mug) r.mug.visible = false; }
        }
        if (r.pill && overlays) overlays.setPillState(r.pill, r, r.walkKind === 'assist' ? 'helping' : 'idle', r.walkKind === 'assist' && rig.R[r.assistTarget] ? `Going to ${rig.R[r.assistTarget].a.name}` : '', null);
      } else if (r.state === 'coffee') {
        posePerson(r.person, 'stand', now);
        // face the counter, or whoever is there too; a sip now and then
        const others = onBreak().filter(x => x !== r && x.state === 'coffee');
        const look = others.length ? others[0].person.position : rig.kitchen.counter;
        faceToward(r, look, dt);
        const u = r.person.userData; const sip = Math.sin(now / 900 + r.bob) > 0.86; u.shR.rotation.x = sip ? -2.0 : -0.35 + Math.sin(now / 500) * 0.05; u.shR.rotation.z = sip ? 0.35 : -0.15;
        if (r.pill && overlays) overlays.setPillState(r.pill, r, 'idle', '', null);
        if (now - r.arrivedAt > r.breakFor) sendHome(r);
      } else if (r.state === 'meeting') { // seated at the table, facing it, listening or talking
        const M = rig.meetingRoom, seat = M && M.seats[r.seatI];
        poseWork(r.person, r.talking && now < r.talking ? 'phone' : 'read', now + r.bob * 500, dt);
        r.person.position.x = seat ? seat.at.x : r.person.position.x; r.person.position.z = seat ? seat.at.z : r.person.position.z;
        if (seat) faceToward(r, seat.face, dt);
        if (r.pill && overlays) overlays.setPillState(r.pill, r, 'idle', '', null);
      } else if (r.state === 'assisting') {
        posePerson(r.person, 'stand', now);
        const w = rig.R[r.assistTarget];
        if (w) faceToward(r, w.person.position, dt);
        if (r.pill && overlays) overlays.setPillState(r.pill, r, 'helping', w ? `Lead is helping · ${w.liveTitle || w.a.name}` : 'helping', null);
        const live = !DEMO && tasks;
        const stay = live ? (['reviewing', 'verifying'].includes(r.livePhase) && now - r.arrivedAt < 120000) : now - r.arrivedAt < 7000;
        if (!stay) sendHome(r);
      } else if (r.state === 'atBrain') {
        posePerson(r.person, 'stand', now);
      }
      // stuck agents STAND, face the camera and WAVE under their pulsing ⚠
      if (r.state === 'stuck') {
        poseWork(r.person, 'wave', now + r.bob * 500, dt);
        applyStandAndFacing(r, 'wave', now, dt);
        const p = r.person.position;
        r.warn.position.set(p.x, p.y + 5.9, p.z);
        const k = 2.6 + Math.sin(now / 240) * 0.5; r.warn.scale.set(k, k, 1);
      }
      // night: screens glow, a lamp pools light over every busy desk (capped)
      const glowT = P.screen * (active || r.state === 'stuck' || !(!DEMO && tasks) ? 0.35 : 0.12);
      r.glow.material.opacity += (glowT - r.glow.material.opacity) * 0.08;
      // night: every busy desk gets its yellow pool of light; the first dozen also carry a real point light
      const busyDesk = active || r.state === 'stuck' || r.state === 'assisting' || (DEMO && ['type', 'read', 'phone'].includes(r.workMode)) || (!!(DEMO) && r.state === 'working' && r.livePhase === 'working');
      const lampOn = night && (busyDesk || (DEMO && r.state === 'working'));
      const withLight = lampOn && lamps < 12; if (withLight) lamps++;
      r.lamp.intensity += ((withLight ? 34 : 0) - r.lamp.intensity) * 0.1; r.lamp.visible = r.lamp.intensity > 0.5;
      const k = lampOn ? 1 : 0;
      r.lampBulb.material.opacity += (k - r.lampBulb.material.opacity) * 0.1;
      r.lampHalo.material.opacity += (k * 0.9 - r.lampHalo.material.opacity) * 0.1;
      r.pool.material.opacity += (k * 0.6 - r.pool.material.opacity) * 0.1;
    }
    // coffee breaks: an idle agent now and then, never more than three away at once
    if (rig.kitchen && now > nextBreak) {
      nextBreak = now + 9000 + Math.random() * 12000;
      const live = !DEMO && tasks;
      if (onBreak().length < 3 && !focused) {
        const idle = Object.values(rig.R).filter(r => r.state === 'working' && !r.a.lead && !(live ? tasks.agentActivity?.(r.a.id) : ['type', 'read', 'phone'].includes(r.workMode)) && store.getState().selected !== r.a.id);
        if (idle.length) sendToKitchen(idle[Math.floor(Math.random() * idle.length)]);
      }
    }
    // the meeting: lines go round the table; when time is up everyone heads back
    if (meeting) {
      const seated = meeting.group.filter(r => r.state === 'meeting');
      if (seated.length && now > meeting.nextLine) { const r = seated[Math.floor(Math.random() * seated.length)]; r.talking = now + 2600; say(r, pick(LINES.meeting), 2800); meeting.nextLine = now + 3200 + Math.random() * 2800; }
      if (now > meeting.endAt || meeting.group.every(r => r.state === 'working')) { for (const r of meeting.group) if (r.state === 'meeting') sendHome(r); meeting = null; nextMeeting = now + 120000 + Math.random() * 120000; }
    } else if (rig.meetingRoom && now > nextMeeting && !focused) {
      const live = !DEMO && tasks;
      const isFree = r => r.state === 'working' && !(live ? tasks.agentActivity?.(r.a.id) : ['type', 'phone'].includes(r.workMode)) && store.getState().selected !== r.a.id;
      const leads = Object.values(rig.R).filter(r => r.a.lead && isFree(r));
      const lead = leads[Math.floor(Math.random() * leads.length)];
      if (lead) { const team = Object.values(rig.R).filter(r => r.a.dept === lead.a.dept && !r.a.lead && isFree(r)).sort(() => Math.random() - 0.5).slice(0, 3); if (team.length >= 2) callMeeting(lead, team); }
      nextMeeting = now + 60000 + Math.random() * 90000;
    }
    // desk chat: two neighbours who are both free trade a couple of lines
    if (now > nextDeskChat) {
      nextDeskChat = now + 7000 + Math.random() * 9000;
      const live = !DEMO && tasks;
      const free = Object.values(rig.R).filter(r => r.state === 'working' && !(live ? tasks.agentActivity?.(r.a.id) : ['type', 'phone'].includes(r.workMode)));
      const a = free[Math.floor(Math.random() * free.length)];
      if (a) {
        const b = free.filter(x => x !== a && x.a.dept === a.a.dept).sort((p, q) => p.seat.distanceTo(a.seat) - q.seat.distanceTo(a.seat))[0];
        if (b && b.seat.distanceTo(a.seat) < 12) {
          a.person.userData.glanceDir = Math.sign(Math.atan2(b.seat.x - a.seat.x, b.seat.z - a.seat.z) - a.seatRot) * 0.5 || 0.4; a.glanceUntil = now + 4200; a.nextGlance = now + 9000;
          b.person.userData.glanceDir = -a.person.userData.glanceDir; b.glanceUntil = now + 4200; b.nextGlance = now + 9000;
          say(a, pick(LINES.desk), 2600); setTimeout(() => { if (b.state === 'working') say(b, pick(LINES.desk), 2600); }, 2400);
        }
      }
    }
    // whoever walks past a desk gets a look
    const walkers = Object.values(rig.R).filter(r => r.state === 'walking' || r.state === 'returning');
    if (walkers.length && Math.floor(now / 700) !== ctxLastLook) {
      ctxLastLook = Math.floor(now / 700);
      for (const w of walkers) for (const r of Object.values(rig.R)) {
        if (r === w || r.state !== 'working' || r.glanceUntil > now) continue;
        if (r.seat.distanceTo(w.person.position) < 7) { r.person.userData.glanceDir = Math.sign(Math.sin(Math.atan2(w.person.position.x - r.seat.x, w.person.position.z - r.seat.z) - r.seatRot)) * 0.55 || 0.4; r.glanceUntil = now + 1400; r.nextGlance = now + 6000; if (Math.random() < 0.12 && !r.bubble) say(r, pick(LINES.pass), 1800); if (Math.random() < 0.08 && !w.bubble) say(w, pick(LINES.pass), 1800); }
      }
    }
    if (now > nextChat) { // two at the counter trade a word
      nextChat = now + 2600 + Math.random() * 2600;
      const there = onBreak().filter(r => r.state === 'coffee');
      if (there.length) { const r = there[Math.floor(Math.random() * there.length)]; if (there.length > 1) say(r, pick(LINES.coffee), 2800); else if (page && page.spawnEmote) page.spawnEmote(r, '☕'); }
    }
    // demo theatre: now and then a lead walks over to a worker (design "lead assisting")
    if (DEMO && now > nextTheatre) {
      const leads = Object.values(rig.R).filter(r => r.a.lead && r.state === 'working');
      const lead = leads[Math.floor(Math.random() * leads.length)];
      if (lead) { const ws = Object.values(rig.R).filter(r => r.a.dept === lead.a.dept && !r.a.lead && r.state === 'working'); if (ws.length) sendLeadTo(lead, ws[Math.floor(Math.random() * ws.length)].a.id); }
      nextTheatre = now + 22000 + Math.random() * 30000;
    }
    if (rig.pm) { const pmGlow = P.screen * (rig.pm.busy ? 0.35 : 0.12); rig.pm.glow.material.opacity += (pmGlow - rig.pm.glow.material.opacity) * 0.08; }
  }
  function idleLifeFor(pm, now) {
    if (!pm.nextGlance) { pm.nextGlance = now + 3000; pm.nextStretch = now + 50000; }
    return idleLife(pm, now);
  }
  return { tick, sendLeadTo, sendPmTo, sendHome, sendToKitchen, callMeeting, screenSets, pickWorkMode };
}
