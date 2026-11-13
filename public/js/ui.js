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
  enhance(el);
}

// Copy each column heading onto its cells (data-label), so on phones a table row
// can be shown as a card of "Label: value" lines. Grids that need columns opt out
// with .no-stack (and a few known grid tables below).
const KEEP_AS_GRID = '.no-stack, .balances, .matrix, .edit-table, .try';
// Tables of 6 columns or more are cards up to tablet width too (.stack-md), except the money grids
// that are read across (the payroll register, year to date), which scroll with their first column pinned.
const KEEP_WIDE = '.register, .ytd-table, .no-stack-md';
export const WIDE_COLUMNS = 6;
export function labelTables(root) {
  const tables = root.matches?.('table.table') ? [root] : root.querySelectorAll('table.table');
  for (const table of tables) {
    if (table.matches(KEEP_AS_GRID)) continue;
    table.classList.add('stackable');
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (heads.length >= WIDE_COLUMNS && !table.matches(KEEP_WIDE)) table.classList.add('stack-md');
    for (const row of table.querySelectorAll('tbody tr, tfoot tr')) {
      let col = 0;
      for (const cell of row.children) {
        const label = heads[col] || '';
        col += Number(cell.getAttribute('colspan')) || 1;
        if (!label || cell.hasAttribute('data-label')) continue;
        cell.setAttribute('data-label', label);
        // Keep the value together (e.g. an amount and its "/month") on the right of its label.
        if (cell.childNodes.length > 1) cell.innerHTML = `<span class="cell-v">${cell.innerHTML}</span>`;
        // Blank cells ("—", and 0.00 in the money grids) are hidden on phones to keep each card short.
        const t = cell.textContent.trim();
        if ((/^[—–-]?$/.test(t) || (table.matches('.hide-zero') && /^0(\.00)?$/.test(t))) && !cell.querySelector('button, input, select, a')) cell.classList.add('is-empty');
      }
    }
  }
}

// ----- Phones and tablets: what mount() adds to every screen -----
export function enhance(root) {
  if (typeof document === 'undefined') return;
  root.querySelectorAll('.toolbar').forEach(foldFilters);
  fitFigures(root);
  watchScrollers();
  queueScrollers();
}

// A list's filters (two or more selects, checkboxes or date ranges beside the search) fold into one
// "Filters" button on phones, with the number of filters that are not at their default.
const FILTER_ITEM = ':scope > select, :scope > label.inline, :scope > label.field.check, :scope > .field.inline';
export const activeFilterCount = (items) => items.filter((x) => (x.type === 'select' && x.index > 0) || (x.type === 'checkbox' && x.checked)).length;
function filterState(toolbar) {
  return [...toolbar.querySelectorAll(':scope > .filter-item:not(.filter-extra)')].flatMap((item) => {
    const c = item.matches('select') ? item : item.querySelector('select, input');
    if (!c) return [];
    if (c.tagName === 'SELECT') return [{ type: 'select', index: c.selectedIndex }];
    if (c.type === 'checkbox') return [{ type: 'checkbox', checked: c.checked }];
    return [{ type: c.type }];
  });
}
function foldFilters(toolbar) {
  if (toolbar.dataset.filters || toolbar.matches('.no-fold')) return;
  const items = [...toolbar.querySelectorAll(FILTER_ITEM)];
  toolbar.dataset.filters = String(items.length);
  if (items.length < 2) return;
  items.forEach((x) => x.classList.add('filter-item'));
  // Other controls that only refine the list (saved views) fold away with the filters too.
  toolbar.querySelectorAll(':scope > .pm-views-btn, :scope > [data-fold]').forEach((x) => x.classList.add('filter-item', 'filter-extra'));
  toolbar.classList.add('has-filters');
  if (!toolbar.id) toolbar.id = `filters-${Math.random().toString(36).slice(2, 8)}`;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn filters-btn';
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', toolbar.id);
  btn.innerHTML = '<svg class="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg><span>Filters</span><span class="count" hidden></span>';
  const search = toolbar.querySelector(':scope > input[type=search], :scope > .crm-search');
  (search ? search.nextSibling : toolbar.firstChild) ? toolbar.insertBefore(btn, search ? search.nextSibling : toolbar.firstChild) : toolbar.appendChild(btn);
  const count = btn.querySelector('.count');
  const update = () => {
    const n = activeFilterCount(filterState(toolbar));
    count.textContent = n || '';
    count.hidden = !n;
    btn.setAttribute('aria-label', n ? `Filters, ${n} on` : 'Filters');
  };
  btn.addEventListener('click', () => {
    const open = toolbar.classList.toggle('filters-open');
    btn.setAttribute('aria-expanded', String(open));
    if (open) toolbar.querySelector('.filter-item select, .filter-item input, select.filter-item')?.focus();
  });
  toolbar.addEventListener('change', update);
  update();
}

