// CUSTOM APP → events: the room as data (US-031, AC-205/206). An event's room is a grid of round
// tables: { rows, cols, chairsPerTable, stageSide, boothSide, numbering: 'from-stage' }. YEP 2026 is
// { 5, 5, 10, 'right', 'left' }: 25 tables of 10, 250 chairs. Nothing about a particular ballroom is
// in code; a second event with another room needs none.
//
// Numbering from the stage: the column (or row) nearest the stage holds tables 1, 2, 3…, top to
// bottom (or left to right), the next one the next numbers, and so on away from the stage. Chairs
// are numbered 1 to chairsPerTable clockwise, starting with the chair that faces the stage. The
// printable plan, the exports and (Tier 1) the room plan all use these numbers.
import { HARD_LIMIT, STAGE_SIDES } from './statuses.js';

export const ROOM_LIMITS = Object.freeze({ rows: 20, cols: 20 });
export const DEFAULT_ROOM = Object.freeze({ rows: 5, cols: 5, chairsPerTable: 10, stageSide: 'right', boothSide: 'left', numbering: 'from-stage' });
const OPPOSITE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };

// A room as stored, or a message saying what is wrong.
export function cleanRoom(input) {
  const r = input && typeof input === 'object' ? input : {};
  const int = (v, lo, hi, what) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${what} must be a whole number from ${lo} to ${hi}.`);
    return n;
  };
  const rows = int(r.rows, 1, ROOM_LIMITS.rows, 'Rows of tables');
  const cols = int(r.cols, 1, ROOM_LIMITS.cols, 'Columns of tables');
  const chairsPerTable = int(r.chairsPerTable, 1, HARD_LIMIT, 'Chairs per table');
  const stageSide = STAGE_SIDES.includes(r.stageSide) ? r.stageSide : (() => { throw new Error('Choose the side of the room the stage is on.'); })();
  const boothSide = STAGE_SIDES.includes(r.boothSide) ? r.boothSide : OPPOSITE[stageSide];
  if (boothSide === stageSide) throw new Error('The tech booth cannot be on the same side as the stage.');
  return { rows, cols, chairsPerTable, stageSide, boothSide, numbering: 'from-stage' };
}

export const roomCapacity = (room) => room.rows * room.cols * room.chairsPerTable;

// Every table of the room: { number, row, col } (row 0 at the top, col 0 at the left), by number.
export function roomTables(room) {
  const out = [];
  const { rows, cols, stageSide } = room;
  if (stageSide === 'left' || stageSide === 'right') {
    for (let k = 0; k < cols; k++) {
      const col = stageSide === 'right' ? cols - 1 - k : k;
      for (let row = 0; row < rows; row++) out.push({ number: k * rows + row + 1, row, col });
    }
  } else {
    for (let k = 0; k < rows; k++) {
      const row = stageSide === 'top' ? k : rows - 1 - k;
      for (let col = 0; col < cols; col++) out.push({ number: k * cols + col + 1, row, col });
    }
  }
  return out;
}

// The angle of chair `n` (1 = facing the stage) around a table, in degrees on the screen: 0 points
// right, 90 down (screen coordinates), so increasing angles run clockwise as seen on the plan.
const FACING = { right: 0, bottom: 90, left: 180, top: 270 };
export function chairAngle(room, n) {
  return (FACING[room.stageSide] + ((n - 1) * 360) / room.chairsPerTable) % 360;
}

// Where the room is drawn (the room plan on screen and the printed plan use the same drawing, so a
// chair has the same place on paper as on the screen): { w, h, rows, cols, pos: Map(tableId → [x, y]),
// stage, booth } in drawing units. Tables without a place (added by hand) go in a row below the room.
export const ROOM_DRAW = Object.freeze({ colW: 160, rowH: 124, tableR: 30, chairD: 47, chairR: 9.5, zone: 110, edge: 24 });
export function roomGeometry(room, tables) {
  const G = ROOM_DRAW;
  const rows = room?.rows || Math.max(1, ...tables.map((t) => (t.row ?? 0) + 1));
  const cols = room?.cols || Math.max(1, ...tables.map((t) => (t.col ?? 0) + 1));
  const sides = new Set([room?.stageSide || 'right', room?.boothSide || 'left']);
  const m = { left: sides.has('left') ? G.zone : G.edge, right: sides.has('right') ? G.zone : G.edge, top: sides.has('top') ? G.zone : G.edge, bottom: sides.has('bottom') ? G.zone : G.edge };
  const w = m.left + cols * G.colW + m.right;
  const h = m.top + rows * G.rowH + m.bottom;
  let extra = 0;
  const pos = new Map();
  for (const t of tables) {
    if (t.row != null && t.col != null) pos.set(t.id, [m.left + G.colW / 2 + t.col * G.colW, m.top + G.rowH / 2 + t.row * G.rowH]);
  }
  const loose = tables.filter((t) => !pos.has(t.id));
  loose.forEach((t, i) => pos.set(t.id, [m.left + G.colW / 2 + (i % cols) * G.colW, h + G.rowH / 2 + Math.floor(i / cols) * G.rowH]));
  if (loose.length) extra = Math.ceil(loose.length / cols) * G.rowH;
  const zone = (side, kind) => {
    const long = kind === 'stage';
    if (side === 'left' || side === 'right') {
      const zh = long ? h - 60 : Math.min(180, h - 60);
      return { x: side === 'left' ? 14 : w - m.right + 26, y: (h - zh) / 2, w: long ? 70 : 72, h: zh, rot: side === 'left' ? -90 : 90 };
    }
    const zw = long ? w - 60 : Math.min(200, w - 60);
    return { x: (w - zw) / 2, y: side === 'top' ? 14 : h - m.bottom + 26, w: zw, h: long ? 70 : 72, rot: 0 };
  };
  return { w, h: h + extra, rows, cols, pos, stage: zone(room?.stageSide || 'right', 'stage'), booth: zone(room?.boothSide || 'left', 'booth') };
}
// Where chair n of a table drawn at (x, y) is.
export function chairPoint(room, capacity, n, x, y) {
  const a = (chairAngle(room || { stageSide: 'right', chairsPerTable: capacity }, n) * Math.PI) / 180;
  return [x + ROOM_DRAW.chairD * Math.cos(a), y + ROOM_DRAW.chairD * Math.sin(a)];
}
