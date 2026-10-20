// Feedback: any user sends feedback and follows the replies; administrators read
// everything in the Feedback inbox, set a status and reply.
import { api } from '../api.js';
import { ctx, can } from '../state.js';
import { FEEDBACK_TYPES, FEEDBACK_AREAS, FEEDBACK_STATUS, OPEN_FEEDBACK } from '/shared/feedback.js';
import { html, mount, fmtDate, badge, toast, confirmDialog, downloadFile, toCsv, today } from '../ui.js';

const STATUS_KIND = { new: 'amber', reviewing: 'blue', planned: 'blue', resolved: 'green', closed: 'gray' };
const TYPE_KIND = { bug: 'maroon-soft', idea: 'blue', question: 'gray', praise: 'green', other: 'gray' };
export const feedbackStatus = (s) => badge(FEEDBACK_STATUS[s] || s, STATUS_KIND[s]);
const typeBadge = (t) => badge(FEEDBACK_TYPES[t] || t, TYPE_KIND[t]);
const when = (iso) => new Date(iso).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const changed = () => window.dispatchEvent(new Event('feedback:changed'));

// Sent, then each status change or reply, oldest first.
const timeline = (f, { staff = false } = {}) => html`<ul class="timeline">
  <li class="ev-issue"><time>${when(f.createdAt)}</time><div><strong>Sent</strong><span>by ${staff ? `${f.userName} (${f.roleLabel})` : 'you'}</span></div></li>
  ${f.updates.map((u) => html`<li class="ev-${u.status === 'resolved' ? 'resolved' : u.status ? 'in_progress' : 'note'}"><time>${when(u.at)}</time>
    <div><strong>${u.status ? `Marked ${FEEDBACK_STATUS[u.status].toLowerCase()}` : 'Reply'}</strong><span>by ${staff ? u.by : 'Administrator'}</span>${u.note ? html`<em>“${u.note}”</em>` : ''}</div></li>`)}
</ul>`;

// ---------- Everyone: send feedback, see your own ----------

