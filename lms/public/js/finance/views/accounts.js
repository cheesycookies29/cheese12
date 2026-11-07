// Accounts: journal entry vouchers (JEV, GAM Appendix 36), the general and subsidiary ledgers,
// the trial balance, the financial statements, the chart of accounts and bank reconciliation.
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, modal, toast, formData, option, fmtDate, confirmDialog, downloadFile, toCsv } from '../../ui.js';
import { today as localDate } from '../../ui.js';
import { fundName } from '/shared/finance.js';
import { fin, can, money, num, fy, thisMonth, monthName, fundOptions, officeOptions, accountOptions, cardOptions, linesTable, wireLines, readLines, clickableRows, jevBadge, amt, printLink , trackChanges, busy } from '../state.js';

const today = () => localDate(); // the browser's own date, not UTC
const journalLabel = (k) => fin.settings.journals.find(([v]) => v === k)?.[1] || k;

// ----- Journal entries -----
export async function journalListView(el, _p, query) {
  const params = new URLSearchParams(Object.fromEntries(Object.entries({ fund: query.fund || '', journal: query.journal || '', status: query.status || '', q: query.q || '', from: query.from || '', to: query.to || '' }).filter(([, v]) => v)));
  const list = await api.get(`/api/finance/journals?${params}`);
  mount(el, html`
    ${pageHead('Journal entries', 'Every entry in the books, by journal: general, cash receipts, cash disbursements, check disbursements. Modules post theirs; adjustments are entered here.', can('finance.accounts') ? html`<a class="btn primary" href="#/journals/new">${icon('plus', 16)} New entry</a>` : '')}
    <form class="toolbar" id="filter">
      <select name="fund">${fundOptions(query.fund, { all: true })}</select>
      <select name="journal">${option('', 'All journals', !query.journal)}${fin.settings.journals.map(([v, l]) => option(v, l, v === query.journal))}</select>
      <select name="status">${option('', 'Posted and drafts', !query.status)}${option('posted', 'Posted', query.status === 'posted')}${option('draft', 'Drafts', query.status === 'draft')}</select>
      <label>From <input type="date" name="from" value="${query.from || ''}" /></label><label>To <input type="date" name="to" value="${query.to || ''}" /></label>
      <input type="search" name="q" value="${query.q || ''}" placeholder="JEV no. or particulars" /><button class="btn">Show</button>
    </form>
    ${list.length ? html`<div class="card"><div class="table-scroll"><table class="table" id="rows"><thead><tr><th>JEV no.</th><th>Date</th><th>Journal</th><th>Particulars</th><th class="num">Amount</th><th>Status</th></tr></thead>
      <tbody>${list.map((j) => html`<tr data-href="/journals/${j.id}"><td class="nowrap"><a href="#/journals/${j.id}"><strong>${j.jevNo || 'Draft'}</strong></a><small>Fund ${j.fund}</small></td><td class="nowrap">${fmtDate(j.date)}</td><td><abbr title="${journalLabel(j.journal)}">${j.journal}</abbr></td><td>${j.particulars}</td>${amt(j.total)}<td>${jevBadge(j)}</td></tr>`)}</tbody></table></div></div>`
      : html`<div class="card empty">${icon('book', 40)}<h2>No entries</h2><p>${Object.keys(query).length ? 'Nothing matches these filters — clear them to see every entry.' : 'Entries appear here as the modules post them.'}</p></div>`}`);
  clickableRows(el);
  el.querySelector('#filter').onsubmit = (e) => {
    e.preventDefault();
    location.hash = `#/journals?${new URLSearchParams(Object.fromEntries(Object.entries(formData(e.target)).filter(([, v]) => v)))}`;
  };
}

