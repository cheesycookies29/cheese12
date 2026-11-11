// Demo data added next to real data. Every demo record is tagged demo: true and numbered so it
// can't clash with real records (DEMO-0001 employees, DEMO-IT-0001 assets, report and ticket
// numbers after the existing ones). Loading again replaces the previous demo set; removing it
// takes out the demo records, everything attached to demo employees and assets, and the demo
// sign-in accounts, and leaves real records as they were.
import { randomUUID } from 'node:crypto';
import { demoData } from './seed.js';
import { DEFAULT_LEAVE_TYPES } from '../shared/leave.js';
import { DEMO_OWNER, DEMO_USER } from './seed.js';
import { CRM_COLLECTIONS } from './crm.js';
import { PM_COLLECTIONS } from './projects.js';
import { routeRequest, migrateApprovals } from './approvals.js';

// Collections the demo set adds to.
const COLLECTIONS = ['employees', 'timeEntries', 'requests', 'leaveCredits', 'leaveAccess', 'leaveAdjustments', 'assets', 'assetHistory', 'inventoryItems', 'stockMovements', 'issueReports', 'tickets', ...CRM_COLLECTIONS, ...PM_COLLECTIONS];
// Records that belong to an employee and go with a demo employee.
const BY_EMPLOYEE = ['timeEntries', 'requests', 'leaveCredits', 'leaveAccess', 'leaveAdjustments'];

const highest = (codes, re) => codes.reduce((m, c) => Math.max(m, Number(String(c || '').match(re)?.[1]) || 0), 0);

export const hasDemo = (db) => COLLECTIONS.some((k) => (db.data[k] || []).some((x) => x.demo)) || db.data.users.some((u) => u.demo);

export function demoCounts(db) {
  return Object.fromEntries(['employees', 'assets', 'inventoryItems', 'tickets', 'crmAccounts', 'crmDeals', 'pmProjects'].map((k) => [k, (db.data[k] || []).filter((x) => x.demo).length]));
}

// summarize(run) recomputes a payroll run's totals after demo payslips are taken out of it.
export function removeDemo(db, { summarize }) {
  const d = db.data;
  const empIds = new Set(d.employees.filter((e) => e.demo).map((e) => e.id));
  const assetIds = new Set(d.assets.filter((a) => a.demo).map((a) => a.id));
  const itemIds = new Set(d.inventoryItems.filter((i) => i.demo).map((i) => i.id));
  const demoUsers = new Set(d.users.filter((u) => u.demo).map((u) => u.id));
  const removed = { ...demoCounts(db), accounts: demoUsers.size };

  // A demo organization that someone's own records use (a contact added to it, a lead converted
  // into it) stays, as a real account, so those records stay with it.
  const usedByReal = new Set(['crmContacts', 'crmDeals', 'crmBids', 'crmContracts', 'crmLeads'].flatMap((k) => (d[k] || []).filter((x) => !x.demo && x.accountId).map((x) => x.accountId)));
  for (const a of d.crmAccounts || []) if (a.demo && usedByReal.has(a.id)) delete a.demo;
  const crmAccountIds = new Set((d.crmAccounts || []).filter((a) => a.demo).map((a) => a.id));
  for (const k of COLLECTIONS) d[k] = (d[k] || []).filter((x) => !x.demo);
  for (const k of ['crmContacts', 'crmDeals', 'crmBids', 'crmContracts']) d[k] = d[k].filter((x) => !crmAccountIds.has(x.accountId));
  const crmIds = new Set(['crmAccounts', 'crmContacts', 'crmLeads', 'crmDeals', 'crmBids', 'crmContracts'].flatMap((k) => d[k].map((x) => x.id)));
  d.crmActivities = d.crmActivities.filter((a) => crmIds.has(a.related?.id));
  // Records owned by demo accounts now belong to nobody.
  for (const k of CRM_COLLECTIONS) for (const x of d[k]) if (demoUsers.has(x.ownerId)) x.ownerId = null;
  // Real records that pointed at a removed demo record (a lead converted into a demo account, a
  // deal with a demo contact, a bid on a demo deal) keep the record but lose that link.
  const alive = (k) => new Set(d[k].map((x) => x.id));
  const live = { accountId: alive('crmAccounts'), contactId: alive('crmContacts'), dealId: alive('crmDeals'), bidId: alive('crmBids'), renewalOf: alive('crmContracts') };
  for (const k of ['crmContacts', 'crmLeads', 'crmDeals', 'crmBids', 'crmContracts', 'crmActivities']) {
    for (const x of d[k]) {
      for (const [field, ids] of Object.entries(live)) if (x[field] && !ids.has(x[field])) x[field] = null;
      if (demoUsers.has(x.createdBy)) x.createdBy = null;
      if (demoUsers.has(x.updatedBy)) x.updatedBy = null;
    }
  }
  removeDemoProjects(d, demoUsers);
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

// After the demo records are gone: what was inside a demo project goes too; real projects drop
// demo people, and links to demo CRM records and tickets.
function removeDemoProjects(d, demoUsers) {
  const projects = new Set(d.pmProjects.map((p) => p.id));
  for (const k of PM_COLLECTIONS.slice(1)) d[k] = d[k].filter((x) => projects.has(x.projectId));
  const tasks = new Set(d.pmTasks.map((t) => t.id));
  d.pmComments = d.pmComments.filter((c) => tasks.has(c.taskId) && !demoUsers.has(c.userId));
  d.pmTimeLogs = d.pmTimeLogs.filter((x) => !demoUsers.has(x.userId));
  for (const x of d.pmTimeLogs) if (x.taskId && !tasks.has(x.taskId)) x.taskId = null;
  const alive = (k) => new Set(d[k].map((x) => x.id));
  const live = { accountId: alive('crmAccounts'), dealId: alive('crmDeals'), contractId: alive('crmContracts') };
  for (const p of d.pmProjects) {
    for (const [field, ids] of Object.entries(live)) if (p[field] && !ids.has(p[field])) p[field] = null;
    p.members = p.members.filter((m) => !demoUsers.has(m.userId));
    if (demoUsers.has(p.managerId)) p.managerId = null;
  }
  const tickets = alive('tickets');
  for (const t of d.pmTasks) {
    if (demoUsers.has(t.assigneeId)) t.assigneeId = null;
    if (t.ticketId && !tickets.has(t.ticketId)) t.ticketId = null;
  }
}

// Demo projects name people by username (seed.js DEMO_USER); these become the accounts' ids, or
// nobody when the account is not there.
function linkDemoPeople(d) {
  const id = (v) => (typeof v === 'string' && v.startsWith(DEMO_USER('')) ? d.users.find((u) => u.username === v.slice(DEMO_USER('').length))?.id || null : v);
  for (const p of d.pmProjects.filter((x) => x.demo)) {
    p.members = p.members.map((m) => ({ ...m, userId: id(m.userId) })).filter((m) => m.userId);
    for (const f of ['managerId', 'createdBy', 'updatedBy']) p[f] = id(p[f]);
    for (const h of p.history || []) h.by = id(h.by);
    if (p.healthOverride) p.healthOverride.by = id(p.healthOverride.by);
  }
  for (const t of d.pmTasks.filter((x) => x.demo)) {
    for (const f of ['assigneeId', 'createdBy', 'updatedBy']) t[f] = id(t[f]);
    for (const h of t.history || []) h.by = id(h.by);
  }
  for (const k of ['pmComments', 'pmTimeLogs']) d[k] = d[k].filter((x) => !x.demo || (x.userId = id(x.userId)));
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
  linkDemoPeople(d);
  return demoCounts(db);
}
