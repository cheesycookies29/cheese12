// Sales & CRM screens: overview, pipeline board, leads, accounts, contacts, bids, contracts,
// activities and the sales setup. Every record page has the same layout: a header with its
// status, the details, related records, and a timeline where people log calls, meetings,
// emails, notes and tasks next to the automatic history.
import { api } from '../api.js';
import { ctx, can, roleLabel } from '../state.js';
import { html, mount, badge, toast, modal, confirmDialog, money, fmtDate, today, downloadFile, toCsv } from '../ui.js';
import { icon } from '../icons.js';
import { startProject } from './projects.js';
import {
  ACCOUNT_TYPES, SECTORS, LEAD_STATUS, OPEN_LEAD, BID_STATUS, OPEN_BID, BID_MODES, CONTRACT_STATUS, ACTIVITY_TYPES,
  stageList, isOpenDeal, daysBetween,
} from '/shared/crm.js';

// ---------- Small helpers ----------
const changed = () => window.dispatchEvent(new Event('crm:changed'));
const plural = (n, w, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;
// ₱950, ₱12K, ₱1.25M, ₱100B: rounds into the next unit (₱999,600 is ₱1M, not ₱1000K).
const short = (n) => {
  const v = Number(n) || 0;
  const unit = (x, u) => `₱${Number(x.toFixed(x >= 10 ? 1 : 2))}${u}`;
  if (v >= 999.5e6) return unit(v / 1e9, 'B');
  if (v >= 999.5e3) return unit(v / 1e6, 'M');
  if (v >= 1e3) return `₱${Math.round(v / 1e3)}K`;
  return `₱${Math.round(v)}`;
};
// An inline action (a tick, a delete): a refusal from the server is shown, then `after` redraws
// the screen so it matches what was saved.
const guard = (fn, after) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    toast(err.message, 'error');
    try {
      await after?.();
    } catch {
      window.dispatchEvent(new HashChangeEvent('hashchange')); // the page again, or Not found
    }
  }
};
// Load the current page again (after a refusal that means the screen is out of date).
const reloadPage = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const initials = (name) => (name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const ownerChip = (name) => (name ? html`<span class="crm-owner" title="${name}"><span class="avatar xs">${initials(name)}</span>${name}</span>` : html`<span class="muted">No owner</span>`);
const info = (label, value) => html`<div class="info"><dt>${label}</dt><dd>${value || value === 0 ? value : html`<span class="muted">—</span>`}</dd></div>`;
const canEdit = () => can('crm.edit');
const canManage = () => can('crm.manage');

const KINDS = {
  account: { type: { prospect: 'blue', client: 'green', partner: 'brand', supplier: 'gray', other: 'gray' } },
  lead: { new: 'amber', contacted: 'blue', qualified: 'green', disqualified: 'gray', converted: 'brand' },
  bid: { preparing: 'amber', submitted: 'blue', evaluation: 'blue', awarded: 'green', lost: 'gray', cancelled: 'gray' },
  contract: { draft: 'gray', active: 'green', expired: 'gray', terminated: 'gray' },
};
const accountBadge = (t) => badge(ACCOUNT_TYPES[t] || t, KINDS.account.type[t]);
const leadBadge = (s) => badge(LEAD_STATUS[s] || s, KINDS.lead[s]);
const bidBadge = (s) => badge(BID_STATUS[s] || s, KINDS.bid[s]);
const stageBadge = (d) => badge(d.stageName, d.stage === 'won' ? 'green' : d.stage === 'lost' ? 'gray' : 'blue');
function contractBadge(c, notice) {
  if (c.status === 'active' && c.renewalOpen) return badge(`Renewal ${c.renewalOpen} open`, 'blue');
  if (c.status === 'active' && c.daysLeft !== null && c.daysLeft < 0) return badge('Past end date', 'amber');
  if (c.status === 'active' && c.daysLeft !== null && c.daysLeft <= notice) return badge(`Renew in ${plural(c.daysLeft, 'day')}`, 'amber');
  return badge(CONTRACT_STATUS[c.status] || c.status, KINDS.contract[c.status]);
}
const clock = (hm) => {
  const [h, mm] = hm.split(':').map(Number);
  return `${h % 12 || 12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
function deadlineText(b) {
  if (b.status !== 'preparing' || b.daysLeft === null) return b.deadline ? fmtDate(b.deadline.slice(0, 10)) : '—';
  if (b.daysLeft < 0) return html`<span class="crm-due bad">Deadline passed</span>`;
  if (b.daysLeft === 0) return html`<span class="crm-due bad">Due today${b.deadline.length > 10 ? `, ${clock(b.deadline.slice(11))}` : ''}</span>`;
  return html`<span class="crm-due ${b.daysLeft <= 3 ? 'bad' : b.daysLeft <= 7 ? 'warn' : ''}">${plural(b.daysLeft, 'day')} left</span>`;
}

let metaCache = null;
async function meta() {
  metaCache = await api.get('/api/crm/meta');
  return metaCache;
}
const option = (value, label, selected) => html`<option value="${value}" ${String(selected ?? '') === String(value) ? 'selected' : ''}>${label}</option>`;
const options = (pairs, selected, blank) => html`${blank !== undefined ? option('', blank, selected) : ''}${pairs.map(([v, l]) => option(v, l, selected))}`;

// ---------- Forms in a dialog, from a list of fields ----------
// field: { name, label, type, options: [[value, label]], required, span, hint, placeholder, blank }
function fieldHtml(f, v) {
  const val = v ?? f.value ?? '';
  const req = f.required ? html`<em>*</em>` : '';
  const cls = `field ${f.span ? 'span-2' : ''}`;
  if (f.type === 'checkbox') return html`<label class="field check ${f.span ? 'span-2' : ''}"><input type="checkbox" name="${f.name}" ${val ? 'checked' : ''} /><span>${f.label}</span></label>`;
  if (f.type === 'select') return html`<label class="${cls}"><span>${f.label}${req}</span><select name="${f.name}" ${f.required ? 'aria-required="true"' : ''}>${options(f.options, val, f.blank)}</select>${f.hint ? html`<small class="hint">${f.hint}</small>` : ''}</label>`;
  if (f.type === 'textarea') return html`<label class="${cls}"><span>${f.label}${req}</span><textarea name="${f.name}" rows="${f.rows || 3}" placeholder="${f.placeholder || ''}">${val}</textarea>${f.hint ? html`<small class="hint">${f.hint}</small>` : ''}</label>`;
  if (f.type === 'datalist') return html`<label class="${cls}"><span>${f.label}${req}</span><input name="${f.name}" list="dl-${f.name}" value="${val}" placeholder="${f.placeholder || ''}" /><datalist id="dl-${f.name}">${f.options.map((o) => html`<option value="${o}"></option>`)}</datalist></label>`;
  const hint = f.hint ? html`<small class="hint">${f.hint}</small>` : '';
  if (f.type === 'number') return html`<label class="${cls}"><span>${f.label}${req}</span><input name="${f.name}" type="number" min="0" step="0.01" inputmode="decimal" value="${val}" placeholder="${f.placeholder || ''}" ${f.required ? 'aria-required="true"' : ''} />${hint}</label>`;
  return html`<label class="${cls}"><span>${f.label}${req}</span><input name="${f.name}" type="${f.type || 'text'}" value="${val}" placeholder="${f.placeholder || ''}" ${f.required ? 'required' : ''} />${hint}</label>`;
}
function formValues(form, fields) {
  const fd = new FormData(form);
  return Object.fromEntries(fields.map((f) => [f.name, f.type === 'checkbox' ? form.elements[f.name].checked : fd.get(f.name)]));
}
function recordForm({ title, subtitle, fields, values = {}, submitLabel = 'Save', onSubmit }) {
  let stale = false;
  return modal({
    title, subtitle, wide: true, submitLabel, className: 'crm-form',
    body: html`<div class="grid two">${fields.map((f) => fieldHtml(f, values[f.name]))}</div>`,
    onSubmit: async (form) => {
      try {
        await onSubmit(formValues(form, fields), form);
      } catch (err) {
        // Someone else saved this record: closing the form loads their version.
        if (err.status === 409 && /changed by/.test(err.message)) stale = true;
        throw err;
      }
    },
    onClose: () => stale && reloadPage(),
  });
}
// The team, plus the record's current owner if they have since lost CRM access (so saving the
// form does not hand the record to someone else without anyone choosing to).
const teamOptions = (m, rec = {}) => [...m.team.map((u) => [u.id, u.name]), ...(rec.ownerId && !m.team.some((u) => u.id === rec.ownerId) ? [[rec.ownerId, `${rec.ownerName || 'Former user'} (no CRM access)`]] : [])];

// ---------- Record forms ----------
async function lists() {
  const [accounts, contacts, deals] = await Promise.all([api.get('/api/crm/accounts'), api.get('/api/crm/contacts'), api.get('/api/crm/deals')]);
  return { accounts, contacts, deals };
}
const accountFields = (m, rec = {}) => [
  { name: 'name', label: 'Organization name', required: true, span: 2 },
  { name: 'type', label: 'Relationship', type: 'select', options: Object.entries(ACCOUNT_TYPES) },
  { name: 'sector', label: 'Sector', type: 'select', options: Object.entries(SECTORS) },
  { name: 'industry', label: 'Industry', type: 'datalist', options: m.setup.industries },
  { name: 'tin', label: 'TIN' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'phone', label: 'Phone' },
  { name: 'website', label: 'Website' },
  { name: 'ownerId', label: 'Owner', type: 'select', options: teamOptions(m, rec) },
  { name: 'address', label: 'Address', span: 2 },
  { name: 'tags', label: 'Tags', placeholder: 'Comma-separated, e.g. LGU, renewal', span: 2 },
  { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
];
export async function editAccount(rec = {}, after) {
  const m = await meta();
  recordForm({
    title: rec.id ? 'Edit account' : 'New account', subtitle: 'An organization you sell to or work with: client, prospect, partner or supplier.',
    fields: accountFields(m, rec), values: { ownerId: ctx.user.id, ...rec, tags: (rec.tags || []).join(', ') },
    onSubmit: async (v) => {
      const saved = rec.id ? await api.put(`/api/crm/accounts/${rec.id}`, { ...v, updatedAt: rec.updatedAt }) : await api.post('/api/crm/accounts', v);
      toast(rec.id ? 'Account saved.' : 'Account added.');
      after?.(saved);
    },
  });
}
async function editContact(rec = {}, after) {
  const [m, { accounts }] = await Promise.all([meta(), lists()]);
  recordForm({
    title: rec.id ? 'Edit contact' : 'New contact',
    fields: [
      { name: 'firstName', label: 'First name', required: true }, { name: 'lastName', label: 'Last name' },
      { name: 'title', label: 'Position' }, { name: 'accountId', label: 'Organization', type: 'select', options: accounts.map((a) => [a.id, a.name]), blank: 'None' },
      { name: 'email', label: 'Email', type: 'email' }, { name: 'mobile', label: 'Mobile' }, { name: 'phone', label: 'Office phone' },
      { name: 'ownerId', label: 'Owner', type: 'select', options: teamOptions(m, rec) },
      { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
    ],
    values: { ownerId: ctx.user.id, ...rec },
    onSubmit: async (v) => {
      const saved = rec.id ? await api.put(`/api/crm/contacts/${rec.id}`, { ...v, updatedAt: rec.updatedAt }) : await api.post('/api/crm/contacts', v);
      toast(rec.id ? 'Contact saved.' : 'Contact added.');
      after?.(saved);
    },
  });
}
async function editLead(rec = {}, after) {
  const m = await meta();
  const statuses = Object.entries(LEAD_STATUS).filter(([k]) => k !== 'converted');
  recordForm({
    title: rec.id ? 'Edit lead' : 'New lead', subtitle: 'Someone who showed interest but is not qualified yet. Convert it when there is a real opportunity.',
    fields: [
      { name: 'name', label: 'Name', required: true }, { name: 'company', label: 'Company or organization' },
      { name: 'title', label: 'Position' }, { name: 'source', label: 'Source', type: 'select', options: m.setup.sources.map((s) => [s, s]) },
      { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Phone' },
      { name: 'estimatedValue', label: 'Estimated value (₱)', type: 'number' }, { name: 'status', label: 'Status', type: 'select', options: statuses },
      { name: 'ownerId', label: 'Owner', type: 'select', options: teamOptions(m, rec) },
      { name: 'disqualifiedReason', label: 'If disqualified, why', placeholder: 'e.g. budget below our minimum' },
      { name: 'interest', label: 'What they need', type: 'textarea', span: 2, rows: 4 },
    ],
    values: { ownerId: ctx.user.id, source: m.setup.sources[0], status: 'new', ...rec },
    onSubmit: async (v) => {
      const saved = rec.id ? await api.put(`/api/crm/leads/${rec.id}`, { ...v, updatedAt: rec.updatedAt }) : await api.post('/api/crm/leads', v);
      toast(rec.id ? 'Lead saved.' : 'Lead added.');
      changed();
      after?.(saved);
    },
  });
}
async function editDeal(rec = {}, after) {
  const [m, { accounts, contacts }] = await Promise.all([meta(), lists()]);
  if (!accounts.length) return toast('Add the account (organization) first, then its deals.', 'error');
  const { form } = recordForm({
    title: rec.id ? 'Edit deal' : 'New deal', subtitle: 'A qualified opportunity with a value and an expected close date.',
    fields: [
      { name: 'title', label: 'Deal name', required: true, span: 2, placeholder: 'e.g. HRIS and payroll for 3 hotels' },
      { name: 'accountId', label: 'Account', type: 'select', options: accounts.map((a) => [a.id, a.name]), required: true, blank: rec.accountId ? undefined : 'Choose…' },
      { name: 'contactId', label: 'Main contact', type: 'select', options: contacts.map((c) => [c.id, `${c.name}${c.accountName ? ` · ${c.accountName}` : ''}`]), blank: 'None' },
      { name: 'value', label: 'Value (₱)', type: 'number', required: true }, { name: 'expectedClose', label: 'Expected close', type: 'date' },
      // Won and Lost are set on the board or the deal's stage bar, which ask for the lost reason.
      { name: 'stage', label: 'Stage', type: 'select', options: stageList(m.setup).filter((s) => !['won', 'lost'].includes(s.id) || s.id === rec.stage).map((s) => [s.id, `${s.name} (${s.probability}%)`]), hint: rec.id ? 'To mark it won or lost, use the stage bar on the deal.' : '' },
      { name: 'ownerId', label: 'Owner', type: 'select', options: teamOptions(m, rec) },
      { name: 'source', label: 'Source', type: 'select', options: m.setup.sources.map((s) => [s, s]), blank: '—' },
      { name: 'nextStep', label: 'Next step', placeholder: 'e.g. Demo to the deans on Friday' },
      { name: 'description', label: 'Description', type: 'textarea', span: 2 },
    ],
    values: { ownerId: ctx.user.id, stage: m.setup.stages[0].id, ...rec },
    onSubmit: async (v) => {
      if (v.value === '' || v.value == null) throw new Error('Enter the deal value. Use 0 if it is not known yet.');
      const saved = rec.id ? await api.put(`/api/crm/deals/${rec.id}`, { ...v, updatedAt: rec.updatedAt }) : await api.post('/api/crm/deals', { ...v, renewalOf: rec.renewalOf || null });
      toast(rec.id ? 'Deal saved.' : 'Deal added.');
      after?.(saved);
    },
  });
  // The main contact list shows the chosen account's contacts (and people without an account).
  const pickContacts = () => {
    const sel = form.elements.contactId;
    const keep = sel.value;
    const list = contacts.filter((c) => !c.accountId || c.accountId === form.elements.accountId.value);
    sel.innerHTML = '';
    sel.add(new Option('None', ''));
    for (const c of list) sel.add(new Option(c.name, c.id, false, c.id === keep));
  };
  form.elements.accountId.addEventListener('change', pickContacts);
  pickContacts();
}
// A linked-deal list that shows only the chosen account's deals (the server refuses others).
function dealsOfAccount(form, deals, label = (x) => `${x.code} · ${x.title}`) {
  const sel = form.elements.dealId;
  const refill = () => {
    const keep = sel.value;
    sel.innerHTML = '';
    sel.add(new Option('None', ''));
    for (const x of deals.filter((d) => d.accountId === form.elements.accountId.value)) sel.add(new Option(label(x), x.id, false, x.id === keep));
  };
  form.elements.accountId.addEventListener('change', refill);
  refill();
}
async function editBid(rec = {}, after) {
  const [m, { accounts, deals }] = await Promise.all([meta(), lists()]);
  if (!accounts.length) return toast('Add the procuring entity as an account first.', 'error');
  const { form } = recordForm({
    title: rec.id ? 'Edit bid' : 'New bid', subtitle: 'A public tender or RFP. The document checklist from the sales setup is added to every new bid.',
    fields: [
      { name: 'title', label: 'Project or tender title', required: true, span: 2 },
      { name: 'accountId', label: 'Procuring entity or client', type: 'select', options: accounts.map((a) => [a.id, a.name]), required: true, blank: rec.accountId ? undefined : 'Choose…' },
      { name: 'reference', label: 'Reference no.', placeholder: 'e.g. PhilGEPS or ITB number' },
      { name: 'mode', label: 'Procurement mode', type: 'select', options: Object.entries(BID_MODES) },
      { name: 'status', label: 'Status', type: 'select', options: Object.entries(BID_STATUS) },
      { name: 'budget', label: 'Approved budget, ABC (₱)', type: 'number' }, { name: 'bidAmount', label: 'Our bid (₱)', type: 'number', hint: 'Government bids above the ABC are rejected.' },
      { name: 'deadline', label: 'Submission deadline', type: 'datetime-local' }, { name: 'openingDate', label: 'Bid opening', type: 'date' },
      { name: 'preBidDate', label: 'Pre-bid conference', type: 'date' },
      { name: 'dealId', label: 'Linked deal', type: 'select', options: deals.filter((x) => isOpenDeal(x) || x.id === rec.dealId).map((x) => [x.id, `${x.code} · ${x.title}`]), blank: 'None', hint: 'An award closes the deal as won.' },
      { name: 'ownerId', label: 'Owner', type: 'select', options: teamOptions(m, rec) },
      { name: 'notes', label: 'Notes', type: 'textarea', span: 2, placeholder: 'Bid bulletins, clarifications, post-qualification…' },
    ],
    values: { ownerId: ctx.user.id, status: 'preparing', mode: 'public', ...rec },
    onSubmit: async (v) => {
      let saved;
      try {
        saved = rec.id ? await api.put(`/api/crm/bids/${rec.id}`, { ...v, updatedAt: rec.updatedAt }) : await api.post('/api/crm/bids', v);
      } catch (err) {
        if (!/not ticked/.test(err.message)) throw err;
        if (!(await confirmDialog(`${err.message} Mark the bid as submitted anyway?`, { confirmLabel: 'Mark as submitted', danger: false, title: 'Checklist incomplete' }))) throw new Error('Not saved. Tick the documents on the checklist first.');
        saved = await api.put(`/api/crm/bids/${rec.id}`, { ...v, updatedAt: rec.updatedAt, submitAnyway: true });
      }
      toast(saved.status === 'awarded' && rec.status !== 'awarded' && saved.dealId ? 'Bid awarded. The linked deal is marked as won.' : rec.id ? 'Bid saved.' : 'Bid added.');
      after?.(saved);
    },
  });
  dealsOfAccount(form, deals.filter((x) => isOpenDeal(x) || x.id === rec.dealId));
}
async function editContract(rec = {}, after) {
  const [m, { accounts, deals }] = await Promise.all([meta(), lists()]);
  if (!accounts.length) return toast('Add the client as an account first.', 'error');
  const { form } = recordForm({
    title: rec.id ? 'Edit contract' : 'New contract',
    fields: [
      { name: 'title', label: 'Contract title', required: true, span: 2 },
      { name: 'accountId', label: 'Client', type: 'select', options: accounts.map((a) => [a.id, a.name]), required: true, blank: rec.accountId ? undefined : 'Choose…' },
      { name: 'number', label: 'Contract or PO no.' },
      { name: 'value', label: 'Value (₱)', type: 'number' }, { name: 'status', label: 'Status', type: 'select', options: Object.entries(CONTRACT_STATUS) },
      { name: 'startDate', label: 'Start', type: 'date' }, { name: 'endDate', label: 'End', type: 'date', hint: `Shown for renewal ${m.setup.renewalNoticeDays} days before.` },
      { name: 'billing', label: 'Billing', placeholder: 'e.g. Quarterly, 50% on signing' },
      { name: 'dealId', label: 'From deal', type: 'select', options: deals.map((x) => [x.id, `${x.code} · ${x.title}`]), blank: 'None' },
      { name: 'ownerId', label: 'Owner', type: 'select', options: teamOptions(m, rec) },
      { name: 'autoRenew', label: 'Renews automatically', type: 'checkbox' },
      { name: 'terms', label: 'Key terms', type: 'textarea', span: 2 },
    ],
    values: { ownerId: ctx.user.id, status: 'active', ...rec },
    onSubmit: async (v) => {
      const saved = rec.id ? await api.put(`/api/crm/contracts/${rec.id}`, { ...v, updatedAt: rec.updatedAt }) : await api.post('/api/crm/contracts', v);
      toast(rec.id ? 'Contract saved.' : 'Contract recorded.');
      after?.(saved);
    },
  });
  dealsOfAccount(form, deals);
}

async function removeRecord(kind, rec, label, backHref) {
  if (!(await confirmDialog(`Delete ${label}? Its notes and history go with it. This cannot be undone.`, { title: `Delete ${kind}` }))) return;
  try {
    await api.del(`/api/crm/${kind === 'opportunity' ? 'deals' : `${kind}s`}/${rec.id}`);
  } catch (err) {
    return toast(err.message, 'error');
  }
  toast('Deleted.');
  changed();
  // Replace the page in the history, so Back does not open the deleted record.
  location.replace(backHref);
}

// ---------- Timeline: log activities, schedule tasks, see history ----------
const ACT_ICON = { call: 'headset', meeting: 'users', email: 'mail', task: 'check', note: 'comment', event: 'activity' };
async function timeline(el, type, id) {
  const m = metaCache || (await meta());
  let kind = 'note';
  const LABELS = {
    subject: (k) => (k === 'note' ? 'Title (optional)' : k === 'task' ? 'What needs doing?' : `${ACTIVITY_TYPES[k]} subject`),
    body: (k) => (k === 'note' ? 'Write a note…' : 'Details, outcome or agenda (optional)'),
    date: (k) => (k === 'task' ? 'Due' : 'Schedule for'),
    submit: (k) => (k === 'task' ? 'Add task' : k === 'note' ? 'Save note' : `Log ${ACTIVITY_TYPES[k].toLowerCase()}`),
  };
  async function render() {
    const list = await api.get(`/api/crm/activities?type=${type}&id=${id}`);
    const open = list.filter((a) => a.type !== 'event' && !a.done).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
    const past = list.filter((a) => !open.includes(a));
    const row = (a) => {
      const overdue = !a.done && a.dueDate && a.dueDate < today();
      return html`<li class="crm-act ${a.type} ${a.done ? 'done' : ''}">
        <span class="crm-act-ic">${icon(ACT_ICON[a.type] || 'file', 16)}</span>
        <div class="grow">
          <div class="crm-act-head">
            ${a.type !== 'event' && canEdit() && (!a.done || a.type === 'task' || a.dueDate) ? html`<label class="crm-tick" title="${a.done ? 'Mark as not done' : 'Mark as done'}"><input type="checkbox" data-done="${a.id}" ${a.done ? 'checked' : ''} /></label>` : ''}
            <strong>${a.subject}</strong>
            ${a.type !== 'event' ? html`<span class="badge gray">${ACTIVITY_TYPES[a.type]}</span>` : ''}
            ${a.dueDate && a.type !== 'event' ? html`<span class="crm-due ${overdue ? 'bad' : a.dueDate === today() ? 'warn' : ''}">${a.done ? 'Due' : overdue ? 'Overdue ·' : 'Due'} ${fmtDate(a.dueDate)}${a.dueTime ? `, ${a.dueTime}` : ''}</span>` : ''}
          </div>
          ${a.body ? html`<p class="pre small">${a.body}</p>` : ''}
          <small class="muted">${a.type === 'event' ? '' : `${a.ownerName || a.createdByName || ''} · `}${when(a.createdAt)}${type === 'account' && a.related.type !== 'account' && a.relatedName ? html` · <a href="#/crm/${a.related.type}s/${a.related.id}">${a.relatedName}</a>` : ''}</small>
        </div>
        ${a.type !== 'event' && (a.createdBy === ctx.user.id || canManage()) ? html`<button type="button" class="icon-btn danger" data-del="${a.id}" aria-label="Delete">${icon('trash', 16)}</button>` : ''}
      </li>`;
    };
    mount(el, html`
      ${canEdit() ? html`<form class="crm-composer" id="composer" novalidate>
        <div class="seg-btns crm-seg" role="group" aria-label="Type of activity">${Object.entries(ACTIVITY_TYPES).map(([k, v]) => html`<button type="button" data-kind="${k}" class="${k === kind ? 'active' : ''}" aria-pressed="${k === kind ? 'true' : 'false'}">${icon(ACT_ICON[k], 14)} ${v}</button>`)}</div>
        <input name="subject" placeholder="${LABELS.subject(kind)}" aria-label="Subject" />
        <textarea name="body" rows="2" placeholder="${LABELS.body(kind)}" aria-label="Details"></textarea>
        <div class="crm-composer-foot">
          <label class="field inline"><span data-date-label>${LABELS.date(kind)}</span><input type="date" name="dueDate" value="${kind === 'task' ? today() : ''}" /></label>
          <label class="field inline"><span>Owner</span><select name="ownerId">${options(teamOptions(m), ctx.user.id)}</select></label>
          <span class="spacer"></span>
          <button class="btn primary" type="submit">${LABELS.submit(kind)}</button>
        </div>
        <p class="form-error" hidden></p>
      </form>` : ''}
      ${open.length ? html`<h3 class="crm-tl-h">Open and upcoming</h3><ul class="crm-timeline">${open.map(row)}</ul>` : ''}
      <h3 class="crm-tl-h">History</h3>
      ${past.length ? html`<ul class="crm-timeline">${past.map(row)}</ul>` : html`<p class="muted">Nothing logged yet.</p>`}`);
    const composer = el.querySelector('#composer');
    // Changing the type relabels the form; what is typed stays, and so does the focus.
    el.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
      const was = kind;
      kind = b.dataset.kind;
      composer.querySelectorAll('[data-kind]').forEach((x) => {
        x.classList.toggle('active', x === b);
        x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      });
      composer.subject.placeholder = LABELS.subject(kind);
      composer.body.placeholder = LABELS.body(kind);
      composer.querySelector('[data-date-label]').textContent = LABELS.date(kind);
      composer.querySelector('[type=submit]').textContent = LABELS.submit(kind);
      // A task is due today unless a date was chosen; that default does not follow it to a note.
      if (kind === 'task' && !composer.dueDate.value) composer.dueDate.value = today();
      else if (was === 'task' && kind !== 'task' && composer.dueDate.value === today()) composer.dueDate.value = '';
    }));
    composer?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const err = f.querySelector('.form-error');
      const btn = f.querySelector('[type=submit]');
      if (btn.disabled) return; // a double click saves once
      btn.disabled = true;
      try {
        await api.post('/api/crm/activities', { type: kind, subject: f.subject.value, body: f.body.value, dueDate: f.dueDate.value || null, ownerId: f.ownerId.value, related: { type, id } });
        toast(kind === 'task' ? 'Task added.' : 'Saved.');
        changed();
        render();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        btn.disabled = false;
      }
    });
    el.querySelectorAll('[data-done]').forEach((cb) => cb.addEventListener('change', guard(async () => {
      await api.put(`/api/crm/activities/${cb.dataset.done}`, { done: cb.checked });
      changed();
      render();
    }, render)));
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', guard(async () => {
      if (!(await confirmDialog('Delete this activity?', { title: 'Delete activity' }))) return;
      await api.del(`/api/crm/activities/${b.dataset.del}`);
      toast('Activity deleted.');
      changed();
      render();
    }, render)));
  }
  await render();
}

// The projects delivering a deal or contract (Project Management).
const PROJECT_STATUS_LABEL = { planning: 'Planning', active: 'Active', on_hold: 'On hold', completed: 'Completed', cancelled: 'Cancelled' };
const projectsCard = (list, empty) => html`<section class="card"><h2>${icon('layers')} Projects</h2>
  ${list.length ? html`<ul class="crm-mini">${list.map((p) => html`<li><span class="grow"><a href="#/projects/${p.id}"><strong>${p.name}</strong></a><small class="mono">${p.code}</small></span>${badge(PROJECT_STATUS_LABEL[p.status] || p.status, p.status === 'active' ? 'green' : p.status === 'planning' ? 'blue' : 'gray')}</li>`)}</ul>` : html`<p class="muted small">${empty}</p>`}</section>`;

// ---------- Shared page pieces ----------
const head = (title, sub, actions = '', back = '') => html`
  <header class="page-head">
    <div>${back ? html`<a class="back" href="#${back[0]}">← ${back[1]}</a>` : ''}<h1>${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : ''}</div>
    ${actions ? html`<div class="actions">${actions}</div>` : ''}
  </header>`;
const searchBox = (placeholder) => html`<input type="search" id="q" placeholder="${placeholder}" aria-label="${placeholder}" />`;
const ownerFilter = (m) => html`<select id="f-owner" aria-label="Owner"><option value="">Everyone</option><option value="me">Mine</option>${m.team.map((u) => html`<option value="${u.id}">${u.name}</option>`)}</select>`;
const matchOwner = (rec, v) => !v || (v === 'me' ? rec.ownerId === ctx.user.id : rec.ownerId === v);
const matchText = (q, ...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q));
const exportBtn = html`<button type="button" class="btn" id="export">${icon('download', 16)} Export CSV</button>`;

// A list page: filters on top, a table, CSV export, rows that open the record.
function listPage(el, { load, render, csv, filename }) {
  let rows = [];
  const state = { q: '', owner: '', status: '' };
  const draw = () => {
    const shown = rows.filter((r) => render.filter(r, state));
    mount(el.querySelector('#count'), plural(shown.length, render.noun || 'record'));
    mount(el.querySelector('#list'), shown.length ? render.table(shown) : html`<div class="empty"><p>${rows.length ? 'Nothing matches the filters.' : render.empty}</p></div>`);
    el.querySelectorAll('#list tbody tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => !e.target.closest('a, button') && (location.hash = tr.dataset.href)));
  };
  el.querySelector('#q')?.addEventListener('input', (e) => ((state.q = e.target.value.trim().toLowerCase()), draw()));
  el.querySelector('#f-owner')?.addEventListener('change', (e) => ((state.owner = e.target.value), draw()));
  el.querySelector('#f-status')?.addEventListener('change', (e) => ((state.status = e.target.value), draw()));
  el.querySelector('#export')?.addEventListener('click', () => downloadFile(filename, toCsv(csv(rows.filter((r) => render.filter(r, state))))));
  return (async () => {
    rows = await load();
    draw();
  })();
}

// ---------- Overview ----------
export async function crmOverviewView(el) {
  const [ov, m] = await Promise.all([api.get('/api/crm/overview'), meta()]);
  const maxStage = Math.max(1, ...ov.byStage.map((s) => s.value));
  const maxF = Math.max(1, ...ov.forecast.map((f) => f.value));
  const monthName = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
  const stat = (label, value, sub, href, cls = '') => html`<a class="card ${cls}" href="#${href}"><small>${label}</small><strong>${value}</strong>${sub ? html`<span class="muted small">${sub}</span>` : ''}</a>`;
  mount(el, html`
    ${head('Sales & CRM', `${ctx.settings.companyName} pipeline, bids and renewals.`, html`
      <div class="crm-search"><input type="search" id="crm-q" placeholder="Search accounts, people, deals, bids…" aria-label="Search the CRM" autocomplete="off" /><div class="crm-search-pop" id="crm-hits" hidden></div></div>
      ${canEdit() ? html`<button class="btn" id="new-lead">+ Lead</button><button class="btn primary" id="new-deal">+ Deal</button>` : ''}`)}
    <div class="stats">
      ${stat('Open pipeline', short(ov.openValue), plural(ov.openCount, 'open deal'), '/crm/pipeline', 'accent')}
      ${stat('Weighted forecast', short(ov.weightedValue), 'value × stage probability', '/crm/pipeline')}
      ${stat('Won this quarter', short(ov.wonQuarter.value), `${plural(ov.wonQuarter.count, 'deal')} · ${short(ov.wonMonth.value)} this month`, '/crm/pipeline?view=list&stage=won')}
      ${stat('Win rate, 90 days', ov.winRate === null ? '—' : `${ov.winRate}%`, ov.closed90 ? `of ${plural(ov.closed90, 'closed deal')}` : 'no deals closed yet', '/crm/pipeline?view=list')}
      ${stat('Open leads', ov.openLeads, ov.newLeads ? `${ov.newLeads} new, not contacted` : 'all followed up', '/crm/leads', ov.newLeads ? 'attention' : '')}
    </div>
    <div class="cols wide-left">
      <section class="card">
        <div class="card-head"><h2>${icon('chart')} Pipeline by stage</h2><a href="#/crm/pipeline">Open the board</a></div>
        ${ov.openCount ? html`<div class="crm-funnel">${ov.byStage.map((s) => html`<a class="crm-funnel-row" href="#/crm/pipeline">
            <span class="crm-funnel-name">${s.name}<small>${s.probability}%</small></span>
            <span class="crm-funnel-bar"><i style="width:${Math.max(2, Math.round((s.value / maxStage) * 100))}%"></i></span>
            <span class="crm-funnel-val"><strong>${short(s.value)}</strong><small>${plural(s.count, 'deal')}</small></span></a>`)}</div>`
          : html`<p class="muted">No open deals yet. ${canEdit() ? 'Add one, or convert a qualified lead.' : ''}</p>`}
        <h3>Weighted forecast by expected close</h3>
        <div class="crm-forecast">${ov.forecast.map((f) => html`<div><span class="crm-fc-bar"><i style="height:${Math.max(3, Math.round((f.value / maxF) * 100))}%"></i></span><strong>${short(f.value)}</strong><small>${monthName(f.month)}</small></div>`)}</div>
        ${ov.overdueClose ? html`<p class="notice small">${icon('alert', 16)} <span>${plural(ov.overdueClose, 'open deal')} ${ov.overdueClose === 1 ? 'is' : 'are'} past the expected close date. <a href="#/crm/pipeline?view=list&overdue=1">Review them</a>.</span></p>` : ''}
      </section>
      <section class="card">
        <div class="card-head"><h2>${icon('check')} My tasks</h2><a href="#/crm/activities">All activities</a></div>
        ${ov.myTasks.length ? html`<ul class="crm-mini">${ov.myTasks.map((t) => html`<li>
            <label class="crm-tick"><input type="checkbox" data-done="${t.id}" aria-label="Done: ${t.subject}" /></label>
            <span class="grow"><strong>${t.subject}</strong><small>${t.relatedName ? html`<a href="#/crm/${t.related.type}s/${t.related.id}">${t.relatedName}</a> · ` : ''}<span class="crm-due ${t.dueDate < today() ? 'bad' : 'warn'}">${t.dueDate < today() ? `Overdue, ${fmtDate(t.dueDate)}` : 'Today'}</span></small></span></li>`)}</ul>`
          : html`<p class="muted">Nothing due today.${ov.myUpcoming ? ` ${plural(ov.myUpcoming, 'task')} coming up.` : ''}</p>`}
      </section>
    </div>
    <div class="cols">
      <section class="card">
        <div class="card-head"><h2>${icon('clipboard')} Bid deadlines</h2><a href="#/crm/bids">All bids</a></div>
        ${ov.bids.length ? html`<ul class="crm-mini">${ov.bids.map((b) => html`<li><span class="grow"><a href="#/crm/bids/${b.id}"><strong>${b.title}</strong></a><small>${b.accountName} · ${b.checklistDone}/${b.checklist.length} documents</small></span>${deadlineText(b)}</li>`)}</ul>` : html`<p class="muted">No bids being prepared.</p>`}
      </section>
      <section class="card">
        <div class="card-head"><h2>${icon('file')} Renewals coming up</h2><a href="#/crm/contracts">All contracts</a></div>
        ${ov.contracts.length ? html`<ul class="crm-mini">${ov.contracts.map((c) => html`<li><span class="grow"><a href="#/crm/contracts/${c.id}"><strong>${c.title}</strong></a><small>${c.accountName} · ${money(c.value)}</small></span>${contractBadge(c, m.setup.renewalNoticeDays)}</li>`)}</ul>` : html`<p class="muted">No contract ends in the next ${m.setup.renewalNoticeDays} days.</p>`}
      </section>
      <section class="card">
        <div class="card-head"><h2>${icon('calendar')} Closing in 30 days</h2><a href="#/crm/pipeline?view=list">Pipeline</a></div>
        ${ov.closingSoon.length ? html`<ul class="crm-mini">${ov.closingSoon.map((x) => html`<li><span class="grow"><a href="#/crm/deals/${x.id}"><strong>${x.title}</strong></a><small>${x.accountName} · ${x.stageName}</small></span><span class="crm-amt">${short(x.value)}<small>${fmtDate(x.expectedClose)}</small></span></li>`)}</ul>` : html`<p class="muted">No deals expected to close this month.</p>`}
      </section>
    </div>`);
  el.querySelector('#new-lead')?.addEventListener('click', () => editLead({}, (l) => (location.hash = `#/crm/leads/${l.id}`)));
  el.querySelector('#new-deal')?.addEventListener('click', () => editDeal({}, (x) => (location.hash = `#/crm/deals/${x.id}`)));
  el.querySelectorAll('[data-done]').forEach((cb) => cb.addEventListener('change', guard(async () => {
    await api.put(`/api/crm/activities/${cb.dataset.done}`, { done: true });
    toast('Task done.');
    changed();
    const list = cb.closest('ul');
    cb.closest('li').remove();
    if (list && !list.children.length) list.replaceWith(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Nothing due today.' }));
  }, () => (cb.checked = false))));
  wireSearch(el);
}

function wireSearch(el) {
  const input = el.querySelector('#crm-q');
  const pop = el.querySelector('#crm-hits');
  if (!input) return;
  let timer;
  const LABEL = { account: 'Account', contact: 'Contact', lead: 'Lead', deal: 'Deal', bid: 'Bid', contract: 'Contract' };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) return (pop.hidden = true);
      const hits = await api.get(`/api/crm/search?q=${encodeURIComponent(q)}`);
      mount(pop, hits.length ? html`${hits.map((h) => html`<a href="#/crm/${h.type}s/${h.id}"><span class="badge gray">${LABEL[h.type]}</span><span class="grow"><strong>${h.title}</strong><small>${h.sub || ''}</small></span></a>`)}` : html`<p class="muted small">No matches.</p>`);
      pop.hidden = false;
    }, 200);
  });
  input.closest('.crm-search').addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || pop.hidden) return;
    pop.hidden = true;
    input.focus();
  });
  document.addEventListener('click', (e) => !e.target.closest('.crm-search') && (pop.hidden = true));
}

