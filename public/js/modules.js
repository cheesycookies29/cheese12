// The ERP's modules, as shown on the launcher. Live modules have screens and a
// home route; the rest are placeholders for the roadmap.
export const MODULES = [
  { id: 'hr', code: 'MOD-01', name: 'HR & Payroll', icon: 'people', status: 'live',
    description: 'Employee records, time and attendance, leave and remote-work approvals, and Philippine payroll.' },
  { id: 'assets', code: 'MOD-02', name: 'IT Asset Management', icon: 'device', status: 'live',
    description: 'Laptops, devices and consumable stock: who holds what, where it is, its warranty and full history.' },
  { id: 'finance', code: 'MOD-03', name: 'Finance & Accounting', icon: 'ledger', status: 'soon',
    description: 'General ledger, payables and receivables, budgets and financial statements.' },
  { id: 'procurement', code: 'MOD-04', name: 'Procurement', icon: 'cart', status: 'soon',
    description: 'Purchase requests and approvals, suppliers, purchase orders and deliveries.' },
  { id: 'projects', code: 'MOD-05', name: 'Project Management', icon: 'gantt', status: 'soon',
    description: 'Projects, milestones, resource allocation and timesheets.' },
  { id: 'crm', code: 'MOD-06', name: 'Sales & CRM', icon: 'handshake', status: 'soon',
    description: 'Clients, opportunities, bids and contracts.' },
  { id: 'helpdesk', code: 'MOD-07', name: 'IT Service Desk', icon: 'headset', status: 'soon',
    description: 'Support tickets, service levels and a knowledge base.' },
  { id: 'documents', code: 'MOD-08', name: 'Document Management', icon: 'folder', status: 'soon',
    description: 'Contracts, compliance files, templates and approvals.' },
];

// Line icons (24×24, stroke-based) for the launcher tiles.
export const ICONS = {
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.6 14.2c2.4.2 4.2 1.8 4.9 4.8"/>',
  device: '<rect x="4" y="5" width="16" height="10.5" rx="1.2"/><path d="M2.5 18.5h19"/><path d="M9.5 9.5h5M12 7v5"/>',
  ledger: '<rect x="5" y="3.5" width="14" height="17" rx="1.2"/><path d="M8.5 8h7M8.5 11.5h7M8.5 15h4"/>',
  cart: '<path d="M3 4.5h2.5l2.2 10h10.1l2-7H7"/><circle cx="9.5" cy="18.5" r="1.4"/><circle cx="16.5" cy="18.5" r="1.4"/>',
  gantt: '<path d="M4 4v16h16"/><path d="M7 8h6M10 12h7M8 16h5"/>',
  handshake: '<path d="M3 11l4-4 3 2 3-2 4 4"/><path d="M7 7l-4 4 6 6 2-2 2 2 6-6-4-4"/>',
  headset: '<path d="M5 13v-1a7 7 0 0 1 14 0v1"/><rect x="3.5" y="13" width="3.5" height="5.5" rx="1"/><rect x="17" y="13" width="3.5" height="5.5" rx="1"/><path d="M19 18.5c0 1.5-2 2.5-5 2.5"/>',
  folder: '<path d="M3.5 6.5a1 1 0 0 1 1-1h4.5l2 2h8.5a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/>',
};
