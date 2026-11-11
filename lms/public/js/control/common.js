// Small pieces shared by Control's screens.
import { html, badge, timeAgo, fmtDateTime } from '../ui.js';
import { icon } from '../icons.js';

export const SYSTEMS = { home: 'ATLAS home', learn: 'Learn', admin: 'Admin panel', academic: 'Academic', people: 'People', finance: 'Finance', control: 'Control', help: 'Help' };
export const KINDS = { signin: 'Sign-in', signout: 'Sign-out', password: 'Password', account: 'Account', access: 'Access', session: 'Session', settings: 'Settings', change: 'Change', refused: 'Refused', data: 'Data' };
export const SOURCES = { trail: 'Access & changes', settings: 'Settings history', finance: 'Finance audit', academic: 'Academic log' };

// "3 minutes ago", with the exact time on hover.
export const when = (iso) => (iso ? html`<time datetime="${iso}" title="${fmtDateTime(iso)}">${timeAgo(iso)}</time>` : html`<span class="muted">Never</span>`);

export const outcomeBadge = (o) => ({ ok: badge('Done', 'green'), failed: badge('Failed', 'red'), refused: badge('Refused', 'amber') })[o] || badge(o, 'gray');
export const statusBadge = (s) => ({ active: badge('Active', 'green'), disabled: badge('Disabled', 'gray'), pending: badge('Applied', 'amber'), rejected: badge('Not admitted', 'red') })[s] || badge(s, 'gray');

// "Chrome on Windows" from a browser's user agent (enough to recognise a session; not a fingerprint).
export function browserOf(agent = '') {
  const a = String(agent);
  if (!a) return '';
  const b = /Edg\//.test(a) ? 'Edge' : /OPR\//.test(a) ? 'Opera' : /Firefox\//.test(a) ? 'Firefox' : /Chrome\//.test(a) ? 'Chrome' : /Safari\//.test(a) ? 'Safari' : 'A browser';
  const os = /iPhone|iPad/.test(a) ? 'iPhone or iPad' : /Android/.test(a) ? 'Android' : /Windows/.test(a) ? 'Windows' : /Mac OS X/.test(a) ? 'Mac' : /Linux/.test(a) ? 'Linux' : '';
  return os ? `${b} on ${os}` : b;
}

// Page links for a list with { page, pages }: builds each link from the current query.
export function pager(d, q, base, [prev, next] = ['Newer', 'Older']) {
  if (d.pages <= 1) return '';
  const to = (page) => `#${base}?${new URLSearchParams({ ...q, page: String(page) })}`;
  return html`<nav class="pager" aria-label="Pages">
    ${d.page > 1 ? html`<a class="btn sm" href="${to(d.page - 1)}">${icon('chevronLeft', 14)} ${prev}</a>` : html`<span></span>`}
    <span class="muted small">Page ${d.page} of ${d.pages}</span>
    ${d.page < d.pages ? html`<a class="btn sm" href="${to(d.page + 1)}">${next} ${icon('chevronRight', 14)}</a>` : html`<span></span>`}
  </nav>`;
}

// A filter form whose fields become the address's query (so a filtered list can be shared and reloaded).
export function wireFilter(form, base, keep = {}) {
  const go = () => {
    const v = Object.fromEntries([...new FormData(form)].filter(([, x]) => x !== ''));
    location.hash = `#${base}?${new URLSearchParams({ ...keep, ...v })}`;
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    go();
  });
  form.querySelectorAll('select').forEach((s) => s.addEventListener('change', go));
}

// One audit entry as a table row.
export const trailRow = (e, { who = true } = {}) => html`<tr class="${e.outcome !== 'ok' ? 'trail-bad' : ''}">
  <td data-label="When" class="nowrap">${when(e.at)}</td>
  ${who ? html`<td data-label="Who">${e.actorId ? html`<a href="#/accounts/${e.actorId}">${e.actor}</a>` : e.actor || html`<span class="muted">Not signed in</span>`}</td>` : ''}
  <td data-label="What"><strong class="trail-action">${e.action}</strong>${e.detail ? html`<small class="muted block trail-detail">${e.detail}</small>` : ''}</td>
  <td data-label="About">${!e.target || (e.targetId && e.targetId === e.actorId) ? html`<span class="muted">—</span>` : e.targetUser ? html`<a href="#/accounts/${e.targetId}">${e.target}</a>` : e.target}</td>
  <td data-label="Where"><span class="nowrap">${SYSTEMS[e.system] || e.system}</span>${e.ip ? html`<small class="muted block mono">${e.ip}</small>` : ''}</td>
  <td data-label="Outcome">${outcomeBadge(e.outcome)}</td>
</tr>`;
export const trailHead = ({ who = true } = {}) => html`<thead><tr><th>When</th>${who ? html`<th>Who</th>` : ''}<th>What</th><th>About</th><th>Where</th><th>Outcome</th></tr></thead>`;
