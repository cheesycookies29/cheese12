// CORE's modules, as shown on the launcher and in the module switcher. Live modules have
// screens and a home route; the rest are on the roadmap. `glyph` names an icon in icons.js.
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
