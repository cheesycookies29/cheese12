// Appointing a selected applicant, and the appointment papers (HRIS request PL-025). The papers'
// fields, merge fields and wording: shared/appointment.js.
//
//  - Appoint: on an application whose outcome is Selected, HR (hris.recruitment and hris.appoint)
//    opens the appointment form, pre-filled wherever ATLAS has the data, and checks every field: the
//    person, the position and plantilla item (vacant, or already the same person's), salary grade,
//    step and monthly salary (salaryFor), the nature and the status of the appointment (the status
//    is never inferred, PL-052), the person replaced (vice) and why, campus and office, the dates,
//    the signatories (HR settings → Appointment papers), publication and deliberation dates.
//  - Issue papers: each paper (the appointment form, the oath in Filipino or English, the
//    certificate of assumption) is frozen when issued: the rendered text, the template version
//    and its SHA-256, the signatories and the school's header as printed (the logo is kept once,
//    by its SHA-256, and never removed while a paper uses it), with a reference number from the
//    numbering engine (series "appointment"). A reprint comes from that snapshot, whatever changed
//    since, and says "Reprint of the document issued on …" (council round 1: the reprint rule).
//  - Changes after a paper is issued: Cancel and reissue, with a reason. The old paper is kept,
//    marked cancelled, with a link to the one that replaced it.
//  - Confirm the appointment: an external applicant becomes an employee (a new employee record
//    from their account, profile, work experience and the appointment; their applicant account
//    becomes a staff account with the same sign-in, and no longer closes or is removed); an
//    internal applicant's record gets the new position, grade, step and status, with a dated row
//    in their appointment history (never overwritten). The person is linked to the plantilla item
//    (Filled); the opening's vacancies count down, and HR is offered to close it when all are filled.
//  - Assumption: HR records the date the person assumed; the certificate of assumption is issued
//    then.
//  - The appointed person sees and prints their issued papers (My HR record → Appointment papers).
//  - Everything is in the audit log (People).
import { randomUUID, createHash } from 'node:crypto';
import { HttpError, text, localDate } from './util.js';
import { t } from './validate.js';
import { campusName, campusesFor } from './campus.js';
import { nextNumber } from './numbering.js';
import { validateEmployee, assignableRoles } from './hris.js';
import { itemOf, linkIncumbent, unlinkIncumbent, makeLog, plantillaItems } from './plantilla.js';
import { moveEntries } from './work-experience.js';
import { closeRenewals } from './due-dates.js';
import { ROLES, HRIS_ROLES, userCan } from '../shared/roles.js';
import { APPOINTMENTS, salaryFor, stepsIn } from '../shared/gov-pay.js';
import {
  PAPERS, paperInfo, paperLabel, NATURES, natureLabel, VICE_REASONS, SIGNATORIES, MERGE_FIELDS, TEMPLATE_PARTS, LIMITS, DEFAULT_NOTE, NEEDS_ACCOUNTS_NOTE,
  mergeAppointmentSettings, isDefaultWording, templateProblems, mergeValues, renderPart, plainText, statusSuggestions, writeDate, signingNotes,
} from '../shared/appointment.js';
import { openingAccepts } from '../shared/recruitment.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
const nameFrom = (f) => [f.firstName, f.middleName, f.lastName].filter(Boolean).join(' ');
const isReal = (s) => DATE_RE.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export const appointments = (data) => (data.appointments ||= []);
const government = (data) => data.hrSettings?.payrollSystem !== 'private';
export const appointmentSettings = (data) => mergeAppointmentSettings(data.settings?.appointmentPapers);
// The statuses HR may pick (never inferred from the item, PL-052).
export const statusChoices = (data) => statusSuggestions(government(data), APPOINTMENTS);

// ----- Fields -----
const SIG_BODY = t.obj({ name: t.str(400), title: t.str(400) });
export const FIELDS_BODY = {
  lastName: t.str(200), firstName: t.str(200), middleName: t.str(200), suffix: t.str(40), address: t.str(1000),
  position: t.str(400), plantillaItemId: t.str(100), itemNo: t.str(200), salaryGrade: t.any(), step: t.any(), monthlySalary: t.any(),
  nature: t.str(40), status: t.str(60), vice: t.str(400), viceEmployeeId: t.str(100), viceReason: t.str(400),
  campusId: t.str(100), office: t.str(400), agency: t.str(400), place: t.str(400),
  dateSigned: t.str(20), effectiveDate: t.str(20), assumptionDate: t.str(20), endDate: t.str(20),
  publicationFrom: t.str(20), publicationTo: t.str(20), publicationPlace: t.str(400), deliberationDate: t.str(20),
  signatories: t.obj(Object.fromEntries(SIGNATORIES.map((s) => [s.key, SIG_BODY]))),
};
const FIELD_LABELS = {
  lastName: 'Last name', firstName: 'First name', middleName: 'Middle name', suffix: 'Name extension', address: 'Home address', position: 'Position title',
  itemNo: 'Plantilla item no.', salaryGrade: 'Salary grade', step: 'Step', monthlySalary: 'Monthly salary', nature: 'Nature of appointment', status: 'Status of appointment',
  vice: 'Vice (the person replaced)', viceReason: 'Why the position is vacant', campusName: 'Campus', office: 'Office or unit', agency: 'Agency', place: 'Place',
  dateSigned: 'Date of signing', effectiveDate: 'Effective date', assumptionDate: 'Date of assumption', endDate: 'Appointment ends on', publicationFrom: 'Published from', publicationTo: 'Published until',
  publicationPlace: 'Where it was published', deliberationDate: 'Deliberation of the selection board',
};

// The paper's header as printed: the school's name and address, the agency, the seal (by its hash).
function headerSnapshot(data, f) {
  const b = data.settings.branding || {};
  let logo = '';
  if (b.logo) {
    logo = sha256(b.logo);
    data.paperAssets ||= {};
    data.paperAssets[logo] ||= { dataUrl: b.logo, firstUsedAt: new Date().toISOString() };
  }
  return { schoolName: data.settings.schoolName, address: data.hrSettings?.employerAddress || '', agency: f.agency || data.settings.schoolName, logo, mode: b.mode === 'school' ? 'school' : 'atlas', shortName: b.shortName || '' };
}
// Issue one paper: render its template with the appointment's fields and freeze it. Used by the
// routes and the demo. Returns the paper.
export function issuePaper(data, appt, kind, { by, byId = null, at = new Date().toISOString(), date = localDate(new Date(at)) }) {
  const info = paperInfo(kind) || fail('Pick a paper to issue.');
  const s = appointmentSettings(data);
  const tpl = s.templates[kind];
  const values = mergeValues(appt.fields, info.lang, { dateIssued: date });
  const parts = Object.fromEntries(TEMPLATE_PARTS[kind].map(([k]) => [k, renderPart(tpl.parts[k], values)]));
  const paper = {
    id: randomUUID(), kind, refNo: nextNumber(data, 'appointment', { date }), status: 'issued', issuedAt: at, issuedOn: date, issuedBy: by, issuedById: byId, prints: [],
    snapshot: {
      kind, title: info.title, label: info.label, lang: info.lang, parts, values,
      fields: structuredClone(appt.fields), signatories: structuredClone(appt.fields.signatories || {}),
      template: { kind, version: tpl.version, sha256: sha256(JSON.stringify(tpl.parts)), defaultWording: isDefaultWording(kind, tpl) },
      header: headerSnapshot(data, appt.fields), formNo: s.formNumbers[kind] || '',
    },
  };
  appt.papers.push(paper);
  return paper;
}
export const currentPaper = (appt, kind) => appt.papers.find((p) => p.kind === kind && p.status === 'issued') || null;

