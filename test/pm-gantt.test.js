// The Timeline's export (0.59): the Gantt chart in SVG behind the printed report and the PNG image.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ganttSvg, ganttRows, GANTT_MAX_WEEKS } from '../shared/gantt.js';

const cal = { workDays: [1, 2, 3, 4, 5], off: new Set(['2026-11-30']) };
const project = { name: 'Learning <management> & co', startDate: '2026-10-01', endDate: '2026-12-31' };
const milestones = [{ id: 'm1', name: 'Build', dueDate: '2026-11-26' }, { id: 'm2', name: 'Go-live', dueDate: '2027-01-05', deliverable: true }];
const tasks = [
  { id: 't1', key: 'LEA-1', title: 'Design', startDate: '2026-10-05', dueDate: '2026-10-20', milestoneIdEffective: 'm1', category: 'done', statusName: 'Done', assigneeName: 'Juan Dela Cruz' },
  { id: 't2', key: 'LEA-2', title: 'Import <script>alert(1)</script>', startDate: '2026-11-09', dueDate: '2026-11-18', milestoneIdEffective: 'm1', category: 'active', statusName: 'In progress', overdue: true },
  { id: 't3', key: 'LEA-3', title: 'Subtask', parentId: 't2', dueDate: '2026-11-17', milestoneIdEffective: 'm1', category: 'todo', statusName: 'To do' },
  { id: 't4', key: 'LEA-4', title: 'Weekly report', dueDate: '2026-12-04', category: 'todo', statusName: 'To do' },
];

test('rows: each milestone with its tasks (subtasks under their task), then the rest', () => {
  assert.deepEqual(ganttRows(milestones, tasks).map((r) => r.kind === 'task' ? r.t.key : r.kind === 'milestone' ? `◆${r.m.name}` : r.label), ['◆Build', 'LEA-1', 'LEA-2', 'LEA-3', '◆Go-live', 'No milestone', 'LEA-4']);
});

test('the SVG: whole weeks, bars and dots, milestones, today, weekends, nothing unescaped', () => {
  const g = ganttSvg({ project, milestones, tasks, cal, today: '2026-11-21', width: 1600 });
  assert.equal(g.from, '2026-09-28', 'starts on a Monday');
  assert.equal(g.to, '2027-01-10', 'ends on a Sunday');
  assert.equal(g.width, 1600);
  assert.equal(g.rows, 7);
  assert.match(g.svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.ok(g.svg.endsWith('</svg>'));
  assert.ok(!g.svg.includes('<script>'), 'titles are escaped');
  assert.match(g.svg, /Learning &lt;management&gt; &amp; co/);
  assert.equal((g.svg.match(/<rect [^>]*rx="3"/g) || []).length, 2, 'a bar for each task with a start and a due date');
  assert.equal((g.svg.match(/<circle /g) || []).length, 2, 'a dot for a due date alone');
  assert.match(g.svg, /stroke="#c62828" stroke-width="2"/, 'overdue outlined');
  assert.match(g.svg, /fill="#c4900f"><title>Go-live: due 2027-01-05/, 'a deliverable in gold');
  assert.match(g.svg, />Today</);
  assert.match(g.svg, />Nov 2026</);
  assert.match(g.svg, /W48/);
  // Well formed: every tag that opens (and does not close itself) is closed.
  for (const tag of ['svg', 'text', 'tspan', 'title', 'path', 'rect', 'circle', 'line']) {
    const opens = (g.svg.match(new RegExp(`<${tag}\\b`, 'g')) || []).length;
    const selfClosed = (g.svg.match(new RegExp(`<${tag}\\b[^>]*/>`, 'g')) || []).length;
    const closes = (g.svg.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    assert.equal(opens - selfClosed, closes, tag);
  }
});

test('a long schedule: slices for pages with the same dates, and at most two years', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `x${i}`, key: `LEA-${i + 1}`, title: `Task ${i + 1}`, startDate: '2026-10-05', dueDate: '2026-10-09', category: 'todo', statusName: 'To do' }));
  const a = ganttSvg({ project, tasks: many, cal, today: '2026-11-21', rowStart: 0, rowCount: 26 });
  const b = ganttSvg({ project, tasks: many, cal, today: '2026-11-21', rowStart: 52, rowCount: 26 });
  assert.equal(a.totalRows, 61);
  assert.equal(a.rows, 26);
  assert.equal(b.rows, 9);
  assert.deepEqual([a.from, a.to], [b.from, b.to]);
  const long = ganttSvg({ project: { name: 'Long', startDate: '2026-01-05', endDate: '2030-01-01' }, tasks: [], cal, today: '2026-11-21' });
  assert.equal(long.capped, true);
  assert.equal(long.to, '2028-01-02', `${GANTT_MAX_WEEKS} weeks from the start`);
});

test('the Timeline offers the report and the image', () => {
  const view = fs.readFileSync(new URL('../public/js/views/projects.js', import.meta.url), 'utf8');
  assert.match(view, /data-export="report"/);
  assert.match(view, /data-export="png"/);
  assert.match(view, /function printTimeline\(p, tasks\)/);
  assert.match(view, /canvas\.toBlob/);
  assert.match(fs.readFileSync(new URL('../public/css/styles.css', import.meta.url), 'utf8'), /@page gantt \{ size: A4 landscape;/);
});
