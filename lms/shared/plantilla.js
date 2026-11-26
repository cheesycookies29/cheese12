// The plantilla register in ATLAS People (HRIS request PL-014, with PL-045 and PL-052): one record per
// position (item) as DBM issued it, and the printed Personal Services Itemization and Plantilla of
// Personnel (PSIPOP). Shared by the server (server/plantilla.js) and the browser (People → Plantilla).
//
// Rules (the council on the HRIS requests, docs/council/2026-11-cbsua-requests):
//  - Item numbers are issued by DBM. ATLAS records them as given, never makes one up, and keeps
//    them unique.
//  - An item does not make anyone permanent (PL-052): the appointment status stays on the employee
//    record and is never inferred from the item.
//  - Job-order and contract-of-service workers are not on the plantilla.
//  - Everything about the incumbent is read from their employee record, never copied.
//
// The PSIPOP's columns are in one list (PSIPOP_COLUMNS) used for the print, the CSV and the
// register's own table, so they can be matched to the school's own copy of the DBM form by
// editing that list. Entries with `confirm: true` are to be checked against HR's sample.
import { salaryFor } from './gov-pay.js';

// ----- An item's status -----
// Filled and vacant follow the incumbent (linking fills, unlinking vacates); unfunded and abolished
// are set by HR. An abolished item is kept for history and left out of the default list.
export const ITEM_STATUSES = [
  ['filled', 'Filled'],
  ['vacant', 'Vacant'],
  ['unfunded', 'Unfunded'],
  ['abolished', 'Abolished'],
];
export const itemStatusLabel = (k) => ITEM_STATUSES.find(([id]) => id === k)?.[1] || k;
// What HR may set by hand (Filled comes only from linking an incumbent).
export const SETTABLE_STATUSES = ['vacant', 'unfunded', 'abolished'];

// The step the authorized annual salary is worked out at (the item's own rate: step 1 of its grade).
export const AUTHORIZED_STEP = 1;

// Appointments that are never on the plantilla (shared/gov-pay.js APPOINTMENTS).
export const NOT_ON_PLANTILLA = ['Job order', 'Contract of service'];
export const offPlantilla = (emp) => Boolean(emp) && (NOT_ON_PLANTILLA.includes(emp.appointment) || emp.employmentStatus === 'Job order');

// Item numbers are compared without case and extra spaces ("ITEM-1" and " item-1 " are one item).
export const normalizeItemNo = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

// Pesos a year from a monthly rate (null when there is none).
const yearly = (monthly) => (monthly == null ? null : Math.round(monthly * 12 * 100) / 100);

// The authorized annual salary: salaryFor(SG, step 1) × 12 from the schedule in force on `date`, or
// the amount HR typed, with its reason.
export function authorizedSalary(item, date) {
  const computed = item.salaryGrade ? yearly(salaryFor(item.salaryGrade, AUTHORIZED_STEP, date)) : null;
  const o = item.authorizedOverride;
  return {
    step: AUTHORIZED_STEP,
    computed,
    amount: o?.amount != null ? o.amount : computed,
    override: o?.amount != null ? { amount: o.amount, reason: o.reason || '', by: o.by || '', at: o.at || '' } : null,
  };
}

// The incumbent's actual annual salary, from their own salary grade and step.
export const actualSalary = (emp, date) => (emp?.salaryGrade ? yearly(salaryFor(emp.salaryGrade, emp.step || 1, date)) : null);

// ----- The signatures under the PSIPOP (names in People → Plantilla → Signatories) -----
// fallback: the Finance signatory used when the name here is blank (Finance → Control panel).
// The captions are to be checked against HR's sample of the form.
export const PSIPOP_SIGNATURES = [
  { key: 'hrOfficer', caption: 'Prepared by', defaultTitle: 'Human Resource Management Officer', fallback: null },
  { key: 'budgetOfficer', caption: 'Certified correct', defaultTitle: 'Budget Officer', fallback: 'budget' },
  { key: 'head', caption: 'Approved by', defaultTitle: 'Head of Agency', fallback: 'head' },
];
// settings.plantilla
export const DEFAULT_PLANTILLA_SETTINGS = Object.fromEntries(PSIPOP_SIGNATURES.map((s) => [s.key, { name: '', title: '' }]));
export function mergePlantillaSettings(s = {}) {
  return Object.fromEntries(PSIPOP_SIGNATURES.map(({ key }) => [key, { name: String(s?.[key]?.name || ''), title: String(s?.[key]?.title || '') }]));
}