// What "Confirm the appointment" does to the employee record: one row of the appointment history.
const historyRow = (appt, f, { by, at, source = 'appointment' }) => ({
  id: randomUUID(), from: f.effectiveDate, to: '', position: f.position, salaryGrade: f.salaryGrade || null, step: f.salaryGrade ? f.step || 1 : null, monthlySalary: f.monthlySalary ?? null,
  status: f.status, nature: f.nature, itemNo: f.itemNo || '', office: f.office || '', campusId: f.campusId, appointmentId: appt?.id || null, source, recordedAt: at, recordedBy: by,
});
const originalPermanent = (f) => f.nature === 'original' && f.status === 'Permanent';
const dayBefore = (ymd) => new Date(Date.parse(`${ymd}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

export function registerAppointmentRoutes(route, ctx, h) {
  const { data, save, iso, today, openings, applications, userById, employeeById, openingForHr, nameOf } = h;
  const settings = () => appointmentSettings(data());
  const audit = (user, appt, action, { changes = [], detail = '', ip = '', agent = '' } = {}) => ctx.audit({
    kind: 'change', system: 'people', action: `Appointment: ${action}`, actor: user, target: { id: appt.id, name: `${nameFrom(appt.fields)} · ${appt.fields.position}` }, ip, agent, detail, changes,
  });
  const mayAppoint = (user) => {
    if (!userCan(user, 'hris.recruitment') || !userCan(user, 'hris.appoint')) fail('Appointing needs both Recruitment and Appoint selected applicants (hris.appoint). Ask an administrator.', 403);
  };
  const campusIds = (user) => new Set(campusesFor(data(), user).map((c) => c.id));
  const appointmentFor = (user, id) => {
    const appt = appointments(data()).find((x) => x.id === id);
    if (!appt || !campusIds(user).has(appt.campusId)) fail('Appointment not found.', 404);
    return appt;
  };
  const applicationFor = (user, id) => {
    const a = applications().find((x) => x.id === id) || fail('Application not found.', 404);
    const o = openingForHr(user, a.openingId);
    return { a, o };
  };
  const ofApplication = (a) => appointments(data()).find((x) => x.applicationId === a.id) || null;
  // Appointments made effective on an opening (its vacancies count down).
  const filledOn = (o) => appointments(data()).filter((x) => x.openingId === o.id && x.confirmed).length;
  const itemById = (id) => (id ? plantillaItems(data()).find((i) => i.id === id) : null);
  const personEmployee = (a, appt = null) => employeeById(appt?.employeeId || (a.internal ? a.employeeId : null) || userById(a.userId)?.employeeId);

  // ----- Pre-filled values -----
  function deliberationOf(o) {
    const dates = applications().filter((x) => x.openingId === o.id).flatMap((x) => (x.history || []).filter((hh) => hh.stage === 'deliberation').map((hh) => hh.at));
    return dates.length ? localDate(new Date(dates.sort()[0])) : '';
  }
  function prefill(a, o) {
    const s = settings();
    const u = userById(a.userId);
    const emp = a.internal ? employeeById(a.employeeId) : null;
    const item = itemById(o.plantillaItemId);
    const parts = String(u?.name || '').trim().split(/\s+/);
    const name = emp ? { lastName: emp.lastName, firstName: emp.firstName, middleName: emp.middleName || '' } : { lastName: parts.length > 1 ? parts.at(-1) : '', firstName: parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '', middleName: '' };
    const salaryGrade = item?.salaryGrade || o.salaryGrade || null;
    const date = today();
    // The person replaced: the item's incumbent if it is still someone else, else the last incumbent.
    const holder = item?.incumbentId && item.incumbentId !== emp?.id ? employeeById(item.incumbentId) : null;
    const prev = holder ? { employeeId: holder.id, name: `${holder.firstName} ${holder.lastName}`, reason: '' } : item?.previousIncumbent || null;
    const nature = !emp ? 'original' : salaryGrade && emp.salaryGrade && salaryGrade > emp.salaryGrade ? 'promotion' : salaryGrade && emp.salaryGrade && salaryGrade < emp.salaryGrade ? 'demotion' : 'transfer';
    return {
      ...name, suffix: '', address: emp?.address || (u?.role === 'applicant' ? u.applicantProfile?.address || '' : '') || '',
      position: o.title || item?.positionTitle || '', plantillaItemId: item?.id || '', itemNo: item?.itemNo || o.plantillaItem || '',
      salaryGrade, step: salaryGrade ? 1 : null, monthlySalary: salaryGrade ? salaryFor(salaryGrade, 1, date) : null,
      nature, status: '', // never inferred (PL-052): HR picks it
      vice: prev?.name || '', viceEmployeeId: prev?.employeeId || '', viceReason: prev?.reason || '',
      campusId: o.campusId, office: o.office || item?.office || '', agency: s.agency || data().finSettings?.entity?.name || data().settings.schoolName, place: s.place || data().hrSettings?.employerAddress || '',
      dateSigned: date, effectiveDate: date, assumptionDate: '', endDate: '',
      publicationFrom: o.openedAt ? localDate(new Date(o.openedAt)) : localDate(new Date(o.createdAt)), publicationTo: o.closingDate || '', publicationPlace: '', deliberationDate: deliberationOf(o),
      signatories: Object.fromEntries(SIGNATORIES.map((x) => [x.key, { name: s.signatories[x.key].name, title: s.signatories[x.key].title || x.defaultTitle }])),
    };
  }

  // ----- Checking the fields -----
  function cleanFields(input, { a, o, appt = null, user }) {
    const f = {};
    const str = (k, max = 160) => text(input[k], max);
    for (const k of ['lastName', 'firstName', 'middleName']) f[k] = str(k, LIMITS.name);
    f.suffix = str('suffix', 20);
    f.address = str('address', 300);
    if (!f.lastName) fail('Last name is required.');
    if (!f.firstName) fail('First name is required.');
    f.position = str('position');
    if (!f.position) fail('Position title is required.');
    f.nature = NATURES.some(([k]) => k === input.nature) ? input.nature : fail(`Nature of appointment: pick one (${NATURES.map(([, l]) => l).join(', ')}).`);
    const statuses = statusChoices(data());
    f.status = statuses.includes(input.status) ? input.status : fail(`Status of appointment: pick one (${statuses.join(', ')}). It is never filled in for you.`);
    // The plantilla item: vacant, or already held by this person (or by the person it replaces, who is unlinked on confirming).
    const emp = personEmployee(a, appt);
    f.plantillaItemId = str('plantillaItemId', 100);
    f.viceEmployeeId = str('viceEmployeeId', 100);
    if (f.plantillaItemId) {
      const item = itemById(f.plantillaItemId);
      if (!item || !campusIds(user).has(item.campusId)) fail('Plantilla item not found at your campuses.', 404);
      if (item.status === 'abolished' || item.status === 'unfunded') fail(`Plantilla item ${item.itemNo} is ${item.status}: pick a vacant item.`);
      if (item.incumbentId && item.incumbentId !== emp?.id && item.incumbentId !== f.viceEmployeeId) {
        const other = employeeById(item.incumbentId);
        fail(`Plantilla item ${item.itemNo} is not vacant: ${other ? `${other.firstName} ${other.lastName}` : 'someone'} holds it. Pick a vacant item, or name them as the person replaced (vice) if they have left it.`);
      }
      const taken = appointments(data()).find((x) => x.id !== appt?.id && !x.confirmed && x.fields.plantillaItemId === item.id && x.papers.some((p) => p.status === 'issued'));
      if (taken) fail(`Plantilla item ${item.itemNo} is on another appointment being made (${nameFrom(taken.fields)}).`);
      f.itemNo = item.itemNo;
    } else f.itemNo = str('itemNo', 80);
    // Salary grade, step and monthly salary: from the salary schedule (government), or typed (private).
    const gov = government(data());
    const sg = input.salaryGrade === '' || input.salaryGrade == null ? null : Math.round(Number(input.salaryGrade));
    f.dateSigned = str('dateSigned', 10);
    f.effectiveDate = str('effectiveDate', 10);
    f.assumptionDate = str('assumptionDate', 10);
    if (!isReal(f.dateSigned)) fail('Date of signing: pick a date.');
    if (!isReal(f.effectiveDate)) fail('Effective date: pick a date.');
    if (f.effectiveDate < f.dateSigned) fail('The effective date cannot be before the date of signing.');
    if (f.assumptionDate) {
      if (!isReal(f.assumptionDate)) fail('Date of assumption: pick a real date, or leave it empty until the person assumes.');
      if (f.assumptionDate < f.dateSigned) fail('The date of assumption cannot be before the date of signing.');
      if (f.assumptionDate > today()) fail('The date of assumption cannot be in the future: record it once the person has assumed.');
    }
    // The end of the appointment (PL-053): for a temporary, casual, contractual, substitute or
    // coterminous appointment that has one; the record's "Appointment ends on" and the renewal alert.
    f.endDate = str('endDate', 10);
    if (f.endDate) {
      if (!isReal(f.endDate)) fail('Appointment ends on: pick a real date, or leave it empty.');
      if (f.endDate <= f.effectiveDate) fail('The appointment must end after its effective date.');
      if (f.status === 'Permanent') fail('A permanent appointment has no end date: leave "Appointment ends on" empty.');
    }
    if (gov) {
      if (sg == null) fail('Salary grade is required.');
      if (!(sg >= 1 && sg <= 33)) fail('Salary grade must be 1 to 33.');
      const step = Math.round(Number(input.step) || 1);
      if (!(step >= 1 && step <= stepsIn(sg))) fail(`Salary grade ${sg} has steps 1 to ${stepsIn(sg)}.`);
      Object.assign(f, { salaryGrade: sg, step, monthlySalary: salaryFor(sg, step, f.effectiveDate) });
    } else {
      const m = Math.round(Number(String(input.monthlySalary ?? '').replace(/[,₱\s]/g, '')) * 100) / 100;
      if (!(m > 0)) fail('Monthly salary is required.');
      Object.assign(f, { salaryGrade: null, step: null, monthlySalary: m });
    }
    f.vice = str('vice', LIMITS.name);
    f.viceReason = str('viceReason', 160);
    if (f.viceEmployeeId && !f.vice) f.viceEmployeeId = '';
    f.campusId = str('campusId', 100) || o.campusId;
    if (!campusIds(user).has(f.campusId)) fail('Pick one of your campuses.', 403);
    f.campusName = campusName(data(), f.campusId);
    f.office = str('office');
    if (!f.office) fail('Office or unit is required.');
    f.agency = str('agency', LIMITS.agency) || data().settings.schoolName;
    f.place = str('place', LIMITS.place);
    for (const k of ['publicationFrom', 'publicationTo', 'deliberationDate']) {
      f[k] = str(k, 10);
      if (f[k] && !isReal(f[k])) fail(`${FIELD_LABELS[k]}: pick a real date, or leave it empty.`);
    }
    if (f.publicationFrom && f.publicationTo && f.publicationTo < f.publicationFrom) fail('Published until cannot be before published from.');
    f.publicationPlace = str('publicationPlace', 200);
    f.signatories = {};
    for (const s of SIGNATORIES) {
      const v = input.signatories?.[s.key] || {};
      f.signatories[s.key] = { name: text(v.name, LIMITS.name), title: text(v.title, LIMITS.title) || s.defaultTitle };
    }
    if (!f.signatories.appointingOfficer.name) fail('Appointing officer: type the name (HR settings → Appointment papers fills it in).');
    if (!f.signatories.hrmo.name) fail('HRMO: type the name of the HRMO who certifies.');
    return f;
  }
  const diff = (before, after) => Object.entries(FIELD_LABELS).filter(([k]) => String(before?.[k] ?? '') !== String(after?.[k] ?? '')).map(([k, label]) => ({ field: label, from: String(before?.[k] ?? ''), to: String(after?.[k] ?? '') }))
    .concat(SIGNATORIES.filter((s) => JSON.stringify(before?.signatories?.[s.key] || {}) !== JSON.stringify(after?.signatories?.[s.key] || {})).map((s) => ({ field: s.label, from: [before?.signatories?.[s.key]?.name, before?.signatories?.[s.key]?.title].filter(Boolean).join(', '), to: [after.signatories[s.key].name, after.signatories[s.key].title].filter(Boolean).join(', ') })));

  // ----- What confirming will do (shown before HR confirms) -----
  function planOf(appt, a, o) {
    const f = appt?.fields || prefill(a, o);
    const emp = personEmployee(a, appt);
    const u = userById(a.userId);
    const item = itemById(f.plantillaItemId);
    const held = emp ? itemOf(data(), emp.id) : null;
    const warnings = [];
    if (item?.incumbentId && item.incumbentId !== emp?.id) {
      const v = employeeById(item.incumbentId);
      warnings.push(`${v ? `${v.firstName} ${v.lastName}` : 'The person replaced'} still holds item ${item.itemNo} in the plantilla register. Confirming unlinks them from this item only.`);
    }
    if (held && item && held.id !== item.id) warnings.push(`${emp.firstName} ${emp.lastName} holds item ${held.itemNo} now. Confirming releases it (it becomes Vacant) and links them to item ${item.itemNo}: one employee holds one item.`);
    if (!item) warnings.push('No plantilla item from the register: the record gets no item. Pick the item if the position has one.');
    const left = Math.max(0, (o.vacancies || 1) - filledOn(o) - (appt?.confirmed ? 0 : 1));
    // What would make Confirm refuse, known now: shown from the details step on, before the papers are
    // issued (the rule itself is at Confirm).
    const blockers = appt?.confirmed ? [] : confirmBlockers(f, a, emp, u);
    return {
      kind: emp ? 'update' : 'create',
      employee: emp ? { id: emp.id, employeeNo: emp.employeeNo, name: `${emp.firstName} ${emp.lastName}`, position: emp.position || '', salaryGrade: emp.salaryGrade || null, step: emp.step || null, appointment: emp.appointment || '' } : null,
      account: !emp && u ? { username: u.username, role: u.role, roleLabel: ROLES[u.role]?.label || u.role, expiresAt: u.expiresAt || null } : null,
      item: item ? { id: item.id, itemNo: item.itemNo, status: item.status } : null,
      releases: held && item && held.id !== item.id ? { id: held.id, itemNo: held.itemNo } : null,
      vacancies: o.vacancies || 1, filled: filledOn(o), leftAfter: left, warnings, blockers,
      signing: appt?.confirmed ? [] : signingNotes(f, { accepting: openingAccepts(o, today()), closingDate: o.closingDate }),
    };
  }
  // The conditions Confirm refuses, worded for before it: [] when none.
  function confirmBlockers(f, a, emp, u) {
    const out = [];
    if (emp) {
      const run = emp.campusId !== f.campusId && data().payrollRuns.find((r) => r.status === 'draft' && r.employeeIds.includes(emp.id));
      if (run) out.push(`${emp.firstName} ${emp.lastName} is in a draft payroll run at ${campusName(data(), emp.campusId)}${run.periodStart ? ' ' : ''}${run.periodStart ? `(${writeDate(run.periodStart)} to ${writeDate(run.periodEnd)})` : ''}. This appointment moves them to ${campusName(data(), f.campusId)}, and Confirm is refused until that run is finalized or deleted (Payroll). You can issue the papers meanwhile.`);
      if (emp.status !== 'Active') out.push(`${emp.firstName} ${emp.lastName}'s employee record is inactive: Confirm is refused until it is active again.`);
    } else if (!u || a.removed) out.push('The applicant\'s account was removed: Confirm cannot make the employee record. Add it by hand (Employees → Add employee).');
    else if (u.role !== 'applicant') out.push('This account is not a job applicant\'s account any more: Confirm cannot turn it into an employee\'s account.');
    return out;
  }

  // ----- What the screens get -----
  const paperSummary = (p) => ({
    id: p.id, kind: p.kind, label: paperLabel(p.kind), refNo: p.refNo, status: p.status, issuedAt: p.issuedAt, issuedOn: p.issuedOn, issuedBy: p.issuedBy,
    cancelledAt: p.cancelledAt || null, cancelledBy: p.cancelledBy || '', cancelReason: p.cancelReason || '', replacedBy: p.replacedById ? p.replacedByRef : '', replaces: p.replacesRef || '',
    prints: (p.prints || []).length, defaultWording: Boolean(p.snapshot.template.defaultWording),
  });
  const view = (appt) => ({
    id: appt.id, applicationId: appt.applicationId, openingId: appt.openingId, internal: appt.internal, employeeId: appt.employeeId || null, fields: appt.fields,
    natureLabel: natureLabel(appt.fields.nature), createdAt: appt.createdAt, createdBy: appt.createdBy, updatedAt: appt.updatedAt || null, updatedBy: appt.updatedBy || '',
    papers: appt.papers.map(paperSummary), confirmed: appt.confirmed || null,
    issued: Object.fromEntries(PAPERS.map((p) => [p.id, currentPaper(appt, p.id)?.refNo || ''])),
    locked: appt.papers.some((p) => p.status === 'issued'),
  });
  // A paper with what a print needs: the snapshot, the logo it was issued with, and whether it is a reprint.
  const paperView = (appt, p) => ({
    ...paperSummary(p), appointmentId: appt.id, openingId: appt.openingId, applicationId: appt.applicationId, snapshot: p.snapshot, logo: p.snapshot.header.logo ? data().paperAssets?.[p.snapshot.header.logo]?.dataUrl || '' : '',
    printLog: (p.prints || []).map((x) => ({ at: x.at, by: x.by })),
  });
  function choices(user) {
    const ids = campusIds(user);
    const s = settings();
    // The account types this user may give (as on Employees → Account): none without hris.accounts.
    const roles = assignableRoles(user);
    return {
      natures: NATURES, statuses: statusChoices(data()), viceReasons: VICE_REASONS, government: government(data()),
      campuses: campusesFor(data(), user).map((c) => ({ id: c.id, name: c.name })),
      items: plantillaItems(data()).filter((i) => ids.has(i.campusId) && !['abolished', 'unfunded'].includes(i.status))
        .map((i) => ({ id: i.id, itemNo: i.itemNo, positionTitle: i.positionTitle, salaryGrade: i.salaryGrade, status: i.status, office: i.office, incumbentId: i.incumbentId || null, campusName: campusName(data(), i.campusId) })),
      papers: PAPERS.map((p) => ({ ...p, defaultWording: isDefaultWording(p.id, s.templates[p.id]) })), defaultNote: DEFAULT_NOTE,
      roles: roles.map((r) => ({ id: r, label: ROLES[r].label })), mayMakeAccounts: userCan(user, 'hris.accounts'), signatories: SIGNATORIES,
    };
  }
  const salaryTable = (sg) => (sg ? Array.from({ length: stepsIn(sg) }, (_, i) => salaryFor(sg, i + 1, today())) : []);

  // ----- HR: the appointment of one application -----
  route('GET', '/api/hris/recruitment/applications/:id/appointment', 'hris:hris.recruitment', ({ params, user }) => {
    mayAppoint(user);
    const { a, o } = applicationFor(user, params.id);
    const appt = ofApplication(a);
    if (!appt && a.status !== 'selected') fail('Only an application whose outcome is Selected can be appointed.');
    return {
      application: { id: a.id, name: nameOf(a), internal: a.internal, status: a.status, userId: a.removed ? null : a.userId },
      opening: { id: o.id, title: o.title, vacancies: o.vacancies || 1, filled: filledOn(o), status: o.status, plantillaItem: o.plantillaItem || '', closingDate: o.closingDate || '', keptFromDemo: Boolean(o.keptFromDemo) },
      appointment: appt ? view(appt) : null, draft: appt ? null : prefill(a, o), plan: planOf(appt, a, o), choices: choices(user), salaries: salaryTable(appt?.fields.salaryGrade || prefill(a, o).salaryGrade),
    };
  }, { audit: false });
  route('GET', '/api/hris/appointments/salary', 'hris:hris.recruitment', ({ query, user }) => {
    mayAppoint(user);
    const sg = Math.round(Number(query.sg));
    if (!(sg >= 1 && sg <= 33)) return { salaries: [] };
    const date = DATE_RE.test(query.date || '') ? query.date : today();
    return { salaries: Array.from({ length: stepsIn(sg) }, (_, i) => salaryFor(sg, i + 1, date)) };
  }, { audit: false });
  route('POST', '/api/hris/recruitment/applications/:id/appointment', 'hris:hris.recruitment', ({ params, body, user, ip, agent }) => {
    mayAppoint(user);
    const { a, o } = applicationFor(user, params.id);
    if (a.status !== 'selected') fail('Only an application whose outcome is Selected can be appointed.');
    if (a.userId === user.id) fail('You cannot appoint yourself. Another HR person does.', 403);
    if (ofApplication(a)) fail('This application already has an appointment: open it.', 409);
    if (filledOn(o) >= (o.vacancies || 1)) fail(`All ${o.vacancies || 1} vacanc${(o.vacancies || 1) === 1 ? 'y' : 'ies'} of this opening are filled.`);
    const fields = cleanFields(body, { a, o, user });
    const at = iso();
    const emp = a.internal ? employeeById(a.employeeId) : null;
    const appt = { id: randomUUID(), applicationId: a.id, openingId: o.id, userId: a.userId, internal: Boolean(a.internal), employeeId: emp?.id || null, campusId: fields.campusId, fields, papers: [], confirmed: null, createdAt: at, createdBy: user.name, createdById: user.id };
    appointments(data()).push(appt);
    audit(user, appt, 'started the appointment', { ip, agent, changes: diff({}, fields), detail: `${o.title} · ${a.internal ? 'Internal' : 'External'} applicant` });
    save();
    return view(appt);
  }, { audit: false, body: FIELDS_BODY });
  route('PUT', '/api/hris/appointments/:id', 'hris:hris.recruitment', ({ params, body, user, ip, agent }) => {
    mayAppoint(user);
    const appt = appointmentFor(user, params.id);
    if (appt.papers.some((p) => p.status === 'issued')) fail('Papers have been issued for this appointment: to change them, use Cancel and reissue on the paper, with the reason.');
    const { a, o } = applicationFor(user, appt.applicationId);
    const fields = cleanFields(body, { a, o, appt, user });
    const changes = diff(appt.fields, fields);
    Object.assign(appt, { fields, campusId: fields.campusId, updatedAt: iso(), updatedBy: user.name });
    if (changes.length) audit(user, appt, 'changed the details', { ip, agent, changes });
    save();
    return view(appt);
  }, { audit: false, body: FIELDS_BODY });
  // A draft with no paper ever issued can be discarded.
  route('DELETE', '/api/hris/appointments/:id', 'hris:hris.recruitment', ({ params, user, ip, agent }) => {
    mayAppoint(user);
    const appt = appointmentFor(user, params.id);
    if (appt.papers.length || appt.confirmed) fail('Papers have been issued for this appointment, so it is kept. Cancel a paper instead.');
    data().appointments = appointments(data()).filter((x) => x.id !== appt.id);
    audit(user, appt, 'discarded the draft', { ip, agent });
    save();
    return { ok: true };
  }, { audit: false });

  // ----- Issuing, printing, cancelling and reissuing papers -----
  function checkIssuable(appt, kind) {
    if (!paperInfo(kind)) fail('Pick a paper to issue.');
    if (currentPaper(appt, kind)) fail(`The ${paperLabel(kind)} is already issued (${currentPaper(appt, kind).refNo}). To change it, use Cancel and reissue.`, 409);
    if (kind === 'assumption' && !appt.fields.assumptionDate) fail('Record the date of assumption first: the certificate states it.');
  }
  route('POST', '/api/hris/appointments/:id/issue', 'hris:hris.recruitment', ({ params, body, user, ip, agent }) => {
    mayAppoint(user);
    const appt = appointmentFor(user, params.id);
    const kinds = [...new Set((Array.isArray(body.kinds) ? body.kinds : []).map(String))];
    if (!kinds.length) fail('Tick the papers to issue.');
    for (const k of kinds) checkIssuable(appt, k);
    const at = iso();
    const out = kinds.map((k) => issuePaper(data(), appt, k, { by: user.name, byId: user.id, at, date: today() }));
    for (const p of out) audit(user, appt, `issued the ${paperLabel(p.kind)} ${p.refNo}`, { ip, agent, detail: `Template version ${p.snapshot.template.version}${p.snapshot.template.defaultWording ? ' (the built-in wording)' : ''} · signed by ${p.snapshot.signatories.appointingOfficer?.name || '—'}` });
    save();
    return view(appt);
  }, { audit: false, body: { kinds: t.arr(t.str(40), 10) } });
  route('GET', '/api/hris/appointments/:id/papers/:paperId', 'hris:hris.recruitment', ({ params, user }) => {
    mayAppoint(user);
    const appt = appointmentFor(user, params.id);
    const p = appt.papers.find((x) => x.id === params.paperId) || fail('Paper not found.', 404);
    return paperView(appt, p);
  }, { audit: false });
  // A print: kept with the paper (every print after the first is a reprint) and in the audit log.
  function printed(user, appt, p, { ip, agent }) {
    if (p.status !== 'issued') fail('This paper was cancelled: print the one that replaced it.');
    const reprint = (p.prints || []).length > 0 || today() !== p.issuedOn;
    (p.prints ||= []).push({ at: iso(), by: user.name, byId: user.id });
    audit(user, appt, `${reprint ? 'reprinted' : 'printed'} the ${paperLabel(p.kind)} ${p.refNo}`, { ip, agent, detail: reprint ? `Reprint of the paper issued on ${p.issuedOn}, from its snapshot` : '' });
    save();
    return { reprint, issuedOn: p.issuedOn, printedAt: iso(), printedBy: user.name };
  }
  route('POST', '/api/hris/appointments/:id/papers/:paperId/print', 'hris:hris.recruitment', ({ params, user, ip, agent }) => {
    mayAppoint(user);
    const appt = appointmentFor(user, params.id);
    const p = appt.papers.find((x) => x.id === params.paperId) || fail('Paper not found.', 404);
    return printed(user, appt, p, { ip, agent });
  }, { audit: false });
  // Cancel a paper, with the reason; with reissue (the default), changed fields are saved and the
  // paper is issued again with a new number. The cancelled one is kept.
  route('POST', '/api/hris/appointments/:id/papers/:paperId/cancel', 'hris:hris.recruitment', ({ params, body, user, ip, agent }) => {
    mayAppoint(user);
    const appt = appointmentFor(user, params.id);
    const p = appt.papers.find((x) => x.id === params.paperId) || fail('Paper not found.', 404);
    if (p.status !== 'issued') fail('This paper is already cancelled.');
    const reason = text(body.reason, 500);
    if (!reason) fail('Give the reason for cancelling. It is kept with the paper and in the audit log.');
    const reissue = body.reissue !== false;
    if (p.kind === 'appointment' && appt.confirmed && !reissue) fail('The appointment is confirmed: reissue the appointment form instead of only cancelling it.');
    let changes = [];
    if (reissue && body.fields && typeof body.fields === 'object') {
      const { a, o } = applicationFor(user, appt.applicationId);
        const fields = cleanFields({ ...appt.fields, ...body.fields, signatories: { ...appt.fields.signatories, ...(body.fields.signatories || {}) } }, { a, o, appt, user });
      changes = diff(appt.fields, fields);
      Object.assign(appt, { fields, campusId: fields.campusId, updatedAt: iso(), updatedBy: user.name });
    }
    if (p.kind === 'assumption' && reissue && !appt.fields.assumptionDate) fail('The certificate of assumption needs the date of assumption.');
    const at = iso();
    Object.assign(p, { status: 'cancelled', cancelledAt: at, cancelledBy: user.name, cancelledById: user.id, cancelReason: reason });
    let next = null;
    if (reissue) {
      next = issuePaper(data(), appt, p.kind, { by: user.name, byId: user.id, at, date: today() });
      Object.assign(p, { replacedById: next.id, replacedByRef: next.refNo });
      Object.assign(next, { replacesId: p.id, replacesRef: p.refNo });
    }
    audit(user, appt, reissue ? `cancelled the ${paperLabel(p.kind)} ${p.refNo} and reissued it as ${next.refNo}` : `cancelled the ${paperLabel(p.kind)} ${p.refNo}`, { ip, agent, detail: `Reason: ${reason}`, changes });
    save();
    return { ...view(appt), reissued: next ? next.id : null };
  }, { audit: false, body: { reason: t.str(2000), reissue: t.bool(), fields: t.obj(FIELDS_BODY) } });

  // ----- The date of assumption -----
  route('POST', '/api/hris/appointments/:id/assumption', 'hris:hris.recruitment', ({ params, body, user, ip, agent }) => {
    mayAppoint(user);
    const appt = appointmentFor(user, params.id);
    const date = text(body.date, 10);
    if (!isReal(date)) fail('Date of assumption: pick a date.');
    if (date < appt.fields.dateSigned) fail('The date of assumption cannot be before the date of signing.');
    if (date > today()) fail('The date of assumption cannot be in the future: record it once the person has assumed.');
    if (currentPaper(appt, 'assumption')) fail('The certificate of assumption is already issued: to change the date, use Cancel and reissue on it.');
    const from = appt.fields.assumptionDate || '';
    appt.fields.assumptionDate = date;
    // An original permanent appointment already confirmed: its probation counts from the assumption (PL-053).
    const emp = appt.confirmed && originalPermanent(appt.fields) ? employeeById(appt.employeeId) : null;
    if (emp && (!emp.originalAppointmentDate || emp.originalAppointmentDate === appt.fields.effectiveDate)) emp.originalAppointmentDate = date;
    appt.updatedAt = iso();
    appt.updatedBy = user.name;
    const out = body.issue === true ? issuePaper(data(), appt, 'assumption', { by: user.name, byId: user.id, at: iso(), date: today() }) : null;
    audit(user, appt, 'recorded the date of assumption', { ip, agent, changes: [{ field: 'Date of assumption', from, to: date }], detail: out ? `Issued the ${paperLabel('assumption')} ${out.refNo}` : '' });
    if (out) audit(user, appt, `issued the ${paperLabel('assumption')} ${out.refNo}`, { ip, agent, detail: `Template version ${out.snapshot.template.version}` });
    save();
    return view(appt);
  }, { audit: false, body: { date: t.str(20), issue: t.bool() } });

  // ----- Confirm the appointment: the person becomes an employee (or their record is updated) -----
  route('POST', '/api/hris/appointments/:id/confirm', 'hris:hris.recruitment', ({ params, body, user, ip, agent }) => {
    mayAppoint(user);
    const appt = appointmentFor(user, params.id);
    if (appt.confirmed) fail('This appointment is already confirmed.');
    if (!currentPaper(appt, 'appointment')) fail('Issue the appointment form first.');
    const { a, o } = applicationFor(user, appt.applicationId);
    if (filledOn(o) >= (o.vacancies || 1)) fail(`All ${o.vacancies || 1} vacanc${(o.vacancies || 1) === 1 ? 'y' : 'ies'} of this opening are filled.`);
    const f = appt.fields;
    const at = iso();
    const log = makeLog(ctx, { user, ip, agent });
    const item = itemById(f.plantillaItemId);
    let emp = personEmployee(a, appt);
    const created = !emp;
    const u = userById(a.userId);
    const gov = government(data());
    const rec = {
      position: f.position, department: f.office, salaryGrade: f.salaryGrade, step: f.step, appointment: gov ? f.status : '', employmentStatus: f.status,
      payType: 'monthly', rate: f.monthlySalary,
      // Due dates (PL-053): the new appointment's end (none: blank), and the start of probation of an original permanent appointment.
      appointmentEndDate: f.endDate || '',
      ...(originalPermanent(f) ? { originalAppointmentDate: f.assumptionDate || f.effectiveDate } : {}),
    };
    // Check everything first: nothing changes unless all of it can.
    if (item?.incumbentId && item.incumbentId !== emp?.id && item.incumbentId !== f.viceEmployeeId) fail(`Plantilla item ${item.itemNo} is held by someone else now. Change the item (Cancel and reissue the appointment form).`);
    let role = null;
    if (created) {
      if (!u || a.removed) fail('The applicant\'s account was removed: add the employee record by hand (Employees → Add employee).');
      if (u.role !== 'applicant') fail('This account is not a job applicant\'s account any more.');
      // The applicant account becomes an employee's account: that needs the right to manage
      // sign-in accounts (hris.accounts), and the type is one this user may give.
      if (!userCan(user, 'hris.accounts')) fail(NEEDS_ACCOUNTS_NOTE, 403);
      role = body.role || 'staff';
      if (!assignableRoles(user).includes(role)) fail(HRIS_ROLES.includes(role) ? 'Only an administrator makes Finance office accounts.' : 'Pick an account type you may give (Staff, HR or payroll).', 403);
      const p = u.applicantProfile || {};
      const fields = validateEmployee({
        firstName: f.firstName, middleName: f.middleName, lastName: f.lastName, email: u.email || '', phone: u.phone || '', birthDate: p.birthDate || '', gender: p.sex || '', address: f.address || p.address || '',
        hireDate: f.effectiveDate, status: 'Active', category: o.categoryId === 'faculty' ? 'teaching' : 'non-teaching', schedule: data().hrSettings.schedule, ...rec,
      }, data());
      emp = { id: randomUUID(), ...fields, campusId: f.campusId, createdAt: at, fromApplicantId: u.id, ...(appt.demo ? { demo: true } : {}) };
    } else {
      if (emp.status !== 'Active') fail(`${emp.firstName} ${emp.lastName}'s record is inactive.`);
      if (emp.campusId !== f.campusId && data().payrollRuns.some((r) => r.status === 'draft' && r.employeeIds.includes(emp.id))) fail('This employee is in a draft payroll run at their campus. Finalize or delete it before moving them to another campus.');
      validateEmployee({ ...emp, ...rec }, data(), emp.id);
    }
    // The employee record.
    if (created) {
      data().employees.push(emp);
      emp.appointmentHistory = [historyRow(appt, f, { by: user.name, at })];
      // The applicant's account becomes a staff account: the same sign-in; it no longer closes.
      const before = { role: u.role, expiresAt: u.expiresAt };
      a.signUpDetails = u.applicantProfile ? structuredClone(u.applicantProfile) : null; // what the applicant gave at sign-up stays with the application
      Object.assign(u, { role, employeeId: emp.id, campusIds: [f.campusId], status: 'active', convertedFromApplicantAt: at, convertedBy: user.name });
      for (const k of ['expiresAt', 'expiryWarnedAt', 'closedAt', 'poolExtendedFrom']) delete u[k];
      ctx.audit({ kind: 'account', system: 'people', action: 'Applicant account became a staff account (appointed)', actor: user, target: u, ip, agent, changes: [{ field: 'Account type', from: ROLES[before.role]?.label || before.role, to: ROLES[role].label }, { field: 'Open until', from: before.expiresAt || '', to: 'Does not close' }], detail: `${f.position} · same username and password` });
      ctx.signOutEverywhere(u.id); // the next sign-in opens People with the staff account
      const moved = moveEntries(data(), { kind: 'applicant', id: u.id }, { kind: 'employee', id: emp.id }, at);
      if (moved) audit(user, appt, `moved ${moved} work experience entr${moved === 1 ? 'y' : 'ies'} to the employee record`, { ip, agent });
    } else {
      // A renewal alert of the appointment this one replaces is done (People → Due dates).
      for (const o of closeRenewals(data(), emp, { by: user.name, byId: user.id, at, on: f.effectiveDate, note: `New appointment confirmed: ${f.position}, effective ${f.effectiveDate}` })) {
        ctx.audit({ kind: 'change', system: 'people', action: 'Due dates: renewal marked done (a new appointment was confirmed)', actor: user, target: { id: emp.id, name: `${emp.firstName} ${emp.lastName} (${emp.employeeNo})` }, ip, agent, detail: `Appointment ended ${o.due} · new appointment effective ${f.effectiveDate}` });
      }
      const hist = (emp.appointmentHistory ||= []);
      // Before the first appointment row: the record as it was, so the service record starts at the date hired.
      if (!hist.length) {
        const held = itemOf(data(), emp.id);
        hist.push({ ...historyRow(null, { effectiveDate: emp.hireDate, position: emp.position || '', salaryGrade: emp.salaryGrade, step: emp.step, monthlySalary: emp.salaryGrade ? salaryFor(emp.salaryGrade, emp.step || 1, f.effectiveDate) : emp.rate, status: emp.appointment || emp.employmentStatus || '', nature: '', itemNo: held?.itemNo || emp.plantillaItem || '', office: emp.department || '', campusId: emp.campusId }, { by: user.name, at, source: 'record' }) });
      }
      for (const r of hist) if (!r.to && r.from < f.effectiveDate) r.to = dayBefore(f.effectiveDate);
      hist.push(historyRow(appt, f, { by: user.name, at }));
      const before = { position: emp.position, salaryGrade: emp.salaryGrade, step: emp.step, appointment: emp.appointment || emp.employmentStatus };
      Object.assign(emp, validateEmployee({ ...emp, ...rec }, data(), emp.id), { campusId: f.campusId, updatedAt: at });
      const acct = data().users.find((x) => x.employeeId === emp.id);
      if (acct && HRIS_ROLES.includes(acct.role) && !acct.campusIds?.includes(f.campusId)) acct.campusIds = [f.campusId];
      audit(user, appt, 'updated the employee record', { ip, agent, changes: [['Position', before.position, emp.position], ['Salary grade', before.salaryGrade, emp.salaryGrade], ['Step', before.step, emp.step], ['Status of appointment', before.appointment, emp.appointment || emp.employmentStatus]].filter(([, x, y]) => String(x ?? '') !== String(y ?? '')).map(([field, from, to]) => ({ field, from: String(from ?? ''), to: String(to ?? '') })) });
    }
    // The plantilla item: the person replaced is unlinked from this item only; the appointee's old item is released.
    let releasedItem = null;
    let unlinkedVice = '';
    if (item) {
      if (item.incumbentId && item.incumbentId !== emp.id) {
        const v = employeeById(item.incumbentId);
        unlinkedVice = v ? `${v.firstName} ${v.lastName}` : '';
        unlinkIncumbent(data(), item, log, `Appointment of ${nameFrom(f)}: the person replaced`);
      }
      const held = itemOf(data(), emp.id);
      if (held && held.id !== item.id) {
        releasedItem = held.itemNo;
        unlinkIncumbent(data(), held, log, `Appointment of ${nameFrom(f)} to item ${item.itemNo}`);
      }
      linkIncumbent(data(), item, emp, log, `Appointment of ${nameFrom(f)}${created ? ' (new employee)' : ''}`);
    }
    appt.employeeId = emp.id;
    a.employeeId ||= emp.id;
    a.appointedAt = at;
    appt.confirmed = { at, by: user.name, byId: user.id, created, role, employeeId: emp.id, employeeNo: emp.employeeNo, itemNo: item?.itemNo || '', releasedItem, unlinkedVice };
    const left = Math.max(0, (o.vacancies || 1) - filledOn(o));
    audit(user, appt, created ? `made ${nameFrom(f)} an employee (${emp.employeeNo})` : `confirmed the appointment of ${nameFrom(f)}`, { ip, agent, detail: `${o.title} · ${item ? `item ${item.itemNo} Filled` : 'no plantilla item'} · ${left} of ${o.vacancies || 1} vacanc${(o.vacancies || 1) === 1 ? 'y' : 'ies'} left` });
    save();
    return { ...view(appt), offerClose: left === 0 && o.status !== 'closed', vacanciesLeft: left, employeeId: emp.id };
  }, { audit: false, body: { role: t.str(40) } });

  // ----- The employee record: appointment history and papers -----
  route('GET', '/api/hris/employees/:id/appointments', 'hris:employees.view', ({ params, user, campusId }) => {
    const emp = data().employees.find((e) => e.id === params.id && e.campusId === campusId) || fail('Employee not found at this campus.', 404);
    const canPapers = userCan(user, 'hris.recruitment') && userCan(user, 'hris.appoint');
    return {
      history: (emp.appointmentHistory || []).map((r) => ({ ...r, campusName: campusName(data(), r.campusId), natureLabel: natureLabel(r.nature) })),
      appointments: canPapers ? appointments(data()).filter((x) => x.employeeId === emp.id).map((x) => ({ ...view(x), title: openings().find((o) => o.id === x.openingId)?.title || x.fields.position })) : [],
      canPapers,
    };
  }, { audit: false });

  // ----- The appointed person: My HR record → Appointment papers -----
  const myEmployee = (user) => {
    const emp = user.employeeId && data().employees.find((e) => e.id === user.employeeId);
    if (!emp) fail('Your account is not linked to an employee record yet. Ask HR to link it.', 403);
    return emp;
  };
  const myPaper = (user, paperId) => {
    const emp = myEmployee(user);
    for (const appt of appointments(data()).filter((x) => x.employeeId === emp.id)) {
      const p = appt.papers.find((x) => x.id === paperId);
      if (p) return { appt, p };
    }
    return fail('Paper not found.', 404);
  };
  route('GET', '/api/hris/me/appointment-papers', 'hris', ({ user }) => {
    const emp = myEmployee(user);
    return {
      appointments: appointments(data()).filter((x) => x.employeeId === emp.id && x.papers.length).map((x) => ({
        id: x.id, position: x.fields.position, itemNo: x.fields.itemNo, effectiveDate: x.fields.effectiveDate, assumptionDate: x.fields.assumptionDate || '', confirmed: Boolean(x.confirmed),
        papers: x.papers.map(paperSummary),
      })),
      history: (emp.appointmentHistory || []).map((r) => ({ ...r, campusName: campusName(data(), r.campusId), natureLabel: natureLabel(r.nature) })),
    };
  }, { audit: false });
  route('GET', '/api/hris/me/appointment-papers/:paperId', 'hris', ({ user, params }) => {
    const { appt, p } = myPaper(user, params.paperId);
    return paperView(appt, p);
  }, { audit: false });
  route('POST', '/api/hris/me/appointment-papers/:paperId/print', 'hris', ({ user, params, ip, agent }) => {
    const { appt, p } = myPaper(user, params.paperId);
    if (p.status !== 'issued') fail('This paper was cancelled: print the one that replaced it.');
    (p.prints ||= []).push({ at: iso(), by: user.name, byId: user.id, self: true });
    audit(user, appt, `printed their copy of the ${paperLabel(p.kind)} ${p.refNo}`, { ip, agent });
    save();
    return { reprint: true, issuedOn: p.issuedOn, printedAt: iso(), printedBy: user.name };
  }, { audit: false });

  // ----- HR settings → Appointment papers (signatories, agency, wording) -----
  const settingsView = () => {
    const s = settings();
    return {
      ...s, papers: PAPERS.map((p) => ({ ...p, parts: TEMPLATE_PARTS[p.id].map(([key, label, text]) => ({ key, label, default: text })), defaultWording: isDefaultWording(p.id, s.templates[p.id]) })),
      mergeFields: MERGE_FIELDS, signatoryList: SIGNATORIES, defaultNote: DEFAULT_NOTE,
      agencyDefault: data().finSettings?.entity?.name || data().settings.schoolName, placeDefault: data().hrSettings?.employerAddress || '',
    };
  };
  route('GET', '/api/hris/appointment-papers/settings', 'hris', ({ user }) => {
    if (!userCan(user, 'hris.settings') && !userCan(user, 'hris.appoint')) fail('Your account does not have access to this.', 403);
    return settingsView();
  }, { audit: false });
  route('PUT', '/api/hris/appointment-papers/settings', 'hris:hris.settings', ({ body, user }) => {
    const next = settings();
    if (body.agency != null) next.agency = text(body.agency, LIMITS.agency);
    if (body.place != null) next.place = text(body.place, LIMITS.place);
    for (const s of SIGNATORIES) {
      const v = body.signatories?.[s.key];
      if (v && typeof v === 'object') next.signatories[s.key] = { name: text(v.name, LIMITS.name), title: text(v.title, LIMITS.title) };
    }
    for (const p of PAPERS) {
      const v = body.formNumbers?.[p.id];
      if (v != null) next.formNumbers[p.id] = text(v, LIMITS.formNo);
    }
    const problems = [];
    for (const p of PAPERS) {
      const incoming = body.templates?.[p.id]?.parts;
      if (!incoming || typeof incoming !== 'object') continue;
      const tpl = next.templates[p.id];
      const parts = { ...tpl.parts };
      for (const [key, label] of TEMPLATE_PARTS[p.id]) {
        if (typeof incoming[key] !== 'string') continue;
        const v = incoming[key].replace(/\r\n?/g, '\n').trim();
        if (v.length > LIMITS.part) problems.push(`${p.label} · ${label}: at most ${LIMITS.part} characters.`);
        if (key === 'body' && !v) problems.push(`${p.label} · ${label}: the main text cannot be empty.`);
        problems.push(...templateProblems(v, `${p.label} · ${label}`));
        parts[key] = v;
      }
      if (JSON.stringify(parts) !== JSON.stringify(tpl.parts)) next.templates[p.id] = { parts, version: tpl.version + 1, updatedAt: iso(), updatedBy: user.name };
    }
    if (problems.length) fail(`Not saved. ${problems.slice(0, 6).join(' ')}${problems.length > 6 ? ` And ${problems.length - 6} more.` : ''}`);
    data().settings.appointmentPapers = next;
    save();
    return settingsView();
  }, {
    body: {
      agency: t.str(1000), place: t.str(1000),
      signatories: t.obj(Object.fromEntries(SIGNATORIES.map((s) => [s.key, SIG_BODY]))),
      formNumbers: t.obj(Object.fromEntries(PAPERS.map((p) => [p.id, t.str(200)]))),
      templates: t.obj(Object.fromEntries(PAPERS.map((p) => [p.id, t.obj({ parts: t.obj(Object.fromEntries(TEMPLATE_PARTS[p.id].map(([k]) => [k, t.str(20000)]))), version: t.any(), updatedAt: t.any(), updatedBy: t.any() })]))),
    },
  });

  // For the recruitment screens: the appointment of an application, and an opening's filled count.
  return {
    summaryOf: (a) => {
      const appt = ofApplication(a);
      return appt ? { id: appt.id, confirmed: Boolean(appt.confirmed), issued: appt.papers.filter((p) => p.status === 'issued').length, assumed: Boolean(appt.fields.assumptionDate) } : null;
    },
    filledOn,
    plainText, writeDate,
  };
}

