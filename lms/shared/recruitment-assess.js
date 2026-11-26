// Rating applicants and the pool of applicants in ATLAS People's recruitment (HRIS requests PL-018,
// PL-020, PL-021 and PL-066). Shared by the server (server/recruitment-assess.js) and the browser
// (People → Recruitment, Ratings to do, HR settings → Assessment templates).
//
//  - Position categories (Faculty, Non-teaching, …): a small list HR edits, each with the assessment
//    template a new opening in it starts with.
//  - Assessment templates: criteria, each with a label, a description and a weight in %. The weights
//    total exactly 100 (anything else is refused: PL-066). Each criterion is scored 0 to 100, so the
//    weighted total, Σ score × weight / 100, is never more than 100.
//  - The two built-in templates are EXAMPLES, to be replaced with the school's own merit selection
//    plan: their criteria and weights are plausible, not taken from any circular.
//  - Several assessors (PL-021): HR names a selection board (panel) per opening. Each assessor rates
//    each applicant on their own; their ratings are combined by the template's rule (COMBINE_RULES):
//    the average of the assessors (the default), the average without the highest and the lowest
//    score (only with 3 or more scores; otherwise the plain average), or the board's consensus,
//    one agreed score per criterion entered by the secretariat (HR). Averages are per criterion.
//  - A "Performance rating" criterion (type 'performance'): a typed score with a source note (People
//    has no IPCR yet), or an adjectival rating converted with the template's table (EXAMPLES to
//    replace). For external applicants it is not applicable by default: its weight is spread over the
//    other criteria ('spread'); a template can instead take a typed score ('typed').

// How the assessors' ratings of an application are combined (per template).
export const COMBINE_RULES = [
  ['average', 'Average of the assessors', 'Each criterion: the average of the assessors\' scores.'],
  ['trimmed', 'Average without the highest and lowest', 'Each criterion: the highest and the lowest score are left out, and the rest averaged. Only with 3 or more scores; with fewer, the plain average.'],
  ['consensus', 'Board consensus', 'The secretariat enters one agreed score per criterion after the board meets; the assessors\' own scores are kept for reference.'],
];
export const DEFAULT_COMBINE = 'average';
export const combineLabel = (id) => COMBINE_RULES.find(([k]) => k === id)?.[1] || COMBINE_RULES[0][1];
// The kinds of criterion: a score, or the performance rating (with its adjectival table).
export const CRITERION_TYPES = [['score', 'Score (0 to 100)'], ['performance', 'Performance rating']];
// The adjectival ratings and what each counts for, out of 100: EXAMPLES, to replace with the
// school's own conversion (its merit selection plan).
export const DEFAULT_ADJECTIVAL = [
  { label: 'Outstanding', score: 100 },
  { label: 'Very Satisfactory', score: 90 },
  { label: 'Satisfactory', score: 75 },
  { label: 'Unsatisfactory', score: 50 },
  { label: 'Poor', score: 25 },
];
export const ADJECTIVAL_NOTE = 'Example values: replace them with the conversion in the school\'s merit selection plan.';
// External applicants and the performance rating: not applicable (its weight spread over the other
// criteria; the default), or a typed score (for example a rating from a previous employer).
export const EXTERNAL_RULES = [
  ['spread', 'Not applicable: its weight is spread over the other criteria'],
  ['typed', 'A typed score, e.g. a rating from a previous employer'],
];
export const DEFAULT_EXTERNAL = 'spread';
export const NOT_APPLICABLE = 'Not applicable (external applicant): its weight is spread over the other criteria.';
// Whether a criterion is left out for this applicant (its weight spread over the others).
export const skippedFor = (c, internal) => c.type === 'performance' && !internal && (c.external || DEFAULT_EXTERNAL) === 'spread';
export const skipSet = (criteria, internal) => new Set((criteria || []).filter((c) => skippedFor(c, internal)).map((c) => c.id));

