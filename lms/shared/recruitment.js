// Recruitment in ATLAS People (HRIS requests PL-003, PL-004): job openings posted by HR,
// temporary applicant accounts for people outside the school, and internal applications by employees
// from their own account. Shared by the server (server/recruitment.js) and the browser (People).

// An opening: a draft is HR's own; an open one is visible to applicants until its closing date; a
// closed one takes no more applications.
export const OPENING_STATUSES = [
  ['draft', 'Draft'],
  ['open', 'Open'],
  ['closed', 'Closed'],
];
// Who may apply: anyone (applicant accounts and employees), or employees only.
export const AUDIENCES = [
  ['all', 'Open to all'],
  ['internal', 'Internal only'],
];
// An application's status is its fixed internal meaning (PL-015): in progress at one of the school's
// stages, or one of the final outcomes. HR moves it through the stages; only the applicant withdraws.
export const MEANINGS = [
  ['in-progress', 'In progress'],
  ['selected', 'Selected'],
  ['not-selected', 'Not selected'],
  ['withdrawn', 'Withdrawn'],
];
export const IN_PROGRESS = 'in-progress';
// Decided: the applicant can no longer withdraw.
export const DECIDED = ['not-selected', 'selected'];

const label = (list, k) => list.find(([id]) => id === k)?.[1] || k;
export const openingStatusLabel = (k) => label(OPENING_STATUSES, k);
export const audienceLabel = (k) => label(AUDIENCES, k);
export const meaningLabel = (k) => label(MEANINGS, k);

// ----- Applicant sign-up fields (PL-016, PL-028): a field list HR shows, hides or requires -----
// settings.people.signupFields: { field id: 'hidden' | 'optional' | 'required' }.
//  - Always asked, always required (not in the list): full name, email, username and password.
//  - The optional fields below, in the order the sign-up form shows them. By default only the mobile
//    number is asked (and optional): data minimisation under the Data Privacy Act of 2012 (RA 10173,
//    s. 11): a school asks at sign-up only what it needs to consider and contact an applicant.
//  - Never at sign-up: document uploads (they come with each application, PL-022) and an employee ID
//    (employees apply with their own account, PL-004).
// The values are kept on the applicant's account (user.phone, user.applicantProfile) and go with it
// when it is removed. Hiding a field later deletes nothing already given.
export const FIELD_RULES = [
  ['hidden', 'Hidden'],
  ['optional', 'Optional'],
  ['required', 'Required'],
];
export const FIXED_SIGNUP_FIELDS = [
  ['name', 'Full name'],
  ['email', 'Email'],
  ['username', 'Username'],
  ['password', 'Password'],
];
export const SIGNUP_FIELDS = [
  { id: 'phone', label: 'Mobile number', notice: 'mobile number', default: 'optional' },
  { id: 'sex', label: 'Sex', notice: 'sex', default: 'hidden' },
  { id: 'birthDate', label: 'Date of birth', notice: 'date of birth', default: 'hidden' },
  { id: 'address', label: 'Home address', notice: 'home address', default: 'hidden' },
  { id: 'education', label: 'Highest educational attainment', notice: 'highest educational attainment', default: 'hidden' },
  { id: 'campus', label: 'Preferred campus or place of assignment', notice: 'preferred campus', default: 'hidden' },
];
// Asked for by name in the request (PL-016) and refused with the reason.
export const NOT_AT_SIGNUP = {
  documents: 'Documents are not asked for at sign-up: the applicant attaches them to each application.',
  employeeId: 'An employee ID is not asked for at sign-up: employees apply with their own ATLAS account, not an applicant account.',
};
export const SEXES = [
  ['Male', 'Male'],
  ['Female', 'Female'],
]; // as on the CSC Personal Data Sheet, and the same values as employee records
export const EDUCATION_LEVELS = [
  ['elementary', 'Elementary'],
  ['secondary', 'Secondary'],
  ['vocational', 'Vocational or trade course'],
  ['college', 'College'],
  ['graduate', 'Graduate studies'],
]; // the levels of the PDS's educational background
export const ADDRESS_MAX = 300;
export const MIN_APPLICANT_AGE = 18;
export const EARLIEST_BIRTH_DATE = '1900-01-01';
export const DEFAULT_SIGNUP_FIELDS = Object.freeze(Object.fromEntries(SIGNUP_FIELDS.map((f) => [f.id, f.default])));
export const fieldRuleLabel = (k) => FIELD_RULES.find(([id]) => id === k)?.[1] || k;
export const sexLabel = (k) => SEXES.find(([id]) => id === k)?.[1] || '';
export const educationLabel = (k) => EDUCATION_LEVELS.find(([id]) => id === k)?.[1] || '';
export const signupFieldLabel = (id) => SIGNUP_FIELDS.find((f) => f.id === id)?.label || FIXED_SIGNUP_FIELDS.find(([k]) => k === id)?.[1] || id;

