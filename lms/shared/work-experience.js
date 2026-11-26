// Work experience in ATLAS People: the work-experience section of the Personal Data Sheet (PDS, HRIS
// request PL-017, built only for this section) and the Work Experience Sheet filled from it (PL-023).
// Shared by the server (server/work-experience.js) and the browser (My HR record, My work experience,
// the employee record, the applicant profile).
//
//  - One list of entries per person: an employee (on their record) or a job applicant (on their
//    applicant account). The same rows are meant for the full PDS when it is built (PL-017), so each
//    entry carries the PDS columns as well as the Work Experience Sheet's.
//  - Fields: those of the PDS work-experience section (inclusive dates, position title, department /
//    agency / office / company, monthly salary, salary grade and step, status of appointment,
//    government service) and of the Work Experience Sheet (duration, position, office or unit,
//    immediate supervisor, agency or organization and its location, accomplishments and
//    contributions, summary of actual duties). Labels marked `confirm` are to be checked against
//    the CSC form the school uses; no form number or revision is printed.
//  - The sheet lists the entries newest first (an entry still held, "present", first of all).

export const LIMITS = {
  entries: 100, // per person
  text: 200, // position, office, agency, location, supervisor, status
  duties: 3000,
  accomplishment: 600,
  accomplishments: 30,
  csvRows: 100,
};
export const EARLIEST = '1940-01-01';

// The fields of an entry, in the order the form shows them. `pds`: a column of the PDS section;
// `wes`: printed on the Work Experience Sheet; `confirm`: to check against CSC's current form.
export const FIELDS = [
  { key: 'from', label: 'From', pds: true, wes: true },
  { key: 'to', label: 'To', pds: true, wes: true, hint: 'Or tick "Present" for the position you hold now.' },
  { key: 'position', label: 'Position title', pds: true, wes: true, hint: 'In full, as on the appointment or contract; no abbreviations.' },
  { key: 'office', label: 'Office or unit', wes: true, hint: 'e.g. Accounting Office, College of Computing' },
  { key: 'agency', label: 'Agency or organization', pds: true, wes: true, hint: 'In full: the department, agency, office or company.' },
  { key: 'location', label: 'Location of the agency or organization', wes: true, hint: 'Town or city, province' },
  { key: 'supervisor', label: 'Immediate supervisor', wes: true, hint: 'Name and position' },
  { key: 'appointmentStatus', label: 'Status of appointment', pds: true, hint: 'e.g. Permanent, Temporary, Casual, Contractual, Job order' },
  { key: 'government', label: 'Government service', pds: true },
  { key: 'salaryGrade', label: 'Salary grade', pds: true, optional: true, confirm: true },
  { key: 'step', label: 'Step', pds: true, optional: true, confirm: true },
  { key: 'monthlySalary', label: 'Monthly salary (₱)', pds: true, optional: true },
  { key: 'duties', label: 'Summary of actual duties', wes: true },
  { key: 'accomplishments', label: 'Accomplishments and contributions', wes: true, hint: 'One per line. Leave empty if none.' },
];
export const fieldLabel = (key) => FIELDS.find((f) => f.key === key)?.label || key;
export const CONFIRM_NOTE = 'To confirm against CSC\'s current form';
// Status of appointment: suggestions only (a private employer's status is typed as it was).
export const STATUS_SUGGESTIONS = ['Permanent', 'Temporary', 'Casual', 'Contractual', 'Coterminous', 'Substitute', 'Job order', 'Contract of service', 'Probationary', 'Regular', 'Part-time'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isRealDate = (s) => {
  if (!DATE_RE.test(String(s))) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const str = (v, max = LIMITS.text) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max + 1);
const longText = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max + 1);

