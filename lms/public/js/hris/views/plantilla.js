// People → Plantilla (server/plantilla.js; shared/plantilla.js): the register of positions (items) as
// DBM issued them, each with its incumbent read from their employee record, the totals, the CSV and
// the printable PSIPOP. Permission hris.plantilla records and changes items; anyone who views
// employee records may read it.
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, money, fmtDate, badge, toast, modal, confirmDialog, option, formData, today } from '../../ui.js';
import { clickableRows } from '../state.js';
import { brandProduct } from '../../brand.js';
import { salaryFor } from '/shared/gov-pay.js';
import {
  ITEM_STATUSES, SETTABLE_STATUSES, AUTHORIZED_STEP, PSIPOP_SIGNATURES, itemStatusLabel, filterItems, plantillaTotals, printedColumns, fundKey,
} from '/shared/plantilla.js';

const BACK = ['/plantilla', 'Plantilla'];
const STATUS_KIND = { filled: 'green', vacant: 'amber', unfunded: 'gray', abolished: 'gray' };
export const itemBadge = (s) => badge(itemStatusLabel(s), STATUS_KIND[s]);
const reviewBadge = () => badge('To review', 'red');
const sgText = (sg, step) => (sg ? `SG ${sg}${step ? `-${step}` : ''}` : '');
const yearly = (n) => (n == null || n === '' ? '—' : money(n));
const FILTER_KEYS = ['q', 'campusId', 'office', 'fund', 'status', 'salaryGrade'];
const queryOf = (f) => new URLSearchParams(Object.entries(f).filter(([k, v]) => FILTER_KEYS.includes(k) && v)).toString();
const pesos = (n) => money(Math.round(Number(n) || 0)).replace(/\.00$/, ''); // whole pesos, for the totals cards

