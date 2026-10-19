// Small UI helpers: escaped HTML templates, formatting, modal and toast.

class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
export const raw = (s) => new Raw(s);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function render(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return escape(v);
}

// Tagged template: interpolated values are escaped unless wrapped in raw()/html``.
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => (out += render(v) + strings[i + 1]));
  return new Raw(out);
}

export function mount(el, content) {
  el.innerHTML = render(content);
  labelTables(el);
}

// Copy each column heading onto its cells (data-label), so on phones a table row
// can be shown as a card of "Label: value" lines. Grids that need columns opt out
// with .no-stack (and a few known grid tables below).
const KEEP_AS_GRID = '.no-stack, .balances, .matrix, .edit-table, .try';
export function labelTables(root) {
  const tables = root.matches?.('table.table') ? [root] : root.querySelectorAll('table.table');
  for (const table of tables) {
    if (table.matches(KEEP_AS_GRID)) continue;
    table.classList.add('stackable');
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    for (const row of table.querySelectorAll('tbody tr, tfoot tr')) {
      let col = 0;
      for (const cell of row.children) {
        const label = heads[col] || '';
        col += Number(cell.getAttribute('colspan')) || 1;
        if (!label || cell.hasAttribute('data-label')) continue;
        cell.setAttribute('data-label', label);
        // Keep the value together (e.g. an amount and its "/month") on the right of its label.
        if (cell.childNodes.length > 1) cell.innerHTML = `<span class="cell-v">${cell.innerHTML}</span>`;
        // Blank cells ("—") are hidden on phones to keep each card short.
        if (/^[—–-]?$/.test(cell.textContent.trim()) && !cell.querySelector('button, input, select, a')) cell.classList.add('is-empty');
      }
    }
  }
}

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const num = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n) => peso.format(Number(n) || 0);
export const amount = (n) => num.format(Number(n) || 0);

export function fmtDate(ymd, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', opts);
}

export function fmtMinutes(mins) {
  if (!mins) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function fmtTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const pad = (n) => String(n).padStart(2, '0');
export const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return today(new Date(y, m - 1, d + n));
};

export const fullName = (e) => `${e.firstName} ${e.lastName}`;
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let toastTimer;
export function toast(message, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 3500);
}

// Opens a modal containing a form. `onSubmit(formData)` may throw to keep it open.
export function modal({ title, body, submitLabel = 'Save', onSubmit, wide = false }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = render(html`
    <form class="modal ${wide ? 'wide' : ''}" novalidate>
      <header><h2>${title}</h2><button type="button" class="icon-btn" data-close aria-label="Close">×</button></header>
      <div class="modal-body">${body}</div>
      <p class="form-error" hidden></p>
      <footer>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">${submitLabel}</button>
      </footer>
    </form>`);
  document.body.appendChild(backdrop);
  labelTables(backdrop);
  const form = backdrop.querySelector('form');
  const errorEl = backdrop.querySelector('.form-error');
  const close = () => backdrop.remove();
  backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  backdrop.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await onSubmit(form);
      close();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
  form.querySelector('input:not([type=hidden]), select, textarea')?.focus();
  return { form, close };
}

export function confirmDialog(message, { confirmLabel = 'Delete', danger = true } = {}) {
  return new Promise((resolve) => {
    let confirmed = false;
    const { form } = modal({
      title: 'Please confirm',
      body: html`<p>${message}</p>`,
      submitLabel: confirmLabel,
      onSubmit: () => {
        confirmed = true;
        resolve(true);
      },
    });
    if (danger) form.querySelector('[type=submit]').classList.add('danger');
    const observer = new MutationObserver(() => {
      if (!document.body.contains(form)) {
        observer.disconnect();
        if (!confirmed) resolve(false);
      }
    });
    observer.observe(document.body, { childList: true });
  });
}

export function downloadFile(filename, content, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(rows) {
  return rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}

export const badge = (text, kind = '') => html`<span class="badge ${kind}">${text}</span>`;