// ---------- Pipeline: board and list ----------
export async function pipelineView(el, _params, query) {
  const m = await meta();
  const stages = stageList(m.setup);
  const open = m.setup.stages;
  const state = { view: query.view === 'list' ? 'list' : 'board', q: '', owner: '', stage: query.stage || '', overdue: Boolean(query.overdue) };
  let deals = [];
  mount(el, html`
    ${head('Pipeline', html`<span id="count"></span>`, html`
      <div class="seg-btns crm-seg"><button type="button" data-v="board">${icon('grid', 14)} Board</button><button type="button" data-v="list">${icon('table', 14)} List</button></div>
      ${exportBtn}${canEdit() ? html`<button class="btn primary" id="new">+ Deal</button>` : ''}`)}
    <div class="toolbar">${searchBox('Search deal, account or code…')}${ownerFilter(m)}
      <select id="f-stage" aria-label="Stage"><option value="">All stages</option><option value="open">Open only</option>${stages.map((s) => option(s.id, s.name, state.stage))}</select>
      <label class="field check inline"><input type="checkbox" id="f-overdue" ${state.overdue ? 'checked' : ''} /><span>Past expected close</span></label>
    </div>
    <div id="board"></div>`);
  const filtered = () => deals.filter((x) => matchText(state.q, x.title, x.accountName, x.code, x.contactName) && matchOwner(x, state.owner)
    && (!state.stage || (state.stage === 'open' ? isOpenDeal(x) : x.stage === state.stage)) && (!state.overdue || (isOpenDeal(x) && x.expectedClose && x.expectedClose < today())));

  const card = (x) => html`<article class="crm-card" draggable="${canEdit() ? 'true' : 'false'}" data-id="${x.id}">
      <a href="#/crm/deals/${x.id}" class="crm-card-title">${x.title}</a>
      <span class="crm-card-acct">${x.accountName}</span>
      <div class="crm-card-foot"><strong>${short(x.value)}</strong>
        ${x.expectedClose ? html`<span class="crm-due ${isOpenDeal(x) && x.expectedClose < today() ? 'bad' : ''}">${icon('calendar', 12)} ${fmtDate(x.expectedClose, { month: 'short', day: 'numeric' })}</span>` : ''}
        <span class="avatar xs" title="${x.ownerName || ''}">${initials(x.ownerName)}</span></div>
      ${x.nextStep && isOpenDeal(x) ? html`<small class="crm-card-next">${icon('chevronRight', 12)} ${x.nextStep}</small>` : ''}
    </article>`;
  function draw() {
    const list = filtered();
    mount(el.querySelector('#count'), html`${plural(list.length, 'deal')} · ${short(list.filter(isOpenDeal).reduce((s, x) => s + x.value, 0))} open · ${short(list.filter(isOpenDeal).reduce((s, x) => s + x.weighted, 0))} weighted`);
    // Closed deals are not on the board: filtering by Won or Lost shows the list.
    if (state.view === 'board' && (state.stage === 'won' || state.stage === 'lost')) state.view = 'list';
    el.querySelectorAll('[data-v]').forEach((b) => b.classList.toggle('active', b.dataset.v === state.view));
    if (state.view === 'board') {
      const closed = list.filter((x) => !isOpenDeal(x));
      mount(el.querySelector('#board'), html`<div class="crm-board" style="--cols:${open.length}">${open.map((s) => {
        const inCol = list.filter((x) => x.stage === s.id);
        return html`<section class="crm-col" data-stage="${s.id}">
          <header><strong>${s.name}</strong><small>${s.probability}% · ${plural(inCol.length, 'deal')}</small><span class="crm-col-sum">${short(inCol.reduce((a, x) => a + x.value, 0))}</span></header>
          <div class="crm-col-body">${inCol.length ? inCol.map(card) : html`<p class="crm-col-empty">${canEdit() ? 'Drag deals here' : 'No deals'}</p>`}</div>
        </section>`;
      })}</div>
      <p class="muted small crm-closed-note">${icon('check', 14)} ${plural(closed.filter((x) => x.stage === 'won').length, 'deal')} won and ${closed.filter((x) => x.stage === 'lost').length} lost are in the <a href="#/crm/pipeline?view=list" data-to-list>list</a>.${canEdit() ? (matchMedia('(pointer: coarse)').matches ? ' To mark a deal won or lost, open it and use its stage bar.' : ' Drag a card to the bottom of the screen to mark it won or lost.') : ''}</p>
      <div class="crm-dropbar" id="dropbar" hidden>
        <div class="crm-drop won" data-stage="won">${icon('checkCircle', 20)} Won</div>
        <div class="crm-drop lost" data-stage="lost">${icon('x', 20)} Lost</div>
      </div>`);
      el.querySelector('[data-to-list]')?.addEventListener('click', (e) => (e.preventDefault(), (state.view = 'list'), draw()));
      wireBoard();
    } else {
      mount(el.querySelector('#board'), html`<section class="card scroll-x">${list.length ? html`<table class="table clickable stackable">
        <thead><tr><th>Deal</th><th>Account</th><th>Stage</th><th class="num">Value</th><th class="num">Weighted</th><th>Expected close</th><th>Owner</th></tr></thead>
        <tbody>${list.map((x) => html`<tr data-href="#/crm/deals/${x.id}"><td><a href="#/crm/deals/${x.id}"><strong>${x.title}</strong></a><small class="mono">${x.code}</small></td><td>${x.accountName}</td><td>${stageBadge(x)}${x.lostReason ? html`<small>${x.lostReason}</small>` : ''}</td><td class="num">${money(x.value)}</td><td class="num">${money(x.weighted)}</td>
          <td>${x.expectedClose ? html`<span class="${isOpenDeal(x) && x.expectedClose < today() ? 'crm-due bad' : ''}">${fmtDate(x.expectedClose)}</span>` : '—'}</td><td>${x.ownerName || '—'}</td></tr>`)}</tbody></table>`
        : html`<div class="empty"><p>No deals match.</p></div>`}</section>`);
      el.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => !e.target.closest('a') && (location.hash = tr.dataset.href)));
    }
  }
  function wireBoard() {
    if (!canEdit()) return;
    let dragId = null;
    const bar = el.querySelector('#dropbar');
    el.querySelectorAll('.crm-card').forEach((c) => {
      c.addEventListener('dragstart', (e) => {
        dragId = c.dataset.id;
        e.dataTransfer.setData('text/plain', dragId);
        e.dataTransfer.effectAllowed = 'move';
        requestAnimationFrame(() => {
          c.classList.add('dragging');
          bar.hidden = false;
        });
      });
      c.addEventListener('dragend', () => {
        c.classList.remove('dragging');
        bar.hidden = true;
      });
    });
    el.querySelectorAll('.crm-col, .crm-drop').forEach((zone) => {
      zone.addEventListener('dragover', (e) => (e.preventDefault(), zone.classList.add('over')));
      zone.addEventListener('dragleave', (e) => !zone.contains(e.relatedTarget) && zone.classList.remove('over'));
      zone.addEventListener('drop', async (e) => {
        e.preventDefault();
        zone.classList.remove('over');
        bar.hidden = true;
        const deal = deals.find((x) => x.id === (e.dataTransfer.getData('text/plain') || dragId));
        if (!deal || deal.stage === zone.dataset.stage) return;
        moveDeal(deal, zone.dataset.stage, async () => {
          deals = await api.get('/api/crm/deals');
          draw();
        });
      });
    });
  }
  el.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => {
    state.view = b.dataset.v;
    history.replaceState(null, '', `#/crm/pipeline${state.view === 'list' ? '?view=list' : ''}`);
    draw();
  }));
  el.querySelector('#q').addEventListener('input', (e) => ((state.q = e.target.value.trim().toLowerCase()), draw()));
  el.querySelector('#f-owner').addEventListener('change', (e) => ((state.owner = e.target.value), draw()));
  el.querySelector('#f-stage').addEventListener('change', (e) => ((state.stage = e.target.value), draw()));
  el.querySelector('#f-overdue').addEventListener('change', (e) => ((state.overdue = e.target.checked), draw()));
  el.querySelector('#new')?.addEventListener('click', () => editDeal({}, (x) => (location.hash = `#/crm/deals/${x.id}`)));
  el.querySelector('#export').addEventListener('click', () => downloadFile('deals.csv', toCsv([
    ['Code', 'Deal', 'Account', 'Contact', 'Stage', 'Probability %', 'Value', 'Weighted', 'Expected close', 'Owner', 'Source', 'Lost reason'],
    ...filtered().map((x) => [x.code, x.title, x.accountName, x.contactName, x.stageName, x.probability, x.value, x.weighted, x.expectedClose, x.ownerName, x.source, x.lostReason]),
  ])));
  deals = await api.get('/api/crm/deals');
  draw();
}

