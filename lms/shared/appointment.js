// Appointment papers in ATLAS People (HRIS request PL-025): the appointment form, the Certificate of
// Assumption to Duty and the Oath of Office (Panunumpa sa Katungkulan, in Filipino, and in English),
// generated for the applicant HR appoints. Shared by the server (server/appointment.js) and the
// browser (People → Recruitment → an opening → Appoint; HR settings → Appointment papers).
//
//  - The layout of each paper follows the structure of the CSC forms as far as they are known here;
//    ATLAS does not claim they are the official forms and prints no form number unless HR types the
//    one on their office's copy (settings.appointmentPapers.formNumbers, blank by default).
//  - The wording is an editable template per paper, in parts (the main text, the certifications…),
//    with merge fields in braces ({name}, {position}…). A template with an unknown merge field, or a
//    brace left open, is refused. The built-in wording is a starting point only: HR replaces it with
//    the wording of the CSC form their office uses (DEFAULT_NOTE shows on screen while it is in use).
//  - Issuing freezes the rendered text, the template version and the signatories (server).

export const DEFAULT_NOTE = 'Replace with the wording of the CSC form your office uses.';
export const CONFIRM_NOTE = 'To confirm with the HR office';
// Confirming for an external applicant turns their applicant account into an employee's account, so it
// needs the right to manage sign-in accounts (hris.accounts) as well as hris.appoint.
export const NEEDS_ACCOUNTS_NOTE = 'Confirming turns the applicant account into an employee\'s sign-in account, which needs the right to manage sign-in accounts (Sign-in accounts for employees). Ask an HR manager or an administrator who has it to confirm this appointment.';

// ----- The papers -----
export const PAPERS = [
  { id: 'appointment', label: 'Appointment form', title: 'Appointment', lang: 'en' },
  { id: 'oath-fil', label: 'Panunumpa sa Katungkulan (Oath of Office in Filipino)', title: 'Panunumpa sa Katungkulan', lang: 'fil' },
  { id: 'oath-en', label: 'Oath of Office (English)', title: 'Oath of Office', lang: 'en' },
  { id: 'assumption', label: 'Certificate of Assumption to Duty', title: 'Certification of Assumption to Duty', lang: 'en' },
];
export const paperInfo = (id) => PAPERS.find((p) => p.id === id) || null;
export const paperLabel = (id) => paperInfo(id)?.label || id;

// ----- Lookup lists (to confirm with the HR office) -----
// The nature of the appointment, as CSC's rules name them.
export const NATURES = [
  ['original', 'Original'],
  ['promotion', 'Promotion'],
  ['transfer', 'Transfer'],
  ['reemployment', 'Reemployment'],
  ['reappointment', 'Reappointment'],
  ['reclassification', 'Reclassification'],
  ['demotion', 'Demotion'],
];
export const natureLabel = (k) => NATURES.find(([id]) => id === k)?.[1] || k || '';
// Why the position is vacant: "vice <name>, who <reason>". Suggestions; HR may type another.
export const VICE_REASONS = ['retired', 'resigned', 'was promoted', 'transferred to another office', 'passed away', 'was separated from the service', 'whose appointment ended'];

// ----- The signatories (settings.appointmentPapers.signatories) -----
export const SIGNATORIES = [
  { key: 'appointingOfficer', label: 'Appointing officer or authority', defaultTitle: 'Appointing Officer', field: 'appointing_officer' },
  { key: 'hrmo', label: 'HRMO who certifies', defaultTitle: 'Human Resource Management Officer', field: 'hrmo' },
  { key: 'boardChair', label: 'Chairperson of the selection board', defaultTitle: 'Chairperson, HRMPSB', field: 'board_chair' },
  { key: 'headOfOffice', label: 'Head of office who certifies the assumption', defaultTitle: 'Head of Office', field: 'head_of_office' },
];