// ----- The register -----
export async function plantillaListView(el, _params, query) {
  const res = await api.get('/api/hris/plantilla?status=all');
  const all = res.items;
  const ch = res.choices;
  const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, query[k] || '']));
  const offices = [...new Set(all.map((r) => r.officeName).filter(Boolean))].sort();
  const funds = [...new Map(all.filter((r) => r.fundCluster).flatMap((r) => [[r.fundCluster, `${r.fundCluster} ${r.fundName}`], [fundKey(r), `${r.fundCluster} · ${r.papName || r.pap || 'no program/activity/project'}`]])).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const grades = [...new Set(all.map((r) => r.salaryGrade).filter(Boolean))].sort((a, b) => b - a);
  const review = all.filter((r) => r.review).length;

  const rowHtml = (r) => html`<tr data-href="#/plantilla/${r.id}" class="${r.status === 'abolished' ? 'muted-row' : ''}">
    <td><strong>${r.itemNo}</strong>${r.review ? html` ${reviewBadge()}` : ''}<small class="block muted">${r.positionTitle || 'Position to review'}${r.salaryGrade ? ` · SG ${r.salaryGrade}` : ''}</small></td>
    <td>${r.officeName || '—'}<small class="block muted">${r.campusName}${r.fundCluster ? ` · Fund ${r.fundCluster}` : ''}${r.papName || r.pap ? ` · ${r.papName || r.pap}` : ''}</small></td>
    <td>${itemBadge(r.status)}</td>
    <td>${r.incumbent ? html`<strong>${r.incumbent.name}</strong><small class="block muted">${r.incumbent.appointment || 'No appointment status'}${r.incumbent.salaryGrade ? ` · ${sgText(r.incumbent.salaryGrade, r.incumbent.step)}` : ''}</small>` : html`<span class="muted">—</span>`}</td>
    <td class="num">${yearly(r.authorized.amount)}${r.authorized.override ? html`<small class="block muted">typed</small>` : ''}</td>
    <td class="num">${r.incumbent ? yearly(r.incumbent.actualAnnual) : '—'}</td>
  </tr>`;

  function render() {
    const list = filterItems(all, f);
    const t = plantillaTotals(list);
    mount(el.querySelector('#pl-stats'), html`
      <div class="card"><small>Filled</small><strong>${t.filled}</strong></div>
      <div class="card"><small>Vacant</small><strong>${t.vacant}</strong></div>
      <div class="card"><small>Unfunded</small><strong>${t.unfunded}</strong>${t.authorizedUnfunded ? html`<span class="muted small">${pesos(t.authorizedUnfunded)} a year</span>` : ''}</div>
      <div class="card"><small>Authorized a year</small><strong class="amount-stat">${pesos(t.authorized)}</strong><span class="muted small">Filled and vacant items</span></div>
      <div class="card accent"><small>Actual a year</small><strong class="amount-stat">${pesos(t.actual)}</strong><span class="muted small">Incumbents' own grade and step</span></div>`);
    mount(el.querySelector('#pl-table'), list.length
      ? html`<table class="table clickable">
          <thead><tr><th>Item and position</th><th>Office, campus and fund</th><th>Status</th><th>Incumbent</th><th class="num">Authorized a year</th><th class="num">Actual a year</th></tr></thead>
          <tbody>${list.map(rowHtml)}</tbody>
          <tfoot><tr><td><strong>Total</strong> · ${t.items} item${t.items === 1 ? '' : 's'}</td><td></td><td></td><td></td><td class="num" data-label="Authorized a year"><strong>${money(t.authorized + t.authorizedUnfunded)}</strong></td><td class="num" data-label="Actual a year"><strong>${money(t.actual)}</strong></td></tr></tfoot>
        </table>`
      : html`<p class="muted" style="margin:12px 0">No items match.${f.status === '' && all.some((r) => r.status === 'abolished') ? ' Abolished items are hidden: pick Abolished or All under status to see them.' : ''}</p>`);
    el.querySelector('#pl-count').textContent = `${list.length} of ${all.filter((r) => r.status !== 'abolished').length} items${all.some((r) => r.status === 'abolished') ? ` (and ${all.filter((r) => r.status === 'abolished').length} abolished)` : ''}`;
    const qs = queryOf(f);
    el.querySelector('#export').href = `/api/hris/plantilla/export${qs ? `?${qs}` : ''}`;
    el.querySelector('#print').href = `#/plantilla/psipop${qs ? `?${qs}` : ''}`;
    history.replaceState(null, '', `#/plantilla${qs ? `?${qs}` : ''}`);
  }

  mount(el, html`
    ${pageHead('Plantilla', html`<span id="pl-count"></span> · salaries from the ${res.schedule} schedule`, html`
      <a class="btn" id="export" href="/api/hris/plantilla/export" download>${icon('download', 16)} Export CSV</a>
      <a class="btn" id="print" href="#/plantilla/psipop">${icon('file', 16)} Print PSIPOP</a>
      ${res.canEdit ? html`<button class="btn" id="signatories">${icon('edit', 16)} Signatories</button><a class="btn primary" href="#/plantilla/new">${icon('plus', 16)} Record an item</a>` : ''}`)}
    ${review ? html`<div class="notice"><p><strong>${review}</strong> item${review === 1 ? '' : 's'} to review: recorded from item numbers typed on employee records before the register, or named by more than one record. <a href="#/plantilla?status=review" id="show-review">Show them</a>.</p></div>` : ''}
    <div class="stats" id="pl-stats"></div>
    ${all.length ? html`<section class="card">
      <div class="toolbar pl-filters">
        <input type="search" id="q" placeholder="Search item no., position, incumbent…" value="${f.q}" aria-label="Search" />
        ${ch.campuses.length > 1 ? html`<select id="campusId" aria-label="Campus"><option value="">All my campuses</option>${ch.campuses.map((c) => option(c.id, c.name, f.campusId === c.id))}</select>` : ''}
        <select id="office" aria-label="Office"><option value="">All offices</option>${offices.map((o) => option(o, o, f.office === o))}</select>
        <select id="fund" aria-label="Fund source"><option value="">All fund sources</option>${funds.map(([k, l]) => option(k, k.includes('|') ? `\u00a0\u00a0\u00a0${l}` : l, f.fund === k))}</select>
        <select id="status" aria-label="Status"><option value="">Filled, vacant and unfunded</option>${ITEM_STATUSES.map(([k, l]) => option(k, l, f.status === k))}<option value="review" ${f.status === 'review' ? 'selected' : ''}>To review</option><option value="all" ${f.status === 'all' ? 'selected' : ''}>All, with abolished</option></select>
        <select id="salaryGrade" aria-label="Salary grade"><option value="">All salary grades</option>${grades.map((g) => option(g, `SG ${g}`, Number(f.salaryGrade) === g))}</select>
      </div>
      <div id="pl-table" class="scroll-x"></div>
    </section>` : html`<div class="card empty">${icon('layers', 40)}<h2>No plantilla items yet</h2><p>Record each position as DBM approved it: its item number, title, salary grade, office and fund source. Then link each incumbent to their item.</p>${res.canEdit ? html`<p><a class="btn primary" href="#/plantilla/new">${icon('plus', 16)} Record an item</a></p>` : ''}</div>`}`);
  el.querySelector('#signatories')?.addEventListener('click', () => signatoriesModal());
  if (!all.length) {
    mount(el.querySelector('#pl-stats'), '');
    el.querySelector('#pl-count').textContent = '0 items';
    return;
  }
  for (const k of FILTER_KEYS) {
    const input = el.querySelector(`#${k}`);
    input?.addEventListener(k === 'q' ? 'input' : 'change', () => ((f[k] = input.value), render()));
  }
  el.querySelector('#show-review')?.addEventListener('click', (e) => {
    e.preventDefault();
    f.status = 'review';
    el.querySelector('#status').value = 'review';
    render();
  });
  clickableRows(el.querySelector('#pl-table'));
  render();
}

