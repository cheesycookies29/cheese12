// Class attendance: one record per section per date, each student present, late, absent or excused.
import { randomUUID } from 'node:crypto';
import { HttpError, DATE_RE } from './util.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
export const ATTENDANCE = ['present', 'late', 'absent', 'excused'];

// Counts and an attendance rate (late counts as attended; excused days are left out of the rate).
export function attendanceSummary(records, studentId) {
  const s = { present: 0, late: 0, absent: 0, excused: 0 };
  for (const r of records) {
    const v = r.records[studentId];
    if (v) s[v] += 1;
  }
  const counted = s.present + s.late + s.absent;
  return { ...s, rate: counted ? Math.round(((s.present + s.late) / counted) * 100) : null };
}

export function registerAttendanceRoutes(route, ctx, { access, studentsOf }) {
  const { db, today } = ctx;
  const data = () => db.data;
  const ofSection = (sectionId) => data().attendance.filter((r) => r.sectionId === sectionId);

  route('GET', '/api/classes/:id/attendance', 'teacher', ({ user, params, query }) => {
    const a = access(user, params.id);
    const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : today().slice(0, 7);
    const all = ofSection(a.section.id);
    const students = studentsOf(a.section.id).map((e) => data().users.find((u) => u.id === e.studentId)).filter(Boolean)
      .map((u) => ({ id: u.id, name: u.name, studentNo: u.studentNo || '', summary: attendanceSummary(all, u.id) }))
      .sort((x, y) => x.name.localeCompare(y.name));
    const days = all.filter((r) => r.date.startsWith(month)).sort((x, y) => x.date.localeCompare(y.date)).map((r) => ({ date: r.date, records: r.records, takenBy: r.takenBy }));
    return { month, today: today(), students, days, sessions: all.length };
  }, { module: 'attendance' });

  route('PUT', '/api/classes/:id/attendance/:date', 'teacher', ({ user, params, body }) => {
    const a = access(user, params.id);
    if (!DATE_RE.test(params.date)) fail('Pick a date.');
    if (params.date > today()) fail('Attendance cannot be taken for a future date.');
    const ids = new Set(studentsOf(a.section.id).map((e) => e.studentId));
    const records = {};
    for (const [id, v] of Object.entries(body.records || {})) {
      if (!ids.has(id)) fail('A student in the list is not in this class.');
      if (v && !ATTENDANCE.includes(v)) fail('Attendance must be present, late, absent or excused.');
      if (v) records[id] = v;
    }
    let r = data().attendance.find((x) => x.sectionId === a.section.id && x.date === params.date);
    if (!Object.keys(records).length) {
      if (r) data().attendance.splice(data().attendance.indexOf(r), 1); // clearing everyone removes the day
    } else {
      if (!r) {
        r = { id: randomUUID(), sectionId: a.section.id, date: params.date };
        data().attendance.push(r);
      }
      Object.assign(r, { records, takenBy: user.name, updatedAt: new Date().toISOString() });
    }
    db.save();
    return { ok: true };
  }, { module: 'attendance' });

  route('GET', '/api/classes/:id/attendance/mine', 'student', ({ user, params }) => {
    const a = access(user, params.id);
    const all = ofSection(a.section.id);
    return {
      summary: attendanceSummary(all, user.id),
      days: all.filter((r) => r.records[user.id]).map((r) => ({ date: r.date, status: r.records[user.id] })).sort((x, y) => y.date.localeCompare(x.date)),
    };
  }, { module: 'attendance' });
}