// ----- Merge fields -----
// key: the name in braces; label: what it is, for HR. Every paper may use every field.
export const MERGE_FIELDS = [
  ['name', 'Full name (first, middle, last)'],
  ['first_name', 'First name'],
  ['middle_name', 'Middle name'],
  ['last_name', 'Last name'],
  ['address', 'Home address'],
  ['position', 'Position title'],
  ['item_no', 'Plantilla item number'],
  ['salary_grade', 'Salary grade'],
  ['step', 'Step'],
  ['monthly_salary', 'Monthly salary in figures (₱26,024.00)'],
  ['monthly_salary_words', 'Monthly salary in words'],
  ['nature', 'Nature of appointment'],
  ['status', 'Status of appointment'],
  ['vice', 'The person replaced (vice)'],
  ['vice_reason', 'Why the position is vacant (retired, resigned…)'],
  ['office', 'Office, department or unit'],
  ['campus', 'Campus'],
  ['agency', 'Agency (the school)'],
  ['place', 'Place (for "done in", "sworn at")'],
  ['date_signed', 'Date of signing'],
  ['effective_date', 'Effective date'],
  ['assumption_date', 'Date of assumption'],
  ['date_issued', 'Date the paper is issued'],
  ['publication_from', 'Published or posted from'],
  ['publication_to', 'Published or posted until'],
  ['publication_place', 'Where it was published or posted'],
  ['deliberation_date', 'Selection board deliberation'],
  ...SIGNATORIES.flatMap((s) => [[s.field, `${s.label}: name`], [`${s.field}_title`, `${s.label}: title`]]),
];
export const MERGE_KEYS = new Set(MERGE_FIELDS.map(([k]) => k));
const DATE_FIELDS = new Set(['date_signed', 'effective_date', 'assumption_date', 'date_issued', 'publication_from', 'publication_to', 'deliberation_date']);

// ----- The templates: each paper's wording, in parts -----
// part: [key, label, default text]. Paragraphs are separated by an empty line.
export const TEMPLATE_PARTS = {
  appointment: [
    ['body', 'Main text', 'You are hereby appointed as {position} (Salary Grade {salary_grade}, Step {step}) under {status} status at the {office}, {agency}, with a compensation rate of {monthly_salary_words} pesos ({monthly_salary}) per month.\n\nThe nature of this appointment is {nature} vice {vice}, who {vice_reason}, with Plantilla Item No. {item_no}.'],
    ['effectivity', 'When it takes effect', 'This appointment shall take effect on {effective_date}.'],
    ['hrmoCertification', 'Certification by the HRMO', 'This is to certify that all requirements and supporting papers have been complied with, reviewed and found to be in order.\n\nThe position was published or posted at {publication_place} from {publication_from} to {publication_to} in consonance with Republic Act No. 7041.'],
    ['boardCertification', 'Certification by the selection board', 'This is to certify that the appointee has been screened and found qualified by at least the majority of the Human Resource Merit Promotion and Selection Board during the deliberation held on {deliberation_date}.'],
  ],
  'oath-fil': [
    ['body', 'Panunumpa', 'Ako, si {name}, ng {address}, na itinalaga sa katungkulan bilang {position}, ay taimtim na nanunumpa na tutuparin ko nang buong husay at katapatan, sa abot ng aking kakayahan, ang mga tungkulin ng aking kasalukuyang katungkulan at ng mga iba pang pagkaraan nito\'y gagampanan ko sa ilalim ng Republika ng Pilipinas; na aking itataguyod at ipagtatanggol ang Saligang Batas ng Pilipinas; na tunay na mananalig at tatalima ako rito; na susundin ko ang mga batas, mga kautusang legal, at mga dekretong pinaiiral ng mga sadyang itinakdang may kapangyarihan ng Republika ng Pilipinas; at kusa kong babalikatin ang pananagutang ito, nang walang anumang pasubali o hangaring umiwas.\n\nKasihan nawa ako ng Diyos.'],
    ['jurat', 'Pagpapatunay ng nanumpa', 'NILAGDAAN AT PINANUMPAAN sa harap ko ngayong {date_issued} sa {place}.'],
  ],
  'oath-en': [
    ['body', 'Oath', 'I, {name}, of {address}, having been appointed to the position of {position}, hereby solemnly swear that I will faithfully discharge to the best of my ability the duties of my present position and of all others that I may hereafter hold under the Republic of the Philippines; that I will support and defend the Constitution of the Philippines; that I will bear true faith and allegiance to the same; that I will obey the laws, legal orders, and decrees promulgated by the duly constituted authorities of the Republic of the Philippines; and that I impose this obligation upon myself voluntarily, without mental reservation or purpose of evasion.\n\nSo help me God.'],
    ['jurat', 'Subscribed and sworn', 'SUBSCRIBED AND SWORN to before me this {date_issued} in {place}.'],
  ],
  assumption: [
    ['body', 'Main text', 'This is to certify that {name} has assumed the duties and responsibilities as {position} of the {office}, {agency}, effective {assumption_date}.\n\nThis certification is issued in connection with the issuance of the appointment of {name} as {position}.'],
    ['closing', 'Done at', 'Done this {date_issued} in {place}.'],
  ],
};
export const LIMITS = { part: 4000, name: 120, title: 160, agency: 200, place: 200, formNo: 60 };