// The PSIPOP's signatories (Settings center → ATLAS People → Plantilla: PSIPOP signatories).
async function signatoriesModal() {
  const s = await api.get('/api/hris/plantilla/settings');
  modal({
    title: 'PSIPOP signatories',
    subtitle: 'Printed under the PSIPOP. Leave the Budget Officer and the head of agency blank to use the names in Finance\'s signatories.',
    submitLabel: 'Save',
    body: html`<div class="grid two">${PSIPOP_SIGNATURES.map((x) => html`
      <label class="field"><span>${x.caption}: name</span><input name="${x.key}.name" value="${s[x.key].name}" maxlength="120" /></label>
      <label class="field"><span>Title</span><input name="${x.key}.title" value="${s[x.key].title}" maxlength="120" placeholder="${x.defaultTitle}" /></label>`)}</div>`,
    async onSubmit(form) {
      const fd = formData(form);
      await api.put('/api/hris/plantilla/settings', Object.fromEntries(PSIPOP_SIGNATURES.map(({ key }) => [key, { name: fd[`${key}.name`], title: fd[`${key}.title`] }])));
      toast('Signatories saved.');
    },
  });
}

// ----- One item -----
const info = (label, value) => html`<div class="info"><dt>${label}</dt><dd>${value || value === 0 ? value : html`<span class="muted">—</span>`}</dd></div>`;

