// Appointing a selected applicant and the appointment papers (HRIS request PL-025): only a Selected
// application, with hris.recruitment and hris.appoint; a vacant plantilla item; the pre-filled values
// (salary from salaryFor, the status never inferred); templates with merge fields (unknown ones
// refused); issuing frozen papers with numbers, reprints from the snapshot; cancel and reissue; an
// external applicant becoming an employee with the same sign-in; an internal applicant's history; the
// plantilla item Filled; the opening's vacancies; the assumption and its certificate; the audit log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';
import { salaryFor } from '../shared/gov-pay.js';
import { ROLES, HRIS_PERMISSION_LABELS } from '../shared/roles.js';
import { templateProblems, mergeValues, renderPart, plainText, amountInWords, writeDate, TEMPLATE_PARTS, MERGE_KEYS } from '../shared/appointment.js';
import { memoryDb } from '../server/db.js';
import { addDemo } from '../server/demo.js';

const PW = 'password123';
const DAY = 86400000;
const status = (code) => (err) => err.status === code;

async function school() {
  let now = Date.parse('2026-11-03T10:00:00');
  const env = setup({ clock: () => new Date(now) });
  const clock = { add: (days) => (now += days * DAY) };
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const main = (await admin.get('/api/admin/campuses'))[0];
  const signIn = async (username, password = PW) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password });
    return c;
  };
  const employee = (extra = {}) => admin.post('/api/hris/employees', { firstName: 'Nora', lastName: 'Staff', gender: 'Female', hireDate: '2020-01-06', payType: 'monthly', rate: 26100, position: 'Clerk', department: 'Registrar', appointment: 'Permanent', employmentStatus: 'Permanent', ...extra });
  const hrEmp = await employee({ firstName: 'Hana', lastName: 'Reyes', position: 'HRMO III', salaryGrade: 18, step: 1 });
  await admin.post(`/api/hris/employees/${hrEmp.id}/account`, { role: 'hr', username: 'hana', password: PW, mustChangePassword: false });
  const hr2Emp = await employee({ firstName: 'Iris', lastName: 'Lim', position: 'HRMO II', salaryGrade: 15, step: 1 });
  await admin.post(`/api/hris/employees/${hr2Emp.id}/account`, { role: 'hr', username: 'iris', password: PW, mustChangePassword: false });
  const eliEmp = await employee({ firstName: 'Eli', lastName: 'Cruz', middleName: 'Santos', position: 'Administrative Aide IV', salaryGrade: 4, step: 2, address: 'Pili, Camarines Sur' });
  await admin.post(`/api/hris/employees/${eliEmp.id}/account`, { role: 'staff', username: 'eli', password: PW, mustChangePassword: false });
  const hr = await signIn('hana');
  // Signatories and the agency for the papers (HR settings → Appointment papers).
  await hr.put('/api/hris/appointment-papers/settings', { signatories: { appointingOfficer: { name: 'Dr. Rosa Bautista', title: 'University President' }, hrmo: { name: 'Hana Reyes', title: 'HRMO III' } }, place: 'Pili, Camarines Sur' });
  const item = (extra = {}) => hr.post('/api/hris/plantilla', { itemNo: 'ADAS3-001', positionTitle: 'Administrative Assistant III', salaryGrade: 9, office: 'Accounting Office', fundCluster: '01', ...extra });
  const opening = async (it, extra = {}) => hr.post('/api/hris/recruitment/openings', {
    title: it?.positionTitle || 'Administrative Assistant III', plantillaItemId: it?.id || '', salaryGrade: it?.salaryGrade || 9, office: 'Accounting Office', education: 'Two years of college', training: 'None required',
    experience: 'None required', eligibility: 'Career Service (Subprofessional)', vacancies: 1, closingDate: '2026-11-20', audience: 'all', status: 'open', ...extra,
  });
  let n = 30;
  const signUp = async (name, extra = {}) => {
    const username = name.toLowerCase().replace(/\s+/g, '');
    const c = env.client({ ip: `198.51.100.${n++}` });
    await c.post('/api/jobs/signup', { name, email: `${username}@example.com`, username, password: 'longenough1', consent: true, phone: '09171234567', ...extra });
    await c.post('/api/hub/login', { username, password: 'longenough1' });
    return Object.assign(c, { username });
  };
  const select = (appId) => hr.put(`/api/hris/recruitment/applications/${appId}`, { stage: 'selected', note: 'Congratulations.' });
  const user = (username) => env.db.data.users.find((u) => u.username === username);
  const trail = () => env.api.audit.entries().filter((e) => e.action.startsWith('Appointment: '));
  return { env, clock, admin, main, signIn, employee, hr, hrEmp, eliEmp, item, opening, signUp, select, user, trail, data: env.db.data };
}
// An external applicant, applied and selected, ready to appoint: { o, it, app, carla }.
async function selected(s, { itemExtra = {}, openingExtra = {} } = {}) {
  const it = await s.item(itemExtra);
  const o = await s.opening(it, openingExtra);
  const carla = await s.signUp('Carla Mendiola');
  const app = await carla.post(`/api/hris/jobs/${o.id}/apply`, { note: '' });
  await s.select(app.id);
  return { it, o, app, carla };
}
const appoint = async (s, appId, extra = {}) => {
  const v = await s.hr.get(`/api/hris/recruitment/applications/${appId}/appointment`);
  return s.hr.post(`/api/hris/recruitment/applications/${appId}/appointment`, { ...v.draft, status: 'Permanent', middleName: 'Reyes', address: 'Naga City', ...extra });
};