// Move a deal to another stage; losing it asks why.
async function moveDeal(deal, stage, after) {
  const m = metaCache || (await meta());
  const go = async (lostReason) => {
    await api.put(`/api/crm/deals/${deal.id}/stage`, { stage, lostReason });
    toast(stage === 'won' ? `Won: ${deal.title}` : stage === 'lost' ? 'Marked as lost.' : `Moved to ${stageList(m.setup).find((s) => s.id === stage)?.name}.`);
    changed();
    await after?.();
  };
  if (stage !== 'lost') return go().catch((err) => toast(err.message, 'error'));
  modal({
    title: 'Why was it lost?', subtitle: deal.title, submitLabel: 'Mark as lost',
    body: html`<label class="field"><span>Reason</span><select name="reason">${m.setup.lostReasons.map((r) => html`<option>${r}</option>`)}</select></label>`,
    onSubmit: (f) => go(f.reason.value),
  });
}

// ---------- Deal ----------
export async function dealView(el, { id }) {
  const [x, m] = await Promise.all([api.get(`/api/crm/deals/${id}`), meta()]);
  const stages = m.setup.stages;
  const idx = stages.findIndex((s) => s.id === x.stage);
  mount(el, html`
    ${head(html`${x.title} ${stageBadge(x)}`, html`<span class="mono">${x.code}</span> · <a href="#/crm/accounts/${x.accountId}">${x.accountName}</a>${x.contactName ? html` · <a href="#/crm/contacts/${x.contactId}">${x.contactName}</a>` : ''}`, html`
      ${x.stage === 'won' && can('pm.edit') ? html`<button class="btn primary" id="start-project">${icon('layers', 16)} Start project</button>` : ''}${canEdit() ? html`<button class="btn" id="edit">${icon('edit', 16)} Edit</button>` : ''}${canManage() ? html`<button class="btn danger ghost" id="del">Delete</button>` : ''}`, ['/crm/pipeline', 'Pipeline'])}
    <nav class="crm-path" aria-label="Stage">
      ${stages.map((s, i) => html`<button type="button" class="${x.stage === s.id ? 'cur' : (idx >= 0 && i < idx) || x.stage === 'won' ? 'past' : ''}" data-stage="${s.id}" ${x.stage === s.id ? 'aria-current="step"' : ''} ${canEdit() ? '' : 'disabled'}>${s.name}</button>`)}
      <span class="crm-path-break" aria-hidden="true"></span>
      <button type="button" class="won ${x.stage === 'won' ? 'cur' : ''}" data-stage="won" ${x.stage === 'won' ? 'aria-current="step"' : ''} ${canEdit() ? '' : 'disabled'}>${icon('check', 14)} Won</button>
      <button type="button" class="lost ${x.stage === 'lost' ? 'cur' : ''}" data-stage="lost" ${x.stage === 'lost' ? 'aria-current="step"' : ''} ${canEdit() ? '' : 'disabled'}>Lost</button>
    </nav>
    <div class="cols wide-left">
      <section class="card"><h2>Activity</h2><div id="timeline"></div></section>
      <div class="stack">
        <section class="card"><h2>Details</h2><dl class="info-grid">
          ${info('Value', money(x.value))}${info('Weighted', html`${money(x.weighted)} <small class="muted">(${x.probability}%)</small>`)}
          ${info('Expected close', x.expectedClose ? html`${fmtDate(x.expectedClose)}${isOpenDeal(x) && x.expectedClose < today() ? html` ${badge('Overdue', 'amber')}` : ''}` : '')}
          ${info('Owner', ownerChip(x.ownerName))}${info('Source', x.source)}${info('Next step', x.nextStep)}${x.renews ? info('Renews', html`<a href="#/crm/contracts/${x.renews.id}">${x.renews.code} · ${x.renews.title}</a>`) : ''}
          ${x.closedAt ? info(x.stage === 'won' ? 'Won on' : 'Lost on', fmtDate(x.closedAt.slice(0, 10))) : ''}${x.lostReason ? info('Lost reason', x.lostReason) : ''}
        </dl>${x.description ? html`<p class="pre small crm-desc">${x.description}</p>` : ''}</section>
        <section class="card"><div class="card-head"><h2>Bids</h2>${canEdit() ? html`<button class="btn small-btn" id="add-bid">+ Bid</button>` : ''}</div>
          ${x.bids.length ? html`<ul class="crm-mini">${x.bids.map((b) => html`<li><span class="grow"><a href="#/crm/bids/${b.id}"><strong>${b.title}</strong></a><small>${b.reference || b.code}</small></span>${bidBadge(b.status)}</li>`)}</ul>` : html`<p class="muted small">No bid linked. Add one if this goes through public bidding or an RFP.</p>`}</section>
        <section class="card"><div class="card-head"><h2>Contracts</h2>${canEdit() && x.stage === 'won' ? html`<button class="btn small-btn" id="add-contract">+ Contract</button>` : ''}</div>
          ${x.contracts.length ? html`<ul class="crm-mini">${x.contracts.map((c) => html`<li><span class="grow"><a href="#/crm/contracts/${c.id}"><strong>${c.title}</strong></a><small>${money(c.value)}</small></span>${contractBadge(c, m.setup.renewalNoticeDays)}</li>`)}</ul>` : html`<p class="muted small">${x.stage === 'won' ? 'Record the contract for this win.' : 'Recorded once the deal is won.'}</p>`}</section>
        ${projectsCard(x.projects, x.stage === 'won' ? 'Start the project that delivers this deal with Start project.' : 'A project is started once the deal is won.')}
      </div>
    </div>`);
  const reload = () => dealView(el, { id });
  el.querySelectorAll('[data-stage]').forEach((b) => b.addEventListener('click', () => b.dataset.stage !== x.stage && moveDeal(x, b.dataset.stage, reload)));
  el.querySelector('#edit')?.addEventListener('click', () => editDeal(x, reload));
  el.querySelector('#del')?.addEventListener('click', () => removeRecord('opportunity', x, `the deal "${x.title}"`, '#/crm/pipeline'));
  el.querySelector('#add-bid')?.addEventListener('click', () => editBid({ accountId: x.accountId, dealId: x.id, title: x.title, bidAmount: x.value }, (b) => (location.hash = `#/crm/bids/${b.id}`)));
  el.querySelector('#start-project')?.addEventListener('click', () => startProject('deal', x));
  el.querySelector('#add-contract')?.addEventListener('click', () => editContract({ accountId: x.accountId, dealId: x.id, title: x.title, value: x.value, startDate: today() }, (c) => (location.hash = `#/crm/contracts/${c.id}`)));
  await timeline(el.querySelector('#timeline'), 'deal', id);
}

