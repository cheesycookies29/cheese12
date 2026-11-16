// Everyone's profile (0.32): the role a person has in the company (a job title such as "Software
// Engineer", set by administrators; "Employee" until then), and which CORE modules they can open.
// Shared by the server (the profile page's data) and the browser (the module switcher, the launcher).
import { userCan, usesAdminPanel } from './roles.js';
import { MODULES, moduleOn } from './modules.js';

export const DEFAULT_COMPANY_ROLE = 'Employee';
export const COMPANY_ROLE_MAX = 60;

// The role as stored: one line of plain text, at most COMPANY_ROLE_MAX characters; empty (or the
// default itself) means "Employee", and is stored as nothing.
export function cleanCompanyRole(value) {
  if (value == null) return null;
  if (typeof value !== 'string') throw Object.assign(new Error('Write the role in the company as text.'), { status: 400 });
  const v = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (v.length > COMPANY_ROLE_MAX) throw Object.assign(new Error(`The role in the company can be up to ${COMPANY_ROLE_MAX} characters.`), { status: 400 });
  return v && v.toLowerCase() !== DEFAULT_COMPANY_ROLE.toLowerCase() ? v : null;
}
export const companyRoleOf = (user) => user?.companyRole || DEFAULT_COMPANY_ROLE;

// Which live modules this account opens, where each one opens for it, and what it does there.
// modules: the company's on/off switches; inProjects: a member of any project; isApprover: on an
// approval route (a supervisor, a named approver or HR). A module the company turned off opens for
// administrators only.
export function moduleAccess(user, { modules = {}, inProjects = false, isApprover = false } = {}) {
  const can = (p) => userCan(user, p);
  const admin = user?.role === 'admin';
  const self = can('self') && (Boolean(user?.employeeId) || user?.role === 'employee');
  const out = [];
  for (const m of MODULES.filter((x) => x.status === 'live')) {
    let home = null;
    let parts = [];
    if (m.id === 'hr') {
      home = can('dashboard') ? '/dashboard' : can('employees.view') ? '/employees' : self ? '/me' : isApprover ? '/approvals' : null;
      if (can('employees.view')) parts.push(can('employees.edit') ? 'employee records' : 'employee records (view)');
      if (can('attendance.view')) parts.push(can('attendance.edit') ? 'attendance' : 'attendance (view)');
      if (can('payroll.view')) parts.push(can('payroll.edit') ? 'payroll' : 'payroll (view)');
      if (can('leave.approve')) parts.push('approves leave');
      else if (isApprover) parts.push('approves requests');
      if (self) parts.push('self-service');
    } else if (m.id === 'assets') {
      home = can('assets.view') ? '/assets' : self ? '/assets/mine' : null;
      parts = [can('assets.edit') ? 'manages assets and stock' : can('assets.view') ? 'views assets' : 'own equipment'];
    } else if (m.id === 'helpdesk') {
      home = can('helpdesk.agent') ? '/helpdesk' : '/helpdesk/mine';
      parts = [can('helpdesk.manage') ? 'agent, with the desk settings' : can('helpdesk.agent') ? 'agent' : 'own tickets'];
    } else if (m.id === 'crm') {
      home = can('crm.view') ? '/crm' : null;
      parts = [can('crm.manage') ? 'all records and the sales setup' : can('crm.edit') ? 'leads, deals, bids and contracts' : 'view'];
    } else if (m.id === 'projects') {
      home = can('pm.view') || inProjects ? '/projects' : null;
      parts = [can('pm.manage') ? 'starts and manages projects, and the setup' : can('pm.edit') ? 'starts projects' : 'member projects only'];
    }
    const off = !moduleOn(modules, m.id);
    if (off && !admin) home = null;
    const text = parts.join(', ');
    out.push({ id: m.id, code: m.code, name: m.name, glyph: m.glyph, home, off, detail: home ? text.charAt(0).toUpperCase() + text.slice(1) : off ? 'Off for the company' : 'No access' });
  }
  return out;
}

// The Admin panel is not a module, but the profile lists it with them.
export const adminPanelAccess = (user) => usesAdminPanel(user);
