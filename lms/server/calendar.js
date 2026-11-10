// The school calendar (Learn → Calendar; Admin panel → School calendar).
// One list of dated entries, built for each person from what ATLAS already knows:
//  - school events, holidays, exams and meetings (Admin panel), for their campus and their kind of account;
//  - term dates: classes begin and end, the enrollment window, the last day to drop;
//  - their class meetings (a teacher's sections, a student's classes), left out on days without classes;
//  - due dates of activities and quizzes in their classes, with where the student stands.
// Parents & guardians see the same for each linked student, as far as the link allows.
// A private address (a token) gives the same entries as an iCalendar feed (RFC 5545), for
// Google Calendar, Outlook or a phone. After Moodle's and Canvas's calendars and their iCal feeds.
import { randomBytes } from 'node:crypto';
import { HttpError, DATE_RE, localDate } from './util.js';
import { findById } from './enrollment.js';
import { campusName } from './campus.js';
import { moduleOn } from '../shared/modules.js';
import { GUARDIAN_VIEWS } from '../shared/guardians.js';
import { categoryLabel, kindOfEvent, forAudience, addDays, weekday, eachDay, daysBetween, KINDS } from '../shared/calendar.js';
import { guardianChildren } from './guardian.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
// Classes a student is in. A request still waiting for approval is not a class yet: its meetings
// and due dates would open pages the student cannot use.
const IN_CLASS = ['enrolled', 'completed'];
const MAX_DAYS = 125;

