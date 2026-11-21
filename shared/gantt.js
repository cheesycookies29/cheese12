// The project's timeline as a Gantt chart in SVG (0.59): the same picture for the printed report
// and the PNG image. Pure: from the project, its tasks and the work calendar to an SVG string.
// Rows: each milestone (a diamond on its due date), then its tasks (a bar from start to due, a dot
// for a due date alone), then the tasks with no milestone. Columns: days, grouped in weeks and
// months; weekends and holidays shaded; today a red line. Bars are coloured by status category, an
// overdue one outlined in red.
import { addDays, daysBetween, weekStart, isoWeek, isWorkDay, byRank } from './projects.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const md = (ymd) => `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}`;
export const GANTT_COLORS = {
  todo: '#94a3b8', active: '#2f6fdb', done: '#1f9d55', cancelled: '#cbd5e1', late: '#c62828',
  milestone: '#5d0013', deliverable: '#c4900f', off: '#f1f5f9', today: '#c62828', grid: '#e2e8f0', text: '#1e293b', muted: '#64748b', head: '#f8fafc',
};
export const GANTT_MAX_WEEKS = 104;

// The rows, in the order the Timeline shows them.
export function ganttRows(milestones, tasks) {
  const order = (list) => list.filter((t) => !t.parentId).sort((a, b) => (a.startDate || a.dueDate || '9').localeCompare(b.startDate || b.dueDate || '9') || byRank(a, b))
    .flatMap((t) => [t, ...list.filter((s) => s.parentId === t.id).sort(byRank)])
    .concat(list.filter((t) => t.parentId && !list.some((x) => x.id === t.parentId)));
  const rows = [];
  for (const m of milestones) {
    const list = tasks.filter((t) => (t.milestoneIdEffective ?? t.milestoneId) === m.id);
    rows.push({ kind: 'milestone', m }, ...order(list).map((t) => ({ kind: 'task', t })));
  }
  const loose = tasks.filter((t) => !(t.milestoneIdEffective ?? t.milestoneId) || !milestones.some((m) => m.id === (t.milestoneIdEffective ?? t.milestoneId)));
  if (loose.length) rows.push({ kind: 'group', label: 'No milestone' }, ...order(loose).map((t) => ({ kind: 'task', t })));
  return rows;
}