// Stat tiles: a figure too long for half a row on a phone takes the whole row.
export function fitFigures(root) {
  const tiles = root.querySelectorAll('.stats > .card');
  if (!tiles.length) return;
  requestAnimationFrame(() => tiles.forEach((card) => {
    card.classList.remove('fig-wide');
    const fig = card.querySelector(':scope > strong');
    if (fig && fig.scrollWidth > card.clientWidth - 24) card.classList.add('fig-wide');
  }));
}

// Sideways scrollers (tabs, chips, wide tables, boards) fade on the side where more waits, and the
// active tab or chip is brought into view when the page opens.
export const SCROLLERS = '.tabs, .scroll-x, .table-scroll, .pm-chips, .seg-btns, .crm-board, .pm-board, .pm-ms-strip, .pm-tl-scroll, .pm-ts-scroll, .crm-path, .pm-bulk-in, .md-toolbar';
const ACTIVE = '.active, .on, .cur, [aria-current="page"], [aria-current="step"], [aria-selected="true"]';
export function edgeState({ scrollLeft, scrollWidth, clientWidth }) {
  const max = scrollWidth - clientWidth;
  if (max <= 2) return { left: false, right: false };
  return { left: scrollLeft > 2, right: scrollLeft < max - 2 };
}
// How far to scroll so the active item is in view (centred when it was out of view); null = leave it.
export function scrollToShow({ scrollLeft, clientWidth }, { left, width }) {
  if (left >= scrollLeft && left + width <= scrollLeft + clientWidth) return null;
  return Math.max(0, Math.round(left - (clientWidth - width) / 2));
}
const seen = typeof WeakSet === 'function' ? new WeakSet() : null;
export function markScroller(s) {
  const st = getComputedStyle(s);
  const scrolls = st.overflowX === 'auto' || st.overflowX === 'scroll';
  const { left, right } = scrolls ? edgeState(s) : { left: false, right: false };
  s.classList.toggle('more-left', left);
  s.classList.toggle('more-right', right);
  if (scrolls && seen && !seen.has(s) && s.clientWidth) {
    seen.add(s);
    const a = s.querySelector(ACTIVE);
    if (a && s.contains(a) && (left || right)) {
      const r = a.getBoundingClientRect();
      const to = scrollToShow(s, { left: r.left - s.getBoundingClientRect().left + s.scrollLeft, width: r.width });
      if (to !== null) {
        s.scrollLeft = to;
        markScroller(s);
      }
    }
  }
}
let watching = false;
let queued = false;
function queueScrollers() {
  if (queued || typeof requestAnimationFrame !== 'function') return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    document.querySelectorAll(SCROLLERS).forEach(markScroller);
  });
}
function watchScrollers() {
  if (watching) return;
  watching = true;
  document.addEventListener('scroll', (e) => e.target.matches?.(SCROLLERS) && markScroller(e.target), { capture: true, passive: true });
  addEventListener('resize', () => {
    queueScrollers();
    fitFigures(document);
  });
}

