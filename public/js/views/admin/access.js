// Admin panel → Access grants: the access given to (or taken from) one person on top of their account
// type, in one table: Service Desk agent, Sales & CRM and Projects. Before, each was on its module's
// settings page (they still are; the same routes save them).
import { api } from '../../api.js';
import { roleLabel } from '../../state.js';
import { html, mount, toast, badge } from '../../ui.js';
import { icon } from '../../icons.js';
import { pageHead } from './common.js';

const GRANTS = [
  { id: 'helpdesk', label: 'Service Desk agent', what: 'Works every ticket: replies, internal notes, assignment and status.', list: '/api/helpdesk/agent-access', put: (id) => `/api/helpdesk/agent-access/${id}`, has: (x) => x.agent, home: '#/helpdesk/settings?tab=agents' },
  { id: 'crm', label: 'Sales & CRM', what: 'Sees and edits leads, accounts, deals, bids and contracts. Removing it also removes deleting and the sales setup.', list: '/api/crm/access', put: (id) => `/api/crm/access/${id}`, has: (x) => x.hasAccess, home: '#/crm/settings?tab=access' },
  { id: 'pm', label: 'Projects', what: 'Sees every project and starts and edits projects. Removing it also removes deleting projects and the Projects setup. Members of a project open it either way.', list: '/api/pm/access', put: (id) => `/api/pm/access/${id}`, has: (x) => x.hasAccess, home: '#/projects/settings?tab=access' },
];

export async function accessView(el) {
  const lists = await Promise.all(GRANTS.map((g) => api.get(g.list)));
  const byGrant = Object.fromEntries(GRANTS.map((g, i) => [g.id, new Map(lists[i].map((x) => [x.id, x]))]));
  const people = [...new Map(lists.flat().map((x) => [x.id, x])).values()].sort((a, b) => (a.role === 'admin') - (b.role === 'admin') || a.name.localeCompare(b.name));
  const granted = people.filter((p) => GRANTS.some((g) => typeof byGrant[g.id].get(p.id)?.override === 'boolean')).length;

  const cell = (g, p) => {
    const x = byGrant[g.id].get(p.id);
    if (!x) return html`<span class="muted">—</span>`;
    if (p.role === 'admin') return html`${badge('Always', 'green')}`;
    const value = typeof x.override === 'boolean' ? String(x.override) : '';
    return html`<div class="grant">
      <span>${g.has(x) ? badge('Yes', 'green') : html`<span class="muted">No</span>`}</span>
      <select data-grant="${g.id}" data-user="${p.id}" aria-label="${p.name}: ${g.label}">
        <option value="" ${value === '' ? 'selected' : ''}>Account type (${x.byRole ? 'yes' : 'no'})</option>
        <option value="true" ${value === 'true' ? 'selected' : ''}>Given</option>
        <option value="false" ${value === 'false' ? 'selected' : ''}>Removed</option>
      </select></div>`;
  };

  mount(el, html`
    ${pageHead('Access grants', 'Access given to one person on top of their account type, or taken away. Everything else follows the account type (Roles & permissions).')}
    <div class="cols three grant-help">${GRANTS.map((g) => html`<div class="card"><strong>${g.label}</strong><p class="muted small">${g.what}</p></div>`)}</div>
    <section class="card scroll-x">
      <div class="card-head"><h2>Everyone with an active account</h2><span class="muted small">${granted} with access of their own</span></div>
      <table class="table grant-table">
        <thead><tr><th>Person</th><th>Account type</th>${GRANTS.map((g) => html`<th>${g.label}</th>`)}</tr></thead>
        <tbody>${people.map((p) => html`<tr data-row="${p.id}">
          <td><strong>${p.name}</strong><small class="muted block">${p.username}</small></td>
          <td>${roleLabel(p.role)}</td>
          ${GRANTS.map((g) => html`<td>${cell(g, p)}</td>`)}</tr>`)}</tbody>
      </table>
    </section>
    <p class="muted small">${icon('shield', 14)} <strong>Account type</strong> follows what the account type may do; <strong>Given</strong> and <strong>Removed</strong> hold for this person whatever their account type. Administrators always have all three. Each change is in the <a href="#/admin/audit?area=user">audit log</a>.</p>`);

  el.onchange = async (e) => {
    const sel = e.target.closest('select[data-grant]');
    if (!sel) return;
    const g = GRANTS.find((x) => x.id === sel.dataset.grant);
    const access = sel.value === '' ? null : sel.value === 'true';
    sel.disabled = true;
    try {
      await api.put(g.put(sel.dataset.user), { access });
      toast(`${g.label}: saved.`);
      accessView(el);
    } catch (err) {
      sel.disabled = false;
      toast(err.message, 'error');
    }
  };
}
