import { api } from './api.js';
import { can as roleCan, ROLES } from '/shared/roles.js';

// App-wide state shared between views.
export const ctx = {
  settings: null,
  user: null,
  async refreshSettings() {
    ctx.settings = await api.get('/api/settings');
    document.getElementById('company-name').textContent = ctx.settings.companyName;
  },
};

export const can = (permission) => Boolean(ctx.user) && roleCan(ctx.user.role, permission);
export const roleLabel = (role) => ROLES[role]?.label || role;
