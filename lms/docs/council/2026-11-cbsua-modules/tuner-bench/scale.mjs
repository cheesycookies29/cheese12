import { memoryDb } from '/home/user/cheese12/lms/server/db.js';
import { setPasswordCost } from '/home/user/cheese12/lms/server/auth.js';
import { createApi } from '/home/user/cheese12/lms/server/api.js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
setPasswordCost(10);
const R = Number(process.argv[2] || 100); // replicas of the demo student body / sections
const base = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const d = structuredClone(base);
const students = base.users.filter(u => u.role === 'student');
const secMap = []; // per replica: old section id -> new id
for (let r = 1; r < R; r++) {
  const m = new Map();
  for (const s of base.sections) { const id = randomUUID(); m.set(s.id, id); d.sections.push({ ...s, id, name: s.name + '-' + r }); }
  const um = new Map();
  for (const u of students) { const id = randomUUID(); um.set(u.id, id); d.users.push({ ...u, id, username: u.username + r, studentNo: (u.studentNo||'') + 'x' + r }); }
  for (const e of base.enrollments) if (um.has(e.studentId)) d.enrollments.push({ ...e, id: randomUUID(), studentId: um.get(e.studentId), sectionId: m.get(e.sectionId) || e.sectionId, history: e.history });
  for (const a of base.academicRecords) if (um.has(a.studentId)) d.academicRecords.push({ ...a, id: randomUUID(), studentId: um.get(a.studentId), sectionId: m.get(a.sectionId) || a.sectionId });
  for (const p of base.studentProfiles) if (um.has(p.userId || p.studentId)) d.studentProfiles.push({ ...p, id: randomUUID() });
}
const db = memoryDb(d);
const api = createApi(db, { clock: () => new Date('2026-08-10T10:00:00'), sealAtStart: false, rateLimits: 'off' });
const jar = {};
const call = async (method, path, body = {}) => {
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await api({ method, headers: { cookie } }, new URL(`http://localhost${path}`), body);
  for (const set of [res.headers?.['Set-Cookie'] || []].flat()) { const [pair] = set.split(';'); const [k, v] = pair.split('='); if (v) jar[k] = v; }
  return res.data;
};
const t = async (label, fn) => { const s = performance.now(); const out = await fn(); console.log(label.padEnd(44), (performance.now() - s).toFixed(1), 'ms'); return out; };
const D = db.data;
console.log(`R=${R} users=${D.users.length} students=${D.users.filter(u=>u.role==='student').length} sections=${D.sections.length} enrollments=${D.enrollments.length} academicRecords=${D.academicRecords.length}`);
let json; await t('JSON.stringify(pretty)', () => { json = JSON.stringify(D, null, 2); });
console.log('  size MB', (json.length / 1e6).toFixed(1));
await t('writeFileSync+rename', () => { fs.writeFileSync(process.argv[3] + '.out', json); fs.renameSync(process.argv[3] + '.out', process.argv[3] + '.out2'); });
await t('JSON.parse', () => JSON.parse(json));
await t('structuredClone(enrollments)', () => structuredClone(D.enrollments));
await call('POST', '/api/auth/login', { username: 'student.demo', password: 'demo1234' });
const cat = await t('GET /api/enrollment/catalog (1 student)', () => call('GET', '/api/enrollment/catalog'));
console.log('  catalog sections', cat?.sections?.length);
await t('GET /api/enrollment/mine', () => call('GET', '/api/enrollment/mine'));
const open = cat.sections.find(s => !s.mine && s.eligibility.ok);
if (open) await t('POST /api/enrollment (memoryDb, no save)', () => call('POST', '/api/enrollment', { sectionId: open.id }).catch(e => e.message));
const j2 = {}; for (const k in jar) delete jar[k];
await call('POST', '/api/admin/auth/login', { username: process.env.ADM, password: 'demo1234' }).catch(e => console.log('admin login', e.message));
await t('GET /api/admin/enrollments/summary', () => call('GET', '/api/admin/enrollments/summary').catch(e => e.message));
await t('GET /api/admin/enrollments?status=pending', () => call('GET', '/api/admin/enrollments?status=pending').then(x => x?.length).catch(e => e.message));
fs.rmSync(process.argv[3] + '.out2', { force: true });
await t('registrar GET /api/hub/figures', () => call('GET', '/api/hub/figures').catch(e => e.message));
await t('registrar GET /api/academic/dashboard', () => call('GET', '/api/academic/dashboard').catch(e => e.message));
for (const k in jar) delete jar[k];
await call('POST', '/api/auth/login', { username: 'student.demo', password: 'demo1234' });
await t('student GET /api/home', () => call('GET', '/api/home').catch(e => e.message));
await t('student GET /api/hub/figures', () => call('GET', '/api/hub/figures').catch(e => e.message));
for (const k in jar) delete jar[k];
await call('POST', '/api/auth/login', { username: 'teacher.demo', password: 'demo1234' });
await t('teacher GET /api/home', () => call('GET', '/api/home').catch(e => e.message));
const h = await call('GET', '/api/home').catch(()=>null);
const sid = h?.classes?.[0]?.id; if (sid) await t('teacher GET gradebook-ish /api/sections/:id', () => call('GET', '/api/sections/'+sid).catch(e => e.message));