export const DEFAULT_CATEGORIES = [
  { id: 'faculty', label: 'Faculty', templateId: 'faculty-example' },
  { id: 'non-teaching', label: 'Non-teaching', templateId: 'non-teaching-example' },
];
export const EXAMPLE_NOTE = 'An example: replace it with the criteria and weights of the school\'s merit selection plan.';
export const DEFAULT_TEMPLATES = [
  {
    id: 'non-teaching-example', name: 'Non-teaching (example)', categoryId: 'non-teaching', example: true, version: 1, combine: 'average',
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
    id: 'faculty-example', name: 'Faculty (example)', categoryId: 'faculty', example: true, version: 1, combine: 'average',
    criteria: [
      { id: 'education', label: 'Education', description: 'Degrees relevant to the courses to be taught; a higher degree rates higher.', weight: 25 },
      { id: 'experience', label: 'Experience', description: 'Teaching, research and industry experience relevant to the position.', weight: 15 },
      { id: 'training', label: 'Training', description: 'Relevant training, seminars and professional development.', weight: 10 },
      { id: 'eligibility', label: 'Eligibility', description: 'The licence or eligibility the position needs, where it applies.', weight: 10 },
      { id: 'teaching-demo', label: 'Teaching demonstration', description: 'A demonstration class before the selection board and the college.', weight: 25 },
      { id: 'interview', label: 'Interview', description: 'A structured interview by the selection board.', weight: 15 },
    ],
  },
  {
    id: 'promotion-example', name: 'Promotion, non-teaching (example)', categoryId: 'non-teaching', example: true, version: 1, combine: 'average',
    criteria: [
      { id: 'performance', label: 'Performance rating', description: 'The latest performance rating (IPCR) of an employee applying for promotion.', weight: 25, type: 'performance', table: DEFAULT_ADJECTIVAL.map((x) => ({ ...x })), tableExample: true, external: 'spread' },
      { id: 'education', label: 'Education', description: 'Education relevant to the position, beyond the qualification standard.', weight: 15 },
      { id: 'experience', label: 'Experience', description: 'Relevant work experience, beyond the qualification standard.', weight: 15 },
      { id: 'training', label: 'Training', description: 'Relevant training hours, beyond the qualification standard.', weight: 10 },
      { id: 'competency-exam', label: 'Competency examination', description: 'A written or practical examination of the knowledge and skills the position needs.', weight: 15 },
      { id: 'interview', label: 'Interview', description: 'A structured interview by the selection board.', weight: 20 },
    ],
  },
];
// The captions printed on the comparative list (HR settings → Assessment templates).
export const DEFAULT_PRINT = {
  title: 'Comparative assessment of applicants',
  signCaption: 'Prepared by',
  signName: '',
  signTitle: 'HRMPSB Secretariat',
  boardCaption: 'Rated by',
  memberTitle: 'Member, HRMPSB',
};
// The selection board's options: whether an assessor who has submitted sees the combined result
// (the total and rank). Off by default: only HR sees it, and only HR ever sees the breakdown.
export const DEFAULT_BOARD = { assessorsSeeResult: false };
export const DEFAULT_ASSESSMENT = Object.freeze({ categories: DEFAULT_CATEGORIES, templates: DEFAULT_TEMPLATES, print: DEFAULT_PRINT, board: DEFAULT_BOARD });
export const ASSESSMENT_LIMITS = { categories: 20, templates: 40, criteria: 15, label: 60, name: 80, description: 300, caption: 120, table: 10, source: 200, panel: 15 };

