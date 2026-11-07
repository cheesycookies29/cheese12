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
  watchScrollers(el);
}

// Areas that scroll sideways (wide tables, tabs, the timetable) get data-more = left, right
// or both, so the CSS can fade the edge where there is more to see. Tabs also scroll their
// active tab into view.
function updateScroller(s) {
  const max = s.scrollWidth - s.clientWidth;
  const left = s.scrollLeft > 2;
  const right = s.scrollLeft < max - 2;
  const more = max > 2 ? (left && right ? 'both' : left ? 'left' : right ? 'right' : '') : '';
  if (s.dataset.more !== more) s.dataset.more = more;
}
export function watchScrollers(root) {
  const list = [...root.querySelectorAll('.scroll-x, .tabs')];
  const own = root.closest?.('.scroll-x, .tabs');
  if (own) list.push(own);
  for (const s of list) {
    if (!s.dataset.watched) {
      s.dataset.watched = '1';
      s.addEventListener('scroll', () => updateScroller(s), { passive: true });
      const active = s.matches('.tabs') && s.querySelector('.active');
      if (active && active.offsetLeft + active.offsetWidth > s.clientWidth) s.scrollLeft = active.offsetLeft - 16;
    }
    updateScroller(s);
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => document.querySelectorAll('[data-watched]').forEach(updateScroller));
  window.addEventListener('load', () => document.querySelectorAll('[data-watched]').forEach(updateScroller));
}

// Copy each column heading onto its cells (data-label), so on phones a table row
// can be shown as a card of "Label: value" lines. Grids that need columns opt out
// with .no-stack (and a few known grid tables below).
const KEEP_AS_GRID = '.no-stack, .matrix, .att-table, .gradebook';
export function labelTables(root) {
  const tables = root.matches?.('table.table') ? [root] : root.querySelectorAll('table.table');
  for (const table of tables) {
    if (table.matches(KEEP_AS_GRID)) continue;
    table.classList.add('stackable');
    // A heading can give a fuller label for phones with data-label (e.g. a leave type's name for "VL").
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.dataset.label || th.textContent.trim());
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


// Pesos and plain amounts (payroll), minutes as "1h 05m", "HH:MM" as "8:05 AM".
const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const num = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n) => peso.format(Number(n) || 0);
export const amount = (n) => num.format(Number(n) || 0);
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
export const fullName = (e) => `${e.firstName} ${e.lastName}`;
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function fmtDate(ymd, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', opts);
}

// 'YYYY-MM-DDTHH:MM' (local) or an ISO timestamp → "Aug 20, 2026, 11:59 PM"
export function fmtDateTime(value) {
  if (!value) return '';
  const d = value.length === 16 ? new Date(`${value}:00`) : new Date(value);
  return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso.slice(0, 10));
}

