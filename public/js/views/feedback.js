// Feedback: any user sends feedback and follows the replies; administrators read
// everything in the Feedback inbox, set a status and reply.
import { api } from '../api.js';
import { ctx, can } from '../state.js';
import { FEEDBACK_TYPES, FEEDBACK_AREAS, FEEDBACK_STATUS, OPEN_FEEDBACK } from '/shared/feedback.js';
import { html, mount, fmtDate, badge, toast, modal, confirmDialog, downloadFile, toCsv, today } from '../ui.js';

const STATUS_KIND = { new: 'amber', reviewing: 'blue', planned: 'blue', resolved: 'green', closed: 'gray' };
const TYPE_KIND = { bug: 'maroon-soft', idea: 'blue', question: 'gray', praise: 'green', other: 'gray' };
const TYPE_HINT = {
  bug: 'Something does not work as expected',
  idea: 'An improvement or a new feature',
  question: 'How to do something in the system',
  praise: 'Something that works well',
  other: 'Anything else',
};
export const feedbackStatus = (s) => badge(FEEDBACK_STATUS[s] || s, STATUS_KIND[s]);
const typeBadge = (t) => badge(FEEDBACK_TYPES[t] || t, TYPE_KIND[t]);
const when = (iso) => new Date(iso).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const changed = () => window.dispatchEvent(new Event('feedback:changed'));
const responses = (f) => f.updates.filter((u) => u.note).length;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Submitted, then each status change or response, oldest first.
const historyList = (f, { staff = false } = {}) => html`<ol class="fb-history">
  <li class="ev-sent"><div class="fb-ev-head"><strong>Submitted</strong><time>${when(f.createdAt)}</time></div>
    <span>${staff ? `${f.userName}, ${f.roleLabel}` : 'By you'}</span></li>
  ${f.updates.map((u) => html`<li class="ev-${u.status || 'note'}">
    <div class="fb-ev-head"><strong>${u.status ? `Status changed to ${FEEDBACK_STATUS[u.status]}` : 'Response'}</strong><time>${when(u.at)}</time></div>
    <span>${staff ? u.by : 'System administrator'}</span>
    ${u.note ? html`<blockquote>${u.note}</blockquote>` : ''}</li>`)}
</ol>`;

const metaList = (rows) => html`<dl class="fb-meta">${rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;

// One item in a list: number and date, subject, then status and type.
const row = (f, { staff = false } = {}) => html`<button type="button" class="fb-row ${f.status === 'new' && staff ? 'unread' : ''}" data-open-feedback="${f.id}">
  <span class="fb-row-top"><span class="mono">${f.number}</span><time>${fmtDate(f.createdAt.slice(0, 10))}</time></span>
  <strong class="fb-row-subject">${f.subject}</strong>
  ${staff ? html`<span class="fb-row-from">${f.userName} · ${f.roleLabel}</span>` : html`<span class="fb-row-excerpt">${f.message}</span>`}
  <span class="fb-row-tags">${feedbackStatus(f.status)}${typeBadge(f.type)}<small>${FEEDBACK_AREAS[f.area]}${responses(f) ? ` · ${plural(responses(f), 'response')}` : ''}</small></span>