// ---------- Leads ----------
export async function leadsView(el) {
  const m = await meta();
  mount(el, html`
    ${head('Leads', html`<span id="count"></span>. Qualify them, then convert the ones with a real opportunity.`, html`${exportBtn}${canEdit() ? html`<button class="btn primary" id="new">+ Lead</button>` : ''}`)}
    <section class="card scroll-x"><div class="toolbar pad">${searchBox('Search name, company or email…')}${ownerFilter(m)}
      <select id="f-status" aria-label="Status"><option value="">Open leads</option>${Object.entries(LEAD_STATUS).map(([k, v]) => option(k, v))}<option value="all">All</option></select></div>
      <div id="list"></div></section>`);
  el.querySelector('#new')?.addEventListener('click', () => editLead({}, (l) => (location.hash = `#/crm/leads/${l.id}`)));
  await listPage(el, {
    filename: 'leads.csv',
    load: () => api.get('/api/crm/leads'),
    csv: (rows) => [['Code', 'Name', 'Company', 'Email', 'Phone', 'Source', 'Status', 'Estimated value', 'Owner', 'Created'], ...rows.map((l) => [l.code, l.name, l.company, l.email, l.phone, l.source, LEAD_STATUS[l.status], l.estimatedValue, l.ownerName, l.createdAt.slice(0, 10)])],
    render: {
      noun: 'lead', empty: 'No leads yet. Add them from calls, events, referrals, or send service desk enquiries here.',
      filter: (l, s) => matchText(s.q, l.name, l.company, l.email, l.code) && matchOwner(l, s.owner) && (s.status === 'all' || (s.status ? l.status === s.status : OPEN_LEAD.includes(l.status))),
      table: (rows) => html`<table class="table clickable stackable"><thead><tr><th>Lead</th><th>Company</th><th>Source</th><th>Status</th><th class="num">Est. value</th><th>Owner</th><th>Added</th></tr></thead>
        <tbody>${rows.map((l) => html`<tr data-href="#/crm/leads/${l.id}" class="${l.status === 'new' ? 'unread' : ''}"><td><a href="#/crm/leads/${l.id}"><strong>${l.name}</strong></a><small>${l.title || l.email || ''}</small></td><td>${l.company || '—'}</td><td>${l.source}</td><td>${leadBadge(l.status)}</td><td class="num">${l.estimatedValue ? money(l.estimatedValue) : '—'}</td><td>${l.ownerName || '—'}</td><td>${fmtDate(l.createdAt.slice(0, 10))}</td></tr>`)}</tbody></table>`,
    },
  });
}

