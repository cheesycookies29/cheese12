// Control → Audit trail: sign-ins and failed sign-ins, every change by staff in every system,
// refused requests, and Control's own actions, together with the Settings history, Finance's audit
// and Academic's log. Filters live in the address, so a filtered trail can be shared or reloaded.
import { api } from '../../api.js';
import { html, mount, option } from '../../ui.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { SYSTEMS, KINDS, SOURCES, pager, wireFilter, trailHead, trailRow } from '../common.js';

export async function auditView(el, params, q) {
  const d = await api.get(`/api/control/audit?${new URLSearchParams(q)}`);
  const keep = q.userId ? { userId: q.userId } : {};
  const { page, ...filters } = q;
  const csv = `/api/control/audit?${new URLSearchParams({ ...filters, format: 'csv' })}`;
  mount(el, html`
    ${pageHead(d.user ? html`Audit trail: ${d.user.name}` : 'Audit trail', 'Who signed in and who failed to, every change by staff in every system, requests that were refused, and the Settings, Finance and Academic logs, newest first. Passwords and what people type into forms are never recorded.',
      html`<a class="btn" href="${csv}" download>${icon('download', 16)} Download CSV</a>`, d.user ? [['/accounts', 'Accounts'], [`/accounts/${d.user.id}`, d.user.name]] : '')}
    ${d.check.ok
      ? html`<div class="notice ok">${icon('checkCircle')}<p><strong>Intact.</strong> All ${d.check.count.toLocaleString()} entries of the audit log check out: none was changed, removed or reordered. Entries cannot be edited or deleted here, and restoring a backup or removing the demo school leaves them as they are.</p></div>`
      : html`<div class="notice bad">${icon('flag')}<p><strong>The audit log was altered.</strong> Entry ${d.check.brokenAt}${d.check.at ? html` (${new Date(d.check.at).toLocaleString()})` : ''} does not match the entries before it: the file was edited outside ATLAS. Keep a copy of <code>audit-log.jsonl</code> and investigate.</p></div>`}
    <form class="toolbar filters" id="filter">
      <input type="search" name="q" value="${q.q || ''}" placeholder="Who, what, address…" aria-label="Search the trail" />
      <select name="kind" aria-label="Kind">${option('', 'Every kind', !q.kind)}${Object.entries(KINDS).map(([k, l]) => option(k, l, q.kind === k))}</select>
      <select name="outcome" aria-label="Outcome">${[['', 'Any outcome'], ['ok', 'Done'], ['failed', 'Failed'], ['refused', 'Refused']].map(([k, l]) => option(k, l, (q.outcome || '') === k))}</select>
      <select name="system" aria-label="System">${option('', 'Every system', !q.system)}${Object.entries(SYSTEMS).map(([k, l]) => option(k, l, q.system === k))}</select>
      <select name="source" aria-label="Log">${option('', 'Every log', !q.source)}${Object.entries(SOURCES).map(([k, l]) => option(k, l, q.source === k))}</select>
      <label class="inline-field"><span>From</span><input type="date" name="from" value="${q.from || ''}" /></label>
      <label class="inline-field"><span>To</span><input type="date" name="to" value="${q.to || ''}" /></label>
      <button class="btn">Filter</button>
      ${Object.keys(q).some((k) => k !== 'page') ? html`<a class="btn ghost" href="#/audit">Clear</a>` : ''}
      <span class="spacer"></span><span class="muted">${d.total.toLocaleString()} entr${d.total === 1 ? 'y' : 'ies'}</span>
    </form>
    ${d.entries.length ? html`<div class="card flush"><div class="table-scroll"><table class="table trail">${trailHead()}<tbody>${d.entries.map((e) => trailRow(e))}</tbody></table></div></div>${pager(d, q, '/audit')}`
      : html`<div class="card empty">${icon('search', 32)}<p>Nothing in the trail matches.</p></div>`}
    <p class="muted small">The audit log keeps every entry${d.kept.oldest ? html`, since <time datetime="${d.kept.oldest}">${new Date(d.kept.oldest).toLocaleDateString()}</time>` : ''}, in its own file beside the data (<code>audit-log.jsonl</code>); each entry is chained to the one before by a hash, as in CORE. The download has every entry that matches the filters, with each sign-in's network address.</p>`);
  wireFilter(el.querySelector('#filter'), '/audit', keep);
}
