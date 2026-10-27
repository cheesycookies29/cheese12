// IT Service Desk: the agents' queue and ticket workspace, the portal where every user
// opens and follows their own tickets, and the settings (receiving address, mailbox,
// outgoing mail, categories, SLA targets, saved replies).
import { api } from '../api.js';
import { ctx, can } from '../state.js';
import { TICKET_STATUS, TICKET_PRIORITY, TICKET_CHANNEL, UNRESOLVED_TICKET } from '/shared/helpdesk.js';
import { html, mount, badge, toast, modal, confirmDialog } from '../ui.js';
import { ACCEPT, prepareUpload, viewAttachment } from '../attachments.js';

const STATUS_KIND = { new: 'amber', open: 'blue', pending: 'gray', on_hold: 'gray', resolved: 'green', closed: 'gray' };
const PRIORITY_KIND = { low: 'gray', normal: 'blue', high: 'amber', urgent: 'maroon-soft' };
export const statusBadge = (s) => badge(TICKET_STATUS[s] || s, STATUS_KIND[s]);
const priorityBadge = (p) => badge(TICKET_PRIORITY[p] || p, PRIORITY_KIND[p]);
const changed = () => window.dispatchEvent(new Event('helpdesk:changed'));
const when = (iso) => new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// "in 3 h", "2 h ago" for SLA due times.
function relative(iso) {
  const mins = Math.round((new Date(iso) - Date.now()) / 60000);
  const abs = Math.abs(mins);
  const txt = abs < 60 ? `${abs} min` : abs < 2880 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} days`;
  return mins >= 0 ? `in ${txt}` : `${txt} ago`;
}
const slaCell = (t) => {
  if (!UNRESOLVED_TICKET.includes(t.status) || t.status === 'pending') return html`<span class="muted small">—</span>`;
  const due = t.firstResponseAt ? t.resolutionDue : t.firstResponseDue;
  const what = t.firstResponseAt ? 'Resolve' : 'Respond';
  return html`<span class="sla sla-${t.sla || 'ok'}" title="${what} by ${when(due)}">${what} ${relative(due)}</span>`;
};

async function filesFrom(input) {
  return Promise.all([...(input?.files || [])].slice(0, 5).map(prepareUpload));
}
const fileList = (t, m) => (m.attachments?.length
  ? html`<div class="hd-files">${m.attachments.map((a) => html`<button type="button" class="link" data-file="/api/helpdesk/files/${t.id}/${a.id}">📎 ${a.name}</button>`)}</div>`
  : '');

// The conversation, oldest first. Notes are amber; history lines are small.
function thread(t, { agentView }) {
  return html`<ol class="hd-thread">${t.messages.map((m) => m.kind === 'event'
    ? html`<li class="hd-event"><span>${m.body}</span><time>${when(m.at)}${agentView && m.author.role === 'agent' ? ` · ${m.author.name}` : ''}</time></li>`
    : html`<li class="hd-msg ${m.kind === 'note' ? 'note' : m.author.role === 'agent' ? 'agent' : 'requester'}">
        <header><strong>${m.author.name}</strong>
          <span>${m.kind === 'note' ? 'Internal note' : m.author.role === 'agent' ? 'IT Service Desk' : 'Requester'}${m.via === 'email' ? ' · by email' : ''}</span>
          <time>${when(m.at)}</time></header>
        <div class="hd-body">${m.body}</div>
        ${fileList(t, m)}
        ${agentView && m.email ? html`<p class="hd-delivery ${m.email.status}">${m.email.status === 'sent' ? `Emailed to ${t.requester.email}` : m.email.status === 'failed' ? `Email not sent: ${m.email.reason}` : `Not emailed: ${m.email.reason}`}</p>` : ''}
      </li>`)}</ol>`;
}
function onFileClick(root) {
  root.addEventListener('click', (e) => {
    const f = e.target.closest('[data-file]');
    if (f) viewAttachment(f.dataset.file, 'Attachment').catch((err) => toast(err.message, 'error'));
  });
}

// ---------- Agents: overview ----------

export async function helpdeskHomeView(el) {
  const [sum, open, settings] = await Promise.all([
    api.get('/api/helpdesk/summary'),
    api.get('/api/helpdesk/tickets?view=open'),
    can('helpdesk.manage') ? api.get('/api/helpdesk/settings') : null,
  ]);
  const attention = open.filter((t) => t.sla === 'breached' || t.awaitingAgent).slice(0, 8);
  const mine = open.filter((t) => t.assignee?.id === ctx.user.id).slice(0, 8);
  const tile = (label, n, view, kind = '') => html`<a class="hd-tile ${kind}" href="#/helpdesk/tickets?view=${view}"><small>${label}</small><strong>${n}</strong></a>`;
  const list = (rows, empty) => (rows.length
    ? html`<ul class="hd-mini">${rows.map((t) => html`<li><a href="#/helpdesk/tickets/${t.id}"><span class="mono">${t.ref}</span> ${t.subject}</a>
        <small>${t.requester.name} · ${priorityBadge(t.priority)} ${slaCell(t)}</small></li>`)}</ul>`
    : html`<p class="muted">${empty}</p>`);
  const box = settings?.mailbox;
  const state = settings?.mailState;
  mount(el, html`
    <header class="page-head">
      <div><h1>IT Service Desk</h1><p class="muted">Tickets from the portal${box?.enabled ? ` and from ${box.address}` : ''}. Overdue first, then by priority.</p></div>
      <div class="actions"><a class="btn" href="#/helpdesk/tickets">All open tickets</a><a class="btn primary" href="#/helpdesk/new">+ Log a ticket</a></div>
    </header>
    ${settings ? html`<section class="card hd-mailbar ${box.enabled ? (state.lastError ? 'err' : 'ok') : 'off'}">
        <div><strong>${box.enabled ? `Receiving email at ${box.address}` : 'Email is not set up'}</strong>
          <span class="muted small">${box.enabled ? (state.lastError ? `Last check failed: ${state.lastError}` : state.lastOkAt ? `Last checked ${when(state.lastOkAt)} · ${plural(state.totalImported, 'email')} imported so far` : 'Not checked yet') : 'Set the address the helpdesk receives at, so users can email their problems.'}</span></div>
        <a class="btn small-btn" href="#/helpdesk/settings">${box.enabled ? 'Mail settings' : 'Set up email'}</a>
      </section>` : ''}
    <div class="hd-tiles">
      ${tile('Awaiting reply', sum.awaiting, 'open', sum.awaiting ? 'warn' : '')}
      ${tile('Unassigned', sum.unassigned, 'unassigned')}
      ${tile('Assigned to me', sum.mine, 'mine')}
      ${tile('Overdue', sum.overdue, 'overdue', sum.overdue ? 'bad' : '')}
      ${tile('Open', sum.open, 'open')}
    </div>
    <div class="cols">
      <section class="card"><h2>Needs attention</h2>${list(attention, 'Nothing overdue or waiting on the desk.')}</section>
      <section class="card"><h2>Assigned to me</h2>${list(mine, 'No open tickets assigned to you.')}</section>
    </div>`);
}

// ---------- Agents: queue ----------

const VIEWS = { open: 'Open', mine: 'Mine', unassigned: 'Unassigned', overdue: 'Overdue', resolved: 'Resolved & closed', all: 'All' };

export async function ticketQueueView(el, _params, query) {
  const [agents, info] = await Promise.all([api.get('/api/helpdesk/agents'), api.get('/api/helpdesk/info')]);
  const state = { view: VIEWS[query.view] ? query.view : 'open', priority: '', category: '', assignee: '', q: '' };
  let timer;

  async function load() {
    const qs = new URLSearchParams(Object.entries(state).filter(([, v]) => v)).toString();
    history.replaceState(null, '', `#/helpdesk/tickets?view=${state.view}`);
    const list = await api.get(`/api/helpdesk/tickets?${qs}`);
    el.querySelectorAll('[data-view]').forEach((a) => a.classList.toggle('active', a.dataset.view === state.view));
    mount(el.querySelector('#count'), plural(list.length, 'ticket'));
    mount(el.querySelector('#list'), list.length
      ? html`<table class="table clickable hd-table">
          <thead><tr><th>Ticket</th><th>Subject</th><th>Requester</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Due</th><th>Updated</th></tr></thead>
          <tbody>${list.map((t) => html`<tr data-id="${t.id}" class="${t.awaitingAgent && UNRESOLVED_TICKET.includes(t.status) ? 'unread' : ''}">
            <td><a class="mono" href="#/helpdesk/tickets/${t.id}">${t.ref}</a><small>${TICKET_CHANNEL[t.channel]}</small></td>
            <td><strong>${t.subject}</strong><small>${t.category}${t.asset ? ` · ${t.asset.tag}` : ''}</small></td>
            <td>${t.requester.name}<small>${t.requester.email || ''}</small></td>
            <td>${statusBadge(t.status)}</td>
            <td>${priorityBadge(t.priority)}</td>
            <td>${t.assignee ? t.assignee.name : html`<span class="muted">Unassigned</span>`}</td>
            <td>${slaCell(t)}</td>
            <td>${when(t.updatedAt)}${t.lastActivity ? html`<small>${t.lastActivity.role === 'requester' ? 'by requester' : t.lastActivity.by}</small>` : ''}</td>
          </tr>`)}</tbody></table>`
      : html`<div class="empty"><p>No tickets here.</p></div>`);
    el.querySelectorAll('#list tbody tr').forEach((tr) => tr.addEventListener('click', (e) => {
      if (!e.target.closest('a')) location.hash = `#/helpdesk/tickets/${tr.dataset.id}`;
    }));
  }

  mount(el, html`
    <header class="page-head">
      <div><h1>Tickets</h1><p class="muted"><span id="count"></span>. Bold rows are waiting on the desk.</p></div>
      <div class="actions"><a class="btn primary" href="#/helpdesk/new">+ Log a ticket</a></div>
    </header>
    <nav class="tabs">${Object.entries(VIEWS).map(([k, v]) => html`<a href="#/helpdesk/tickets?view=${k}" data-view="${k}">${v}</a>`)}</nav>
    <section class="card scroll-x">
      <div class="toolbar pad">
        <input type="search" id="q" placeholder="Search number, subject, requester or text…" />
        <select id="f-priority" aria-label="Priority"><option value="">All priorities</option>${Object.entries(TICKET_PRIORITY).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select>
        <select id="f-category" aria-label="Category"><option value="">All categories</option>${info.categories.map((c) => html`<option>${c}</option>`)}</select>
        <select id="f-assignee" aria-label="Assignee"><option value="">Anyone</option>${agents.map((a) => html`<option value="${a.id}">${a.name}</option>`)}</select>
      </div>
      <div id="list"></div>
    </section>`);
  el.querySelectorAll('[data-view]').forEach((a) => a.addEventListener('click', (e) => (e.preventDefault(), (state.view = a.dataset.view), load())));
  el.querySelector('#q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => ((state.q = e.target.value), load()), 250);
  });
  for (const [id, key] of [['#f-priority', 'priority'], ['#f-category', 'category'], ['#f-assignee', 'assignee']]) {
    el.querySelector(id).addEventListener('change', (e) => ((state[key] = e.target.value), load()));
  }
  await load();
  // The queue refreshes itself every minute.
  const poll = setInterval(() => !document.querySelector('.modal-backdrop') && load().catch(() => {}), 60000);
  return () => (clearInterval(poll), clearTimeout(timer));
}

