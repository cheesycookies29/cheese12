import { api } from './api.js';
import { can as roleCan, ROLES } from '/shared/roles.js';

// App-wide state shared between views.
export const ctx = {
  settings: null,
  user: null,
  leaveTypes: [],
  async refreshLeaveTypes() {
    ctx.leaveTypes = await api.get('/api/leave-types');
  },
  async refreshSettings() {
    ctx.settings = await api.get('/api/settings');
    document.getElementById('company-name').textContent = ctx.settings.companyName;
  },
};

export const can = (permission) => Boolean(ctx.user) && roleCan(ctx.user.role, permission);
export const roleLabel = (role) => ROLES[role]?.label || role;

// Label for a leave entry, e.g. "Vacation Leave" or "Leave without pay".
export function leaveName(entry) {
  const type = ctx.leaveTypes.find((t) => t.id === entry.leaveTypeId);
  return type ? type.name : entry.paid === false ? 'Unpaid leave' : 'Paid leave';
}