export const defaultTemplate = (kind) => ({ parts: Object.fromEntries(TEMPLATE_PARTS[kind].map(([k, , text]) => [k, text])), version: 1 });
const blankSig = () => Object.fromEntries(SIGNATORIES.map((s) => [s.key, { name: '', title: '' }]));
export const DEFAULT_APPOINTMENT_SETTINGS = {
  agency: '', // blank: Finance's entity name, else the school name
  place: '', // blank: the employer address in HR settings
  signatories: blankSig(),
  templates: Object.fromEntries(PAPERS.map((p) => [p.id, defaultTemplate(p.id)])),
  formNumbers: Object.fromEntries(PAPERS.map((p) => [p.id, ''])), // printed only when HR types one
};
// settings.appointmentPapers as stored, every part present (a fresh object).
export function mergeAppointmentSettings(v = {}) {
  const sig = blankSig();
  for (const s of SIGNATORIES) sig[s.key] = { name: String(v?.signatories?.[s.key]?.name || ''), title: String(v?.signatories?.[s.key]?.title || '') };
  const templates = {};
  for (const p of PAPERS) {
    const d = defaultTemplate(p.id);
    const saved = v?.templates?.[p.id];
    templates[p.id] = {
      parts: Object.fromEntries(TEMPLATE_PARTS[p.id].map(([k]) => [k, typeof saved?.parts?.[k] === 'string' ? saved.parts[k] : d.parts[k]])),
      version: Number(saved?.version) || 1,
      ...(saved?.updatedAt ? { updatedAt: saved.updatedAt, updatedBy: saved.updatedBy || '' } : {}),
    };
  }
  return {
    agency: String(v?.agency || ''), place: String(v?.place || ''), signatories: sig, templates,
    formNumbers: Object.fromEntries(PAPERS.map((p) => [p.id, String(v?.formNumbers?.[p.id] || '')])),
  };
}
// Whether a paper still has the built-in wording (the note to HR shows while it does).
export const isDefaultWording = (kind, tpl) => TEMPLATE_PARTS[kind].every(([k, , text]) => (tpl?.parts?.[k] ?? text) === text);

// ----- Checking a template -----
// The problems with one part's text: unknown merge fields and braces left open. [] when fine.
export function templateProblems(text, where = '') {
  const out = [];
  const s = String(text ?? '');
  const at = where ? `${where}: ` : '';
  for (const m of s.matchAll(/\{([^{}]*)\}/g)) if (!MERGE_KEYS.has(m[1])) out.push(`${at}{${m[1]}} is not a merge field.`);
  const rest = s.replace(/\{[^{}]*\}/g, '');
  if (/[{}]/.test(rest)) out.push(`${at}a brace { or } has no partner. Merge fields are written {like_this}.`);
  return [...new Set(out)];
}