// ---------- Agents: one ticket ----------

export async function ticketView(el, { id }) {
  const [agents, canned, info] = await Promise.all([api.get('/api/helpdesk/agents'), api.get('/api/helpdesk/canned'), api.get('/api/helpdesk/info')]);
  let t = await api.get(`/api/helpdesk/tickets/${id}`);
  const assets = can('assets.view') ? await api.get('/api/assets').catch(() => []) : [];

  function render() {
    const draft = el.querySelector('#reply-text')?.value || '';
    const mode = el.querySelector('[name=mode]:checked')?.value || 'reply';
    mount(el, html`<div class="hd-page">
      <header class="page-head">
        <div><a class="back" href="#/helpdesk/tickets">← Tickets</a>
          <p class="tag-line mono">${t.ref} · ${TICKET_CHANNEL[t.channel]}</p>
          <h1>${t.subject}</h1>
          <p class="muted hd-sub">${statusBadge(t.status)} ${priorityBadge(t.priority)} <span>${t.requester.name}${t.requester.email ? ` <${t.requester.email}>` : ''} · opened ${when(t.createdAt)}</span></p></div>
        ${can('helpdesk.manage') ? html`<div class="actions"><button class="btn danger ghost" id="delete">Delete</button></div>` : ''}
      </header>
      ${t.viewers.length ? html`<div class="notice"><p>${t.viewers.join(', ')} ${t.viewers.length === 1 ? 'is' : 'are'} also viewing this ticket.</p></div>` : ''}
      <div class="hd-layout">
        <div class="hd-main">
          <section class="card">${thread(t, { agentView: true })}</section>
          <section class="card hd-compose">
            <form id="compose">
              <div class="seg hd-mode">
                <label><input type="radio" name="mode" value="reply" ${mode === 'reply' ? 'checked' : ''} /> Reply to requester</label>
                <label><input type="radio" name="mode" value="note" ${mode === 'note' ? 'checked' : ''} /> Internal note</label>
              </div>
              <textarea id="reply-text" name="body" rows="5" maxlength="20000" placeholder="${mode === 'note' ? 'Visible to agents only.' : t.requester.email ? `Sent to ${t.requester.email} and shown in their portal.` : 'Shown in the requester’s portal (no email address on file).'}">${draft}</textarea>
              <div class="hd-compose-bar">
                ${canned.length ? html`<select id="canned" aria-label="Saved reply"><option value="">Insert saved reply…</option>${canned.map((c) => html`<option value="${c.id}">${c.title}</option>`)}</select>` : ''}
                <label class="btn small-btn hd-attach">Attach<input type="file" name="files" accept="${ACCEPT}" multiple hidden /></label>
                <span class="muted small" id="file-count"></span>
                <span class="spacer"></span>
                <label class="inline small">Then <select name="status">${Object.entries(TICKET_STATUS).map(([k, v]) => html`<option value="${k}" ${k === (mode === 'reply' && ['new', 'open'].includes(t.status) ? 'pending' : t.status === 'new' ? 'open' : t.status) ? 'selected' : ''}>${v}</option>`)}</select></label>
                <button class="btn primary" type="submit">${mode === 'note' ? 'Add note' : 'Send reply'}</button>
              </div>
            </form>
          </section>
        </div>
        <aside class="hd-side">
          <section class="card">
            <h2>Ticket</h2>
            <form id="props" class="hd-props">
              <label class="field"><span>Status</span><select name="status">${Object.entries(TICKET_STATUS).map(([k, v]) => html`<option value="${k}" ${k === t.status ? 'selected' : ''}>${v}</option>`)}</select></label>
              <label class="field"><span>Priority</span><select name="priority">${Object.entries(TICKET_PRIORITY).map(([k, v]) => html`<option value="${k}" ${k === t.priority ? 'selected' : ''}>${v}</option>`)}</select></label>
              <label class="field"><span>Category</span><select name="category">${info.categories.map((c) => html`<option ${c === t.category ? 'selected' : ''}>${c}</option>`)}</select></label>
              <label class="field"><span>Assignee</span><select name="assigneeId"><option value="">Unassigned</option>${agents.map((a) => html`<option value="${a.id}" ${a.id === t.assignee?.id ? 'selected' : ''}>${a.name}${a.id === ctx.user.id ? ' (me)' : ''}</option>`)}</select></label>
              ${assets.length ? html`<label class="field"><span>Related asset</span><select name="assetId"><option value="">None</option>${assets.filter((a) => a.status !== 'retired').map((a) => html`<option value="${a.id}" ${a.id === t.asset?.id ? 'selected' : ''}>${a.assetTag} · ${a.name}${a.assignedTo?.name ? ` (${a.assignedTo.name})` : ''}</option>`)}</select></label>` : ''}
            </form>
            ${t.asset ? html`<p class="small"><a href="#/assets/item/${t.asset.id}">Open asset ${t.asset.tag}</a></p>` : ''}
          </section>
          <section class="card">
            <h2>Service level</h2>
            <dl class="hd-dl">
              <div><dt>First response</dt><dd>${t.firstResponseAt ? html`${when(t.firstResponseAt)} ${new Date(t.firstResponseAt) <= new Date(t.firstResponseDue) ? badge('Met', 'green') : badge('Late', 'amber')}` : html`due ${when(t.firstResponseDue)} ${slaCell(t)}`}</dd></div>
              <div><dt>Resolution</dt><dd>${t.resolvedAt ? when(t.resolvedAt) : `due ${when(t.resolutionDue)}`}</dd></div>
              <div><dt>Requester</dt><dd>${t.requester.name}<small>${t.requester.email || 'No email on file'}</small></dd></div>
              ${t.ccs.length ? html`<div><dt>Copied</dt><dd>${t.ccs.join(', ')}</dd></div>` : ''}
            </dl>
          </section>
        </aside>
      </div></div>`);

    const compose = el.querySelector('#compose');
    compose.querySelectorAll('[name=mode]').forEach((r) => r.addEventListener('change', render));
    compose.files.addEventListener('change', () => (el.querySelector('#file-count').textContent = compose.files.files.length ? plural(compose.files.files.length, 'file') : ''));
    el.querySelector('#canned')?.addEventListener('change', (e) => {
      const c = canned.find((x) => x.id === e.target.value);
      const box = el.querySelector('#reply-text');
      if (c) box.value = (box.value ? `${box.value.trimEnd()}\n\n` : '') + c.body.replaceAll('{name}', t.requester.name.split(' ')[0]).replaceAll('{ref}', t.ref);
      e.target.value = '';
      box.focus();
    });
    compose.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = compose.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const kind = compose.mode.value;
        t = { ...(await api.post(`/api/helpdesk/tickets/${t.id}/messages`, { kind, body: compose.body.value, status: compose.status.value, attachments: await filesFrom(compose.files) })), viewers: t.viewers };
        // The reply itself, not the status-change line after it.
        const sent = [...t.messages].reverse().find((m) => m.kind === kind && m.author.userId === ctx.user.id)?.email;
        el.querySelector('#reply-text').value = '';
        toast(kind === 'note' ? 'Note added.' : sent?.status === 'sent' ? 'Reply sent and emailed.' : sent?.status === 'failed' ? `Reply saved, but the email failed: ${sent.reason}` : 'Reply saved to the ticket.', sent?.status === 'failed' ? 'error' : 'ok');
        changed();
        render();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
    el.querySelector('#props').addEventListener('change', async (e) => {
      try {
        t = { ...(await api.put(`/api/helpdesk/tickets/${t.id}`, { [e.target.name]: e.target.value })), viewers: t.viewers };
        toast('Ticket updated.');
        changed();
        render();
      } catch (err) {
        toast(err.message, 'error');
        render();
      }
    });
    el.querySelector('#delete')?.addEventListener('click', async () => {
      if (!(await confirmDialog(`${t.ref} and its conversation and files will be permanently deleted.`, { title: 'Delete ticket', confirmLabel: 'Delete ticket' }))) return;
      await api.del(`/api/helpdesk/tickets/${t.id}`);
      toast('Ticket deleted.');
      changed();
      location.hash = '#/helpdesk/tickets';
    });
  }
  render();
  onFileClick(el);
  // Pick up replies and other agents viewing, without disturbing a draft.
  const poll = setInterval(async () => {
    try {
      const next = await api.get(`/api/helpdesk/tickets/${id}`);
      const typing = el.querySelector('#reply-text')?.value || document.querySelector('.modal-backdrop');
      if (next.messages.length !== t.messages.length && typing) return toast('New activity on this ticket. It will appear when you send or refresh.');
      if (next.messages.length !== t.messages.length || next.viewers.join() !== t.viewers.join() || next.status !== t.status) (t = next), render();
    } catch {}
  }, 20000);
  return () => clearInterval(poll);
}

