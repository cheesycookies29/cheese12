// Rating applicants and the pool of applicants in ATLAS People's recruitment (HRIS requests PL-018,
// PL-020, part of PL-021, and PL-066). Shared by the server (server/recruitment-assess.js) and the
// browser (People → Recruitment, HR settings → Assessment templates).
//
//  - Position categories (Faculty, Non-teaching, …): a small list HR edits, each with the assessment
//    template a new opening in it starts with.
//  - Assessment templates: criteria, each with a label, a description and a weight in %. The weights
//    total exactly 100 (anything else is refused: PL-066). Each criterion is scored 0 to 100, so the
//    weighted total, Σ score × weight / 100, is never more than 100.
//  - The two built-in templates are EXAMPLES, to be replaced with the school's own merit selection
//    plan: their criteria and weights are plausible, not taken from any circular.
//  - One assessor per application in this build: several assessors with averaging (the rest of
//    PL-021) is not built.

export const DEFAULT_CATEGORIES = [
  { id: 'faculty', label: 'Faculty', templateId: 'faculty-example' },
  { id: 'non-teaching', label: 'Non-teaching', templateId: 'non-teaching-example' },
];
export const EXAMPLE_NOTE = 'An example: replace it with the criteria and weights of the school\'s merit selection plan.';
export const DEFAULT_TEMPLATES = [
  {
    id: 'non-teaching-example', name: 'Non-teaching (example)', categoryId: 'non-teaching', example: true, version: 1,
    criteria: [
      { id: 'education', label: 'Education', description: 'Education relevant to the position, beyond the qualification standard.', weight: 15 },
      { id: 'experience', label: 'Experience', description: 'Relevant work experience, beyond the qualification standard.', weight: 15 },
      { id: 'training', label: 'Training', description: 'Relevant training hours, beyond the qualification standard.', weight: 10 },
      { id: 'eligibility', label: 'Eligibility', description: 'The civil service eligibility or licence the position needs.', weight: 10 },
      { id: 'competency-exam', label: 'Competency examination', description: 'A written or practical examination of the knowledge and skills the position needs.', weight: 20 },
      { id: 'interview', label: 'Interview', description: 'A structured interview by the selection board.', weight: 15 },
      { id: 'work-sample', label: 'Work sample', description: 'A sample task of the job, such as a letter, a spreadsheet or a laboratory set-up.', weight: 15 },
    ],
  },
  {
    id: 'faculty-example', name: 'Faculty (example)', categoryId: 'faculty', example: true, version: 1,
    criteria: [
      { id: 'education', label: 'Education', description: 'Degrees relevant to the courses to be taught; a higher degree rates higher.', weight: 25 },
      { id: 'experience', label: 'Experience', description: 'Teaching, research and industry experience relevant to the position.', weight: 15 },
      { id: 'training', label: 'Training', description: 'Relevant training, seminars and professional development.', weight: 10 },
      { id: 'eligibility', label: 'Eligibility', description: 'The licence or eligibility the position needs, where it applies.', weight: 10 },
      { id: 'teaching-demo', label: 'Teaching demonstration', description: 'A demonstration class before the selection board and the college.', weight: 25 },
      { id: 'interview', label: 'Interview', description: 'A structured interview by the selection board.', weight: 15 },
    ],
  },
];
// The captions printed on the comparative list (HR settings → Assessment templates).
export const DEFAULT_PRINT = {
  title: 'Comparative assessment of applicants',
  signCaption: 'Prepared by',
  signName: '',
  signTitle: 'HRMPSB Secretariat',
};
export const DEFAULT_ASSESSMENT = Object.freeze({ categories: DEFAULT_CATEGORIES, templates: DEFAULT_TEMPLATES, print: DEFAULT_PRINT });
export const ASSESSMENT_LIMITS = { categories: 20, templates: 40, criteria: 15, label: 60, name: 80, description: 300, caption: 120 };

// The settings as stored, with anything missing filled from the defaults (always a fresh object).
export function mergeAssessment(v) {
  const categories = Array.isArray(v?.categories) ? v.categories.filter((c) => c && c.id).map((c) => ({ id: String(c.id), label: String(c.label || c.id), templateId: c.templateId ? String(c.templateId) : '' })) : structuredClone(DEFAULT_CATEGORIES);
  const templates = Array.isArray(v?.templates)
    ? v.templates.filter((x) => x && x.id).map((x) => ({
      id: String(x.id), name: String(x.name || x.id), categoryId: x.categoryId ? String(x.categoryId) : '', version: Number(x.version) || 1,
      ...(x.example ? { example: true } : {}), ...(x.retired ? { retired: true } : {}),
      ...(x.updatedAt ? { updatedAt: x.updatedAt, updatedBy: x.updatedBy || '' } : {}),
      criteria: (Array.isArray(x.criteria) ? x.criteria : []).filter((c) => c && c.id).map((c) => ({ id: String(c.id), label: String(c.label || c.id), description: String(c.description || ''), weight: Number(c.weight) || 0 })),
    }))
    : structuredClone(DEFAULT_TEMPLATES);
  return { categories, templates, print: { ...DEFAULT_PRINT, ...(v?.print || {}) } };
}