export async function leadView(el, { id }) {
  const [l, m] = await Promise.all([api.get(`/api/crm/leads/${id}`), meta()]);
  const converted = l.status === 'converted';
  mount(el, html`
    ${head(html`${l.name} ${leadBadge(l.status)}`, html`<span class="mono">${l.code}</span>${l.company ? ` · ${l.company}` : ''} · ${l.source}`, html`
      ${canEdit() && !converted ? html`<button class="btn" id="edit">${icon('edit', 16)} Edit</button>${l.status !== 'disqualified' ? html`<button class="btn primary" id="convert">${icon('check', 16)} Convert</button>` : ''}` : ''}
      ${canManage() ? html`<button class="btn danger ghost" id="del">Delete</button>` : ''}`, ['/crm/leads', 'Leads'])}
    ${converted ? html`<div class="notice ok">${icon('checkCircle', 18)} <p>Converted on ${fmtDate(l.convertedAt.slice(0, 10))} to <a href="#/crm/accounts/${l.accountId}">the account</a>, <a href="#/crm/contacts/${l.contactId}">a contact</a>${l.dealId ? html` and <a href="#/crm/deals/${l.dealId}">a deal</a>` : ''}.</p></div>` : ''}
    <div class="cols wide-left">
      <section class="card"><h2>Activity</h2><div id="timeline"></div></section>
      <section class="card"><h2>Details</h2><dl class="info-grid">
        ${info('Position', l.title)}${info('Email', l.email ? html`<a href="mailto:${l.email}">${l.email}</a>` : '')}${info('Phone', l.phone)}
        ${info('Estimated value', l.estimatedValue ? money(l.estimatedValue) : '')}${info('Owner', ownerChip(l.ownerName))}${info('Added', fmtDate(l.createdAt.slice(0, 10)))}
        ${l.disqualifiedReason ? info('Disqualified because', l.disqualifiedReason) : ''}${l.ticketId ? info('From', html`<a href="#/helpdesk/tickets/${l.ticketId}">Service desk ticket</a>`) : ''}
      </dl>${l.interest ? html`<h3>What they need</h3><p class="pre small">${l.interest}</p>` : ''}</section>
    </div>`);
  const reload = () => leadView(el, { id });
  el.querySelector('#edit')?.addEventListener('click', () => editLead(l, reload));
  el.querySelector('#del')?.addEventListener('click', () => removeRecord('lead', l, `the lead "${l.name}"`, '#/crm/leads'));
  el.querySelector('#convert')?.addEventListener('click', async () => {
    const { accounts } = await lists();
    const match = accounts.find((a) => a.name.toLowerCase() === (l.company || '').toLowerCase());
    modal({
      title: 'Convert lead', subtitle: `${l.name}${l.company ? `, ${l.company}` : ''}`, submitLabel: 'Convert', wide: true,
      body: html`<div class="grid two">
        <label class="field span-2"><span>Account</span><select name="accountId">${option('', `Create a new account: ${l.company || l.name}`)}${accounts.map((a) => option(a.id, a.name, match?.id))}</select></label>
        <label class="field check span-2"><input type="checkbox" name="createDeal" checked /><span>Also create a deal</span></label>
        <label class="field span-2"><span>Deal name</span><input name="dealTitle" value="${l.company || l.name}: ${(l.interest || 'new opportunity').split('\n')[0].slice(0, 60)}" /></label>
        <label class="field"><span>Value (₱)</span><input name="dealValue" type="number" min="0" step="0.01" value="${l.estimatedValue ?? ''}" /></label>
        <label class="field"><span>Expected close</span><input name="expectedClose" type="date" /></label>
        <p class="hint span-2">A contact is created from the lead's name, email and phone. Open tasks and notes on the lead move to the new deal.</p>
      </div>`,
      onSubmit: async (f) => {
        const r = await api.post(`/api/crm/leads/${id}/convert`, { accountId: f.accountId.value || null, createDeal: f.createDeal.checked, dealTitle: f.dealTitle.value, dealValue: f.dealValue.value, expectedClose: f.expectedClose.value || null });
        toast('Lead converted.');
        changed();
        location.hash = r.deal ? `#/crm/deals/${r.deal.id}` : `#/crm/accounts/${r.account.id}`;
      },
    });
  });
  await timeline(el.querySelector('#timeline'), 'lead', id);
}