export async function plantillaItemView(el, { id }) {
  const r = await api.get(`/api/hris/plantilla/${id}`);
  const inc = r.incumbent;
  const a = r.authorized;
  const sgDiffers = inc && inc.salaryGrade && r.salaryGrade && Number(inc.salaryGrade) !== Number(r.salaryGrade);
  mount(el, html`
    ${pageHead(html`Item ${r.itemNo} ${itemBadge(r.status)} ${r.review ? reviewBadge() : ''}`, `${r.positionTitle || 'Position to review'}${r.salaryGrade ? ` · SG ${r.salaryGrade}` : ''} · ${[r.officeName, r.campusName].filter(Boolean).join(', ')}`, html`
      ${r.canPost && r.status === 'vacant' ? html`<a class="btn" id="post" href="#/recruitment/new?item=${r.id}">${icon('briefcase', 16)} Post a job opening</a>` : ''}
      ${r.canEdit ? html`<a class="btn primary" href="#/plantilla/${r.id}/edit">${icon('edit', 16)} Edit</a>` : ''}`, BACK)}
    ${r.review ? html`<div class="notice"><p><strong>To review.</strong> ${r.reviewNotes.filter((n) => n).map((n) => html`${n.text} `)}</p>${r.canEdit ? html`<p><button class="btn sm" id="reviewed">${icon('check', 14)} Mark as reviewed</button> <span class="muted small">after checking the item against DBM's list${r.draft ? ' and filling in what is missing' : ''}.</span></p>` : ''}</div>` : ''}
    <div class="cols">
      <section class="card">
        <h2>${icon('user')} Incumbent</h2>
        ${inc ? html`
          <p><strong><a href="#/employees/${inc.id}">${inc.name}</a></strong> <span class="muted">${inc.employeeNo} · ${inc.position || 'No position'}${inc.campusId !== r.campusId ? ` · at ${inc.campusName}` : ''}</span></p>
          <dl class="info-grid">
            ${info('Status of appointment', inc.appointment)}${info('Salary grade and step', sgText(inc.salaryGrade, inc.step))}
            ${info('Actual annual salary', inc.actualAnnual != null ? money(inc.actualAnnual) : '')}
            ${info('Sex', inc.sex)}${info('Date of birth', inc.birthDate ? fmtDate(inc.birthDate) : '')}${info('TIN', inc.tin)}${info('GSIS BP no.', inc.gsisNo)}
            ${info('Date of original appointment', inc.originalAppointment ? fmtDate(inc.originalAppointment) : '')}${info('Date of last promotion', inc.lastPromotion ? fmtDate(inc.lastPromotion) : '')}${info('Civil service eligibility', inc.eligibility)}
          </dl>
          ${sgDiffers ? html`<p class="hint-line warn-text">The incumbent's salary grade (${inc.salaryGrade}) differs from the item's (${r.salaryGrade}). Their pay follows their own record.</p>` : ''}
          <p class="hint-line">Read from the employee record each time; change them there. The item does not change the appointment status: holding a plantilla item does not make anyone permanent.</p>
          ${r.canEdit ? html`<div class="actions" style="margin-top:12px"><button class="btn danger ghost" id="unlink">Unlink</button></div>` : ''}`
        : html`<p class="muted">${r.status === 'vacant' ? 'Vacant: nobody holds this item.' : r.status === 'unfunded' ? 'Unfunded: set it to Vacant once it is funded, then link the incumbent.' : r.status === 'abolished' ? 'Abolished: kept for history.' : ''}</p>
          ${r.canEdit && r.status === 'vacant' ? html`<div class="actions"><button class="btn primary" id="link">${icon('link', 16)} Link an incumbent</button></div>
            <p class="hint-line">When the appointment is made. Job orders and contracts of service are not on the plantilla, and someone who holds another item must be unlinked from it first.</p>` : ''}`}
      </section>
      <section class="card">
        <h2>${icon('wallet')} Salary</h2>
        <dl class="info-grid">
          ${info('Authorized annual salary', html`<strong>${yearly(a.amount)}</strong>`)}
          ${info('Worked out at', a.override ? html`Typed by ${a.override.by || 'HR'}: ${a.override.reason}<small class="block muted">The schedule gives ${yearly(a.computed)} (step ${a.step} × 12)</small>` : `SG ${r.salaryGrade}, step ${a.step}, × 12 months`)}
          ${info('Actual annual salary', inc ? yearly(inc.actualAnnual) : '')}
          ${info('Salary schedule', `In force on ${fmtDate(r.asOf)}`)}
        </dl>
      </section>
      <section class="card">
        <h2>${icon('layers')} The item</h2>
        <dl class="info-grid">
          ${info('Item number', r.itemNo)}${info('Position title', r.positionTitle)}${info('Salary grade', r.salaryGrade)}
          ${info('Campus', r.campusName)}${info('Office', r.officeName)}${info('Division', r.division)}
          ${info('Fund cluster', r.fundCluster ? `${r.fundCluster} ${r.fundName}` : '')}${info('Program / activity / project', r.papName ? `${r.pap} ${r.papName}` : r.pap)}
          ${info('Area code', r.areaCode)}${info('Area type', r.areaType)}${info('Level', r.level)}
          ${info('Date created', r.dateCreated ? fmtDate(r.dateCreated) : '')}${info('Authority or reference', r.authority)}
          ${r.status === 'abolished' ? info('Abolished', `${r.abolishedAt ? fmtDate(today(new Date(r.abolishedAt))) : ''}${r.abolishReason ? ` · ${r.abolishReason}` : ''}`) : ''}
          ${info('Recorded', `${r.createdBy || ''}${r.createdAt ? ` · ${fmtDate(today(new Date(r.createdAt)))}` : ''}`)}
        </dl>
      </section>
      ${r.openings.length ? html`<section class="card">
        <h2>${icon('briefcase')} Job openings for this item</h2>
        <ul class="link-list">${r.openings.map((o) => html`<li><a href="#/recruitment/${o.id}">${o.title}</a> ${badge(o.status === 'open' ? 'Open' : o.status === 'draft' ? 'Draft' : 'Closed', o.status === 'open' ? 'green' : 'gray')} <span class="muted small">closes ${fmtDate(o.closingDate)}</span></li>`)}</ul>
        <p class="hint-line">Selecting an applicant changes nothing here: link the person to the item when the appointment is made.</p>
      </section>` : ''}
      <section class="card span-all">
        <h2>${icon('clock')} Change history</h2>
        ${r.history.length ? html`<div class="scroll-x"><table class="table compact">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Changes</th></tr></thead>
          <tbody>${r.history.map((h) => html`<tr><td class="nowrap">${new Date(h.at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</td><td>${h.actor}</td><td>${h.action}${h.detail ? html`<small class="block muted">${h.detail}</small>` : ''}</td>
            <td>${(h.changes || []).map((c) => html`<div class="small"><strong>${c.field}:</strong> ${c.from || '—'} → ${c.to || '—'}</div>`)}</td></tr>`)}</tbody></table></div>`
          : html`<p class="muted">No changes recorded since the item was added${r.demo ? ' (demo item)' : ''}. Every change is in the audit log.</p>`}
      </section>
    </div>`);
  const reload = () => plantillaItemView(el, { id });
  el.querySelector('#reviewed')?.addEventListener('click', async () => {
    await api.put(`/api/hris/plantilla/${id}`, { reviewed: true });
    toast('Marked as reviewed.');
    reload();
  });
  el.querySelector('#unlink')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Unlink ${inc.name} from item ${r.itemNo}? The item becomes vacant. Their employee record and appointment status stay as they are.`, { confirmLabel: 'Unlink' }))) return;
    await api.del(`/api/hris/plantilla/${id}/incumbent`);
    toast('Unlinked. The item is vacant.');
    reload();
  });
  el.querySelector('#link')?.addEventListener('click', async () => {
    const people = await api.get('/api/hris/plantilla/linkable');
    modal({
      title: `Link an incumbent to item ${r.itemNo}`,
      subtitle: `${r.positionTitle} · SG ${r.salaryGrade}`,
      submitLabel: people.length ? 'Link' : 'OK',
      body: people.length
        ? html`<label class="field"><span>Employee</span><select name="employeeId" required>${people.map((p) => option(p.id, `${p.name} · ${p.employeeNo} · ${p.position || 'no position'}${p.salaryGrade ? ` · SG ${p.salaryGrade}-${p.step || 1}` : ''} · ${p.appointment || 'no appointment status'}`, false))}</select>
            <span class="hint">Active employees at your campuses who hold no other item; job orders and contracts of service are not listed. The appointment status stays as on their record.</span></label>`
        : html`<p class="muted">Every active employee at your campuses already holds an item, or is a job order or contract of service.</p>`,
      async onSubmit(form) {
        if (!people.length) return;
        await api.post(`/api/hris/plantilla/${id}/incumbent`, formData(form));
        toast('Linked. The item is filled.');
        reload();
      },
    });
  });
}

// ----- Recording or editing an item -----
export async function plantillaFormView(el, { id } = {}) {
  const isNew = !id;
  const [list, r] = await Promise.all([api.get('/api/hris/plantilla?status=none'), isNew ? null : api.get(`/api/hris/plantilla/${id}`)]);
  const ch = list.choices;
  const it = r || { status: 'vacant', campusId: ctx.info.activeCampusId, fundCluster: ch.funds[0]?.code || '01' };
  const field = (label, name, value, { type = 'text', required = false, hint = '', attrs = '', span = 1 } = {}) => html`<label class="field span-${span}"><span>${label}${required ? html`<em>*</em>` : ''}</span>
    <input type="${type}" name="${name}" value="${value ?? ''}" ${required ? 'required' : ''} ${attrs} />${hint ? html`<span class="hint">${hint}</span>` : ''}</label>`;
  const statuses = it.incumbent ? [['filled', 'Filled']] : ITEM_STATUSES.filter(([k]) => SETTABLE_STATUSES.includes(k));
  const sgOptions = Array.from({ length: 33 }, (_, i) => option(i + 1, `SG ${i + 1}`, Number(it.salaryGrade) === i + 1));
  mount(el, html`
    ${pageHead(isNew ? 'Record a plantilla item' : `Edit item ${it.itemNo}`, isNew ? 'As DBM approved it: ATLAS never makes up an item number.' : '', '', isNew ? BACK : [BACK, [`/plantilla/${id}`, `Item ${it.itemNo}`]])}
    <form id="item-form" class="stack" novalidate>
      <section class="card">
        <h2>The position</h2>
        <div class="grid">
          ${field('Item number', 'itemNo', it.itemNo, { required: true, hint: 'Exactly as DBM issued it. Each item number is used once.', attrs: 'maxlength="80" autocomplete="off"' })}
          ${field('Position title', 'positionTitle', it.positionTitle, { required: true, span: 2, attrs: 'maxlength="160" placeholder="e.g. Instructor I"' })}
          <label class="field"><span>Salary grade<em>*</em></span><select name="salaryGrade" id="sg" required>${option('', 'Pick…')}${sgOptions}</select></label>
          <div class="field"><span>Authorized annual salary</span><output id="auth" class="sg-out"></output><span class="hint" id="auth-hint"></span></div>
          ${ch.campuses.length > 1 ? html`<label class="field"><span>Campus</span><select name="campusId">${ch.campuses.map((c) => option(c.id, c.name, c.id === it.campusId))}</select></label>` : ''}
          ${ch.offices.length ? html`<label class="field"><span>Office</span><select name="officeCode" id="officeCode">${option('', 'Not in Finance\'s list (type it)', !it.officeCode)}${ch.offices.map((o) => option(o.code, `${o.code} · ${o.name}`, o.code === it.officeCode))}</select><span class="hint">Finance's offices (responsibility centers).</span></label>` : ''}
          ${field(ch.offices.length ? 'Office, if not in the list' : 'Office', 'office', it.officeCode ? '' : it.office, { attrs: 'maxlength="160" placeholder="e.g. College of Computing"' })}
          ${field('Division', 'division', it.division, { attrs: 'maxlength="160"' })}
        </div>
      </section>
      <section class="card">
        <h2>Fund source and PSIPOP codes</h2>
        <div class="grid">
          <label class="field"><span>Fund cluster</span><select name="fundCluster">${ch.funds.map((x) => option(x.code, `${x.code} ${x.name}`, x.code === it.fundCluster))}</select><span class="hint">The fund clusters in use in Finance.</span></label>
          ${ch.paps.length
            ? html`<label class="field span-2"><span>Program / activity / project</span><select name="pap">${option('', '—', !it.pap)}${ch.paps.map((p) => option(p.code, `${p.code} · ${p.name}`, p.code === it.pap))}</select><span class="hint">From Finance's list.</span></label>`
            : field('Program / activity / project (code)', 'pap', it.pap, { span: 2, attrs: 'maxlength="30"' })}
          ${field('Area code', 'areaCode', it.areaCode, { attrs: 'maxlength="20"', hint: 'As on the PSIPOP.' })}
          ${field('Area type', 'areaType', it.areaType, { attrs: 'maxlength="20"', hint: 'As on the PSIPOP.' })}
          ${field('Level', 'level', it.level, { attrs: 'maxlength="20"', hint: 'As on the PSIPOP.' })}
        </div>
      </section>
      <section class="card">
        <h2>Status and authority</h2>
        <div class="grid">
          <label class="field"><span>Status</span><select name="status" id="status">${statuses.map(([k, l]) => option(k, l, k === it.status))}</select>
            <span class="hint">${it.incumbent ? 'Filled while it has an incumbent: unlink them on the item to change it.' : 'Filled comes from linking the incumbent. Abolished items are kept for history.'}</span></label>
          <label class="field span-2" id="abolish-box" hidden><span>Why it is abolished</span><input name="abolishReason" value="${it.abolishReason || ''}" maxlength="300" placeholder="e.g. the authority that abolished it" /></label>
          ${field('Date created', 'dateCreated', it.dateCreated, { type: 'date' })}
          ${field('Authority or reference', 'authority', it.authority, { span: 2, attrs: 'maxlength="300"', hint: 'The approval the item was created under, as it reads.' })}
        </div>
      </section>
      <section class="card">
        <h2>Authorized annual salary</h2>
        <p class="muted small">Worked out from the salary schedule: the grade's step ${AUTHORIZED_STEP} monthly salary × 12. Type an amount only when the approved item says otherwise, with the reason.</p>
        <div class="grid">
          ${field('Amount typed (₱ a year)', 'overrideAmount', it.authorized?.override?.amount ?? '', { type: 'number', attrs: 'min="0" step="0.01"', hint: 'Blank: from the salary schedule.' })}
          ${field('Reason', 'overrideReason', it.authorized?.override?.reason ?? '', { span: 2, attrs: 'maxlength="300"' })}
        </div>
      </section>
      <p class="form-error" hidden></p>
      <div class="actions end">
        ${!isNew && it.draft && !it.incumbent ? html`<button type="button" class="btn danger ghost" id="delete">${icon('trash', 16)} Remove draft</button>` : ''}
        <a class="btn" href="#${isNew ? '/plantilla' : `/plantilla/${id}`}">Cancel</a>
        <button class="btn primary" type="submit">${isNew ? 'Record item' : 'Save changes'}</button>
      </div>
    </form>`);
  const form = el.querySelector('#item-form');
  const showSalary = () => {
    const sg = form.salaryGrade.value;
    const typed = form.overrideAmount.value;
    const computed = sg ? salaryFor(sg, AUTHORIZED_STEP, today()) * 12 : null;
    form.querySelector('#auth').textContent = typed ? money(typed) : computed ? money(computed) : '—';
    form.querySelector('#auth-hint').textContent = typed ? `Typed. The schedule gives ${computed ? money(computed) : '—'}.` : sg ? `SG ${sg}, step ${AUTHORIZED_STEP}, × 12` : 'Pick the salary grade.';
  };
  const showAbolish = () => (form.querySelector('#abolish-box').hidden = form.status.value !== 'abolished' || it.status === 'abolished');
  form.salaryGrade.addEventListener('change', showSalary);
  form.overrideAmount.addEventListener('input', showSalary);
  form.status.addEventListener('change', showAbolish);
  showSalary();
  showAbolish();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = form.querySelector('.form-error');
    const body = formData(form);
    if (!body.campusId) body.campusId = it.campusId;
    try {
      const saved = await (isNew ? api.post('/api/hris/plantilla', body) : api.put(`/api/hris/plantilla/${id}`, body));
      toast(isNew ? 'Item recorded.' : 'Changes saved.');
      location.hash = `#/plantilla/${saved.id}`;
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      errEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
  form.querySelector('#delete')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Remove the draft item ${it.itemNo}? Use this only for a number that is not on DBM's list.`, { confirmLabel: 'Remove' }))) return;
    await api.del(`/api/hris/plantilla/${id}`);
    toast('Draft removed.');
    location.hash = '#/plantilla';
  });
}

