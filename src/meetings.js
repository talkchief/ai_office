// Walk-and-talk: when work changes hands, people walk over, exchange a line or two, and go back to their desks.
// Animation only: it follows the office's events and never delays the work itself.
import * as THREE from 'three';

const SAY_MS = 2600, MAX_QUEUE = 3;
const short = text => { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > 42 ? t.slice(0, 40).trimEnd() + '…' : t; };

export function initMeetings({ R, hud, toScreen, points, reducedMotion = () => false }) {
  const queues = new Map(), bubbles = [], active = new Map(); // mover id -> meeting
  function say(anchor, text, ms = SAY_MS) {
    const el = document.createElement('div'); el.className = 'speech'; el.textContent = String(text).slice(0, 80); el.setAttribute('role', 'status');
    hud.appendChild(el); const b = { el, anchor, until: performance.now() + ms }; bubbles.push(b); return b;
  }
  const headOf = id => () => { const r = R[id]; return r ? r.person.position.clone().add(new THREE.Vector3(0, 7.4 * (r.a.lead ? 1.12 : 1), 0)) : null; };
  // Seat → step out → through the pod gates → the other person's side.
  function route(r, target) {
    const pts = [r.seat.clone(), r.stand.clone()], from = points.gates[r.a.dept], to = target.dept ? points.gates[target.dept] : null;
    if (target.dept !== r.a.dept) { if (from) pts.push(from.edge.clone(), from.centre.clone()); if (to) pts.push(to.centre.clone(), to.edge.clone()); }
    pts.push(target.spot.clone()); return pts.map(p => p.setY(0.12));
  }
  function spotNear(id) { const r = R[id]; return r ? { dept: r.a.dept, spot: r.stand.clone().add(new THREE.Vector3(1.6, 0, 1.6)) } : null; }
  // Queue a visit: `from` walks to `to` (a person id or 'ceo'), both say their line, then `from` goes back.
  function visit(from, to, lines, { holdFor = null, stay = 0 } = {}) {
    const mover = R[from]; if (!mover || document.hidden) return;
    const target = to === 'ceo' ? { dept: null, spot: points.ceo.clone() } : spotNear(to); if (!target) return;
    const q = queues.get(from) || []; if (q.length >= MAX_QUEUE) q.shift(); q.push({ to, target, lines, holdFor, stay }); queues.set(from, q);
  }
  function start(from, m) {
    const r = R[from];
    if (reducedMotion()) { say(headOf(from), m.lines[0]); if (m.lines[1] && m.to !== 'ceo') setTimeout(() => say(headOf(m.to), m.lines[1]), 900); return; }
    r.path = route(r, m.target); r.pathI = 0; r.state = 'walking';
    active.set(from, { ...m, phase: 'walk', endAt: 0 });
  }
  function release(jobId) { for (const m of active.values()) if (m.holdFor && m.holdFor === jobId) { m.holdFor = null; m.endAt = Math.min(m.endAt || Infinity, performance.now() + 800); } }
  function tick(now) {
    for (const [from, q] of queues) if (q.length && !active.has(from) && R[from]?.state === 'working') start(from, q.shift());
    for (const [from, m] of active) {
      const r = R[from];
      if (m.phase === 'walk' && r.state === 'atBrain') {
        m.phase = 'talk'; say(headOf(from), m.lines[0]);
        if (m.lines[1]) setTimeout(() => say(m.to === 'ceo' ? () => points.ceo.clone().add(new THREE.Vector3(0, 6, 0)) : headOf(m.to), m.lines[1]), 1100);
        m.endAt = m.holdFor ? Infinity : now + Math.max(3200, m.stay);
      }
      if (m.phase === 'talk' && now > m.endAt) {
        r.path = [...r.path].reverse(); r.path[r.path.length - 1] = r.seat.clone(); r.pathI = 0; r.state = 'returning'; m.phase = 'back';
      }
      if (m.phase === 'back' && r.state === 'working') active.delete(from);
    }
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i], at = b.anchor();
      if (now > b.until || !at) { b.el.remove(); bubbles.splice(i, 1); continue; }
      const [x, y] = toScreen(at); b.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`;
      b.el.style.opacity = Math.min(1, (b.until - now) / 400);
    }
  }
  // The office's events, turned into visits.
  function onTaskEvent(event, lookup) {
    const job = lookup(event.id), title = short(job?.title || event.message);
    if (event.type === 'run_finished' && event.role === 'specialist') { const lead = lookup.leadOf(event.agent); if (lead) visit(event.agent, lead, [`Here’s ${short(event.message) || 'my part'}.`, 'Thanks, I’ll review it now.']); }
    else if (event.type === 'review_recorded' && event.agent) visit(event.agent, 'pm', event.approved ? ['Approved. It’s ready to close.', 'Great, closing it now.'] : ['It needs another pass.', 'Understood.']);
    else if (['decision_requested', 'question', 'escalated'].includes(event.type)) visit('pm', 'ceo', [event.type === 'decision_requested' ? `I need your decision on ${title}.` : `A question on ${title}.`], { holdFor: event.id });
    else if (event.type === 'completed') visit('pm', 'ceo', [`Done: ${title}.`]);
  }
  return { visit, release, tick, onTaskEvent, busy: id => active.has(id) };
}
