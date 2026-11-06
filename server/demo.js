// Demo data added next to real data. Every demo record is tagged demo: true and numbered so it
// can't clash with real records (DEMO-0001 employees, DEMO-IT-0001 assets, report and ticket
// numbers after the existing ones). Loading again replaces the previous demo set; removing it
// takes out the demo records, everything attached to demo employees and assets, and the demo
// sign-in accounts, and leaves real records as they were.
import { randomUUID } from 'node:crypto';
import { demoData } from './seed.js';
import { DEFAULT_LEAVE_TYPES } from '../shared/leave.js';
import { DEMO_OWNER } from './seed.js';
import { CRM_COLLECTIONS } from './crm.js';
import { routeRequest, migrateApprovals } from './approvals.js';

// Collections the demo set adds to.
const COLLECTIONS = ['employees', 'timeEntries', 'requests', 'leaveCredits', 'leaveAccess', 'leaveAdjustments', 'assets', 'assetHistory', 'inventoryItems', 'stockMovements', 'issueReports', 'tickets', ...CRM_COLLECTIONS];
// Records that belong to an employee and go with a demo employee.
const BY_EMPLOYEE = ['timeEntries', 'requests', 'leaveCredits', 'leaveAccess', 'leaveAdjustments'];

const highest = (codes, re) => codes.reduce((m, c) => Math.max(m, Number(String(c || '').match(re)?.[1]) || 0), 0);

export const hasDemo = (db) => COLLECTIONS.some((k) => (db.data[k] || []).some((x) => x.demo)) || db.data.users.some((u) => u.demo);

export function demoCounts(db) {
  return Object.fromEntries(['employees', 'assets', 'inventoryItems', 'tickets', 'crmAccounts', 'crmDeals'].map((k) => [k, (db.data[k] || []).filter((x) => x.demo).length]));
}

// summarize(run) recomputes a payroll run's totals after demo payslips are taken out of it.
export function removeDemo(db, { summarize }) {
  const d = db.data;
  const empIds = new Set(d.employees.filter((e) => e.demo).map((e) => e.id));
  const assetIds = new Set(d.assets.filter((a) => a.demo).map((a) => a.id));
  const itemIds = new Set(d.inventoryItems.filter((i) => i.demo).map((i) => i.id));
  const demoUsers = new Set(d.users.filter((u) => u.demo).map((u) => u.id));
  const removed = { ...demoCounts(db), accounts: demoUsers.size };

  const crmAccountIds = new Set((d.crmAccounts || []).filter((a) => a.demo).map((a) => a.id));
  for (const k of COLLECTIONS) d[k] = (d[k] || []).filter((x) => !x.demo);
  // CRM records someone added to a demo organization go with it, and so does their history.
  for (const k of ['crmContacts', 'crmDeals', 'crmBids', 'crmContracts']) d[k] = d[k].filter((x) => !crmAccountIds.has(x.accountId));
  const crmIds = new Set(['crmAccounts', 'crmContacts', 'crmLeads', 'crmDeals', 'crmBids', 'crmContracts'].flatMap((k) => d[k].map((x) => x.id)));
  d.crmActivities = d.crmActivities.filter((a) => crmIds.has(a.related?.id));
  // Records owned by demo accounts now belong to nobody.
  for (const k of CRM_COLLECTIONS) for (const x of d[k]) if (demoUsers.has(x.ownerId)) x.ownerId = null;
  for (const k of BY_EMPLOYEE) d[k] = d[k].filter((x) => !empIds.has(x.employeeId));
  // Real employees who reported to a demo employee no longer have a supervisor on record.
  for (const e of d.employees) if (empIds.has(e.supervisorId)) e.supervisorId = null;
  d.assetHistory = d.assetHistory.filter((h) => !assetIds.has(h.assetId));
  d.stockMovements = d.stockMovements.filter((m) => !itemIds.has(m.itemId));
  d.issueReports = d.issueReports.filter((r) => !assetIds.has(r.assetId) && !empIds.has(r.reportedBy?.employeeId));
  // Real equipment that was lent to a demo employee goes back to stock, with a history line.
  for (const a of d.assets) {
    if (a.assignedTo?.type === 'employee' && empIds.has(a.assignedTo.id)) {
      d.assetHistory.push({ id: randomUUID(), assetId: a.id, assetTag: a.assetTag, assetName: a.name, action: 'returned', detail: `Returned to stock: ${a.assignedTo.name} (demo data) was removed`, at: new Date().toISOString(), by: 'System' });
      Object.assign(a, { status: 'in_stock', assignedTo: null, assignedAt: null, expectedReturn: null });
    }
  }
  // Tickets opened by demo accounts go too; tickets assigned to a demo agent become unassigned.
  d.tickets = d.tickets.filter((t) => !demoUsers.has(t.requester?.userId));
  for (const t of d.tickets) if (demoUsers.has(t.assigneeId)) t.assigneeId = null;
  d.feedback = d.feedback.filter((f) => !demoUsers.has(f.userId));
  // Draft payroll runs drop demo employees; finalized runs are a record and stay as they were.
  for (const run of d.payrollRuns) {
    if (run.status !== 'draft') continue;
    run.employeeIds = run.employeeIds.filter((id) => !empIds.has(id));
    run.payslips = run.payslips.filter((p) => !empIds.has(p.employeeId));
    summarize(run);
  }
  d.users = d.users.filter((u) => !u.demo);
  return removed;
}

// Adds a fresh demo set (replacing an earlier one) without touching real records.
export function addDemo(db, { summarize, demoAccounts }) {
  if (hasDemo(db)) removeDemo(db, { summarize });
  const d = db.data;
  const demo = demoData({
    employeePrefix: 'DEMO-', assetPrefix: 'DEMO-IT-', skuPrefix: 'DEMO-SKU-', serialPrefix: 'DEMO', crmPrefix: 'DEMO-',
    firstReport: highest(d.issueReports.map((r) => r.number), /^IR-(\d+)$/) + 1,
    firstTicket: (d.helpdesk.seq || 0) + 1,
  });
  // The demo uses the standard leave types; bring back any that were deleted.
  for (const t of DEFAULT_LEAVE_TYPES) if (!d.leaveTypes.some((x) => x.id === t.id)) d.leaveTypes.push({ ...structuredClone(t), active: true });
  for (const k of COLLECTIONS) for (const rec of demo[k] || []) d[k].push({ ...rec, demo: true });
  d.helpdesk.seq = Math.max(d.helpdesk.seq || 0, demo.helpdesk.seq);
  d.users.push(...demoAccounts(db, demo.employees));
  // Demo requests take the approval route of the demo reporting lines.
  for (const r of d.requests) {
    if (!r.demo || r.approvals) continue;
    if (r.status === 'pending') routeRequest(db, r, d.employees.find((e) => e.id === r.employeeId), null);
  }
  migrateApprovals(db);
  // CRM demo records belong to the demo sales account (or the first administrator).
  const salesOwner = d.users.find((u) => u.username === 'sales.demo') || d.users.find((u) => u.role === 'admin');
  for (const k of CRM_COLLECTIONS) for (const x of d[k]) {
    if (x.ownerId === DEMO_OWNER) x.ownerId = salesOwner?.id || null;
    if (x.createdBy === DEMO_OWNER) x.createdBy = salesOwner?.id || null;
  }
  return demoCounts(db);
}