test('merge fields and wording: unknown fields refused, values written in English and Filipino', async () => {
  assert.deepEqual(templateProblems('Hello {name}, {position}.'), []);
  assert.deepEqual(templateProblems('Hi {nmae}', 'Body'), ['Body: {nmae} is not a merge field.']);
  assert.match(templateProblems('Hi {name')[0], /no partner/);
  for (const parts of Object.values(TEMPLATE_PARTS)) for (const [, , text] of parts) assert.deepEqual(templateProblems(text), [], 'the built-in wording uses known fields only');
  for (const k of ['name', 'position', 'item_no', 'salary_grade', 'monthly_salary', 'office', 'agency', 'date_signed', 'effective_date', 'appointing_officer']) assert.ok(MERGE_KEYS.has(k), k);
  assert.equal(amountInWords(24329), 'Twenty-Four Thousand Three Hundred Twenty-Nine');
  assert.equal(amountInWords(1000000.5), 'One Million and 50/100');
  assert.equal(writeDate('2026-11-26'), 'November 26, 2026');
  assert.equal(writeDate('2026-11-26', 'fil'), 'ika-26 ng Nobyembre, 2026');
  const v = mergeValues({ firstName: 'Carla', middleName: 'Reyes', lastName: 'Mendiola', position: 'Instructor I', monthlySalary: 29165, dateSigned: '2026-11-03', signatories: { appointingOfficer: { name: 'Dr. R', title: 'President' } } }, 'fil');
  assert.equal(plainText(renderPart('Ako, si {name}, {position}; {date_signed}; {monthly_salary}; {vice}.', v)), 'Ako, si Carla Reyes Mendiola, Instructor I; ika-3 ng Nobyembre, 2026; ₱29,165.00; ________.');
  // HR settings: an unknown field or an open brace is refused, and nothing is saved.
  const s = await school();
  await assert.rejects(s.hr.put('/api/hris/appointment-papers/settings', { templates: { 'oath-fil': { parts: { body: 'Ako, si {pangalan}.' } } } }), /Not saved\. .*\{pangalan\} is not a merge field/);
  await assert.rejects(s.hr.put('/api/hris/appointment-papers/settings', { templates: { appointment: { parts: { body: '' } } } }), /cannot be empty/);
  const before = (await s.hr.get('/api/hris/appointment-papers/settings')).templates['oath-fil'];
  assert.equal(before.version, 1);
  const saved = await s.hr.put('/api/hris/appointment-papers/settings', { templates: { 'oath-fil': { parts: { body: 'Ako, si {name}, ay nanunumpa.' } } } });
  assert.deepEqual([saved.templates['oath-fil'].version, saved.templates['oath-fil'].updatedBy, saved.papers.find((p) => p.id === 'oath-fil').defaultWording], [2, 'Hana Reyes', false]);
  assert.equal(saved.papers.find((p) => p.id === 'appointment').defaultWording, true, 'the note to HR shows while the built-in wording is in use');
  // Only hris.settings changes it.
  const eli = await s.signIn('eli');
  await assert.rejects(eli.put('/api/hris/appointment-papers/settings', { place: 'x' }), status(403));
});