// ----- Writing values -----
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_FIL = ['Enero', 'Pebrero', 'Marso', 'Abril', 'Mayo', 'Hunyo', 'Hulyo', 'Agosto', 'Setyembre', 'Oktubre', 'Nobyembre', 'Disyembre'];
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
// "November 26, 2026"; in Filipino "ika-26 ng Nobyembre, 2026".
export function writeDate(ymd, lang = 'en') {
  if (!isDate(ymd)) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return lang === 'fil' ? `ika-${d} ng ${MONTHS_FIL[m - 1]}, ${y}` : `${MONTHS_EN[m - 1]} ${d}, ${y}`;
}
export const figures = (n) => (n == null || n === '' ? '' : `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
// 26024.5 → "Twenty-Six Thousand Twenty-Four and 50/100".
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function under1000(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const tens = r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? `-${ONES[r % 10]}` : ''}`;
  return [h ? `${ONES[h]} Hundred` : '', tens].filter(Boolean).join(' ');
}
export function amountInWords(amount) {
  if (amount == null || amount === '' || !Number.isFinite(Number(amount))) return '';
  const cents = Math.round(Number(amount) * 100);
  let whole = Math.floor(cents / 100);
  const c = cents % 100;
  if (whole === 0) return `Zero${c ? ` and ${String(c).padStart(2, '0')}/100` : ''}`;
  const parts = [];
  for (const [size, word] of [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand'], [1, '']]) {
    const chunk = Math.floor(whole / size);
    if (chunk) parts.push(`${under1000(chunk)}${word ? ` ${word}` : ''}`);
    whole %= size;
  }
  return `${parts.join(' ')}${c ? ` and ${String(c).padStart(2, '0')}/100` : ''}`;
}

// The merge-field values of an appointment (fields as saved; lang: how dates are written).
export function mergeValues(f, lang = 'en', { dateIssued = '' } = {}) {
  const name = [f.firstName, f.middleName, f.lastName].filter(Boolean).join(' ') + (f.suffix ? ` ${f.suffix}` : '');
  const v = {
    name, first_name: f.firstName || '', middle_name: f.middleName || '', last_name: f.lastName || '', address: f.address || '',
    position: f.position || '', item_no: f.itemNo || '', salary_grade: f.salaryGrade ? String(f.salaryGrade) : '', step: f.salaryGrade ? String(f.step || 1) : '',
    monthly_salary: figures(f.monthlySalary), monthly_salary_words: amountInWords(f.monthlySalary),
    nature: natureLabel(f.nature), status: f.status || '', vice: f.vice || '', vice_reason: f.viceReason || '',
    office: f.office || '', campus: f.campusName || '', agency: f.agency || '', place: f.place || '',
    date_signed: f.dateSigned, effective_date: f.effectiveDate, assumption_date: f.assumptionDate, date_issued: dateIssued,
    publication_from: f.publicationFrom, publication_to: f.publicationTo, publication_place: f.publicationPlace || '', deliberation_date: f.deliberationDate,
  };
  for (const s of SIGNATORIES) {
    v[s.field] = f.signatories?.[s.key]?.name || '';
    v[`${s.field}_title`] = f.signatories?.[s.key]?.title || '';
  }
  for (const k of DATE_FIELDS) v[k] = writeDate(v[k], lang);
  return v;
}
// A part's text with its merge fields filled: paragraphs, each a list of pieces ({ t } text, or
// { f, v } a filled field; an empty value prints as a blank line to write on).
export function renderPart(text, values) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((para) => {
    const out = [];
    let last = 0;
    for (const m of para.matchAll(/\{([a-z_]+)\}/g)) {
      if (m.index > last) out.push({ t: para.slice(last, m.index) });
      out.push({ f: m[1], v: values[m[1]] ?? '' });
      last = m.index + m[0].length;
    }
    if (last < para.length) out.push({ t: para.slice(last) });
    return out;
  }).filter((p) => p.length);
}
// A rendered paragraph as plain text (for tests, search, the audit log).
export const plainText = (paras) => paras.map((p) => p.map((x) => (x.f ? x.v || '________' : x.t)).join('')).join('\n\n');

// The statuses of appointment HR picks from: the government list without job orders and contracts of
// service (no employer-employee relationship, so no appointment papers); a private school's own list.
export const statusSuggestions = (gov, appointments) => (gov ? appointments.filter((a) => !['Job order', 'Contract of service'].includes(a)) : ['Probationary', 'Regular', 'Contractual', 'Part-time']);