// Local 'YYYY-MM-DDTHH:MM' now, to compare with due dates.
export const nowLocal = (d = new Date()) => `${today(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const pad = (n) => String(n).padStart(2, '0');
export const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return today(new Date(y, m - 1, d + n));
};

export const initials = (name) => String(name).split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

let toastTimer;
// The message area is a live region from the start, so screen readers announce every message.
const toastEl = typeof document !== 'undefined' && document.getElementById('toast');
if (toastEl) {
  toastEl.setAttribute('role', 'status');
  toastEl.setAttribute('aria-live', 'polite');
}
// Messages are announced to screen readers; errors stay longer (they are usually longer, and need reading).
export function toast(message, type = 'ok') {
  const el = document.getElementById('toast');
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  el.textContent = message;
  el.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), type === 'error' ? Math.max(6000, message.length * 70) : 3500);
}

// Opens a modal containing a form. `onSubmit(formData)` may throw to keep it open.
// subtitle: a line under the title; submitLabel null = a read-only window with only a close button.
export function modal({ title, subtitle = '', body, submitLabel = 'Save', cancelLabel = 'Cancel', onSubmit, wide = false, className = '' }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = render(html`
    <form class="modal ${wide ? 'wide' : ''} ${className}" novalidate role="dialog" aria-modal="true" aria-label="${title}">
      <header><div class="modal-title"><h2>${title}</h2>${subtitle ? html`<p>${subtitle}</p>` : ''}</div><button type="button" class="icon-btn" data-close aria-label="Close">×</button></header>
      <div class="modal-body">${body}</div>
      <p class="form-error" hidden></p>
      <footer>
        <button type="button" class="btn" data-close>${submitLabel === null && cancelLabel === 'Cancel' ? 'Close' : cancelLabel}</button>
        ${submitLabel === null ? '' : html`<button type="submit" class="btn primary">${submitLabel}</button>`}
      </footer>
    </form>`);
  const opener = document.activeElement; // focus goes back here when the dialog closes
  document.body.appendChild(backdrop);
  labelTables(backdrop);
  watchScrollers(backdrop);
  const form = backdrop.querySelector('form');
  const errorEl = backdrop.querySelector('.form-error');
  // Keyboard: Escape closes; Tab and Shift+Tab stay inside the dialog (the topmost one).
  const focusables = () => [...form.querySelectorAll('button, [href], input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
  const onKey = (e) => {
    if (!document.body.contains(backdrop)) return document.removeEventListener('keydown', onKey); // removed by a page change
    if (backdrop !== [...document.querySelectorAll('.modal-backdrop')].at(-1)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      const f = focusables();
      if (!f.length) return;
      const inside = form.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === f[0])) {
        e.preventDefault();
        f.at(-1).focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === f.at(-1))) {
        e.preventDefault();
        f[0].focus();
      }
    }
  };
  document.addEventListener('keydown', onKey);
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    if (opener && document.body.contains(opener)) opener.focus();
  };
  backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    if (!btn) return;
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

export function confirmDialog(message, { confirmLabel = 'Delete', danger = true, title = 'Please confirm' } = {}) {
  return new Promise((resolve) => {
    let confirmed = false;
    const { form } = modal({
      title,
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

// Enrollment status → badge colour.
const STATUS_KIND = { enrolled: 'green', completed: 'blue', pending: 'amber', waitlisted: 'amber', dropped: 'gray', rejected: 'red', active: 'green', disabled: 'gray', open: 'green', closed: 'gray', cancelled: 'red', archived: 'gray' };
export const statusBadge = (status, label = status) => badge(label.charAt(0).toUpperCase() + label.slice(1), STATUS_KIND[status] || '');

// Form helpers
export const formData = (form) => Object.fromEntries(new FormData(form));
export const option = (value, label, selected) => html`<option value="${value}" ${selected ? 'selected' : ''}>${label}</option>`;
export const empty = (title, text = '') => html`<div class="card empty"><h2>${title}</h2>${text ? html`<p>${text}</p>` : ''}</div>`;

// "48.5 KB" instead of 49672.
export function fmtSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Reads a picked file for upload: { name, type, data (base64) }.
export const MAX_UPLOAD = 10 * 1024 * 1024;
export function readFile(file) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_UPLOAD) return reject(new Error(`${file.name} is larger than 10 MB.`));
    const r = new FileReader();
    r.onload = () => resolve({ name: file.name, type: file.type, data: String(r.result).split(',')[1] || '' });
    r.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    r.readAsDataURL(file);
  });
}

// "Due in 3 days", "Due today 11:59 PM", "2 days overdue" for a local 'YYYY-MM-DDTHH:MM'.
export function dueText(dueAt, verb = 'Due') {
  if (!dueAt) return 'No due date';
  const now = new Date();
  const due = new Date(`${dueAt}:00`);
  const days = Math.round((new Date(due.getFullYear(), due.getMonth(), due.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  const time = due.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
  if (due < now) return days === 0 ? `${verb} today ${time} (passed)` : `${-days} day${days === -1 ? '' : 's'} overdue`;
  if (days === 0) return `${verb} today ${time}`;
  if (days === 1) return `${verb} tomorrow ${time}`;
  if (days < 7) return `${verb} ${due.toLocaleDateString('en-PH', { weekday: 'long' })} ${time}`;
  return `${verb} ${fmtDateTime(dueAt)}`;
}