test('Appoint: only a Selected application, with hris.recruitment and hris.appoint; pre-filled, the status never inferred', async () => {
  const s = await school();
  assert.ok(ROLES.hr.permissions.includes('hris.appoint') && HRIS_PERMISSION_LABELS.some(([p]) => p === 'hris.appoint'));
  const it = await s.item();
  const o = await s.opening(it);
  const carla = await s.signUp('Carla Mendiola');
  const app = await carla.post(`/api/hris/jobs/${o.id}/apply`, { note: '' });
  await assert.rejects(s.hr.get(`/api/hris/recruitment/applications/${app.id}/appointment`), /Only an application whose outcome is Selected/);
  await s.hr.put(`/api/hris/recruitment/applications/${app.id}`, { stage: 'screening' });
  await assert.rejects(s.hr.post(`/api/hris/recruitment/applications/${app.id}/appointment`, {}), /Only an application whose outcome is Selected/);
  await s.select(app.id);
  // The permission: without hris.appoint, HR with Recruitment cannot appoint; staff and applicants never.
  s.user('iris').access = { remove: ['hris.appoint'] };
  const iris = await s.signIn('iris');
  await assert.rejects(iris.get(`/api/hris/recruitment/applications/${app.id}/appointment`), (e) => e.status === 403 && /hris\.appoint/.test(e.message));
  await assert.rejects((await s.signIn('eli')).get(`/api/hris/recruitment/applications/${app.id}/appointment`), status(403));
  await assert.rejects(carla.get(`/api/hris/recruitment/applications/${app.id}/appointment`), status(403));
  const v = await s.hr.get(`/api/hris/recruitment/applications/${app.id}/appointment`);
  assert.equal(v.appointment, null);
  const d = v.draft;
  assert.deepEqual([d.firstName, d.lastName, d.position, d.plantillaItemId, d.itemNo, d.salaryGrade, d.step], ['Carla', 'Mendiola', 'Administrative Assistant III', it.id, 'ADAS3-001', 9, 1]);
  assert.equal(d.monthlySalary, salaryFor(9, 1, '2026-11-03'));
  assert.equal(d.status, '', 'the status of appointment is never filled in (PL-052)');
  assert.equal(d.nature, 'original');
  assert.deepEqual([d.signatories.appointingOfficer.name, d.signatories.appointingOfficer.title, d.signatories.hrmo.name], ['Dr. Rosa Bautista', 'University President', 'Hana Reyes']);
  assert.deepEqual([d.publicationTo, d.dateSigned, d.effectiveDate, d.assumptionDate, d.place], ['2026-11-20', '2026-11-03', '2026-11-03', '', 'Pili, Camarines Sur']);
  assert.ok(v.choices.statuses.includes('Permanent') && !v.choices.statuses.includes('Job order'));
  assert.equal(v.plan.kind, 'create');
  // Checked: the status must be picked; dates in order; the grade's steps.
  await assert.rejects(s.hr.post(`/api/hris/recruitment/applications/${app.id}/appointment`, d), /Status of appointment: pick one/);
  await assert.rejects(appoint(s, app.id, { effectiveDate: '2026-11-01' }), /cannot be before the date of signing/);
  await assert.rejects(appoint(s, app.id, { step: 9 }), /steps 1 to 8/);
  await assert.rejects(appoint(s, app.id, { signatories: { ...d.signatories, appointingOfficer: { name: '', title: '' } } }), /Appointing officer/);
  // The salary always comes from the schedule (salaryFor), whatever is sent.
  const appt = await appoint(s, app.id, { step: 3, monthlySalary: 1 });
  assert.equal(appt.fields.monthlySalary, salaryFor(9, 3, '2026-11-03'));
  await assert.rejects(appoint(s, app.id), (e) => e.status === 409);
  assert.equal((await s.hr.get(`/api/hris/recruitment/openings/${o.id}`)).applications[0].appointment.id, appt.id);
});

test('the plantilla item must be vacant, unless it is the same person\'s; the person replaced is named and unlinked only from this item', async () => {
  const s = await school();
  const it = await s.item();
  const other = await s.item({ itemNo: 'ADAS3-002' });
  const nora = await s.employee({ firstName: 'Nora', lastName: 'Santos', salaryGrade: 9, step: 4 });
  await s.hr.post(`/api/hris/plantilla/${other.id}/incumbent`, { employeeId: nora.id });
  const { app } = await selected(s, { itemExtra: { itemNo: 'ADAS3-003' } });
  const v = await s.hr.get(`/api/hris/recruitment/applications/${app.id}/appointment`);
  await assert.rejects(appoint(s, app.id, { plantillaItemId: other.id }), /is not vacant: Nora Santos holds it/);
  // Unlinking a retiree keeps them as the item's previous incumbent: the next appointment's "vice".
  const ret = await s.employee({ firstName: 'Ramon', lastName: 'Retirado', salaryGrade: 9, step: 8 });
  await s.hr.post(`/api/hris/plantilla/${it.id}/incumbent`, { employeeId: ret.id });
  await s.hr.del(`/api/hris/plantilla/${it.id}/incumbent`);
  const o2 = await s.opening(await s.hr.get(`/api/hris/plantilla/${it.id}`));
  const b = await s.signUp('Ben Torres');
  const app2 = await b.post(`/api/hris/jobs/${o2.id}/apply`, { note: '' });
  await s.select(app2.id);
  const v2 = await s.hr.get(`/api/hris/recruitment/applications/${app2.id}/appointment`);
  assert.deepEqual([v2.draft.vice, v2.draft.viceEmployeeId], ['Ramon Retirado', ret.id]);
  // The one being replaced still holds the item: allowed when named as vice, with a warning; confirming unlinks them from it.
  await s.hr.post(`/api/hris/plantilla/${it.id}/incumbent`, { employeeId: ret.id });
  const v3 = await s.hr.get(`/api/hris/recruitment/applications/${app2.id}/appointment`);
  const appt = await s.hr.post(`/api/hris/recruitment/applications/${app2.id}/appointment`, { ...v3.draft, status: 'Permanent', viceReason: 'retired' });
  const plan = (await s.hr.get(`/api/hris/recruitment/applications/${app2.id}/appointment`)).plan;
  assert.ok(plan.warnings.some((w) => /Ramon Retirado still holds item ADAS3-001/.test(w)));
  await s.hr.post(`/api/hris/appointments/${appt.id}/issue`, { kinds: ['appointment'] });
  await s.hr.post(`/api/hris/appointments/${appt.id}/confirm`, {});
  const item = await s.hr.get(`/api/hris/plantilla/${it.id}`);
  assert.equal(item.status, 'filled');
  assert.equal(item.incumbent.name, 'Torres, Ben');
  assert.equal((await s.hr.get(`/api/hris/plantilla/${other.id}`)).incumbent.name, 'Santos, Nora', 'other items are never touched');
  assert.equal(v.draft.plantillaItemId.length > 0, true);
});

