// Control panel: the entity and fiscal year, fund clusters, responsibility centers, PAPs, bank
// accounts, fees, signatories, document numbering, withholding tax rates, thresholds, period
// locks and year-end closing, Finance user accounts — and the audit trail.
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, modal, toast, formData, option, fmtDate, badge, timeAgo } from '../../ui.js';
import { DOC_LABELS } from '/shared/finance.js';
import { fin, can, money, monthName, fundOptions, accountOptions, linesTable, wireLines, readLines, infoGrid , trackChanges } from '../state.js';

const TABS = [['entity', 'Entity'], ['structure', 'Funds & offices'], ['banks', 'Banks & fees'], ['signatories', 'Signatories'], ['taxes', 'Taxes & rules'], ['periods', 'Periods & closing'], ['users', 'Users']];

export async function controlView(el, _p, query) {
  await fin.refreshSettings();
  const s = fin.settings;
  const tab = query.tab || (can('finance.settings') ? 'entity' : 'periods');
  const edit = can('finance.settings');
  const reload = () => controlView(el, _p, query);
  const save = async (body, msg = 'Saved.') => {
    try {
      await api.put('/api/finance/settings', body);
      fin.forget();
      toast(msg);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  let body = '';
  let usersData = null;
  if (tab === 'entity') {
    body = html`<form class="card" id="form"><div class="grid two">
      <label class="field span-2"><span>Entity name (on every form)</span><input name="name" value="${s.entity.name}" /></label>
      <label class="field"><span>UACS organization code</span><input name="agencyCode" value="${s.entity.agencyCode}" placeholder="08 084 0000000" /></label>
      <label class="field"><span>TIN (for BIR Form 2307)</span><input name="tin" value="${s.entity.tin}" /></label>
      <label class="field span-2"><span>Address</span><input name="address" value="${s.entity.address}" /></label>
      <label class="field"><span>Fiscal year being worked on</span><input type="number" name="fiscalYear" value="${s.fiscalYear}" /></label>
    </div>${edit ? html`<div class="actions end"><button class="btn primary">Save</button></div>` : ''}</form>`;
  } else if (tab === 'structure') {
    body = html`<form class="card" id="form">
      <h2>Fund clusters in use</h2><div class="check-grid">${s.fundClusters.map((f) => html`<label class="check-row"><input type="checkbox" name="fund" value="${f.code}" ${s.funds.includes(f.code) ? 'checked' : ''} /><span><strong>${f.code} · ${f.name}</strong></span></label>`)}</div>
      <h2>Responsibility centers (offices)</h2>${linesTable('offices', [{ key: 'code', label: 'Code', type: 'text', width: '120px' }, { key: 'name', label: 'Office', type: 'text' }, { key: 'head', label: 'Head', type: 'text' }], s.offices, { min: 1, addLabel: 'Add office' })}
      <h2>Programs, activities and projects (PAP / MFO)</h2>${linesTable('paps', [{ key: 'code', label: 'UACS PAP code (15 digits)', type: 'text', width: '220px' }, { key: 'name', label: 'Name', type: 'text' }], s.paps, { min: 1, addLabel: 'Add PAP' })}
      ${edit ? html`<div class="actions end"><button class="btn primary">Save</button></div>` : ''}</form>`;
  } else if (tab === 'banks') {
    const chart = await fin.chart();
    body = html`<form class="card" id="form">
      <h2>Bank accounts</h2><p class="muted small">Collections are deposited to these; vouchers of funds other than 01 are paid from them. Fund 01 pays through the MDS (Cash – MDS, Regular).</p>
      ${linesTable('banks', [{ key: 'id', label: 'id', type: 'hidden' }, { key: 'name', label: 'Bank', type: 'text' }, { key: 'number', label: 'Account no.', type: 'text' }, { key: 'fund', label: 'Fund', type: 'select', options: (v) => fundOptions(v) }, { key: 'code', label: 'Ledger account', type: 'select', options: (v) => accountOptions(chart, v || '10102020', (a) => a.code.startsWith('1010')) }], s.bankAccounts, { min: 1, addLabel: 'Add bank account' })}
      <h2>Fees collected on official receipts</h2>
      ${linesTable('fees', [{ key: 'id', label: 'id', type: 'hidden' }, { key: 'name', label: 'Fee', type: 'text' }, { key: 'code', label: 'Credit to', type: 'select', options: (v) => accountOptions(chart, v, (a) => a.group === 4 || /^(103|199|202|204)/.test(a.code)) }, { key: 'amount', label: 'Default amount', type: 'number' }, { key: 'fund', label: 'Fund', type: 'select', options: (v) => fundOptions(v || '05') }], s.revenueItems, { min: 1, addLabel: 'Add fee' })}
      ${edit ? html`<div class="actions end"><button class="btn primary">Save</button></div>` : ''}</form>`;
  } else if (tab === 'signatories') {
    body = html`<form class="card" id="form"><h2>Signatories (printed on forms)</h2><div class="grid two">
      ${Object.entries(s.signatories).map(([k, v]) => html`<label class="field"><span>${v.title} — name</span><input name="sn_${k}" value="${v.name}" /></label><label class="field"><span>Title</span><input name="st_${k}" value="${v.title}" /></label>`)}</div>
      <h2>Document numbering</h2><p class="muted small">Tokens: {F} fund cluster, {YYYY} year, {MM} month, {N4} serial with 4 digits. Serials restart for each year and month in the format, and run per fund when {F} is used.</p>
      <div class="grid two">${Object.entries(s.numbering).map(([k, v]) => html`<label class="field"><span>${DOC_LABELS[k] || k}</span><input name="nb_${k}" value="${v}" /></label>`)}</div>
      ${edit ? html`<div class="actions end"><button class="btn primary">Save</button></div>` : ''}</form>`;
  } else if (tab === 'taxes') {
    body = html`<form class="card" id="form"><h2>Withholding taxes on government money payments</h2>
      <p class="muted small">Change a rate when BIR issues a new regulation. kind: ewt (creditable expanded withholding), vat (creditable VAT withheld), pt (percentage tax withheld).</p>
      ${linesTable('taxes', [{ key: 'atc', label: 'ATC', type: 'text', width: '90px' }, { key: 'kind', label: 'Kind', type: 'select', options: (v) => html`${['ewt', 'vat', 'pt'].map((k) => option(k, k, k === v))}` }, { key: 'payee', label: 'Payee', type: 'select', options: (v) => html`${option('', 'Any', !v)}${option('individual', 'Individual', v === 'individual')}${option('corporation', 'Corporation', v === 'corporation')}` }, { key: 'nature', label: 'Nature', type: 'select', options: (v) => html`${[...s.natures.filter(([k]) => k !== 'none'), ['any', 'Any']].map(([k, l]) => option(k, l, k === v))}` }, { key: 'rate', label: 'Rate %', type: 'number', width: '90px' }, { key: 'label', label: 'Description', type: 'text' }], s.taxes, { min: 1, addLabel: 'Add ATC' })}
      <h2>Thresholds and rules</h2><div class="grid">
        <label class="field"><span>Capitalization threshold (PPE)</span><input type="number" name="capitalization" value="${s.capitalization}" /><span class="hint">COA Circular 2022-004: ₱50,000.</span></label>
        <label class="field"><span>Semi-expendable high value from</span><input type="number" name="semiHighValue" value="${s.semiHighValue}" /></label>
        <label class="field"><span>Residual value (% of cost)</span><input type="number" name="residualRate" value="${s.residualRate}" /><span class="hint">GAM: at least 5%.</span></label>
        <label class="field"><span>Small Value Procurement ceiling</span><input type="number" name="svpLimit" value="${s.svpLimit}" /><span class="hint">RA 12009 IRR: ₱2,000,000 for SUCs.</span></label>
        <label class="field"><span>Direct Acquisition ceiling</span><input type="number" name="directAcquisitionLimit" value="${s.directAcquisitionLimit}" /></label>
        <label class="field"><span>Deposit collections within (banking days)</span><input type="number" name="depositDays" value="${s.depositDays}" /></label>
        ${Object.entries(s.liquidationDays).map(([k, v]) => html`<label class="field"><span>Liquidate ${s.advanceTypes.find(([x]) => x === k)?.[1].toLowerCase() || k} within (days)</span><input type="number" name="ld_${k}" value="${v}" /></label>`)}
      </div>${edit ? html`<div class="actions end"><button class="btn primary">Save</button></div>` : ''}</form>`;
  } else if (tab === 'periods') {
    body = html`<section class="card"><h2>Closing the books</h2>
      ${infoGrid([['Closed through', s.lockedThrough ? monthName(s.lockedThrough) : 'Nothing closed yet']])}
      <p class="muted small">After the monthly reports are done, close the month: nothing dated in it, or before it, can be posted. Reopen only to correct, and close again.</p>
      ${can('finance.accounts') ? html`<form class="toolbar" id="lock"><input type="month" name="lockedThrough" value="${s.lockedThrough}" /><button class="btn primary">Close through this month</button><button type="button" class="btn" id="reopen">Reopen all</button></form>` : ''}
    </section>
    <section class="card"><h2>Year-end closing</h2><p class="muted small">Closes revenue and expense accounts to Accumulated Surplus/(Deficit), one entry per fund cluster, dated December 31. Statements and the trial balance can still be shown before closing entries.</p>
      ${can('finance.accounts') ? html`<form class="toolbar" id="close"><input type="number" name="year" value="${s.fiscalYear - (new Date().getMonth() < 2 ? 1 : 0)}" style="width:100px" /><select name="fund">${fundOptions(s.funds[0])}</select><button class="btn primary">Post closing entry</button></form>` : ''}
    </section>`;
  } else if (tab === 'users') {
    const d = await api.get('/api/finance/users');
    usersData = d;
    const manage = ctx.user.role === 'admin';
    body = html`<section class="card"><div class="card-head"><h2>Finance accounts</h2>${manage ? html`<button class="btn primary" id="add-user">${icon('userPlus', 16)} New account</button>` : ''}</div>
      <table class="table"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Last sign-in</th><th>Status</th>${manage ? html`<th></th>` : ''}</tr></thead>
      <tbody>${d.users.map((u) => html`<tr><td><strong>${u.name}</strong></td><td>${u.username}</td><td>${u.roleLabel}</td><td>${u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Never'}</td><td>${u.status === 'active' ? badge('Active', 'green') : badge('Disabled', 'gray')}</td>${manage && u.role !== 'admin' ? html`<td class="row-actions"><button class="btn sm" data-user="${u.id}">Change</button></td>` : manage ? html`<td></td>` : ''}</tr>`)}</tbody></table>
      <p class="muted small">${manage ? '' : 'Only an administrator creates or changes Finance accounts, so no officer can give themselves another office\'s powers. '}Finance accounts sign in on the ATLAS home page. Employees with a teacher, registrar or staff account use Finance's self-service with their own account.</p></section>
      <section class="card"><h2>Roles and what they may do</h2><div class="table-scroll"><table class="table compact no-stack matrix"><thead><tr><th>Role</th>${d.permissions.map(([, l]) => html`<th class="center" title="${l}"><small>${l.split(':')[0]}</small></th>`)}</tr></thead>
      <tbody>${d.roles.map((r) => html`<tr><td><strong>${r.label}</strong></td>${d.permissions.map(([p]) => html`<td class="center">${r.permissions.includes(p) ? html`${icon('check', 16)}<span class="sr-only">yes</span>` : ''}</td>`)}</tr>`)}</tbody></table></div>
      <p class="muted small">Administrators can do everything. Separation of duties: the voucher's approving officer must be someone other than its preparer and certifier; a purchase request is not approved by its requester.</p></section>`;
  }
  mount(el, html`
    ${pageHead('Control panel', 'Settings that make ATLAS Finance fit the school\'s accounting department.')}
    <nav class="tabs">${TABS.filter(([k]) => k === 'periods' || can('finance.settings') || k === 'users').map(([k, l]) => html`<a href="#/control?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`)}</nav>
    ${body}`);
  if (usersData) controlUsers(el, usersData, reload);
  const form = el.querySelector('#form');
  if (form) {
    trackChanges(form); // a fresh tracker after each save (the view redraws)
    ['offices', 'paps', 'banks', 'fees', 'taxes'].forEach((id) => el.querySelector(`#${id}`) && wireLines(el, id));
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = formData(form);
      if (tab === 'entity') return save({ entity: { name: v.name, agencyCode: v.agencyCode, tin: v.tin, address: v.address }, fiscalYear: Number(v.fiscalYear) });
      if (tab === 'structure') return save({ funds: [...form.querySelectorAll('input[name=fund]:checked')].map((i) => i.value), offices: readLines(el, 'offices').filter((o) => o.code || o.name), paps: readLines(el, 'paps').filter((x) => x.code || x.name) });
      // Rows left blank are ignored (the selects in a blank row still hold their default values); ids travel with their row.
      if (tab === 'banks') return save({ bankAccounts: readLines(el, 'banks').filter((b) => b.name || b.number).map((b) => ({ ...b, id: b.id || undefined })), revenueItems: readLines(el, 'fees').filter((f) => f.name).map((f) => ({ ...f, id: f.id || undefined })) });
      if (tab === 'signatories') {
        return save({
          signatories: Object.fromEntries(Object.keys(s.signatories).map((k) => [k, { name: v[`sn_${k}`], title: v[`st_${k}`] }])),
          numbering: Object.fromEntries(Object.keys(s.numbering).map((k) => [k, v[`nb_${k}`]])),
        });
      }
      if (tab === 'taxes') {
        return save({
          taxes: readLines(el, 'taxes').filter((t) => t.atc).map((t) => ({ ...t, rate: Number(t.rate) })),
          capitalization: Number(v.capitalization), semiHighValue: Number(v.semiHighValue), residualRate: Number(v.residualRate), svpLimit: Number(v.svpLimit), directAcquisitionLimit: Number(v.directAcquisitionLimit), depositDays: Number(v.depositDays),
          liquidationDays: Object.fromEntries(Object.keys(s.liquidationDays).map((k) => [k, Number(v[`ld_${k}`])])),
        });
      }
    };
  }
  el.querySelector('#lock')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/finance/periods', formData(e.target));
      toast('Period closed.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  el.querySelector('#reopen')?.addEventListener('click', async () => {
    await api.post('/api/finance/periods', { lockedThrough: '' });
    toast('Every period reopened.');
    reload();
  });
  el.querySelector('#close')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const j = await api.post('/api/finance/closing', formData(e.target));
      toast(`Closing entry posted: JEV ${j.jevNo}.`);
      location.hash = `#/journals/${j.id}`;
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  void money;
}

function controlUsers(el, d, reload) {
  const roles = d.roles.filter((r) => r.id !== 'admin');
  el.querySelector('#add-user')?.addEventListener('click', () => modal({
    title: 'New Finance account', submitLabel: 'Create',
    body: html`<label class="field"><span>Role</span><select name="role">${roles.map((r) => option(r.id, `${r.label}: ${r.description}`))}</select></label>
      <label class="field"><span>Full name</span><input name="name" required /></label><label class="field"><span>Username</span><input name="username" required /></label>
      <label class="field"><span>Email</span><input name="email" type="email" /></label><label class="field"><span>Temporary password (8+ characters)</span><input name="password" required autocomplete="off" /></label>`,
    async onSubmit(form) {
      await api.post('/api/finance/users', formData(form));
      toast('Account created. They choose their own password at first sign-in.');
      reload();
    },
  }));
  el.onclick = (e) => {
    const b = e.target.closest('[data-user]');
    if (!b) return;
    const u = d.users.find((x) => x.id === b.dataset.user);
    modal({
      title: `Change ${u.name}`, submitLabel: 'Save',
      body: html`<label class="field"><span>Role</span><select name="role">${roles.map((r) => option(r.id, r.label, r.id === u.role))}</select></label>
        <label class="field"><span>Status</span><select name="status">${option('active', 'Active', u.status === 'active')}${option('disabled', 'Disabled', u.status === 'disabled')}</select></label>
        <label class="field"><span>New temporary password (optional)</span><input name="password" autocomplete="off" /></label>`,
      async onSubmit(form) {
        const v = formData(form);
        if (!v.password) delete v.password;
        await api.put(`/api/finance/users/${u.id}`, v);
        toast('Saved.');
        reload();
      },
    });
  };
}

export async function auditView(el, _p, query) {
  const list = await api.get(`/api/finance/audit?q=${encodeURIComponent(query.q || '')}`);
  mount(el, html`
    ${pageHead('Audit trail', 'Who did what in Finance, newest first (the last 500 matching actions).')}
    <form class="toolbar" id="f"><input type="search" name="q" value="${query.q || ''}" placeholder="Action or person" /><button class="btn">${icon('search', 16)} Find</button></form>
    <div class="card"><table class="table compact"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
      <tbody>${list.map((a) => html`<tr><td class="nowrap">${fmtDate(a.at.slice(0, 10))}<small>${new Date(a.at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}</small></td><td>${a.by}</td><td>${a.action}</td></tr>`)}</tbody></table></div>`);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    location.hash = `#/audit?q=${encodeURIComponent(formData(e.target).q)}`;
  };
}
