// The plantilla register in People (HRIS request PL-014, with PL-045, PL-052 and PL-027): items as DBM
// issued them, incumbents read from their records, the migration from the free-text item number,
// salaries from the salary schedule, filters, totals, the CSV, the PSIPOP, the permission, the audit
// log and the link to recruitment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';
import { memoryDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { ROLES, HRIS_PERMISSION_LABELS } from '../shared/roles.js';
import { salaryFor } from '../shared/gov-pay.js';
import { PSIPOP_COLUMNS, filterItems, plantillaTotals, plantillaCsv, normalizeItemNo } from '../shared/plantilla.js';
import { addDemo } from '../server/demo.js';

const PW = 'password123';
const status = (code) => (err) => err.status === code;
const DATE = '2026-11-03';

async function school() {
  const env = setup({ today: DATE });
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const main = (await admin.get('/api/admin/campuses'))[0];
  const signIn = async (username) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password: PW });
    return c;
  };
  const employee = (extra = {}) => admin.post('/api/hris/employees', {
    firstName: 'Nora', lastName: 'Staff', gender: 'Female', birthDate: '1990-04-02', hireDate: '2020-01-06', payType: 'monthly', rate: 26100,
    position: 'Clerk', department: 'Registrar', tin: '123-456-789-000', gsisNo: '2001234567', appointment: 'Permanent', employmentStatus: 'Permanent', ...extra,
  });
  const hrEmp = await employee({ firstName: 'Hana', lastName: 'Reyes', position: 'HRMO III', salaryGrade: 18, step: 1 });
  await admin.post(`/api/hris/employees/${hrEmp.id}/account`, { role: 'hr', username: 'hana', password: PW, mustChangePassword: false });
  const payEmp = await employee({ firstName: 'Pia', lastName: 'Pay', position: 'Accountant II' });
  await admin.post(`/api/hris/employees/${payEmp.id}/account`, { role: 'payroll', username: 'pia', password: PW, mustChangePassword: false });
  const staffEmp = await employee({ firstName: 'Sol', lastName: 'Staff', position: 'Clerk' });
  await admin.post(`/api/hris/employees/${staffEmp.id}/account`, { role: 'staff', username: 'sol', password: PW, mustChangePassword: false });
  const hr = await signIn('hana');
  const item = (extra = {}) => hr.post('/api/hris/plantilla', { itemNo: 'INST1-001', positionTitle: 'Instructor I', salaryGrade: 12, office: 'College of Computing', fundCluster: '01', dateCreated: '2026-01-02', authority: 'DBM approval as recorded', ...extra });
  const trail = () => env.api.audit.entries().filter((e) => e.action.startsWith('Plantilla: '));
  return { env, admin, main, signIn, employee, hr, hrEmp, payEmp, staffEmp, item, trail, data: env.db.data };
}

