// ATLAS Academic rules shared by the server and the browser: the grading scale, document
// types, admission requirements, terms of a curriculum, and the general weighted average.
// Defaults follow the CBSUA UIS (Registrar → Grading System) and common Philippine SUC practice;
// each school changes them under Academic → Settings.

// Percentage → grade equivalent. 1.00 is the best; 3.00 is the lowest passing grade; 5.00 fails.
export const DEFAULT_SCALE = [
  { min: 99, grade: 1.0, remark: 'Excellent' },
  { min: 96, grade: 1.25, remark: 'Excellent' },
  { min: 93, grade: 1.5, remark: 'Very good' },
  { min: 90, grade: 1.75, remark: 'Very good' },
  { min: 87, grade: 2.0, remark: 'Good' },
  { min: 84, grade: 2.25, remark: 'Above average' },
  { min: 81, grade: 2.5, remark: 'Average' },
  { min: 78, grade: 2.75, remark: 'Fair' },
  { min: 75, grade: 3.0, remark: 'Passed' },
  { min: 0, grade: 5.0, remark: 'Failed' },
];
export const PASSING_GRADE = 3.0;

// Remarks on the permanent record.
export const REMARKS = {
  passed: 'Passed',
  failed: 'Failed',
  inc: 'Incomplete',
  dropped: 'Dropped',
  credited: 'Credited',
};

export const fmtGrade = (g) => (g == null || g === '' ? '' : Number(g).toFixed(2));

// The equivalent of a percentage on a scale (sorted from the highest band down).
export function equivalent(percent, scale = DEFAULT_SCALE) {
  if (percent == null || percent === '' || Number.isNaN(Number(percent))) return null;
  const p = Number(percent);
  const bands = [...scale].sort((a, b) => b.min - a.min);
  const band = bands.find((b) => p >= b.min) || bands.at(-1);
  return { grade: band.grade, remark: band.remark, passed: band.grade <= PASSING_GRADE };
}

// Curriculum terms: year level 1–6, and the term in that year.
export const TERMS = [
  { id: '1', label: 'First Semester', short: '1st Sem' },
  { id: '2', label: 'Second Semester', short: '2nd Sem' },
  { id: 'S', label: 'Summer', short: 'Summer' },
];
export const termLabel = (id) => TERMS.find((t) => t.id === id)?.label || id;
export const termOrder = (id) => ({ 1: 1, 2: 2, S: 3 })[id] || 9;
export const yearLabel = (n) => (n ? `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n] || 'th'} Year` : '');

export const STUDENT_TYPES = [
  ['new', 'New student'],
  ['old', 'Continuing student'],
  ['transferee', 'Transferee'],
  ['returnee', 'Returnee'],
  ['cross', 'Cross-enrollee'],
];
export const studentTypeLabel = (id) => STUDENT_TYPES.find(([k]) => k === id)?.[1] || '';

// Documents the registrar issues. official: printed by the registrar only (students may request them).
export const DOCUMENT_TYPES = [
  { id: 'tor', label: 'Transcript of Records', short: 'TOR', fee: 150, official: true },
  { id: 'cog', label: 'Certificate of Grades', short: 'COG', fee: 50, official: true },
  { id: 'coe', label: 'Certificate of Enrollment', short: 'COE', fee: 50, official: true },
  { id: 'cor', label: 'Certificate of Registration', short: 'COR', fee: 0, official: false }, // students print their own
  { id: 'gmc', label: 'Certificate of Good Moral Character', short: 'GMC', fee: 50, official: true },
  { id: 'hd', label: 'Honorable Dismissal', short: 'HD', fee: 100, official: true },
];
export const docType = (id) => DOCUMENT_TYPES.find((d) => d.id === id);

export const REQUEST_STATUS = {
  requested: 'Requested',
  paid: 'Paid',
  processing: 'Processing',
  ready: 'Ready for release',
  released: 'Released',
  cancelled: 'Cancelled',
};

// Admission requirements (CBSUA UIS → Requirements Monitoring), with the student types that need each.
export const DEFAULT_REQUIREMENTS = [
  { id: 'psa', name: 'PSA birth certificate', for: ['new', 'transferee', 'returnee', 'cross'] },
  { id: 'f138', name: 'Form 138 (report card) or its equivalent', for: ['new'] },
  { id: 'tor-in', name: 'Transcript of records from the previous school', for: ['transferee'] },
  { id: 'hd-in', name: 'Honorable dismissal from the previous school', for: ['transferee'] },
  { id: 'gmc', name: 'Certificate of good moral character', for: ['new', 'transferee'] },
  { id: 'med', name: 'Medical / dental certificate', for: ['new', 'transferee', 'returnee'] },
  { id: 'photo', name: '2×2 ID photos', for: ['new', 'transferee', 'returnee'] },
  { id: 'permit', name: 'Permit to cross-enroll', for: ['cross'] },
];

export const DEFAULT_ACADEMIC_SETTINGS = {
  scale: DEFAULT_SCALE,
  requirements: DEFAULT_REQUIREMENTS,
  fees: Object.fromEntries(DOCUMENT_TYPES.map((d) => [d.id, d.fee])),
  incDays: 365, // an INC must be completed within this many days of posting
  honors: { maxGwa: 1.75, worstGrade: 2.5, minUnits: 15 }, // dean's list for a term
  registrar: { name: '', title: 'University Registrar' },
  maxUnits: 26,
};

// General weighted average over records with a numeric grade (credited and special grades left out).
export function gwa(records) {
  let sum = 0;
  let units = 0;
  for (const r of records) {
    if (r.grade == null || r.source === 'credited' || !(Number(r.units) > 0)) continue;
    sum += Number(r.grade) * Number(r.units);
    units += Number(r.units);
  }
  return units ? Math.round((sum / units) * 10000) / 10000 : null;
}

export const GRADE_SHEET_STATUS = {
  none: 'Not started',
  submitted: 'Waiting for approval',
  approved: 'Approved, waiting to be posted',
  posted: 'Posted',
  returned: 'Returned to the teacher',
};

export const ACADEMIC_PERMISSION_LABELS = [
  ['academic.view', 'View student records, curricula, grade sheets and reports'],
  ['academic.records', 'Edit student records, credit subjects, post grade sheets, issue documents'],
  ['academic.curricula', 'Build and post curricula; colleges'],
  ['grades.approve', 'Approve grade sheets and grade changes'],
  ['academic.settings', 'Grading scale, requirements, document fees and signatories'],
];
