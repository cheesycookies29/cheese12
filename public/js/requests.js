// Shared pieces of the leave / work-from-home / official-business workflow: the filing form with
// its date breakdown and approval route, the approval trail, and a request's detail window.
import { api } from './api.js';
import { ctx } from './state.js';
import { html, mount, modal, fmtDate, badge, toast } from './ui.js';
import { workDates, needsCertificate, certificateReason, priorFilings, PORTIONS, portionDays, LEVEL_STATUS, REQUEST_STATUS } from '/shared/leave.js';
import { ACCEPT, prepareUpload, viewAttachment } from './attachments.js';

const LEVEL_KIND = { waiting: 'gray', pending: 'amber', approved: 'green', rejected: 'gray', returned: 'blue', skipped: 'gray' };
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const dayLabel = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
export const daysText = (n) => `${n} day${n === 1 ? '' : 's'}`;

// The approval route: one step per level with who decided and when.
export function approvalTrail(r) {
  if (!r.approvals?.length) return '';
  return html`<ol class="appr-trail">${r.approvals.map((l) => html`<li class="${l.status}">
    <span class="appr-dot" aria-hidden="true">${l.status === 'approved' ? '✓' : l.status === 'rejected' ? '✕' : l.level}</span>
    <div><strong>${l.label}</strong>
      <small>${badge(LEVEL_STATUS[l.status] || l.status, LEVEL_KIND[l.status])}${l.decidedByName && l.status !== 'skipped' ? ` ${l.decidedByName}, ${when(l.decidedAt)}` : ''}</small>
      ${l.note ? html`<small class="muted">${l.status === 'skipped' ? l.note : `“${l.note}”`}</small>` : ''}</div></li>`)}</ol>`;
}

// One line for tables: who it is waiting on, or how it ended.
export function progressText(r) {
  if (r.status === 'pending') return r.waitingOn?.length ? html`<small>Waiting on ${r.waitingOn.join(' or ')}</small>` : '';
  if (r.status === 'returned') return html`<small>${r.returnedByName}: “${r.returnNote}”</small>`;
  if (r.status === 'rejected') return html`<small>${r.decidedByName ? `by ${r.decidedByName}` : ''}${r.decisionNote ? `: “${r.decisionNote}”` : ''}</small>`;
  if (r.status === 'cancelled') return html`<small>${r.cancelledByName || ''}${r.cancelReason ? `: “${r.cancelReason}”` : ''}</small>`;
  if (r.status === 'approved') return html`<small>${r.decidedByName ? `by ${r.decidedByName}` : ''}</small>`;
  return '';
}

// The days of a request, each with its portion and whether it is paid.
export function breakdownList(r) {
  const list = r.breakdown || [];
  if (!list.length) return '';
  return html`<ul class="req-days">${list.map((d) => html`<li><span>${dayLabel(d.date)}</span><span>${PORTIONS[d.portion]}</span>${r.kind === 'leave' ? (d.overflow ? badge('Without pay', 'amber') : badge('With pay', 'green')) : ''}</li>`)}</ul>`;
}

// Detail window for a request: what, when, the days, the route and the history.
export function requestDetail(r, { certUrl, balance, actions = '' } = {}) {
  const { form, close } = modal({
    title: `${r.typeName}${r.employeeName && r.employeeName !== '(deleted employee)' && !r.mine ? ` · ${r.employeeName}` : ''}`,
    subtitle: `${r.startDate === r.endDate ? fmtDate(r.startDate) : `${fmtDate(r.startDate)} to ${fmtDate(r.endDate)}`} · ${daysText(r.days)}`,
    submitLabel: null, wide: true, className: 'req-modal',
    body: html`<div class="req-detail">
      <div>
        <p class="req-status">${badge(REQUEST_STATUS[r.status] || r.status, { pending: 'amber', returned: 'blue', approved: 'green' }[r.status] || 'gray')} <span class="muted small">Filed ${when(r.filedAt)}${r.resubmittedAt ? ` · resubmitted ${when(r.resubmittedAt)}` : ''}</span></p>
        ${r.status === 'returned' ? html`<p class="notice info small">Returned by ${r.returnedByName}: “${r.returnNote}”</p>` : ''}
        ${r.destination ? html`<p><strong>Where:</strong> ${r.destination}</p>` : ''}
        ${r.reason ? html`<p class="pre">${r.reason}</p>` : html`<p class="muted small">No reason given.</p>`}
        ${balance && balance.remaining !== null ? html`<p class="small muted">${balance.name}: ${balance.remaining} day(s) left this year, including ${balance.pending} pending.</p>` : ''}
        ${r.overflowDays ? html`<p class="small">${badge(`${daysText(r.overflowDays)} without pay`, 'amber')} beyond the remaining credits, recorded as Leave Without Pay.</p>` : ''}
        ${breakdownList(r)}
        ${r.attachment && certUrl ? (r.attachmentLocked ? html`<p class="muted small">📎 Medical certificate attached. Only HR opens it.</p>` : html`<p><button type="button" class="link" data-cert>📎 Medical certificate</button></p>`) : ''}
      </div>
      <div>
        <h3>Approval route${r.flow === 'parallel' ? ' (any level can decide)' : ''}</h3>
        ${approvalTrail(r)}
        ${r.history?.length ? html`<h3>History</h3><ul class="req-history">${r.history.map((h) => html`<li><small class="muted">${when(h.at)}${h.by ? ` · ${h.by}` : ''}</small><span>${h.text}</span></li>`)}</ul>` : ''}
      </div>
    </div>${actions ? html`<div class="actions end req-actions">${actions}</div>` : ''}`,
  });
  form.querySelector('[data-cert]')?.addEventListener('click', () => viewAttachment(certUrl).catch((e) => toast(e.message, 'error')));
  return { form, close };
}