// ---------- Agents: log a ticket on someone's behalf ----------

export async function newTicketView(el) {
  const [agents, info, users] = await Promise.all([api.get('/api/helpdesk/agents'), api.get('/api/helpdesk/info'), can('users.manage') ? api.get('/api/users') : Promise.resolve(null)]);
  const assets = can('assets.view') ? await api.get('/api/assets').catch(() => []) : [];
  mount(el, html`
    <header class="page-head"><div><a class="back" href="#/helpdesk/tickets">← Tickets</a><h1>Log a ticket</h1><p class="muted">For requests received by phone, chat or in person.</p></div></header>
    <section class="card">
      <form id="new" class="grid two" novalidate>
        ${users ? html`<label class="field span-2"><span>Requester</span><select name="requesterUserId"><option value="">Someone without an account (enter below)</option>${users.filter((u) => u.active).map((u) => html`<option value="${u.id}">${u.name} (${u.username})</option>`)}</select></label>` : ''}
        <label class="field ext"><span>Requester name</span><input name="requesterName" maxlength="120" placeholder="e.g. Juan Dela Cruz" /></label>
        <label class="field ext"><span>Requester email (for replies)</span><input name="requesterEmail" type="email" maxlength="200" placeholder="juan@company.com" /></label>
        <label class="field span-2"><span>Subject</span><input name="subject" maxlength="200" required placeholder="e.g. Cannot print to the 3F printer" /></label>
        <label class="field"><span>Category</span><select name="category">${info.categories.map((c) => html`<option>${c}</option>`)}</select></label>
        <label class="field"><span>Priority</span><select name="priority">${Object.entries(TICKET_PRIORITY).map(([k, v]) => html`<option value="${k}" ${k === 'normal' ? 'selected' : ''}>${v}</option>`)}</select></label>
        <label class="field"><span>Assign to</span><select name="assigneeId"><option value="">Unassigned</option>${agents.map((a) => html`<option value="${a.id}" ${a.id === ctx.user.id ? 'selected' : ''}>${a.name}</option>`)}</select></label>
        ${assets.length ? html`<label class="field"><span>Related asset</span><select name="assetId"><option value="">None</option>${assets.filter((a) => a.status !== 'retired').map((a) => html`<option value="${a.id}">${a.assetTag} · ${a.name}</option>`)}</select></label>` : ''}
        <label class="field span-2"><span>Description</span><textarea name="body" rows="6" maxlength="20000" required></textarea></label>
        <label class="field span-2"><span>Attachments (optional)</span><input type="file" name="files" accept="${ACCEPT}" multiple /></label>
        <p class="form-error span-2" hidden></p>
        <div class="actions span-2"><button class="btn primary" type="submit">Create ticket</button></div>
      </form>
    </section>`);
  const form = el.querySelector('#new');
  const sync = () => form.querySelectorAll('.ext').forEach((x) => (x.hidden = Boolean(form.requesterUserId?.value)));
  form.requesterUserId?.addEventListener('change', sync);
  sync();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('.form-error');
    try {
      const body = Object.fromEntries(new FormData(form));
      delete body.files;
      const t = await api.post('/api/helpdesk/tickets', { ...body, attachments: await filesFrom(form.files) });
      toast(`Ticket ${t.ref} created.`);
      changed();
      location.hash = `#/helpdesk/tickets/${t.id}`;
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
}

// ---------- Everyone: my tickets ----------

function openNewTicket(info, onDone) {
  const { form } = modal({
    title: 'New support ticket',
    subtitle: 'The IT Service Desk is notified and replies here.',
    submitLabel: 'Submit ticket',
    className: 'fb-modal',
    body: html`<label class="field"><span>Subject</span><input name="subject" maxlength="200" required placeholder="e.g. Laptop will not connect to Wi-Fi" /></label>
      <div class="grid two">
        <label class="field"><span>Category</span><select name="category">${info.categories.map((c) => html`<option>${c}</option>`)}</select></label>
        <label class="field"><span>How urgent?</span><select name="priority">
          <option value="low">Low: whenever possible</option><option value="normal" selected>Normal: affects my work</option>
          <option value="high">High: I can barely work</option><option value="urgent">Urgent: I cannot work at all</option></select></label>
      </div>
      ${info.myAssets.length ? html`<label class="field"><span>Which equipment? (optional)</span><select name="assetId"><option value="">Not about a specific device</option>${info.myAssets.map((a) => html`<option value="${a.id}">${a.tag} · ${a.name}</option>`)}</select></label>` : ''}
      <label class="field"><span>Describe the problem</span><textarea name="body" rows="5" maxlength="20000" required placeholder="What happens, since when, and any error message."></textarea></label>
      <label class="field"><span>Screenshots or files (optional)</span><input type="file" name="files" accept="${ACCEPT}" multiple /></label>
      ${info.mailboxAddress ? html`<p class="muted small">You can also email <strong>${info.mailboxAddress}</strong> from ${info.myEmail || 'your work email'}.</p>` : ''}`,
    onSubmit: async (f) => {
      const body = Object.fromEntries(new FormData(f));
      delete body.files;
      const t = await api.post('/api/helpdesk/mine', { ...body, attachments: await filesFrom(f.files) });
      toast(`Ticket ${t.ref} submitted.`);
      onDone(t);
    },
  });
  return form;
}

export async function myTicketsView(el, _params, query) {
  const [info, list] = await Promise.all([api.get('/api/helpdesk/info'), api.get('/api/helpdesk/mine')]);
  const open = list.filter((t) => UNRESOLVED_TICKET.includes(t.status));
  const done = list.filter((t) => !UNRESOLVED_TICKET.includes(t.status));
  const rows = (items) => html`<div class="fb-list">${items.map((t) => html`<a class="fb-row" href="#/helpdesk/mine/${t.id}">
    <span class="fb-row-top"><span class="mono">${t.ref}</span><time>${when(t.updatedAt)}</time></span>
    <strong class="fb-row-subject">${t.subject}</strong>
    <span class="fb-row-tags">${statusBadge(t.status)}<small>${t.category}${t.lastActivity?.role === 'agent' ? ' · IT replied' : ''}</small></span></a>`)}</div>`;
  mount(el, html`<div class="fb-page">
    <header class="page-head">
      <div><h1>My tickets</h1><p class="muted">Ask the IT Service Desk for help and follow the replies.${info.mailboxAddress ? html` You can also email <strong>${info.mailboxAddress}</strong>.` : ''}</p></div>
      <div class="actions"><button class="btn primary" id="new-ticket">+ New ticket</button></div>
    </header>
    <section class="card fb-card"><div class="card-head"><h2>Open</h2><span class="muted small">${plural(open.length, 'ticket')}</span></div>
      ${open.length ? rows(open) : html`<div class="empty"><p>No open tickets.</p></div>`}</section>
    ${done.length ? html`<section class="card fb-card"><div class="card-head"><h2>Resolved and closed</h2><span class="muted small">${plural(done.length, 'ticket')}</span></div>${rows(done)}</section>` : ''}
  </div>`);
  const start = () => openNewTicket(info, (t) => (location.hash = `#/helpdesk/mine/${t.id}`));
  el.querySelector('#new-ticket').addEventListener('click', start);
  if (query.new) start();
}

export async function myTicketView(el, { id }) {
  let t = await api.get(`/api/helpdesk/mine/${id}`);
  function render() {
    const active = UNRESOLVED_TICKET.includes(t.status);
    mount(el, html`<div class="hd-page">
      <header class="page-head">
        <div><a class="back" href="#/helpdesk/mine">← My tickets</a><p class="tag-line mono">${t.ref}</p><h1>${t.subject}</h1>
          <p class="muted hd-sub">${statusBadge(t.status)} <span>${t.category} · opened ${when(t.createdAt)}${t.assignee ? ` · handled by ${t.assignee.name}` : ''}</span></p></div>
        ${active ? html`<div class="actions"><button class="btn" id="solved">My problem is solved</button></div>` : ''}
      </header>
      <section class="card">${thread(t, { agentView: false })}</section>
      ${t.status !== 'closed'
        ? html`<section class="card hd-compose"><form id="reply">
            <label class="field"><span>${active ? 'Add a reply' : 'Not solved after all? Reply to reopen it'}</span><textarea name="body" rows="4" maxlength="20000" required></textarea></label>
            <div class="hd-compose-bar"><label class="btn small-btn hd-attach">Attach<input type="file" name="files" accept="${ACCEPT}" multiple hidden /></label><span class="muted small" id="file-count"></span><span class="spacer"></span><button class="btn primary" type="submit">Send</button></div>
          </form></section>`
        : html`<p class="muted">This ticket is closed. If the problem comes back, <a href="#/helpdesk/mine?new=1">open a new ticket</a> and mention ${t.ref}.</p>`}
    </div>`);
    const form = el.querySelector('#reply');
    form?.files.addEventListener('change', () => (el.querySelector('#file-count').textContent = form.files.files.length ? plural(form.files.files.length, 'file') : ''));
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        t = await api.post(`/api/helpdesk/mine/${t.id}/messages`, { body: form.body.value, attachments: await filesFrom(form.files) });
        toast('Reply sent to the IT Service Desk.');
        render();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    el.querySelector('#solved')?.addEventListener('click', async () => {
      if (!(await confirmDialog('The ticket will be marked resolved. You can reply later to reopen it.', { title: 'Mark as solved', confirmLabel: 'Mark as solved', danger: false }))) return;
      t = await api.post(`/api/helpdesk/mine/${t.id}/resolve`);
      toast('Thank you. The ticket is resolved.');
      render();
    });
  }
  render();
  onFileClick(el);
}

// ---------- Administrators: settings ----------

// Common providers. Google and Microsoft mailboxes need an app password (or IMAP turned on).
const PRESETS = {
  gmail: { label: 'Gmail / Google Workspace', imap: ['imap.gmail.com', 993, 'tls'], smtp: ['smtp.gmail.com', 587, 'starttls'], hint: 'Turn on 2-Step Verification for the mailbox and create an app password (Google Account → Security → App passwords). Use the full email address as the sign-in.' },
  m365: { label: 'Microsoft 365 / Outlook', imap: ['outlook.office365.com', 993, 'tls'], smtp: ['smtp.office365.com', 587, 'starttls'], hint: 'Microsoft has turned off password sign-in for IMAP/SMTP in most Microsoft 365 tenants. It works only if your admin allows basic authentication for this mailbox; otherwise use another provider for the helpdesk mailbox.' },
  zoho: { label: 'Zoho Mail', imap: ['imap.zoho.com', 993, 'tls'], smtp: ['smtp.zoho.com', 587, 'starttls'], hint: 'Enable IMAP access in Zoho Mail settings; use an app-specific password if two-factor sign-in is on.' },
  other: { label: 'Other (enter the server details)', hint: 'Get the IMAP and SMTP server names and ports from your email provider or IT.' },
};

export async function helpdeskSettingsView(el) {
  let [s, access] = await Promise.all([api.get('/api/helpdesk/settings'), api.get('/api/helpdesk/agent-access')]);
  const asked = new URLSearchParams(location.hash.split('?')[1] || '').get('tab');
  const tab = { current: ['mailbox', 'outgoing', 'general', 'agents'].includes(asked) ? asked : 'mailbox' };

  const secField = (name, value) => html`<select name="${name}"><option value="tls" ${value === 'tls' ? 'selected' : ''}>SSL/TLS</option><option value="starttls" ${value === 'starttls' ? 'selected' : ''}>STARTTLS</option><option value="none" ${value === 'none' ? 'selected' : ''}>None (not recommended)</option></select>`;
  const pw = (cfg, name = 'password') => html`<input type="password" name="${name}" autocomplete="new-password" placeholder="${cfg.hasPassword ? '•••••••• saved (leave blank to keep)' : 'Mailbox or app password'}" />`;

  function mailboxTab() {
    const b = s.mailbox;
    const st = s.mailState;
    return html`
      <section class="card">
        <div class="card-head"><h2>Receiving email</h2>${b.enabled ? (st.lastError ? badge('Problem', 'amber') : badge('Receiving', 'green')) : badge('Off', 'gray')}</div>
        <p class="muted">Emails sent to this address become tickets, and replies to the helpdesk's emails are added to the right ticket. The helpdesk checks the mailbox every few minutes.</p>
        <form id="mailbox" class="grid two" novalidate>
          <label class="field span-2"><span>Helpdesk email address</span><input name="address" type="email" value="${b.address}" placeholder="helpdesk@company.com" required />
            <small class="muted">The address users write to. Replies are also sent from it.</small></label>
          <label class="field"><span>Name shown to users</span><input name="displayName" value="${b.displayName}" maxlength="80" /></label>
          <label class="field"><span>Email provider</span><select id="preset">${Object.entries(PRESETS).map(([k, p]) => html`<option value="${k}">${p.label}</option>`)}</select></label>
          <p class="muted small span-2" id="preset-hint"></p>
          <label class="field"><span>Incoming mail server (IMAP)</span><input name="host" value="${b.host}" placeholder="imap.gmail.com" /></label>
          <div class="grid two"><label class="field"><span>Port</span><input name="port" type="number" value="${b.port}" min="1" max="65535" /></label><label class="field"><span>Security</span>${secField('security', b.security)}</label></div>
          <label class="field"><span>Sign-in name</span><input name="user" value="${b.user}" autocomplete="off" placeholder="Usually the full address" /></label>
          <label class="field"><span>Password</span>${pw(b)}<small class="muted">Stored encrypted on the server; never shown again.</small></label>
          <label class="field"><span>Folder</span><input name="folder" value="${b.folder}" /></label>
          <label class="field"><span>Check every (minutes)</span><input name="pollMinutes" type="number" min="1" max="60" value="${b.pollMinutes}" /></label>
          <label class="field"><span>Who can open tickets by email</span><select name="allowedSenders">
            <option value="anyone" ${b.allowedSenders === 'anyone' ? 'selected' : ''}>Anyone</option>
            <option value="domains" ${b.allowedSenders === 'domains' ? 'selected' : ''}>Only these domains</option>
            <option value="known" ${b.allowedSenders === 'known' ? 'selected' : ''}>Only employees (email on their record)</option></select></label>
          <label class="field"><span>Allowed domains</span><input name="allowedDomains" value="${b.allowedDomains.join(', ')}" placeholder="company.com, lancastertechdev.com" /></label>
          <label class="field"><span>Category for emailed tickets</span><select name="defaultCategory">${s.categories.map((c) => html`<option ${c === b.defaultCategory ? 'selected' : ''}>${c}</option>`)}</select></label>
          <label class="field"><span>Priority for emailed tickets</span><select name="defaultPriority">${Object.entries(TICKET_PRIORITY).map(([k, v]) => html`<option value="${k}" ${k === b.defaultPriority ? 'selected' : ''}>${v}</option>`)}</select></label>
          <label class="field check span-2"><input type="checkbox" name="enabled" ${b.enabled ? 'checked' : ''} /> <span>Receive email at this address</span></label>
          <p class="form-error span-2" hidden></p>
          <div class="actions span-2"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" id="test-in">Test connection</button><button class="btn" type="button" id="poll">Check mail now</button></div>
        </form>
      </section>
      <section class="card">
        <h2>Mailbox activity</h2>
        <dl class="hd-dl">
          <div><dt>Last check</dt><dd>${st.lastPollAt ? when(st.lastPollAt) : 'Never'}</dd></div>
          <div><dt>Last successful check</dt><dd>${st.lastOkAt ? `${when(st.lastOkAt)} · ${plural(st.lastImported, 'email')} imported` : '—'}</dd></div>
          <div><dt>Imported in total</dt><dd>${st.totalImported}</dd></div>
          ${st.lastError ? html`<div><dt>Last error</dt><dd class="hd-error">${st.lastError}</dd></div>` : ''}
          ${st.lastSkipped.length ? html`<div><dt>Ignored last time</dt><dd>${st.lastSkipped.join('; ')}</dd></div>` : ''}
        </dl>
        <p class="muted small">Automatic replies (out of office, bounces, mailing lists) and mail from the helpdesk address itself are ignored, so the desk never answers itself.</p>
      </section>`;
  }

  function outgoingTab() {
    const o = s.outgoing;
    return html`<section class="card">
      <div class="card-head"><h2>Sending email</h2>${o.enabled ? badge('On', 'green') : badge('Off', 'gray')}</div>
      <p class="muted">Used for agents' replies and the acknowledgement sent when a ticket arrives by email. Without it, replies appear only in the user's portal.</p>
      <form id="outgoing" class="grid two" novalidate>
        <label class="field"><span>Outgoing mail server (SMTP)</span><input name="host" value="${o.host}" placeholder="smtp.gmail.com" /></label>
        <div class="grid two"><label class="field"><span>Port</span><input name="port" type="number" value="${o.port}" /></label><label class="field"><span>Security</span>${secField('security', o.security)}</label></div>
        <label class="field check span-2"><input type="checkbox" name="sameLogin" ${o.sameLogin ? 'checked' : ''} /> <span>Use the same sign-in as the mailbox</span></label>
        <label class="field own"><span>Sign-in name</span><input name="user" value="${o.user}" autocomplete="off" /></label>
        <label class="field own"><span>Password</span>${pw(o)}</label>
        <label class="field check span-2"><input type="checkbox" name="enabled" ${o.enabled ? 'checked' : ''} /> <span>Send replies by email from ${s.mailbox.address || 'the helpdesk address'}</span></label>
        <p class="form-error span-2" hidden></p>
        <div class="actions span-2"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" id="test-out">Send a test email</button></div>
      </form>
    </section>`;
  }

  function generalTab() {
    return html`<section class="card"><h2>Tickets</h2>
      <form id="general" class="grid two" novalidate>
        <label class="field"><span>Categories (one per line)</span><textarea name="categories" rows="8">${s.categories.join('\n')}</textarea></label>
        <div class="field"><span>Service level targets (hours)</span>
          <table class="table compact no-stack hd-sla"><thead><tr><th>Priority</th><th class="num">First response</th><th class="num">Resolution</th></tr></thead>
            <tbody>${Object.entries(TICKET_PRIORITY).map(([k, v]) => html`<tr><td>${v}</td>
              <td class="num"><input type="number" name="sla.${k}.firstResponse" min="0.25" step="0.25" value="${s.sla[k].firstResponse}" /></td>
              <td class="num"><input type="number" name="sla.${k}.resolution" min="0.25" step="0.25" value="${s.sla[k].resolution}" /></td></tr>`)}</tbody></table></div>
        <label class="field"><span>Close resolved tickets after (days)</span><input name="autoCloseDays" type="number" min="0" max="90" value="${s.autoCloseDays}" /><small class="muted">0 = never. Until then, the requester can reply to reopen.</small></label>
        <label class="field check"><input type="checkbox" name="autoAcknowledge" ${s.autoAcknowledge ? 'checked' : ''} /> <span>Email an acknowledgement when a ticket arrives by email</span></label>
        <label class="field span-2"><span>Acknowledgement text</span><textarea name="ackTemplate" rows="5">${s.ackTemplate}</textarea><small class="muted">{name} = requester's first name, {ref} = ticket number, {subject} = subject.</small></label>
        <p class="form-error span-2" hidden></p>
        <div class="actions span-2"><button class="btn primary" type="submit">Save</button></div>
      </form></section>
      <section class="card"><div class="card-head"><h2>Saved replies</h2><button class="btn small-btn" id="add-canned">+ Add</button></div>
        ${s.canned.length ? html`<table class="table compact"><tbody>${s.canned.map((c) => html`<tr><td><strong>${c.title}</strong><small class="clip">${c.body}</small></td>
          <td class="row-actions"><button class="link" data-edit-canned="${c.id}">Edit</button><button class="link danger" data-del-canned="${c.id}">Delete</button></td></tr>`)}</tbody></table>`
          : html`<p class="muted">Standard answers agents insert into a reply, e.g. password reset steps. {name} and {ref} are filled in.</p>`}
      </section>`;
  }

  // Which accounts work tickets: account-type default, or granted / removed here.
  function agentsTab() {
    const agents = access.filter((u) => u.agent).length;
    const source = (u) => (u.locked ? 'Administrator: always' : u.override === null ? `By account type (${u.roleLabel})` : u.override ? 'Added here' : 'Removed here');
    return html`<section class="card scroll-x">
      <div class="card-head pad"><h2>Helpdesk agents</h2><span class="muted small">${plural(agents, 'agent')} of ${plural(access.length, 'active account')}</span></div>
      <p class="muted pad">Agents see every ticket, reply, add internal notes and can be assigned tickets. Everyone else uses <strong>My tickets</strong> only. Administrators, IT Asset Managers and Helpdesk Agents are agents by default; turn access on or off for any other account here. Changes apply the next time that person opens or reloads the app.</p>
      <table class="table agent-table">
        <thead><tr><th>Account</th><th>Account type</th><th>Agent access</th><th>Set by</th><th class="num">Open tickets assigned</th></tr></thead>
        <tbody>${access.map((u) => html`<tr class="${u.agent ? '' : 'not-offered'}">
          <td><strong>${u.name}</strong><small>${u.username}</small></td>
          <td>${u.roleLabel}</td>
          <td><label class="switch"><input type="checkbox" data-agent="${u.id}" ${u.agent ? 'checked' : ''} ${u.locked ? 'disabled' : ''} /><span>${u.agent ? 'Agent' : 'No'}</span></label></td>
          <td>${source(u)}${u.override !== null && !u.locked ? html` · <button type="button" class="link" data-agent-default="${u.id}">use default</button>` : ''}</td>
          <td class="num">${u.assignedOpen || html`<span class="muted">—</span>`}</td></tr>`)}</tbody>
      </table>
      <p class="muted small pad">To give someone agent access only, create their account with the <em>Helpdesk Agent</em> type under Users &amp; Access, or turn it on here for an existing account.</p>
    </section>`;
  }

  function render() {
    mount(el, html`
      <header class="page-head"><div><h1>Service desk settings</h1><p class="muted">Where the helpdesk receives email, how it replies, how tickets are handled, and who works them.</p></div></header>
      <nav class="tabs">${[['mailbox', 'Receiving email'], ['outgoing', 'Sending email'], ['general', 'Tickets & replies'], ['agents', 'Agents']].map(([k, v]) => html`<a href="#/helpdesk/settings?tab=${k}" data-tab="${k}" class="${k === tab.current ? 'active' : ''}">${v}</a>`)}</nav>
      <div id="tab">${{ mailbox: mailboxTab, outgoing: outgoingTab, general: generalTab, agents: agentsTab }[tab.current]()}</div>`);
    el.querySelectorAll('[data-tab]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      tab.current = a.dataset.tab;
      history.replaceState(null, '', `#/helpdesk/settings?tab=${tab.current}`);
      render();
    }));
    wire();
  }

  const saveForm = (form, url, read) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('.form-error');
    try {
      s = await api.put(url, read(form));
      toast('Saved.');
      render();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
  const busy = async (btn, fn) => {
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Working…';
    try {
      await fn();
    } catch (ex) {
      toast(ex.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  };

  function wire() {
    const box = el.querySelector('#mailbox');
    if (box) {
      const hint = el.querySelector('#preset-hint');
      const preset = el.querySelector('#preset');
      preset.value = Object.entries(PRESETS).find(([, p]) => p.imap?.[0] === box.host.value)?.[0] || 'other';
      hint.textContent = PRESETS[preset.value].hint;
      preset.addEventListener('change', () => {
        const p = PRESETS[preset.value];
        hint.textContent = p.hint;
        if (p.imap) [box.host.value, box.port.value, box.security.value] = p.imap;
        if (!box.user.value && box.address.value) box.user.value = box.address.value;
      });
      box.address.addEventListener('change', () => !box.user.value && (box.user.value = box.address.value));
      saveForm(box, '/api/helpdesk/settings/mailbox', (f) => ({ ...Object.fromEntries(new FormData(f)), enabled: f.enabled.checked }));
      el.querySelector('#test-in').addEventListener('click', (e) => busy(e.target, async () => toast((await api.post('/api/helpdesk/settings/mailbox/test')).message)));
      el.querySelector('#poll').addEventListener('click', (e) => busy(e.target, async () => {
        const r = await api.post('/api/helpdesk/settings/mailbox/poll');
        s = r.settings;
        const made = r.results.filter((x) => x.action !== 'skipped').length;
        toast(r.error ? `Could not check mail: ${r.error}` : `Checked: ${plural(made, 'email')} imported${r.results.length - made ? `, ${r.results.length - made} ignored` : ''}.`, r.error ? 'error' : 'ok');
        changed();
        render();
      }));
    }
    const out = el.querySelector('#outgoing');
    if (out) {
      const sync = () => out.querySelectorAll('.own').forEach((x) => (x.hidden = out.sameLogin.checked));
      out.sameLogin.addEventListener('change', sync);
      sync();
      const presetFor = Object.values(PRESETS).find((p) => p.imap?.[0] === s.mailbox.host);
      if (presetFor && !out.host.value) [out.host.value, out.port.value, out.security.value] = presetFor.smtp;
      saveForm(out, '/api/helpdesk/settings/outgoing', (f) => ({ ...Object.fromEntries(new FormData(f)), enabled: f.enabled.checked, sameLogin: f.sameLogin.checked }));
      el.querySelector('#test-out').addEventListener('click', () => modal({
        title: 'Send a test email',
        submitLabel: 'Send',
        body: html`<label class="field"><span>Send to</span><input name="to" type="email" required placeholder="you@company.com" /></label><p class="muted small">Uses the saved settings. Save any changes first.</p>`,
        onSubmit: async (f) => toast((await api.post('/api/helpdesk/settings/outgoing/test', { to: new FormData(f).get('to') })).message),
      }));
    }
    const agentTable = el.querySelector('.agent-table');
    if (agentTable) {
      const set = async (id, value) => {
        const u = access.find((x) => x.id === id);
        if (value === false && u.assignedOpen && !(await confirmDialog(`${u.name} has ${plural(u.assignedOpen, 'open ticket')} assigned. They stay assigned until you reassign them, but ${u.name.split(' ')[0]} will no longer see the queue.`, { title: 'Remove agent access', confirmLabel: 'Remove access' }))) return render();
        try {
          access = await api.put(`/api/helpdesk/agent-access/${id}`, { access: value });
          toast(value === null ? `${u.name} follows the account type again.` : value ? `${u.name} is now a helpdesk agent.` : `${u.name} is no longer a helpdesk agent.`);
          changed();
        } catch (err) {
          toast(err.message, 'error');
        }
        render();
      };
      agentTable.addEventListener('change', (e) => e.target.dataset.agent && set(e.target.dataset.agent, e.target.checked));
      agentTable.addEventListener('click', (e) => e.target.dataset.agentDefault && set(e.target.dataset.agentDefault, null));
    }
    const gen = el.querySelector('#general');
    if (gen) {
      saveForm(gen, '/api/helpdesk/settings/general', (f) => {
        const fd = new FormData(f);
        const sla = Object.fromEntries(Object.keys(TICKET_PRIORITY).map((k) => [k, { firstResponse: fd.get(`sla.${k}.firstResponse`), resolution: fd.get(`sla.${k}.resolution`) }]));
        return { categories: fd.get('categories'), sla, autoCloseDays: fd.get('autoCloseDays'), autoAcknowledge: f.autoAcknowledge.checked, ackTemplate: fd.get('ackTemplate') };
      });
      const cannedForm = (c = {}) => modal({
        title: c.id ? 'Edit saved reply' : 'New saved reply',
        submitLabel: 'Save',
        body: html`<label class="field"><span>Title</span><input name="title" value="${c.title || ''}" maxlength="80" required placeholder="e.g. Password reset steps" /></label>
          <label class="field"><span>Text</span><textarea name="body" rows="7" maxlength="4000" required>${c.body || ''}</textarea></label>`,
        onSubmit: async (f) => {
          const body = Object.fromEntries(new FormData(f));
          s = c.id ? await api.put(`/api/helpdesk/canned/${c.id}`, body) : await api.post('/api/helpdesk/canned', body);
          toast('Saved reply stored.');
          render();
        },
      });
      el.querySelector('#add-canned').addEventListener('click', () => cannedForm());
      el.querySelector('#tab').addEventListener('click', async (e) => {
        const edit = e.target.closest('[data-edit-canned]')?.dataset.editCanned;
        if (edit) return cannedForm(s.canned.find((c) => c.id === edit));
        const del = e.target.closest('[data-del-canned]')?.dataset.delCanned;
        if (del && (await confirmDialog('Delete this saved reply?', { title: 'Delete saved reply' }))) {
          s = await api.del(`/api/helpdesk/canned/${del}`);
          render();
        }
      });
    }
  }
  render();
}
