// Finance state shared between screens: the settings (funds, offices, PAPs, taxes…), the chart
// of accounts and the card file (cached), what the signed-in person may do, and form helpers.
import { api } from '../api.js';
import { ctx } from '../shell.js';
import { html, badge, option } from '../ui.js';
import { icon } from '../icons.js';
import { peso, fundName, ORS_STATUS, DV_STATUS, PR_STATUS, PO_STATUS, RIS_STATUS } from '/shared/finance.js';

export const fin = {
  settings: null,
  accounts: null,
  cards: null,
  async refreshSettings() {
    fin.settings = await api.get('/api/finance/settings');
  },
  async chart() {
    fin.accounts ||= await api.get('/api/finance/accounts');
    return fin.accounts;
  },
  async cardList() {
    fin.cards ||= await api.get('/api/finance/cards');
    return fin.cards;
  },
  forget() {
    fin.accounts = null;
    fin.cards = null;
  },
};

export const can = (permission) => Boolean(ctx.info?.permissions?.includes(permission));
export const isStaff = () => can('finance.view');
export const isStudent = () => ctx.user?.role === 'student';
export const money = (n) => peso(n);
export const num = (n) => (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fy = () => fin.settings?.fiscalYear || new Date().getFullYear();
export const thisMonth = () => new Date().toISOString().slice(0, 7);
export const monthName = (ym) => (ym ? new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }) : '');

// ----- Selects -----
export const fundOptions = (value, { all = false } = {}) => html`${all ? option('', 'All fund clusters', !value) : ''}${(fin.settings?.funds || []).map((f) => option(f, `${f} · ${fundName(f)}`, f === value))}`;
export const officeOptions = (value, { blank = 'No office' } = {}) => html`${blank ? option('', blank, !value) : ''}${(fin.settings?.offices || []).map((o) => option(o.code, `${o.code} · ${o.name}`, o.code === value))}`;
export const papOptions = (value) => html`${(fin.settings?.paps || []).map((p) => option(p.code, `${p.code} · ${p.name}`, p.code === value))}`;
export const classOptions = (value) => html`${(fin.settings?.allotmentClasses || []).map((c) => option(c.id, `${c.id} · ${c.label}`, c.id === value))}`;
export const accountOptions = (list, value, filter = () => true) => html`<option value="">Pick an account…</option>${list.filter((a) => a.active && filter(a)).map((a) => option(a.code, `${a.code} · ${a.title}`, a.code === value))}`;
export const cardOptions = (list, value, kinds) => html`<option value="">Pick from the card file…</option>${list.filter((c) => !kinds || kinds.includes(c.kind)).map((c) => option(c.id, `${c.name}${c.tin ? ` · TIN ${c.tin}` : ''}`, c.id === value))}`;
export const officeName = (code) => fin.settings?.offices.find((o) => o.code === code)?.name || code || '';

// ----- Badges -----
const KIND = {
  draft: 'gray', submitted: 'amber', obligated: 'green', cancelled: 'gray', certified: 'blue', approved: 'blue', paid: 'green',
  ordered: 'green', partial: 'amber', delivered: 'green', requested: 'amber', issued: 'green', posted: 'green',
};
export const orsBadge = (o) => badge(o.status === 'draft' && o.submitted ? 'For obligation' : ORS_STATUS[o.status] || o.status, o.status === 'draft' && o.submitted ? 'amber' : KIND[o.status]);
export const dvBadge = (d) => badge(d.status === 'draft' && d.submitted ? 'For certification' : DV_STATUS[d.status] || d.status, d.status === 'draft' && d.submitted ? 'amber' : KIND[d.status]);
export const prBadge = (s) => badge(PR_STATUS[s] || s, KIND[s]);
export const poBadge = (s) => badge(PO_STATUS[s] || s, KIND[s]);
export const risBadge = (s) => badge(RIS_STATUS[s] || s, KIND[s]);
export const jevBadge = (j) => (j.reversedBy ? badge('Reversed', 'gray') : badge(j.status === 'posted' ? 'Posted' : 'Draft', j.status === 'posted' ? 'green' : 'amber'));