</button>`;

// ---------- Everyone: send feedback, see your own ----------

function openNewFeedback(onSent) {
  const area = ctx.module === 'assets' ? 'assets' : ctx.module === 'hr' ? 'hr' : 'general';
  const { form } = modal({
    title: 'New feedback',
    subtitle: `Submitted to the system administrators as ${ctx.user.name}`,
    submitLabel: 'Submit feedback',
    className: 'fb-modal',
    body: html`<fieldset class="field fb-types"><legend>Type of feedback</legend>
        <div class="fb-type-grid">${Object.entries(FEEDBACK_TYPES).map(([k, v], i) => html`<label class="fb-type">
          <input type="radio" name="type" value="${k}" ${i === 0 ? 'checked' : ''} /><span><strong>${v}</strong><small>${TYPE_HINT[k]}</small></span></label>`)}</div>
      </fieldset>
      <label class="field"><span>Module</span>
        <select name="area">${Object.entries(FEEDBACK_AREAS).map(([k, v]) => html`<option value="${k}" ${k === area ? 'selected' : ''}>${v}</option>`)}</select></label>
      <label class="field"><span>Subject</span><input name="subject" maxlength="120" required placeholder="e.g. Payslip shows the wrong pay period" /></label>
      <label class="field"><span class="field-row">Details <small class="muted" data-count>0 / 4000</small></span>
        <textarea name="message" rows="5" maxlength="4000" required placeholder="Describe the issue or request. For a problem, include the steps taken, the expected result and the actual result."></textarea></label>
      <p class="muted small fb-privacy">Only system administrators can read feedback. Responses appear under Feedback in your menu.</p>`,
    onSubmit: async (f) => {
      const sent = await api.post('/api/feedback', Object.fromEntries(new FormData(f)));
      toast(`Feedback ${sent.number} submitted. Thank you.`);
      changed();
      onSent();
    },
  });
  const msg = form.querySelector('[name=message]');
  msg.addEventListener('input', () => (form.querySelector('[data-count]').textContent = `${msg.value.length} / 4000`));
}

function openOwnFeedback(f) {
  modal({
    title: f.subject,
    subtitle: `${f.number} · Submitted ${when(f.createdAt)}`,
    submitLabel: null,
    className: 'fb-modal',
    body: html`${metaList([['Status', feedbackStatus(f.status)], ['Type', typeBadge(f.type)], ['Module', FEEDBACK_AREAS[f.area]]])}
      <section class="fb-section"><h3>Message</h3><p class="fb-message">${f.message}</p></section>
      <section class="fb-section"><h3>History</h3>${historyList(f)}</section>`,
  });
}

export async function feedbackView(el) {
  async function render() {
    const mine = await api.get('/api/me/feedback');
    const open = mine.filter((f) => OPEN_FEEDBACK.includes(f.status)).length;
    mount(el, html`<div class="fb-page">
      <header class="page-head">
        <div><h1>Feedback</h1><p class="muted">Report a problem, suggest an improvement or ask a question. Feedback is reviewed by the system administrators.</p></div>
        <div class="actions">
          ${can('feedback.view') ? html`<a class="btn" href="#/feedback/inbox">Feedback inbox</a>` : ''}
          <button class="btn primary" id="new-feedback">+ New feedback</button></div>
      </header>
      <section class="card fb-card">
        <div class="card-head"><h2>Your submissions</h2><span class="muted small">${mine.length ? `${plural(mine.length, 'item')} · ${open} open` : ''}</span></div>
        ${mine.length
          ? html`<div class="fb-list">${mine.map((f) => row(f))}</div>`
          : html`<div class="empty"><p>You have not submitted any feedback yet.</p><button class="btn primary" data-new-feedback>+ New feedback</button></div>`}
      </section>
    </div>`);
    const root = el.querySelector('.fb-page');
    root.addEventListener('click', (e) => {
      if (e.target.closest('#new-feedback, [data-new-feedback]')) return openNewFeedback(render);
      const id = e.target.closest('[data-open-feedback]')?.dataset.openFeedback;
      if (id) openOwnFeedback(mine.find((f) => f.id === id));
    });
  }
  await render();
}

// ---------- Administrators: inbox ----------

const FILTERS = { open: 'Open', new: 'New', reviewing: 'Under review', planned: 'Planned', resolved: 'Resolved', closed: 'Closed', all: 'All statuses' };

export async function feedbackInboxView(el, _params, query) {
  const all = await api.get('/api/feedback');
  const state = { status: FILTERS[query.status] ? query.status : 'open', type: '', area: '', q: '' };
  const count = (s) => all.filter((f) => f.status === s).length;

  const rows = () => {
    const q = state.q.trim().toLowerCase();
    return all.filter((f) =>
      (state.status === 'all' || (state.status === 'open' ? OPEN_FEEDBACK.includes(f.status) : f.status === state.status)) &&
      (!state.type || f.type === state.type) && (!state.area || f.area === state.area) &&
      (!q || [f.number, f.subject, f.message, f.userName, f.username].join(' ').toLowerCase().includes(q)));
  };

  function render() {
    const list = rows();
    mount(el.querySelector('#shown'), `${plural(list.length, 'item')}`);
    // A table on wide screens, a list of cards on phones.
    mount(el.querySelector('#list'), list.length
      ? html`<table class="table clickable no-stack fb-table">
          <thead><tr><th>No.</th><th>Received</th><th>From</th><th>Type</th><th>Subject</th><th>Module</th><th>Status</th></tr></thead>
          <tbody>${list.map((f) => html`<tr data-id="${f.id}" class="${f.status === 'new' ? 'unread' : ''}">
            <td><a class="mono" href="#/feedback/inbox/${f.id}">${f.number}</a></td>
            <td>${fmtDate(f.createdAt.slice(0, 10))}</td>
            <td>${f.userName}<small>${f.roleLabel}</small></td>
            <td>${typeBadge(f.type)}</td>
            <td><strong>${f.subject}</strong><small class="clip">${f.message}</small></td>
            <td>${FEEDBACK_AREAS[f.area]}</td>
            <td>${feedbackStatus(f.status)}</td></tr>`)}</tbody>
        </table>
        <div class="fb-list fb-cards">${list.map((f) => row(f, { staff: true }))}</div>`
      : html`<div class="empty"><p>${all.length ? 'No feedback matches the current filters.' : 'No feedback has been submitted yet.'}</p></div>`);
    el.querySelectorAll('#list tbody tr').forEach((tr) => tr.addEventListener('click', (e) => {
      if (!e.target.closest('a')) location.hash = `#/feedback/inbox/${tr.dataset.id}`;
    }));
    el.querySelectorAll('#list [data-open-feedback]').forEach((b) => b.addEventListener('click', () => (location.hash = `#/feedback/inbox/${b.dataset.openFeedback}`)));
  }

  mount(el, html`
    <header class="page-head">
      <div><h1>Feedback inbox</h1><p class="muted">${count('new')} new · ${count('reviewing')} under review · ${count('planned')} planned. Visible to administrators only.</p></div>
      <div class="actions"><button class="btn" id="export">Export CSV</button></div>
    </header>
    <section class="card scroll-x">
      <div class="toolbar pad fb-filters">
        <input type="search" id="q" placeholder="Search number, subject, message or name…" />
        <select id="f-status" aria-label="Status">${Object.entries(FILTERS).map(([k, v]) => html`<option value="${k}" ${k === state.status ? 'selected' : ''}>${v}</option>`)}</select>
        <select id="f-type" aria-label="Type"><option value="">All types</option>${Object.entries(FEEDBACK_TYPES).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select>
        <select id="f-area" aria-label="Module"><option value="">All modules</option>${Object.entries(FEEDBACK_AREAS).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select>
        <small class="muted" id="shown"></small>
      </div>
      <div id="list"></div>
    </section>`);
  render();
  el.querySelector('#q').addEventListener('input', (e) => ((state.q = e.target.value), render()));
  el.querySelector('#f-status').addEventListener('change', (e) => ((state.status = e.target.value), render()));
  el.querySelector('#f-type').addEventListener('change', (e) => ((state.type = e.target.value), render()));
  el.querySelector('#f-area').addEventListener('change', (e) => ((state.area = e.target.value), render()));
  el.querySelector('#export').addEventListener('click', () =>
    downloadFile(`feedback-${today()}.csv`, toCsv([
      ['No', 'Received', 'From', 'Username', 'Account type', 'Type', 'Module', 'Subject', 'Message', 'Status', 'Last update', 'Latest response'],
      ...rows().map((f) => [f.number, f.createdAt.replace('T', ' ').slice(0, 16), f.userName, f.username, f.roleLabel, FEEDBACK_TYPES[f.type], FEEDBACK_AREAS[f.area],
        f.subject, f.message, FEEDBACK_STATUS[f.status], f.updatedAt.replace('T', ' ').slice(0, 16), [...f.updates].reverse().find((u) => u.note)?.note || '']),
    ])),
  );
}