// One entry as typed: the clean entry, or the first thing wrong with it (`today`: YYYY-MM-DD).
// Returns { entry } or { error }.
export function cleanEntry(input = {}, today) {
  const e = {};
  const bad = (error) => ({ error });
  e.from = str(input.from, 10);
  e.present = input.present === true || input.present === 'true' || input.present === 'on' || /^present$/i.test(String(input.to || '').trim());
  e.to = e.present ? '' : str(input.to, 10);
  if (!e.from) return bad('From: pick the date the work started.');
  if (!isRealDate(e.from)) return bad('From: pick a real date.');
  if (e.from < EARLIEST) return bad('From: check the year.');
  if (e.from > today) return bad('From cannot be in the future.');
  if (!e.present) {
    if (!e.to) return bad('To: pick the date the work ended, or tick "Present".');
    if (!isRealDate(e.to)) return bad('To: pick a real date.');
    if (e.to < e.from) return bad('To cannot be before From.');
    if (e.to > today) return bad('To cannot be in the future: tick "Present" for work that goes on.');
  }
  for (const k of ['position', 'office', 'agency', 'location', 'supervisor', 'appointmentStatus']) {
    e[k] = str(input[k]);
    if (e[k].length > LIMITS.text) return bad(`${fieldLabel(k)}: at most ${LIMITS.text} characters.`);
  }
  if (!e.position) return bad('Position title is required.');
  if (!e.agency) return bad('Agency or organization is required.');
  const g = input.government;
  e.government = g === true || g === 'true' || g === 'on' || /^(y|yes|oo)$/i.test(String(g ?? '').trim());
  // Salary grade and step: optional, whole numbers (1 to 33, step 1 to 8).
  const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(/[,₱\s]/g, '')));
  e.salaryGrade = num(input.salaryGrade);
  if (e.salaryGrade != null && !(Number.isInteger(e.salaryGrade) && e.salaryGrade >= 1 && e.salaryGrade <= 33)) return bad('Salary grade: a whole number from 1 to 33, or leave it empty.');
  e.step = num(input.step);
  if (e.step != null && !(Number.isInteger(e.step) && e.step >= 1 && e.step <= 8)) return bad('Step: a whole number from 1 to 8, or leave it empty.');
  if (e.step != null && e.salaryGrade == null) return bad('Step: give the salary grade too, or leave both empty.');
  e.monthlySalary = num(input.monthlySalary);
  if (e.monthlySalary != null && !(Number.isFinite(e.monthlySalary) && e.monthlySalary >= 0 && e.monthlySalary <= 10000000)) return bad('Monthly salary: an amount in pesos, or leave it empty.');
  if (e.monthlySalary != null) e.monthlySalary = Math.round(e.monthlySalary * 100) / 100;
  e.duties = longText(input.duties, LIMITS.duties);
  if (e.duties.length > LIMITS.duties) return bad(`Summary of actual duties: at most ${LIMITS.duties} characters.`);
  const list = Array.isArray(input.accomplishments) ? input.accomplishments : String(input.accomplishments ?? '').split(/\n/);
  e.accomplishments = list.map((x) => str(x, LIMITS.accomplishment)).filter(Boolean);
  if (e.accomplishments.length > LIMITS.accomplishments) return bad(`Accomplishments: at most ${LIMITS.accomplishments}.`);
  if (e.accomplishments.some((x) => x.length > LIMITS.accomplishment)) return bad(`Each accomplishment: at most ${LIMITS.accomplishment} characters.`);
  return { entry: e };
}

// The fields that count as the entry's content (what verification is about).
export const CONTENT_KEYS = ['from', 'to', 'present', 'position', 'office', 'agency', 'location', 'supervisor', 'appointmentStatus', 'government', 'salaryGrade', 'step', 'monthlySalary', 'duties', 'accomplishments'];
const shown = (k, v) => {
  if (k === 'present' || k === 'government') return v ? 'Yes' : 'No';
  if (k === 'accomplishments') return (v || []).join('; ');
  return v == null ? '' : String(v);
};
// What changed between two versions of an entry, for the audit log.
export function entryChanges(before = {}, after = {}) {
  const out = [];
  for (const k of CONTENT_KEYS) {
    const a = shown(k, before[k]);
    const b = shown(k, after[k]);
    if (a !== b) out.push({ field: k === 'present' ? 'Present' : fieldLabel(k), from: a, to: b });
  }
  return out;
}

// Newest first: an entry held now (present) first, then by the end date, then the start date; the
// person's own order breaks ties.
export function newestFirst(entries) {
  const end = (e) => (e.present ? '9999-12-31' : e.to || e.from || '');
  return [...entries].sort((a, b) => end(b).localeCompare(end(a)) || String(b.from).localeCompare(String(a.from)) || (a.order ?? 0) - (b.order ?? 0));
}

