// Work experience in ATLAS People (HRIS requests PL-023 and the work-experience section of PL-017; the
// "add another" at the end of the list meets PL-032 for this section). shared/work-experience.js has
// the fields and rules.
//
//  - Who keeps the entries: an employee on their own record (People → My HR record), and a job
//    applicant on their applicant account (People → My work experience). Each list is in the
//    person's own order; the Work Experience Sheet prints it newest first.
//  - HR (employees.view to read, employees.edit to add, change, verify and import) sees an employee's
//    entries on the employee record, and an applicant's on the applicant profile and their
//    applications (hris.recruitment). HR verifies entries; an entry changed after it was verified is
//    not verified any more. Nobody verifies their own.
//  - An applicant changes their entries until an application of theirs is Selected: from then on the
//    entries are what the appointment is made from, and HR keeps them (they move to the employee
//    record when the applicant becomes an employee; server/appointment.js).
//  - Every change (added, changed, moved, removed, verified, not verified, imported) is in the audit
//    log (People), with the values before and after. Anyone else's entry is "not found".
import { randomUUID } from 'node:crypto';
import { HttpError } from './util.js';
import { t } from './validate.js';
import { campusName, campusesFor } from './campus.js';
import { notOwnRecord } from './hris-leave.js';
import { userCan } from '../shared/roles.js';
import { parseCsv } from '../shared/csv.js';
import { LIMITS, cleanEntry, entryChanges, newestFirst, entriesFromCsv } from '../shared/work-experience.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
const ENTRY_BODY = {
  from: t.str(20), to: t.str(20), present: t.any(), position: t.str(400), office: t.str(400), agency: t.str(400), location: t.str(400),
  supervisor: t.str(400), appointmentStatus: t.str(400), government: t.any(), salaryGrade: t.any(), step: t.any(), monthlySalary: t.any(),
  duties: t.str(6000), accomplishments: t.any(),
};
const ACCOMPLISHMENTS = (v) => (Array.isArray(v) ? v.slice(0, 200).map((x) => String(x ?? '').slice(0, 2000)) : String(v ?? '').slice(0, 20000));

export const workEntries = (data) => (data.workExperience ||= []);
// The entries of one person (kind: 'employee' | 'applicant'), in their own order.
export const entriesOf = (data, kind, id) => workEntries(data).filter((e) => e.ownerKind === kind && e.ownerId === id).sort((a, b) => a.order - b.order);
// Moves a person's entries to another owner (an applicant who became an employee), keeping their
// verification and order after the new owner's own entries. Returns how many moved.
export function moveEntries(data, from, to, at = new Date().toISOString()) {
  const list = entriesOf(data, from.kind, from.id);
  let next = entriesOf(data, to.kind, to.id).reduce((m, e) => Math.max(m, e.order), 0);
  for (const e of list) Object.assign(e, { ownerKind: to.kind, ownerId: to.id, order: ++next, movedAt: at, movedFrom: from.kind });
  return list.length;
}
// The entries of a record or account that is removed (employee records, applicant accounts).
export function forgetEntries(data, kind, ids) {
  const gone = new Set(ids);
  data.workExperience = workEntries(data).filter((e) => !(e.ownerKind === kind && gone.has(e.ownerId)));
}

// What the screens get.
const entryView = (e, today) => ({
  id: e.id, order: e.order, from: e.from, to: e.to, present: Boolean(e.present), position: e.position, office: e.office, agency: e.agency, location: e.location,
  supervisor: e.supervisor, appointmentStatus: e.appointmentStatus, government: Boolean(e.government), salaryGrade: e.salaryGrade ?? null, step: e.step ?? null,
  monthlySalary: e.monthlySalary ?? null, duties: e.duties || '', accomplishments: e.accomplishments || [],
  verified: e.verified ? { at: e.verified.at, by: e.verified.by } : null,
  unverifiedAfterChange: Boolean(e.unverifiedAt), createdAt: e.createdAt, updatedAt: e.updatedAt || null, by: e.updatedBy || e.createdBy || '',
  current: Boolean(e.present) && e.from <= today,
});

