// Applicants' documents in ATLAS People's recruitment (HRIS requests PL-022, with PL-006 and PL-007 as
// settings). Shared by the server (server/recruitment-docs.js) and the browser (an applicant's
// checklist, HR's review, HR settings → Applicant documents).
//
//  - A requirements checklist per opening: documents, each with a name, a short note and Required or
//    Optional. A new opening copies the default checklist of its position category (HR settings),
//    and HR edits it on the opening.
//  - The applicant upload policy (PL-006, PL-007): the file types allowed (PDF, Word, Excel and
//    pictures by default), the largest file (2 MB by default; 1 to 10 MB) and the most files per
//    application (15). The type is always worked out from the file's bytes (server/dms/types.js);
//    programs, scripts, web pages, Office files with macros and password-protected Office files are
//    refused whatever the settings.
//  - Each item's status for the applicant: Not yet uploaded, Uploaded, Accepted, or Needs a new file
//    (with HR's note).

// The file types HR can allow, each as the extensions the bytes may turn out to be.
export const UPLOAD_TYPES = [
  { id: 'pdf', label: 'PDF', exts: ['pdf'] },
  { id: 'word', label: 'Word (DOC, DOCX)', exts: ['doc', 'docx'] },
  { id: 'excel', label: 'Excel (XLS, XLSX)', exts: ['xls', 'xlsx'] },
  { id: 'image', label: 'Pictures (JPEG, PNG, GIF)', exts: ['jpg', 'jpeg', 'png', 'gif'] },
];
export const TYPE_OF_EXT = Object.fromEntries(UPLOAD_TYPES.flatMap((t) => t.exts.map((e) => [e, t.id])));
export const POLICY_LIMITS = { maxMb: [1, 10], maxFiles: [1, 50], help: 1000, items: 30, name: 80, note: 200, reviewNote: 500 };
export const DEFAULT_HELP = 'To make a file smaller: save or export it as PDF with "smaller size" or "minimum size" chosen, scan at 150 dpi in black and white or greyscale rather than colour, or take a clear photo instead of a scan. A long document can be split into parts (for example pages 1–10 and 11–20) and each part uploaded under the same item. ATLAS Tools → PDF Studio can compress and split PDFs.';
export const DEFAULT_POLICY = { types: UPLOAD_TYPES.map((t) => t.id), maxMb: 2, maxFiles: 15, help: DEFAULT_HELP };

// The default checklists per position category: EXAMPLES, to replace with what the school's merit
// selection plan asks for.
export const CHECKLIST_NOTE = 'An example: replace it with the documents the school\'s merit selection plan asks for.';
const item = (id, name, note, required) => ({ id, name, note, required });
export const DEFAULT_CHECKLISTS = {
  faculty: [
    item('pds', 'Personal Data Sheet (CS Form 212)', 'Filled in and signed, with a recent photo.', true),
    item('tor', 'Transcript of records', 'For every degree you list.', true),
    item('diploma', 'Diploma', 'Of your highest degree.', true),
    item('eligibility', 'Certificate of eligibility or licence', 'Board rating or PRC licence, where the position needs one.', false),
    item('performance', 'Performance rating', 'Your latest rating (employees: the IPCR of the last period).', false),
    item('training', 'Training certificates', 'Relevant trainings and seminars.', false),
  ],
  'non-teaching': [
    item('pds', 'Personal Data Sheet (CS Form 212)', 'Filled in and signed, with a recent photo.', true),
    item('tor', 'Transcript of records', 'Or your diploma or certificate of completion.', true),
    item('eligibility', 'Certificate of eligibility', 'Career Service or other eligibility the position needs.', true),
    item('performance', 'Performance rating', 'Your latest rating (employees: the IPCR of the last period).', false),
    item('training', 'Training certificates', 'Relevant trainings and seminars.', false),
  ],
};
export const DEFAULT_APPLICANT_DOCS = { ...DEFAULT_POLICY, checklists: DEFAULT_CHECKLISTS, examples: Object.keys(DEFAULT_CHECKLISTS) };

