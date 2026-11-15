// Admin panel → Help & guides: every guide, whether the company edited it, and a link to the guide
// editor in Help & guides (/help/), where guides are read, edited and added.
import { api } from '../../api.js';
import { html, mount, badge } from '../../ui.js';
import { icon } from '../../icons.js';
import { ROLES } from '/shared/roles.js';
import { pageHead } from './common.js';

export async function guidesAdminView(el) {
  const { guides } = await api.get('/api/guides');
  const updated = guides.filter((g) => g.builtInChanged).length;
  mount(el, html`
    ${pageHead('Help & guides', 'The guides everyone reads under the ? button. Edit one for your company, or add your own; your version is kept when CORE is updated.', html`<a class="btn primary" href="/help/#/new" target="_blank" rel="noopener">${icon('plus', 16)} New guide</a>`)}
    ${updated ? html`<div class="notice">${icon('alert')}<p>CORE has updated ${updated} guide${updated === 1 ? '' : 's'} you edited since. Open ${updated === 1 ? 'it' : 'them'} to compare with the new built-in guide.</p></div>` : ''}
    <section class="card scroll-x"><table class="table">
      <thead><tr><th>Guide</th><th>For</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${guides.map((g) => html`<tr>
        <td><a href="/help/#/${g.id}" target="_blank" rel="noopener"><strong>${g.title}</strong></a><small class="muted block">${g.summary || ''}</small></td>
        <td class="small">${(g.roles || []).map((r) => ROLES[r]?.label || r).join(', ')}</td>
        <td>${g.custom ? badge('The company\'s own', 'blue') : g.builtInChanged ? badge('Edited · CORE updated it since', 'amber') : g.edited ? badge('Edited by the company', 'amber') : html`<span class="muted">Built in</span>`}</td>
        <td class="row-actions"><a class="btn sm" href="/help/#/edit/${g.id}" target="_blank" rel="noopener" aria-label="Edit ${g.title}">${icon('edit', 14)} Edit</a></td>
      </tr>`)}</tbody></table></section>
    <p class="muted small">The editor opens in a new tab. Every save is recorded in the <a href="#/admin/audit?area=system">audit log</a>.</p>`);
}