export function registerWorkExperienceRoutes(route, ctx) {
  const data = () => ctx.db.data;
  const save = () => ctx.db.save();
  const iso = () => ctx.now().toISOString();
  const today = () => ctx.today();
  const employeeIn = (campusId, id) => data().employees.find((e) => e.id === id && e.campusId === campusId) || fail('Employee not found at this campus.', 404);
  const userById = (id) => data().users.find((u) => u.id === id) || null;
  const fullName = (e) => [e.firstName, e.middleName, e.lastName].filter(Boolean).join(' ');

  // ----- Owners -----
  const employeeOwner = (emp) => ({ kind: 'employee', id: emp.id, name: fullName(emp), emp });
  const applicantOwner = (u) => ({ kind: 'applicant', id: u.id, name: u.name, user: u });
  // The signed-in person's own list: an applicant's account, or the employee record linked to the account.
  function self(user) {
    if (user.role === 'applicant') return applicantOwner(user);
    const emp = user.employeeId && data().employees.find((e) => e.id === user.employeeId);
    if (!emp) fail('Your account is not linked to an employee record yet. Ask HR to link it.', 403);
    return employeeOwner(emp);
  }
  // An applicant may change their entries until an application of theirs is Selected.
  function lockOf(owner) {
    if (owner.kind !== 'applicant') return '';
    const chosen = (data().jobApplications || []).some((a) => a.userId === owner.id && a.status === 'selected');
    return chosen ? 'HR has selected you for a position, so your work experience is now kept by HR for your appointment. Ask HR to correct an entry.' : '';
  }
  const list = (owner) => entriesOf(data(), owner.kind, owner.id);
  const entryOf = (owner, id) => list(owner).find((e) => e.id === id) || fail('Entry not found.', 404);

  const log = (user, owner, entry, action, { changes = [], detail = '', ip = '', agent = '' } = {}) => ctx.audit?.({
    kind: 'change', system: 'people', action: `Work experience: ${action}`, actor: user, target: { id: entry?.id || owner.id, name: `${owner.name}${entry ? ` · ${entry.position}` : ''}` },
    ip, agent, detail: detail || `${owner.kind === 'employee' ? 'Employee record' : 'Applicant'}: ${owner.name}`, changes,
  });

  // ----- Reading -----
  const listView = (owner, { canEdit, canVerify = false, lockedReason = '' }) => {
    const rows = list(owner);
    return {
      owner: { kind: owner.kind, id: owner.id, name: owner.name },
      entries: rows.map((e) => entryView(e, today())),
      canEdit: canEdit && !lockedReason, canVerify, lockedReason, max: LIMITS.entries, today: today(),
      verified: rows.filter((e) => e.verified).length,
    };
  };
  // The Work Experience Sheet: the person, their entries newest first, the school.
  const sheet = (owner, user) => {
    const emp = owner.emp || null;
    return {
      person: { name: owner.name, kind: owner.kind, position: emp?.position || '', office: emp?.department || '', campusName: emp ? campusName(data(), emp.campusId) : '' },
      entries: newestFirst(list(owner)).map((e) => entryView(e, today())),
      school: { name: data().settings.schoolName, address: data().hrSettings?.employerAddress || '' },
      printedAt: iso(), printedBy: user.name, today: today(),
    };
  };

  // ----- Changing -----
  function add(user, owner, body, meta) {
    if (list(owner).length >= LIMITS.entries) fail(`At most ${LIMITS.entries} entries.`);
    const { entry, error } = cleanEntry(body, today());
    if (error) fail(error);
    const at = iso();
    const order = list(owner).reduce((m, e) => Math.max(m, e.order), 0) + 1;
    const e = { id: randomUUID(), ownerKind: owner.kind, ownerId: owner.id, order, ...entry, verified: null, createdAt: at, createdBy: user.name, createdById: user.id };
    workEntries(data()).push(e);
    log(user, owner, e, 'added an entry', { ...meta, changes: entryChanges({}, e) });
    save();
    return entryView(e, today());
  }
  function change(user, owner, id, body, meta) {
    const e = entryOf(owner, id);
    const { entry, error } = cleanEntry(body, today());
    if (error) fail(error);
    const changes = entryChanges(e, entry);
    if (!changes.length) return entryView(e, today());
    const wasVerified = Boolean(e.verified);
    Object.assign(e, entry, { updatedAt: iso(), updatedBy: user.name, updatedById: user.id });
    if (wasVerified) {
      changes.push({ field: 'Verified', from: `Yes (${e.verified.by})`, to: 'No: changed after it was verified' });
      e.verified = null;
      e.unverifiedAt = e.updatedAt;
    }
    log(user, owner, e, wasVerified ? 'changed a verified entry (no longer verified)' : 'changed an entry', { ...meta, changes });
    save();
    return entryView(e, today());
  }
  function remove(user, owner, id, meta) {
    const e = entryOf(owner, id);
    data().workExperience = workEntries(data()).filter((x) => x.id !== e.id);
    log(user, owner, e, 'removed an entry', { ...meta, changes: entryChanges(e, {}) });
    save();
    return { ok: true };
  }
  function reorder(user, owner, ids, meta) {
    const rows = list(owner);
    const want = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
    if (want.length !== rows.length || rows.some((e) => !want.includes(e.id))) fail('Send every entry once, in the new order.');
    const before = rows.map((e) => e.position);
    want.forEach((id, i) => (rows.find((e) => e.id === id).order = i + 1));
    const after = list(owner).map((e) => e.position);
    if (before.join('|') !== after.join('|')) {
      log(user, owner, null, 'changed the order of the entries', { ...meta, changes: [{ field: 'Order', from: before.join(' / '), to: after.join(' / ') }] });
      save();
    }
    return listView(owner, { canEdit: true });
  }
  function verify(user, owner, id, verified, meta) {
    const e = entryOf(owner, id);
    if (owner.kind === 'employee') notOwnRecord(user, owner.id, 'verify work experience');
    if (owner.kind === 'applicant' && owner.id === user.id) fail('You cannot verify your own entries.', 403);
    if (Boolean(e.verified) === Boolean(verified)) return entryView(e, today());
    const at = iso();
    e.verified = verified ? { at, by: user.name, byId: user.id } : null;
    delete e.unverifiedAt;
    log(user, owner, e, verified ? 'verified an entry' : 'marked an entry not verified', { ...meta, changes: [{ field: 'Verified', from: verified ? 'No' : 'Yes', to: verified ? `Yes (${user.name})` : 'No' }] });
    save();
    return entryView(e, today());
  }
  // CSV import (HR, for an employee's long history): all rows or none.
  function importCsv(user, owner, csv, meta) {
    const { rows, error } = parseCsv(String(csv || ''));
    if (error) fail(error);
    const { entries, errors } = entriesFromCsv(rows, today());
    if (errors.length) fail(`Nothing was imported. ${errors.slice(0, 6).join(' ')}${errors.length > 6 ? ` And ${errors.length - 6} more.` : ''}`);
    if (list(owner).length + entries.length > LIMITS.entries) fail(`Nothing was imported: a person has at most ${LIMITS.entries} entries (${list(owner).length} now, ${entries.length} in the file).`);
    const at = iso();
    let order = list(owner).reduce((m, e) => Math.max(m, e.order), 0);
    for (const entry of entries) workEntries(data()).push({ id: randomUUID(), ownerKind: owner.kind, ownerId: owner.id, order: ++order, ...entry, verified: null, createdAt: at, createdBy: user.name, createdById: user.id, imported: true });
    log(user, owner, null, `imported ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} from a CSV file`, { ...meta, detail: `Employee record: ${owner.name} · ${entries.map((e) => e.position).join(', ').slice(0, 300)}` });
    save();
    return { imported: entries.length, ...listView(owner, { canEdit: true, canVerify: true }) };
  }
  const meta = ({ ip, agent }) => ({ ip, agent });

  // ----- The person themselves (employee self-service, job applicants) -----
  const mine = { applicants: true, audit: false };
  route('GET', '/api/hris/me/work-experience', 'hris', ({ user }) => {
    const owner = self(user);
    return listView(owner, { canEdit: true, lockedReason: lockOf(owner) });
  }, mine);
  const editable = (user) => {
    const owner = self(user);
    const locked = lockOf(owner);
    if (locked) fail(locked, 403);
    return owner;
  };
  route('POST', '/api/hris/me/work-experience', 'hris', (a) => add(a.user, editable(a.user), { ...a.body, accomplishments: ACCOMPLISHMENTS(a.body.accomplishments) }, meta(a)), { ...mine, body: ENTRY_BODY });
  route('POST', '/api/hris/me/work-experience/order', 'hris', (a) => reorder(a.user, editable(a.user), a.body.ids, meta(a)), { ...mine, body: { ids: t.arr(t.str(100), LIMITS.entries + 1) } });
  route('GET', '/api/hris/me/work-experience/sheet', 'hris', ({ user }) => sheet(self(user), user), mine);
  route('PUT', '/api/hris/me/work-experience/:id', 'hris', (a) => change(a.user, editable(a.user), a.params.id, { ...a.body, accomplishments: ACCOMPLISHMENTS(a.body.accomplishments) }, meta(a)), { ...mine, body: ENTRY_BODY });
  route('DELETE', '/api/hris/me/work-experience/:id', 'hris', (a) => remove(a.user, editable(a.user), a.params.id, meta(a)), mine);

  // ----- HR: an employee's entries (on the employee record) -----
  const hrOwner = ({ campusId, params }) => employeeOwner(employeeIn(campusId, params.id));
  route('GET', '/api/hris/employees/:id/work-experience', 'hris:employees.view', (a) => listView(hrOwner(a), { canEdit: userCan(a.user, 'employees.edit'), canVerify: userCan(a.user, 'employees.edit') }), { audit: false });
  route('GET', '/api/hris/employees/:id/work-experience/sheet', 'hris:employees.view', (a) => sheet(hrOwner(a), a.user), { audit: false });
  route('POST', '/api/hris/employees/:id/work-experience', 'hris:employees.edit', (a) => add(a.user, hrOwner(a), { ...a.body, accomplishments: ACCOMPLISHMENTS(a.body.accomplishments) }, meta(a)), { audit: false, body: ENTRY_BODY });
  route('POST', '/api/hris/employees/:id/work-experience/order', 'hris:employees.edit', (a) => reorder(a.user, hrOwner(a), a.body.ids, meta(a)), { audit: false, body: { ids: t.arr(t.str(100), LIMITS.entries + 1) } });
  route('POST', '/api/hris/employees/:id/work-experience/import', 'hris:employees.edit', (a) => importCsv(a.user, hrOwner(a), a.body.csv, meta(a)), { audit: false, body: { csv: t.str(500000) } });
  route('PUT', '/api/hris/employees/:id/work-experience/:entryId', 'hris:employees.edit', (a) => change(a.user, hrOwner(a), a.params.entryId, { ...a.body, accomplishments: ACCOMPLISHMENTS(a.body.accomplishments) }, meta(a)), { audit: false, body: ENTRY_BODY });
  route('DELETE', '/api/hris/employees/:id/work-experience/:entryId', 'hris:employees.edit', (a) => remove(a.user, hrOwner(a), a.params.entryId, meta(a)), { audit: false });
  route('POST', '/api/hris/employees/:id/work-experience/:entryId/verify', 'hris:employees.edit', (a) => verify(a.user, hrOwner(a), a.params.entryId, a.body.verified !== false, meta(a)), { audit: false, body: { verified: t.bool() } });

  // ----- HR: an applicant's entries (applicant profile, applications) -----
  // A job applicant's own list; for an employee who applied (Internal), the list on their record.
  // An employee's list is campus-scoped like the employee record: HR reads it when the employee is at
  // one of HR's campuses or applied to an opening there, and verifies it only at the employee's campus.
  const hrCampusIds = (user) => new Set(campusesFor(data(), user).map((c) => c.id));
  const mayVerifyEmployee = (user, emp) => userCan(user, 'employees.edit') && hrCampusIds(user).has(emp.campusId);
  function personOwner(user, userId) {
    const u = userById(userId);
    const apps = (data().jobApplications || []).filter((a) => a.userId === userId);
    if (!u || (u.role !== 'applicant' && !apps.length)) fail('Applicant not found.', 404);
    if (u.role === 'applicant') return applicantOwner(u);
    const emp = u.employeeId && data().employees.find((e) => e.id === u.employeeId);
    if (!emp) fail('Applicant not found.', 404);
    const ids = hrCampusIds(user);
    const appliedHere = apps.some((a) => !a.removed && ids.has((data().jobOpenings || []).find((o) => o.id === a.openingId)?.campusId));
    if (!ids.has(emp.campusId) && !appliedHere) fail('Applicant not found.', 404);
    return employeeOwner(emp);
  }
  route('GET', '/api/hris/recruitment/people/:userId/work-experience', 'hris:hris.recruitment', ({ user, params }) => {
    const owner = personOwner(user, params.userId);
    return listView(owner, { canEdit: false, canVerify: owner.kind === 'applicant' || mayVerifyEmployee(user, owner.emp) });
  }, { audit: false });
  route('GET', '/api/hris/recruitment/people/:userId/work-experience/sheet', 'hris:hris.recruitment', ({ user, params }) => sheet(personOwner(user, params.userId), user), { audit: false });
  route('POST', '/api/hris/recruitment/people/:userId/work-experience/:entryId/verify', 'hris:hris.recruitment', (a) => {
    const owner = personOwner(a.user, a.params.userId);
    if (owner.kind === 'employee' && !mayVerifyEmployee(a.user, owner.emp)) fail('Verify an employee\'s entries on their employee record.', 403);
    return verify(a.user, owner, a.params.entryId, a.body.verified !== false, meta(a));
  }, { audit: false, body: { verified: t.bool() } });
  // From an application (People → Recruitment → an opening): the applicant's sheet.
  route('GET', '/api/hris/recruitment/applications/:id/work-experience/sheet', 'hris:hris.recruitment', ({ user, params }) => {
    const a = (data().jobApplications || []).find((x) => x.id === params.id) || fail('Application not found.', 404);
    const o = (data().jobOpenings || []).find((x) => x.id === a.openingId);
    if (!o || !hrCampusIds(user).has(o.campusId) || a.removed) fail('Application not found.', 404);
    if (a.internal && a.employeeId) {
      const emp = data().employees.find((e) => e.id === a.employeeId) || fail('Application not found.', 404);
      return sheet(employeeOwner(emp), user);
    }
    const u = userById(a.userId);
    if (!u) fail('Application not found.', 404);
    // An applicant who has become an employee: their entries are on the record now.
    const emp = u.role !== 'applicant' && u.employeeId ? data().employees.find((e) => e.id === u.employeeId) : null;
    return sheet(emp ? employeeOwner(emp) : applicantOwner(u), user);
  }, { audit: false });

  return { entriesOf: (kind, id) => entriesOf(data(), kind, id), moveEntries: (from, to) => moveEntries(data(), from, to, iso()) };
}