test('issuing: a frozen snapshot with a number; reprints come from it after the settings change; cancel and reissue', async () => {
  const s = await school();
  const { app } = await selected(s);
  const appt = await appoint(s, app.id);
  await assert.rejects(s.hr.post(`/api/hris/appointments/${appt.id}/issue`, { kinds: ['assumption'] }), /Record the date of assumption first/);
  const out = await s.hr.post(`/api/hris/appointments/${appt.id}/issue`, { kinds: ['appointment', 'oath-fil', 'oath-en'] });
  assert.deepEqual(out.papers.map((p) => [p.kind, p.refNo, p.status]), [['appointment', 'APT2026-0001', 'issued'], ['oath-fil', 'APT2026-0002', 'issued'], ['oath-en', 'APT2026-0003', 'issued']]);
  assert.equal(out.locked, true);
  await assert.rejects(s.hr.post(`/api/hris/appointments/${appt.id}/issue`, { kinds: ['appointment'] }), (e) => e.status === 409 && /Cancel and reissue/.test(e.message));
  await assert.rejects(s.hr.put(`/api/hris/appointments/${appt.id}`, { ...appt.fields }), /use Cancel and reissue/);
  const id = out.papers[0].id;
  const first = await s.hr.get(`/api/hris/appointments/${appt.id}/papers/${id}`);
  const text = plainText(first.snapshot.parts.body);
  assert.match(text, /appointed as Administrative Assistant III \(Salary Grade 9, Step 1\) under Permanent status at the Accounting Office/);
  assert.match(text, /Twenty-Four Thousand Three Hundred Twenty-Nine pesos \(₱24,329\.00\)/);
  assert.match(text, /Plantilla Item No\. ADAS3-001/);
  assert.deepEqual([first.snapshot.template.version, first.snapshot.signatories.appointingOfficer.name, first.snapshot.template.defaultWording], [1, 'Dr. Rosa Bautista', true]);
  assert.match(first.snapshot.template.sha256, /^[0-9a-f]{64}$/);
  assert.match(plainText((await s.hr.get(`/api/hris/appointments/${appt.id}/papers/${out.papers[1].id}`)).snapshot.parts.body), /^Ako, si Carla Reyes Mendiola, ng Naga City, na itinalaga sa katungkulan bilang Administrative Assistant III/);
  assert.match(plainText((await s.hr.get(`/api/hris/appointments/${appt.id}/papers/${out.papers[1].id}`)).snapshot.parts.jurat), /ika-3 ng Nobyembre, 2026 sa Pili, Camarines Sur/);
  // The wording, the signatories and the school's details change: the issued paper does not.
  await s.hr.put('/api/hris/appointment-papers/settings', { signatories: { appointingOfficer: { name: 'Dr. New President', title: 'OIC' } }, templates: { appointment: { parts: { body: 'Hereby appointed: {name}.' } } } });
  await s.admin.put('/api/admin/settings', { schoolName: 'Renamed School' });
  s.clock.add(5);
  const again = await s.hr.get(`/api/hris/appointments/${appt.id}/papers/${id}`);
  assert.deepEqual(again.snapshot, first.snapshot);
  const p1 = await s.hr.post(`/api/hris/appointments/${appt.id}/papers/${id}/print`);
  assert.deepEqual([p1.reprint, p1.issuedOn], [true, '2026-11-03'], 'printed on a later day: a reprint of the document issued that day');
  // Cancel and reissue, with the reason; the old one kept and marked cancelled.
  await assert.rejects(s.hr.post(`/api/hris/appointments/${appt.id}/papers/${id}/cancel`, { reason: '' }), /Give the reason/);
  const re = await s.hr.post(`/api/hris/appointments/${appt.id}/papers/${id}/cancel`, { reason: 'The middle name was misspelled.', fields: { middleName: 'Reyna' } });
  const old = re.papers.find((p) => p.id === id);
  const neu = re.papers.find((p) => p.id === re.reissued);
  assert.deepEqual([old.status, old.cancelReason, old.replacedBy, neu.refNo, neu.replaces, neu.status], ['cancelled', 'The middle name was misspelled.', 'APT2026-0004', 'APT2026-0004', 'APT2026-0001', 'issued']);
  const neuPaper = await s.hr.get(`/api/hris/appointments/${appt.id}/papers/${neu.id}`);
  assert.equal(plainText(neuPaper.snapshot.parts.body), 'Hereby appointed: Carla Reyna Mendiola.', 'reissued with the current wording and fields');
  assert.equal(neuPaper.snapshot.signatories.appointingOfficer.name, 'Dr. Rosa Bautista', 'the appointment keeps its own signatories');
  assert.equal(neuPaper.snapshot.template.version, 2);
  await assert.rejects(s.hr.post(`/api/hris/appointments/${appt.id}/papers/${id}/print`), /cancelled/);
  assert.equal(plainText((await s.hr.get(`/api/hris/appointments/${appt.id}/papers/${out.papers[1].id}`)).snapshot.parts.body).includes('Carla Reyes Mendiola'), true, 'the oath already issued keeps what it said');
  // The numbering engine's series, shown in the Settings center.
  assert.equal(s.data.counters.appointment['2026'], 4);
  const actions = s.trail().map((e) => e.action);
  for (const a of ['Appointment: started the appointment', 'Appointment: issued the Appointment form APT2026-0001', 'Appointment: reprinted the Appointment form APT2026-0001', 'Appointment: cancelled the Appointment form APT2026-0001 and reissued it as APT2026-0004']) assert.ok(actions.includes(a), a);
  assert.ok(s.trail().find((e) => e.action.startsWith('Appointment: cancelled')).changes.some((c) => c.field === 'Middle name' && c.to === 'Reyna'));
});