// ----- Weights and totals -----
// Weights and scores have at most two decimals; they are added in hundredths, so 33.33 + 33.33 +
// 33.34 is exactly 100.
const hundredths = (n) => Math.round(Number(n) * 100);
export const twoDecimals = (n) => Number.isFinite(Number(n)) && Math.abs(Number(n) * 100 - hundredths(n)) < 1e-6;
export const weightTotal = (criteria) => (criteria || []).reduce((s, c) => s + hundredths(c.weight), 0) / 100;
// What is wrong with a template's weights, or '' when they are right.
export function weightProblem(t) {
  const list = t?.criteria || [];
  if (!list.length) return `${t?.name || 'A template'}: add at least one criterion.`;
  for (const c of list) {
    const w = Number(c.weight);
    if (!Number.isFinite(w) || w <= 0 || w > 100 || !twoDecimals(w)) return `${t.name}: the weight of ${c.label || 'a criterion'} must be more than 0 and at most 100, with at most two decimals.`;
  }
  const total = weightTotal(list);
  if (total !== 100) return `${t.name}: the weights total ${total}%. They must total exactly 100%.`;
  return '';
}
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;
export function scoreProblem(label, v) {
  const n = Number(v);
  if (v === '' || v === null || v === undefined) return '';
  if (!Number.isFinite(n) || n < SCORE_MIN || n > SCORE_MAX || !twoDecimals(n)) return `${label}: give a score from ${SCORE_MIN} to ${SCORE_MAX}, with at most two decimals.`;
  return '';
}
// The weighted total of a rating: Σ score × weight / 100 over the criteria scored, in points out of 100
// (two decimals); each criterion's points; and whether every criterion has a score.
export function weightedTotal(criteria, scores = {}) {
  let sum = 0; // in ten-thousandths: hundredths of a score × hundredths of a weight / 100
  const points = {};
  let given = 0;
  for (const c of criteria || []) {
    const s = scores[c.id]?.score;
    if (s === undefined || s === null || s === '') continue;
    given++;
    const p = hundredths(s) * hundredths(c.weight); // × 10^-4, then / 100
    points[c.id] = Math.round(p / 100) / 10000;
    sum += p;
  }
  const total = Math.min(100, Math.round(sum / 10000) / 100);
  return { total, points, complete: given === (criteria || []).length && given > 0, given };
}
// Rank by total, highest first; equal totals share a rank ("1, 2, 2, 4"). list: [{ id, total }].
export function ranksOf(list) {
  const sorted = [...list].sort((a, b) => b.total - a.total);
  const out = new Map();
  sorted.forEach((x, i) => out.set(x.id, i && sorted[i - 1].total === x.total ? out.get(sorted[i - 1].id) : i + 1));
  return out;
}
export const fmtPoints = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toFixed(2));

// ----- The pool of applicants (PL-020) -----
// settings.people.applicantPoolMonths: how long someone stays in the pool (1 to 36; 12 by default).
// Only people who ticked the box themselves are ever in it; it is never ticked for them.
export const POOL_MONTHS = [1, 36];
export const DEFAULT_POOL_MONTHS = 12;
// The date `months` calendar months after `iso` (a 31st in a shorter month: the month's last day).
export function addMonths(iso, months) {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString();
}
// How long a person stays: what they agreed to, or less if the school has since shortened it.
export const poolMonthsFor = (optIn, settingMonths) => Math.max(1, Math.min(Number(optIn?.months) || settingMonths, settingMonths));
// The words of the tick box and its privacy note (sign-up, My applications).
export const poolTickText = (months) => `Keep me in the school's pool of applicants for other vacancies for ${months} month${months === 1 ? '' : 's'}`;
export const poolPrivacyText = (months) => `If an application of yours ends Not selected or Not qualified, HR keeps your name, contact details, what you gave at sign-up, the openings you applied to and your best rating, to invite you to apply for other openings. You stay in the pool for ${months} month${months === 1 ? '' : 's'}, and your account stays open as long; then you leave it and the usual removal applies. You can leave the pool at any time under My applications.`;