// ----- Demo: the signatories of HR settings → Appointment papers (made-up names), where HR has typed none -----
// Removed with the demo (removeAppointmentDemo) unless HR changed them since.
export const DEMO_SIGNATORIES = {
  appointingOfficer: { name: 'Dr. Ernesto Villaflor', title: 'University President' },
  hrmo: { name: 'Josefina Dimaculangan', title: 'Human Resource Management Officer III' },
  boardChair: { name: 'Dr. Cecilia Ramirez', title: 'Chairperson, HRMPSB' },
  headOfOffice: { name: 'Teodoro Malabuyoc', title: 'Chief Accountant' },
};
export function addAppointmentSettingsDemo(data) {
  const s = appointmentSettings(data);
  for (const [k, v] of Object.entries(DEMO_SIGNATORIES)) if (!s.signatories[k].name) s.signatories[k] = { ...v };
  data.settings.appointmentPapers = s;
}

// ----- Demo: the selected applicant of the closed demo opening, appointed with papers issued -----
// (server/recruitment.js addRecruitmentDemo). Runs the same steps as HR does, with demo: true.
export function addAppointmentDemo(data, today, { application, opening, user, by, at }) {
  const s = appointmentSettings(data);
  const item = (data.plantillaItems || []).find((i) => i.id === opening.plantillaItemId);
  const parts = user.name.split(/\s+/);
  const day = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const signed = day(-30);
  const sg = item?.salaryGrade || opening.salaryGrade;
  const fields = {
    lastName: parts.at(-1), firstName: parts.slice(0, -1).join(' '), middleName: 'Bautista', suffix: '', address: 'Purok 3, Barangay San Isidro, Pili, Camarines Sur',
    position: opening.title, plantillaItemId: item?.id || '', itemNo: item?.itemNo || opening.plantillaItem, salaryGrade: sg, step: 1, monthlySalary: salaryFor(sg, 1, signed),
    nature: 'original', status: 'Permanent', vice: item?.previousIncumbent?.name || '', viceEmployeeId: '', viceReason: item?.previousIncumbent?.reason || 'retired',
    campusId: opening.campusId, campusName: campusName(data, opening.campusId), office: opening.office, agency: s.agency || data.settings.schoolName, place: s.place || data.hrSettings?.employerAddress || 'Pili, Camarines Sur',
    dateSigned: signed, effectiveDate: day(-28), assumptionDate: '',
    publicationFrom: localDate(new Date(opening.createdAt)), publicationTo: opening.closingDate, publicationPlace: 'the school\'s website, bulletin boards and the CSC job portal (demo)', deliberationDate: day(-50),
    signatories: Object.fromEntries(Object.entries(DEMO_SIGNATORIES).map(([k, v]) => [k, { name: s.signatories[k].name || v.name, title: s.signatories[k].title || v.title }])),
  };
  const appt = { id: randomUUID(), demo: true, applicationId: application.id, openingId: opening.id, userId: user.id, internal: false, employeeId: null, campusId: opening.campusId, fields, papers: [], confirmed: null, createdAt: at(31), createdBy: by };
  appointments(data).push(appt);
  issuePaper(data, appt, 'appointment', { by, at: at(30), date: signed });
  issuePaper(data, appt, 'oath-fil', { by, at: at(28), date: day(-28) });
  // Made an employee: the account becomes a staff account (the same demo sign-in).
  const emp = {
    ...validateEmployee({
      firstName: fields.firstName, middleName: fields.middleName, lastName: fields.lastName, email: user.email || '', phone: user.phone || '', address: fields.address, gender: 'Male',
      position: fields.position, department: fields.office, salaryGrade: sg, step: 1, appointment: 'Permanent', employmentStatus: 'Permanent', payType: 'monthly', rate: fields.monthlySalary,
      hireDate: fields.effectiveDate, status: 'Active', category: 'non-teaching', schedule: data.hrSettings.schedule,
    }, data),
    id: randomUUID(), campusId: opening.campusId, createdAt: at(28), demo: true, fromApplicantId: user.id,
  };
  emp.appointmentHistory = [historyRow(appt, fields, { by, at: at(28) })];
  data.employees.push(emp);
  Object.assign(user, { role: 'staff', employeeId: emp.id, campusIds: [opening.campusId], status: 'active', convertedFromApplicantAt: at(28), convertedBy: by });
  for (const k of ['expiresAt', 'expiryWarnedAt', 'closedAt']) delete user[k];
  moveEntries(data, { kind: 'applicant', id: user.id }, { kind: 'employee', id: emp.id }, at(28));
  if (item) {
    Object.assign(item, { incumbentId: emp.id, status: 'filled' });
    emp.plantillaItem = item.itemNo;
  }
  appt.employeeId = emp.id;
  application.employeeId = emp.id;
  application.appointedAt = at(28);
  appt.confirmed = { at: at(28), by, byId: null, created: true, role: 'staff', employeeId: emp.id, employeeNo: emp.employeeNo, itemNo: item?.itemNo || '', releasedItem: null, unlinkedVice: '' };
  return { appt, emp };
}
// Demo appointments, and appointments made of demo people (their records go with the demo).
// Demo signatories in HR settings go too, unless HR has changed them since.
export function removeAppointmentDemo(data, { users = new Set(), employees = new Set() } = {}) {
  data.appointments = appointments(data).filter((x) => !x.demo && !users.has(x.userId) && !employees.has(x.employeeId));
  const s = data.settings?.appointmentPapers;
  if (s?.signatories) {
    for (const [k, v] of Object.entries(DEMO_SIGNATORIES)) {
      const now = s.signatories[k];
      if (now && now.name === v.name && now.title === v.title) s.signatories[k] = { name: '', title: '' };
    }
  }
}