// "January 6, 2020 – Present"
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const longDate = (ymd) => {
  if (!isRealDate(ymd)) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
export const durationText = (e) => `${longDate(e.from)} – ${e.present ? 'Present' : longDate(e.to)}`;
// "3 years 2 months" (whole months between the dates; `today` for an entry held now).
export function lengthText(e, today) {
  const end = e.present ? today : e.to;
  if (!isRealDate(e.from) || !isRealDate(end)) return '';
  const [y1, m1, d1] = e.from.split('-').map(Number);
  const [y2, m2, d2] = end.split('-').map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  if (months < 1) return 'less than a month';
  const y = Math.floor(months / 12);
  months %= 12;
  return [y ? `${y} year${y === 1 ? '' : 's'}` : '', months ? `${months} month${months === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ');
}
export const pesos = (n) => (n == null ? '' : `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
// "SG 11-2" as the PDS writes salary grade and step ("00-0"; to confirm).
export const gradeText = (e) => (e.salaryGrade ? `${String(e.salaryGrade).padStart(2, '0')}-${e.step || 1}` : '');

// ----- CSV import (HR: a long history in one go) -----
// The columns, with the headings people are likely to use. Dates as YYYY-MM-DD (or the date a
// spreadsheet shows, D/M/YYYY is NOT guessed: use YYYY-MM-DD); "Present" in To for the work held now.
export const CSV_COLUMNS = [
  { key: 'from', header: 'From', aliases: ['from', 'start', 'start date', 'date from', 'inclusive dates from'] },
  { key: 'to', header: 'To', aliases: ['to', 'end', 'end date', 'date to', 'inclusive dates to'] },
  { key: 'position', header: 'Position title', aliases: ['position title', 'position', 'title', 'designation'] },
  { key: 'office', header: 'Office or unit', aliases: ['office or unit', 'office', 'unit', 'office/unit', 'department'] },
  { key: 'agency', header: 'Agency or organization', aliases: ['agency or organization', 'agency', 'organization', 'company', 'employer', 'agency/organization'] },
  { key: 'location', header: 'Location', aliases: ['location', 'address', 'place'] },
  { key: 'supervisor', header: 'Immediate supervisor', aliases: ['immediate supervisor', 'supervisor'] },
  { key: 'appointmentStatus', header: 'Status of appointment', aliases: ['status of appointment', 'status', 'appointment status', 'appointment'] },
  { key: 'government', header: 'Government service (Y/N)', aliases: ['government service (y/n)', 'government service', 'government', "gov't service", 'govt service', 'gov'] },
  { key: 'salaryGrade', header: 'Salary grade', aliases: ['salary grade', 'sg', 'grade'] },
  { key: 'step', header: 'Step', aliases: ['step', 'step increment'] },
  { key: 'monthlySalary', header: 'Monthly salary', aliases: ['monthly salary', 'salary', 'monthly'] },
  { key: 'duties', header: 'Summary of actual duties', aliases: ['summary of actual duties', 'duties', 'actual duties'] },
  { key: 'accomplishments', header: 'Accomplishments and contributions', aliases: ['accomplishments and contributions', 'accomplishments', 'contributions'] },
];
export const csvTemplate = () => `${CSV_COLUMNS.map((c) => c.header).join(',')}\n2019-06-03,2021-12-31,Administrative Aide IV,Records Section,Example State University,"Example City, Example Province",Records Officer II,Casual,Y,4,1,15000,"Kept the personnel files and logbooks.","Digitized the 201 files; Trained two new aides"\n`;
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9/'()]+/g, ' ').trim();
// Rows (from shared/csv.js parseCsv) to entries: { entries, errors: ["Row 3: …"] }.
export function entriesFromCsv(rows, today) {
  const errors = [];
  if (!rows.length) return { entries: [], errors: ['The file is empty.'] };
  const head = rows[0].map(norm);
  const at = {};
  for (const c of CSV_COLUMNS) {
    const i = head.findIndex((h) => c.aliases.includes(h));
    if (i >= 0) at[c.key] = i;
  }
  const missing = ['from', 'position', 'agency'].filter((k) => at[k] === undefined).map((k) => CSV_COLUMNS.find((c) => c.key === k).header);
  if (missing.length) return { entries: [], errors: [`The first row must name the columns; missing: ${missing.join(', ')}. Download the template to see them.`] };
  const body = rows.slice(1);
  if (body.length > LIMITS.csvRows) return { entries: [], errors: [`At most ${LIMITS.csvRows} rows at a time.`] };
  const entries = [];
  body.forEach((r, i) => {
    const get = (k) => (at[k] === undefined ? '' : String(r[at[k]] ?? '').trim());
    const input = Object.fromEntries(CSV_COLUMNS.map((c) => [c.key, get(c.key)]));
    input.accomplishments = input.accomplishments.split(/\s*[;\n]\s*/);
    const { entry, error } = cleanEntry(input, today);
    if (error) errors.push(`Row ${i + 2}: ${error}`);
    else entries.push(entry);
  });
  if (!body.length) errors.push('The file has a heading row but no entries.');
  return { entries, errors };
}