// File a request, or revise one (existing). Leave days can be whole or the 1st or 2nd half;
// each day shows whether it is paid; the form shows who will approve it.
export async function requestForm({ emp, balances, existing = null, onDone }) {
  const route = await api.get('/api/me/approvers').catch(() => null);
  const offered = new Set(balances.map((b) => b.leaveTypeId));
  const types = ctx.leaveTypes.filter((t) => t.active && offered.has(t.id));
  // Default to the next scheduled work day.
  const soon = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA');
  const tomorrow = workDates(emp, ctx.settings, soon(1), soon(15), ctx.holidays)[0] || soon(1);
  const start0 = existing?.startDate || tomorrow;
  const what0 = existing ? (existing.kind === 'leave' ? `leave:${existing.leaveTypeId}` : existing.kind) : `leave:${types[0]?.id || ''}`;
  const portions = Object.fromEntries((existing?.breakdown || []).filter((d) => d.portion !== 'whole').map((d) => [d.date, d.portion]));
  const { form } = modal({
    title: existing ? (existing.status === 'returned' ? 'Revise and resubmit' : 'Edit request') : 'File a request',
    subtitle: existing?.status === 'returned' ? `Returned by ${existing.returnedByName}: “${existing.returnNote}”` : '',
    submitLabel: existing ? 'Resubmit for approval' : 'Submit for approval', wide: true, className: 'req-form',
    body: html`<div class="grid two">
      <label class="field span-2"><span>Request</span>
        <select name="what">
          <optgroup label="Leave">${types.map((t) => html`<option value="leave:${t.id}" ${what0 === `leave:${t.id}` ? 'selected' : ''}>${t.name}${t.paid ? '' : ' (unpaid)'}</option>`)}</optgroup>
          <optgroup label="Work arrangement">
            <option value="remote" ${what0 === 'remote' ? 'selected' : ''}>Work from home</option>
            <option value="ob" ${what0 === 'ob' ? 'selected' : ''}>Official business (working outside the office)</option>
          </optgroup>
        </select>
      </label>
      <label class="field"><span>From</span><input type="date" name="startDate" value="${start0}" required /></label>
      <label class="field"><span>To</span><input type="date" name="endDate" value="${existing?.endDate || start0}" required /></label>
      <label class="field span-2 ob-field"><span>Where you will be</span><input name="destination" value="${existing?.destination || ''}" placeholder="Client, site or office, e.g. Meridian Logistics, Pasig City" /></label>
      <div class="span-2 req-breakdown"></div>
      <label class="field span-2"><span>Reason</span><textarea name="reason" rows="3" maxlength="500" placeholder="Helps your approver decide">${existing?.reason || ''}</textarea></label>
      <label class="field span-2 cert-field"><span class="cert-label">Medical certificate (optional)</span>
        <input type="file" name="certificate" accept="${ACCEPT}" />
        <small class="muted cert-hint">PDF or a photo, up to 5 MB.</small></label>
      ${route ? html`<div class="span-2 req-route"><span class="muted small">Goes to</span> ${route.levels.filter((l) => !l.skipped).map((l, i, arr) => html`<span class="req-route-step">${l.label}</span>${i < arr.length - 1 ? html`<span class="muted">${route.flow === 'parallel' ? 'or' : '→'}</span>` : ''}`)}</div>` : ''}
    </div>`,
    onSubmit: async (f) => {
      const s = state();
      if (s.kind === 'leave' && s.type && needsCertificate(s.type, s.days, s.prior) && !f.certificate.files[0] && !existing?.attachment) {
        throw new Error(`${certificateReason(s.type, s.days, s.prior)} Attach it to continue.`);
      }
      const file = f.certificate.files[0];
      const body = {
        kind: s.kind, leaveTypeId: s.type?.id || null, startDate: f.startDate.value, endDate: f.endDate.value,
        reason: f.reason.value, destination: f.destination.value, portions,
        attachment: s.kind === 'leave' && file ? await prepareUpload(file) : undefined,
      };
      if (existing) await api.put(`/api/me/requests/${existing.id}`, body);
      else await api.post('/api/me/requests', body);
      toast(existing ? 'Resubmitted for approval.' : 'Submitted for approval.');
      onDone?.();
    },
  });

  function state() {
    const what = form.what.value;
    const kind = what.startsWith('leave:') ? 'leave' : what;
    const type = kind === 'leave' ? ctx.leaveTypes.find((t) => t.id === what.slice(6)) : null;
    const start = form.startDate.value;
    const end = form.endDate.value;
    const dates = start && end && end >= start ? workDates(emp, ctx.settings, start, end, ctx.holidays) : [];
    const days = dates.reduce((n, d) => n + (kind === 'leave' ? portionDays(portions[d] || 'whole') : 1), 0);
    // Earlier requests of the type in the same year or month, for the "after N requests" certificate rule.
    const filings = type ? balances.find((b) => b.leaveTypeId === type.id)?.filings : [];
    const prior = type ? priorFilings(type, filings, start, { excludeId: existing?.id, before: existing?.filedAt || null }) : 0;
    return { kind, type, dates, days, start, end, prior };
  }
  function draw() {
    const s = state();
    form.querySelector('.ob-field').hidden = s.kind !== 'ob';
    const cert = form.querySelector('.cert-field');
    cert.hidden = s.kind !== 'leave';
    const required = s.type && needsCertificate(s.type, s.days, s.prior);
    form.querySelector('.cert-label').textContent = required ? 'Medical certificate (required)' : 'Medical certificate (optional)';
    form.querySelector('.cert-hint').textContent = required
      ? `${certificateReason(s.type, s.days, s.prior)} PDF or a photo, up to 5 MB.${existing?.attachment ? ' The one already attached is kept unless you choose a new file.' : ''}`
      : 'PDF or a photo, up to 5 MB.';
    const box = form.querySelector('.req-breakdown');
    if (!s.dates.length) return mount(box, html`<p class="muted small">${s.start && s.end && s.end < s.start ? 'The end date is before the start date.' : 'No scheduled work days in this range; rest days are not counted.'}</p>`);
    const bal = s.type && balances.find((b) => b.leaveTypeId === s.type.id);
    // Days beyond the remaining credits are without pay (recorded as Leave Without Pay).
    let left = bal && bal.remaining !== null ? bal.remaining + (existing && existing.leaveTypeId === s.type.id ? existing.paidDays ?? existing.days : 0) : Infinity;
    const rows = s.dates.map((date) => {
      const portion = s.kind === 'leave' ? portions[date] || 'whole' : 'whole';
      const n = portionDays(portion);
      const paid = !s.type || (s.type.paid && n <= left);
      if (paid && s.type) left -= n;
      return { date, portion, paid };
    });
    const unpaid = rows.filter((r) => !r.paid).reduce((n, r) => n + portionDays(r.portion), 0);
    const ahead = s.type?.advanceDays ? new Date(Date.now() + s.type.advanceDays * 86400000).toLocaleDateString('en-CA') : null;
    mount(box, html`
      <div class="req-sum"><strong>${daysText(s.days)}</strong>
        ${bal && bal.remaining !== null ? html`<span class="muted small">${s.type.name}: ${bal.remaining} day(s) left${bal.pending ? `, ${bal.pending} pending` : ''}</span>` : ''}
        ${unpaid && s.type?.paid ? html`<span>${badge(`${daysText(unpaid)} without pay`, 'amber')}</span>` : ''}</div>
      ${ahead && s.start < ahead ? html`<p class="notice small">${s.type.name} must be filed at least ${daysText(s.type.advanceDays)} before it starts (from ${fmtDate(ahead)}).</p>` : ''}
      ${s.kind === 'leave' ? html`<ul class="req-days edit">${rows.map((r) => html`<li><span>${dayLabel(r.date)}</span>
          <select data-portion="${r.date}" aria-label="Portion of ${r.date}">${Object.entries(PORTIONS).map(([k, v]) => html`<option value="${k}" ${k === r.portion ? 'selected' : ''}>${v}</option>`)}</select>
          ${s.type ? (r.paid ? badge('With pay', 'green') : badge('Without pay', 'amber')) : ''}</li>`)}</ul>`
        : html`<p class="muted small">${daysText(s.days)} ${s.kind === 'ob' ? 'of official business' : 'working from home'}; rest days are not counted.</p>`}`);
    box.querySelectorAll('[data-portion]').forEach((sel) => sel.addEventListener('change', () => {
      if (sel.value === 'whole') delete portions[sel.dataset.portion];
      else portions[sel.dataset.portion] = sel.value;
      draw();
    }));
  }
  form.addEventListener('change', (e) => {
    if (e.target.name === 'startDate' && form.endDate.value < e.target.value) form.endDate.value = e.target.value;
    if (!e.target.dataset.portion) draw();
  });
  draw();
}
