// The plantilla register (People → Plantilla; HRIS request PL-014, with PL-045 and PL-052):
// one record per position (item), as DBM issued it, with its incumbent, and the printed PSIPOP.
//
//  - Permission hris.plantilla (HR managers) records and changes items, links incumbents and sets
//    the signatories; accounts with employees.view may read the register.
//  - Item numbers are DBM's: typed as given, required and unique (shared/plantilla.js). ATLAS never
//    makes one up.
//  - One item has one incumbent and one employee holds one item. Linking sets the item to Filled,
//    unlinking to Vacant. The appointment status stays on the employee record (PL-052) and is never
//    changed by linking. Job orders and contracts of service are not on the plantilla.
//  - The incumbent's name, sex, birth date, TIN, GSIS no., appointment, dates and actual salary are
//    read from their record each time (itemView), never copied. The employee record keeps only the
//    item number (employee.plantillaItem), set from the register, which payslips and the General
//    Payroll print.
//  - Item numbers typed on employee records before the register (free text) are moved into it at
//    start-up and on first use (migrate): matched by number, or recorded as a draft item "to review".
//    Nothing typed is lost: a number that cannot be linked stays on the record and is noted on the item.
//  - Every change is in the audit log (People), with the values before and after.
import { randomUUID } from 'node:crypto';
import { HttpError, text } from './util.js';
import { t } from './validate.js';
import { campusesFor, campusName } from './campus.js';
import { userCan } from '../shared/roles.js';
import { FUND_CLUSTERS, fundName } from '../shared/finance.js';
import { scheduleOn } from '../shared/gov-pay.js';
import {
  ITEM_STATUSES, SETTABLE_STATUSES, itemStatusLabel, normalizeItemNo, offPlantilla, authorizedSalary, actualSalary,
  filterItems, plantillaTotals, plantillaCsv, mergePlantillaSettings, PSIPOP_SIGNATURES,
} from '../shared/plantilla.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const iso = () => new Date().toISOString();

export const plantillaItems = (data) => (data.plantillaItems ||= []);
const employeeById = (data, id) => (id ? data.employees.find((e) => e.id === id) : null);
export const itemOf = (data, employeeId) => plantillaItems(data).find((i) => i.incumbentId && i.incumbentId === employeeId) || null;
const itemByNo = (data, no, exceptId = null) => {
  const n = normalizeItemNo(no);
  return n ? plantillaItems(data).find((i) => normalizeItemNo(i.itemNo) === n && i.id !== exceptId) || null : null;
};
const fullName = (e) => `${e.lastName}, ${e.firstName}${e.middleName ? ` ${e.middleName}` : ''}`;
const itemName = (i) => `Item ${i.itemNo} · ${i.positionTitle || 'position to review'}`;
const government = (data) => data.hrSettings?.payrollSystem !== 'private';

// The audit log, for a person (actor) or for ATLAS itself (actor null: the migration).
export const makeLog = (ctx, { user = null, ip = '', agent = '' } = {}) => (item, action, { changes = [], detail = '' } = {}) =>
  ctx.audit?.({ kind: 'change', system: 'people', action: `Plantilla: ${action}`, actor: user, target: { id: item.id, name: itemName(item) }, ip, agent, detail, changes });