test('an external applicant becomes an employee: the same sign-in as a staff account, no expiry; the item Filled; the vacancies', async () => {
  const s = await school();
  const { it, o, app, carla } = await selected(s);
  // Work experience kept as an applicant moves to the record.
  const carlaUser = s.user('carlamendiola');
  s.data.workExperience = [{ id: 'w1', ownerKind: 'applicant', ownerId: carlaUser.id, order: 1, from: '2020-01-06', to: '2024-05-31', present: false, position: 'Clerk', agency: 'Example Office', verified: null, accomplishments: [], createdAt: '2026-11-01T00:00:00Z' }];
  carlaUser.applicantProfile = { sex: 'Female', birthDate: '1996-04-02' };
  const appt = await appoint(s, app.id);
  await assert.rejects(s.hr.post(`/api/hris/appointments/${appt.id}/confirm`, {}), /Issue the appointment form first/);
  await s.hr.post(`/api/hris/appointments/${appt.id}/issue`, { kinds: ['appointment', 'oath-fil'] });
  await assert.rejects(s.hr.post(`/api/hris/appointments/${appt.id}/confirm`, { role: 'accountant' }), (e) => e.status === 403 && /administrator/.test(e.message));
  const done = await s.hr.post(`/api/hris/appointments/${appt.id}/confirm`, { role: 'staff' });
  assert.deepEqual([done.offerClose, done.vacanciesLeft, done.confirmed.created], [true, 0, true]);
  await assert.rejects(s.hr.post(`/api/hris/appointments/${appt.id}/confirm`, {}), /already confirmed/);
  // The record: from the account, the profile, the appointment.
  const emp = await s.hr.get(`/api/hris/employees/${done.employeeId}`);
  assert.deepEqual([emp.firstName, emp.middleName, emp.lastName, emp.email, emp.phone, emp.gender, emp.birthDate, emp.address], ['Carla', 'Reyes', 'Mendiola', 'carlamendiola@example.com', '09171234567', 'Female', '1996-04-02', 'Naga City']);
  assert.deepEqual([emp.position, emp.salaryGrade, emp.step, emp.appointment, emp.hireDate, emp.department, emp.campusId, emp.plantillaItem], ['Administrative Assistant III', 9, 1, 'Permanent', '2026-11-03', 'Accounting Office', s.main.id, 'ADAS3-001']);
  assert.equal(emp.account.role, 'staff');
  const hist = await s.hr.get(`/api/hris/employees/${done.employeeId}/appointments`);
  assert.deepEqual(hist.history.map((r) => [r.from, r.position, r.status, r.natureLabel]), [['2026-11-03', 'Administrative Assistant III', 'Permanent', 'Original']]);
  assert.equal(s.data.workExperience[0].ownerKind, 'employee');
  assert.equal(s.data.workExperience[0].ownerId, emp.id);
  // The account: the same username and password, a staff account that never closes.
  const u = s.user('carlamendiola');
  assert.deepEqual([u.role, u.employeeId, u.expiresAt, u.status], ['staff', emp.id, undefined, 'active']);
  await assert.rejects(carla.get('/api/hris/jobs'), status(401), 'signed out once, so the next sign-in opens People as staff');
  const again = await s.signIn('carlamendiola', 'longenough1');
  const st = await again.get('/api/hris/auth/status');
  assert.deepEqual([st.user.role, st.employee.name], ['staff', 'Carla Mendiola']);
  s.clock.add(800); // far past the applicant account days and the purge days
  s.env.api.recruitment.sweep();
  assert.ok(s.user('carlamendiola'), 'never closed or removed');
  assert.ok((await s.signIn('carlamendiola', 'longenough1')).get('/api/hris/me/profile'));
  // The plantilla item and the opening.
  assert.equal((await s.hr.get(`/api/hris/plantilla/${it.id}`)).status, 'filled');
  const op = await s.hr.get(`/api/hris/recruitment/openings/${o.id}`);
  assert.deepEqual([op.filled, op.vacancies, op.applications[0].appointment.confirmed], [1, 1, true]);
  // The appointed person's own papers (My HR record → Appointment papers); nobody else's.
  const mine = await again.get('/api/hris/me/appointment-papers');
  assert.deepEqual(mine.appointments[0].papers.map((p) => p.kind), ['appointment', 'oath-fil']);
  const paper = await again.get(`/api/hris/me/appointment-papers/${mine.appointments[0].papers[0].id}`);
  assert.equal(paper.refNo, 'APT2026-0001');
  assert.equal((await again.post(`/api/hris/me/appointment-papers/${paper.id}/print`)).reprint, true);
  const eli = await s.signIn('eli');
  await assert.rejects(eli.get(`/api/hris/me/appointment-papers/${paper.id}`), status(404));
  assert.deepEqual((await eli.get('/api/hris/me/appointment-papers')).appointments, []);
  // The audit log: the account change and the appointment.
  assert.ok(s.env.api.audit.entries().some((e) => e.action === 'Applicant account became a staff account (appointed)' && e.changes.some((c) => c.to === 'Staff')));
  assert.ok(s.trail().some((e) => e.action === `Appointment: made Carla Reyes Mendiola an employee (${emp.employeeNo})`));
});