// ----- Demo data: entries for a few demo employees and the demo applicant (demo: true) -----
export function addWorkExperienceDemo(data, today, { employees, applicant }) {
  const list = workEntries(data);
  const at = new Date(`${today}T08:00:00`).toISOString();
  const add = (kind, id, rows, verifiedBy = '') => rows.forEach((r, i) => {
    const { entry, error } = cleanEntry(r, today);
    if (error) throw new Error(`Demo work experience: ${error}`);
    list.push({ id: randomUUID(), demo: true, ownerKind: kind, ownerId: id, order: i + 1, ...entry, verified: verifiedBy && r.verified !== false ? { at, by: verifiedBy, byId: null } : null, createdAt: at, createdBy: 'Demo data' });
  });
  const HR = 'Josefina Dimaculangan';
  for (const [emp, rows, by] of employees) if (emp) add('employee', emp.id, rows, by ?? HR);
  if (applicant) add('applicant', applicant.id, [
    {
      from: '2024-06-17', present: true, position: 'Part-time Instructor', office: 'College of Information Technology', agency: 'Example Private College', location: 'Naga City, Camarines Sur',
      supervisor: 'Dean, College of Information Technology', appointmentStatus: 'Part-time', government: false, monthlySalary: 18000,
      duties: 'Teaches two sections of Computer Programming 1 and one of Data Structures each semester; prepares the course packs and grades the laboratory exercises.',
      accomplishments: ['Wrote the laboratory manual for Computer Programming 1 now used by the department', 'Coached the team that placed second in the regional programming contest (demo)'],
    },
    {
      from: '2021-07-01', to: '2024-05-31', position: 'Junior Web Developer', office: 'Software Team', agency: 'Example Software Services, Inc.', location: 'Pili, Camarines Sur',
      supervisor: 'Team Lead, Software Team', appointmentStatus: 'Regular', government: false, monthlySalary: 22000,
      duties: 'Built and maintained web applications for clients; wrote automated tests and fixed reported defects.',
      accomplishments: ['Moved three client sites to a supported framework version'],
    },
  ]);
}
export function removeWorkExperienceDemo(data) {
  data.workExperience = workEntries(data).filter((e) => !e.demo);
}