test('item numbers: required, unique (whatever the case or spacing), as typed; never made up', async () => {
  const s = await school();
  await assert.rejects(s.item({ itemNo: '' }), /Item number is required/);
  await assert.rejects(s.item({ positionTitle: '' }), /Position title is required/);
  await assert.rejects(s.item({ salaryGrade: 40 }), /Salary grade must be 1 to 33/);
  const a = await s.item({ itemNo: '  OSEC-DBMB-INST1-270001-2026 ' });
  assert.equal(a.itemNo, 'OSEC-DBMB-INST1-270001-2026');
  assert.equal(a.status, 'vacant');
  await assert.rejects(s.item({ itemNo: 'osec-dbmb-inst1-270001-2026' }), (e) => e.status === 409 && /already in the register/.test(e.message));
  const b = await s.item({ itemNo: 'INST1-002' });
  await assert.rejects(s.hr.put(`/api/hris/plantilla/${b.id}`, { itemNo: 'OSEC-DBMB-INST1-270001-2026' }), /unique/);
  assert.equal(normalizeItemNo(' a  b '), 'A B');
  // Only Vacant, Unfunded or Abolished by hand: Filled comes from linking.
  await assert.rejects(s.item({ itemNo: 'X-1', status: 'filled' }), /linking its incumbent/);
  // A fund cluster Finance uses, and an office from Finance's list when one is picked (PL-045).
  await assert.rejects(s.item({ itemNo: 'X-2', fundCluster: '02' }), /not one of the fund clusters in use/);
  await assert.rejects(s.item({ itemNo: 'X-3', officeCode: 'NOPE' }), /not in Finance's list/);
  await s.admin.put('/api/finance/settings', { offices: [{ code: 'CCS', name: 'College of Computing Studies' }], paps: [{ code: '310100100001000', name: 'Higher Education Program' }] });
  const c = await s.item({ itemNo: 'X-4', officeCode: 'CCS', pap: '310100100001000', fundCluster: '05' });
  assert.equal(c.officeName, 'College of Computing Studies');
  assert.equal(c.papName, 'Higher Education Program');
  assert.equal(c.fundName, 'Internally Generated Funds');
  await assert.rejects(s.item({ itemNo: 'X-5', pap: '999' }), /not in Finance's list/);
});

test('incumbents: linking fills, unlinking vacates; one item each way; job orders are not on the plantilla', async () => {
  const s = await school();
  const a = await s.item();
  const b = await s.item({ itemNo: 'INST1-002' });
  const nora = await s.employee({ firstName: 'Nora', lastName: 'Santos', middleName: 'Cruz', salaryGrade: 12, step: 3, position: 'Instructor I' });
  const filled = await s.hr.post(`/api/hris/plantilla/${a.id}/incumbent`, { employeeId: nora.id });
  assert.equal(filled.status, 'filled');
  assert.equal(filled.incumbent.name, 'Santos, Nora Cruz');
  // The employee record carries the item's number (payslips and the General Payroll print it).
  const rec = await s.hr.get(`/api/hris/employees/${nora.id}`);
  assert.equal(rec.plantillaItem, 'INST1-001');
  assert.equal(rec.plantilla.id, a.id);
  // One employee holds one item; one item has one incumbent.
  await assert.rejects(s.hr.post(`/api/hris/plantilla/${b.id}/incumbent`, { employeeId: nora.id }), /already holds item INST1-001/);
  const leo = await s.employee({ firstName: 'Leo', lastName: 'Lim' });
  await assert.rejects(s.hr.post(`/api/hris/plantilla/${a.id}/incumbent`, { employeeId: leo.id }), /held by Nora Santos/);
  // Job orders and contracts of service are not on the plantilla (and are not offered).
  const jo = await s.employee({ firstName: 'Jo', lastName: 'Order', appointment: 'Job order', employmentStatus: 'Job order', payType: 'daily', rate: 600 });
  await assert.rejects(s.hr.post(`/api/hris/plantilla/${b.id}/incumbent`, { employeeId: jo.id }), /not on the plantilla/);
  assert.ok(!(await s.hr.get('/api/hris/plantilla/linkable')).some((e) => e.id === jo.id || e.id === nora.id));
  // A holder cannot become a job order without unlinking first.
  await assert.rejects(s.hr.put(`/api/hris/employees/${nora.id}`, { appointment: 'Job order', employmentStatus: 'Job order' }), /holds plantilla item INST1-001/);
  // An unfunded item cannot be filled; nor can a filled item be set to another status by hand.
  const u = await s.item({ itemNo: 'U-1', status: 'unfunded' });
  await assert.rejects(s.hr.post(`/api/hris/plantilla/${u.id}/incumbent`, { employeeId: leo.id }), /unfunded/);
  await assert.rejects(s.hr.put(`/api/hris/plantilla/${a.id}`, { status: 'vacant' }), /unlink them first/);
  // Unlinking: Vacant, and the record no longer names the item.
  const vacant = await s.hr.del(`/api/hris/plantilla/${a.id}/incumbent`);
  assert.equal(vacant.status, 'vacant');
  assert.equal(vacant.incumbent, null);
  assert.equal((await s.hr.get(`/api/hris/employees/${nora.id}`)).plantillaItem, '');
  // From the employee record: the picker offers vacant items (and the one held), and links.
  const choices = await s.hr.get(`/api/hris/plantilla/choices?employeeId=${nora.id}`);
  assert.deepEqual(choices.map((c) => c.itemNo).sort(), ['INST1-001', 'INST1-002']);
  await s.hr.put(`/api/hris/employees/${nora.id}`, { plantillaItemId: b.id });
  assert.equal(s.data.plantillaItems.find((i) => i.id === b.id).incumbentId, nora.id);
  assert.equal((await s.hr.get(`/api/hris/employees/${nora.id}`)).plantillaItem, 'INST1-002');
  // Renumbering the item changes what the record (and so new payslips) show.
  await s.hr.put(`/api/hris/plantilla/${b.id}`, { itemNo: 'INST1-002A' });
  assert.equal((await s.hr.get(`/api/hris/employees/${nora.id}`)).plantillaItem, 'INST1-002A');
  await s.hr.put(`/api/hris/employees/${nora.id}`, { plantillaItemId: '' });
  assert.equal(s.data.plantillaItems.find((i) => i.id === b.id).status, 'vacant');
  // Deleting an employee record vacates their item.
  await s.hr.post(`/api/hris/plantilla/${a.id}/incumbent`, { employeeId: leo.id });
  await s.admin.del(`/api/hris/employees/${leo.id}`);
  assert.equal(s.data.plantillaItems.find((i) => i.id === a.id).status, 'vacant');
});

test('PL-052: linking an item never changes the appointment status, salary grade or step', async () => {
  const s = await school();
  const a = await s.item();
  const temp = await s.employee({ firstName: 'Tess', lastName: 'Temp', appointment: 'Temporary', employmentStatus: 'Temporary', salaryGrade: 11, step: 2 });
  const before = structuredClone(s.data.employees.find((e) => e.id === temp.id));
  const view = await s.hr.post(`/api/hris/plantilla/${a.id}/incumbent`, { employeeId: temp.id });
  const after = s.data.employees.find((e) => e.id === temp.id);
  assert.equal(after.appointment, 'Temporary');
  assert.equal(after.employmentStatus, 'Temporary');
  const without = ({ plantillaItem: _no, ...rest }) => rest;
  assert.deepEqual(without(after), without(before)); // only the item number changed
  assert.equal(after.plantillaItem, 'INST1-001');
  assert.equal(view.incumbent.appointment, 'Temporary');
  // The incumbent's own grade (11-2) gives the actual salary; the item's (12) the authorized one.
  assert.equal(view.incumbent.actualAnnual, salaryFor(11, 2, DATE) * 12);
  assert.equal(view.authorized.amount, salaryFor(12, 1, DATE) * 12);
  // Through the employee form too.
  const b = await s.item({ itemNo: 'INST1-002' });
  const cas = await s.employee({ firstName: 'Cas', lastName: 'Ual', appointment: 'Casual', employmentStatus: 'Casual' });
  await s.hr.put(`/api/hris/employees/${cas.id}`, { plantillaItemId: b.id, appointment: 'Casual', employmentStatus: 'Casual' });
  assert.equal(s.data.employees.find((e) => e.id === cas.id).appointment, 'Casual');
});

test('the incumbent is read from the record, never copied: a change on the record shows at once', async () => {
  const s = await school();
  const a = await s.item();
  const nora = await s.employee({ firstName: 'Nora', lastName: 'Santos', salaryGrade: 12, step: 1 });
  await s.hr.post(`/api/hris/plantilla/${a.id}/incumbent`, { employeeId: nora.id });
  const stored = s.data.plantillaItems.find((i) => i.id === a.id);
  for (const k of ['lastName', 'tin', 'gsisNo', 'birthDate', 'appointment', 'name']) assert.ok(!(k in stored), `${k} is not stored on the item`);
  await s.hr.put(`/api/hris/employees/${nora.id}`, { lastName: 'Santos-Reyes', tin: '999-888-777-000', step: 4 });
  const v = await s.hr.get(`/api/hris/plantilla/${a.id}`);
  assert.equal(v.incumbent.lastName, 'Santos-Reyes');
  assert.equal(v.incumbent.tin, '999-888-777-000');
  assert.equal(v.incumbent.sex, 'Female');
  assert.equal(v.incumbent.gsisNo, '2001234567');
  assert.equal(v.incumbent.originalAppointment, '2020-01-06'); // the record's date hired
  assert.equal(v.incumbent.lastPromotion, ''); // the record has no such date: blank
  assert.equal(v.incumbent.eligibility, ''); // nor eligibility
  assert.equal(v.incumbent.actualAnnual, salaryFor(12, 4, DATE) * 12);
});

test('salaries: authorized = salaryFor(SG, step 1) × 12 from the schedule in force; a typed amount needs a reason', async () => {
  const s = await school();
  const a = await s.item({ salaryGrade: 15 });
  assert.equal(a.authorized.step, 1);
  assert.equal(a.authorized.amount, salaryFor(15, 1, DATE) * 12);
  assert.equal(a.authorized.override, null);
  // Next year's schedule (EO 64 fourth tranche) on the PSIPOP "as of" a date in it.
  const next = await s.hr.get(`/api/hris/plantilla/${a.id}?asOf=2027-02-01`);
  assert.equal(next.authorized.amount, salaryFor(15, 1, '2027-02-01') * 12);
  assert.notEqual(next.authorized.amount, a.authorized.amount);
  await assert.rejects(s.hr.put(`/api/hris/plantilla/${a.id}`, { overrideAmount: 500000 }), /Say why/);
  await assert.rejects(s.hr.put(`/api/hris/plantilla/${a.id}`, { overrideAmount: -1, overrideReason: 'x' }), /more than zero/);
  const o = await s.hr.put(`/api/hris/plantilla/${a.id}`, { overrideAmount: 500000, overrideReason: 'As on the approved item (salary standardization adjustment)' });
  assert.equal(o.authorized.amount, 500000);
  assert.equal(o.authorized.computed, salaryFor(15, 1, DATE) * 12);
  assert.equal(o.authorized.override.reason, 'As on the approved item (salary standardization adjustment)');
  assert.equal(o.authorized.override.by, 'Hana Reyes');
  const cleared = await s.hr.put(`/api/hris/plantilla/${a.id}`, { overrideAmount: '' });
  assert.equal(cleared.authorized.amount, salaryFor(15, 1, DATE) * 12);
});

test('migration: typed item numbers move into the register, matched by number or as drafts to review; nothing is lost', async () => {
  // A school that typed item numbers on employee records before the register existed.
  const db = memoryDb();
  const env1 = setup({ today: DATE, db });
  const admin = env1.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const mk = (first, extra) => admin.post('/api/hris/employees', { firstName: first, lastName: 'Old', hireDate: '2015-06-01', payType: 'monthly', rate: 30000, position: 'Instructor I', department: 'Faculty', salaryGrade: 12, appointment: 'Permanent', ...extra });
  const ana = await mk('Ana');
  const ben = await mk('Ben');
  const cy = await mk('Cy');
  const dee = await mk('Dee', { appointment: 'Job order', employmentStatus: 'Job order', salaryGrade: '', payType: 'daily', rate: 500 });
  const campusId = ana.campusId;
  // Before the register: free text on the records, and one item recorded already.
  db.data.plantillaItems = [{ id: 'known', itemNo: 'KNOWN-1', positionTitle: 'Instructor I', salaryGrade: 12, campusId, status: 'vacant', fundCluster: '01', incumbentId: null, reviewNotes: [] }];
  for (const e of db.data.employees) e.plantillaItem = '';
  Object.assign(db.data.employees.find((e) => e.id === ana.id), { plantillaItem: ' known-1 ' }); // matches, whatever the case
  Object.assign(db.data.employees.find((e) => e.id === ben.id), { plantillaItem: 'NEW-77' }); // unknown: a draft
  Object.assign(db.data.employees.find((e) => e.id === cy.id), { plantillaItem: 'NEW-77' }); // the same number twice
  Object.assign(db.data.employees.find((e) => e.id === dee.id), { plantillaItem: 'JO-5' }); // a job order
  // Start-up.
  const started = createApi(db, { clock: () => new Date(`${DATE}T10:00:00`) });
  const items = db.data.plantillaItems;
  const emp = (id) => db.data.employees.find((e) => e.id === id);
  assert.equal(items.find((i) => i.id === 'known').incumbentId, ana.id);
  assert.equal(items.find((i) => i.id === 'known').status, 'filled');
  assert.equal(emp(ana.id).plantillaItem, 'KNOWN-1'); // the register's spelling
  const draft = items.find((i) => i.itemNo === 'NEW-77');
  assert.ok(draft.draft && draft.review);
  assert.equal(draft.incumbentId, ben.id);
  assert.equal(draft.positionTitle, 'Instructor I');
  assert.equal(draft.salaryGrade, 12);
  assert.equal(items.filter((i) => i.itemNo === 'NEW-77').length, 1); // never a second item with that number
  // Cy's number stays on the record and is noted on the item; the job order's becomes a vacant draft.
  assert.equal(emp(cy.id).plantillaItem, 'NEW-77');
  assert.ok(draft.reviewNotes.some((n) => /Cy Old/.test(n.text)));
  const jo = items.find((i) => i.itemNo === 'JO-5');
  assert.equal(jo.status, 'vacant');
  assert.equal(jo.incumbentId, null);
  assert.equal(emp(dee.id).plantillaItem, 'JO-5');
  // Every typed value is still somewhere: on the record, or as the item linked to it.
  for (const [id, typed] of [[ana.id, 'KNOWN-1'], [ben.id, 'NEW-77'], [cy.id, 'NEW-77'], [dee.id, 'JO-5']]) {
    assert.ok(emp(id).plantillaItem === typed || items.some((i) => i.incumbentId === id && i.itemNo === typed));
  }
  // Running again (first use) changes nothing more, and the record shows what is to review.
  const snapshot = JSON.stringify(items);
  const env2 = setup({ today: DATE, db });
  const admin2 = env2.client();
  await admin2.post('/api/hub/login', { username: 'admin', password: PW });
  const list = await admin2.get('/api/hris/plantilla?status=review');
  assert.equal(JSON.stringify(db.data.plantillaItems), snapshot);
  assert.deepEqual(list.items.map((i) => i.itemNo).sort(), ['JO-5', 'NEW-77']);
  assert.equal((await admin2.get(`/api/hris/employees/${cy.id}`)).plantillaTyped, 'NEW-77');
  // A number typed through the API now goes through the register too.
  const typed = await admin2.post('/api/hris/employees', { firstName: 'Eve', lastName: 'New', hireDate: '2026-01-05', payType: 'monthly', rate: 1, salaryGrade: 10, plantillaItem: 'API-1', appointment: 'Permanent' });
  assert.equal(db.data.plantillaItems.find((i) => i.itemNo === 'API-1').incumbentId, typed.id);
  // HR reviews a draft; a draft without incumbent can be removed, an item from DBM's list cannot.
  const removable = db.data.plantillaItems.find((i) => i.itemNo === 'JO-5');
  await admin2.put(`/api/hris/plantilla/${removable.id}`, { reviewed: true, positionTitle: 'Utility Worker', salaryGrade: 1 });
  assert.equal(db.data.plantillaItems.find((i) => i.itemNo === 'JO-5').review, false);
  await assert.rejects(admin2.del('/api/hris/plantilla/known'), /has an incumbent/);
  const kept = await admin2.post('/api/hris/plantilla', { itemNo: 'DBM-9', positionTitle: 'Clerk', salaryGrade: 3, campusId });
  await assert.rejects(admin2.del(`/api/hris/plantilla/${kept.id}`), /Abolished instead/);
  // The migration's entries in the audit log are ATLAS's own (no person).
  const sys = started.audit.entries().filter((e) => e.action.startsWith('Plantilla: recorded a draft'));
  assert.ok(sys.length >= 2 && sys.every((e) => e.actor === '' && e.actorId === null));
});

test('filters and totals: campus, office, fund source, status, salary grade; abolished hidden but kept', async () => {
  const s = await school();
  const sip = await s.admin.post('/api/admin/campuses', { name: 'Sipocot Campus', code: 'SIP' });
  await s.admin.put(`/api/admin/users/${s.data.users.find((u) => u.username === 'hana').id}`, { campusIds: [s.main.id, sip.id] }).catch(() => {
    s.data.users.find((u) => u.username === 'hana').campusIds = [s.main.id, sip.id];
  });
  const a = await s.item({ itemNo: 'A', salaryGrade: 12, office: 'College of Computing', fundCluster: '01' });
  const b = await s.item({ itemNo: 'B', salaryGrade: 12, office: 'Library', fundCluster: '05' });
  const c = await s.item({ itemNo: 'C', salaryGrade: 18, office: 'College of Computing', fundCluster: '01', status: 'unfunded' });
  const d = await s.item({ itemNo: 'D', salaryGrade: 15, office: 'Library', fundCluster: '01', campusId: sip.id });
  const e = await s.item({ itemNo: 'E', salaryGrade: 8, office: 'Library', fundCluster: '01' });
  const nora = await s.employee({ firstName: 'Nora', lastName: 'Santos', salaryGrade: 12, step: 2 });
  await s.hr.post(`/api/hris/plantilla/${a.id}/incumbent`, { employeeId: nora.id });
  // Abolished: kept, out of the default list and the totals.
  const gone = await s.hr.put(`/api/hris/plantilla/${e.id}`, { status: 'abolished', abolishReason: 'Abolished under the approved rationalization plan' });
  assert.equal(gone.status, 'abolished');
  assert.ok(gone.abolishedAt);
  const get = (q = '') => s.hr.get(`/api/hris/plantilla${q}`);
  const nos = (r) => r.items.map((i) => i.itemNo).sort();
  assert.deepEqual(nos(await get()), ['A', 'B', 'C', 'D']);
  assert.deepEqual(nos(await get('?status=abolished')), ['E']);
  assert.deepEqual(nos(await get('?status=all')), ['A', 'B', 'C', 'D', 'E']);
  assert.ok(s.data.plantillaItems.some((i) => i.itemNo === 'E'));
  assert.deepEqual(nos(await get(`?campusId=${sip.id}`)), ['D']);
  assert.deepEqual(nos(await get('?office=Library')), ['B', 'D']);
  assert.deepEqual(nos(await get('?fund=05')), ['B']);
  assert.deepEqual(nos(await get('?fund=01')), ['A', 'C', 'D']);
  assert.deepEqual(nos(await get('?status=vacant')), ['B', 'D']);
  assert.deepEqual(nos(await get('?salaryGrade=12')), ['A', 'B']);
  assert.deepEqual(nos(await get('?q=santos')), ['A']);
  const t = (await get()).totals;
  assert.deepEqual([t.items, t.filled, t.vacant, t.unfunded, t.abolished], [4, 1, 2, 1, 0]);
  const yr = (sg, step = 1) => salaryFor(sg, step, DATE) * 12;
  assert.equal(t.authorized, yr(12) + yr(12) + yr(15)); // filled and vacant
  assert.equal(t.authorizedUnfunded, yr(18));
  assert.equal(t.actual, yr(12, 2)); // the incumbent's own step
  // The shared helpers the browser uses give the same.
  const all = (await get('?status=all')).items;
  assert.deepEqual(plantillaTotals(filterItems(all, {})), t);
  // A restored abolished item is vacant again.
  assert.equal((await s.hr.put(`/api/hris/plantilla/${e.id}`, { status: 'vacant' })).status, 'vacant');
});

test('CSV and the PSIPOP: the columns from one list, every row, the signatories from settings', async () => {
  const s = await school();
  const a = await s.item({ itemNo: '=CMD-1', areaCode: '05', areaType: 'R', level: '2' });
  await s.item({ itemNo: 'B-2', positionTitle: 'Librarian I', status: 'unfunded' });
  const nora = await s.employee({ firstName: 'Nora', lastName: 'Santos', middleName: 'Cruz', salaryGrade: 12, step: 2 });
  await s.hr.post(`/api/hris/plantilla/${a.id}/incumbent`, { employeeId: nora.id });
  const res = await s.hr.get('/api/hris/plantilla/export');
  assert.equal(res.type, 'text/csv');
  assert.match(res.headers['Content-Disposition'], /plantilla-2026-11-03\.csv/);
  const lines = res.raw.replace(/^﻿/, '').split('\n');
  assert.equal(lines.length, 3);
  const head = lines[0].split('","').map((x) => x.replace(/"/g, ''));
  assert.equal(head[0], 'Item number');
  assert.ok(head.includes('Name of incumbent: Last name') && head.includes('Authorized annual salary') && head.includes('Fund cluster'));
  assert.equal(head.length, PSIPOP_COLUMNS.length + 12);
  const row = lines.find((l) => l.includes('Santos'));
  assert.match(row, /^"'=CMD-1"/); // a formula is written as text
  assert.ok(row.includes(`"${salaryFor(12, 2, DATE) * 12}"`));
  assert.ok(lines.some((l) => l.includes('"UNFUNDED"')));
  assert.equal(plantillaCsv([]).split('\n').length, 1);
  // Filters apply to the CSV.
  assert.equal((await s.hr.get('/api/hris/plantilla/export?status=unfunded')).raw.split('\n').length, 2);
  // The PSIPOP: rows, totals, the as-of date and the three signatures (HR's own; Finance's as fallback).
  await s.admin.put('/api/finance/settings', { signatories: { budget: { name: 'Bea Budget', title: 'Budget Officer III' }, head: { name: 'Dr. Hugo Head', title: 'University President' } } });
  await s.hr.put('/api/hris/plantilla/settings', { hrOfficer: { name: 'Hana Reyes', title: '' } });
  const p = await s.hr.get('/api/hris/plantilla/psipop?asOf=2026-12-31');
  assert.equal(p.asOf, '2026-12-31');
  assert.equal(p.rows.length, 2);
  assert.deepEqual(p.signatures.map((x) => [x.caption, x.name, x.title]), [
    ['Prepared by', 'Hana Reyes', 'Human Resource Management Officer'],
    ['Certified correct', 'Bea Budget', 'Budget Officer III'],
    ['Approved by', 'Dr. Hugo Head', 'University President'],
  ]);
  // The Settings center knows the signatories, with their change history.
  const c = await s.admin.get('/api/admin/config');
  assert.equal(c.settings.find((x) => x.area === 'plantilla' && x.path === 'hrOfficer.name').value, 'Hana Reyes');
});

test('the hris.plantilla permission: HR managers by default; viewers read; Roles & permissions can move it', async () => {
  const s = await school();
  assert.ok(ROLES.hr.permissions.includes('hris.plantilla'));
  assert.ok(!ROLES.payroll.permissions.includes('hris.plantilla'));
  assert.ok(HRIS_PERMISSION_LABELS.some(([p]) => p === 'hris.plantilla'));
  const a = await s.item();
  // The payroll officer views employee records: reads the register and the PSIPOP, changes nothing.
  const pia = await s.signIn('pia');
  assert.equal((await pia.get('/api/hris/plantilla')).items.length, 1);
  assert.equal((await pia.get('/api/hris/plantilla')).canEdit, false);
  await pia.get('/api/hris/plantilla/psipop');
  await assert.rejects(pia.post('/api/hris/plantilla', { itemNo: 'P-1', positionTitle: 'X', salaryGrade: 1 }), status(403));
  await assert.rejects(pia.put(`/api/hris/plantilla/${a.id}`, { positionTitle: 'Y' }), status(403));
  await assert.rejects(pia.post(`/api/hris/plantilla/${a.id}/incumbent`, { employeeId: s.payEmp.id }), status(403));
  // Staff (self-service only) cannot read it.
  const sol = await s.signIn('sol');
  await assert.rejects(sol.get('/api/hris/plantilla'), status(403));
  await assert.rejects(sol.get(`/api/hris/plantilla/${a.id}`), status(403));
  await assert.rejects(sol.get('/api/hris/plantilla/export'), status(403));
  // Someone with employees.edit but not hris.plantilla cannot change an item through the employee record.
  const roles = await s.admin.get('/api/admin/roles');
  assert.ok(roles.groups.find((g) => g.id === 'people').permissions.some((p) => p.id === 'hris.plantilla'));
  const hrPerms = roles.roles.find((r) => r.id === 'hr').permissions.filter((p) => p !== 'hris.plantilla');
  await s.admin.put('/api/admin/roles', { permissions: { hr: hrPerms, payroll: [...ROLES.payroll.permissions, 'hris.plantilla'] } });
  await assert.rejects(s.hr.post('/api/hris/plantilla', { itemNo: 'H-1', positionTitle: 'X', salaryGrade: 1 }), status(403));
  await assert.rejects(s.hr.put(`/api/hris/employees/${s.staffEmp.id}`, { plantillaItemId: a.id }), /cannot change plantilla items/);
  assert.equal((await s.hr.get('/api/hris/plantilla')).items.length, 1); // still reads it (employees.view)
  assert.ok((await pia.post('/api/hris/plantilla', { itemNo: 'P-1', positionTitle: 'Clerk', salaryGrade: 3 })).id);
  await s.admin.put('/api/admin/roles', { overrides: {} });
  assert.ok((await s.hr.get('/api/hris/auth/status')).permissions.includes('hris.plantilla'));
});

test('the audit log: every change to an item, with the values before and after', async () => {
  const s = await school();
  const a = await s.item();
  const nora = await s.employee({ firstName: 'Nora', lastName: 'Santos' });
  await s.hr.put(`/api/hris/plantilla/${a.id}`, { positionTitle: 'Instructor II', salaryGrade: 13 });
  await s.hr.put(`/api/hris/plantilla/${a.id}`, { overrideAmount: 400000, overrideReason: 'As approved' });
  await s.hr.post(`/api/hris/plantilla/${a.id}/incumbent`, { employeeId: nora.id });
  await s.hr.del(`/api/hris/plantilla/${a.id}/incumbent`);
  await s.hr.put(`/api/hris/plantilla/${a.id}`, { status: 'abolished' });
  await s.hr.put('/api/hris/plantilla/settings', { head: { name: 'H', title: '' } });
  const mine = s.trail().filter((e) => e.targetId === a.id);
  assert.deepEqual(mine.map((e) => e.action), [
    'Plantilla: recorded an item', 'Plantilla: changed an item', 'Plantilla: changed an item',
    'Plantilla: linked an incumbent', 'Plantilla: unlinked the incumbent', 'Plantilla: abolished an item',
  ]);
  assert.ok(mine.every((e) => e.actor === 'Hana Reyes' && e.system === 'people'));
  assert.deepEqual(mine[1].changes.map((c) => [c.field, c.from, c.to]), [['Position title', 'Instructor I', 'Instructor II'], ['Salary grade', '12', '13']]);
  assert.equal(mine[2].changes[0].field, 'Authorized annual salary');
  assert.deepEqual(mine[3].changes.map((c) => c.field), ['Incumbent', 'Status']);
  assert.equal(mine[5].changes.find((c) => c.field === 'Status').to, 'Abolished');
  // The item page shows its history from the log, newest first.
  const v = await s.hr.get(`/api/hris/plantilla/${a.id}`);
  assert.equal(v.history[0].action, 'abolished an item');
  assert.equal(v.history.length, 6);
  // A link from the employee record is logged the same way.
  const b = await s.item({ itemNo: 'B-1' });
  await s.hr.put(`/api/hris/employees/${nora.id}`, { plantillaItemId: b.id });
  assert.equal(s.trail().at(-1).action, 'Plantilla: linked an incumbent');
  assert.equal(s.trail().at(-1).detail, 'From the employee record');
  // The signatories go to the Settings center's history.
  const h = await s.admin.get('/api/admin/config/history?module=people');
  assert.ok(h.entries.some((e) => e.area === 'plantilla'));
});

test('Post a job opening: the form starts from a vacant item; the opening keeps it; Selected changes nothing', async () => {
  const s = await school();
  const a = await s.item({ itemNo: 'INST1-777', positionTitle: 'Instructor I', salaryGrade: 12, office: 'College of Computing' });
  const draft = await s.hr.get(`/api/hris/plantilla/${a.id}/opening`);
  assert.deepEqual(draft, { plantillaItemId: a.id, plantillaItem: 'INST1-777', title: 'Instructor I', salaryGrade: 12, campusId: s.main.id, office: 'College of Computing' });
  // The form posts it as it was filled in.
  const o = await s.hr.post('/api/hris/recruitment/openings', {
    ...draft, education: "Master's degree", training: 'None', experience: 'None', eligibility: 'None', vacancies: 1, closingDate: '2026-11-25', audience: 'all', status: 'open',
  });
  assert.equal(o.plantillaItemId, a.id);
  assert.equal(o.fromItem.itemNo, 'INST1-777');
  assert.equal(o.plantillaItem, 'INST1-777');
  assert.deepEqual((await s.hr.get(`/api/hris/plantilla/${a.id}`)).openings.map((x) => x.id), [o.id]);
  // Only a vacant item can be posted; only HR with recruitment can open the form from it.
  const u = await s.item({ itemNo: 'U-9', status: 'unfunded' });
  await assert.rejects(s.hr.get(`/api/hris/plantilla/${u.id}/opening`), /only a vacant item/);
  await assert.rejects(s.hr.post('/api/hris/recruitment/openings', { ...draft, plantillaItemId: u.id, closingDate: '2026-11-25' }), /not vacant/);
  await assert.rejects((await s.signIn('pia')).get(`/api/hris/plantilla/${a.id}/opening`), status(403));
  // An employee applies and HR selects them: the item stays vacant, with no incumbent.
  const eli = await s.employee({ firstName: 'Eli', lastName: 'Cruz' });
  await s.admin.post(`/api/hris/employees/${eli.id}/account`, { role: 'staff', username: 'eli', password: PW, mustChangePassword: false });
  const app = await (await s.signIn('eli')).post(`/api/hris/jobs/${o.id}/apply`, { note: 'Please consider me.' });
  await s.hr.put(`/api/hris/recruitment/applications/${app.id}`, { status: 'selected' });
  const after = s.data.plantillaItems.find((i) => i.id === a.id);
  assert.equal(after.status, 'vacant');
  assert.equal(after.incumbentId, null);
  // HR links the person when the appointment is made.
  assert.equal((await s.hr.post(`/api/hris/plantilla/${a.id}/incumbent`, { employeeId: eli.id })).status, 'filled');
});

test('demo data: one item per demo employee with a government item, vacant and unfunded items, all demo', () => {
  const data = memoryDb().data;
  data.users.push({ id: 'admin', role: 'admin', username: 'admin', name: 'Admin', campusIds: [] });
  addDemo(data, DATE);
  const items = data.plantillaItems;
  assert.ok(items.length > 20 && items.every((i) => i.demo));
  const holders = data.employees.filter((e) => e.demo && e.plantillaItem);
  assert.equal(items.filter((i) => i.status === 'filled').length, holders.length);
  for (const e of holders) assert.equal(items.find((i) => i.incumbentId === e.id)?.itemNo, e.plantillaItem);
  assert.equal(new Set(items.map((i) => normalizeItemNo(i.itemNo))).size, items.length); // unique numbers
  assert.ok(items.filter((i) => i.status === 'vacant').length >= 3);
  assert.equal(items.filter((i) => i.status === 'unfunded').length, 1);
  assert.ok(!data.employees.some((e) => e.demo && ['Job order', 'Contract of service'].includes(e.appointment) && items.some((i) => i.incumbentId === e.id)));
  // The demo job openings come from their vacant items.
  const opening = data.jobOpenings.find((o) => o.plantillaItem === 'DEMO-INST1-0412-2026');
  assert.equal(opening.plantillaItemId, items.find((i) => i.itemNo === 'DEMO-INST1-0412-2026').id);
});