export function registerCalendarRoutes(route, ctx, { resultFor, isOpen }) {
  const { db } = ctx;
  const data = () => db.data;
  const save = () => db.save();

  // ----- Building blocks -----
  const here = (campusIds) => (e) => e.campusId == null || campusIds.includes(e.campusId);
  const overlaps = (a1, a2, b1, b2) => a1 <= b2 && b1 <= a2;

  // School events for these campuses and this kind of account, in the range.
  function schoolEvents(campusIds, role, start, end) {
    return data().events
      .filter(here(campusIds))
      .filter((e) => role === 'admin' || forAudience(e, role))
      .filter((e) => overlaps(e.startDate, e.endDate || e.startDate, start, end))
      .map((e) => ({
        id: `event-${e.id}`, eventId: e.id, kind: kindOfEvent(e), category: e.category || 'event', categoryLabel: categoryLabel(e.category),
        title: e.title, date: e.startDate, endDate: e.endDate || e.startDate, startTime: e.startTime || '', endTime: e.endTime || '',
        location: e.location || '', description: e.description || '', noClasses: Boolean(e.noClasses || e.category === 'holiday'),
        audience: e.audience || [], campusName: e.campusId ? campusName(data(), e.campusId) : 'All campuses', updatedAt: e.updatedAt || e.createdAt || null,
      }));
  }
  // Days without classes (holidays, suspensions) for a campus.
  const noClassDays = (campusIds, start, end) => {
    const days = new Set();
    for (const e of data().events.filter(here(campusIds)).filter((x) => x.noClasses || x.category === 'holiday')) {
      for (const d of eachDay(e.startDate < start ? start : e.startDate, (e.endDate || e.startDate) > end ? end : e.endDate || e.startDate)) days.add(d);
    }
    return days;
  };

  // Term dates in the range (archived terms are left out).
  function termDates(start, end, { student = true } = {}) {
    const out = [];
    for (const t of data().terms.filter((x) => x.status !== 'archived')) {
      const add = (date, title, extra = {}) => date && date >= start && date <= end && out.push({ id: `term-${t.id}-${title}`, kind: 'term', title, date, endDate: date, startTime: '', endTime: '', sub: t.name, termId: t.id, ...extra });
      add(t.startDate, 'Classes begin');
      add(t.endDate, 'Last day of classes');
      if (student) {
        add(t.enrollStart, 'Enrollment opens', { href: '#/enroll' });
        add(t.enrollEnd, 'Enrollment closes', { href: '#/enroll' });
        add(t.dropDeadline, 'Last day to drop a class');
      }
    }
    return out;
  }

  // Class meetings of these sections on each day of the range, within their term, except days without classes.
  function classMeetings(sections, start, end, skip, extra = () => ({})) {
    const out = [];
    for (const s of sections) {
      const term = findById(data().terms, s.termId);
      if (!term?.startDate || !term.endDate || !s.meetings?.length) continue;
      const course = findById(data().courses, s.courseId) || {};
      const from = term.startDate > start ? term.startDate : start;
      const to = term.endDate < end ? term.endDate : end;
      if (from > to) continue;
      for (const day of eachDay(from, to)) {
        if (skip.has(day)) continue;
        for (const m of s.meetings.filter((x) => x.day === weekday(day))) {
          out.push({
            id: `class-${s.id}-${day}-${m.start}`, kind: 'class', sectionId: s.id, title: `${course.code || ''} ${s.name}`.trim(), sub: course.title || '',
            date: day, endDate: day, startTime: m.start, endTime: m.end, location: s.room || '', href: `#/classes/${s.id}`, ...extra(s),
          });
        }
      }
    }
    return out;
  }

  // Activities and quizzes due in these sections. studentId: their state (done, missing, due).
  function dueDates(sections, start, end, studentId, extra = () => ({})) {
    const ids = new Set(sections.map((s) => s.id));
    const now = ctx.nowLocal();
    return data().assignments
      .filter((a) => ids.has(a.sectionId) && a.published && a.dueAt && a.dueAt.slice(0, 10) >= start && a.dueAt.slice(0, 10) <= end)
      .map((a) => {
        const s = findById(data().sections, a.sectionId);
        const course = findById(data().courses, s.courseId) || {};
        let state = null;
        if (studentId) {
          const r = resultFor(a, studentId);
          state = r.score != null || r.submitted ? 'done' : now > a.dueAt ? (isOpen(a) ? 'overdue' : 'missing') : 'due';
        }
        return {
          id: `due-${a.id}${studentId ? `-${studentId}` : ''}`, kind: 'due', assignmentId: a.id, activityKind: a.kind || 'task',
          title: a.title, sub: `${course.code || ''} ${s.name}`.trim(), date: a.dueAt.slice(0, 10), endDate: a.dueAt.slice(0, 10),
          startTime: a.dueAt.slice(11, 16), endTime: '', dueTime: true, state, href: a.kind === 'quiz' ? `#/quizzes/${a.id}` : `#/assignments/${a.id}`, ...extra(s, a),
        };
      });
  }

  const sectionsOfStudent = (studentId) => data().enrollments
    .filter((e) => e.studentId === studentId && IN_CLASS.includes(e.status))
    .map((e) => findById(data().sections, e.sectionId)).filter((s) => s && s.status !== 'cancelled');
  const sectionsOfTeacher = (teacherId) => data().sections.filter((s) => s.teacherId === teacherId && s.status !== 'cancelled');

  // Everything one person sees from start to end (inclusive). child: for a guardian, one linked student's id (or all).
  function entriesFor(user, start, end, { child = '', campusId = null } = {}) {
    const d = data();
    const on = (m) => moduleOn(d.modules, m, user.role);
    const out = [];
    if (user.role === 'guardian') {
      const kids = guardianChildren(d, user.id).filter(({ student }) => !child || child === 'all' || student.id === child);
      const viewOn = (link, id) => Boolean(link.views?.[id]) && moduleOn(d.modules, GUARDIAN_VIEWS.find((v) => v.id === id).module, 'guardian');
      const campuses = [...new Set(kids.flatMap(({ student }) => student.campusIds || []))];
      out.push(...schoolEvents(campuses, 'guardian', start, end), ...termDates(start, end));
      for (const { link, student } of kids) {
        const tag = () => ({ childId: student.id, childName: student.name.split(' ')[0] });
        const sections = sectionsOfStudent(student.id);
        if (viewOn(link, 'schedule')) out.push(...classMeetings(sections, start, end, noClassDays(student.campusIds || [], start, end), (s) => ({ ...tag(s), href: `#/children/${student.id}/schedule` })));
        if (viewOn(link, 'activities')) out.push(...dueDates(sections, start, end, student.id, () => ({ ...tag(), href: `#/children/${student.id}/activities` })));
      }
    } else {
      const campuses = user.role === 'student' ? user.campusIds || [] : [campusId || user.campusIds?.[0]].filter(Boolean);
      out.push(...schoolEvents(campuses, user.role, start, end), ...termDates(start, end, { student: user.role === 'student' }));
      const sections = user.role === 'teacher' ? sectionsOfTeacher(user.id).filter((s) => !campusId || s.campusId === campusId) : sectionsOfStudent(user.id);
      if (on('schedule')) out.push(...classMeetings(sections, start, end, noClassDays(campuses, start, end)));
      if (on('assignments')) out.push(...dueDates(sections, start, end, user.role === 'student' ? user.id : null));
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || '').localeCompare(b.startTime || '') || a.title.localeCompare(b.title));
  }

  const range = (query) => {
    const start = String(query.start || '');
    const end = String(query.end || '');
    if (!DATE_RE.test(start) || !DATE_RE.test(end) || end < start) fail('Give the dates to show (start and end).');
    if (daysBetween(start, end) > MAX_DAYS) fail(`Show at most ${MAX_DAYS} days at a time.`);
    return { start, end };
  };

  // ----- Learn: students, teachers, parents & guardians -----
  route('GET', '/api/calendar', 'portal', ({ user, query, campusId }) => {
    const { start, end } = range(query);
    const kids = user.role === 'guardian' ? guardianChildren(data(), user.id).map(({ student }) => ({ id: student.id, name: student.name })) : undefined;
    const child = kids ? (kids.some((k) => k.id === query.child) ? query.child : 'all') : '';
    return { start, end, today: localDate(ctx.now()), kinds: KINDS, children: kids, child, entries: entriesFor(user, start, end, { child, campusId }) };
  }, { module: 'calendar', guardians: true });

  // The private calendar address (one per person; a new one stops the old one working).
  const feedUrl = (origin, token) => `${origin}/api/calendar/feed/${token}.ics`;
  route('GET', '/api/calendar/subscription', 'portal', ({ user, origin }) => ({ url: user.calendarToken ? feedUrl(origin, user.calendarToken) : null }), { module: 'calendar', guardians: true });
  route('POST', '/api/calendar/subscription', 'portal', ({ user, origin }) => {
    user.calendarToken = randomBytes(24).toString('hex');
    save();
    return { url: feedUrl(origin, user.calendarToken) };
  }, { module: 'calendar', guardians: true });
  route('DELETE', '/api/calendar/subscription', 'portal', ({ user }) => {
    delete user.calendarToken;
    save();
    return { url: null };
  }, { module: 'calendar', guardians: true });

  route('GET', '/api/calendar/feed/:file', 'public', ({ params, origin }) => {
    const token = String(params.file).replace(/\.ics$/, '');
    const user = /^[0-9a-f]{48}$/.test(token) && data().users.find((u) => u.calendarToken === token && u.status === 'active');
    if (!user || !moduleOn(data().modules, 'calendar', user.role)) fail('This calendar address is not in use. Copy a new one from Calendar in ATLAS Learn.', 404);
    const today = localDate(ctx.now());
    const entries = entriesFor(user, addDays(today, -30), addDays(today, 180), { child: 'all' });
    return { raw: toIcs(entries, { name: `${data().settings.schoolName} · ${user.name}`, now: ctx.now(), domain: new URL(origin || 'http://atlas.invalid').hostname }), type: 'text/calendar; charset=utf-8', headers: { 'Cache-Control': 'no-store', 'Content-Disposition': 'inline; filename="atlas-calendar.ics"' } };
  }, { limit: 'lookup' });

  // ----- Admin panel: the school calendar of the campus, to plan events on -----
  route('GET', '/api/admin/calendar', 'admin', ({ query, campusId }) => {
    const { start, end } = range(query);
    const entries = [...schoolEvents([campusId], 'admin', start, end), ...termDates(start, end)]
      .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || '').localeCompare(b.startTime || ''));
    return { start, end, today: localDate(ctx.now()), kinds: KINDS.filter((k) => !['class', 'due'].includes(k.id)), entries };
  });

  return { entriesFor };
}