test('Confirm the appointment needs hris.accounts to change an account, and the type is one the confirming user may give', async () => {
  const s = await school();
  // A staff account given only Recruitment and Appoint selected applicants (no sign-in accounts right).
  const recEmp = await s.employee({ firstName: 'Rico', lastName: 'Santos', position: 'Clerk' });
  await s.admin.post(`/api/hris/employees/${recEmp.id}/account`, { role: 'staff', username: 'rico', password: PW, mustChangePassword: false });
  s.user('rico').access = { add: ['hris.recruitment', 'hris.appoint'] };
  const rico = await s.signIn('rico');
  const { app } = await selected(s);
  const v = await rico.get(`/api/hris/recruitment/applications/${app.id}/appointment`);
  assert.deepEqual([v.choices.roles, v.choices.mayMakeAccounts], [[], false], 'no account type to pick without hris.accounts');
  const appt = await appoint(s, app.id);
  await s.hr.post(`/api/hris/appointments/${appt.id}/issue`, { kinds: ['appointment'] });
  for (const role of ['hr', 'payroll', 'staff', undefined]) {
    await assert.rejects(rico.post(`/api/hris/appointments/${appt.id}/confirm`, role ? { role } : {}), (e) => e.status === 403 && /manage sign-in accounts/.test(e.message), String(role));
  }
  assert.deepEqual([s.user('carlamendiola').role, s.data.employees.some((e) => e.fromApplicantId === s.user('carlamendiola').id)], ['applicant', false], 'nothing changed');
  // An HR Manager picks only the types they may give: never a Finance office account or an administrator.
  const hv = await s.hr.get(`/api/hris/recruitment/applications/${app.id}/appointment`);
  assert.deepEqual([hv.choices.roles.map((r) => r.id), hv.choices.mayMakeAccounts], [['hr', 'payroll', 'staff'], true]);
  for (const role of ['accountant', 'approver', 'admin', 'applicant']) await assert.rejects(s.hr.post(`/api/hris/appointments/${appt.id}/confirm`, { role }), status(403), role);
  // Without hris.accounts, an HR Manager cannot either.
  s.user('iris').access = { remove: ['hris.accounts'] };
  await assert.rejects((await s.signIn('iris')).post(`/api/hris/appointments/${appt.id}/confirm`, { role: 'hr' }), status(403));
  const done = await s.hr.post(`/api/hris/appointments/${appt.id}/confirm`, { role: 'payroll' });
  assert.equal(s.user('carlamendiola').role, 'payroll');
  assert.equal(done.confirmed.role, 'payroll');
  // An administrator's list includes the Finance office types.
  assert.ok((await s.admin.get(`/api/hris/recruitment/applications/${app.id}/appointment`)).choices.roles.some((r) => r.id === 'accountant'));
  // The staff appointer still confirms an internal applicant, whose account does not change.
  const it = await s.item({ itemNo: 'ADO2-001', positionTitle: 'Administrative Officer II', salaryGrade: 11 });
  const o = await s.opening(it, { audience: 'internal' });
  const eli = await s.signIn('eli');
  const own = await eli.post(`/api/hris/jobs/${o.id}/apply`, { note: '' });
  await s.select(own.id);
  const iv = await rico.get(`/api/hris/recruitment/applications/${own.id}/appointment`);
  const ia = await rico.post(`/api/hris/recruitment/applications/${own.id}/appointment`, { ...iv.draft, status: 'Permanent' });
  await rico.post(`/api/hris/appointments/${ia.id}/issue`, { kinds: ['appointment'] });
  const ok = await rico.post(`/api/hris/appointments/${ia.id}/confirm`, { role: 'hr' });
  assert.deepEqual([ok.confirmed.created, ok.confirmed.role, s.user('eli').role], [false, null, 'staff']);
});

