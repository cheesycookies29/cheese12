// Approval routing for leave, work-from-home and official-business requests, after Sprout HR:
// level 1 is normally the employee's immediate supervisor, then further levels (the supervisor's
// supervisor, HR, or named people). The route is fixed when the request is filed, so later
// changes to supervisors or the flow apply to new requests only. Sequential flows go level by
// level; parallel flows go to every level at once and the first approval decides.
//
// Improvements on that model: a level with nobody to approve it (no supervisor on record, or a
// supervisor without an account) is skipped instead of leaving the request stuck; nobody approves
// their own request; and HR (leave.approve) can always decide, recorded as an HR override.
import { HttpError } from './util.js';
import { userCan } from '../shared/roles.js';
import { DEFAULT_APPROVALS, APPROVER_TYPES } from '../shared/leave.js';

const now = () => new Date().toISOString();
const fullName = (e) => (e ? `${e.firstName} ${e.lastName}` : '');

export function approvalSettings(db) {
  const s = db.data.settings.approvals;
  return { ...DEFAULT_APPROVALS, ...(s || {}), levels: s?.levels?.length ? s.levels : DEFAULT_APPROVALS.levels };
}

// The approver levels for one employee's request, as they are right now.
export function approvalChain(db, employee, requesterUserId) {
  const cfg = approvalSettings(db);
  const users = db.data.users.filter((u) => u.active);
  const emp = (id) => db.data.employees.find((e) => e.id === id && e.status !== 'Inactive');
  const accountOf = (e) => e && users.find((u) => u.employeeId === e.id);
  const levels = cfg.levels.map((lv, i) => {
    let ids = [];
    let label = APPROVER_TYPES[lv.type] || 'Approver';
    let skip = '';
    if (lv.type === 'supervisor' || lv.type === 'manager') {
      const sup = emp(employee.supervisorId);
      const who = lv.type === 'supervisor' ? sup : sup && emp(sup.supervisorId);
      const acct = accountOf(who);
      if (who) label = `${fullName(who)} (${lv.type === 'supervisor' ? 'immediate supervisor' : "supervisor's supervisor"})`;
      if (acct) ids = [acct.id];
      else skip = !who ? (lv.type === 'supervisor' ? 'No immediate supervisor on record' : 'The supervisor has no supervisor on record') : `${fullName(who)} has no CORE account`;
    } else if (lv.type === 'hr') {
      ids = users.filter((u) => userCan(u, 'leave.approve')).map((u) => u.id);
      label = 'HR';
      if (!ids.length) skip = 'Nobody has leave approval rights';
    } else {
      const picked = users.filter((u) => (lv.userIds || []).includes(u.id));
      ids = picked.map((u) => u.id);
      label = picked.map((u) => u.name).join(', ') || 'Specific people';
      if (!ids.length) skip = 'None of the chosen people has an active account';
    }
    // Nobody approves their own request.
    if (ids.includes(requesterUserId)) {
      ids = ids.filter((id) => id !== requesterUserId);
      if (!ids.length) skip = 'The only approver at this level is the requester';
    }
    return { level: i + 1, type: lv.type, label, approverIds: ids, status: ids.length ? 'waiting' : 'skipped', note: ids.length ? '' : skip };
  });
  // Every level skipped: HR decides, so the request is never stuck.
  if (!levels.some((l) => l.status === 'waiting')) {
    const hr = users.filter((u) => userCan(u, 'leave.approve') && u.id !== requesterUserId).map((u) => u.id);
    const admins = users.filter((u) => u.role === 'admin').map((u) => u.id);
    levels.push({ level: levels.length + 1, type: 'hr', label: 'HR (no other approver available)', approverIds: hr.length ? hr : admins, status: 'waiting', note: '' });
  }
  return { flow: cfg.flow, levels };
}

// Puts a request on its route: the first level (sequential) or every level (parallel) is up next.
export function routeRequest(db, req, employee, requesterUserId) {
  const { flow, levels } = approvalChain(db, employee, requesterUserId);
  req.flow = flow;
  req.approvals = levels;
  activate(req);
}
function activate(req) {
  const waiting = req.approvals.filter((l) => l.status === 'waiting');
  if (req.flow === 'parallel') waiting.forEach((l) => (l.status = 'pending'));
  else if (waiting[0]) waiting[0].status = 'pending';
}

// Requests filed before approval levels existed go to HR, as they did then.
export function migrateApprovals(db) {
  let changed = false;
  for (const r of db.data.requests) {
    if (r.approvals) continue;
    const hr = db.data.users.filter((u) => u.active && userCan(u, 'leave.approve')).map((u) => u.id);
    r.flow = 'sequential';
    r.approvals = [{ level: 1, type: 'hr', label: 'HR', approverIds: hr, status: r.status === 'pending' ? 'pending' : r.status === 'approved' ? 'approved' : r.status === 'rejected' ? 'rejected' : 'skipped', note: '', decidedByName: r.decidedByName, decidedAt: r.decidedAt }];
    r.history ||= [{ at: r.filedAt, by: null, text: 'Filed' }];
    changed = true;
  }
  return changed;
}