// The field list as stored, every field in the fixed order (unknown or bad values take the default).
export function mergeSignupFields(v) {
  const rules = new Set(FIELD_RULES.map(([k]) => k));
  return Object.fromEntries(SIGNUP_FIELDS.map((f) => [f.id, v && rules.has(v[f.id]) ? v[f.id] : f.default]));
}
// The optional fields the sign-up form shows (Optional or Required), in order.
export const shownSignupFields = (cfg) => SIGNUP_FIELDS.filter((f) => (cfg?.[f.id] || f.default) !== 'hidden').map((f) => ({ id: f.id, label: f.label, required: cfg?.[f.id] === 'required' }));
// What the privacy notice says is collected: exactly the fields on the form, in its order.
export function collectedFields(cfg) {
  const shown = new Set(shownSignupFields(cfg).map((f) => f.id));
  return ['name', 'email', ...SIGNUP_FIELDS.filter((f) => shown.has(f.id)).map((f) => f.notice), 'username'];
}
// "a, b and c"
export const listInWords = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

// Date of birth: a real YYYY-MM-DD date, in the past, and the applicant at least 18 on `today`.
// Returns what is wrong, or '' when it is fine.
export const isRealDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
export function ageOn(birthDate, today) {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}
// The latest date of birth of someone who is `MIN_APPLICANT_AGE` on `today` (a 29 February birthday
// counts from 1 March in a common year).
export function latestBirthDate(today, age = MIN_APPLICANT_AGE) {
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(Date.UTC(y - age, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) dt.setUTCDate(0); // 29 Feb in a common year: 28 Feb
  return dt.toISOString().slice(0, 10);
}
export function birthDateProblem(value, today) {
  if (!isRealDate(value)) return 'Date of birth: pick a real date.';
  if (value >= today) return 'Date of birth must be in the past.';
  if (value < EARLIEST_BIRTH_DATE) return 'Date of birth: check the year.';
  if (ageOn(value, today) < MIN_APPLICANT_AGE) return `Applicants must be at least ${MIN_APPLICANT_AGE} years old.`;
  return '';
}

// What a job applicant gave at sign-up besides their name, email and mobile number, as HR and the
// applicant read it (campusNameOf: a campus id to its name). Kept even if the field has been hidden
// since. null when nothing was given.
export function applicantDetails(u, campusNameOf = () => '') {
  const p = u?.role === 'applicant' ? u.applicantProfile : null;
  if (!p || !Object.keys(p).length) return null;
  return {
    sex: p.sex || '', sexLabel: sexLabel(p.sex),
    birthDate: p.birthDate || '',
    address: p.address || '',
    education: p.education || '', educationLabel: educationLabel(p.education),
    campusId: p.campusId || '', campusName: p.campusId ? campusNameOf(p.campusId) || '(a campus since removed)' : '',
  };
}

// settings.people (Settings center → ATLAS People → Job applicants; HR settings in People).
export const DEFAULT_PEOPLE_SETTINGS = {
  applicantAccountDays: 365, // an applicant account closes this many days after sign-up (PL-003)
  applicantWarnDays: 30, // the applicant is told on the bell this many days before it closes, once
  applicantPurgeDays: 30, // a closed account and its applications' personal data are removed this many days later; 0 = when HR removes them
  signupFields: DEFAULT_SIGNUP_FIELDS, // what sign-up asks besides name, email, username and password (PL-016)
  applicantPoolMonths: 12, // how long someone who opted in stays in the pool of applicants (PL-020; 1 to 36)
};
// The settings as stored, with anything missing filled from the defaults (always a fresh object).
export const mergePeopleSettings = (v) => ({ ...DEFAULT_PEOPLE_SETTINGS, ...(v || {}), signupFields: mergeSignupFields(v?.signupFields) });
export const PEOPLE_SETTING_LIMITS = {
  applicantAccountDays: [30, 1095],
  applicantWarnDays: [1, 90],
  applicantPurgeDays: [0, 365],
};

export const DAY_MS = 86400000;
// An applicant account past its closing time (other account types never expire this way).
export const applicantExpired = (user, nowMs = Date.now()) => Boolean(user && user.role === 'applicant' && user.expiresAt && Date.parse(user.expiresAt) <= nowMs);

// Whether an opening takes applications on `today` (YYYY-MM-DD, the school's local date): open, and
// its closing date not yet passed (applications are taken through the closing date itself).
export const openingAccepts = (o, today) => Boolean(o && o.status === 'open' && (!o.closingDate || today <= o.closingDate));

// ----- Recruitment stages (PL-015): a lookup list with fixed meanings -----
// settings.recruitmentStages (HR settings → Recruitment stages; Settings center → ATLAS People).
//  - stages: the in-progress stages, in order. HR adds, renames, reorders and retires them; each has
//    a short description the applicant reads (what happens now, what they may be asked to do). A stage
//    an application has been at is never deleted, only retired: its id, label and place stay, so
//    every application's history keeps its meaning.
//  - outcomes: the final outcomes. Their ids and meanings are fixed in the code (OUTCOME_MEANING);
//    only their labels and descriptions change. "Not qualified" is an optional outcome with the
//    meaning Not selected (it can be retired); Withdrawn is set only by the applicant.
// The defaults follow the usual public-sector merit selection flow; each school confirms them
// against its own merit selection plan.
export const DEFAULT_STAGES = [
  { id: 'received', label: 'Application received', description: 'HR has your application and checks that it is complete. You may be asked for a missing document.' },
  { id: 'screening', label: 'Initial screening', description: 'HR compares your application with the qualification standards of the position: education, training, experience and eligibility. You may be asked to send or bring documents.' },
  { id: 'assessment', label: 'Assessment (examination or interview)', description: 'Qualified applicants are assessed, for example by a written examination, a skills test or an interview. HR tells you the date, time and place, and what to bring.' },
  { id: 'deliberation', label: 'Deliberation', description: 'The selection board compares the assessed applicants and recommends whom to appoint. There is nothing you need to do at this stage.' },
  { id: 'final-decision', label: 'Final decision', description: 'The appointing authority chooses from the applicants the board recommended. You are told the outcome here and on the bell.' },
];
export const OUTCOME_MEANING = { selected: 'selected', 'not-qualified': 'not-selected', 'not-selected': 'not-selected', withdrawn: 'withdrawn' };
export const OPTIONAL_OUTCOMES = ['not-qualified'];
export const DEFAULT_OUTCOMES = [
  { id: 'selected', label: 'Selected', description: 'You were chosen for this position. HR tells you the next steps for your appointment.' },
  { id: 'not-qualified', label: 'Not qualified', description: 'Your application does not meet the qualification standards of this position. You may apply for other openings.' },
  { id: 'not-selected', label: 'Not selected', description: 'Another applicant was chosen for this position. Thank you for applying; you may apply for other openings.' },
  { id: 'withdrawn', label: 'Withdrawn', description: 'You withdrew this application.' },
];
export const DEFAULT_RECRUITMENT_STAGES = { stages: DEFAULT_STAGES, outcomes: DEFAULT_OUTCOMES };
export const STAGE_LIMITS = { stages: 20, label: 60, description: 400 };

// The stage list as stored, with anything missing filled from the defaults: every outcome is there,
// in the fixed order, with its fixed id.
export function mergeRecruitmentStages(v) {
  const stages = Array.isArray(v?.stages) && v.stages.length
    ? v.stages.filter((s) => s && typeof s.id === 'string' && s.id).map((s) => ({ id: s.id, label: String(s.label || s.id), description: String(s.description || ''), ...(s.retired ? { retired: true } : {}) }))
    : structuredClone(DEFAULT_STAGES);
  const saved = Object.fromEntries((Array.isArray(v?.outcomes) ? v.outcomes : []).filter((o) => o && OUTCOME_MEANING[o.id]).map((o) => [o.id, o]));
  const outcomes = DEFAULT_OUTCOMES.map((d) => {
    const o = saved[d.id] || d;
    return { id: d.id, label: String(o.label || d.label), description: String(o.description ?? d.description), ...(o.retired && OPTIONAL_OUTCOMES.includes(d.id) ? { retired: true } : {}) };
  });
  return { stages, outcomes };
}

// One stage or outcome by its id: its label, description, kind, meaning and place.
export function stageInfo(cfg, id) {
  const i = cfg.stages.findIndex((s) => s.id === id);
  if (i >= 0) return { ...cfg.stages[i], kind: 'stage', meaning: IN_PROGRESS, index: i };
  const o = cfg.outcomes.find((x) => x.id === id);
  if (o) return { ...o, kind: 'outcome', meaning: OUTCOME_MEANING[o.id], index: cfg.stages.length };
  return { id, label: id || '—', description: '', kind: 'unknown', meaning: IN_PROGRESS, index: -1 };
}
export const stageLabel = (cfg, id) => stageInfo(cfg, id).label;
export const meaningOf = (cfg, id) => stageInfo(cfg, id).meaning;
export const activeStages = (cfg) => cfg.stages.filter((s) => !s.retired);
// The stage an application starts at when it is sent (or sent again after withdrawing).
export const firstStage = (cfg) => activeStages(cfg)[0] || cfg.stages[0];
// The stage before `id` in the order, skipping retired ones (null at the first).
export function previousStage(cfg, id) {
  const i = cfg.stages.findIndex((s) => s.id === id);
  for (let j = i - 1; j >= 0; j--) if (!cfg.stages[j].retired) return cfg.stages[j];
  return null;
}

// ----- Moving to the stages: the statuses before PL-015, mapped to the stages (kept in the code) -----
// received → the first stage; review (Under review) → the second; shortlisted → the assessment stage;
// the final ones → the same final outcomes.
export const LEGACY_STATUSES = {
  received: (cfg) => cfg.stages[0]?.id,
  review: (cfg) => (cfg.stages[1] || cfg.stages[0])?.id,
  shortlisted: (cfg) => (cfg.stages.find((s) => s.id === 'assessment') || cfg.stages[2] || cfg.stages.at(-1))?.id,
  selected: () => 'selected',
  'not-selected': () => 'not-selected',
  withdrawn: () => 'withdrawn',
};
export const legacyStage = (cfg, status) => (Object.hasOwn(LEGACY_STATUSES, status) ? LEGACY_STATUSES[status] : LEGACY_STATUSES.received)(cfg);

// Applications from before the stages: each gets its stage from its old status, and its history
// (already kept on the application, the same changes the audit log has) is carried over entry by
// entry: who, when, and the note to the applicant. One without a history starts it here, with its
// current state. Applications already on the stages are left as they are. Returns how many moved.
export function migrateApplications(data, at = new Date().toISOString()) {
  const cfg = mergeRecruitmentStages(data.settings?.recruitmentStages);
  let n = 0;
  for (const a of data.jobApplications || []) {
    if (a.stage) continue;
    const from = a.status;
    a.stage = legacyStage(cfg, from);
    a.status = meaningOf(cfg, a.stage);
    a.legacyStatus = from; // what it was, for the record
    const old = Array.isArray(a.history) ? a.history : [];
    a.history = old.length
      ? old.map((h) => ({
        stage: h.stage || legacyStage(cfg, h.status), at: h.at,
        ...(h.self ? { self: true, ...(h.status === 'received' ? { applied: true } : {}) } : { by: h.by || '' }),
        ...(h.note ? { note: h.note } : {}),
      }))
      : [{ stage: a.stage, at: a.updatedAt || a.createdAt || at, migrated: true, ...(a.statusNote ? { note: a.statusNote } : {}) }];
    n++;
  }
  return n;
}

// ----- What the applicant sees: the tracker -----
// The stages of the application's current round (since it was last sent), each done, current, to
// come or skipped, with the date it was reached; retired stages only where the application has been.
// Once decided (or withdrawn), the stages it never reached are left out and the outcome ends the list.
export function trackerOf(cfg, a) {
  const hist = a.history || [];
  let start = 0;
  hist.forEach((h, i) => {
    if (h.applied) start = i;
  });
  const round = hist.slice(start);
  const reached = new Map();
  for (const h of round) reached.set(h.stage, h.at);
  const here = stageInfo(cfg, a.stage);
  const decided = here.kind === 'outcome';
  // A retired stage only where it is the current one, or was reached before it (never "to come").
  const at = cfg.stages.findIndex((s) => s.id === a.stage);
  const list = cfg.stages.filter((s, i) => !s.retired || s.id === a.stage || (reached.has(s.id) && (decided || i < at)));
  const current = list.findIndex((s) => s.id === a.stage);
  const last = decided ? Math.max(-1, ...list.map((s, i) => (reached.has(s.id) ? i : -1))) : current;
  const steps = [];
  list.forEach((s, i) => {
    if (decided && i > last) return;
    const state = decided || i < current ? (reached.has(s.id) ? 'done' : 'skipped') : i === current ? 'current' : 'next';
    steps.push({ id: s.id, label: s.label, description: s.description, state, at: state === 'next' || state === 'skipped' ? null : reached.get(s.id) || null });
  });
  const since = [...round].reverse().find((h) => h.stage === a.stage)?.at || a.updatedAt || null;
  if (decided) steps.push({ id: here.id, label: here.label, description: here.description, state: 'outcome', meaning: here.meaning, at: since });
  return {
    steps,
    current: { id: here.id, label: here.label, description: here.description, kind: here.kind, meaning: here.meaning, since },
    outcome: decided ? { id: here.id, label: here.label, description: here.description, meaning: here.meaning, at: since } : null,
    step: decided ? null : steps.findIndex((s) => s.state === 'current') + 1,
    of: decided ? null : steps.length,
  };
}
