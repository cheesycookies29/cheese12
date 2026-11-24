// W1 model: home + Learn + System only, one semester, no UIS history, no People/Finance data.
// usage: node w1.mjs <demo.json> <R> <weeksOfActivity> <quizzesPerEnrollmentPerWeek> <outfile>
import fs from 'node:fs'; import { randomUUID } from 'node:crypto';
const [src, Rs, Ws, Qs, out] = process.argv.slice(2); const R = +Rs, W = +Ws, Q = +Qs;
const b = JSON.parse(fs.readFileSync(src, 'utf8'));
const cur = '8b9528fd-0b2d-4421-8bb8-8628a11b2cc8';
const drop = ['academicRecords','timeEntries','payrollRuns','employees','leaveAdjustments','payrollDeductions','leaveTypes','gradeSheets','gradeChanges','documentRequests'];
const d = {}; for (const [k, v] of Object.entries(b)) d[k] = Array.isArray(v) ? (drop.includes(k) || k.startsWith('fin') ? [] : []) : v;
for (const k of ['courses','programs','curricula','lessons','assignments','resources','announcements','news','events']) d[k] = b[k] || [];
d.users = b.users.filter(u => u.role !== 'student'); // staff once
const stu = b.users.filter(u => u.role === 'student');
const secs = b.sections.filter(s => s.termId === cur);
const enr = b.enrollments.filter(e => e.termId === cur);
const A = b.attempts[0], S = b.submissions[0], AT = b.attendance[0];
const perSecStudents = Object.keys(AT.records).length;
for (let r = 0; r < R; r++) {
  const sm = new Map(), um = new Map();
  for (const s of secs) { const id = randomUUID(); sm.set(s.id, id); d.sections.push({ ...s, id }); }
  for (const u of stu) { const id = randomUUID(); um.set(u.id, id); d.users.push({ ...u, id, username: u.username + r }); }
  for (const p of b.studentProfiles) d.studentProfiles.push({ ...p, id: randomUUID(), userId: um.get(p.userId) || p.userId });
  for (const e of enr) {
    const ne = { ...e, id: randomUUID(), studentId: um.get(e.studentId), sectionId: sm.get(e.sectionId) }; d.enrollments.push(ne);
    const n = Math.round(W * Q);
    for (let i = 0; i < n; i++) { d.attempts.push({ ...A, id: randomUUID(), studentId: ne.studentId }); d.submissions.push({ ...S, id: randomUUID(), studentId: ne.studentId }); }
  }
  for (const s of secs) for (let w = 0; w < W * 2; w++) d.attendance.push({ ...AT, id: randomUUID(), sectionId: sm.get(s.id), date: 'w' + w });
}
const t = (f) => { const s = performance.now(); const x = f(); return [x, performance.now() - s]; };
let best = Infinity, sz = 0, bc = Infinity, csz = 0;
for (let i = 0; i < 3; i++) { const [j, ms] = t(() => JSON.stringify(d, null, 2)); const [, wms] = t(() => { fs.writeFileSync(out, j); fs.renameSync(out, out + '.r'); }); best = Math.min(best, ms + wms); sz = j.length; }
for (let i = 0; i < 3; i++) { const [j, ms] = t(() => JSON.stringify(d)); const [, wms] = t(() => { fs.writeFileSync(out, j); fs.renameSync(out, out + '.r'); }); bc = Math.min(bc, ms + wms); csz = j.length; }
fs.rmSync(out + '.r', { force: true });
console.log(`R=${R} students=${R*stu.length} enr=${d.enrollments.length} attempts=${d.attempts.length} subs=${d.submissions.length} att=${d.attendance.length} | pretty ${(sz/1e6).toFixed(1)}MB save ${best.toFixed(0)}ms | compact ${(csz/1e6).toFixed(1)}MB save ${bc.toFixed(0)}ms`);
