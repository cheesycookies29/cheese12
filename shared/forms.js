// Document circulation (0.70; after Lancaster ATLAS's): one place to upload and keep every downloadable
// form and file the company gives its people (a leave application, a purchase request, an equipment
// request, a client onboarding sheet), each with its form code, every earlier version and who uploaded
// it. Each module then shows the current published version of its forms on its own "Forms & downloads"
// page; the company-wide ones are on the CORE home (server/forms.js, public/js/views/forms.js).
//
// Shared by the server (enforcement) and the pages. This is the ERP's version: it is for the people
// with a CORE account (no forms for signed-out visitors), and who sees a form is by account type and by
// whether they open its module.
import { MODULES } from './modules.js';
import { ROLES } from './roles.js';

// The modules covered: the CORE home (company-wide forms) and every live module except Document
// Management, which keeps its own files.
export const EXCLUDED_MODULES = ['documents'];
export const FORM_MODULES = [
  { id: 'home', name: 'CORE home', short: 'Company-wide', glyph: 'home', path: '/launcher' },
  ...MODULES.filter((m) => m.status === 'live' && !EXCLUDED_MODULES.includes(m.id)).map((m) => ({ id: m.id, name: m.name, short: m.short || m.name, glyph: m.glyph })),
];
export const FORM_MODULE_IDS = FORM_MODULES.map((m) => m.id);
export const formModule = (id) => FORM_MODULES.find((m) => m.id === id) || null;
export const formModuleName = (id) => formModule(id)?.name || id;

// Who a form can be for: any account type. It reaches only those of them who also open its module
// (server/forms.js), so a Sales & CRM form never reaches someone without CRM access.
export const FORM_AUDIENCE = Object.keys(ROLES);

// ----- Permissions (Admin panel → Roles & permissions) -----
// forms.manage: every module's forms and the settings; forms.<module>: one module's. Administrators
// have them all. The labels and the defaults are in shared/roles.js.
export const FORMS_ALL = 'forms.manage';
export const formPermission = (moduleId) => `forms.${moduleId}`;

// The modules an account keeps the forms of. can(permission) → boolean (userCan for that account).
export function managedModules(role, can) {
  if (role === 'admin' || can(FORMS_ALL)) return [...FORM_MODULE_IDS];
  return FORM_MODULE_IDS.filter((id) => can(formPermission(id)));
}

// ----- A form -----
export const FORM_STATUSES = [['draft', 'Draft'], ['published', 'Published'], ['retired', 'Retired']];
export const statusLabel = (s) => FORM_STATUSES.find(([k]) => k === s)?.[1] || s;
export const LIMITS = { title: 200, code: 60, category: 60, description: 1000, note: 300 };

// ----- Settings -----
// The kinds of file a form may be (Document Management's families, server/dms/types.js). Programs,
// scripts, web pages, Office files with macros and password-protected files are refused whatever is
// ticked.
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