export async function feedbackView(el) {
  const area = ctx.module === 'assets' ? 'assets' : ctx.module === 'hr' ? 'hr' : 'general';

  async function render() {
    const mine = await api.get('/api/me/feedback');
    mount(el, html`
      <header class="page-head">
        <div><h1>Feedback</h1><p class="muted">Report a problem, suggest an improvement or ask a question. Feedback goes to the system administrators, and their replies appear here.</p></div>
        ${can('feedback.view') ? html`<div class="actions"><a class="btn" href="#/feedback/inbox">Open the feedback inbox</a></div>` : ''}
      </header>
      <div class="cols wide-left">
        <section class="card">
          <h2>Send feedback</h2>
          <form id="send" class="grid two" novalidate>
            <div class="field span-2"><span>What kind of feedback?</span>
              <div class="seg wrap">${Object.entries(FEEDBACK_TYPES).map(([k, v], i) => html`<label><input type="radio" name="type" value="${k}" ${i === 0 ? 'checked' : ''} /> ${v}</label>`)}</div></div>
            <label class="field"><span>Which part of the system?</span>
              <select name="area">${Object.entries(FEEDBACK_AREAS).map(([k, v]) => html`<option value="${k}" ${k === area ? 'selected' : ''}>${v}</option>`)}</select></label>
            <label class="field"><span>Subject</span><input name="subject" maxlength="120" required placeholder="e.g. Payslip PDF shows the wrong month" /></label>
            <label class="field span-2"><span>Details</span>
              <textarea name="message" rows="6" maxlength="4000" required placeholder="What happened or what you'd like, and where. For a problem: what you did, what you expected and what you saw instead."></textarea></label>
            <p class="form-error span-2" hidden></p>
            <div class="actions span-2"><button class="btn primary" type="submit">Send feedback</button><small class="muted">Sent as ${ctx.user.name}.</small></div>
          </form>
        </section>
        <section class="card">
          <h2>Your feedback</h2>
          ${mine.length
            ? html`<div class="fb-mine">${mine.map((f) => html`<details class="fb-item" ${f.updates.length ? 'open' : ''}>
                <summary><span class="mono small">${f.number}</span> <strong>${f.subject}</strong>
                  <small class="muted">${feedbackStatus(f.status)} ${typeBadge(f.type)} ${FEEDBACK_AREAS[f.area]} · ${fmtDate(f.createdAt.slice(0, 10))}</small></summary>
                <p class="report-text">${f.message}</p>
                ${timeline(f)}
              </details>`)}</div>`
            : html`<p class="muted">You haven't sent any feedback yet.</p>`}
        </section>
      </div>`);

    el.querySelector('#send').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = e.target.querySelector('.form-error');
      const btn = e.target.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const f = await api.post('/api/feedback', Object.fromEntries(new FormData(e.target)));
        toast(`Thank you. Feedback ${f.number} was sent to the administrators.`);
        changed();
        render();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
        btn.disabled = false;
      }
    });
  }
  await render();
}

// ---------- Administrators: inbox ----------

const FILTERS = { open: 'Open (new, under review, planned)', new: 'New', reviewing: 'Under review', planned: 'Planned', resolved: 'Resolved', closed: 'Closed', all: 'All feedback' };

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
    mount(el.querySelector('#list'), list.length
      ? html`<table class="table clickable">
          <thead><tr><th>No.</th><th>Received</th><th>From</th><th>Type</th><th>Subject</th><th>Area</th><th>Status</th></tr></thead>
          <tbody>${list.map((f) => html`<tr data-id="${f.id}" class="${f.status === 'new' ? 'unread' : ''}">
            <td><a class="mono" href="#/feedback/inbox/${f.id}">${f.number}</a></td>
            <td>${fmtDate(f.createdAt.slice(0, 10))}</td>
            <td>${f.userName}<small>${f.roleLabel}</small></td>
            <td>${typeBadge(f.type)}</td>
            <td><strong>${f.subject}</strong><small class="clip">${f.message}</small></td>
            <td>${FEEDBACK_AREAS[f.area]}</td>
            <td>${feedbackStatus(f.status)}</td></tr>`)}</tbody>
        </table>`
      : html`<div class="empty"><p>${all.length ? 'No feedback matches.' : 'No feedback yet. Users send it from the Feedback page in the menu.'}</p></div>`);
    el.querySelectorAll('#list tbody tr').forEach((tr) => tr.addEventListener('click', (e) => {
      if (!e.target.closest('a')) location.hash = `#/feedback/inbox/${tr.dataset.id}`;
    }));
  }

  mount(el, html`
    <header class="page-head">
      <div><h1>Feedback inbox</h1><p class="muted">Feedback from all users: ${count('new')} new, ${count('reviewing')} under review, ${count('planned')} planned. Only administrators see this page.</p></div>
      <div class="actions"><a class="btn" href="#/feedback">Send feedback</a><button class="btn" id="export">Export CSV</button></div>
    </header>
    <section class="card scroll-x">
      <div class="toolbar pad">
        <input type="search" id="q" placeholder="Search number, subject, text or name…" />
        <select id="f-status">${Object.entries(FILTERS).map(([k, v]) => html`<option value="${k}" ${k === state.status ? 'selected' : ''}>${v}</option>`)}</select>
        <select id="f-type"><option value="">All types</option>${Object.entries(FEEDBACK_TYPES).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select>
        <select id="f-area"><option value="">All areas</option>${Object.entries(FEEDBACK_AREAS).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select>
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
      ['No', 'Received', 'From', 'Username', 'Account type', 'Type', 'Area', 'Subject', 'Message', 'Status', 'Last update', 'Latest reply'],
      ...rows().map((f) => [f.number, f.createdAt.replace('T', ' ').slice(0, 16), f.userName, f.username, f.roleLabel, FEEDBACK_TYPES[f.type], FEEDBACK_AREAS[f.area],
        f.subject, f.message, FEEDBACK_STATUS[f.status], f.updatedAt.replace('T', ' ').slice(0, 16), [...f.updates].reverse().find((u) => u.note)?.note || '']),
    ])),
  );
}

// ---------- Administrators: one item ----------

export async function feedbackDetailView(el, { id }) {
  const f = await api.get(`/api/feedback/${id}`);
  const manage = can('feedback.manage');
  const info = (label, value) => html`<div class="info"><dt>${label}</dt><dd>${value}</dd></div>`;

  mount(el, html`
    <header class="page-head">
      <div><a class="back" href="#/feedback/inbox">← Feedback inbox</a>
        <p class="tag-line mono">${f.number}</p>
        <h1>${f.subject} ${feedbackStatus(f.status)}</h1>
        <p class="muted">Sent ${when(f.createdAt)} by ${f.userName}</p></div>
      ${manage ? html`<div class="actions"><button class="btn danger ghost" id="delete">Delete</button></div>` : ''}
    </header>
    <div class="cols wide-left">
      <section class="card">
        <h2>Feedback</h2>
        <p class="report-text">${f.message}</p>
        <dl class="info-grid">${info('Type', typeBadge(f.type))}${info('Area', FEEDBACK_AREAS[f.area])}${info('Status', feedbackStatus(f.status))}</dl>
      </section>
      <section class="card">
        <h2>Sent by</h2>
        <p class="holder-name">${f.userName}</p>
        <p class="muted">${f.roleLabel} · ${f.username}</p>
      </section>
    </div>
    ${manage
      ? html`<section class="card">
          <h2>Reply to ${f.userName.split(' ')[0]}</h2>
          <form id="update" class="grid two" novalidate>
            <label class="field"><span>Status</span><select name="status">${Object.entries(FEEDBACK_STATUS).map(([k, v]) => html`<option value="${k}" ${k === f.status ? 'selected' : ''}>${v}</option>`)}</select></label>
            <label class="field span-2"><span>Reply (they see this on their Feedback page)</span>
              <textarea name="note" rows="3" maxlength="2000" placeholder="e.g. Thanks, this is fixed in the next update."></textarea></label>
            <p class="form-error span-2" hidden></p>
            <div class="actions span-2"><button class="btn primary" type="submit">Save</button></div>
          </form>
        </section>`
      : ''}
    <section class="card"><h2>Timeline</h2>${timeline(f, { staff: true })}</section>`);

  // Opening a new item counts as reviewing it.
  if (manage && f.status === 'new') el.querySelector('[name=status]').value = 'reviewing';
  el.querySelector('#update')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = e.target.querySelector('.form-error');
    try {
      await api.post(`/api/feedback/${f.id}/update`, Object.fromEntries(new FormData(e.target)));
      toast('Saved.');
      changed();
      feedbackDetailView(el, { id });
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });
  el.querySelector('#delete')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Delete feedback ${f.number} (“${f.subject}”)? ${f.userName} will no longer see it either.`))) return;
    await api.del(`/api/feedback/${f.id}`);
    toast('Feedback deleted.');
    changed();
    location.hash = '#/feedback/inbox';
  });
}