// ---------- Administrators: one item ----------

function openRespond(f, onSaved) {
  const first = f.userName.split(' ')[0];
  const { form } = modal({
    title: 'Respond to feedback',
    subtitle: `${f.number} · ${f.subject}`,
    submitLabel: 'Save response',
    className: 'fb-modal',
    body: html`<label class="field"><span>Status</span>
        <select name="status">${Object.entries(FEEDBACK_STATUS).map(([k, v]) => html`<option value="${k}" ${k === (f.status === 'new' ? 'reviewing' : f.status) ? 'selected' : ''}>${v}</option>`)}</select></label>
      <label class="field"><span class="field-row">Response <small class="muted">optional</small></span>
        <textarea name="note" rows="5" maxlength="2000" placeholder="e.g. Thank you. This has been corrected and will be available in the next update."></textarea>
        <small class="muted">Visible to ${first} under Feedback, together with the status.</small></label>`,
    onSubmit: async (fm) => {
      await api.post(`/api/feedback/${f.id}/update`, Object.fromEntries(new FormData(fm)));
      toast('Response saved.');
      changed();
      onSaved();
    },
  });
  form.querySelector('textarea').focus();
}

export async function feedbackDetailView(el, { id }) {
  const f = await api.get(`/api/feedback/${id}`);
  const manage = can('feedback.manage');

  mount(el, html`<div class="fb-page">
    <header class="page-head">
      <div><a class="back" href="#/feedback/inbox">← Feedback inbox</a>
        <p class="tag-line mono">${f.number}</p>
        <h1>${f.subject}</h1>
        <p class="muted fb-sub">${feedbackStatus(f.status)}<span>Submitted ${when(f.createdAt)} by ${f.userName}</span></p></div>
      ${manage ? html`<div class="actions"><button class="btn danger ghost" id="delete">Delete</button><button class="btn primary" id="respond">Respond</button></div>` : ''}
    </header>
    <div class="cols wide-left">
      <section class="card">
        <h2>Message</h2>
        <p class="fb-message">${f.message}</p>
      </section>
      <section class="card">
        <h2>Details</h2>
        ${metaList([['Status', feedbackStatus(f.status)], ['Type', typeBadge(f.type)], ['Module', FEEDBACK_AREAS[f.area]],
          ['Submitted by', html`${f.userName}<small>${f.roleLabel} · ${f.username}</small>`], ['Submitted on', when(f.createdAt)], ['Last updated', when(f.updatedAt)]])}
      </section>
    </div>
    <section class="card"><h2>History</h2>${historyList(f, { staff: true })}</section>
  </div>`);

  const reload = () => feedbackDetailView(el, { id });
  el.querySelector('#respond')?.addEventListener('click', () => openRespond(f, reload));
  el.querySelector('#delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog(`${f.number} (“${f.subject}”) will be permanently deleted, and ${f.userName} will no longer see it under Feedback. This cannot be undone.`, { title: 'Delete feedback', confirmLabel: 'Delete feedback' });
    if (!ok) return;
    await api.del(`/api/feedback/${f.id}`);
    toast('Feedback deleted.');
    changed();
    location.hash = '#/feedback/inbox';
  });
}