test('an internal applicant: the record updated, a dated history row added, the old item released, nothing overwritten', async () => {
  const s = await school();
  const oldItem = await s.item({ itemNo: 'ADA4-009', positionTitle: 'Administrative Aide IV', salaryGrade: 4 });
  await s.hr.post(`/api/hris/plantilla/${oldItem.id}/incumbent`, { employeeId: s.eliEmp.id });
  const it = await s.item({ itemNo: 'ADO2-001', positionTitle: 'Administrative Officer II', salaryGrade: 11 });
  const o = await s.opening(it, { audience: 'internal', vacancies: 2 });
  const eli = await s.signIn('eli');
  const app = await eli.post(`/api/hris/jobs/${o.id}/apply`, { note: '' });
  await s.select(app.id);
  const v = await s.hr.get(`/api/hris/recruitment/applications/${app.id}/appointment`);
  assert.deepEqual([v.draft.firstName, v.draft.middleName, v.draft.lastName, v.draft.address, v.draft.nature, v.plan.kind], ['Eli', 'Santos', 'Cruz', 'Pili, Camarines Sur', 'promotion', 'update']);
  assert.ok(v.plan.warnings.some((w) => /holds item ADA4-009 now/.test(w)));
  const appt = await s.hr.post(`/api/hris/recruitment/applications/${app.id}/appointment`, { ...v.draft, status: 'Permanent', effectiveDate: '2026-11-16' });
  await s.hr.post(`/api/hris/appointments/${appt.id}/issue`, { kinds: ['appointment'] });
  const done = await s.hr.post(`/api/hris/appointments/${appt.id}/confirm`, {});
  assert.deepEqual([done.confirmed.created, done.offerClose, done.vacanciesLeft, done.confirmed.releasedItem], [false, false, 1, 'ADA4-009']);
  const emp = await s.hr.get(`/api/hris/employees/${s.eliEmp.id}`);
  assert.deepEqual([emp.position, emp.salaryGrade, emp.step, emp.appointment, emp.hireDate, emp.plantillaItem], ['Administrative Officer II', 11, 1, 'Permanent', '2020-01-06', 'ADO2-001'], 'the date hired stays');
  const h1 = (await s.hr.get(`/api/hris/employees/${s.eliEmp.id}/appointments`)).history;
  assert.deepEqual(h1.map((r) => [r.from, r.to, r.position, r.salaryGrade, r.source]), [['2020-01-06', '2026-11-15', 'Administrative Aide IV', 4, 'record'], ['2026-11-16', '', 'Administrative Officer II', 11, 'appointment']]);
  assert.equal((await s.hr.get(`/api/hris/plantilla/${oldItem.id}`)).status, 'vacant');
  assert.equal((await s.hr.get(`/api/hris/plantilla/${oldItem.id}`)).previousIncumbent.name, 'Eli Cruz');
  // A later appointment adds a row; the earlier ones stay as they were.
  const it2 = await s.item({ itemNo: 'ADO3-001', positionTitle: 'Administrative Officer III', salaryGrade: 14 });
  s.clock.add(30);
  const o2 = await s.opening(it2, { audience: 'internal', closingDate: '2026-12-20' });
  const app2 = await eli.post(`/api/hris/jobs/${o2.id}/apply`, { note: '' });
  await s.select(app2.id);
  const v2 = await s.hr.get(`/api/hris/recruitment/applications/${app2.id}/appointment`);
  const appt2 = await s.hr.post(`/api/hris/recruitment/applications/${app2.id}/appointment`, { ...v2.draft, status: 'Permanent' });
  await s.hr.post(`/api/hris/appointments/${appt2.id}/issue`, { kinds: ['appointment'] });
  await s.hr.post(`/api/hris/appointments/${appt2.id}/confirm`, {});
  const h2 = (await s.hr.get(`/api/hris/employees/${s.eliEmp.id}/appointments`)).history;
  assert.equal(h2.length, 3);
  assert.deepEqual(h2.slice(0, 2).map((r) => [r.from, r.position]), h1.map((r) => [r.from, r.position]));
  assert.equal(h2[1].to, '2026-12-02');
  // The employee sees the history and the papers in My HR record.
  const mine = await eli.get('/api/hris/me/appointment-papers');
  assert.deepEqual([mine.appointments.length, mine.history.length], [2, 3]);
  // Nobody appoints themselves.
  const hanaOpening = await s.opening(await s.item({ itemNo: 'HR-1', positionTitle: 'HRMO IV', salaryGrade: 22 }), { audience: 'internal', closingDate: '2026-12-20' });
  const hana = s.hr;
  const own = await hana.post(`/api/hris/jobs/${hanaOpening.id}/apply`, { note: '' });
  const iris = await s.signIn('iris');
  await iris.put(`/api/hris/recruitment/applications/${own.id}`, { stage: 'selected' });
  const ownDraft = (await hana.get(`/api/hris/recruitment/applications/${own.id}/appointment`)).draft;
  await assert.rejects(hana.post(`/api/hris/recruitment/applications/${own.id}/appointment`, { ...ownDraft, status: 'Permanent' }), (e) => e.status === 403 && /yourself/.test(e.message));
});