export async function journalFormView(el, _p, query) {
  const [chart, cards] = await Promise.all([fin.chart(), fin.cardList()]);
  const draft = query.id ? await api.get(`/api/finance/journals/${query.id}`) : null;
  const j = draft || { date: today(), fund: fin.settings.funds[0], journal: 'GJ', particulars: '', lines: [] };
  const cols = [
    { key: 'code', label: 'Account', type: 'select', options: (v) => accountOptions(chart, v), width: '34%' },
    { key: 'cardId', label: 'Card (subsidiary)', type: 'select', options: (v) => html`<option value="">—</option>${cardOptions(cards, v)}` },
    { key: 'office', label: 'Office', type: 'select', options: (v) => officeOptions(v, { blank: '—' }) },
    { key: 'debit', label: 'Debit', type: 'number' },
    { key: 'credit', label: 'Credit', type: 'number' },
  ];
  mount(el, html`
    ${pageHead(draft ? `Draft entry` : 'New journal entry', 'Adjusting, correcting and other entries not made by a module. Saved as a draft until posted.', '', ['/journals', 'Journal entries'])}
    <form class="card" id="jev">
      <div class="grid">
        <label class="field"><span>Date</span><input type="date" name="date" value="${j.date}" required /></label>
        <label class="field"><span>Fund cluster</span><select name="fund">${fundOptions(j.fund)}</select></label>
        <label class="field"><span>Journal</span><select name="journal">${fin.settings.journals.map(([v, l]) => option(v, l, v === j.journal))}</select></label>
        <label class="field span-3"><span>Particulars</span><textarea name="particulars" rows="2" required>${j.particulars}</textarea></label>
      </div>
      <h3 class="sub-h">Accounting entry</h3>
      ${linesTable('lines', cols, j.lines, { min: 2, total: true })}
      <div class="actions end"><button class="btn" type="submit" name="act" value="draft">Save draft</button><button class="btn primary" type="submit" name="act" value="post">Save and post</button></div>
    </form>`);
  const postBtn = el.querySelector('#jev button[value=post]');
  wireLines(el, 'lines', (rows) => {
    const dr = rows.reduce((t, r) => t + (Number(r.debit) || 0), 0);
    const cr = rows.reduce((t, r) => t + (Number(r.credit) || 0), 0);
    const off = Math.abs(dr - cr) > 0.004;
    // Posting needs a balanced entry with something in it; the total line says what is missing.
    postBtn.disabled = off || dr <= 0;
    const t = el.querySelector('#lines .lines-total');
    t.classList.toggle('danger-text', off);
    if (dr <= 0 && cr <= 0) return 'Enter at least one debit and one credit.';
    return `Debits ${num(dr)} · Credits ${num(cr)}${off ? ` · out of balance by ${num(Math.abs(dr - cr))}` : ' · balanced'}`;
  });
  const changes = trackChanges(el.querySelector('#jev'));
  el.querySelector('#jev').onsubmit = async (e) => {
    e.preventDefault();
    const post = e.submitter?.value === 'post';
    const body = { ...formData(e.target), lines: readLines(el, 'lines'), post };
    await busy(e.target, async () => {
    try {
      let out;
      if (draft) {
        out = await api.put(`/api/finance/journals/${draft.id}`, body);
        if (post) out = await api.post(`/api/finance/journals/${draft.id}/post`);
      } else out = await api.post('/api/finance/journals', body);
      toast(out.status === 'posted' ? `Posted as JEV ${out.jevNo}.` : 'Draft saved.');
      changes.saved();
      location.hash = `#/journals/${out.id}`;
    } catch (err) {
      toast(err.message, 'error');
    }
    });
  };
}

