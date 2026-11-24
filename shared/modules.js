// CORE's modules, as shown on the launcher and in the module switcher. Live modules have
// screens and a home route; the rest are on the roadmap. `glyph` names an icon in icons.js;
// `short` is the name on a tile of the modules menu; `accent: 'gold'` marks the executive module.
// Shared by the server (which refuses the API of a module that is turned off) and the browser.
export const MODULES = [
  { id: 'hr', short: 'HR Management', code: 'MOD-01', name: 'Human Resource Management', glyph: 'users', status: 'live', tagline: 'People, time, leave and pay',
    description: 'Employee records, time and attendance, leave and remote-work approvals, and Philippine payroll.' },
  { id: 'assets', short: 'IT Assets', code: 'MOD-02', name: 'IT Asset Management', glyph: 'laptop', status: 'live', tagline: 'Equipment, stock and allocations',
    description: 'Laptops, devices and consumable stock: who holds what, where it is, its warranty and full history.' },
  { id: 'helpdesk', short: 'Service Desk', code: 'MOD-07', name: 'IT Service Desk', glyph: 'headset', status: 'live', tagline: 'Tickets, email and service levels',
    description: 'Support tickets from the portal, by email and from the public form, with assignment, internal notes and service levels.' },
  { id: 'crm', short: 'Sales & CRM', code: 'MOD-06', name: 'Sales & CRM', glyph: 'chart', status: 'live', tagline: 'Leads, pipeline, bids and contracts',
    description: 'Leads, accounts and contacts, a drag-and-drop deal pipeline with forecasts, public bids with document checklists, and contract renewals.' },
  { id: 'projects', short: 'Projects', code: 'MOD-05', name: 'Project Management', glyph: 'layers', status: 'live', tagline: 'Projects, milestones, tasks and time',
    description: 'Client, government and internal projects: milestones and deliverables, a task board, a timeline, time logs, and who has how much work.' },
  { id: 'finance', short: 'Finance', code: 'MOD-03', name: 'Finance & Accounting', glyph: 'wallet', status: 'soon',
    description: 'General ledger, payables and receivables, budgets and financial statements.' },
  { id: 'procurement', short: 'Procurement', code: 'MOD-04', name: 'Procurement', glyph: 'receipt', status: 'soon',
    description: 'Purchase requests and approvals, suppliers, purchase orders and deliveries.' },

  { id: 'documents', short: 'Documents', code: 'MOD-08', name: 'Document Management', glyph: 'folder', status: 'live', tagline: 'Files, versions and secure sharing',
    description: 'Contracts, compliance files and templates in folders: versions, check-out, encryption at rest, sharing inside the company and by link outside it, and a control panel for what is accepted.' },
  { id: 'csuite', short: 'C-suite', code: 'MOD-09', name: 'C-suite', glyph: 'gauge', status: 'soon', accent: 'gold', tagline: 'Executive dashboard',
    description: 'The executive dashboard: revenue and pipeline, headcount and payroll cost, projects at risk and service levels from every module, on one page.' },
];

// Integrations: other services CORE will connect to, shown under Your modules on the CORE home
// (0.49). All are on the roadmap; none can be turned on yet. `glyph` names an icon in icons.js;
// `accent` colours its card (0.50); `features` are the chips on it.
export const INTEGRATIONS = [
  { id: 'microsoft365', code: 'INT-01', name: 'Microsoft 365', glyph: 'mail', status: 'soon', accent: 'blue', features: ['Sign-in', 'Outlook', 'Calendar', 'Teams'], tagline: 'Sign-in, Outlook and Teams',
    description: 'Sign in with Microsoft 365 accounts, send CORE\'s email through Outlook, put leave and project dates on Outlook calendars, and post notifications to Teams.' },
  { id: 'googlecloud', code: 'INT-02', name: 'Google Cloud', glyph: 'cloud', status: 'soon', accent: 'teal', features: ['Sign-in', 'Drive', 'Cloud Storage'], tagline: 'Sign-in, Drive and Cloud Storage',
    description: 'Sign in with Google accounts, keep contract and project files in Google Drive, and keep CORE\'s backups in Google Cloud Storage.' },
  { id: 'coderabbit', code: 'INT-03', name: 'CodeRabbit', glyph: 'code', status: 'soon', accent: 'orange', features: ['Pull requests', 'AI review', 'Project tasks'], tagline: 'AI code review',
    description: 'CodeRabbit\'s AI reviews of pull requests on the project tasks they belong to, so a project manager sees what is reviewed and ready to merge.' },
];

// Tools (0.64): work anyone signed in can do, whatever their module, shown under Integrations on the
// CORE home. An administrator turns each on or off for the company (Admin panel → Modules), like a
// module; off, the server refuses it for everyone but administrators.
export const TOOLS = [
  { id: 'pdf', code: 'TOOL-01', name: 'PDF Studio', short: 'PDF Studio', glyph: 'filePdf', status: 'live', accent: 'red', home: '/tools/pdf', tagline: 'Documents and pictures to PDF',
    features: ['Word, Excel, PowerPoint', 'Pictures', 'Merge and arrange', 'Page numbers', 'Watermark'],
    description: 'Turn Word, Excel, PowerPoint, OpenDocument, text, CSV and pictures into PDF, put PDFs together, arrange, turn and remove pages, then export with page numbers, a header, a footer or a watermark.' },
];
export const toolOf = (id) => TOOLS.find((t) => t.id === id) || null;

// Modules a person may pin to the front of their CORE home (live ones only), at most this many.
export const PINNABLE = MODULES.filter((m) => m.status === 'live').map((m) => m.id);
export function cleanFavoriteModules(list) {
  if (!Array.isArray(list)) return null;
  return [...new Set(list.filter((id) => typeof id === 'string' && PINNABLE.includes(id)))];
}

