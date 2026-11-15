import { api } from './api.js';
import { userCan, ROLES, setRoleOverrides, usesAdminPanel } from '/shared/roles.js';
import { moduleOn as isOn } from '/shared/modules.js';
import { HEX_RE, THEMES } from '/shared/brand.js';

// App-wide state shared between views.
export const ctx = {
  settings: null,
  user: null,
  modules: {}, // which modules the company has on (Admin panel → Modules)
  brand: null, // colours, headline and logo (Admin panel → Settings & branding), before sign-in too
  leaveTypes: [],
  holidays: [], // the holiday calendar: DTR badges, request day counts, payroll previews
  async refreshHolidays() {
    ctx.holidays = await api.get('/api/holidays').catch(() => []);
  },
  async refreshLeaveTypes() {
    // HR & Payroll may be turned off: then there are no leave types to show.
    ctx.leaveTypes = await api.get('/api/leave-types').catch(() => []);
  },
  // The signed-in status: the company's changes to the account types and which modules are on.
  applyStatus(status) {
    setRoleOverrides(status.roleOverrides || {});
    ctx.modules = status.modules || {};
    if (status.brand) applyBrand((ctx.brand = status.brand));
  },
  async refreshStatus() {
    ctx.applyStatus(await api.get('/api/auth/status'));
  },
  async refreshSettings() {
    ctx.settings = await api.get('/api/settings');
    const foot = document.getElementById('side-foot');
    if (foot) foot.textContent = `CORE · ERP by Lancaster · ${ctx.settings.companyName}`;
  },
};

export const can = (permission) => userCan(ctx.user, permission);
// A module the company turned off is gone for everyone but administrators, who still open it.
export const moduleOn = (id) => isOn(ctx.modules, id);
export const mayUseModule = (id) => moduleOn(id) || ctx.user?.role === 'admin';
// Any admin permission opens the Admin panel.
export const panelAccess = () => usesAdminPanel(ctx.user);

// The brand colours on every page (CSS variables; each lighter and darker shade is mixed from them in
// light and dark mode), remembered in this browser so the next visit paints in them at once.
export function applyBrand({ brand, accent } = {}) {
  const root = document.documentElement.style;
  const ok = HEX_RE.test(brand || '') && HEX_RE.test(accent || '');
  const core = THEMES.core;
  const own = ok && !(brand.toLowerCase() === core.brand && accent.toLowerCase() === core.accent);
  if (own) {
    root.setProperty('--brand', brand);
    root.setProperty('--accent', accent);
  } else {
    root.removeProperty('--brand');
    root.removeProperty('--accent');
  }
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', own ? brand : core.brand);
  try {
    if (own) localStorage.setItem('core-brand', JSON.stringify({ brand, accent }));
    else localStorage.removeItem('core-brand');
  } catch {}
}
export const roleLabel = (role) => ROLES[role]?.label || role;

// Label for a leave entry, e.g. "Vacation Leave" or "Leave without pay".
export function leaveName(entry) {
  const type = ctx.leaveTypes.find((t) => t.id === entry.leaveTypeId);
  return type ? type.name : entry.paid === false ? 'Unpaid leave' : 'Paid leave';
}