// ---------- Accounts ----------
export async function accountsView(el) {
  const m = await meta();
  mount(el, html`
    ${head('Accounts', html`<span id="count"></span>: clients, prospects, partners and suppliers.`, html`${exportBtn}${canEdit() ? html`<button class="btn primary" id="new">+ Account</button>` : ''}`)}
    <section class="card scroll-x"><div class="toolbar pad">${searchBox('Search name, TIN, email…')}${ownerFilter(m)}
      <select id="f-status" aria-label="Relationship"><option value="">All relationships</option>${Object.entries(ACCOUNT_TYPES).map(([k, v]) => option(k, v))}</select></div>
      <div id="list"></div></section>`);
  el.querySelector('#new')?.addEventListener('click', () => editAccount({}, (a) => (location.hash = `#/crm/accounts/${a.id}`)));
  await listPage(el, {
    filename: 'accounts.csv',
    load: () => api.get('/api/crm/accounts'),
    csv: (rows) => [['Name', 'Relationship', 'Sector', 'Industry', 'TIN', 'Email', 'Phone', 'Website', 'Address', 'Owner', 'Contacts', 'Open deals'], ...rows.map((a) => [a.name, ACCOUNT_TYPES[a.type], SECTORS[a.sector], a.industry, a.tin, a.email, a.phone, a.website, a.address, a.ownerName, a.contacts, a.openDeals])],
    render: {
      noun: 'account', empty: 'No accounts yet.',
      filter: (a, s) => matchText(s.q, a.name, a.tin, a.email, a.industry) && matchOwner(a, s.owner) && (!s.status || a.type === s.status),
      table: (rows) => html`<table class="table clickable stackable"><thead><tr><th>Account</th><th>Relationship</th><th>Sector</th><th>Industry</th><th class="num">Contacts</th><th class="num">Open deals</th><th>Owner</th></tr></thead>
        <tbody>${rows.map((a) => html`<tr data-href="#/crm/accounts/${a.id}"><td><a href="#/crm/accounts/${a.id}"><strong>${a.name}</strong></a><small>${a.address || a.email || ''}</small></td><td>${accountBadge(a.type)}</td><td>${SECTORS[a.sector]}</td><td>${a.industry || '—'}</td><td class="num">${a.contacts}</td><td class="num">${a.openDeals}</td><td>${a.ownerName || '—'}</td></tr>`)}</tbody></table>`,
    },
  });
}

export async function accountView(el, { id }) {
  const [a, m] = await Promise.all([api.get(`/api/crm/accounts/${id}`), meta()]);
  const openDeals = a.deals.filter(isOpenDeal);
  mount(el, html`
    ${head(html`${a.name} ${accountBadge(a.type)}`, [SECTORS[a.sector], a.industry, a.address].filter(Boolean).join(' · '), html`
      ${canEdit() ? html`<button class="btn" id="edit">${icon('edit', 16)} Edit</button><button class="btn primary" id="add-deal">+ Deal</button>` : ''}
      ${canManage() ? html`<button class="btn danger ghost" id="del">Delete</button>` : ''}`, ['/crm/accounts', 'Accounts'])}
    <div class="stats">
      <div class="card"><small>Open pipeline</small><strong>${short(openDeals.reduce((s, x) => s + x.value, 0))}</strong><span class="muted small">${plural(openDeals.length, 'open deal')}</span></div>
      <div class="card"><small>Won to date</small><strong>${short(a.wonValue)}</strong></div>
      <div class="card"><small>Active contracts</small><strong>${a.contracts.filter((c) => c.status === 'active').length}</strong></div>
      <div class="card"><small>Bids</small><strong>${a.bids.length}</strong><span class="muted small">${a.bids.filter((b) => OPEN_BID.includes(b.status)).length} in progress</span></div>
    </div>
    <div class="cols wide-left">
      <section class="card"><h2>Activity</h2><p class="muted small">Includes the activity of its contacts, deals, bids and contracts.</p><div id="timeline"></div></section>
      <div class="stack">
        <section class="card"><h2>Details</h2><dl class="info-grid">
          ${info('Email', a.email ? html`<a href="mailto:${a.email}">${a.email}</a>` : '')}${info('Phone', a.phone)}${info('Website', a.website)}${info('TIN', a.tin)}${info('Owner', ownerChip(a.ownerName))}
          ${a.tags?.length ? info('Tags', html`${a.tags.map((t) => html`<span class="badge gray">${t}</span> `)}`) : ''}
        </dl>${a.notes ? html`<p class="pre small crm-desc">${a.notes}</p>` : ''}</section>
        <section class="card"><div class="card-head"><h2>People</h2>${canEdit() ? html`<button class="btn small-btn" id="add-contact">+ Contact</button>` : ''}</div>
          ${a.contactList.length ? html`<ul class="crm-mini">${a.contactList.map((c) => html`<li><span class="avatar xs">${initials(c.name)}</span><span class="grow"><a href="#/crm/contacts/${c.id}"><strong>${c.name}</strong></a><small>${[c.title, c.email].filter(Boolean).join(' · ')}</small></span></li>`)}</ul>` : html`<p class="muted small">No contacts yet.</p>`}</section>
        <section class="card"><h2>Deals</h2>
          ${a.deals.length ? html`<ul class="crm-mini">${a.deals.map((x) => html`<li><span class="grow"><a href="#/crm/deals/${x.id}"><strong>${x.title}</strong></a><small>${x.code}${x.expectedClose ? ` · ${fmtDate(x.expectedClose)}` : ''}</small></span><span class="crm-amt">${short(x.value)}<small>${stageBadge(x)}</small></span></li>`)}</ul>` : html`<p class="muted small">No deals yet.</p>`}</section>
        <section class="card"><div class="card-head"><h2>Bids and contracts</h2>${canEdit() ? html`<span class="actions"><button class="btn small-btn" id="add-bid">+ Bid</button><button class="btn small-btn" id="add-contract">+ Contract</button></span>` : ''}</div>
          ${a.bids.length || a.contracts.length ? html`<ul class="crm-mini">
            ${a.bids.map((b) => html`<li><span class="grow"><a href="#/crm/bids/${b.id}"><strong>${b.title}</strong></a><small>Bid · ${b.reference || b.code}</small></span>${bidBadge(b.status)}</li>`)}
            ${a.contracts.map((c) => html`<li><span class="grow"><a href="#/crm/contracts/${c.id}"><strong>${c.title}</strong></a><small>Contract · ${money(c.value)}${c.endDate ? ` · ends ${fmtDate(c.endDate)}` : ''}</small></span>${contractBadge(c, m.setup.renewalNoticeDays)}</li>`)}</ul>` : html`<p class="muted small">None yet.</p>`}</section>
      </div>
    </div>`);
  const reload = () => accountView(el, { id });
  el.querySelector('#edit')?.addEventListener('click', () => editAccount(a, reload));
  el.querySelector('#del')?.addEventListener('click', () => removeRecord('account', a, `the account "${a.name}"`, '#/crm/accounts'));
  el.querySelector('#add-deal')?.addEventListener('click', () => editDeal({ accountId: a.id }, (x) => (location.hash = `#/crm/deals/${x.id}`)));
  el.querySelector('#add-contact')?.addEventListener('click', () => editContact({ accountId: a.id }, reload));
  el.querySelector('#add-bid')?.addEventListener('click', () => editBid({ accountId: a.id }, (b) => (location.hash = `#/crm/bids/${b.id}`)));
  el.querySelector('#start-project')?.addEventListener('click', () => startProject('deal', x));
  el.querySelector('#add-contract')?.addEventListener('click', () => editContract({ accountId: a.id, startDate: today() }, reload));
  await timeline(el.querySelector('#timeline'), 'account', id);
}

// ---------- Contacts ----------
export async function contactsView(el) {
  const m = await meta();
  mount(el, html`
    ${head('Contacts', html`<span id="count"></span> at your accounts.`, html`${exportBtn}${canEdit() ? html`<button class="btn primary" id="new">+ Contact</button>` : ''}`)}
    <section class="card scroll-x"><div class="toolbar pad">${searchBox('Search name, email, phone or organization…')}${ownerFilter(m)}</div><div id="list"></div></section>`);
  el.querySelector('#new')?.addEventListener('click', () => editContact({}, (c) => (location.hash = `#/crm/contacts/${c.id}`)));
  await listPage(el, {
    filename: 'contacts.csv',
    load: () => api.get('/api/crm/contacts'),
    csv: (rows) => [['First name', 'Last name', 'Position', 'Organization', 'Email', 'Mobile', 'Phone', 'Owner'], ...rows.map((c) => [c.firstName, c.lastName, c.title, c.accountName, c.email, c.mobile, c.phone, c.ownerName])],
    render: {
      noun: 'contact', empty: 'No contacts yet.',
      filter: (c, s) => matchText(s.q, c.name, c.email, c.phone, c.mobile, c.accountName) && matchOwner(c, s.owner),
      table: (rows) => html`<table class="table clickable stackable"><thead><tr><th>Name</th><th>Organization</th><th>Email</th><th>Mobile</th><th>Owner</th></tr></thead>
        <tbody>${rows.map((c) => html`<tr data-href="#/crm/contacts/${c.id}"><td><a href="#/crm/contacts/${c.id}"><strong>${c.name}</strong></a><small>${c.title || ''}</small></td><td>${c.accountId ? html`<a href="#/crm/accounts/${c.accountId}">${c.accountName}</a>` : '—'}</td><td>${c.email ? html`<a href="mailto:${c.email}">${c.email}</a>` : '—'}</td><td>${c.mobile || c.phone || '—'}</td><td>${c.ownerName || '—'}</td></tr>`)}</tbody></table>`,
    },
  });
}

export async function contactView(el, { id }) {
  const c = await api.get(`/api/crm/contacts/${id}`);
  mount(el, html`
    ${head(c.name, html`${c.title || ''}${c.accountId ? html`${c.title ? ' · ' : ''}<a href="#/crm/accounts/${c.accountId}">${c.accountName}</a>` : ''}`, html`
      ${canEdit() ? html`<button class="btn" id="edit">${icon('edit', 16)} Edit</button>` : ''}${canManage() ? html`<button class="btn danger ghost" id="del">Delete</button>` : ''}`, ['/crm/contacts', 'Contacts'])}
    <div class="cols wide-left">
      <section class="card"><h2>Activity</h2><div id="timeline"></div></section>
      <div class="stack">
        <section class="card"><h2>Details</h2><dl class="info-grid">
          ${info('Email', c.email ? html`<a href="mailto:${c.email}">${c.email}</a>` : '')}${info('Mobile', c.mobile ? html`<a href="tel:${c.mobile.replace(/\s+/g, '')}">${c.mobile}</a>` : '')}${info('Office phone', c.phone)}${info('Owner', ownerChip(c.ownerName))}
        </dl>${c.notes ? html`<p class="pre small crm-desc">${c.notes}</p>` : ''}</section>
        <section class="card"><h2>Deals</h2>${c.deals.length ? html`<ul class="crm-mini">${c.deals.map((x) => html`<li><span class="grow"><a href="#/crm/deals/${x.id}"><strong>${x.title}</strong></a><small>${x.code}</small></span><span class="crm-amt">${short(x.value)}<small>${stageBadge(x)}</small></span></li>`)}</ul>` : html`<p class="muted small">Not the main contact on any deal.</p>`}</section>
      </div>
    </div>`);
  el.querySelector('#edit')?.addEventListener('click', () => editContact(c, () => contactView(el, { id })));
  el.querySelector('#del')?.addEventListener('click', () => removeRecord('contact', c, `the contact "${c.name}"`, '#/crm/contacts'));
  await timeline(el.querySelector('#timeline'), 'contact', id);
}

// ---------- Bids ----------
export async function bidsView(el) {
  const m = await meta();
  mount(el, html`
    ${head('Bids', html`<span id="count"></span>: public tenders and RFPs, with their documents and deadlines.`, html`${exportBtn}${canEdit() ? html`<button class="btn primary" id="new">+ Bid</button>` : ''}`)}
    <section class="card scroll-x"><div class="toolbar pad">${searchBox('Search title, reference or agency…')}${ownerFilter(m)}
      <select id="f-status" aria-label="Status"><option value="">In progress</option>${Object.entries(BID_STATUS).map(([k, v]) => option(k, v))}<option value="all">All</option></select></div>
      <div id="list"></div></section>`);
  el.querySelector('#new')?.addEventListener('click', () => editBid({}, (b) => (location.hash = `#/crm/bids/${b.id}`)));
  await listPage(el, {
    filename: 'bids.csv',
    load: () => api.get('/api/crm/bids'),
    csv: (rows) => [['Code', 'Reference', 'Title', 'Procuring entity', 'Mode', 'Status', 'ABC', 'Our bid', 'Deadline', 'Opening', 'Documents ready', 'Owner'], ...rows.map((b) => [b.code, b.reference, b.title, b.accountName, BID_MODES[b.mode], BID_STATUS[b.status], b.budget, b.bidAmount, b.deadline, b.openingDate, `${b.checklistDone}/${b.checklist.length}`, b.ownerName])],
    render: {
      noun: 'bid', empty: 'No bids yet.',
      filter: (b, s) => matchText(s.q, b.title, b.reference, b.code, b.accountName) && matchOwner(b, s.owner) && (s.status === 'all' || (s.status ? b.status === s.status : OPEN_BID.includes(b.status))),
      table: (rows) => html`<table class="table clickable stackable"><thead><tr><th>Bid</th><th>Procuring entity</th><th>Status</th><th class="num">ABC</th><th class="num">Our bid</th><th>Deadline</th><th>Documents</th></tr></thead>
        <tbody>${rows.map((b) => html`<tr data-href="#/crm/bids/${b.id}"><td><a href="#/crm/bids/${b.id}"><strong>${b.title}</strong></a><small class="mono">${b.reference || b.code}</small></td><td>${b.accountName}</td><td>${bidBadge(b.status)}</td><td class="num">${b.budget ? money(b.budget) : '—'}</td><td class="num">${b.bidAmount ? money(b.bidAmount) : '—'}</td><td>${deadlineText(b)}</td>
          <td><span class="crm-docs"><span class="progress"><i style="width:${b.checklist.length ? Math.round((b.checklistDone / b.checklist.length) * 100) : 0}%"></i></span>${b.checklistDone}/${b.checklist.length}</span></td></tr>`)}</tbody></table>`,
    },
  });
}

