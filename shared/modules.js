// CORE's modules, as shown on the launcher and in the module switcher. Live modules have
// screens and a home route; the rest are on the roadmap. `glyph` names an icon in icons.js.
// Shared by the server (which refuses the API of a module that is turned off) and the browser.
export const MODULES = [
  { id: 'hr', code: 'MOD-01', name: 'HR & Payroll', glyph: 'users', status: 'live', tagline: 'People, time, leave and pay',
    description: 'Employee records, time and attendance, leave and remote-work approvals, and Philippine payroll.' },
  { id: 'assets', code: 'MOD-02', name: 'IT Asset Management', glyph: 'laptop', status: 'live', tagline: 'Equipment, stock and allocations',
    description: 'Laptops, devices and consumable stock: who holds what, where it is, its warranty and full history.' },
  { id: 'helpdesk', code: 'MOD-07', name: 'IT Service Desk', glyph: 'headset', status: 'live', tagline: 'Tickets, email and service levels',
    description: 'Support tickets from the portal, by email and from the public form, with assignment, internal notes and service levels.' },
  { id: 'crm', code: 'MOD-06', name: 'Sales & CRM', glyph: 'chart', status: 'live', tagline: 'Leads, pipeline, bids and contracts',
    description: 'Leads, accounts and contacts, a drag-and-drop deal pipeline with forecasts, public bids with document checklists, and contract renewals.' },
  { id: 'projects', code: 'MOD-05', name: 'Project Management', glyph: 'layers', status: 'live', tagline: 'Projects, milestones, tasks and time',
    description: 'Client, government and internal projects: milestones and deliverables, a task board, a timeline, time logs, and who has how much work.' },
  { id: 'finance', code: 'MOD-03', name: 'Finance & Accounting', glyph: 'wallet', status: 'soon',
    description: 'General ledger, payables and receivables, budgets and financial statements.' },
  { id: 'procurement', code: 'MOD-04', name: 'Procurement', glyph: 'receipt', status: 'soon',
    description: 'Purchase requests and approvals, suppliers, purchase orders and deliveries.' },

  { id: 'documents', code: 'MOD-08', name: 'Document Management', glyph: 'folder', status: 'soon',
    description: 'Contracts, compliance files, templates and approvals.' },
];

// The modules an administrator can turn on or off for the company (Admin panel → Modules).
export const SWITCHABLE = MODULES.filter((m) => m.status === 'live').map((m) => m.id);
export const moduleName = (id) => MODULES.find((m) => m.id === id)?.name || id;

// What turning a module off takes away. Self-service belongs to the module it is part of: clocking
// in and out, My Attendance, My Requests (leave and remote work), My Payslips and My Profile are
// HR & Payroll (they live on its records), My Assets is IT Asset Management, My tickets is the
// Service Desk. The holiday calendar stays readable for everyone (Projects counts working days by it).
export const MODULE_PARTS = {
  hr: 'Employees, the time clock, attendance, clock-in locations, leave and approvals, payroll and payroll setup, managing the holiday calendar; and everyone\'s self-service: My Home (clocking in and out), My Attendance, My Requests, My Payslips and My Profile.',
  assets: 'Assets, inventory and stock, allocations, the activity log and problem reports; and everyone\'s My Assets (with reporting a problem).',
  helpdesk: 'The ticket queue, email in and out, the public support form (/support), saved replies and the service desk settings; and everyone\'s My tickets.',
  crm: 'Leads, accounts, contacts, the pipeline, bids, contracts, activities and the sales setup; "Send to Sales & CRM" on a ticket.',
  projects: 'Projects, My work, milestones, the workload, the Projects setup and the daily digest; "Add to a project" on a ticket and "Start project" on a deal.',
};

export const defaultModuleConfig = () => Object.fromEntries(SWITCHABLE.map((id) => [id, true]));
// config: { id: true | false } as saved by an administrator; a module missing from it is on.
export const moduleOn = (config, id) => !SWITCHABLE.includes(id) || config?.[id] !== false;

// Only what CORE itself writes: a boolean per switchable module.
export function cleanModuleConfig(input) {
  const out = defaultModuleConfig();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const id of SWITCHABLE) if (typeof input[id] === 'boolean') out[id] = input[id];
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
];
export function moduleOfApi(method, pathname) {
  if (method === 'GET' && /^\/api\/holidays\/?$/.test(pathname)) return null;
  return MODULE_API.find(([, re]) => re.test(pathname))?.[0] || null;
}
