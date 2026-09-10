// Walking that respects the walls: an A* search on a grid over the floor plate. Blocked cells are
// the room walls (except their door), the glass ring of the centre office (except its openings)
// and the meeting room's glass (except its door). Paths are string-pulled so people walk in
// clean straight lines between the real turns.
import * as THREE from 'three';

export const CELL = 1.5;
export function buildNav({ bounds, rooms, centre, boxes = [] }) {
  const { minX, maxX, minZ, maxZ } = bounds;
  const W = Math.ceil((maxX - minX) / CELL) + 1, H = Math.ceil((maxZ - minZ) / CELL) + 1;
  const blocked = new Uint8Array(W * H);
  const idx = (i, j) => j * W + i;
  const toCell = (x, z) => [Math.round((x - minX) / CELL), Math.round((z - minZ) / CELL)];
  const toWorld = (i, j) => new THREE.Vector3(minX + i * CELL, 0.12, minZ + j * CELL);
  const cx = (i) => minX + i * CELL, cz = (j) => minZ + j * CELL;
  // rooms: { x, z, w, d, door: { edge: 'x'|'z', sign, width } } — the wall band is 1.2 thick, the door is open
  for (const r of rooms) {
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = cx(i), z = cz(j);
      const dx = Math.abs(x - r.x), dz = Math.abs(z - r.z);
      if (dx > r.w / 2 + 0.6 || dz > r.d / 2 + 0.6) continue; // outside
      const onX = dx > r.w / 2 - 1.3, onZ = dz > r.d / 2 - 1.3; // on the wall band
      if (!onX && !onZ) continue;
      let inDoor = false;
      if (r.door) {
        if (r.door.edge === 'x' && onX && Math.sign(x - r.x) === r.door.sign && dz < r.door.width / 2 + 0.2) inDoor = true;
        if (r.door.edge === 'z' && onZ && Math.sign(z - r.z) === r.door.sign && dx < r.door.width / 2 + 0.2) inDoor = true;
      }
      if (!inDoor) blocked[idx(i, j)] = 1;
    }
  }
  if (centre) { // the glass ring: blocked except the openings every 45°
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = cx(i) - centre.x, z = cz(j) - centre.z, d = Math.hypot(x, z);
      if (Math.abs(d - centre.r) > 1.2) continue;
      const a = Math.atan2(z, x); const k = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
      if (Math.abs(Math.atan2(Math.sin(a - k), Math.cos(a - k))) < 0.24) continue; // an opening
      blocked[idx(i, j)] = 1;
    }
  }
  for (const b of boxes) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { if (Math.abs(cx(i) - b.x) <= b.w / 2 && Math.abs(cz(j) - b.z) <= b.d / 2) blocked[idx(i, j)] = 1; }

  const free = (i, j) => i >= 0 && j >= 0 && i < W && j < H && !blocked[idx(i, j)];
  // line of sight between two cells: every cell the segment touches must be free
  function los(a, b) {
    let [x0, y0] = a; const [x1, y1] = b;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (let n = 0; n < 4000; n++) {
      if (!free(x0, y0)) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; if (!free(x0, y0) && !(x0 === x1 && y0 === y1)) return false; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
    return false;
  }
  function nearestFree(c) {
    if (free(c[0], c[1])) return c;
    for (let r = 1; r < 8; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; if (free(c[0] + di, c[1] + dj)) return [c[0] + di, c[1] + dj]; }
    return c;
  }
  function astar(start, goal) {
    const s = nearestFree(start), g = nearestFree(goal);
    const key = (i, j) => j * W + i;
    const open = new Map(); const came = new Map(); const gScore = new Map();
    const h = (i, j) => Math.hypot(i - g[0], j - g[1]);
    const sk = key(...s); gScore.set(sk, 0); open.set(sk, h(...s));
    let guard = 0;
    while (open.size && guard++ < 20000) {
      let bestK = null, bestF = Infinity; for (const [k, f] of open) if (f < bestF) { bestF = f; bestK = k; }
      open.delete(bestK);
      const ci = bestK % W, cj = Math.floor(bestK / W);
      if (ci === g[0] && cj === g[1]) { const out = [[ci, cj]]; let k = bestK; while (came.has(k)) { k = came.get(k); out.push([k % W, Math.floor(k / W)]); } return out.reverse(); }
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (!free(ni, nj)) continue;
        if (di && dj && (!free(ci + di, cj) || !free(ci, cj + dj))) continue; // no corner cutting through a wall
        const nk = key(ni, nj), ng = gScore.get(bestK) + Math.hypot(di, dj);
        if (ng < (gScore.get(nk) ?? Infinity)) { gScore.set(nk, ng); came.set(nk, bestK); open.set(nk, ng + h(ni, nj)); }
      }
    }
    return [s, g];
  }
  // route(from, to) → world waypoints after `from`, ending exactly at `to`
  function route(from, to) {
    const a = toCell(from.x, from.z), b = toCell(to.x, to.z);
    const cells = astar(a, b);
    // string pulling: keep only the corners a straight line cannot skip
    const pulled = [cells[0]]; let anchor = 0;
    for (let i = 2; i < cells.length; i++) { if (!los(cells[anchor], cells[i])) { pulled.push(cells[i - 1]); anchor = i - 1; } }
    pulled.push(cells[cells.length - 1]);
    const pts = pulled.slice(1, -1).map(([i, j]) => toWorld(i, j));
    pts.push(to.clone().setY(0.12));
    return pts;
  }
  return { route, blocked, W, H, toCell, toWorld, free };
}
// which edge of a room the door sits on: the one that faces the office centre most squarely
export function doorOf(L) {
  const [x, z] = L.pos;
  if (Math.abs(x) < 1 && Math.abs(z) < 1) return null;
  const edge = Math.abs(x) >= Math.abs(z) ? 'x' : 'z';
  const sign = edge === 'x' ? -Math.sign(x) : -Math.sign(z);
  const at = edge === 'x' ? new THREE.Vector3(x + sign * L.w / 2, 0.12, z) : new THREE.Vector3(x, 0.12, z + sign * L.d / 2);
  return { edge, sign, width: 6, at, outside: at.clone().add(new THREE.Vector3(edge === 'x' ? sign * 2.2 : 0, 0, edge === 'z' ? sign * 2.2 : 0)), inside: at.clone().add(new THREE.Vector3(edge === 'x' ? -sign * 2.2 : 0, 0, edge === 'z' ? -sign * 2.2 : 0)) };
}