test('the opening\'s vacancies count down, and no more are appointed than it has', async () => {
  const s = await school();
  const { o, app } = await selected(s);
  const appt = await appoint(s, app.id);
  await s.hr.post(`/api/hris/appointments/${appt.id}/issue`, { kinds: ['appointment'] });
  await s.hr.post(`/api/hris/appointments/${appt.id}/confirm`, {});
  const b = await s.signUp('Ben Torres');
  s.data.jobOpenings.find((x) => x.id === o.id).closingDate = '2026-11-30';
  const app2 = await b.post(`/api/hris/jobs/${o.id}/apply`, { note: '' });
  await s.select(app2.id);
  await assert.rejects(appoint(s, app2.id, { plantillaItemId: '' }), /All 1 vacancy of this opening are filled/);
  await s.hr.put(`/api/hris/recruitment/openings/${o.id}`, { status: 'closed' });
  assert.equal((await s.hr.get(`/api/hris/recruitment/openings/${o.id}`)).status, 'closed');
});

test('the date of assumption fills the Certificate of Assumption, issued then; changing it needs Cancel and reissue', async () => {
  const s = await school();
  const { app } = await selected(s);
  const appt = await appoint(s, app.id);
  await s.hr.post(`/api/hris/appointments/${appt.id}/issue`, { kinds: ['appointment'] });
  await s.hr.post(`/api/hris/appointments/${appt.id}/confirm`, {});
  await assert.rejects(s.hr.post(`/api/hris/appointments/${appt.id}/assumption`, { date: '2026-11-02' }), /cannot be before the date of signing/);
  await assert.rejects(s.hr.post(`/api/hris/appointments/${appt.id}/assumption`, { date: '2026-11-09' }), /cannot be in the future/);
  s.clock.add(6);
  const r = await s.hr.post(`/api/hris/appointments/${appt.id}/assumption`, { date: '2026-11-09', issue: true });
  const cert = r.papers.find((p) => p.kind === 'assumption');
  assert.deepEqual([cert.refNo, cert.issuedOn, r.fields.assumptionDate], ['APT2026-0002', '2026-11-09', '2026-11-09']);
  const paper = await s.hr.get(`/api/hris/appointments/${appt.id}/papers/${cert.id}`);
  assert.match(plainText(paper.snapshot.parts.body), /^This is to certify that Carla Reyes Mendiola has assumed the duties and responsibilities as Administrative Assistant III of the Accounting Office, .*, effective November 9, 2026\./);
  assert.match(plainText(paper.snapshot.parts.closing), /Done this November 9, 2026 in Pili, Camarines Sur\./);
  await assert.rejects(s.hr.post(`/api/hris/appointments/${appt.id}/assumption`, { date: '2026-11-08' }), /use Cancel and reissue/);
  const re = await s.hr.post(`/api/hris/appointments/${appt.id}/papers/${cert.id}/cancel`, { reason: 'Assumed a day earlier.', fields: { assumptionDate: '2026-11-08' } });
  const neu = await s.hr.get(`/api/hris/appointments/${appt.id}/papers/${re.reissued}`);
  assert.match(plainText(neu.snapshot.parts.body), /effective November 8, 2026/);
  assert.ok(s.trail().some((e) => e.action === 'Appointment: recorded the date of assumption' && e.changes[0].to === '2026-11-09'));
});

test('demo data: a selected demo applicant appointed with papers issued, marked demo', () => {
  const data = memoryDb().data;
  data.users.push({ id: 'admin', role: 'admin', username: 'admin', name: 'Admin', campusIds: [] });
  addDemo(data, '2026-11-26');
  const [appt] = data.appointments;
  assert.ok(appt.demo && appt.confirmed);
  assert.deepEqual(appt.papers.map((p) => [p.kind, p.status]), [['appointment', 'issued'], ['oath-fil', 'issued']]);
  const u = data.users.find((x) => x.id === appt.userId);
  assert.deepEqual([u.role, u.demo, u.expiresAt], ['staff', true, undefined]);
  const emp = data.employees.find((e) => e.id === appt.employeeId);
  assert.ok(emp.demo && emp.appointmentHistory.length === 1);
  assert.equal(data.plantillaItems.find((i) => i.id === appt.fields.plantillaItemId).incumbentId, emp.id);
  assert.ok(data.workExperience.some((e) => e.ownerKind === 'employee' && e.ownerId === emp.id), 'the applicant\'s work experience moved to the record');
  // Removing the demo removes it.
  addDemo(data, '2026-11-26');
  assert.equal(data.appointments.length, 1, 'adding again refreshes instead of doubling');
});