// ----- What the screens get: the item, and its incumbent read from their record -----
export function itemView(data, item, date) {
  const emp = employeeById(data, item.incumbentId);
  const office = item.officeCode ? (data.finSettings?.offices || []).find((o) => o.code === item.officeCode) : null;
  const pap = item.pap ? (data.finSettings?.paps || []).find((p) => p.code === item.pap) : null;
  const { reviewNotes = [], ...rest } = item;
  return {
    ...rest,
    statusLabel: itemStatusLabel(item.status),
    campusName: campusName(data, item.campusId),
    officeName: office?.name || item.office || '',
    fundName: item.fundCluster ? fundName(item.fundCluster) : '',
    papName: pap?.name || '',
    reviewNotes,
    authorized: authorizedSalary(item, date),
    incumbent: emp ? {
      id: emp.id, employeeNo: emp.employeeNo, name: fullName(emp), lastName: emp.lastName, firstName: emp.firstName, middleName: emp.middleName || '',
      sex: emp.gender || '', birthDate: emp.birthDate || '', tin: emp.tin || '', gsisNo: emp.gsisNo || '',
      appointment: emp.appointment || emp.employmentStatus || '',
      // The record's date hired is its date of original appointment. The date of last promotion is
      // the effective date of the latest confirmed Promotion in the appointment history (as of the
      // date), or a later date typed on the record; eligibility stays blank until the record has it.
      originalAppointment: emp.hireDate || '', lastPromotion: lastPromotionOf(emp, date), eligibility: emp.eligibility || '',
      position: emp.position || '', salaryGrade: emp.salaryGrade || null, step: emp.salaryGrade ? Number(emp.step) || 1 : null,
      actualAnnual: actualSalary(emp, date), campusId: emp.campusId, campusName: campusName(data, emp.campusId), status: emp.status,
    } : null,
  };
}
// The date of last promotion: the latest of the date typed on the record (never overwritten) and the
// effective dates of the Promotion rows of the appointment history, up to `date`.
export function lastPromotionOf(emp, date = '9999-12-31') {
  const dates = (emp.appointmentHistory || []).filter((r) => r.nature === 'promotion' && r.from && r.from <= date).map((r) => r.from);
  if (emp.lastPromotionDate) dates.push(emp.lastPromotionDate);
  return dates.sort().at(-1) || '';
}
// The short form on an employee record.
export function itemSummary(data, employeeId) {
  const i = itemOf(data, employeeId);
  return i ? { id: i.id, itemNo: i.itemNo, positionTitle: i.positionTitle, salaryGrade: i.salaryGrade, status: i.status, review: Boolean(i.review) } : null;
}

// ----- Linking and unlinking an incumbent -----
function checkLink(data, item, emp) {
  if (!emp) fail('Employee not found.', 404);
  if (item.status === 'abolished') fail(`Item ${item.itemNo} is abolished: it can no longer have an incumbent.`);
  if (item.status === 'unfunded') fail(`Item ${item.itemNo} is unfunded: set it to Vacant once it is funded, then link the incumbent.`);
  if (item.incumbentId && item.incumbentId !== emp.id) {
    const other = employeeById(data, item.incumbentId);
    fail(`Item ${item.itemNo} is held by ${other ? `${other.firstName} ${other.lastName}` : 'another employee'}. Unlink them first.`);
  }
  if (offPlantilla(emp)) fail(`${emp.firstName} ${emp.lastName} is a ${emp.appointment || 'job order'} worker: job orders and contracts of service are not on the plantilla.`);
  const held = itemOf(data, emp.id);
  if (held && held.id !== item.id) fail(`${emp.firstName} ${emp.lastName} already holds item ${held.itemNo}. Unlink it there first: one employee holds one item.`);
}
// Sets the item to Filled. The employee record gets only the item number; its appointment status,
// salary grade and step stay exactly as they are (PL-052).
export function linkIncumbent(data, item, emp, log, detail = '') {
  checkLink(data, item, emp);
  if (item.incumbentId === emp.id) return false;
  const from = item.status;
  item.incumbentId = emp.id;
  item.status = 'filled';
  item.updatedAt = iso();
  emp.plantillaItem = item.itemNo;
  log?.(item, 'linked an incumbent', { detail, changes: [{ field: 'Incumbent', from: '', to: `${fullName(emp)} (${emp.employeeNo})` }, { field: 'Status', from: itemStatusLabel(from), to: 'Filled' }] });
  return true;
}
export function unlinkIncumbent(data, item, log, detail = '') {
  if (!item.incumbentId) return false;
  const emp = employeeById(data, item.incumbentId);
  // Kept for the appointment of whoever fills it next ("vice …", server/appointment.js).
  if (emp) item.previousIncumbent = { employeeId: emp.id, name: `${emp.firstName} ${emp.lastName}`, until: iso().slice(0, 10), reason: emp.separationDate ? 'was separated from the service' : '' };
  item.incumbentId = null;
  item.status = 'vacant';
  item.updatedAt = iso();
  if (emp && normalizeItemNo(emp.plantillaItem) === normalizeItemNo(item.itemNo)) emp.plantillaItem = '';
  log?.(item, 'unlinked the incumbent', { detail, changes: [{ field: 'Incumbent', from: emp ? `${fullName(emp)} (${emp.employeeNo})` : '(record removed)', to: '' }, { field: 'Status', from: 'Filled', to: 'Vacant' }] });
  return true;
}