// ----- The PSIPOP's columns -----
// key: an id; label: the heading; group: a heading over several columns; value(row): the text;
// num: a peso amount (right-aligned, totalled); print: false leaves it off the printed form (still
// in the CSV); confirm: true when the column (or its values) is to be checked against HR's sample.
// A row is an item as the server sends it (server/plantilla.js itemView): the item's own fields,
// and `incumbent` read from the employee record (or null).
const inc = (r) => r.incumbent || {};
const dash = (v) => (v == null || v === '' ? '' : String(v));
export const PSIPOP_COLUMNS = [
  { key: 'itemNo', label: 'Item number', value: (r) => r.itemNo },
  { key: 'position', label: 'Position title', value: (r) => r.positionTitle },
  { key: 'sg', label: 'Salary grade', value: (r) => dash(r.salaryGrade), center: true },
  { key: 'authorized', label: 'Authorized annual salary', num: true, value: (r) => r.authorized?.amount ?? '' },
  { key: 'actual', label: 'Actual annual salary', num: true, value: (r) => inc(r).actualAnnual ?? '' },
  { key: 'step', label: 'Step', value: (r) => dash(inc(r).step), center: true },
  { key: 'areaCode', label: 'Area code', value: (r) => r.areaCode, center: true, confirm: true },
  { key: 'areaType', label: 'Area type', value: (r) => r.areaType, center: true, confirm: true },
  { key: 'level', label: 'Level', value: (r) => r.level, center: true, confirm: true },
  { key: 'lastName', group: 'Name of incumbent', label: 'Last name', value: (r) => (r.incumbent ? inc(r).lastName : r.status === 'filled' ? '' : itemStatusLabel(r.status).toUpperCase()), confirm: true },
  { key: 'firstName', group: 'Name of incumbent', label: 'First name', value: (r) => inc(r).firstName },
  { key: 'middleName', group: 'Name of incumbent', label: 'Middle name', value: (r) => inc(r).middleName },
  { key: 'sex', label: 'Sex', value: (r) => inc(r).sex, center: true },
  { key: 'birthDate', label: 'Date of birth', value: (r) => inc(r).birthDate, date: true },
  { key: 'tin', label: 'TIN', value: (r) => inc(r).tin },
  { key: 'gsisNo', label: 'GSIS BP no.', value: (r) => inc(r).gsisNo, print: false, confirm: true },
  { key: 'originalAppointment', label: 'Date of original appointment', value: (r) => inc(r).originalAppointment, date: true, confirm: true },
  { key: 'lastPromotion', label: 'Date of last promotion', value: (r) => inc(r).lastPromotion, date: true },
  { key: 'appointment', label: 'Status of appointment', value: (r) => inc(r).appointment },
  { key: 'eligibility', label: 'Civil service eligibility', value: (r) => inc(r).eligibility },
];
export const printedColumns = () => PSIPOP_COLUMNS.filter((c) => c.print !== false);

// Columns of the register's CSV: the PSIPOP's, then where the item is, its fund source and its record.
export const CSV_EXTRA = [
  { label: 'Item status', value: (r) => itemStatusLabel(r.status) },
  { label: 'Campus', value: (r) => r.campusName },
  { label: 'Office', value: (r) => r.officeName },
  { label: 'Division', value: (r) => r.division },
  { label: 'Fund cluster', value: (r) => r.fundCluster },
  { label: 'Program / activity / project', value: (r) => r.papName || r.pap },
  { label: 'Authorized salary step', value: (r) => r.authorized?.step ?? '' },
  { label: 'Authorized salary typed (reason)', value: (r) => (r.authorized?.override ? r.authorized.override.reason : '') },
  { label: 'Date created', value: (r) => r.dateCreated },
  { label: 'Authority or reference', value: (r) => r.authority },
  { label: 'Employee no.', value: (r) => inc(r).employeeNo },
  { label: 'To review', value: (r) => (r.review ? 'Yes' : '') },
];

// A cell that starts like a formula gets a leading apostrophe (as public/js/ui.js toCsv), so a
// spreadsheet shows it as text.
const csvCell = (c) => {
  const s = String(c ?? '');
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};
export function plantillaCsv(rows) {
  const cols = [...PSIPOP_COLUMNS.map((c) => ({ label: c.group ? `${c.group}: ${c.label}` : c.label, value: c.value })), ...CSV_EXTRA];
  return [cols.map((c) => c.label), ...rows.map((r) => cols.map((c) => c.value(r)))].map((line) => line.map(csvCell).join(',')).join('\n');
}

// ----- Filters and totals (the register's toolbar, the CSV and the print use the same) -----
// f: { campusId, office, fund ('01' a fund cluster, or '01|<PAP>'), status ('' = all but abolished,
// 'all', a status, or 'review'), salaryGrade, q (item number, title or incumbent) }
export const fundKey = (r) => `${r.fundCluster || ''}|${r.pap || ''}`;
export function filterItems(rows, f = {}) {
  const q = String(f.q || '').trim().toLowerCase();
  return rows.filter((r) => {
    if (f.status === 'review') {
      if (!r.review) return false;
    } else if (f.status && f.status !== 'all') {
      if (r.status !== f.status) return false;
    } else if (f.status !== 'all' && r.status === 'abolished') return false;
    if (f.campusId && r.campusId !== f.campusId) return false;
    if (f.office && r.officeName !== f.office) return false;
    if (f.fund && fundKey(r) !== f.fund && !fundKey(r).startsWith(`${f.fund}|`)) return false;
    if (f.salaryGrade && Number(r.salaryGrade) !== Number(f.salaryGrade)) return false;
    if (q && ![r.itemNo, r.positionTitle, r.incumbent?.name, r.incumbent?.employeeNo].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
}
const add = (a, b) => Math.round(((a || 0) + (b || 0)) * 100) / 100;
// Counts by status, and the authorized salaries of funded items (filled and vacant) against the
// actual salaries of their incumbents. Unfunded items' authorized salaries are given apart.
export function plantillaTotals(rows) {
  const t = { items: rows.length, filled: 0, vacant: 0, unfunded: 0, abolished: 0, review: 0, authorized: 0, authorizedUnfunded: 0, actual: 0 };
  for (const r of rows) {
    t[r.status] = (t[r.status] || 0) + 1;
    if (r.review) t.review++;
    if (r.status === 'filled' || r.status === 'vacant') t.authorized = add(t.authorized, r.authorized?.amount);
    if (r.status === 'unfunded') t.authorizedUnfunded = add(t.authorizedUnfunded, r.authorized?.amount);
    if (r.status === 'filled') t.actual = add(t.actual, r.incumbent?.actualAnnual);
  }
  return t;
}
