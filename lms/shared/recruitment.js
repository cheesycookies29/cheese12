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
// An application's status (a simple tracker; full stages come with PL-015). HR sets all but Withdrawn,
// which only the applicant sets.
export const APPLICATION_STATUSES = [
  ['received', 'Received'],
  ['review', 'Under review'],
  ['shortlisted', 'Shortlisted'],
  ['not-selected', 'Not selected'],
  ['selected', 'Selected'],
  ['withdrawn', 'Withdrawn'],
];
export const HR_STATUSES = APPLICATION_STATUSES.map(([k]) => k).filter((k) => k !== 'withdrawn');
// Decided: the applicant can no longer withdraw.
export const DECIDED = ['not-selected', 'selected'];

const label = (list, k) => list.find(([id]) => id === k)?.[1] || k;
export const openingStatusLabel = (k) => label(OPENING_STATUSES, k);
export const audienceLabel = (k) => label(AUDIENCES, k);
export const applicationStatusLabel = (k) => label(APPLICATION_STATUSES, k);

// settings.people (Settings center → ATLAS People → Job applicants; HR settings in People).
export const DEFAULT_PEOPLE_SETTINGS = {
  applicantAccountDays: 365, // an applicant account closes this many days after sign-up (PL-003)
  applicantWarnDays: 30, // the applicant is told on the bell this many days before it closes, once
  applicantPurgeDays: 30, // a closed account and its applications' personal data are removed this many days later; 0 = when HR removes them
};
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