export async function bidView(el, { id }) {
  const b = await api.get(`/api/crm/bids/${id}`);
  const pct = b.checklist.length ? Math.round((b.checklistDone / b.checklist.length) * 100) : 0;
  const margin = b.budget && b.bidAmount ? Math.round(((b.budget - b.bidAmount) / b.budget) * 1000) / 10 : null;
  mount(el, html`
    ${head(html`${b.title} ${bidBadge(b.status)}`, html`<span class="mono">${b.reference || b.code}</span> · <a href="#/crm/accounts/${b.accountId}">${b.accountName}</a> · ${BID_MODES[b.mode]}`, html`
      ${canEdit() ? html`<button class="btn" id="edit">${icon('edit', 16)} Edit</button>` : ''}${canManage() ? html`<button class="btn danger ghost" id="del">Delete</button>` : ''}`, ['/crm/bids', 'Bids'])}
    <div class="stats">
      <div class="card ${b.status === 'preparing' && b.daysLeft !== null && b.daysLeft <= 3 ? 'attention' : ''}"><small>Submission deadline</small><strong>${b.deadline ? fmtDate(b.deadline.slice(0, 10)) : '—'}</strong><span class="muted small">${b.deadline?.length > 10 ? `${clock(b.deadline.slice(11))} · ` : ''}${deadlineText(b)}</span></div>
      <div class="card"><small>Approved budget (ABC)</small><strong>${b.budget ? short(b.budget) : '—'}</strong></div>
      <div class="card"><small>Our bid</small><strong>${b.bidAmount ? short(b.bidAmount) : '—'}</strong>${margin !== null ? html`<span class="muted small">${margin}% below the ABC</span>` : ''}</div>
      <div class="card"><small>Documents ready</small><strong>${b.checklistDone}/${b.checklist.length}</strong><span class="progress"><i style="width:${pct}%"></i></span></div>
    </div>
    <div class="cols wide-left">
      <section class="card">
        <div class="card-head"><h2>${icon('clipboard')} Document checklist</h2><span class="muted small">Tick each document once it is signed, notarized where needed, and in the envelope.</span></div>
        <ul class="crm-checklist">${b.checklist.map((i) => html`<li class="${i.done ? 'done' : ''}">
          <label><input type="checkbox" data-item="${i.id}" ${i.done ? 'checked' : ''} ${canEdit() ? '' : 'disabled'} /><span>${i.label}</span></label>
          ${i.done ? html`<small class="muted">${i.doneBy || ''}${i.doneAt ? ` · ${fmtDate(i.doneAt.slice(0, 10))}` : ''}</small>` : ''}
          ${canEdit() ? html`<button type="button" class="icon-btn" data-remove="${i.id}" aria-label="Remove ${i.label}">${icon('x', 14)}</button>` : ''}</li>`)}</ul>
        ${canEdit() ? html`<form id="add-item" class="crm-add-item"><input name="label" placeholder="Add a document this bid needs…" aria-label="Document to add" /><button class="btn" type="submit">Add</button></form>` : ''}
      </section>
      <div class="stack">
        <section class="card"><h2>Details</h2><dl class="info-grid">
          ${info('Bid opening', b.openingDate ? fmtDate(b.openingDate) : '')}${info('Pre-bid conference', b.preBidDate ? fmtDate(b.preBidDate) : '')}
          ${info('Submitted', b.submittedAt ? fmtDate(b.submittedAt.slice(0, 10)) : '')}${info('Linked deal', b.dealId ? html`<a href="#/crm/deals/${b.dealId}">Open the deal</a>` : '')}${info('Owner', ownerChip(b.ownerName))}
        </dl>${b.notes ? html`<p class="pre small crm-desc">${b.notes}</p>` : ''}</section>
        <section class="card"><h2>Activity</h2><div id="timeline"></div></section>
      </div>
    </div>`);
  const reload = () => bidView(el, { id });
  // After a tick or an add, the page is redrawn; focus goes back where it was (keyboard users).
  const reloadFocus = async (selector) => {
    await reload();
    el.querySelector(selector)?.focus();
  };
  el.querySelector('#edit')?.addEventListener('click', () => editBid(b, reload));
  el.querySelector('#del')?.addEventListener('click', () => removeRecord('bid', b, `the bid "${b.title}"`, '#/crm/bids'));
  el.querySelectorAll('[data-item]').forEach((cb) => cb.addEventListener('change', guard(async () => {
    await api.put(`/api/crm/bids/${id}/checklist`, { itemId: cb.dataset.item, done: cb.checked });
    await reloadFocus(`[data-item="${cb.dataset.item}"]`);
  }, reload)));
  el.querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', guard(async () => {
    await api.put(`/api/crm/bids/${id}/checklist`, { remove: btn.dataset.remove });
    await reloadFocus('#add-item input');
  }, reload)));
  el.querySelector('#add-item')?.addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    if (!e.target.label.value.trim()) return;
    await api.put(`/api/crm/bids/${id}/checklist`, { add: e.target.label.value });
    await reloadFocus('#add-item input');
  }, reload));
  await timeline(el.querySelector('#timeline'), 'bid', id);
}

// ---------- Contracts ----------
export async function contractsView(el) {
  const m = await meta();
  mount(el, html`
    ${head('Contracts', html`<span id="count"></span>. Renewals show ${m.setup.renewalNoticeDays} days before the end date.`, html`${exportBtn}${canEdit() ? html`<button class="btn primary" id="new">+ Contract</button>` : ''}`)}
    <section class="card scroll-x"><div class="toolbar pad">${searchBox('Search title, number or client…')}${ownerFilter(m)}
      <select id="f-status" aria-label="Status"><option value="">All</option><option value="renew">Due for renewal</option>${Object.entries(CONTRACT_STATUS).map(([k, v]) => option(k, v))}</select></div>
      <div id="list"></div></section>`);
  el.querySelector('#new')?.addEventListener('click', () => editContract({ startDate: today() }, (c) => (location.hash = `#/crm/contracts/${c.id}`)));
  await listPage(el, {
    filename: 'contracts.csv',
    load: () => api.get('/api/crm/contracts'),
    csv: (rows) => [['Code', 'Number', 'Title', 'Client', 'Status', 'Value', 'Start', 'End', 'Auto-renew', 'Billing', 'Owner'], ...rows.map((c) => [c.code, c.number, c.title, c.accountName, CONTRACT_STATUS[c.status], c.value, c.startDate, c.endDate, c.autoRenew ? 'Yes' : 'No', c.billing, c.ownerName])],
    render: {
      noun: 'contract', empty: 'No contracts yet. Record one when a deal is won.',
      filter: (c, s) => matchText(s.q, c.title, c.number, c.code, c.accountName) && matchOwner(c, s.owner) && (!s.status || (s.status === 'renew' ? c.status === 'active' && c.daysLeft !== null && c.daysLeft <= m.setup.renewalNoticeDays : c.status === s.status)),
      table: (rows) => html`<table class="table clickable stackable"><thead><tr><th>Contract</th><th>Client</th><th>Status</th><th class="num">Value</th><th>Term</th><th>Owner</th></tr></thead>
        <tbody>${rows.map((c) => html`<tr data-href="#/crm/contracts/${c.id}"><td><a href="#/crm/contracts/${c.id}"><strong>${c.title}</strong></a><small class="mono">${c.number || c.code}</small></td><td>${c.accountName}</td><td>${contractBadge(c, m.setup.renewalNoticeDays)}</td><td class="num">${money(c.value)}</td><td>${c.startDate ? fmtDate(c.startDate) : '…'} – ${c.endDate ? fmtDate(c.endDate) : 'open-ended'}</td><td>${c.ownerName || '—'}</td></tr>`)}</tbody></table>`,
    },
  });
}

export async function contractView(el, { id }) {
  const [c, m] = await Promise.all([api.get(`/api/crm/contracts/${id}`), meta()]);
  const total = c.startDate && c.endDate ? daysBetween(c.startDate, c.endDate) : null;
  const gone = c.startDate ? daysBetween(c.startDate, today()) : null;
  const pct = total ? Math.max(0, Math.min(100, Math.round((gone / total) * 100))) : null;
  mount(el, html`
    ${head(html`${c.title} ${contractBadge(c, m.setup.renewalNoticeDays)}`, html`<span class="mono">${c.number || c.code}</span> · <a href="#/crm/accounts/${c.accountId}">${c.accountName}</a>`, html`
      ${['active', 'draft'].includes(c.status) && can('pm.edit') ? html`<button class="btn" id="start-project">${icon('layers', 16)} Start project</button>` : ''}${canEdit() ? html`<button class="btn" id="edit">${icon('edit', 16)} Edit</button>` : ''}${canEdit() && c.status === 'active' ? html`<button class="btn primary" id="renew">Renew</button>` : ''}${canManage() ? html`<button class="btn danger ghost" id="del">Delete</button>` : ''}`, ['/crm/contracts', 'Contracts'])}
    <div class="stats">
      <div class="card"><small>Value</small><strong>${short(c.value)}</strong>${c.billing ? html`<span class="muted small">${c.billing}</span>` : ''}</div>
      <div class="card"><small>Term</small><strong>${c.endDate ? fmtDate(c.endDate) : 'Open-ended'}</strong><span class="muted small">from ${c.startDate ? fmtDate(c.startDate) : '—'}</span>${pct !== null ? html`<span class="progress"><i style="width:${pct}%"></i></span>` : ''}</div>
      <div class="card ${c.daysLeft !== null && c.daysLeft <= m.setup.renewalNoticeDays ? 'attention' : ''}"><small>Days left</small><strong>${c.daysLeft === null ? '—' : Math.max(0, c.daysLeft)}</strong><span class="muted small">${c.autoRenew ? 'Renews automatically' : 'Manual renewal'}</span></div>
    </div>
    <div class="cols wide-left">
      <section class="card"><h2>Activity</h2><div id="timeline"></div></section>
      <section class="card"><h2>Details</h2><dl class="info-grid">
        ${info('Owner', ownerChip(c.ownerName))}${info('From deal', c.dealId ? html`<a href="#/crm/deals/${c.dealId}">Open the deal</a>` : '')}${info('From bid', c.bidId ? html`<a href="#/crm/bids/${c.bidId}">Open the bid</a>` : '')}
        ${c.renewals.length ? info('Renewal', html`${c.renewals.map((x) => html`<a href="#/crm/deals/${x.id}">${x.code} · ${x.title}</a> ${stageBadge(x)} `)}`) : ''}
      </dl>${c.terms ? html`<h3>Key terms</h3><p class="pre small">${c.terms}</p>` : ''}</section>
    </div>
    ${c.projects.length || can('pm.edit') ? projectsCard(c.projects, 'No project delivers this contract yet.') : ''}`);
  const reload = () => contractView(el, { id });
  el.querySelector('#edit')?.addEventListener('click', () => editContract(c, reload));
  el.querySelector('#start-project')?.addEventListener('click', () => startProject('contract', c));
  el.querySelector('#del')?.addEventListener('click', () => removeRecord('contract', c, `the contract "${c.title}"`, '#/crm/contracts'));
  // Renewing records a new contract for the next term and a deal to track it.
  el.querySelector('#renew')?.addEventListener('click', () => {
    // A renewal already in progress opens instead of a second one.
    const open = c.renewals.find(isOpenDeal);
    if (open) {
      toast(`${open.code} is already the renewal of this contract.`);
      location.hash = `#/crm/deals/${open.id}`;
      return;
    }
    const start = c.endDate || today();
    const next = (ymd, days) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
    editDeal({ title: `Renewal: ${c.title}`, accountId: c.accountId, renewalOf: c.id, value: c.value, expectedClose: start, nextStep: `Renewal of ${c.number || c.code}, term from ${fmtDate(next(start, 1))}` }, (x) => (location.hash = `#/crm/deals/${x.id}`));
  });
  await timeline(el.querySelector('#timeline'), 'contract', id);
}