// ----- iCalendar (RFC 5545) -----
// Any line break (CRLF, LF or a lone CR) becomes \n, and other control characters are dropped,
// so a title cannot start a new calendar property.
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
// Lines are folded at 75 octets (continuation lines start with a space).
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, 'utf8') > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = '';
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateValue = (ymd) => ymd.replace(/-/g, '');
const timeValue = (ymd, hhmm) => `${dateValue(ymd)}T${hhmm.replace(':', '')}00`;
const plusMinutes = (hhmm, n) => {
  const t = Math.min(23 * 60 + 59, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) + n);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

export function toIcs(entries, { name, now = new Date(), domain = 'atlas.invalid' }) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lancaster//ATLAS School Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`, 'X-WR-TIMEZONE:Asia/Manila', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H',
    // The Philippines has one offset and no daylight saving time.
    'BEGIN:VTIMEZONE', 'TZID:Asia/Manila', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0800', 'TZOFFSETTO:+0800', 'TZNAME:PST', 'END:STANDARD', 'END:VTIMEZONE',
  ];
  for (const e of entries) {
    const timed = Boolean(e.startTime);
    const who = e.childName ? `${e.childName}: ` : '';
    const summary = e.kind === 'due' ? `${who}Due: ${e.title}${e.sub ? ` (${e.sub})` : ''}` : `${who}${e.title}`;
    const desc = [e.sub && e.kind !== 'due' ? e.sub : '', e.categoryLabel && e.kind !== 'class' ? e.categoryLabel : '', e.description].filter(Boolean).join('\n');
    // UIDs stay the same each time the feed is built, so calendars update entries instead of adding new ones.
    lines.push('BEGIN:VEVENT', `UID:${e.id}${e.childId && !e.id.includes(e.childId) ? `-${e.childId}` : ''}@${domain}`, `DTSTAMP:${stamp(e.updatedAt ? new Date(e.updatedAt) : now)}`);
    if (timed) {
      lines.push(`DTSTART;TZID=Asia/Manila:${timeValue(e.date, e.startTime)}`);
      lines.push(`DTEND;TZID=Asia/Manila:${timeValue(e.endDate || e.date, e.endTime || plusMinutes(e.startTime, e.dueTime ? 15 : 60))}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${dateValue(e.date)}`, `DTEND;VALUE=DATE:${dateValue(addDays(e.endDate || e.date, 1))}`); // the end of an all-day event is the next day
    }
    lines.push(`SUMMARY:${esc(summary)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
    // Class meetings make you busy; reminders, due dates and all-day school dates do not.
    lines.push(`CATEGORIES:${esc(KINDS.find((k) => k.id === e.kind)?.label || 'School')}`, `TRANSP:${e.kind === 'class' ? 'OPAQUE' : 'TRANSPARENT'}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

