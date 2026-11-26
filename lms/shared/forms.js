// Document circulation (Admin panel → System → Document circulation, and ATLAS Tools): one place to
// upload and keep every downloadable form and file the systems give their people (a leave application,
// a clearance, an enrollment form, a request for quotation). Each system then shows the current
// published version of its forms on its own "Forms & downloads" page (server/forms.js).
//
// Shared by the server (enforcement) and the pages. Nothing here imports shared/roles.js (which
// imports the permissions from here).
//
// The modules covered: the ATLAS home (school-wide forms), every built-in system in shared/systems.js
// except ATLAS Documents (the document management module keeps its own files), and ATLAS Tools. A
// system added to shared/systems.js as built in shows up here by itself, with its own permission.
import { SYSTEMS, TOOL_ROLES } from './systems.js';
import { brandName, productName } from './brand.js';

// Systems that are never covered: ATLAS Documents is the document management module itself.
export const EXCLUDED_SYSTEMS = ['dms'];

// Job applicants (people outside the school) reach only People's jobs area: a form for them is made
// Public, so they find it on the sign-in page's Forms without signing in.
const unique = (list) => [...new Set(list)].filter((r) => r !== 'applicant');
// Everyone any system is for (the ATLAS home's forms may be for anyone).
const EVERYONE = unique(['admin', ...SYSTEMS.flatMap((s) => s.audience), 'guardian']);

// [{ id, product, audience, path }]: who each module's forms may be for is who the module is for.
export const FORM_MODULES = [
  { id: 'home', product: 'home', audience: EVERYONE, path: '/' },
  ...SYSTEMS.filter((s) => s.builtIn && !EXCLUDED_SYSTEMS.includes(s.id)).map((s) => ({ id: s.id, product: s.product, audience: unique(s.audience), path: s.path })),
  { id: 'tools', product: 'Tools', audience: unique(['admin', ...TOOL_ROLES]), path: '/tools/' },
];
export const FORM_MODULE_IDS = FORM_MODULES.map((m) => m.id);
export const formModule = (id) => FORM_MODULES.find((m) => m.id === id) || null;
// "ATLAS home", "ATLAS Learn"…, or "<short name> home" when the school's brand leads (shared/brand.js).
export const formModuleName = (id, branding) => {
  const m = formModule(id);
  if (!m) return id;
  return m.id === 'home' ? `${brandName(branding)} home` : productName(branding, m.product);
};

// ----- Permissions (Roles & permissions; Users & Access → Access) -----
// forms.manage: every module's forms; forms.<module>: one module's (forms.lms is Learn's, forms.hris
// People's…). Administrators have them all.
export const FORMS_ALL = 'forms.manage';
export const formPermission = (moduleId) => `forms.${moduleId}`;
const PLAIN_NAME = (m) => (m.id === 'home' ? 'the ATLAS home (school-wide forms)' : `ATLAS ${m.product}`);
export const FORMS_PERMISSION_LABELS = [
  [FORMS_ALL, 'Document circulation: upload and keep the forms of every module, and its settings'],
  ...FORM_MODULES.map((m) => [formPermission(m.id), `Document circulation: the forms of ${PLAIN_NAME(m)}`]),
];
// Who keeps each module's forms until an administrator changes it: the registrar Academic's and
// Learn's, the HR Manager People's, the Chief Accountant Finance's. The ATLAS home's and Tools'
// stay with administrators (and anyone given forms.manage).
export const FORMS_DEFAULT_MANAGERS = {
  registrar: [formPermission('uis'), formPermission('lms')],
  hr: [formPermission('hris')],
  accountant: [formPermission('fmis')],
};

// The modules an account may manage. can(permission) → boolean (userCan for that account).
export function managedModules(role, can) {
  if (role === 'admin' || can(FORMS_ALL)) return [...FORM_MODULE_IDS];
  return FORM_MODULE_IDS.filter((id) => can(formPermission(id)));
}

// ----- A form -----
export const FORM_STATUSES = [['draft', 'Draft'], ['published', 'Published'], ['retired', 'Retired']];
export const statusLabel = (s) => FORM_STATUSES.find(([k]) => k === s)?.[1] || s;
export const LIMITS = { title: 200, code: 60, category: 60, description: 1000, note: 300 };

// ----- Settings (the Settings center lists them) -----
// The file kinds a form may be (ATLAS Documents' families, server/dms/types.js): PDF, Word, Excel,
// PowerPoint, Office 97–2003, OpenDocument, pictures and ZIP. Programs, scripts, web pages, Office
// files with macros and password-protected files are refused whatever is ticked.
export const FORM_FAMILIES = ['pdf', 'word', 'excel', 'powerpoint', 'legacy', 'opendocument', 'image', 'archive'];
export const DEFAULT_FORM_SETTINGS = { maxUploadMB: 20, families: [...FORM_FAMILIES] };
export const MAX_UPLOAD_RANGE = [1, 100];
export function mergeFormSettings(s = {}) {
  const mb = Math.round(Number(s?.maxUploadMB));
  const families = Array.isArray(s?.families) ? FORM_FAMILIES.filter((f) => s.families.includes(f)) : null;
  return {
    maxUploadMB: Number.isFinite(mb) ? Math.min(MAX_UPLOAD_RANGE[1], Math.max(MAX_UPLOAD_RANGE[0], mb)) : DEFAULT_FORM_SETTINGS.maxUploadMB,
    families: families && families.length ? families : [...DEFAULT_FORM_SETTINGS.families],
  };
}

// Document circulation as an entry of the ATLAS Tools section and app, beside PDF Studio: shown only to
// people who manage forms in at least one module (server/api.js adds it to their tools). It opens the
// same screen as Admin panel → System → Document circulation.
export const FORMS_TOOL = {
  id: 'forms',
  code: 'TOOL-02',
  product: 'Document circulation',
  short: 'Forms',
  title: 'Keep every downloadable form',
  description: 'Upload and keep the forms and files each system offers its people for download, with every earlier version and who uploaded it.',
  icon: 'folder',
  path: '/tools/#/system/forms',
  accent: 'blue',
  features: ['Every module', 'Versions', 'Who and when', 'Public forms'],
  manage: true, // a management screen, not a tool switched on per account type
};