// ----- From the item number typed on an employee record (before the register) -----
const note = (item, key, txt) => {
  item.reviewNotes ||= [];
  if (item.reviewNotes.some((n) => n.key === key)) return false;
  item.reviewNotes.push({ key, text: txt, at: iso() });
  item.review = true;
  return true;
};
// Links the employee to the item their record names, or records a draft item "to review" from it.
// A number that cannot be linked (the item is held by someone else, unfunded or abolished, or the
// employee is a job order) stays on the record, and the item says so. Returns what was done.
export function reconcileEmployee(data, emp, log) {
  if (!government(data)) return null;
  const held = itemOf(data, emp.id);
  if (held) {
    if (emp.plantillaItem !== held.itemNo) emp.plantillaItem = held.itemNo;
    return null;
  }
  const typed = text(emp.plantillaItem, 80);
  if (!typed) return null;
  const who = `${emp.firstName} ${emp.lastName} (${emp.employeeNo})`;
  let item = itemByNo(data, typed);
  let made = false;
  if (!item) {
    item = {
      id: randomUUID(), itemNo: typed, positionTitle: text(emp.position, 160), salaryGrade: emp.salaryGrade || null,
      campusId: emp.campusId, officeCode: '', office: text(emp.department, 160), division: '', fundCluster: '', pap: '',
      areaCode: '', areaType: '', level: '', status: 'vacant', dateCreated: '', authority: '', authorizedOverride: null, incumbentId: null,
      draft: true, review: true, reviewNotes: [], createdAt: iso(), createdBy: 'ATLAS (from an employee record)', ...(emp.demo ? { demo: true } : {}),
    };
    note(item, `from:${emp.id}`, `Recorded from the item number typed on ${who}'s record. Check it against DBM's list, and fill in the office, fund source and date created.`);
    plantillaItems(data).push(item);
    made = true;
    log?.(item, 'recorded a draft item from an employee record', { detail: `Typed on ${who}'s record`, changes: [{ field: 'Item number', from: '', to: item.itemNo }, { field: 'To review', from: '', to: 'Yes' }] });
  }
  try {
    checkLink(data, item, emp);
  } catch (err) {
    if (note(item, `conflict:${emp.id}`, `Also typed on ${who}'s record, who was not linked: ${err.message}`)) {
      log?.(item, 'flagged to review: an employee record names this item', { detail: err.message });
      return 'conflict';
    }
    return made ? 'draft' : null;
  }
  linkIncumbent(data, item, emp, log, 'From the item number on the employee record');
  return made ? 'draft' : 'linked';
}
// Start-up and first use: incumbents whose record is gone, mirrors, then every typed number.
export function migratePlantilla(data, log) {
  let changed = 0;
  const ids = new Set(data.employees.map((e) => e.id));
  for (const i of plantillaItems(data)) {
    if (i.incumbentId && !ids.has(i.incumbentId)) {
      i.incumbentId = null;
      i.status = 'vacant';
      changed++;
      log?.(i, 'unlinked an incumbent whose record was removed');
    } else if (!i.incumbentId && i.status === 'filled') {
      i.status = 'vacant';
      changed++;
    }
  }
  for (const emp of data.employees) {
    const before = emp.plantillaItem;
    if (reconcileEmployee(data, emp, log) || before !== emp.plantillaItem) changed++;
  }
  return changed;
}
// Employee records being removed: their items become vacant (server/hris.js deleteEmployees).
export function vacateFor(data, ids) {
  const out = [];
  for (const i of data.plantillaItems || []) {
    if (!i.incumbentId || !ids.has(i.incumbentId)) continue;
    i.incumbentId = null;
    if (i.status === 'filled') i.status = 'vacant';
    out.push(i);
  }
  return out;
}

// ----- Recording or changing an item -----
const FIELDS = {
  itemNo: 'Item number', positionTitle: 'Position title', salaryGrade: 'Salary grade', campusId: 'Campus', officeCode: 'Office',
  office: 'Office', division: 'Division', fundCluster: 'Fund cluster', pap: 'Program / activity / project', areaCode: 'Area code',
  areaType: 'Area type', level: 'Level', status: 'Status', dateCreated: 'Date created', authority: 'Authority or reference',
};
export const ITEM_BODY = {
  itemNo: t.str(200), positionTitle: t.str(400), salaryGrade: t.any(), campusId: t.str(100), officeCode: t.str(40), office: t.str(400),
  division: t.str(400), fundCluster: t.str(10), pap: t.str(60), areaCode: t.str(40), areaType: t.str(40), level: t.str(40),
  status: t.str(20), dateCreated: t.str(20), authority: t.str(600), overrideAmount: t.any(), overrideReason: t.str(600), reviewed: t.bool(),
  abolishReason: t.str(600),
};

