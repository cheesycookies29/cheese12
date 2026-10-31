// Helpers shared by admin panel views.
import { api } from '../api.js';
import { html, option } from '../ui.js';

export const seatBar = (s) => {
  const ratio = s.capacity ? s.taken / s.capacity : 0;
  return html`<span class="seats"><span class="seat-bar ${ratio >= 1 ? 'full' : ratio >= 0.8 ? 'tight' : ''}"><i style="width:${Math.min(100, Math.round(ratio * 100))}%"></i></span>${s.taken}/${s.capacity}</span>`;
};

export const sectionTitle = (s) => html`<strong>${s.course.code} ${s.name}</strong><small>${s.course.title}</small>`;

export async function lookups(...names) {
  const urls = {
    terms: '/api/admin/terms',
    courses: '/api/admin/courses',
    programs: '/api/admin/programs',
    teachers: '/api/admin/users?role=teacher',
    settings: '/api/admin/settings',
    students: '/api/admin/users?role=student&status=active',
  };
  const values = await Promise.all(names.map((n) => api.get(urls[n]).catch(() => [])));
  return Object.fromEntries(names.map((n, i) => [n, values[i]]));
}

// <select> of terms, current term first by default.
export function termSelect(terms, selected, { name = 'termId', all = false } = {}) {
  return html`<select name="${name}">
    ${all ? option('', 'All terms', !selected) : ''}
    ${terms.map((t) => option(t.id, `${t.name}${t.current ? ' (current)' : ''}${t.status === 'archived' ? ' (archived)' : ''}`, t.id === selected))}
  </select>`;
}

export const currentTermId = (terms) => terms.find((t) => t.current)?.id || terms.at(-1)?.id || '';

export function setQuery(params) {
  const [path, q] = location.hash.slice(1).split('?');
  const next = new URLSearchParams(q || '');
  for (const [k, v] of Object.entries(params)) (v ? next.set(k, v) : next.delete(k));
  const s = next.toString();
  location.hash = `#${path}${s ? `?${s}` : ''}`;
}

// Hide table rows that do not contain the search text.
export function filterRows(el, input = el.querySelector('input[type=search]')) {
  input?.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    let n = 0;
    el.querySelectorAll('table.table tbody tr').forEach((tr) => {
      const hit = !q || tr.textContent.toLowerCase().includes(q);
      tr.hidden = !hit;
      n += hit;
    });
    const shown = el.querySelector('#shown');
    if (shown) shown.textContent = `${n} shown`;
  });
}
