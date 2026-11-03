// HRIS state shared between screens: HR settings (pay rules, schedule), leave types,
// and what the signed-in person may do.
import { api } from '../api.js';
import { ctx } from '../shell.js';

export const hr = {
  settings: null,
  leaveTypes: [],
  async refreshLeaveTypes() {
    hr.leaveTypes = await api.get('/api/hris/leave-types');
  },
  async refreshSettings() {
    hr.settings = await api.get('/api/hris/settings');
  },
};

// HRIS permissions come with the sign-in status (shared/roles.js).
export const can = (permission) => Boolean(ctx.info?.permissions?.includes(permission));
export const isEmployee = () => Boolean(ctx.info?.employee);

// Label for a leave entry, e.g. "Vacation Leave" or "Unpaid leave".
export function leaveName(entry) {
  const type = hr.leaveTypes.find((t) => t.id === entry.leaveTypeId);
  return type ? type.name : entry.paid === false ? 'Unpaid leave' : 'Paid leave';
}

// Rows of a table that open a page when clicked (tr[data-href]).
export function clickableRows(root) {
  root.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a, button')) location.hash = tr.dataset.href;
  });
}