// ----- Form errors: every problem shown at its field -----
// "firstName" → "First name"; "pagibigNo" → "Pagibig no".
export function humanizeKey(key) {
  const words = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
const STOP = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'or', 'to', 'in', 'on', 'is', 'be', 'it', 'its', 'this', 'that', 'your', 'no', 'no.', 'optional', 'from', 'with', 'at']);
const words = (t) => String(t).toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9À-ɏ]+/g, ' ').split(' ').filter((w) => w.length > 1 && !STOP.has(w));
// The field a message is about: its name ("firstName is required."), its label ("Asset name is
// required."), or all the words of its label ("Enter a name for the deal." → "Deal name"). fields:
// [{ name, label }] in form order. Returns the field's name, or null.
export function fieldForMessage(message, fields) {
  const msg = String(message || '');
  const lower = msg.toLowerCase();
  const byKey = fields.find((f) => f.name && new RegExp(`(^|[^\\w])${f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w]|$)`).test(msg));
  if (byKey) return byKey.name;
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const plain = (l) => l.toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').replace(/[*:]/g, '').trim();
  const byLabel = fields.filter((f) => f.label && plain(f.label) && new RegExp(`(^|[^a-z0-9])${esc(plain(f.label))}($|[^a-z0-9])`).test(lower)).sort((a, b) => b.label.length - a.label.length)[0];
  if (byLabel) return byLabel.name;
  const msgWords = new Set(words(msg));
  let best = null;
  for (const f of fields) {
    const lw = [...new Set(words(f.label || humanizeKey(f.name || '')))];
    if (lw.length < 2 || !lw.every((w) => msgWords.has(w) || msgWords.has(w.replace(/s$/, '')) || msgWords.has(`${w}s`))) continue;
    if (!best || lw.length > best.n) best = { name: f.name, n: lw.length };
  }
  return best ? best.name : null;
}
// A server message that names a field by its key reads with the field's label instead.
export function readableMessage(message, fields) {
  let out = String(message || '');
  for (const f of fields) {
    if (!f.name || !f.label || !/[A-Z]/.test(f.name)) continue;
    out = out.replace(new RegExp(`(^|[^\\w])${f.name}([^\\w]|$)`), (_, a, b) => `${a}${f.label}${b}`);
  }
  return out.replace(/^([a-z])/, (c) => c.toUpperCase());
}
// One line for the summary: the message itself, or the list of fields to fix.
export function errorSummary(errors) {
  if (!errors.length) return '';
  if (errors.length === 1) return errors[0].message;
  const names = errors.map((e) => e.label || humanizeKey(e.name));
  return `Check ${errors.length} fields: ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}.`;
}
// What a field is called on screen: its label (without the * and hints), else a humanized name.
export function labelOf(control) {
  const box = control.closest('.field, label');
  const span = box?.querySelector(':scope > span:first-child, :scope > legend');
  // "New password (at least 8 characters) *" → "New password".
  const text = (span?.textContent || control.getAttribute('aria-label') || control.placeholder || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().replace(/\s*\([^)]*\)$/, '');
  return text || humanizeKey(control.name || control.id || '');
}
const controlsOf = (form) => [...form.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea')].filter((c) => c.name || c.id);
function messageFor(c, label) {
  if (c.validity.valueMissing && c.dataset.msg) return c.dataset.msg;
  if (c.validity.valueMissing) return c.type === 'checkbox' ? `Tick “${label}”.` : c.type === 'file' ? `Attach ${label.toLowerCase()}.` : `${label} is required.`;
  if (c.validity.typeMismatch && c.type === 'email') return `${label}: enter a valid email address, such as name@example.com.`;
  if (c.validity.typeMismatch) return `${label}: check the format.`;
  if (c.validity.rangeUnderflow) return `${label} must be ${c.min} or more.`;
  if (c.validity.rangeOverflow) return `${label} must be ${c.max} or less.`;
  if (c.validity.badInput) return `${label}: enter a number.`;
  if (c.validity.tooLong) return `${label} is too long.`;
  return c.validationMessage || `${label}: check this field.`;
}
// Attach to a form: check() finds every empty required field (and bad emails, numbers) in form order;
// show(errors) marks each field (aria-invalid, a message under it), fills the summary and focuses the
// first; server(err) puts a server message at the field it names. Typing in a field clears its error.
export function formErrors(form, summary = form.querySelector('.form-error')) {
  const clearOne = (c) => {
    c.removeAttribute('aria-invalid');
    const id = c.dataset.errId;
    if (id) {
      form.querySelector(`#${id}`)?.remove();
      c.setAttribute('aria-describedby', (c.getAttribute('aria-describedby') || '').split(' ').filter((x) => x && x !== id).join(' '));
      if (!c.getAttribute('aria-describedby')) c.removeAttribute('aria-describedby');
      delete c.dataset.errId;
    }
  };
  const clear = () => {
    controlsOf(form).forEach(clearOne);
    if (summary) {
      summary.hidden = true;
      summary.textContent = '';
    }
  };
  const live = (c) => c.offsetParent !== null && !c.disabled && !c.closest('[hidden]');
  const check = () => controlsOf(form).filter((c) => live(c) && c.willValidate && !c.validity.valid && !(c.type === 'radio' && form.querySelector(`[name="${c.name}"]:checked`)))
    .filter((c, i, all) => c.type !== 'radio' || all.findIndex((x) => x.name === c.name) === i)
    .map((c) => {
      const label = labelOf(c);
      return { el: c, name: c.name || c.id, label, message: messageFor(c, label) };
    });
  const show = (errors, { message } = {}) => {
    clear();
    for (const e of errors) {
      const c = e.el || form.querySelector(`[name="${CSS.escape(e.name)}"]`);
      if (!c) continue;
      e.el = c;
      c.setAttribute('aria-invalid', 'true');
      const note = document.createElement('small');
      note.className = 'field-error';
      note.id = `err-${Math.random().toString(36).slice(2, 9)}`;
      note.textContent = e.message;
      const box = c.closest('.field, label') || c;
      if (box === c || box.contains(c)) (box === c ? c : box).insertAdjacentElement(box === c ? 'afterend' : 'beforeend', note);
      c.dataset.errId = note.id;
      c.setAttribute('aria-describedby', [c.getAttribute('aria-describedby'), note.id].filter(Boolean).join(' '));
      c.addEventListener('input', () => clearOne(c), { once: true });
      c.addEventListener('change', () => clearOne(c), { once: true });
    }
    if (summary) {
      summary.textContent = message || errorSummary(errors);
      summary.hidden = false;
    }
    const first = errors.find((e) => e.el)?.el;
    if (first) {
      first.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      first.focus({ preventScroll: true });
    } else summary?.scrollIntoView({ block: 'center' });
    return errors.length;
  };
  // A server error: at the field it names when there is one; always in the summary, readable.
  const server = (err) => {
    const fields = controlsOf(form).filter(live).map((c) => ({ name: c.name || c.id, label: labelOf(c) }));
    if (!err?.message && !(typeof err === 'string' && err)) return clear();
    const message = readableMessage(err?.message || String(err), fields);
    const name = fieldForMessage(err?.message || '', fields);
    const c = name && form.querySelector(`[name="${CSS.escape(name)}"], #${CSS.escape(name)}`);
    show(c ? [{ el: c, name, label: labelOf(c), message }] : [], { message });
  };
  const validate = () => {
    const errors = check();
    if (errors.length) show(errors);
    else clear();
    return !errors.length;
  };
  return { check, show, server, clear, validate };
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

// The big clock: "1:23:37" with a smaller "AM", so it stays on one line on a phone.
export function showClock(el, now = new Date()) {
  const [time, ...rest] = now.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit' }).split(/\s+/);
  const ampm = Object.assign(document.createElement('span'), { className: 'ampm', textContent: rest.join(' ') });
  el.replaceChildren(document.createTextNode(time), ...(rest.length ? [ampm] : []));
}

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
// subtitle: a line under the title; submitLabel null = a read-only window with only a close button.
// onClose: called once the dialog is closed (by Save, Cancel or Escape).
export function modal({ title, subtitle = '', body, submitLabel = 'Save', cancelLabel = 'Cancel', onSubmit, onClose, wide = false, className = '' }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = render(html`
    <form class="modal ${wide ? 'wide' : ''} ${className}" novalidate role="dialog" aria-modal="true" aria-label="${title}">
      <header><div class="modal-title"><h2>${title}</h2>${subtitle ? html`<p>${subtitle}</p>` : ''}</div><button type="button" class="icon-btn" data-close aria-label="Close">×</button></header>
      <div class="modal-body"><p class="form-error" role="alert" hidden></p>${body}</div>
      <footer>
        <button type="button" class="btn" data-close>${submitLabel === null && cancelLabel === 'Cancel' ? 'Close' : cancelLabel}</button>
        ${submitLabel === null ? '' : html`<button type="submit" class="btn primary">${submitLabel}</button>`}
      </footer>
    </form>`);
  document.body.appendChild(backdrop);
  labelTables(backdrop);
  enhance(backdrop);
  const form = backdrop.querySelector('form');
  const errorEl = backdrop.querySelector('.form-error');
  const errors = formErrors(form, errorEl);
  // Keyboard: Escape closes the top dialog wherever focus is, Tab stays inside it, and focus
  // goes back to the button that opened it.
  const opener = document.activeElement;
  form.tabIndex = -1; // a click on the dialog's text keeps focus in the dialog
  const focusable = () => [...form.querySelectorAll('a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])')].filter((x) => x.offsetParent !== null);
  const onKey = (e) => {
    if (!backdrop.isConnected) return document.removeEventListener('keydown', onKey); // closed by navigation
    if ([...document.querySelectorAll('.modal-backdrop')].pop() !== backdrop) return; // a dialog on top of this one
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = form.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first || document.activeElement === form)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey);
  const close = () => {
    if (!backdrop.isConnected) return;
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    // Back to the opener: on the page, or in the dialog underneath (a confirm opened from a form).
    const top = [...document.querySelectorAll('.modal-backdrop')].pop();
    if (opener?.isConnected && opener !== document.body && (!top || top.contains(opener)) && !opener.disabled) opener.focus();
    onClose?.();
  };
  backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    if (!btn) return;
    // Every empty required field is marked at once, and the first one is focused.
    if (!errors.validate()) return;
    btn.disabled = true;
    try {
      await onSubmit(form);
      close();
    } catch (err) {
      errors.server(err);
    } finally {
      btn.disabled = false;
    }
    // Refused (or a confirm on top was closed): focus back in this dialog, on Save.
    if (backdrop.isConnected && [...document.querySelectorAll('.modal-backdrop')].pop() === backdrop && !form.contains(document.activeElement)) btn.focus();
  });
  (form.querySelector('input:not([type=hidden]), select, textarea') || form.querySelector('[data-close]'))?.focus();
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
  // A byte-order mark, so Excel opens accented names (Peñaflor) and ₱ correctly.
  const url = URL.createObjectURL(new Blob([type.startsWith('text/csv') ? '\uFEFF' : '', content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Cells that a spreadsheet would run as a formula (=, +, -, @, tab, return) get a leading ' so
// they open as text. Plain negative numbers are left alone.
export function toCsv(rows) {
  const cell = (c) => {
    let t = String(c ?? '');
    // Phone numbers (+63 917 …) and amounts (-1,234.50) are safe and stay as typed.
    if (/^[=+\-@\t\r]/.test(t) && !/^[+-]?[\d\s().,-]+$/.test(t)) t = `'${t}`;
    return `"${t.replace(/"/g, '""')}"`;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\n');
}

export const badge = (text, kind = '') => html`<span class="badge ${kind}">${text}</span>`;