// The settings as stored, with anything missing filled from the defaults (always a fresh object).
export const mergeCriterion = (c) => ({
  id: String(c.id), label: String(c.label || c.id), description: String(c.description || ''), weight: Number(c.weight) || 0,
  ...(c.type === 'performance' ? {
    type: 'performance',
    table: (Array.isArray(c.table) ? c.table : DEFAULT_ADJECTIVAL).filter((x) => x && x.label).map((x) => ({ label: String(x.label), score: Number(x.score) || 0 })),
    ...(c.tableExample || !Array.isArray(c.table) ? { tableExample: true } : {}),
    external: EXTERNAL_RULES.some(([k]) => k === c.external) ? c.external : DEFAULT_EXTERNAL,
  } : {}),
});
export function mergeAssessment(v) {
  const categories = Array.isArray(v?.categories) ? v.categories.filter((c) => c && c.id).map((c) => ({ id: String(c.id), label: String(c.label || c.id), templateId: c.templateId ? String(c.templateId) : '' })) : structuredClone(DEFAULT_CATEGORIES);
  const templates = Array.isArray(v?.templates)
    ? v.templates.filter((x) => x && x.id).map((x) => ({
      id: String(x.id), name: String(x.name || x.id), categoryId: x.categoryId ? String(x.categoryId) : '', version: Number(x.version) || 1,
      combine: COMBINE_RULES.some(([k]) => k === x.combine) ? x.combine : DEFAULT_COMBINE,
      ...(x.example ? { example: true } : {}), ...(x.retired ? { retired: true } : {}),
      ...(x.updatedAt ? { updatedAt: x.updatedAt, updatedBy: x.updatedBy || '' } : {}),
      criteria: (Array.isArray(x.criteria) ? x.criteria : []).filter((c) => c && c.id).map(mergeCriterion),
    }))
    : structuredClone(DEFAULT_TEMPLATES);
  return { categories, templates, print: { ...DEFAULT_PRINT, ...(v?.print || {}) }, board: { ...DEFAULT_BOARD, ...(v?.board || {}) } };
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
// skip: criteria left out for this applicant (the performance rating of an external applicant): their
// weight is spread over the others in proportion, Σ score × weight / Σ weights of the rest.
export function weightedTotal(criteria, scores = {}, skip = null) {
  let sum = 0; // in ten-thousandths: hundredths of a score × hundredths of a weight
  const points = {};
  let given = 0;
  const used = (criteria || []).filter((c) => !skip?.has(c.id));
  const W = used.reduce((n, c) => n + hundredths(c.weight), 0) || 10000; // the weights counted, in hundredths (10000 = 100%)
  for (const c of used) {
    const s = scores?.[c.id]?.score;
    if (s === undefined || s === null || s === '') continue;
    given++;
    const p = hundredths(s) * hundredths(c.weight);
    points[c.id] = Math.round((p * 100) / W) / 10000;
    sum += p;
  }
  const total = Math.min(100, Math.round(sum / W) / 100);
  return { total, points, complete: given === used.length && given > 0, given };
}
// The weight a criterion counts for with `skip` (its own, or more when another's is spread).
export function effectiveWeight(criteria, c, skip = null) {
  if (skip?.has(c.id)) return 0;
  const W = (criteria || []).filter((x) => !skip?.has(x.id)).reduce((n, x) => n + hundredths(x.weight), 0) || 10000;
  return Math.round((hundredths(c.weight) * 10000) / W) / 100;
}

// ----- Several assessors (PL-021) -----
// The combined score of each criterion from the submitted ratings, by the rule: 'average' (the mean),
// 'trimmed' (without the highest and lowest when there are 3 or more scores), or 'consensus' (the
// secretariat's agreed scores; null until they are entered). Scores are kept in hundredths, so the
// mean is exact to two decimals (rounded half up).
export function combineScores(criteria, ratings, rule = DEFAULT_COMBINE, consensus = null, skip = null) {
  if (rule === 'consensus') return consensus?.scores ? { scores: structuredClone(consensus.scores), counts: {}, trimmed: {} } : null;
  const scores = {};
  const counts = {};
  const trimmed = {};
  for (const c of criteria || []) {
    if (skip?.has(c.id)) continue;
    let list = (ratings || []).map((r) => ({ by: r.slot, v: r.scores?.[c.id]?.score })).filter((x) => x.v !== undefined && x.v !== null && x.v !== '').map((x) => ({ ...x, h: hundredths(x.v) }));
    if (!list.length) continue;
    counts[c.id] = list.length;
    if (rule === 'trimmed' && list.length >= 3) {
      list = [...list].sort((a, b) => a.h - b.h);
      trimmed[c.id] = [list[0].by, list.at(-1).by];
      list = list.slice(1, -1);
    }
    scores[c.id] = { score: Math.round(list.reduce((n, x) => n + x.h, 0) / list.length) / 100 };
  }
  return { scores, counts, trimmed };
}
// The combined rating of an application: its scores, total and completeness, or null when nothing
// counts yet (no submitted rating; or, for a consensus, no agreed scores yet).
export function combineRating(criteria, ratings, rule = DEFAULT_COMBINE, consensus = null, skip = null) {
  const submitted = (ratings || []).filter((r) => r.submittedAt);
  if (rule !== 'consensus' && !submitted.length) return null;
  const c = combineScores(criteria, submitted, rule, consensus, skip);
  if (!c) return null;
  const sum = weightedTotal(criteria, c.scores, skip);
  if (!sum.given) return null;
  return { scores: c.scores, counts: c.counts, trimmed: c.trimmed, total: sum.total, points: sum.points, complete: sum.complete, count: submitted.length, rule };
}

// Existing single ratings (before several assessors) become one assessor's rating, by the person who
// rated: the HR office's rating ('hr'), submitted when it was made. Nothing else changes, so an
// opening rated so far keeps its totals and ranks (the average of one rating is that rating).
export function migrateRatings(data) {
  let n = 0;
  for (const a of data.jobApplications || []) {
    if (!a.rating || Array.isArray(a.ratings)) continue;
    const r = a.rating;
    a.ratings = [{
      slot: 'hr', by: r.by || '', byId: r.byId || null, at: r.at, submittedAt: r.at, version: r.version, scores: structuredClone(r.scores || {}),
      total: r.total, complete: Boolean(r.complete), history: structuredClone(r.history || []), migrated: true,
    }];
    a.rating = { ...r, rule: r.rule || DEFAULT_COMBINE, count: 1 };
    n++;
  }
  return n;
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