// Rows of a table that open a page when clicked (tr[data-href]).
export function clickableRows(root) {
  if (root.dataset.rows) return;
  root.dataset.rows = '1';
  root.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a, button, input, select, label')) location.hash = tr.dataset.href;
  });
}

// ----- Editable lines (journal lines, obligation lines, items…) -----
// cols: [{ key, label, type: 'text'|'number'|'select', options: () => html, width, step }]
export function linesTable(id, cols, rows, { min = 1, addLabel = 'Add line', total } = {}) {
  const list = rows.length ? rows : Array.from({ length: min }, () => ({}));
  return html`<div class="lines" id="${id}" data-min="${min}">
    <div class="table-scroll"><table class="table compact lines-table">
      <thead><tr>${cols.map((c) => html`<th class="${c.type === 'number' ? 'num' : ''}" style="${c.width ? `width:${c.width}` : ''}">${c.label}</th>`)}<th class="x"></th></tr></thead>
      <tbody>${list.map((r) => lineRow(cols, r))}</tbody>
      ${total ? html`<tfoot><tr><td colspan="${cols.length + 1}" class="num lines-total"></td></tr></tfoot>` : ''}
    </table></div>
    <button type="button" class="btn sm" data-add-line>${icon('plus', 14)} ${addLabel}</button>
    <template>${lineRow(cols, {})}</template>
  </div>`;
}
function lineRow(cols, r) {
  return html`<tr data-line>${cols.map((c) => html`<td class="${c.type === 'number' ? 'num' : ''}" data-label="${c.label}">${
    c.type === 'select'
      ? html`<select data-k="${c.key}">${c.options(r[c.key])}</select>`
      : html`<input data-k="${c.key}" type="${c.type === 'number' ? 'number' : 'text'}" ${c.type === 'number' ? html`step="${c.step || '0.01'}" min="0" inputmode="decimal"` : ''} value="${r[c.key] ?? ''}" placeholder="${c.placeholder || ''}" />`
  }</td>`)}<td class="x"><button type="button" class="icon-btn" data-remove-line aria-label="Remove line">×</button></td></tr>`;
}
// Wire add/remove and a running total. totalOf(rows) → text.
export function wireLines(root, id, totalOf) {
  const box = root.querySelector(`#${id}`);
  const tbody = box.querySelector('tbody');
  const update = () => {
    const t = box.querySelector('.lines-total');
    if (t && totalOf) t.textContent = totalOf(readLines(root, id));
  };
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-add-line]')) {
      tbody.insertAdjacentHTML('beforeend', box.querySelector('template').innerHTML);
      tbody.lastElementChild.querySelector('input, select')?.focus();
    }
    const rm = e.target.closest('[data-remove-line]');
    if (rm && tbody.children.length > Number(box.dataset.min || 1)) rm.closest('tr').remove();
    update();
  });
  box.addEventListener('input', update);
  box.addEventListener('change', update);
  update();
  return update;
}
export function readLines(root, id) {
  return [...root.querySelectorAll(`#${id} tbody tr[data-line]`)].map((tr) => Object.fromEntries([...tr.querySelectorAll('[data-k]')].map((i) => [i.dataset.k, i.value])))
    .filter((r) => Object.values(r).some((v) => v !== '' && v !== '0'));
}

// A small "label: value" grid.
export const infoGrid = (pairs) => html`<dl class="info-grid">${pairs.filter(Boolean).map(([k, v]) => html`<div class="info"><dt>${k}</dt><dd>${v ?? '—'}</dd></div>`)}</dl>`;
// A money table cell.
export const amt = (n, { strong = false, blankZero = false } = {}) => html`<td class="num">${blankZero && !Number(n) ? '' : strong ? html`<strong>${num(n)}</strong>` : num(n)}</td>`;
export const printLink = (kind, id, label = 'Print') => html`<a class="btn" href="#/print/${kind}/${id}">${icon('file', 16)} ${label}</a>`;