export function registerPlantillaRoutes(route, ctx) {
  const data = () => ctx.db.data;
  const save = () => ctx.db.save();
  const today = () => ctx.today();
  const fin = () => data().finSettings || {};
  const settings = () => mergePlantillaSettings(data().settings.plantilla);
  const systemLog = makeLog(ctx);
  const migrate = () => {
    if (migratePlantilla(data(), systemLog)) save();
  };
  migrate();

  const canRead = (user) => userCan(user, 'hris.plantilla') || userCan(user, 'employees.view');
  const reader = (user) => (canRead(user) ? user : fail('Your account does not have access to the plantilla.', 403));
  const campusIds = (user) => new Set(campusesFor(data(), user).map((c) => c.id));
  const mine = (user) => {
    const ids = campusIds(user);
    return plantillaItems(data()).filter((i) => ids.has(i.campusId));
  };
  const itemFor = (user, id) => mine(user).find((i) => i.id === id) || fail('Plantilla item not found at your campuses.', 404);
  const asOfOf = (q) => (DATE_RE.test(q.asOf || '') ? q.asOf : today());
  const views = (user, date) => mine(user).map((i) => itemView(data(), i, date)).sort((a, b) => a.officeName.localeCompare(b.officeName) || (b.salaryGrade || 0) - (a.salaryGrade || 0) || a.itemNo.localeCompare(b.itemNo));
  const filtersOf = (q) => ({ campusId: q.campusId || '', office: q.office || '', fund: q.fund || '', status: q.status || '', salaryGrade: q.salaryGrade || '', q: q.q || '' });
  const choices = (user) => ({
    campuses: campusesFor(data(), user).map((c) => ({ id: c.id, name: c.name })),
    offices: (fin().offices || []).map((o) => ({ code: o.code, name: o.name })),
    funds: (fin().funds?.length ? fin().funds : FUND_CLUSTERS.map((f) => f.code)).map((code) => ({ code, name: fundName(code) })),
    paps: (fin().paps || []).map((p) => ({ code: p.code, name: p.name })),
    statuses: ITEM_STATUSES,
  });

  function clean(input, user, existing = null) {
    const m = { ...(existing || {}), ...input };
    const item = {
      itemNo: text(m.itemNo, 80).replace(/\s+/g, ' '),
      positionTitle: text(m.positionTitle, 160),
      salaryGrade: m.salaryGrade === '' || m.salaryGrade == null ? null : Math.round(Number(m.salaryGrade)),
      division: text(m.division, 160),
      areaCode: text(m.areaCode, 20), areaType: text(m.areaType, 20), level: text(m.level, 20),
      dateCreated: text(m.dateCreated, 10),
      authority: text(m.authority, 300),
    };
    if (!item.itemNo) fail('Item number is required: type it as DBM issued it.');
    const dup = itemByNo(data(), item.itemNo, existing?.id);
    if (dup) fail(`Item number ${item.itemNo} is already in the register (${dup.positionTitle || 'a draft'}${dup.status === 'abolished' ? ', abolished' : ''}). Item numbers are unique.`, 409);
    if (!item.positionTitle) fail('Position title is required.');
    if (!(item.salaryGrade >= 1 && item.salaryGrade <= 33)) fail('Salary grade must be 1 to 33.');
    if (item.dateCreated && !DATE_RE.test(item.dateCreated)) fail('Date created must be a date.');
    // Campus: one of the caller's.
    const campusId = text(m.campusId, 100) || existing?.campusId || null;
    if (!campusId || !campusIds(user).has(campusId)) fail('Place the item at one of your own campuses.', 403);
    item.campusId = campusId;
    // Office: from Finance's list where it has one, else as typed.
    const offices = fin().offices || [];
    item.officeCode = text(m.officeCode, 20).toUpperCase();
    if (item.officeCode) {
      const o = offices.find((x) => x.code === item.officeCode) || fail(`Office ${item.officeCode} is not in Finance's list of offices.`);
      item.office = o.name;
    } else item.office = text(m.office, 160);
    // Fund source (PL-045): a fund cluster Finance uses, and a program/activity/project from its list.
    const funds = fin().funds?.length ? fin().funds : FUND_CLUSTERS.map((f) => f.code);
    item.fundCluster = text(m.fundCluster, 2);
    if (!item.fundCluster) item.fundCluster = funds[0] || '01';
    if (!funds.includes(item.fundCluster)) fail(`Fund cluster ${item.fundCluster} is not one of the fund clusters in use in Finance (${funds.join(', ')}).`);
    const paps = fin().paps || [];
    item.pap = text(m.pap, 30);
    if (item.pap && paps.length && !paps.some((p) => p.code === item.pap)) fail(`Program/activity/project ${item.pap} is not in Finance's list.`);
    // Status: Filled only by linking; an item with an incumbent keeps it until unlinked.
    const status = text(m.status, 20) || existing?.status || 'vacant';
    if (existing?.incumbentId) {
      if (status !== 'filled') fail('This item has an incumbent: unlink them first, then change its status.');
      item.status = 'filled';
    } else {
      if (status === 'filled') fail('An item is filled by linking its incumbent (Link an incumbent).');
      if (!SETTABLE_STATUSES.includes(status)) fail('Pick a status: Vacant, Unfunded or Abolished.');
      item.status = status;
    }
    if (item.status === 'abolished' && existing?.status !== 'abolished') {
      item.abolishedAt = iso();
      item.abolishReason = text(input.abolishReason, 300);
    } else if (item.status !== 'abolished') {
      item.abolishedAt = null;
      item.abolishReason = '';
    }
    // The authorized annual salary: computed, unless HR types another amount with the reason.
    if ('overrideAmount' in input) {
      const raw = input.overrideAmount;
      if (raw === '' || raw == null) item.authorizedOverride = null;
      else {
        const amount = Math.round(Number(raw) * 100) / 100;
        if (!(amount > 0 && amount <= 1e8)) fail('The authorized annual salary typed must be more than zero.');
        const reason = text(input.overrideReason, 300);
        if (!reason) fail('Say why the authorized annual salary differs from the salary schedule.');
        const prev = existing?.authorizedOverride;
        item.authorizedOverride = prev && prev.amount === amount && prev.reason === reason ? prev : { amount, reason, by: user.name, at: iso() };
      }
    } else item.authorizedOverride = existing?.authorizedOverride || null;
    return item;
  }
  const show = (v, k) => {
    if (k === 'status') return itemStatusLabel(v);
    if (k === 'campusId') return v ? campusName(data(), v) : '';
    return v == null ? '' : String(v);
  };
  function diff(before, after) {
    const out = [];
    for (const [k, label] of Object.entries(FIELDS)) {
      if (k === 'officeCode' && before.office !== after.office) continue; // the office's name says it
      if (String(before[k] ?? '') !== String(after[k] ?? '')) out.push({ field: label, from: show(before[k], k), to: show(after[k], k) });
    }
    const amt = (o) => (o ? `${o.amount} (${o.reason})` : 'From the salary schedule');
    if (JSON.stringify(before.authorizedOverride || null) !== JSON.stringify(after.authorizedOverride || null)) out.push({ field: 'Authorized annual salary', from: amt(before.authorizedOverride), to: amt(after.authorizedOverride) });
    return out;
  }

  // ----- Reading (HR view access) -----
  route('GET', '/api/hris/plantilla', 'hris', ({ user, query }) => {
    reader(user);
    migrate();
    const date = asOfOf(query);
    const list = filterItems(views(user, date), filtersOf(query));
    return { asOf: date, schedule: scheduleOn(date).name, items: list, totals: plantillaTotals(list), choices: choices(user), canEdit: userCan(user, 'hris.plantilla'), canPost: userCan(user, 'hris.recruitment') };
  });
  route('GET', '/api/hris/plantilla/export', 'hris', ({ user, query }) => {
    reader(user);
    const date = asOfOf(query);
    return { raw: `﻿${plantillaCsv(filterItems(views(user, date), filtersOf(query)))}`, type: 'text/csv', headers: { 'Content-Disposition': `attachment; filename="plantilla-${date}.csv"` } };
  });
  // The PSIPOP: the rows in the order printed, with the header and the signatures.
  route('GET', '/api/hris/plantilla/psipop', 'hris', ({ user, query }) => {
    reader(user);
    const date = asOfOf(query);
    const f = filtersOf(query);
    const rows = filterItems(views(user, date), f);
    const s = settings();
    const sig = fin().signatories || {};
    return {
      asOf: date, schedule: scheduleOn(date).name, rows, totals: plantillaTotals(rows),
      entity: fin().entity?.name || data().settings.schoolName, address: fin().entity?.address || data().hrSettings?.employerAddress || '',
      campusName: f.campusId ? campusName(data(), f.campusId) : '',
      filters: { office: f.office, fund: f.fund, fundName: f.fund ? fundName(f.fund.split('|')[0]) : '', status: f.status, salaryGrade: f.salaryGrade },
      signatures: PSIPOP_SIGNATURES.map((x) => ({
        key: x.key, caption: x.caption,
        name: s[x.key].name || (x.fallback ? sig[x.fallback]?.name || '' : ''),
        title: s[x.key].title || (x.fallback && !s[x.key].name ? sig[x.fallback]?.title || '' : '') || x.defaultTitle,
      })),
    };
  });
  // Employees an item can be given to: at the caller's campuses, active, not job orders, holding no other item.
  route('GET', '/api/hris/plantilla/linkable', 'hris:hris.plantilla', ({ user }) => {
    const ids = campusIds(user);
    return data().employees
      .filter((e) => ids.has(e.campusId) && e.status === 'Active' && !offPlantilla(e) && !itemOf(data(), e.id))
      .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
      .map((e) => ({ id: e.id, name: fullName(e), employeeNo: e.employeeNo, position: e.position || '', salaryGrade: e.salaryGrade || null, step: e.step || null, appointment: e.appointment || e.employmentStatus || '', campusName: campusName(data(), e.campusId) }));
  });
  // For the employee record's picker: vacant items, and the one the employee holds.
  route('GET', '/api/hris/plantilla/choices', 'hris:employees.view', ({ user, query }) => {
    migrate();
    const current = query.employeeId ? itemOf(data(), query.employeeId) : null;
    return mine(user)
      .filter((i) => i.status === 'vacant' || (current && i.id === current.id))
      .sort((a, b) => a.itemNo.localeCompare(b.itemNo))
      .map((i) => ({ id: i.id, itemNo: i.itemNo, positionTitle: i.positionTitle, salaryGrade: i.salaryGrade, campusName: campusName(data(), i.campusId), status: i.status, review: Boolean(i.review) }));
  });
  route('GET', '/api/hris/plantilla/settings', 'hris', ({ user }) => {
    reader(user);
    return settings();
  });
  route('PUT', '/api/hris/plantilla/settings', 'hris:hris.plantilla', ({ body }) => {
    const next = settings();
    for (const { key } of PSIPOP_SIGNATURES) {
      if (!body[key] || typeof body[key] !== 'object') continue;
      next[key] = { name: text(body[key].name, 120), title: text(body[key].title, 120) };
    }
    data().settings.plantilla = next;
    save();
    return next;
  }, { body: Object.fromEntries(PSIPOP_SIGNATURES.map(({ key }) => [key, t.obj({ name: t.str(400), title: t.str(400) })])) });
  route('GET', '/api/hris/plantilla/:id', 'hris', ({ user, params, query }) => {
    reader(user);
    const item = itemFor(user, params.id);
    const date = asOfOf(query);
    const history = (ctx.auditLog?.entries() || []).filter((e) => e.targetId === item.id).slice(-100).reverse()
      .map((e) => ({ at: e.at, action: e.action.replace(/^Plantilla: /, ''), actor: e.actor || 'ATLAS', detail: e.detail, changes: e.changes }));
    const openings = (data().jobOpenings || []).filter((o) => o.plantillaItemId === item.id)
      .map((o) => ({ id: o.id, title: o.title, status: o.status, closingDate: o.closingDate }));
    return { ...itemView(data(), item, date), asOf: date, history, openings, canEdit: userCan(user, 'hris.plantilla'), canPost: userCan(user, 'hris.recruitment') };
  });

  // ----- Recording and changing items (hris.plantilla) -----
  route('POST', '/api/hris/plantilla', 'hris:hris.plantilla', ({ body, user, campusId, ip, agent }) => {
    const fields = clean({ campusId, ...body }, user);
    const item = { id: randomUUID(), ...fields, incumbentId: null, draft: false, review: false, reviewNotes: [], createdAt: iso(), createdBy: user.name };
    plantillaItems(data()).push(item);
    makeLog(ctx, { user, ip, agent })(item, 'recorded an item', { changes: diff({}, item) });
    save();
    return itemView(data(), item, today());
  }, { audit: false, body: ITEM_BODY });
  route('PUT', '/api/hris/plantilla/:id', 'hris:hris.plantilla', ({ params, body, user, ip, agent }) => {
    const item = itemFor(user, params.id);
    const before = structuredClone(item);
    const fields = clean(body, user, item);
    const changes = diff(before, { ...item, ...fields });
    Object.assign(item, fields);
    if (body.reviewed === true && item.review) {
      item.review = false;
      item.draft = false;
      changes.push({ field: 'To review', from: 'Yes', to: 'Reviewed' });
    }
    // The incumbent's record shows the item's number (and so do new payslips).
    const emp = employeeById(data(), item.incumbentId);
    if (emp) emp.plantillaItem = item.itemNo;
    if (!changes.length) return itemView(data(), item, today());
    Object.assign(item, { updatedAt: iso(), updatedBy: user.name });
    const action = item.status === 'abolished' && before.status !== 'abolished' ? 'abolished an item' : before.status === 'abolished' && item.status !== 'abolished' ? 'restored an abolished item' : 'changed an item';
    makeLog(ctx, { user, ip, agent })(item, action, { changes, detail: item.status === 'abolished' && item.abolishReason ? item.abolishReason : '' });
    save();
    return itemView(data(), item, today());
  }, { audit: false, body: ITEM_BODY });
  // A draft recorded from an employee record, or an item recorded by mistake, with no incumbent and
  // no job opening: removed. Any other item is abolished instead, so its history stays.
  route('DELETE', '/api/hris/plantilla/:id', 'hris:hris.plantilla', ({ params, user, ip, agent }) => {
    const item = itemFor(user, params.id);
    if (item.incumbentId) fail('This item has an incumbent: unlink them first.');
    if (!item.draft) fail('Only a draft item can be removed. Set an item recorded from DBM\'s list to Abolished instead, so its history is kept.');
    if ((data().jobOpenings || []).some((o) => o.plantillaItemId === item.id)) fail('A job opening was posted for this item: it cannot be removed.');
    data().plantillaItems = plantillaItems(data()).filter((i) => i.id !== item.id);
    makeLog(ctx, { user, ip, agent })(item, 'removed a draft item', { changes: [{ field: 'Item number', from: item.itemNo, to: '' }] });
    save();
    return { ok: true };
  }, { audit: false });
  route('POST', '/api/hris/plantilla/:id/incumbent', 'hris:hris.plantilla', ({ params, body, user, ip, agent }) => {
    const item = itemFor(user, params.id);
    const emp = data().employees.find((e) => e.id === body.employeeId && campusIds(user).has(e.campusId)) || fail('Employee not found at your campuses.', 404);
    if (emp.status !== 'Active') fail(`${emp.firstName} ${emp.lastName}'s record is inactive.`);
    linkIncumbent(data(), item, emp, makeLog(ctx, { user, ip, agent }), 'From the plantilla register');
    item.updatedBy = user.name;
    save();
    return itemView(data(), item, today());
  }, { audit: false, body: { employeeId: t.str(100) } });
  route('DELETE', '/api/hris/plantilla/:id/incumbent', 'hris:hris.plantilla', ({ params, user, ip, agent }) => {
    const item = itemFor(user, params.id);
    if (!item.incumbentId) fail('This item has no incumbent.');
    unlinkIncumbent(data(), item, makeLog(ctx, { user, ip, agent }), 'From the plantilla register');
    item.updatedBy = user.name;
    save();
    return itemView(data(), item, today());
  }, { audit: false });
  // "Post a job opening" for a vacant item (PL-027): what the opening form starts with.
  route('GET', '/api/hris/plantilla/:id/opening', 'hris:hris.recruitment', ({ params, user }) => {
    const item = itemFor(user, params.id);
    if (item.status !== 'vacant') fail(`Item ${item.itemNo} is ${itemStatusLabel(item.status).toLowerCase()}: only a vacant item can be posted.`);
    const v = itemView(data(), item, today());
    return { plantillaItemId: item.id, plantillaItem: item.itemNo, title: item.positionTitle, salaryGrade: item.salaryGrade, campusId: item.campusId, office: v.officeName };
  });

  return { migrate };
}

