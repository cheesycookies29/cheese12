import { api } from './api.js';

// App-wide state shared between views.
export const ctx = {
  settings: null,
  async refreshSettings() {
    ctx.settings = await api.get('/api/settings');
    document.getElementById('company-name').textContent = ctx.settings.companyName;
  },
};