export async function journalView(el, params) {
  const j = await api.get(`/api/finance/journals/${params.id}`);
  const reload = () => journalView(el, params);
  const manual = !j.source?.kind || ['manual', 'closing', 'opening'].includes(j.source.kind);
  mount(el, html`
    ${pageHead(html`${j.jevNo ? `JEV ${j.jevNo}` : 'Draft entry'} ${jevBadge(j)}`, `${j.journalLabel} · Fund ${j.fund} · ${fmtDate(j.date)}`, html`
      ${j.status === 'posted' ? printLink('jev', j.id) : ''}
      ${j.status === 'draft' && can('finance.accounts') ? html`<a class="btn" href="#/journals/new?id=${j.id}">${icon('edit', 16)} Edit</a><button class="btn primary" id="post">Post</button><button class="btn danger ghost" id="del">Delete</button>` : ''}
      ${j.status === 'posted' && !j.reversedBy && manual && can('finance.accounts') ? html`<button class="btn danger ghost" id="reverse">Reverse</button>` : ''}`, ['/journals', 'Journal entries'])}
    <section class="card">
      <p><strong>Particulars:</strong> ${j.particulars}</p>
      ${j.reversedByNo ? html`<p class="notice info">Reversed by JEV ${j.reversedByNo}.</p>` : ''}${j.reversesNo ? html`<p class="notice info">Reverses JEV ${j.reversesNo}.</p>` : ''}
      <div class="table-scroll"><table class="table"><thead><tr><th>Account code</th><th>Account title</th><th>Subsidiary</th><th>Office</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
      <tbody>${j.lines.map((l) => html`<tr><td><a href="#/ledger/${l.code}?fund=${j.fund}">${l.code}</a></td><td>${l.title}${l.memo ? html`<small>${l.memo}</small>` : ''}</td><td>${l.cardName ? html`<a href="#/cards/${l.cardId}">${l.cardName}</a>` : ''}</td><td>${l.office}</td>${amt(l.debit, { blankZero: true })}${amt(l.credit, { blankZero: true })}</tr>`)}</tbody>
      <tfoot><tr><td colspan="4">Total</td>${amt(j.total, { strong: true })}${amt(j.total, { strong: true })}</tr></tfoot></table></div>
      <p class="muted small">Prepared by ${j.createdBy}${j.postedBy ? ` · posted by ${j.postedBy}` : ''}${j.source?.kind && j.source.kind !== 'manual' ? ` · made by ${j.source.kind.toUpperCase()}` : ''}</p>
    </section>`);
  el.querySelector('#post')?.addEventListener('click', async () => {
    try {
      await api.post(`/api/finance/journals/${j.id}/post`);
      toast('Posted.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  el.querySelector('#del')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete this draft entry?'))) return;
    await api.del(`/api/finance/journals/${j.id}`);
    location.hash = '#/journals';
  });
  el.querySelector('#reverse')?.addEventListener('click', () => modal({
    title: `Reverse JEV ${j.jevNo}`, submitLabel: 'Reverse',
    body: html`<p class="muted">An opposite entry is posted; this one stays on the books.</p><label class="field"><span>Date</span><input type="date" name="date" value="${today()}" /></label><label class="field"><span>Reason</span><input name="reason" required /></label>`,
    async onSubmit(form) {
      const r = await api.post(`/api/finance/journals/${j.id}/reverse`, formData(form));
      toast(`Reversed by JEV ${r.jevNo}.`);
      location.hash = `#/journals/${r.id}`;
    },
  }));
}

// ----- Ledgers -----
export async function ledgerView(el, params, query) {
  const chart = await fin.chart();
  const code = params.code || query.code || '';
  const fund = query.fund || '';
  const from = query.from || `${fy()}-01-01`;
  const to = query.to || today();
  const g = code ? await api.get(`/api/finance/ledger/${code}?${new URLSearchParams({ fund, from, to })}`) : null;
  mount(el, html`
    ${pageHead(g ? `${g.account.code} · ${g.account.title}` : 'General ledger', g ? `${fund ? `Fund ${fund}` : 'All funds'} · ${fmtDate(from)} to ${fmtDate(to)} · normal balance: ${g.account.normal}` : 'Pick an account to see its ledger.', g ? html`<button class="btn" id="csv">${icon('download', 16)} CSV</button><button class="btn" onclick="print()">${icon('file', 16)} Print</button>` : '', g ? ['/ledger', 'Ledgers'] : '')}
    <form class="toolbar" id="pick">
      <select name="code" required>${accountOptions(chart, code)}</select>
      <select name="fund">${fundOptions(fund, { all: true })}</select>
      <input type="date" name="from" value="${from}" aria-label="From" /><input type="date" name="to" value="${to}" aria-label="To" />
      <button class="btn">Show</button>
    </form>
    ${g ? html`<div class="card"><div class="table-scroll"><table class="table compact"><thead><tr><th>Date</th><th>JEV</th><th>Particulars</th><th>Subsidiary</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
      <tbody><tr class="term-row"><td colspan="6">Balance forward</td>${amt(g.opening)}</tr>
      ${g.rows.map((r) => html`<tr><td class="nowrap">${fmtDate(r.date)}</td><td><a href="#/journals/${r.journalId}">${r.jevNo}</a><small>${r.journal}</small></td><td>${r.particulars}</td><td>${r.cardName ? html`<a href="#/cards/${r.cardId}">${r.cardName}</a>` : ''}</td>${amt(r.debit, { blankZero: true })}${amt(r.credit, { blankZero: true })}${amt(r.balance)}</tr>`)}</tbody>
      <tfoot><tr><td colspan="4">Totals and ending balance</td>${amt(g.debits, { strong: true })}${amt(g.credits, { strong: true })}${amt(g.closing, { strong: true })}</tr></tfoot></table></div></div>` : ''}`);
  el.querySelector('#pick').onsubmit = (e) => {
    e.preventDefault();
    const v = formData(e.target);
    location.hash = `#/ledger/${v.code}?${new URLSearchParams({ fund: v.fund, from: v.from, to: v.to })}`;
  };
  el.querySelector('#csv')?.addEventListener('click', () => downloadFile(`ledger-${code}.csv`, toCsv([['Date', 'JEV', 'Particulars', 'Subsidiary', 'Debit', 'Credit', 'Balance'], ['', '', 'Balance forward', '', '', '', g.opening], ...g.rows.map((r) => [r.date, r.jevNo, r.particulars, r.cardName, r.debit, r.credit, r.balance])])));
}

// ----- Trial balance -----
export async function trialBalanceView(el, _p, query) {
  const fund = query.fund ?? fin.settings.funds[0];
  const asOf = query.asOf || today();
  const kind = query.kind || 'post-closing';
  const tb = await api.get(`/api/finance/trial-balance?${new URLSearchParams({ fund, asOf, kind })}`);
  mount(el, html`
    ${pageHead('Trial balance', `${tb.fundName} · as of ${fmtDate(asOf)}`, html`<a class="btn" href="#/statements?fund=${fund}&asOf=${asOf}">${icon('chart', 16)} Financial statements</a><button class="btn" id="csv">${icon('download', 16)} CSV</button><button class="btn" onclick="print()">${icon('file', 16)} Print</button>`)}
    <form class="toolbar" id="f"><select name="fund">${fundOptions(fund, { all: true })}</select><input type="date" name="asOf" value="${asOf}" />
      <select name="kind">${option('post-closing', 'Including closing entries', kind === 'post-closing')}${option('pre-closing', 'Before closing entries', kind === 'pre-closing')}</select><button class="btn">Show</button></form>
    <div class="card"><div class="print-head"><strong>${fin.settings.entity.name}</strong><span>Trial Balance · ${tb.fundName} · as of ${fmtDate(asOf)}</span></div>
      <div class="table-scroll"><table class="table compact"><thead><tr><th>Account code</th><th>Account title</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
      <tbody>${tb.rows.map((r) => html`<tr><td><a href="#/ledger/${r.code}?fund=${fund}">${r.code}</a></td><td>${r.title}</td>${amt(r.debit, { blankZero: true })}${amt(r.credit, { blankZero: true })}</tr>`)}</tbody>
      <tfoot><tr><td colspan="2">Total ${tb.debit === tb.credit ? '' : html`<span class="badge red">Out of balance</span>`}</td>${amt(tb.debit, { strong: true })}${amt(tb.credit, { strong: true })}</tr></tfoot></table></div>
      <div class="sign-row print-only"><div><span>Prepared by:</span><br /><br /><strong>${fin.settings.signatories.accountant.name}</strong><br />${fin.settings.signatories.accountant.title}</div></div></div>`);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    location.hash = `#/trial-balance?${new URLSearchParams(formData(e.target))}`;
  };
  el.querySelector('#csv').addEventListener('click', () => downloadFile(`trial-balance-${fund || 'all'}-${asOf}.csv`, toCsv([['Account code', 'Account title', 'Debit', 'Credit'], ...tb.rows.map((r) => [r.code, r.title, r.debit, r.credit]), ['', 'Total', tb.debit, tb.credit]])));
}

// ----- Financial statements -----
export async function statementsView(el, _p, query) {
  const fund = query.fund ?? fin.settings.funds[0];
  const asOf = query.asOf || today();
  const from = query.from || `${asOf.slice(0, 4)}-01-01`;
  const [pos, perf] = await Promise.all([
    api.get(`/api/finance/statements/position?${new URLSearchParams({ fund, asOf })}`),
    api.get(`/api/finance/statements/performance?${new URLSearchParams({ fund, from, to: asOf })}`),
  ]);
  const groups = (gs) => gs.map((g) => html`<tr class="term-row"><td>${g.title}</td><td class="num">${num(g.amount)}</td></tr>${g.accounts.map((a) => html`<tr><td class="indent">${a.title}</td><td class="num">${num(a.amount)}</td></tr>`)}`);
  const sig = fin.settings.signatories;
  mount(el, html`
    ${pageHead('Financial statements', `${pos.fundName} · per the Government Accounting Manual (PPSAS)`, html`<button class="btn" onclick="print()">${icon('file', 16)} Print</button>`)}
    <form class="toolbar" id="f"><select name="fund">${fundOptions(fund, { all: true })}</select><label>From <input type="date" name="from" value="${from}" /></label><label>As of <input type="date" name="asOf" value="${asOf}" /></label><button class="btn">Show</button></form>
    <div class="cols">
      <section class="card statement">
        <header class="st-head"><strong>${fin.settings.entity.name}</strong><span>Statement of Financial Position</span><span>${pos.fundName}</span><span>As of ${fmtDate(asOf)}</span></header>
        <table class="table compact no-stack"><tbody>
          <tr class="st-section"><td colspan="2">ASSETS</td></tr>
          <tr class="st-sub"><td colspan="2">Current assets</td></tr>${groups(pos.current)}<tr class="st-total"><td>Total current assets</td><td class="num">${num(pos.totals.current)}</td></tr>
          <tr class="st-sub"><td colspan="2">Non-current assets</td></tr>${groups(pos.nonCurrent)}<tr class="st-total"><td>Total non-current assets</td><td class="num">${num(pos.totals.nonCurrent)}</td></tr>
          <tr class="st-grand"><td>TOTAL ASSETS</td><td class="num">${num(pos.totals.assets)}</td></tr>
          <tr class="st-section"><td colspan="2">LIABILITIES</td></tr>${groups(pos.liabilities)}<tr class="st-total"><td>Total liabilities</td><td class="num">${num(pos.totals.liabilities)}</td></tr>
          <tr class="st-section"><td colspan="2">NET ASSETS/EQUITY</td></tr>${groups(pos.equity)}
          <tr><td class="indent">Surplus/(deficit) not yet closed</td><td class="num">${num(pos.surplusThisYear)}</td></tr>
          <tr class="st-total"><td>Total net assets/equity</td><td class="num">${num(pos.totals.equity)}</td></tr>
          <tr class="st-grand"><td>TOTAL LIABILITIES AND NET ASSETS/EQUITY</td><td class="num">${num(pos.totals.liabilities + pos.totals.equity)}</td></tr>
        </tbody></table>
        ${pos.totals.balanced ? '' : html`<p class="notice bad">Assets do not equal liabilities and equity: check the trial balance.</p>`}
      </section>
      <section class="card statement">
        <header class="st-head"><strong>${fin.settings.entity.name}</strong><span>Statement of Financial Performance</span><span>${perf.fundName}</span><span>${fmtDate(from)} to ${fmtDate(asOf)}</span></header>
        <table class="table compact no-stack"><tbody>
          <tr class="st-section"><td colspan="2">REVENUE</td></tr>${groups(perf.revenue)}<tr class="st-total"><td>Total revenue</td><td class="num">${num(perf.totals.revenue)}</td></tr>
          <tr class="st-section"><td colspan="2">LESS: CURRENT OPERATING EXPENSES</td></tr>${groups(perf.expenses)}<tr class="st-total"><td>Total expenses</td><td class="num">${num(perf.totals.expenses)}</td></tr>
          <tr class="st-grand"><td>SURPLUS/(DEFICIT) FOR THE PERIOD</td><td class="num">${num(perf.totals.surplus)}</td></tr>
        </tbody></table>
      </section>
    </div>
    <div class="sign-row print-only"><div>Certified correct:<br /><br /><strong>${sig.accountant.name}</strong><br />${sig.accountant.title}</div><div>Approved:<br /><br /><strong>${sig.head.name}</strong><br />${sig.head.title}</div></div>`);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    location.hash = `#/statements?${new URLSearchParams(formData(e.target))}`;
  };
}

