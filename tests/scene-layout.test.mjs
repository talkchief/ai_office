import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT, DEPT_KEYS, podCols, podRows, podSize, deskOffset, spreadRooms, DESK_X, DESK_Z } from '../src/data.js';

// A team's room, with the room's solid furniture allowance: a desk, its chair and its person reach about 3.6 units from
// the desk's point, and must stay at least that far inside the walls.
const REACH = 3.6;
const deskPoints = count => {
  const cols = podCols(count), rows = podRows(count, cols), size = podSize(count), pts = [];
  pts.push(deskOffset([(cols - 1) / 2, 0], cols, rows)); // the lead
  for (let i = 1; i < count; i++) pts.push(deskOffset([(i - 1) % cols, 1 + Math.floor((i - 1) / cols)], cols, rows));
  return { cols, rows, size, pts };
};

test('a team of any size gets a room its desks fit in: more columns as it grows, rows centred front to back', () => {
  assert.deepEqual([2, 8, 9, 14, 15, 20].map(podCols), [2, 2, 3, 3, 4, 4]);
  assert.deepEqual([1, 2, 5, 7, 8, 20].map(n => podRows(n)), [1, 2, 3, 4, 5, 6]);
  for (let count = 1; count <= 24; count++) {
    const { size, pts } = deskPoints(count);
    for (const [x, z] of pts) {
      assert.ok(Math.abs(x) + REACH <= size.w / 2, `${count} people: a desk at x ${x} passes the side wall of a ${size.w}-wide room`);
      assert.ok(Math.abs(z) + REACH <= size.d / 2, `${count} people: a desk at z ${z} passes a wall of a ${size.d}-deep room`);
    }
  }
});

test('a team of up to seven keeps exactly the desk places it always had', () => {
  // Before rows were centred the formula was ((row − 1) · 6.4 − 1); four rows (a lead and up to six people in two columns) must not move.
  for (let row = 0; row < 4; row++) assert.equal(+deskOffset([0, row], 2, 4)[1].toFixed(6), +((row - 1) * DESK_Z - 1).toFixed(6));
  assert.equal(deskOffset([0.5, 0], 2, 4)[0], 0, 'the lead is centred across');
  assert.equal(DESK_X, 8.6);
});

test('rooms that grew are moved apart until they clear each other and the centre; rooms that already clear stay put', () => {
  const clash = (a, b, gap = 8) => Math.abs(a.pos[0] - b.pos[0]) < (a.w + b.w) / 2 + gap && Math.abs(a.pos[1] - b.pos[1]) < (a.d + b.d) / 2 + gap;
  // The standard six rooms at their live size do not move.
  const standard = Object.fromEntries(Object.entries(LAYOUT).map(([k, L]) => [k, { ...L, pos: [...L.pos], ...(k === 'brain' ? {} : podSize(7)) }]));
  const before = JSON.stringify(Object.fromEntries(DEPT_KEYS.map(k => [k, standard[k].pos])));
  spreadRooms(standard, DEPT_KEYS);
  assert.equal(JSON.stringify(Object.fromEntries(DEPT_KEYS.map(k => [k, standard[k].pos]))), before, 'the standard office keeps its plan');
  // Ten teams of very different sizes on a ring: none overlaps another or the Program Manager's office.
  const sizes = [20, 15, 14, 12, 9, 8, 7, 5, 3, 2], keys = sizes.map((_, i) => 't' + i);
  const ring = { brain: { pos: [0, 0], w: 16, d: 16 }, ...Object.fromEntries(keys.map((k, i) => { const a = i * 2 * Math.PI / keys.length; return [k, { pos: [Math.sin(a) * 75, Math.cos(a) * 75], ...podSize(sizes[i]) }]; })) };
  spreadRooms(ring, keys);
  for (let i = 0; i < keys.length; i++) {
    assert.ok(!clash(ring[keys[i]], ring.brain), `${keys[i]} runs into the centre`);
    for (let j = i + 1; j < keys.length; j++) assert.ok(!clash(ring[keys[i]], ring[keys[j]]), `${keys[i]} runs into ${keys[j]}`);
  }
  // Two rooms crowded onto the same spot are pulled apart too.
  const crowded = { brain: { pos: [0, 0], w: 16, d: 16 }, a: { pos: [30, 0], ...podSize(20) }, b: { pos: [31, 2], ...podSize(20) } };
  spreadRooms(crowded, ['a', 'b']);
  assert.ok(!clash(crowded.a, crowded.b) && !clash(crowded.a, crowded.brain) && !clash(crowded.b, crowded.brain));
});
