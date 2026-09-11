// The milestone flow chart on the project page: one box per milestone, in columns by what it waits for, arrows for the
// dependencies, each box in the colour of its own state. Pure: milestones and the project's tasks in, an SVG string out.
import { dependsOn, readyMilestones, layers, tasksOf, milestoneState, STATE_WORD } from '../milestones.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = (value, max) => { const s = String(value ?? ''); return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s; };
const day = ms => ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
export const BOX = { w: 176, h: 46, gapX: 56, gapY: 14, pad: 8 };

// Where each milestone sits: its column is its layer, its row its place in that column.
export function flowLayout(milestones = []) {
  const depth = layers(milestones), columns = [];
  for (const m of milestones) { const d = depth.get(m.id) || 0; (columns[d] ||= []).push(m); }
  const pos = new Map();
  columns.forEach((column, x) => column.forEach((m, y) => pos.set(m.id, { x: BOX.pad + x * (BOX.w + BOX.gapX), y: BOX.pad + y * (BOX.h + BOX.gapY) })));
  const width = BOX.pad * 2 + columns.length * BOX.w + Math.max(0, columns.length - 1) * BOX.gapX;
  const height = BOX.pad * 2 + Math.max(1, ...columns.map(c => c.length)) * (BOX.h + BOX.gapY) - BOX.gapY;
  return { columns, pos, width, height };
}

export function flowSVG(milestones = [], tasks = []) {
  if (!milestones.length) return '';
  const { pos, width, height } = flowLayout(milestones);
  const ready = readyMilestones(milestones), readyIds = new Set(ready.map(m => m.id)), first = ready[0] || null;
  const nodes = milestones.map(m => {
    const own = tasksOf(milestones, m, tasks, { first }), state = milestoneState(m, own, readyIds.has(m.id)), { x, y } = pos.get(m.id);
    const facts = [STATE_WORD[state], own.length ? `${own.filter(t => t.state === 'done').length}/${own.length} tasks` : '', m.dueAt ? day(m.dueAt) : ''].filter(Boolean).join(' · ');
    return `<g class="mf-node ${state}" transform="translate(${x},${y})"><title>${esc(m.title)} — ${esc(facts)}</title><rect class="mf-box" width="${BOX.w}" height="${BOX.h}" rx="8"/><text class="mf-title" x="12" y="19">${esc(short(m.title, 26))}</text><text class="mf-sub" x="12" y="34">${esc(short(facts, 34))}</text></g>`;
  });
  const edges = milestones.flatMap(m => dependsOn(milestones, m).map(id => {
    const a = pos.get(id), b = pos.get(m.id); if (!a || !b) return '';
    const x1 = a.x + BOX.w, y1 = a.y + BOX.h / 2, x2 = b.x - 2, y2 = b.y + BOX.h / 2, cx = (x1 + x2) / 2;
    return `<path class="mf-edge" d="M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}" marker-end="url(#mf-arrow)"/>`;
  }));
  return `<svg class="mf" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Milestone flow"><defs><marker id="mf-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path class="mf-arrow" d="M0,0 L8,4 L0,8 z"/></marker></defs>${edges.join('')}${nodes.join('')}</svg>`;
}
