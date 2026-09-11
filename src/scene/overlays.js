// HUD overlays projected from the scene every frame: the pod cards, the desk pills, the
// Program Manager pill. Plain DOM in #hud (the task panel, rail and check script all
// address these classes), positioned by toScreen() with the same clamping rules as before.
import * as THREE from 'three';
import { rig, toScreen, pxPerWorld } from './rig.js';
import { store } from './store.js';
import { smooth, clamp } from './materials.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const STATE_WORD = { idle: 'IDLE', working: 'WORKING', planning: 'PLANNING', verifying: 'VERIFYING', reviewing: 'VERIFYING', submitted: 'SUBMITTED', done: 'DONE', blocked: 'BLOCKED', stuck: 'NEEDS YOU', helping: 'HELPING', stale: 'STALE' };
const STATE_COL = { working: '#287657', planning: '#B4830B', verifying: '#684C91', reviewing: '#684C91', submitted: '#287657', done: '#248267', blocked: '#B4830B', stuck: '#B4830B', helping: '#A08A1E', idle: '#5A5A5A', stale: '#5A5A5A' };

export function makeOverlays({ hud, DEPTS, DEPT_KEYS, AGENTS, LAYOUT, onDept, onAgent, onApproval, onBrain, onPM }) {
  const badges = {};
  /* ---------- pod cards (design 1a): name + state · N OF M WORKING · lead line · counts ---------- */
  for (const k of DEPT_KEYS) {
    const dept = DEPTS[k];
    const n = AGENTS.filter(a => a.dept === k).length;
    const lead = AGENTS.find(a => a.dept === k && a.lead);
    const b = document.createElement('div');
    b.className = 'badge';
    b.innerHTML = `
      <div class="b-name"><span class="dot" style="background:${dept.chip}"></span>${esc(dept.short)}<span class="live"></span><span class="b-state">IDLE</span></div>
      <div class="b-count"><span class="b-num">0</span><span class="b-lab">OF ${n} WORKING</span></div>
      <div class="b-lead"><span class="b-star" style="border-color:${dept.ink}">★</span><span class="b-line">${esc(lead ? lead.name : dept.name)} — free</span></div>
      <div class="b-metrics"></div>
      <div class="b-appr" style="display:none">⚠ <span class="ap-n">1</span> WAITING APPROVAL</div>`;
    b.addEventListener('click', (e) => {
      if (e.target.closest('.b-appr')) { onApproval(k); e.stopPropagation(); }
      else onDept(k);
    });
    hud.appendChild(b);
    badges[k] = b;
    const L = LAYOUT[k];
    const ANCHOR = {
      marketing: [-36, 8.6, 13.4], emails: [-30, 8.6, -32.6], delivery: [0, 10.6, -57.6], sales: [48, 8.6, -32],
      ops: [-13.5, 4, 54], fin: [43.5, 4, 17],
    };
    const std = DEPT_KEYS.length > 6 || !ANCHOR[k];
    rig.deptRT[k] = { ...(rig.deptRT[k] || {}), badge: b, apprRow: b.querySelector('.b-appr'), apprN: b.querySelector('.ap-n'),
      badgeAnchor: new THREE.Vector3(...(std ? [L.pos[0], 9, L.pos[1] - L.d / 2 - 2] : ANCHOR[k])),
      sideBadge: !std && (k === 'fin' || k === 'ops'), sideLeft: !std && k === 'ops', vals: [],
      stateEl: b.querySelector('.b-state'), numEl: b.querySelector('.b-num'), lineEl: b.querySelector('.b-line'), leadName: lead ? lead.name : dept.name, sig: '' };
  }
  /* ---------- the Brain: an icon in the top bar (design: "B BRAIN 3") ---------- */
  const brainTag = document.createElement('button');
  brainTag.type = 'button'; brainTag.className = 'badge brainTag'; brainTag.title = 'open the Brain (G)';
  brainTag.innerHTML = `<div class="b-name"><span class="dot b-b"></span>THE BRAIN<b>0</b>NOTES</div>`;
  brainTag.addEventListener('click', (e) => { e.stopPropagation(); onBrain(); });
  const bar = document.getElementById('topbar');
  if (bar) bar.insertBefore(brainTag, bar.firstChild); else hud.appendChild(brainTag);
  rig.deptRT.brain = { ...(rig.deptRT.brain || {}), badge: brainTag, apprRow: brainTag.querySelector('.b-appr') || document.createElement('div'), apprN: document.createElement('span'), vals: [] };

  /* ---------- desk pills: state tag + name + a real progress bar (design 1d) ---------- */
  const pills = {};
  for (const a of AGENTS) {
    const pill = document.createElement('div');
    pill.className = 'pill';
    pill.innerHTML = `<span class="p-row"><span class="p-tag"></span><span class="p-name">${a.lead ? '<span class="star">★</span>' : ''}<span class="p-n">${esc(a.name)}</span></span></span><span class="p-sub"></span><span class="p-bar"><i></i></span>`;
    pill.addEventListener('click', () => onAgent(a.id));
    hud.appendChild(pill);
    pills[a.id] = pill;
  }
  /* ---------- the Program Manager pill ---------- */
  const pmPill = document.createElement('div');
  pmPill.className = 'pill program-manager-pill';
  pmPill.innerHTML = `<span class="star">◆</span><span class="p-n">PROGRAM MANAGER</span><span class="pm-sep"></span><span class="pm-st"><i></i><span>FREE</span></span><span class="pm-next"></span>`;
  pmPill.addEventListener('click', () => onPM());
  hud.appendChild(pmPill);

  /* ---------- speech: a short line over someone's head for a few seconds ---------- */
  const bubbles = [];
  function say(r, text, ms = 3200) {
    if (!r || !r.person) return;
    if (r.bubble) { r.bubble.el.remove(); bubbles.splice(bubbles.indexOf(r.bubble), 1); }
    const el = document.createElement('div'); el.className = 'say'; el.textContent = text; hud.appendChild(el);
    const b = { el, r, born: performance.now(), until: performance.now() + ms }; r.bubble = b; bubbles.push(b);
  }
  function tickBubbles(now, focused, focusDim) {
    const v = new THREE.Vector3();
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      if (now > b.until) { b.el.remove(); if (b.r.bubble === b) b.r.bubble = null; bubbles.splice(i, 1); continue; }
      const p = b.r.person.position;
      const [sx, sy] = toScreen(v.set(p.x, p.y + 5.9 * (b.r.a && b.r.a.lead ? 1.12 : 1) + 1.2, p.z));
      const k = Math.min(1, (now - b.born) / 220), out = Math.min(1, (b.until - now) / 300);
      const dimmed = focused && focused !== 'brain' && b.r.a && b.r.a.dept !== focused;
      b.el.style.transform = `translate(${sx}px,${sy - 34}px) translate(-50%,-100%) scale(${0.8 + 0.2 * k})`;
      b.el.style.opacity = k * out * (dimmed ? 1 - 0.85 * focusDim : 1);
    }
  }
  function setPillState(pill, r, state, sub, pct) {
    const sig = state + '|' + sub + '|' + pct;
    if (pill.dataset.sig === sig) return;
    pill.dataset.sig = sig;
    pill.dataset.workState = state;
    pill.classList.toggle('is-working', ['working', 'planning', 'verifying', 'reviewing', 'helping'].includes(state));
    pill.classList.toggle('is-supervising', state === 'planning' || state === 'verifying' || state === 'reviewing');
    pill.classList.toggle('is-complete', state === 'done');
    pill.classList.toggle('is-submitted', state === 'submitted');
    pill.classList.toggle('is-stuck', state === 'stuck' || state === 'blocked');
    pill.classList.toggle('is-idle', state === 'idle');
    pill.style.setProperty('--sc', STATE_COL[state] || '#5A5A5A');
    pill.querySelector('.p-tag').textContent = state === 'idle' ? '' : STATE_WORD[state] || state.toUpperCase();
    pill.querySelector('.p-sub').textContent = sub || '';
    const bar = pill.querySelector('.p-bar');
    bar.style.display = pct == null ? 'none' : '';
    if (pct != null) bar.firstElementChild.style.width = Math.round(pct * 100) + '%';
    pill.title = sub ? `${r.a.name} · ${sub}` : state === 'idle' ? 'Idle · ready for a task' : r.a.name;
  }

  /* ---------- per-frame projection ---------- */
  function tick(now, focused, focusDim, live) {
    const z = rig.view.zoom;
    const badgeScale = 1.02 - 0.3 * smooth(1.2, 2.6, z);
    const rightEdge = rig.size.w - (rig.panelWidth() + 26);
    const dark = store.getState().dark;
    const placed = [];
    for (const k of DEPT_KEYS) {
      const d = rig.deptRT[k]; if (!d || !d.badge) continue;
      // the card's live numbers: N of M working, the state word, the lead line
      const rs = Object.values(rig.R).filter(r => r.a.dept === k);
      const working = rs.filter(r => ['working', 'planning', 'verifying', 'reviewing', 'helping'].includes(r.livePhase)).length;
      const stuck = rs.some(r => r.state === 'stuck' || r.livePhase === 'blocked');
      const lead = rs.find(r => r.a.lead);
      const state = stuck ? 'BLOCKED' : working ? 'WORKING' : 'IDLE';
      let line = `${d.leadName} — free`;
      if (lead) {
        if (lead.assistTarget && rig.R[lead.assistTarget]) line = `${d.leadName} → helping ${rig.R[lead.assistTarget].a.name}`;
        else if (lead.livePhase === 'planning') line = `${d.leadName} is planning`;
        else if (lead.livePhase === 'reviewing' || lead.livePhase === 'verifying') line = `${d.leadName} verifying ${lead.liveTitle || 'the team’s work'}`;
        else if (lead.livePhase === 'working') line = `${d.leadName} — ${lead.liveTitle || 'working'}`;
        else if (stuck) line = `${d.leadName} — waiting on you`;
      }
      if (rig.pm && rig.pm.target === k && rig.pm.state !== 'working') line += ' · PM ' + (rig.pm.state === 'walking' ? 'arriving' : 'here');
      const sig = state + working + line;
      if (d.sig !== sig) { d.sig = sig; d.stateEl.textContent = state; d.stateEl.style.color = state === 'BLOCKED' ? '#B4830B' : state === 'WORKING' ? '#287657' : '#5A5A5A'; d.numEl.textContent = working; d.lineEl.textContent = line; d.badge.classList.toggle('team-working', working > 0); }
      if (focused === k) { d.badge.style.display = 'none'; continue; } // docked in the rail
      d.badge.style.display = '';
      let [sx, sy] = toScreen(d.badgeAnchor);
      const bh = d.badge.offsetHeight * badgeScale, bw = d.badge.offsetWidth * badgeScale;
      // top-left placement in screen space, then clamped to the canvas and the panel's edge
      let left, top;
      if (d.sideBadge) { top = clamp(sy - bh / 2, 64, rig.size.h - bh - 8); left = d.sideLeft ? clamp(sx - bw, 8, rightEdge - bw) : clamp(sx, 8, rightEdge - bw); }
      else { top = clamp(sy - bh, 64, rig.size.h - bh - 12); left = clamp(sx - bw / 2, 8, rightEdge - bw); }
      placed.push({ d, left, top, w: bw, h: bh });
    }
    // no card may cover another team: push overlapping cards apart, lower ones first
    placed.sort((a, b) => a.top - b.top);
    for (let i = 0; i < placed.length; i++) {
      const a = placed[i];
      for (let j = 0; j < i; j++) {
        const b = placed[j];
        const ox = Math.min(a.left + a.w, b.left + b.w) - Math.max(a.left, b.left);
        const oy = Math.min(a.top + a.h, b.top + b.h) - Math.max(a.top, b.top);
        if (ox <= 0 || oy <= 0) continue;
        if (ox < oy) { // slide sideways when that is the smaller move
          const dir = a.left + a.w / 2 < b.left + b.w / 2 ? -1 : 1;
          const nx = clamp(a.left + dir * (ox + 10), 8, rightEdge - a.w);
          if (Math.abs(nx - a.left) >= ox) { a.left = nx; continue; }
        }
        const down = b.top + b.h + 10;
        a.top = down + a.h <= rig.size.h - 12 ? down : Math.max(64, b.top - a.h - 10);
      }
    }
    for (const p of placed) {
      p.d.badge.style.transform = `translate(${p.left}px,${p.top}px) scale(${badgeScale})`;
      p.d.badge.style.transformOrigin = '0 0';
      p.d.badge.style.opacity = 1 - 0.75 * focusDim;
      p.d.badge.style.pointerEvents = 'auto';
    }
    // desk pills: at every zoom, smaller when far
    const pillScale = 0.62 + 0.38 * smooth(1.2, 2.4, z);
    // A chip stays whole on the screen: it slides inward when its desk is near an edge (a phone shows only part of the office) and
    // goes when the desk itself has left the screen. The chip is shifted by (-50%,-100%) and scaled about its centre, so its box is
    // w·s wide and h·s tall, centred at (x, y - h/2). The panel covers the right side of a wide screen, the bottom of a narrow one.
    const chipRight = rightEdge > rig.size.w / 2 ? rightEdge : rig.size.w - 6;
    const whole = (el, x, y, s) => {
      if (x < -24 || x > rig.size.w + 24 || y < -24 || y > rig.size.h + 24) return null;
      const w = el.offsetWidth * s, h = el.offsetHeight * s;
      const cx = w + 12 > chipRight ? chipRight / 2 : clamp(x, 6 + w / 2, chipRight - w / 2);
      const cy = clamp(y - el.offsetHeight / 2, 64 + h / 2, rig.size.h - 6 - h / 2) + el.offsetHeight / 2;
      return [cx, cy];
    };
    const v = new THREE.Vector3();
    for (const r of Object.values(rig.R)) {
      const pill = r.pill; if (!pill) continue;
      const p = r.person.position;
      const [ax, ay] = toScreen(v.set(p.x, p.y + 5.9 * (r.a.lead ? 1.12 : 1), p.z));
      pill.style.display = 'block';
      const big = pill.classList.contains('is-supervising') || pill.classList.contains('is-stuck');
      const s = big ? Math.max(0.95, pillScale) : pillScale, at = whole(pill, ax, ay, s);
      pill.style.visibility = at ? '' : 'hidden';
      if (at) pill.style.transform = `translate(${at[0]}px,${at[1]}px) translate(-50%,-100%) scale(${s})`;
      const dimmed = focused && focused !== 'brain' && r.a.dept !== focused;
      pill.style.opacity = dimmed ? 1 - 0.85 * focusDim : 1;
      pill.classList.toggle('is-selected', store.getState().selected === r.a.id);
    }
    tickBubbles(now, focused, focusDim);
    if (rig.pm) {
      const p = rig.pm.person.position;
      const [ax, ay] = toScreen(v.set(p.x, p.y + 6.6, p.z));
      pmPill.style.display = 'block';
      const s = Math.max(0.8, pillScale), at = whole(pmPill, ax, ay, s);
      pmPill.style.visibility = at ? '' : 'hidden';
      if (at) pmPill.style.transform = `translate(${at[0]}px,${at[1]}px) translate(-50%,-100%) scale(${s})`;
      pmPill.style.opacity = focused && focused !== 'brain' ? 0.45 : 1;
      const st = rig.pm.state === 'walking' ? 'EN ROUTE → ' + (DEPTS[rig.pm.target]?.short || '') : rig.pm.state === 'returning' ? 'HEADING BACK' : rig.pm.state === 'atDesk' ? 'WITH ' + (DEPTS[rig.pm.target]?.short || '') : rig.pm.busy ? 'COORDINATING' : 'FREE · AT DESK';
      const nx = rig.pm.next ? `next: <b style="color:${DEPTS[rig.pm.next.dept]?.ink || '#5A5A5A'}">${esc(DEPTS[rig.pm.next.dept]?.short || '')}</b> · ${esc(rig.pm.next.title || '')}` : '';
      const sig = st + '|' + nx;
      if (pmPill.dataset.sig !== sig) { pmPill.dataset.sig = sig; pmPill.querySelector('.pm-st span').textContent = st; pmPill.querySelector('.pm-st').classList.toggle('on', !st.startsWith('FREE')); pmPill.querySelector('.pm-next').innerHTML = nx; pmPill.classList.toggle('is-working', !st.startsWith('FREE')); }
    }
  }
  return { badges, pills, pmPill, brainTag, setPillState, tick, say, tickBubbles };
}