// ----- The printable PSIPOP (Legal, landscape) -----
export async function psipopView(el, _params, query) {
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(query.asOf || '') ? query.asOf : today();
  const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, query[k] || '']));
  const qs = queryOf(f);
  const p = await api.get(`/api/hris/plantilla/psipop?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(qs)), asOf })}`);
  const cols = printedColumns();
  const groups = [];
  for (const c of cols) {
    const last = groups.at(-1);
    if (c.group && last?.group === c.group) last.span++;
    else groups.push({ group: c.group || null, span: 1, col: c });
  }
  const cell = (c, r) => {
    const v = c.value(r);
    if (c.num) return html`<td class="num c-${c.key}">${v === '' || v == null ? '' : money(v).replace('₱', '')}</td>`;
    if (c.date) return html`<td class="nowrap c-${c.key}">${v ? fmtDate(v, { year: 'numeric', month: '2-digit', day: '2-digit' }) : ''}</td>`;
    return html`<td class="c-${c.key}${c.center ? ' center' : ''}">${v ?? ''}</td>`;
  };
  // Rows by office, in the order the server sends them.
  const byOffice = [];
  for (const r of p.rows) {
    const g = byOffice.at(-1);
    if (g && g.office === r.officeName) g.rows.push(r);
    else byOffice.push({ office: r.officeName, rows: [r] });
  }
  const t = p.totals;
  const what = [p.campusName, p.filters.office, p.filters.fund ? `Fund ${p.filters.fund.split('|')[0]} ${p.filters.fundName}` : '', p.filters.salaryGrade ? `SG ${p.filters.salaryGrade}` : '', p.filters.status && p.filters.status !== 'all' ? (p.filters.status === 'review' ? 'To review' : itemStatusLabel(p.filters.status)) : ''].filter(Boolean).join(' · ');
  // The form's heading: above the table on screen; in print, the table's first heading row, so it
  // repeats on every page with the column headings.
  const head = html`<header class="psipop-head">
    ${ctx.info.branding?.logo ? html`<img src="${ctx.info.branding.logo}" alt="" />` : ''}
    <div>
      <strong class="psipop-entity">${p.entity}</strong>${p.address ? html`<span>${p.address}</span>` : ''}
      <strong class="psipop-title">Personal Services Itemization and Plantilla of Personnel (PSIPOP)</strong>
      <span>As of ${fmtDate(p.asOf, { month: 'long', day: 'numeric', year: 'numeric' })}${what ? ` · ${what}` : ''}</span>
    </div>
  </header>`;
  mount(el, html`
    <div class="no-print">
      ${pageHead('Print the PSIPOP', 'Legal paper, landscape. The table headings repeat on every page.', html`<button class="btn primary" id="do-print">${icon('file', 16)} Print</button>`, [BACK, [`/plantilla${qs ? `?${qs}` : ''}`, 'Register']])}
      <div class="card toolbar psipop-tools">
        <label class="inline"><span>As of</span> <input type="date" id="asOf" value="${asOf}" /></label>
        <span class="muted small">${what ? `Showing: ${what}. ` : ''}Change the filters on the register. Salaries from the ${p.schedule} schedule.</span>
      </div>
    </div>
    <article class="gov-form psipop">
      <div class="psipop-screen-head">${head}</div>
      <div class="table-scroll" tabindex="0" role="region" aria-label="PSIPOP">
      <table class="f-table psipop-table no-stack">
        <thead>
          <tr class="psipop-head-row"><th colspan="${cols.length}">${head}</th></tr>
          <tr>${groups.map((g) => (g.group ? html`<th colspan="${g.span}">${g.group}</th>` : html`<th rowspan="2" class="${g.col.num ? 'num' : ''}">${g.col.label}</th>`))}</tr>
          <tr>${cols.filter((c) => c.group).map((c) => html`<th>${c.label}</th>`)}</tr>
        </thead>
        <tbody>
          ${byOffice.map((g) => html`<tr class="psipop-office"><td colspan="${cols.length}">${g.office || 'No office given'}</td></tr>${g.rows.map((r) => html`<tr>${cols.map((c) => cell(c, r))}</tr>`)}`)}
          <tr class="psipop-total">
          ${cols.map((c, i) => (i === 0 ? html`<td colspan="${cols.findIndex((x) => x.num)}"><strong>Total</strong>: ${t.items} item${t.items === 1 ? '' : 's'} (${t.filled} filled, ${t.vacant} vacant, ${t.unfunded} unfunded)</td>` : i < cols.findIndex((x) => x.num) ? '' : c.key === 'authorized' ? html`<td class="num">${money(t.authorized + t.authorizedUnfunded).replace('₱', '')}</td>` : c.key === 'actual' ? html`<td class="num">${money(t.actual).replace('₱', '')}</td>` : html`<td></td>`))}
          </tr>
          <tr class="psipop-end"><td colspan="${cols.length}">*** Nothing follows ***</td></tr>
        </tbody>
      </table>
      </div>
      <div class="psipop-signs">
        ${p.signatures.map((s) => html`<div class="psipop-sign"><span class="gp-label">${s.caption}:</span><span class="gp-line">${s.name}</span><span class="gp-cap">${s.title}</span></div>`)}
      </div>
      <p class="psipop-foot">Printed from ${brandProduct('People')} on ${fmtDate(today(), { month: 'long', day: 'numeric', year: 'numeric' })}. Amounts in pesos a year.</p>
    </article>`);
  el.querySelector('#do-print').addEventListener('click', () => window.print());
  el.querySelector('#asOf').addEventListener('change', (e) => {
    const next = new URLSearchParams(qs);
    if (e.target.value) next.set('asOf', e.target.value);
    location.hash = `#/plantilla/psipop?${next}`;
  });
}
