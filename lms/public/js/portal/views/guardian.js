// Parents & guardians: the students linked to them, and for each student only what the
// registrar shared (enrollment, schedule, grades, attendance, activities). Read-only.
// Also the students' side: who is linked to them and what each can see.
import { api } from '../../api.js';
import { html, mount, empty, fmtDate, fmtDateTime, timeAgo, dueText, initials, badge, statusBadge, option } from '../../ui.js';
import { pageHead, ctx } from '../../shell.js';
import { icon } from '../../icons.js';
import { GUARDIAN_VIEWS } from '/shared/guardians.js';
import { classLabel, gradeText } from '../common.js';
import { timetable } from './schedule.js';

const VIEW = Object.fromEntries(GUARDIAN_VIEWS.map((v) => [v.id, v]));
const TAB_ICON = { overview: 'home', enrollment: 'clipboard', schedule: 'calendar', grades: 'chart', attendance: 'check', activities: 'task' };
const ALERT = { info: ['info', 'info'], warn: ['warn', 'flag'], bad: ['danger', 'flag'] };
const pct = (n) => (n == null ? '—' : `${n}%`);

const studentLine = (s) => [s.program ? `${s.program.code} · Year ${s.yearLevel}` : `Year ${s.yearLevel}`, s.studentNo, s.campusName].filter(Boolean).join(' · ');
const viewChips = (views) => (views.length
  ? html`<div class="chips small-chips">${views.map((id) => html`<span class="chip static">${VIEW[id].label}</span>`)}</div>`
  : html`<p class="hint">Nothing shared yet. The registrar's office chooses what you can see.</p>`);
const alertList = (alerts) => (alerts.length
  ? html`<div class="list">${alerts.map((a) => html`<div class="list-item"><span class="item-ic ${ALERT[a.kind][0]}">${icon(ALERT[a.kind][1], 16)}</span><span class="grow">${a.text}</span></div>`)}</div>`
  : '');

// Figures for one student, from whatever the link shares.
function figures(c) {
  const out = [];
  if (c.average !== undefined) out.push(['Running grade', pct(c.average), 'across classes this term']);
  if (c.attendance) out.push(['Attendance', pct(c.attendance.rate), `${c.attendance.absent} absent · ${c.attendance.late} late`]);
  if (c.enrollment) out.push(['Enrolled', `${c.enrollment.units} units`, `${c.enrollment.classes} class${c.enrollment.classes === 1 ? '' : 'es'}${c.enrollment.pending ? ` · ${c.enrollment.pending} pending` : ''}`]);
  if (c.activities) out.push(['Activities', `${c.activities.due} due`, c.activities.missing + c.activities.overdue ? `${c.activities.missing + c.activities.overdue} past due, not handed in` : 'nothing past due']);
  return out.length ? html`<div class="stats small">${out.map(([l, v, s]) => html`<div><small>${l}</small><strong>${v}</strong><span class="muted small">${s}</span></div>`)}</div>` : '';
}