// ----- Chart of accounts -----
export async function chartView(el, _p, query) {
  fin.accounts = null;
  const fund = query.fund || '';
  const list = await api.get(`/api/finance/accounts?balances=1${fund ? `&fund=${fund}` : ''}`);
  const q = String(query.q || '').toLowerCase();
  const group = query.group || '';
  const shown = list.filter((a) => (!q || `${a.code} ${a.title}`.toLowerCase().includes(q)) && (!group || String(a.group) === group));
  const edit = can('finance.settings');
  mount(el, html`
    ${pageHead('Chart of accounts', 'The Revised Chart of Accounts for national government agencies (COA). Account codes are 8 digits: group, major group, sub-major group, general ledger account.', html`<a class="btn" href="#/bank-recon">${icon('bank', 16)} Bank reconciliation</a>${edit ? html`<button class="btn primary" id="add">${icon('plus', 16)} Add account</button>` : ''}`)}
    <form class="toolbar" id="f"><select name="group">${option('', 'All groups', !group)}${[['1', 'Assets'], ['2', 'Liabilities'], ['3', 'Equity'], ['4', 'Revenue'], ['5', 'Expenses']].map(([v, l]) => option(v, l, v === group))}</select>
      <select name="fund">${fundOptions(fund, { all: true })}</select><input type="search" name="q" value="${query.q || ''}" placeholder="Code or title" /><button class="btn">${icon('search', 16)} Find</button></form>
    <div class="card"><div class="table-scroll"><table class="table compact"><thead><tr><th>Code</th><th>Account title</th><th>Normal</th><th>Class</th><th class="num">Balance</th>${edit ? html`<th></th>` : ''}</tr></thead>
    <tbody>${shown.map((a) => html`<tr class="${a.active ? '' : 'muted'}"><td><a href="#/ledger/${a.code}${fund ? `?fund=${fund}` : ''}">${a.code}</a></td><td>${a.title}${a.custom ? html` <span class="badge blue">Added</span>` : ''}${a.active ? '' : html` <span class="badge gray">Off</span>`}</td><td>${a.normal === 'debit' ? 'Dr' : 'Cr'}${a.contra ? ' (contra)' : ''}</td><td>${a.cls || ''}</td>${amt(a.balance, { blankZero: true })}
      ${edit ? html`<td class="row-actions"><button class="btn sm" data-toggle="${a.code}" data-on="${a.active ? '' : '1'}">${a.active ? 'Switch off' : 'Switch on'}</button></td>` : ''}</tr>`)}</tbody></table></div></div>`);
  const reload = () => chartView(el, _p, query);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    location.hash = `#/chart?${new URLSearchParams(formData(e.target))}`;
  };
  el.onclick = async (e) => {
    const b = e.target.closest('[data-toggle]');
    if (!b) return;
    try {
      await api.put(`/api/finance/accounts/${b.dataset.toggle}`, { active: Boolean(b.dataset.on) });
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  el.querySelector('#add')?.addEventListener('click', () => modal({
    title: 'Add an account', submitLabel: 'Add',
    body: html`<p class="muted small">Only add accounts COA has authorized (for example a sub-account the auditor approved). The code must fall under an existing major group.</p>
      <label class="field"><span>Account code (8 digits)</span><input name="code" inputmode="numeric" maxlength="8" required /></label>
      <label class="field"><span>Account title</span><input name="title" required /></label>
      <label class="field check"><input type="checkbox" name="contra" /> <span>Contra account (e.g. accumulated depreciation)</span></label>`,
    async onSubmit(form) {
      await api.post('/api/finance/accounts', { ...formData(form), contra: Boolean(formData(form).contra) });
      fin.accounts = null;
      toast('Account added.');
      reload();
    },
  }));
}

// ----- Bank reconciliation -----
export async function bankReconView(el, _p, query) {
  const chart = await fin.chart();
  const cashAccounts = chart.filter((a) => a.code.startsWith('1010') && a.active);
  const code = query.code || fin.settings.bankAccounts[0]?.code || '10102020';
  const fund = query.fund || fin.settings.bankAccounts.find((b) => b.code === code)?.fund || fin.settings.funds[0];
  const month = query.month || thisMonth();
  const r = await api.get(`/api/finance/bank-recon?${new URLSearchParams({ code, fund, month })}`);
  const edit = can('finance.accounts');
  mount(el, html`
    ${pageHead('Bank reconciliation', `${r.title} · Fund ${fund} · ${monthName(month)} (GAM Appendix ${code.startsWith('10104') ? '80' : '81'})`, html`<button class="btn" onclick="print()">${icon('file', 16)} Print</button>`)}
    <form class="toolbar" id="f"><select name="code">${cashAccounts.map((a) => option(a.code, `${a.code} · ${a.title}`, a.code === code))}</select><select name="fund">${fundOptions(fund)}</select><input type="month" name="month" value="${month}" /><button class="btn">Show</button></form>
    <form class="card" id="recon">
      <div class="grid">
        <div class="info"><dt>Balance per books</dt><dd><strong>${money(r.book)}</strong></dd></div>
        <label class="field"><span>Balance per bank statement</span><input type="number" step="0.01" name="statementBalance" value="${r.statementBalance ?? ''}" required ${edit ? '' : 'disabled'} /></label>
        <div class="info"><dt>Status</dt><dd id="status">—</dd></div>
      </div>
      <h3 class="sub-h">Book entries this month and earlier not yet cleared — tick what appears on the bank statement</h3>
      <div class="table-scroll"><table class="table compact"><thead><tr><th>Cleared</th><th>Date</th><th>JEV</th><th>Particulars</th><th class="num">Deposits / debits</th><th class="num">Checks / credits</th></tr></thead>
      <tbody>${r.items.map((i) => html`<tr><td><input type="checkbox" name="c" value="${i.key}" ${i.cleared ? 'checked' : ''} ${edit ? '' : 'disabled'} aria-label="Cleared" /></td><td class="nowrap">${fmtDate(i.date)}</td><td class="nowrap">${i.jevNo}</td><td>${i.particulars}</td>${amt(i.debit, { blankZero: true })}${amt(i.credit, { blankZero: true })}</tr>`)}</tbody></table></div>
      <table class="table compact recon-sum"><tbody>
        <tr><td>Balance per bank statement</td><td class="num" id="s-bank"></td></tr>
        <tr><td>Add: deposits in transit (uncleared debits)</td><td class="num" id="s-dit"></td></tr>
        <tr><td>Less: outstanding checks (uncleared credits)</td><td class="num" id="s-oc"></td></tr>
        <tr class="st-total"><td>Adjusted bank balance</td><td class="num" id="s-adj"></td></tr>
        <tr><td>Balance per books</td><td class="num">${num(r.book)}</td></tr>
        <tr class="st-grand"><td>Difference (bank charges, errors, unrecorded items: book them with a journal entry)</td><td class="num" id="s-diff"></td></tr>
      </tbody></table>
      ${edit ? html`<div class="actions end"><button class="btn primary">Save reconciliation</button></div>` : ''}
      ${r.saved ? html`<p class="muted small">Saved by ${r.savedBy}.</p>` : ''}
    </form>`);
  const form = el.querySelector('#recon');
  const calc = () => {
    const ticked = new Set([...form.querySelectorAll('input[name=c]:checked')].map((i) => i.value));
    const open = r.items.filter((i) => !ticked.has(i.key));
    const dit = open.reduce((s, i) => s + i.debit, 0);
    const oc = open.reduce((s, i) => s + i.credit, 0);
    const blank = form.statementBalance.value === '';
    const bank = Number(form.statementBalance.value) || 0;
    const adj = bank + dit - oc;
    const diff = Math.round((adj - r.book) * 100) / 100;
    // Nothing is "reconciled" until the bank statement's balance is entered.
    el.querySelector('#s-bank').textContent = blank ? '—' : num(bank);
    el.querySelector('#s-dit').textContent = num(dit);
    el.querySelector('#s-oc').textContent = num(oc);
    el.querySelector('#s-adj').textContent = blank ? '—' : num(adj);
    const badge = blank ? '<span class="muted">Enter the bank statement balance</span>' : diff === 0 ? '<span class="badge green">Reconciled</span>' : '<span class="badge amber">Not reconciled</span>';
    el.querySelector('#s-diff').innerHTML = blank ? '—' : `${num(diff)} ${badge}`;
    el.querySelector('#status').innerHTML = badge;
    const save = form.querySelector('button.primary');
    if (save) save.disabled = blank;
  };
  form.addEventListener('input', calc);
  calc();
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    location.hash = `#/bank-recon?${new URLSearchParams(formData(e.target))}`;
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/finance/bank-recon', { code, fund, month, statementBalance: form.statementBalance.value, cleared: [...form.querySelectorAll('input[name=c]:checked')].map((i) => i.value) });
      toast('Reconciliation saved.');
      bankReconView(el, _p, { ...query, code, fund, month });
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  void fundName;
}