export const currentLevels = (req) => (['pending'].includes(req.status) ? (req.approvals || []).filter((l) => l.status === 'pending') : []);
export const isCurrentApprover = (req, user) => currentLevels(req).some((l) => l.approverIds.includes(user.id));
export const isOnRoute = (req, user) => (req.approvals || []).some((l) => l.approverIds.includes(user.id) || l.decidedBy === user.id);
const ownRequest = (req, user) => Boolean(user.employeeId) && user.employeeId === req.employeeId;
export function canDecide(req, user) {
  if (req.status !== 'pending' || ownRequest(req, user)) return false;
  return isCurrentApprover(req, user) || userCan(user, 'leave.approve');
}

export function addHistory(req, user, text) {
  (req.history ||= []).push({ at: now(), by: user?.name || 'System', text });
}

// One approver's decision. Returns 'approved' when this was the final approval (the caller then
// writes the days into the DTR), otherwise the request's new status.
export function decideStep(req, user, action, note = '') {
  if (req.status !== 'pending') throw new HttpError(400, `This request is ${req.status === 'returned' ? 'back with the employee for revision' : `already ${req.status}`}.`);
  if (ownRequest(req, user)) throw new HttpError(403, 'You cannot decide on your own request. Another approver must do it.');
  note = String(note || '').trim().slice(0, 500);
  if ((action === 'reject' || action === 'return') && !note) throw new HttpError(400, action === 'reject' ? 'Give the reason for rejecting it; the employee sees it.' : 'Say what the employee should change.');
  const mine = currentLevels(req).filter((l) => l.approverIds.includes(user.id));
  const override = !mine.length;
  if (override && !userCan(user, 'leave.approve')) throw new HttpError(403, 'This request is not waiting for your approval.');
  const stamp = { decidedBy: user.id, decidedByName: user.name, decidedAt: now(), note };
  const levelText = (l) => `level ${l.level} (${l.label})`;

  if (action === 'approve') {
    if (override) {
      // HR decides for everyone still to come.
      for (const l of req.approvals) if (l.status === 'pending' || l.status === 'waiting') Object.assign(l, { status: 'skipped', note: `Approved by ${user.name} (HR)` });
      addHistory(req, user, `Approved (HR override)${note ? `: ${note}` : ''}`);
      return 'approved';
    }
    const decided = req.flow === 'parallel' ? mine : [mine[0]];
    for (const l of decided) Object.assign(l, { status: 'approved', ...stamp });
    addHistory(req, user, `Approved at ${decided.map(levelText).join(', ')}${note ? `: ${note}` : ''}`);
    if (req.flow === 'parallel') {
      for (const l of req.approvals) if (l.status === 'pending' || l.status === 'waiting') Object.assign(l, { status: 'skipped', note: `Approved at level ${decided[0].level}` });
      return 'approved';
    }
    // Sequential: next level, approving straight away any level this person also holds.
    for (;;) {
      const next = req.approvals.find((l) => l.status === 'waiting');
      if (!next) return 'approved';
      if (next.approverIds.includes(user.id)) {
        Object.assign(next, { status: 'approved', ...stamp, note: 'Same approver as the previous level' });
        continue;
      }
      next.status = 'pending';
      return 'pending';
    }
  }
  const target = mine[0] || currentLevels(req)[0];
  if (action === 'reject') {
    if (target) Object.assign(target, { status: 'rejected', ...stamp });
    for (const l of req.approvals) if (l.status === 'waiting' || l.status === 'pending') l.status = 'skipped';
    addHistory(req, user, `Rejected${override ? ' (HR)' : ` at ${levelText(target)}`}: ${note}`);
    Object.assign(req, { status: 'rejected', decidedAt: stamp.decidedAt, decidedBy: user.id, decidedByName: user.name, decisionNote: note });
    return 'rejected';
  }
  if (action === 'return') {
    if (target) Object.assign(target, { status: 'returned', ...stamp });
    addHistory(req, user, `Returned for revision: ${note}`);
    Object.assign(req, { status: 'returned', returnedAt: stamp.decidedAt, returnedByName: user.name, returnNote: note });
    return 'returned';
  }
  throw new HttpError(400, 'Approve, reject or return.');
}

// Employees whose immediate supervisor is this account's employee record.
export const directReports = (db, user) => (user.employeeId ? db.data.employees.filter((e) => e.supervisorId === user.employeeId) : []);
// Whether this account approves anything: a supervisor with reports, a named approver, HR, or on a pending route.
export function isApprover(db, user) {
  if (!user) return false;
  if (userCan(user, 'leave.approve') || directReports(db, user).length) return true;
  if (approvalSettings(db).levels.some((l) => l.type === 'users' && (l.userIds || []).includes(user.id))) return true;
  return db.data.requests.some((r) => isCurrentApprover(r, user));
}