// The modules an administrator can turn on or off for the company (Admin panel → Modules).
export const SWITCHABLE = [...MODULES.filter((m) => m.status === 'live').map((m) => m.id), ...TOOLS.map((t) => t.id)];
export const moduleName = (id) => MODULES.find((m) => m.id === id)?.name || toolOf(id)?.name || id;

// What turning a module off takes away. Self-service belongs to the module it is part of: clocking
// in and out, My Attendance, My Requests (leave and remote work), My Payslips and My HR record are
// Human Resource Management (they live on its records), My Assets is IT Asset Management, My tickets is the
// Service Desk. The holiday calendar stays readable for everyone (Projects counts working days by it).
export const MODULE_PARTS = {
  hr: 'Employees, the time clock, attendance, clock-in locations, leave and approvals, payroll and payroll setup, managing the holiday calendar; and everyone\'s self-service: My Home (clocking in and out), My Attendance, My Requests, My Payslips and My HR record.',
  assets: 'Assets, inventory and stock, allocations, the activity log and problem reports; and everyone\'s My Assets (with reporting a problem).',
  helpdesk: 'The ticket queue, email in and out, the public support form (/support), saved replies and the service desk settings; and everyone\'s My tickets.',
  crm: 'Leads, accounts, contacts, the pipeline, bids, contracts, activities and the sales setup; "Send to Sales & CRM" on a ticket.',
  projects: 'Projects, My work, milestones, the Projects setup and the daily digest; "Add to a project" on a ticket and "Start project" on a deal.',
  documents: 'Folders and documents, their versions, check-out and sharing, links for people outside the company (/share) and Document control. The stored files stay, encrypted, and come back when it is turned on again.',
  pdf: 'PDF Studio on the CORE home and in the modules menu: converting documents and pictures to PDF, merging and arranging pages. Nothing is kept: uploads are deleted after a few hours.',
};

// What is coming soon, which an administrator can show or hide (Admin panel → Modules, 0.63): the
// modules on the roadmap, the integrations and the coming-soon pages inside a live module. Hidden:
// gone from the CORE home, the modules menu and the side menu, for everyone (administrators too);
// shown again with the same switch. `where`: where it shows.
export const ROADMAP = [
  ...MODULES.filter((m) => m.status !== 'live').map((m) => ({ id: m.id, kind: 'module', name: m.name, code: m.code, glyph: m.glyph, accent: m.accent || null, where: 'The CORE home and the modules menu' })),
  ...INTEGRATIONS.map((i) => ({ id: i.id, kind: 'integration', name: i.name, code: i.code, glyph: i.glyph, accent: i.accent || null, where: 'Integrations on the CORE home' })),
  { id: 'replication', kind: 'feature', name: 'Data replication', code: 'IT Asset Management', glyph: 'database', accent: null, where: 'The IT Asset Management side menu' },
];
export const ROADMAP_KINDS = { module: 'Modules', integration: 'Integrations', feature: 'Pages in a module' };
export const HIDEABLE = ROADMAP.map((x) => x.id);
export const roadmapName = (id) => ROADMAP.find((x) => x.id === id)?.name || id;
// config: as saved by an administrator; something coming soon missing from it is shown.
export const shownOnRoadmap = (config, id) => config?.[id] !== false;

export const defaultModuleConfig = () => Object.fromEntries([...SWITCHABLE, ...HIDEABLE].map((id) => [id, true]));
// config: { id: true | false } as saved by an administrator; a module missing from it is on.
export const moduleOn = (config, id) => !SWITCHABLE.includes(id) || config?.[id] !== false;

// Whether a module is open for this person: on for the company, or they are an administrator. Used
// where one module shows another's data (VAPT 0.33), so a module turned off stays off everywhere.
export const moduleOpenFor = (config, id, user) => moduleOn(config, id) || user?.role === 'admin';

// Only what CORE itself writes: a boolean per switchable module (on or off), and per thing coming
// soon (shown or hidden).
export function cleanModuleConfig(input) {
  const out = defaultModuleConfig();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const id of [...SWITCHABLE, ...HIDEABLE]) if (typeof input[id] === 'boolean') out[id] = input[id];
  return out;
}

// The API of each module: refused (403) for everyone but administrators while the module is off.
// GET /api/holidays stays open: the holiday calendar is the company's, and Projects uses it.
const MODULE_API = [
  ['hr', /^\/api\/(employees|time-entries|clock|clock-locations|location-settings|payroll-runs|payroll-config|payroll-ledger|holidays|leave-types|leave-balances|leave-credits|requests|approvals|approval-flow|me\/(profile|time-entries|clock|payslips|ytd|requests|leave-balances|approvers))(\/|$)/],
  ['assets', /^\/api\/(assets|asset-meta|asset-history|asset-reports|inventory|stock-movements|me\/assets|me\/asset-reports)(\/|$)/],
  ['helpdesk', /^\/api\/(helpdesk|public\/helpdesk)(\/|$)/],
  ['crm', /^\/api\/crm(\/|$)/],
  ['projects', /^\/api\/pm(\/|$)/],
  ['pdf', /^\/api\/tools\/pdf(\/|$)/],
  ['documents', /^\/api\/(docs|public\/share)(\/|$)/],
];
export function moduleOfApi(method, pathname) {
  if (method === 'GET' && /^\/api\/holidays\/?$/.test(pathname)) return null;
  return MODULE_API.find(([, re]) => re.test(pathname))?.[0] || null;
}