// { svg, width, height, from, to, capped }. width: the whole picture's width in pixels (the days
// share what is left after the labels).
// rowStart, rowCount: a slice of the rows (a printed report splits a long schedule into pages; the
// dates across stay the same on each).
export function ganttSvg({ project, milestones = [], tasks = [], cal = { workDays: [1, 2, 3, 4, 5], off: new Set() }, today, width = 1600, rowStart = 0, rowCount = Infinity }) {
  const dates = [project.startDate, project.endDate, today, ...milestones.map((m) => m.dueDate), ...tasks.flatMap((t) => [t.startDate, t.dueDate])].filter(Boolean).sort();
  const from = weekStart(dates[0] || today);
  let to = addDays(weekStart(dates.at(-1) || today), 6);
  const capped = daysBetween(from, to) + 1 > GANTT_MAX_WEEKS * 7;
  if (capped) to = addDays(from, GANTT_MAX_WEEKS * 7 - 1);
  const days = daysBetween(from, to) + 1;
  const LABEL = 300;
  const dayW = Math.max(2, (width - LABEL - 16) / days);
  const chartW = dayW * days;
  const W = Math.ceil(LABEL + chartW + 16);
  const ROW = 22;
  const HEAD = 40;
  const allRows = ganttRows(milestones, tasks);
  const rows = allRows.slice(rowStart, rowStart + rowCount);
  const H = HEAD + rows.length * ROW + 48;
  const x = (ymd) => LABEL + daysBetween(from, ymd) * dayW;
  const inRange = (ymd) => ymd && ymd >= from && ymd <= to;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="11" role="img" aria-label="${esc(`Timeline of ${project.name}, ${md(from)} to ${md(to)}`)}">`);
  out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  // Weekends and holidays, then the week lines.
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    if (!isWorkDay(d, cal)) out.push(`<rect x="${(LABEL + i * dayW).toFixed(2)}" y="${HEAD}" width="${dayW.toFixed(2)}" height="${rows.length * ROW}" fill="${GANTT_COLORS.off}"/>`);
  }
  // Header: months on top, weeks below.
  out.push(`<rect x="0" y="0" width="${W}" height="${HEAD}" fill="${GANTT_COLORS.head}"/>`);
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    if (i === 0 || d.slice(8, 10) === '01') {
      const name = `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
      out.push(`<line x1="${x(d).toFixed(2)}" y1="0" x2="${x(d).toFixed(2)}" y2="${HEAD}" stroke="${GANTT_COLORS.grid}"/>`);
      out.push(`<text x="${(x(d) + 4).toFixed(2)}" y="14" font-weight="700" fill="${GANTT_COLORS.text}">${esc(name)}</text>`);
    }
  }
  for (let w = 0; w * 7 < days; w++) {
    const d = addDays(from, w * 7);
    const wx = x(d);
    out.push(`<line x1="${wx.toFixed(2)}" y1="20" x2="${wx.toFixed(2)}" y2="${HEAD + rows.length * ROW}" stroke="${GANTT_COLORS.grid}"/>`);
    if (dayW * 7 >= 34) out.push(`<text x="${(wx + 3).toFixed(2)}" y="33" fill="${GANTT_COLORS.muted}" font-size="10">${esc(dayW * 7 >= 58 ? `${md(d)} · W${isoWeek(d)}` : `W${isoWeek(d)}`)}</text>`);
  }
  out.push(`<line x1="0" y1="${HEAD}" x2="${W}" y2="${HEAD}" stroke="#cbd5e1"/>`);
  out.push(`<text x="10" y="33" font-weight="700" fill="${GANTT_COLORS.muted}" font-size="10">TASK</text>`);
  // Rows.
  rows.forEach((r, i) => {
    const y = HEAD + i * ROW;
    const mid = y + ROW / 2;
    if (r.kind !== 'task') out.push(`<rect x="0" y="${y}" width="${LABEL}" height="${ROW}" fill="#f8fafc"/>`);
    out.push(`<line x1="0" y1="${y + ROW}" x2="${W}" y2="${y + ROW}" stroke="#f1f5f9"/>`);
    if (r.kind === 'milestone') {
      const m = r.m;
      out.push(`<text x="10" y="${mid + 4}" font-weight="700" fill="${GANTT_COLORS.text}">${esc(clip(`◆ ${m.name}`, 44))}</text>`);
      if (inRange(m.dueDate)) {
        const cx = x(m.dueDate) + dayW / 2;
        const s = 6;
        out.push(`<path d="M${cx.toFixed(2)} ${mid - s} L${(cx + s).toFixed(2)} ${mid} L${cx.toFixed(2)} ${mid + s} L${(cx - s).toFixed(2)} ${mid} Z" fill="${m.deliverable ? GANTT_COLORS.deliverable : GANTT_COLORS.milestone}"><title>${esc(`${m.name}: due ${m.dueDate}`)}</title></path>`);
        out.push(`<text x="${(cx + s + 4).toFixed(2)}" y="${mid + 4}" fill="${GANTT_COLORS.muted}" font-size="10">${esc(md(m.dueDate))}</text>`);
      }
    } else if (r.kind === 'group') {
      out.push(`<text x="10" y="${mid + 4}" font-weight="700" fill="${GANTT_COLORS.muted}">${esc(r.label)}</text>`);
    } else {
      const t = r.t;
      const indent = t.parentId ? 26 : 14;
      out.push(`<text x="${indent}" y="${mid + 4}" fill="${GANTT_COLORS.text}"><tspan fill="${GANTT_COLORS.muted}" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="10">${esc(t.key)}</tspan> ${esc(clip(t.title, t.parentId ? 34 : 36))}</text>`);
      const cat = t.category === 'cancelled' ? 'cancelled' : t.category;
      const fill = GANTT_COLORS[cat] || GANTT_COLORS.todo;
      const stroke = t.overdue ? ` stroke="${GANTT_COLORS.late}" stroke-width="2"` : '';
      const tip = `<title>${esc(`${t.key} ${t.title}: ${t.startDate ? `${t.startDate} to ` : 'due '}${t.dueDate || '—'} · ${t.statusName || ''}${t.assigneeName ? ` · ${t.assigneeName}` : ''}`)}</title>`;
      if (t.dueDate && t.startDate && (inRange(t.startDate) || inRange(t.dueDate))) {
        const a = Math.max(LABEL, x(t.startDate < from ? from : t.startDate));
        const b = x(t.dueDate > to ? to : t.dueDate) + dayW;
        out.push(`<rect x="${a.toFixed(2)}" y="${mid - 6}" width="${Math.max(3, b - a).toFixed(2)}" height="12" rx="3" fill="${fill}"${stroke}>${tip}</rect>`);
        if (t.assigneeName && b - a > 0 && dayW * 7 >= 20) out.push(`<text x="${(b + 4).toFixed(2)}" y="${mid + 4}" fill="${GANTT_COLORS.muted}" font-size="10">${esc(clip(t.assigneeName.split(' ')[0], 14))}</text>`);
      } else if (t.dueDate && inRange(t.dueDate)) {
        const cx = x(t.dueDate) + dayW / 2;
        out.push(`<circle cx="${cx.toFixed(2)}" cy="${mid}" r="5" fill="${fill}"${stroke}>${tip}</circle>`);
      }
    }
  });
  // Today.
  if (inRange(today)) {
    const tx = x(today) + dayW / 2;
    out.push(`<line x1="${tx.toFixed(2)}" y1="${HEAD}" x2="${tx.toFixed(2)}" y2="${HEAD + rows.length * ROW + 4}" stroke="${GANTT_COLORS.today}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
    out.push(`<text x="${tx.toFixed(2)}" y="${HEAD + rows.length * ROW + 14}" text-anchor="middle" fill="${GANTT_COLORS.today}" font-size="10" font-weight="700">Today</text>`);
  }
  out.push(`<line x1="${LABEL}" y1="0" x2="${LABEL}" y2="${HEAD + rows.length * ROW}" stroke="#cbd5e1"/>`);
  // Legend.
  const ly = HEAD + rows.length * ROW + 32;
  let lx = 10;
  const item = (svg, label) => {
    out.push(svg(lx), `<text x="${lx + 18}" y="${ly + 4}" fill="${GANTT_COLORS.muted}" font-size="10">${esc(label)}</text>`);
    lx += 26 + label.length * 5.6;
  };
  item((l) => `<rect x="${l}" y="${ly - 5}" width="14" height="10" rx="2" fill="${GANTT_COLORS.todo}"/>`, 'To do');
  item((l) => `<rect x="${l}" y="${ly - 5}" width="14" height="10" rx="2" fill="${GANTT_COLORS.active}"/>`, 'In progress');
  item((l) => `<rect x="${l}" y="${ly - 5}" width="14" height="10" rx="2" fill="${GANTT_COLORS.done}"/>`, 'Done');
  item((l) => `<rect x="${l}" y="${ly - 5}" width="14" height="10" rx="2" fill="#fff" stroke="${GANTT_COLORS.late}" stroke-width="2"/>`, 'Overdue');
  item((l) => `<path d="M${l + 7} ${ly - 6} L${l + 13} ${ly} L${l + 7} ${ly + 6} L${l + 1} ${ly} Z" fill="${GANTT_COLORS.milestone}"/>`, 'Milestone');
  item((l) => `<path d="M${l + 7} ${ly - 6} L${l + 13} ${ly} L${l + 7} ${ly + 6} L${l + 1} ${ly} Z" fill="${GANTT_COLORS.deliverable}"/>`, 'Deliverable');
  item((l) => `<rect x="${l}" y="${ly - 5}" width="14" height="10" fill="${GANTT_COLORS.off}" stroke="#e2e8f0"/>`, 'Weekend or holiday');
  item((l) => `<line x1="${l + 7}" y1="${ly - 7}" x2="${l + 7}" y2="${ly + 7}" stroke="${GANTT_COLORS.today}" stroke-width="1.5" stroke-dasharray="3 2"/>`, 'Today');
  out.push('</svg>');
  return { svg: out.join(''), width: W, height: H, from, to, capped, rows: rows.length, totalRows: allRows.length };
}