// ----- Demo data: one item per demo employee with a government appointment and an item number,
// a few vacant items (three of them the demo job openings' items) and one unfunded. All demo: true.
// A demo item the school's own records use (a job opening kept from the demo, a real appointment,
// a real employee holding it or naming it) is kept as the school's own record, marked keptFromDemo;
// a demo employee holding it is unlinked (it becomes Vacant). The rest go.
export function removePlantillaDemo(data, at = new Date().toISOString()) {
  const items = data.plantillaItems || [];
  const demoEmployees = new Set((data.employees || []).filter((e) => e.demo).map((e) => e.id));
  const realEmployees = (data.employees || []).filter((e) => !e.demo);
  const used = new Set([
    ...(data.jobOpenings || []).filter((o) => !o.demo).map((o) => o.plantillaItemId),
    ...(data.appointments || []).filter((x) => !x.demo).map((x) => x.fields?.plantillaItemId),
    ...realEmployees.map((e) => items.find((i) => i.incumbentId === e.id || (e.plantillaItem && i.itemNo === e.plantillaItem))?.id),
  ].filter(Boolean));
  for (const i of items.filter((x) => x.demo && used.has(x.id))) {
    delete i.demo;
    i.keptFromDemo = { at, note: 'Kept when the demo data was refreshed or removed: your own records use it. It is an ordinary record now; edit or abolish it as needed.' };
    if (i.incumbentId && demoEmployees.has(i.incumbentId)) Object.assign(i, { incumbentId: null, status: i.status === 'filled' ? 'vacant' : i.status });
  }
  data.plantillaItems = items.filter((i) => !i.demo);
}
// Offices of the demo Finance (server/finance-demo.js) by the demo employees' departments.
const DEMO_OFFICES = { 'College of Computing': 'CCS', 'College of Agriculture': 'CA', 'College of Business': 'CBM', "Registrar's Office": 'REG', 'Accounting Office': 'ACCT', Library: 'LIB', 'Human Resources': 'ADM' };
const GASS = '100000100001000';
const HIGHER_ED = '310100100001000';
export function addPlantillaDemo(data, today, { main, sipocot }) {
  const list = plantillaItems(data);
  const at = new Date(`${today}T08:00:00`).toISOString();
  const add = (rec) => {
    if (itemByNo(data, rec.itemNo)) return null;
    const item = {
      id: randomUUID(), demo: true, officeCode: DEMO_OFFICES[rec.office] || '', division: '', fundCluster: '01', areaCode: '', areaType: '', level: '',
      dateCreated: '', authority: 'Demo: as on the school\'s plantilla', authorizedOverride: null, incumbentId: null, status: 'vacant',
      draft: false, review: false, reviewNotes: [], createdAt: at, createdBy: 'Josefina Dimaculangan', ...rec,
    };
    list.push(item);
    return item;
  };
  for (const e of data.employees.filter((x) => x.demo && x.plantillaItem && !offPlantilla(x))) {
    const item = add({
      itemNo: e.plantillaItem, positionTitle: e.position.replace(/\s*\(.*\)$/, ''), salaryGrade: e.salaryGrade, campusId: e.campusId, office: e.department,
      pap: e.category === 'teaching' ? HIGHER_ED : GASS, dateCreated: e.hireDate,
    });
    if (item) Object.assign(item, { incumbentId: e.id, status: 'filled' });
  }
  const year = today.slice(0, 4);
  add({ itemNo: 'DEMO-INST1-0412-2026', positionTitle: 'Instructor I', salaryGrade: 12, campusId: main.id, office: 'College of Computing', pap: HIGHER_ED, dateCreated: `${year}-01-02` });
  add({ itemNo: 'DEMO-ADOF2-0107-2026', positionTitle: 'Administrative Officer II', salaryGrade: 11, campusId: main.id, office: 'Human Resources', pap: GASS, dateCreated: `${year}-01-02` });
  // The demo's closed opening (Administrative Assistant III): its item fell vacant when the incumbent retired.
  const adas = add({ itemNo: 'DEMO-ADAS3-0215-2026', positionTitle: 'Administrative Assistant III', salaryGrade: 9, campusId: main.id, office: 'Accounting Office', pap: GASS, dateCreated: `${Number(year) - 6}-01-02` });
  if (adas) adas.previousIncumbent = { employeeId: null, name: 'Rosalinda Pascual', until: `${year}-06-30`, reason: 'retired' };
  add({ itemNo: 'DEMO-LABT1-0033-2026', positionTitle: 'Laboratory Technician I', salaryGrade: 6, campusId: main.id, office: 'College of Agriculture', pap: HIGHER_ED, dateCreated: `${year}-01-02` });
  if (sipocot) add({ itemNo: 'DEMO-ASP1-0215-2026', positionTitle: 'Assistant Professor I', salaryGrade: 15, campusId: sipocot.id, office: 'Faculty', pap: HIGHER_ED, dateCreated: `${year}-01-02` });
  add({ itemNo: 'DEMO-ASCP1-0301-2026', positionTitle: 'Associate Professor I', salaryGrade: 19, campusId: main.id, office: 'College of Computing', pap: HIGHER_ED, status: 'unfunded', dateCreated: `${year}-01-02` });
}