const int = (v, [lo, hi], d) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : d;
};
export const mergeItem = (x) => ({ id: String(x.id), name: String(x.name || x.id), note: String(x.note || ''), required: x.required === true });
// settings.applicantDocs as stored, filled from the defaults (always a fresh object).
export function mergeApplicantDocs(v) {
  const types = Array.isArray(v?.types) ? UPLOAD_TYPES.map((t) => t.id).filter((id) => v.types.includes(id)) : [...DEFAULT_POLICY.types];
  const checklists = v?.checklists && typeof v.checklists === 'object' && !Array.isArray(v.checklists)
    ? Object.fromEntries(Object.entries(v.checklists).filter(([, list]) => Array.isArray(list)).map(([k, list]) => [k, list.filter((x) => x && x.id).map(mergeItem)]))
    : structuredClone(DEFAULT_CHECKLISTS);
  return {
    types: types.length ? types : [...DEFAULT_POLICY.types],
    maxMb: int(v?.maxMb, POLICY_LIMITS.maxMb, DEFAULT_POLICY.maxMb),
    maxFiles: int(v?.maxFiles, POLICY_LIMITS.maxFiles, DEFAULT_POLICY.maxFiles),
    help: typeof v?.help === 'string' ? v.help : DEFAULT_HELP,
    checklists,
    // The categories whose checklist is still the built-in example (until HR changes it).
    examples: Array.isArray(v?.examples) ? v.examples.filter((k) => typeof k === 'string') : v?.checklists ? [] : Object.keys(DEFAULT_CHECKLISTS),
  };
}

export const MB = 1024 * 1024;
export const sizeText = (bytes) => (bytes < MB ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(Math.round((bytes / MB) * 10) / 10).toFixed(1)} MB`);
// The extensions allowed by a policy, and the words for them ("PDF, Word (DOC, DOCX) or Excel …").
export const allowedExts = (policy) => UPLOAD_TYPES.filter((t) => policy.types.includes(t.id)).flatMap((t) => t.exts);
export const acceptAttr = (policy) => allowedExts(policy).map((e) => `.${e}`).join(',');
export function typesInWords(policy) {
  const l = UPLOAD_TYPES.filter((t) => policy.types.includes(t.id)).map((t) => t.label);
  return l.length > 1 ? `${l.slice(0, -1).join(', ')} or ${l.at(-1)}` : l[0] || '';
}
// The messages (PL-007): what is wrong and what to do.
export const sizeMessage = (bytes, maxMb) => `This file is ${sizeText(bytes)}; the limit is ${maxMb} MB. Save it as PDF with a smaller size, scan at a lower resolution, or split it.`;
export const countMessage = (maxFiles) => `An application can have at most ${maxFiles} files. Remove one you no longer need, or combine pages into one PDF.`;
export const typeMessage = (policy) => `Upload ${typesInWords(policy)} files only.`;
export const policyLine = (policy) => `${typesInWords(policy)}; up to ${policy.maxMb} MB a file, ${policy.maxFiles} files an application.`;

// ----- Statuses -----
export const DOC_STATUSES = [
  ['missing', 'Not yet uploaded', 'gray'],
  ['uploaded', 'Uploaded', 'blue'],
  ['accepted', 'Accepted', 'green'],
  ['needs-new', 'Needs a new file', 'amber'],
];
export const docStatusLabel = (s) => DOC_STATUSES.find(([k]) => k === s)?.[1] || s;
export const docStatusKind = (s) => DOC_STATUSES.find(([k]) => k === s)?.[2] || '';
// An item's status: no file → missing; HR's review if any (and not undone by a newer file); else uploaded.
export function itemStatus(files, review) {
  if (review?.status === 'needs-new') return 'needs-new';
  if (!files.length) return 'missing';
  if (review?.status === 'accepted') return 'accepted';
  return 'uploaded';
}
// "complete / missing N required": required items with no file, or with a file HR asked to replace.
export function completeness(requirements, filesOf, reviewOf = () => null) {
  const missing = (requirements || []).filter((r) => r.required && ['missing', 'needs-new'].includes(itemStatus(filesOf(r.id), reviewOf(r.id))));
  const required = (requirements || []).filter((r) => r.required).length;
  return { required, missing: missing.length, missingNames: missing.map((r) => r.name), complete: missing.length === 0 };
}
export const completenessText = (c) => (c.complete ? 'Complete' : `Missing ${c.missing} required`);