export async function guardianHomeView(el) {
  const children = await api.get('/api/guardian/children');
  const hour = new Date().getHours();
  mount(el, html`
    ${pageHead(`${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, ${ctx.user.name.split(' ')[0]}`, ctx.info.branding.termName ? `${ctx.info.branding.termName} · your students at ${ctx.info.branding.schoolName}` : `Your students at ${ctx.info.branding.schoolName}`)}
    ${children.length ? html`<div class="guardian-cards">${children.map((c) => html`
      <section class="card child-card">
        <div class="child-head">
          <span class="avatar lg">${initials(c.student.name)}</span>
          <div class="grow"><h2>${c.student.name}</h2><p class="muted small">${studentLine(c.student)}</p></div>
          ${badge(c.relationship, 'brand')}
        </div>
        ${figures(c)}
        ${alertList(c.alerts)}
        <div class="child-foot">${viewChips(c.views)}<a class="btn primary" href="#/children/${c.student.id}">${icon('chevronRight', 16)} Open</a></div>
      </section>`)}</div>`
      : empty('No students linked to your account yet', 'The registrar’s office links your account to your student and chooses what you can follow. Contact them if you expected to see someone here.')}
    <p class="hint" style="margin-top:14px">${icon('lock', 14)} You can follow, not change, these records. Students can see that you are linked to them.</p>`);
}

const ACT_STATE = {
  scored: (a) => badge(`Scored ${a.score}/${a.points}`, 'green'),
  'handed-in': (a) => badge(a.late ? 'Handed in late' : 'Handed in', 'blue'),
  'to-grade': () => badge('Handed in · being checked', 'blue'),
  due: (a) => badge(a.dueAt ? dueText(a.dueAt) : 'Open', 'amber'),
  overdue: () => badge('Past due · late work accepted', 'red'),
  missing: () => badge('Missing', 'red'),
  'not-open': (a) => badge(a.opensAt ? `Opens ${fmtDateTime(a.opensAt)}` : 'Not open yet', 'gray'),
};

const TABS = {
  overview(d) {
    const s = d.summary;
    const classes = d.schedule || d.enrollment?.filter((e) => ['enrolled', 'completed'].includes(e.status)).map((e) => e.section) || d.grades?.filter((g) => g.class.term.id === d.termId).map((g) => g.class) || [];
    return html`
      ${figures(s)}
      ${s.alerts.length ? html`<section class="card"><h2>${icon('flag')} Worth a look</h2>${alertList(s.alerts)}</section>` : html`<div class="notice ok">${icon('checkCircle')}<p>Nothing needs attention this term.</p></div>`}
      ${classes.length ? html`<section class="card"><h2>${icon('book')} Classes this term</h2><div class="list">${classes.map((c) => html`<div class="list-item"><span class="item-ic">${icon('book', 16)}</span><span class="grow"><strong>${classLabel(c)} · ${c.course.title}</strong><small>${c.schedule || 'Schedule to be arranged'}${c.teacher ? ` · ${c.teacher.name}` : ''}${c.room ? ` · ${c.room}` : ''}</small></span></div>`)}</div></section>` : ''}
      <section class="card"><h2>${icon('lock')} What you can see</h2>${viewChips(d.views)}<p class="hint" style="margin-top:8px">Shared by the registrar’s office. Ask them to change it.</p></section>`;
  },
  enrollment(d) {
    if (!d.enrollment.length) return empty('No enrollment this term', 'No requests or classes for this term yet.');
    return html`<div class="card scroll-x"><table class="table">
      <thead><tr><th>Class</th><th>Schedule</th><th>Units</th><th>Status</th><th>Updated</th></tr></thead>
      <tbody>${d.enrollment.map((e) => html`<tr>
        <td><strong>${classLabel(e.section)}</strong><small>${e.section.course.title}${e.section.teacher ? ` · ${e.section.teacher.name}` : ''}</small></td>
        <td>${e.section.schedule || 'To be arranged'}${e.section.room ? html`<small>${e.section.room}</small>` : ''}</td>
        <td>${e.section.course.units}</td>
        <td>${statusBadge(e.status, e.statusLabel)}${e.position ? html`<small>#${e.position} on the waitlist</small>` : ''}${e.history.at(-1)?.note ? html`<small>${e.history.at(-1).note}</small>` : ''}</td>
        <td>${fmtDate((e.updatedAt || e.createdAt).slice(0, 10))}</td></tr>`)}</tbody>
      <tfoot><tr><td><strong>Enrolled units</strong></td><td></td><td><strong>${d.enrollment.filter((e) => ['enrolled', 'completed'].includes(e.status)).reduce((n, e) => n + e.section.course.units, 0)}</strong></td><td colspan="2"></td></tr></tfoot>
    </table></div>`;
  },
  schedule: (d) => timetable(d.schedule, { link: null }),
  grades(d) {
    if (!d.grades.length) return empty('No grades yet', 'Grades appear once the student is in a class.');
    const terms = [...new Set(d.grades.map((g) => g.class.term.name))];
    return html`${terms.map((t) => html`<h3>${t}</h3><div class="card scroll-x"><table class="table">
      <thead><tr><th>Class</th><th>Teacher</th><th>Running grade</th><th>Work done</th><th>Final grade</th></tr></thead>
      <tbody>${d.grades.filter((g) => g.class.term.name === t).map((g) => html`<tr>
        <td><strong>${classLabel(g.class)}</strong><small>${g.class.course.title} · ${g.class.course.units} units</small></td>
        <td>${g.class.teacher?.name || '—'}</td>
        <td><strong class="${g.percent != null && g.percent < d.passingGrade ? 'negative' : ''}">${pct(g.percent)}</strong></td>
        <td>${g.total ? `${g.done} of ${g.total}` : '—'}</td>
        <td>${gradeText(g.finalGrade, g.passed)}</td></tr>`)}</tbody>
    </table></div>`)}
    <p class="hint">The running grade counts scored work so far, weighted as the school sets. Passing: ${d.passingGrade}%. Teachers post the final grade.</p>`;
  },
  attendance(d) {
    if (!d.attendance.length) return empty('No classes this term', '');
    return html`<div class="cols">${d.attendance.map((a) => html`<section class="card">
      <div class="card-head"><h2>${classLabel(a.class)}</h2><strong>${pct(a.summary.rate)}</strong></div>
      <p class="muted small">${a.class.course.title} · ${a.summary.present} present · ${a.summary.late} late · ${a.summary.absent} absent · ${a.summary.excused} excused</p>
      ${a.days.length ? html`<div class="list">${a.days.slice(0, 8).map((x) => html`<div class="list-item"><span class="att-dot ${x.status}">${x.status[0].toUpperCase()}</span><span class="grow">${fmtDate(x.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>${statusBadge(x.status === 'absent' ? 'rejected' : x.status === 'late' ? 'pending' : 'completed', x.status)}</div>`)}</div>`
        : html`<p class="hint">${a.summary.present ? 'Present at every class taken so far.' : 'No attendance taken yet.'}</p>`}
    </section>`)}</div><p class="hint">Late counts as attended; excused days are left out of the rate.</p>`;
  },
  activities(d) {
    if (!d.activities.some((c) => c.items.length)) return empty('No activities yet', 'Assignments, quizzes and exams appear here once the teacher publishes them.');
    return html`${d.activities.filter((c) => c.items.length).map((c) => html`<section class="card">
      <h2>${classLabel(c.class)} <span class="muted small">${c.class.course.title}</span></h2>
      <div class="list">${c.items.map((a) => html`<div class="list-item"><span class="item-ic ${a.state === 'missing' || a.state === 'overdue' ? 'danger' : a.state === 'scored' ? 'ok' : ''}">${icon(a.kind === 'quiz' ? 'quiz' : 'task', 16)}</span>
        <span class="grow"><strong>${a.title}</strong><small>${[a.type, `${a.points} pts`, a.dueAt ? `due ${fmtDateTime(a.dueAt)}` : '', a.submittedAt ? `handed in ${timeAgo(a.submittedAt)}` : ''].filter(Boolean).join(' · ')}</small></span>
        ${ACT_STATE[a.state](a)}</div>`)}</div>
    </section>`)}`;
  },
};

export async function childView(el, { id, tab }, query) {
  const d = await api.get(`/api/guardian/children/${id}${query.termId ? `?termId=${query.termId}` : ''}`);
  const tabs = ['overview', ...d.views];
  const active = tabs.includes(tab) ? tab : 'overview';
  const qs = query.termId ? `?termId=${query.termId}` : '';
  const label = (t) => (t === 'overview' ? 'Overview' : VIEW[t].label);
  mount(el, html`
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/home">Your students</a>${icon('chevronRight', 14)}<span class="cur">${d.student.name}</span></nav>
    <section class="card child-card">
      <div class="child-head">
        <span class="avatar lg">${initials(d.student.name)}</span>
        <div class="grow"><h1 style="margin:0">${d.student.name}</h1><p class="muted small">${studentLine(d.student)}${d.student.program ? ` · ${d.student.program.name}` : ''}</p></div>
        ${badge(d.relationship, 'brand')}
      </div>
      ${d.terms.length > 1 && active !== 'grades' ? html`<label class="field" style="max-width:320px;margin-top:10px"><span>Term</span><select id="term">${d.terms.map((t) => option(t.id, `${t.name}${t.current ? ' (current)' : ''}`, t.id === d.termId))}</select></label>` : ''}
    </section>
    <nav class="tabs" style="margin-top:16px">${tabs.map((t) => html`<a href="#/children/${id}/${t}${qs}" class="${t === active ? 'active' : ''}">${icon(TAB_ICON[t], 16)} ${label(t)}</a>`)}</nav>
    <div>${TABS[active](d)}</div>`);
  el.querySelector('#term')?.addEventListener('change', (e) => (location.hash = `#/children/${id}/${active}?termId=${e.target.value}`));
}

// Students: who is linked to them, and what each can see.
export async function myGuardiansView(el) {
  const list = await api.get('/api/my/guardians');
  mount(el, html`
    ${pageHead('Parents & guardians', 'People the registrar’s office has linked to your records, and what each of them can see. They can look, not change anything.')}
    ${list.length ? html`<div class="cols">${list.map((g) => html`<section class="card">
      <div class="child-head"><span class="avatar">${initials(g.name)}</span><div class="grow"><h2 style="margin:0">${g.name}</h2><p class="muted small">${g.relationship}${g.active ? '' : ' · account disabled'}</p></div></div>
      <p class="small" style="margin:12px 0 6px"><strong>Can see</strong></p>${viewChips(g.views)}
      <p class="hint" style="margin-top:10px">${g.lastViewedAt ? `Last looked ${timeAgo(g.lastViewedAt)}.` : 'Has not looked yet.'}</p>
    </section>`)}</div>`
      : empty('No one is linked to your records', 'If a parent or guardian should follow your enrollment and grades, the registrar’s office can link their account.')}
    <p class="hint" style="margin-top:14px">To change who can see your records, or what they see, contact the registrar’s office.</p>`);
}