// ---------- Activities ----------
export async function activitiesView(el, _params, query) {
  const m = await meta();
  const VIEWS = { mine: 'My open', overdue: 'Overdue', open: 'All open', done: 'Done', all: 'All' };
  const state = { view: VIEWS[query.view] ? query.view : 'mine', type: '' };
  mount(el, html`
    ${head('Activities', 'Calls, meetings, emails, tasks and notes across the CRM.', exportBtn)}
    <nav class="tabs">${Object.entries(VIEWS).map(([k, v]) => html`<a href="#/crm/activities?view=${k}" data-view="${k}">${v}</a>`)}</nav>
    <section class="card scroll-x"><div class="toolbar pad"><select id="f-type" aria-label="Type"><option value="">All types</option>${Object.entries(ACTIVITY_TYPES).map(([k, v]) => option(k, v))}</select><span class="muted small" id="count"></span></div><div id="list"></div></section>`);
  let rows = [];
  const shown = () => rows.filter((a) => (!state.type || a.type === state.type) && ({
    mine: !a.done && a.ownerId === ctx.user.id, overdue: !a.done && a.dueDate && a.dueDate < today(), open: !a.done, done: a.done, all: true,
  })[state.view]).sort((a, b) => (a.done === b.done ? (a.dueDate || '9').localeCompare(b.dueDate || '9') : a.done ? 1 : -1));
  function draw() {
    const list = shown();
    el.querySelectorAll('[data-view]').forEach((a) => a.classList.toggle('active', a.dataset.view === state.view));
    mount(el.querySelector('#count'), plural(list.length, 'activity', 'activities'));
    mount(el.querySelector('#list'), list.length ? html`<table class="table stackable"><thead><tr><th>Activity</th><th>About</th><th>Due</th><th>Owner</th><th>Done</th></tr></thead>
      <tbody>${list.map((a) => html`<tr class="${a.done ? 'muted-row' : ''}">
        <td><strong>${a.subject}</strong><small>${ACTIVITY_TYPES[a.type]}${a.body ? ` · ${a.body.slice(0, 80)}` : ''}</small></td>
        <td>${a.relatedName ? html`<a href="#/crm/${a.related.type}s/${a.related.id}">${a.relatedName}</a>` : '—'}</td>
        <td>${a.dueDate ? html`<span class="crm-due ${!a.done && a.dueDate < today() ? 'bad' : !a.done && a.dueDate === today() ? 'warn' : ''}">${fmtDate(a.dueDate)}</span>` : '—'}</td><td>${a.ownerName || '—'}</td>
        <td>${canEdit() && (!a.done || a.type === 'task' || a.dueDate) ? html`<label class="crm-tick"><input type="checkbox" data-done="${a.id}" ${a.done ? 'checked' : ''} aria-label="Done: ${a.subject}" /></label>` : a.done ? 'Yes' : ''}</td></tr>`)}</tbody></table>`
      : html`<div class="empty"><p>${state.view === 'mine' ? 'Nothing open for you. Tasks you add on a record show here.' : 'Nothing here.'}</p></div>`);
    const refresh = async () => {
      rows = await api.get('/api/crm/activities');
      draw();
    };
    el.querySelectorAll('[data-done]').forEach((cb) => cb.addEventListener('change', guard(async () => {
      await api.put(`/api/crm/activities/${cb.dataset.done}`, { done: cb.checked });
      changed();
      await refresh();
    }, refresh)));
  }
  el.querySelectorAll('[data-view]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    state.view = a.dataset.view;
    history.replaceState(null, '', `#/crm/activities?view=${state.view}`);
    draw();
  }));
  el.querySelector('#f-type').addEventListener('change', (e) => ((state.type = e.target.value), draw()));
  el.querySelector('#export').addEventListener('click', () => downloadFile('activities.csv', toCsv([['Type', 'Subject', 'Details', 'About', 'Due', 'Done', 'Owner', 'Created'], ...shown().map((a) => [ACTIVITY_TYPES[a.type], a.subject, a.body, a.relatedName, a.dueDate, a.done ? 'Yes' : 'No', a.ownerName, a.createdAt.slice(0, 10)])])));
  rows = await api.get('/api/crm/activities');
  draw();
}

// ---------- Sales setup ----------
export async function crmSettingsView(el, _params, query) {
  const TABS = { pipeline: 'Pipeline stages', lists: 'Lists', bids: 'Bid checklist', ...(can('users.manage') ? { access: 'Team access' } : {}) };
  const tab = TABS[query.tab] ? query.tab : 'pipeline';
  const m = await meta();
  const s = structuredClone(m.setup);
  const lines = (arr) => arr.join('\n');
  const fromLines = (v) => v.split('\n').map((x) => x.trim()).filter(Boolean);
  mount(el, html`
    ${head('Sales setup', 'How the pipeline, lists and bids work for everyone using the CRM.')}
    <nav class="tabs">${Object.entries(TABS).map(([k, v]) => html`<a href="#/crm/settings?tab=${k}" class="${k === tab ? 'active' : ''}">${v}</a>`)}</nav>
    <section class="card" id="pane"></section>`);
  const pane = el.querySelector('#pane');
  async function save(patch) {
    await api.put('/api/crm/settings', { ...s, ...patch });
    toast('Sales setup saved.');
    crmSettingsView(el, _params, query);
  }
  if (tab === 'pipeline') {
    const rows = () => s.stages.map((st, i) => html`<tr><td><input name="name" value="${st.name}" aria-label="Stage name" /></td><td class="num"><input name="probability" type="number" min="0" max="99" value="${st.probability}" aria-label="Probability" /></td>
      <td class="row-actions"><button type="button" class="icon-btn" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('up', 16)}</button><button type="button" class="icon-btn" data-down="${i}" ${i === s.stages.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('down', 16)}</button><button type="button" class="icon-btn danger" data-rm="${i}" aria-label="Remove">${icon('trash', 16)}</button></td></tr>`);
    const draw = () => {
      mount(pane, html`<h2>Open stages</h2><p class="muted small">Deals move left to right. The probability is the chance of winning at that stage; it weighs the forecast. Won (100%) and Lost (0%) are always there.</p>
        <form id="f"><table class="table compact no-stack crm-stage-table"><thead><tr><th>Stage</th><th class="num">Probability %</th><th></th></tr></thead><tbody>${rows()}</tbody></table>
        <div class="actions"><button type="button" class="btn" id="add">+ Stage</button><span class="spacer"></span><button class="btn primary" type="submit">Save stages</button></div></form>`);
      const read = () => [...pane.querySelectorAll('tbody tr')].forEach((tr, i) => Object.assign(s.stages[i], { name: tr.querySelector('[name=name]').value, probability: Number(tr.querySelector('[name=probability]').value) }));
      pane.querySelector('#add').addEventListener('click', () => (read(), s.stages.push({ name: 'New stage', probability: 50 }), draw()));
      pane.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => (read(), s.stages.splice(Number(b.dataset.rm), 1), draw())));
      pane.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => { read(); const i = Number(b.dataset.up); [s.stages[i - 1], s.stages[i]] = [s.stages[i], s.stages[i - 1]]; draw(); }));
      pane.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => { read(); const i = Number(b.dataset.down); [s.stages[i + 1], s.stages[i]] = [s.stages[i], s.stages[i + 1]]; draw(); }));
      pane.querySelector('#f').addEventListener('submit', (e) => {
        e.preventDefault();
        read();
        if (s.stages.some((st) => !st.name.trim())) return toast('Name every stage, or remove the ones you do not need.', 'error');
        // Refused (for example a removed stage still has deals): show the saved stages again.
        save({ stages: s.stages }).catch((err) => {
          toast(err.message, 'error');
          // Put back the saved stages that were removed, where they were; other edits stay.
          m.setup.stages.forEach((st, i) => {
            if (!s.stages.some((x) => x.id === st.id)) s.stages.splice(Math.min(i, s.stages.length), 0, structuredClone(st));
          });
          draw();
        });
      });
    };
    draw();
  } else if (tab === 'lists') {
    mount(pane, html`<form id="f" class="grid two">
      <label class="field"><span>Lead sources</span><textarea name="sources" rows="9">${lines(s.sources)}</textarea><small class="hint">One per line.</small></label>
      <label class="field"><span>Reasons a deal is lost</span><textarea name="lostReasons" rows="9">${lines(s.lostReasons)}</textarea><small class="hint">Asked when a deal is marked lost; useful for win/loss reviews.</small></label>
      <label class="field"><span>Industries</span><textarea name="industries" rows="9">${lines(s.industries)}</textarea></label>
      <label class="field"><span>Renewal notice (days before a contract ends)</span><input name="renewalNoticeDays" type="number" min="7" max="365" value="${s.renewalNoticeDays}" /></label>
      <div class="actions span-2 end"><button class="btn primary" type="submit">Save lists</button></div></form>`);
    pane.querySelector('#f').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      save({ sources: fromLines(f.sources.value), lostReasons: fromLines(f.lostReasons.value), industries: fromLines(f.industries.value), renewalNoticeDays: Number(f.renewalNoticeDays.value) }).catch((err) => toast(err.message, 'error'));
    });
  } else if (tab === 'bids') {
    mount(pane, html`<form id="f"><h2>Documents for every new bid</h2>
      <p class="muted small">Each new bid starts with this list; documents can still be added or removed per bid. These are the usual eligibility, technical and financial documents for Philippine public bidding. Check them against each procuring entity's bidding documents and the current procurement rules.</p>
      <label class="field"><span>Documents, one per line</span><textarea name="bidChecklist" rows="14">${lines(s.bidChecklist)}</textarea></label>
      <div class="actions end"><button class="btn primary" type="submit">Save checklist</button></div></form>`);
    pane.querySelector('#f').addEventListener('submit', (e) => (e.preventDefault(), save({ bidChecklist: fromLines(e.target.bidChecklist.value) }).catch((err) => toast(err.message, 'error'))));
  } else {
    const draw = async () => {
      const people = await api.get('/api/crm/access');
      mount(pane, html`<h2>Who can use Sales & CRM</h2><p class="muted small">Sales Officers and Sales Managers have access by their account type. Give or remove access for anyone else here. Administrators always have it.</p>
        <table class="table stackable"><thead><tr><th>Account</th><th>Account type</th><th>Access</th><th></th></tr></thead><tbody>${people.map((p) => html`<tr>
          <td><strong>${p.name}</strong><small>${p.username}</small></td><td>${roleLabel(p.role)}</td>
          <td>${p.hasAccess ? badge('Has access', 'green') : badge('No access', 'gray')}${p.override !== null ? html`<small>${p.override ? 'given here' : 'removed here'}</small>` : p.byRole ? html`<small>by account type</small>` : ''}</td>
          <td class="row-actions">${p.role === 'admin' ? html`<span class="muted small">Always</span>` : html`
            ${!p.hasAccess ? html`<button class="btn small-btn" data-set="${p.id}" data-v="true">Give access</button>` : html`<button class="btn small-btn" data-set="${p.id}" data-v="false">Remove</button>`}
            ${p.override !== null ? html`<button class="link" data-set="${p.id}" data-v="null">Follow account type</button>` : ''}`}</td></tr>`)}</tbody></table>`);
      pane.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', guard(async () => {
        await api.put(`/api/crm/access/${b.dataset.set}`, { access: JSON.parse(b.dataset.v) });
        toast('Access updated.');
        draw();
      }, draw)));
    };
    await draw();
  }
}

// Used by the service desk: turn a ticket into a lead.
export async function ticketToLead(ticketId) {
  const lead = await api.post(`/api/crm/leads/from-ticket/${ticketId}`);
  toast(`Lead ${lead.code} created in Sales & CRM.`);
  changed();
  location.hash = `#/crm/leads/${lead.id}`;
}
