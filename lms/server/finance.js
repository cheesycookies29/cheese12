// ATLAS Finance (/finance/): government accounting for a state university or college, following
// the COA Government Accounting Manual for NGAs, DBM budget execution and BIR withholding rules.
// This file is the core: settings (the Control panel), the card file (suppliers, payees and
// accountable officers), the chart of accounts, journal entry vouchers and the books (general
// ledger, subsidiary ledgers, trial balance, financial statements), bank reconciliation, period
// locks and year-end closing. The other modules register their routes from:
//   finance-budget.js  appropriations, allotments, NCAs, ORS/BURS, registries and FARs
//   finance-supply.js  procurement (PR, PO), inventory (IAR, stock, RIS, RSMI, count) and property
//   finance-cash.js    disbursement (DV, checks, LDDAP-ADA, cash advances, taxes) and revenue
// Access ('finance' routes, see server/api.js): any signed-in employee (finance staff by their
// finance.* permissions; others use self-service) and students (their own payments).
import { randomUUID } from 'node:crypto';
import { HttpError, text, DATE_RE } from './util.js';
import { can, ROLES } from '../shared/roles.js';
import { hashPassword, validatePassword, publicUser } from './auth.js';
import { validateUserFields } from './admin.js';
import {
  DEFAULT_CHART, FUND_CLUSTERS, ALLOTMENT_CLASSES, DEFAULT_TAXES, DEFAULT_NUMBERING, JOURNALS, ACCT, MAJOR, CURRENT_ASSETS,
  FINANCE_PERMISSION_LABELS, CARD_KINDS, VAT_STATUS, NATURES, PPE_CLASSES, SEMI_CLASSES, SUPPLY_CLASSES, ADVANCE_TYPES,
  PROCUREMENT_MODES, PAYMENT_MODES, round2, sum, formatNo, classOf, fundName, tracksCard, coObject,
} from '../shared/finance.js';
import { registerBudgetRoutes } from './finance-budget.js';
import { registerSupplyRoutes } from './finance-supply.js';
import { registerCashRoutes } from './finance-cash.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
const iso = () => new Date().toISOString();
export const FINANCE_ROLES = Object.keys(ROLES).filter((r) => (ROLES[r].permissions || []).some((p) => p === '*' || p.startsWith('finance.')));
export const financePermissions = (role) => FINANCE_PERMISSION_LABELS.map(([p]) => p).filter((p) => can(role, p));

export const DEFAULT_FINANCE_SETTINGS = {
  entity: { name: '', agencyCode: '', address: '', tin: '' }, // name: the school's name when empty
  fiscalYear: null, // the year being worked on; null = this year
  funds: ['01', '05', '07'], // fund clusters in use (GAA, internally generated/STF, trust)
  offices: [], // responsibility centers: { code, name, head }
  paps: [], // programs/activities/projects (UACS PAP code): { code, name }
  bankAccounts: [], // { id, name, number, fund, code (ledger account) }
  signatories: {
    head: { name: '', title: 'Head of Agency' },
    accountant: { name: '', title: 'Chief Accountant' },
    budget: { name: '', title: 'Budget Officer' },
    cashier: { name: '', title: 'Cashier' },
    supply: { name: '', title: 'Supply and Property Officer' },
    inspector: { name: '', title: 'Inspection Officer' },
  },
  numbering: DEFAULT_NUMBERING,
  taxes: DEFAULT_TAXES,
  capitalization: 50000, // PPE at or above this cost; below it is semi-expendable (COA Circular 2022-004)
  semiHighValue: 5000, // semi-expendable high value (SPHV) from this cost; below is low value (SPLV)
  residualRate: 5, // percent of cost kept as residual value (GAM)
  liquidationDays: { opex: 20, travel: 30, foreign: 60, payroll: 5, sdo: 20 }, // days to liquidate (COA Circular 97-002 / 2012-004)
  svpLimit: 2000000, // Small Value Procurement ceiling for SUCs (RA 12009 IRR)
  directAcquisitionLimit: 200000, // Direct Acquisition ceiling (RA 12009 Sec. 32)
  depositDays: 1, // collections deposited intact within this many banking days
  revenueItems: [], // fees collected on official receipts: { id, name, code, amount, fund }
  lockedThrough: '', // 'YYYY-MM': months up to this one are closed to posting
};

export function mergeFinanceSettings(s = {}) {
  const d = structuredClone(DEFAULT_FINANCE_SETTINGS);
  const sig = Object.fromEntries(Object.entries(d.signatories).map(([k, v]) => [k, { ...v, ...(s.signatories?.[k] || {}) }]));
  return {
    ...d,
    ...s,
    entity: { ...d.entity, ...(s.entity || {}) },
    signatories: sig,
    numbering: { ...d.numbering, ...(s.numbering || {}) },
    liquidationDays: { ...d.liquidationDays, ...(s.liquidationDays || {}) },
    taxes: Array.isArray(s.taxes) && s.taxes.length ? s.taxes : d.taxes,
    funds: Array.isArray(s.funds) && s.funds.length ? s.funds : d.funds,
  };
}

// The chart lives in the database (accounts can be added and switched off); new default
// accounts are added when the app is updated.
export function mergeChart(list) {
  const out = Array.isArray(list) ? list : [];
  const have = new Set(out.map((a) => a.code));
  for (const a of DEFAULT_CHART) if (!have.has(a.code)) out.push({ ...a });
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

export function registerFinanceRoutes(route, ctx) {
  const data = () => ctx.db.data;
  const save = () => ctx.db.save();
  const S = () => data().finSettings;
  const today = () => ctx.today();
  const fy = () => Number(S().fiscalYear) || Number(today().slice(0, 4));
  const isStaff = (u) => can(u.role, 'finance.view');
  const staff = (u) => (isStaff(u) ? u : fail('This part of Finance is for the finance offices.', 403));
  const byId = (list, id) => list.find((x) => x.id === id);

  // ----- Shared helpers for every Finance module -----
  const fx = {
    ctx, data, save, S, today, fy, isStaff, staff, byId, fail, iso,
    monthLabel: (m) => monthLabel(m), monthEnd: (m) => monthEnd(m), prevDay: (d) => prevDay(d),
    audit(user, action, ref = {}) {
      data().finAudit.push({ id: randomUUID(), at: iso(), by: user?.name || 'System', byId: user?.id || null, action, ...ref });
      if (data().finAudit.length > 30000) data().finAudit.splice(0, data().finAudit.length - 30000);
    },
    // The next number in a series, e.g. DV 05-2026-11-0007. Serials restart each year and month
    // when the format has them, and run per fund cluster when it has {F}.
    nextNo(kind, { fund = '', date = today() } = {}) {
      const format = S().numbering[kind] || DEFAULT_NUMBERING[kind] || '{YYYY}-{N4}';
      const key = `${kind}|${format.includes('{F}') ? fund : ''}|${format.includes('{YYYY}') || format.includes('{YY}') ? date.slice(0, 4) : ''}|${format.includes('{MM}') ? date.slice(5, 7) : ''}`;
      const c = data().finCounters;
      c[key] = (c[key] || 0) + 1;
      return formatNo(format, { fund, date, serial: c[key] });
    },
    account(code, { postable = true } = {}) {
      const a = data().finAccounts.find((x) => x.code === String(code));
      if (!a) fail(`Account ${code} is not in the chart of accounts.`);
      if (postable && !a.active) fail(`Account ${a.code} ${a.title} is switched off.`);
      return a;
    },
    accountTitle: (code) => data().finAccounts.find((x) => x.code === code)?.title || code,
    card(id, { optional = false } = {}) {
      if (!id && optional) return null;
      return byId(data().finCards, id) || fail('Card not found (payee, supplier or officer).', 404);
    },
    cardName: (id) => byId(data().finCards, id)?.name || '',
    cardOfUser: (userId) => data().finCards.find((c) => c.userId === userId && c.status !== 'inactive') || null,
    fund(code) {
      if (!S().funds.includes(code)) fail(`Fund cluster ${code || '(none)'} is not in use. Switch it on in the Control panel.`);
      return code;
    },
    date(v, label = 'Date') {
      const d = String(v || '');
      if (!DATE_RE.test(d)) fail(`${label} is required (YYYY-MM-DD).`);
      return d;
    },
    money(v, label = 'Amount', { allowZero = false, allowNegative = false } = {}) {
      const n = round2(v);
      if (!Number.isFinite(n) || (!allowNegative && n < 0) || (!allowZero && n === 0)) fail(`${label} must be ${allowNegative ? 'a number' : allowZero ? 'zero or more' : 'more than zero'}.`);
      if (Math.abs(n) >= 1e12) fail(`${label} is too large.`);
      return n;
    },
    assertOpen(date) {
      const lock = S().lockedThrough;
      if (lock && date.slice(0, 7) <= lock) fail(`The books are closed through ${monthLabel(lock)}. Date it after, or reopen the period in the Control panel.`);
    },
    office: (code) => S().offices.find((o) => o.code === code) || null,
    signatory: (key) => S().signatories[key] || { name: '', title: '' },
    // Cash account a payment is made from: MDS for GAA (fund 01) and trust (07) checks and ADAs,
    // the fund's bank account otherwise.
    cashAccount(fund, mode, bankId) {
      if (mode === 'cash') return ACCT.advancesSdo;
      if (mode === 'check' || mode === 'ada') {
        if (fund === '01') return ACCT.cashMds;
        if (fund === '07') return ACCT.cashMdsTrust;
      }
      const bank = (bankId && S().bankAccounts.find((b) => b.id === bankId)) || S().bankAccounts.find((b) => b.fund === fund);
      return bank?.code || ACCT.cashBank;
    },
    // Post a journal entry voucher. lines: [{ code, debit, credit, cardId?, office?, memo? }].
    postJournal({ date, fund, journal = 'GJ', particulars, lines, source = null, user, status = 'posted' }) {
      fx.date(date);
      fx.fund(fund);
      if (status === 'posted') fx.assertOpen(date);
      if (status === 'posted' && date > today()) fail('An entry cannot be posted with a future date.');
      const clean = lines
        .map((l) => ({ code: String(l.code), debit: round2(l.debit || 0), credit: round2(l.credit || 0), cardId: l.cardId || null, office: l.office || '', memo: text(l.memo, 160) }))
        .filter((l) => l.debit || l.credit);
      if (clean.length < 2) fail('A journal entry needs at least two lines.');
      for (const l of clean) {
        fx.account(l.code);
        if (l.debit < 0 || l.credit < 0 || (l.debit && l.credit)) fail('Each line is either a debit or a credit, not both, and never negative.');
        if (l.cardId) fx.card(l.cardId);
      }
      const dr = sum(clean, (l) => l.debit);
      const cr = sum(clean, (l) => l.credit);
      if (dr !== cr) fail(`Debits (${dr.toFixed(2)}) and credits (${cr.toFixed(2)}) must be equal.`);
      const j = {
        id: randomUUID(), jevNo: status === 'posted' ? fx.nextNo('jev', { fund, date }) : '', date, fund, journal,
        particulars: text(particulars, 500) || '—', lines: clean, total: dr, source, status,
        createdAt: iso(), createdBy: user?.name || 'System', createdById: user?.id || null,
        postedAt: status === 'posted' ? iso() : null, postedBy: status === 'posted' ? user?.name || 'System' : null,
      };
      data().finJournals.push(j);
      if (status === 'posted') fx.audit(user, `Posted JEV ${j.jevNo}: ${j.particulars}`, { kind: 'jev', ref: j.id });
      return j;
    },
    // Reverse a posted entry with an opposite one (the original stays on the books).
    reverseJournal(j, user, reason, date = today()) {
      if (j.status !== 'posted') fail('Only a posted entry can be reversed.');
      if (j.reversedBy) fail('This entry was already reversed.');
      const r = fx.postJournal({
        date: date < j.date ? j.date : date, fund: j.fund, journal: 'GJ', user,
        particulars: `Reversal of JEV ${j.jevNo}: ${text(reason, 300) || 'error'}`,
        lines: j.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })),
        source: { kind: 'reversal', id: j.id },
      });
      j.reversedBy = r.id;
      r.reverses = j.id;
      return r;
    },
    // Posted journal lines, optionally for one fund, through a date, from a date.
    lines({ fund, from, to, code, cardId, exclude } = {}) {
      const out = [];
      for (const j of data().finJournals) {
        if (j.status !== 'posted' || (fund && j.fund !== fund) || (from && j.date < from) || (to && j.date > to)) continue;
        if (exclude && exclude(j)) continue;
        for (const l of j.lines) {
          if (code && (Array.isArray(code) ? !code.includes(l.code) : typeof code === 'function' ? !code(l.code) : l.code !== code)) continue;
          if (cardId && l.cardId !== cardId) continue;
          out.push({ ...l, journalId: j.id, jevNo: j.jevNo, date: j.date, fund: j.fund, journal: j.journal, particulars: j.particulars, source: j.source });
        }
      }
      return out.sort((a, b) => a.date.localeCompare(b.date) || a.jevNo.localeCompare(b.jevNo));
    },
    // Balances per account: { code: { debit, credit, balance (in the account's normal direction) } }.
    balances(opts = {}) {
      const map = {};
      for (const l of fx.lines(opts)) {
        const b = (map[l.code] ||= { debit: 0, credit: 0 });
        b.debit += Math.round(l.debit * 100);
        b.credit += Math.round(l.credit * 100);
      }
      for (const [code, b] of Object.entries(map)) {
        b.debit /= 100;
        b.credit /= 100;
        const a = data().finAccounts.find((x) => x.code === code);
        b.balance = round2(a?.normal === 'credit' ? b.credit - b.debit : b.debit - b.credit);
      }
      return map;
    },
    balance(code, opts = {}) {
      return fx.balances({ ...opts, code })[code]?.balance || 0;
    },
    // Cash available for a payment from a fund (Box C): the cash account's balance less vouchers
    // approved but not yet paid from it.
    cashAvailable(fund, mode, bankId, exceptDvId) {
      const code = fx.cashAccount(fund, mode, bankId);
      const committed = sum(data().finDvs.filter((d) => d.id !== exceptDvId && d.fund === fund && ['certified', 'approved'].includes(d.status) && fx.cashAccount(d.fund, d.mode, d.bankId) === code), (d) => d.net);
      return { code, title: fx.accountTitle(code), balance: fx.balance(code, { fund }), committed, available: round2(fx.balance(code, { fund }) - committed) };
    },
  };

  // ----- Settings and the Control panel -----
  const THRESHOLD_LABELS = { capitalization: 'The capitalization threshold', semiHighValue: 'The semi-expendable high-value threshold', residualRate: 'The residual value rate', depositDays: 'Days to deposit collections', svpLimit: 'The small value procurement limit', directAcquisitionLimit: 'The direct acquisition limit' };
  const publicSettings = () => ({
    ...S(),
    entity: { ...S().entity, name: S().entity.name || data().settings.schoolName },
    entityNameSet: S().entity.name, // blank: the school's name (Admin panel → Settings), kept in step with it
    fiscalYear: fy(),
    fundClusters: FUND_CLUSTERS,
    allotmentClasses: ALLOTMENT_CLASSES,
    journals: JOURNALS,
    cardKinds: CARD_KINDS,
    vatStatus: VAT_STATUS,
    natures: NATURES,
    ppeClasses: PPE_CLASSES,
    semiClasses: SEMI_CLASSES,
    supplyClasses: SUPPLY_CLASSES,
    advanceTypes: ADVANCE_TYPES,
    procurementModes: PROCUREMENT_MODES,
    paymentModes: PAYMENT_MODES,
    acct: ACCT,
  });
  // Employees' self-service needs the offices, funds and signatories (for requests and their printouts); not the rest.
  route('GET', '/api/finance/settings', 'finance', ({ user }) => {
    const p = publicSettings();
    return isStaff(user) ? p : { entity: p.entity, fiscalYear: p.fiscalYear, fundClusters: FUND_CLUSTERS, funds: p.funds, offices: p.offices, signatories: p.signatories, journals: JOURNALS, cardKinds: CARD_KINDS };
  });
  // Codes that Finance's documents use (fund clusters, offices, PAPs, ATCs, bank accounts), so a
  // setting still in use cannot be removed from under them.
  const DOC_COLLECTIONS = () => Object.keys(data()).filter((k) => k.startsWith('fin') && !['finSettings', 'finCounters', 'finAccounts', 'finAudit', 'finCards'].includes(k));
  const usedCodes = (key) => {
    const found = new Set();
    const walk = (v) => {
      if (Array.isArray(v)) for (const x of v) walk(x);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (k === key && (typeof x === 'string' || typeof x === 'number') ? found.add(String(x)) : walk(x));
    };
    for (const k of DOC_COLLECTIONS()) walk(data()[k]);
    return found;
  };
  const keepUsed = (before, after, key, label) => {
    const kept = new Set(after.map(String));
    const removed = before.map(String).filter((c) => !kept.has(c));
    if (!removed.length) return;
    const used = usedCodes(key);
    const inUse = removed.filter((c) => used.has(c));
    if (inUse.length) fail(`${label} ${inUse.join(', ')} ${inUse.length === 1 ? 'is' : 'are'} used by documents and cannot be removed.`);
  };
  route('PUT', '/api/finance/settings', 'finance:finance.settings', ({ user, body }) => {
    const s = S();
    if (body.entity) {
      s.entity = { name: text(body.entity.name, 160), agencyCode: text(body.entity.agencyCode, 20).replace(/[^0-9-]/g, ''), address: text(body.entity.address, 240), tin: text(body.entity.tin, 20) };
    }
    if (body.fiscalYear !== undefined) {
      const y = Number(body.fiscalYear);
      if (!Number.isInteger(y) || y < 2000 || y > 2100) fail('Fiscal year must be a year like 2026.');
      s.fiscalYear = y;
    }
    const list = (v, label) => (Array.isArray(v) ? v : fail(`${label} must be a list.`));
    if (body.funds) {
      list(body.funds, 'Fund clusters');
      const codes = [...new Set(body.funds.map(String))].filter((c) => FUND_CLUSTERS.some((f) => f.code === c));
      if (!codes.length) fail('Keep at least one fund cluster.');
      keepUsed(s.funds, codes, 'fund', 'Fund');
      s.funds = codes.sort();
    }
    const codeList = (items, label, max = 20) => {
      const out = list(items, `The ${label}s`).map((x) => ({ ...x, code: text(x.code, max).toUpperCase(), name: text(x.name, 160) })).filter((x) => x.code || x.name);
      for (const x of out) if (!x.code || !x.name) fail(`Each ${label} needs a code and a name.`);
      if (new Set(out.map((x) => x.code)).size !== out.length) fail(`Two ${label}s have the same code.`);
      return out;
    };
    if (body.offices) {
      const next = codeList(body.offices, 'office').map((o) => ({ code: o.code, name: o.name, head: text(o.head, 120) }));
      keepUsed(s.offices.map((o) => o.code), next.map((o) => o.code), 'office', 'Office');
      s.offices = next;
    }
    if (body.paps) {
      const next = codeList(body.paps, 'program/activity/project', 30).map((p) => ({ code: p.code, name: p.name }));
      keepUsed(s.paps.map((p) => p.code), next.map((p) => p.code), 'pap', 'PAP');
      s.paps = next;
    }
    if (body.bankAccounts) {
      const before = s.bankAccounts;
      s.bankAccounts = list(body.bankAccounts, 'Bank accounts').map((b) => {
        const code = String(b.code || ACCT.cashBank);
        if (!/^1010[1-5]/.test(code)) fail('A bank account posts to a cash account (101…).');
        fx.account(code);
        if (!text(b.name, 120) || !text(b.number, 40)) fail('Each bank account needs a bank name and an account number.');
        return { id: b.id || randomUUID(), name: text(b.name, 120), number: text(b.number, 40), fund: fx.fund(String(b.fund)), code };
      });
      keepUsed(before.map((b) => b.id), s.bankAccounts.map((b) => b.id), 'bankId', 'Bank account');
    }
    if (body.signatories && typeof body.signatories === 'object') {
      for (const k of Object.keys(s.signatories)) {
        if (body.signatories[k]) s.signatories[k] = { name: text(body.signatories[k].name, 120), title: text(body.signatories[k].title, 120) || s.signatories[k].title };
      }
    }
    if (body.numbering && typeof body.numbering === 'object') {
      for (const [k, v] of Object.entries(body.numbering)) {
        if (!(k in DEFAULT_NUMBERING)) continue;
        const f = text(v, 60);
        if (!/\{N\d?\}/.test(f)) fail(`The ${k.toUpperCase()} number needs a serial ({N} or {N4}).`);
        s.numbering[k] = f;
      }
    }
    if (body.taxes) {
      const before = s.taxes;
      s.taxes = list(body.taxes, 'Taxes').map((t) => {
        const rate = Number(t.rate);
        if (!/^[A-Z]{2}\d{3}$/.test(String(t.atc || '').toUpperCase())) fail('An ATC looks like WC158.');
        if (!(rate >= 0 && rate <= 50)) fail(`Rate for ${t.atc} must be between 0 and 50 percent.`);
        if (!['ewt', 'vat', 'pt'].includes(t.kind)) fail('Tax kind is ewt, vat or pt.');
        return { atc: String(t.atc).toUpperCase(), kind: t.kind, rate, payee: ['individual', 'corporation'].includes(t.payee) ? t.payee : undefined, nature: text(t.nature, 30), label: text(t.label, 200) };
      });
      const atcs = s.taxes.map((t) => t.atc);
      const dup = atcs.find((a, i) => atcs.indexOf(a) !== i);
      if (dup) fail(`ATC ${dup} is listed twice.`);
      keepUsed(before.map((t) => t.atc), atcs, 'atc', 'ATC');
    }
    for (const [k, min, max] of [['capitalization', 1, 1e7], ['semiHighValue', 0, 1e7], ['residualRate', 0, 50], ['depositDays', 0, 10], ['svpLimit', 0, 1e9], ['directAcquisitionLimit', 0, 1e9]]) {
      if (body[k] !== undefined) {
        const n = Number(body[k]);
        if (body[k] === '' || !(n >= min && n <= max)) fail(`${THRESHOLD_LABELS[k] || k} must be between ${min.toLocaleString('en-PH')} and ${max.toLocaleString('en-PH')}.`);
        s[k] = n;
      }
    }
    if (s.semiHighValue >= s.capitalization) fail('The semi-expendable high-value threshold must be below the capitalization threshold.');
    if (body.liquidationDays && typeof body.liquidationDays === 'object') {
      for (const k of Object.keys(s.liquidationDays)) {
        if (body.liquidationDays[k] === undefined) continue;
        const n = Number(body.liquidationDays[k]);
        if (!Number.isInteger(n) || n < 1 || n > 365) fail('Days to liquidate must be a whole number from 1 to 365.');
        s.liquidationDays[k] = n;
      }
    }
    if (body.revenueItems) {
      s.revenueItems = list(body.revenueItems, 'Fees').map((r) => {
        const a = fx.account(String(r.code));
        if (a.group !== 4 && !tracksCard(r.code)) fail(`${r.name}: a fee is credited to a revenue, trust or receivable account.`);
        if (!text(r.name, 120)) fail('Each fee needs a name.');
        const amount = Number(r.amount || 0);
        if (!Number.isFinite(amount) || amount < 0 || amount > 1e8) fail(`${text(r.name, 120)}: the amount must be 0 or more.`);
        return { id: r.id || randomUUID(), name: text(r.name, 120), code: a.code, amount: round2(amount), fund: fx.fund(String(r.fund || '05')) };
      });
    }
    fx.audit(user, 'Changed Finance settings', { kind: 'settings' });
    save();
    return publicSettings();
  });

  // Close (lock) the books through a month, or reopen.
  route('POST', '/api/finance/periods', 'finance:finance.accounts', ({ user, body }) => {
    const m = String(body.lockedThrough || '');
    if (m && !/^\d{4}-\d{2}$/.test(m)) fail('Pick a month (YYYY-MM).');
    if (m && m >= today().slice(0, 7)) fail('Only past months can be closed.');
    if (m && data().finJournals.some((j) => j.status === 'draft' && j.date.slice(0, 7) <= m)) fail(`Post or delete the draft entries dated through ${monthLabel(m)} first.`);
    const before = S().lockedThrough;
    S().lockedThrough = m;
    fx.audit(user, m ? `Closed the books through ${monthLabel(m)}${before && before > m ? ` (reopened after ${monthLabel(m)})` : ''}` : 'Reopened every period', { kind: 'period' });
    save();
    return { lockedThrough: m };
  });

  // Year-end closing: revenue and expense accounts closed to Accumulated Surplus/(Deficit).
  route('POST', '/api/finance/closing', 'finance:finance.accounts', ({ user, body }) => {
    const year = Number(body.year);
    const fund = fx.fund(String(body.fund || ''));
    if (!(year >= 2000)) fail('Pick the year to close.');
    if (year >= Number(today().slice(0, 4))) fail(`${year} is not over yet: close it in January ${year + 1} or later.`);
    const done = data().finJournals.find((j) => j.status === 'posted' && j.source?.kind === 'closing' && j.source.year === year && j.fund === fund && !j.reversedBy);
    if (done) fail(`${year} is already closed for fund ${fund} (JEV ${done.jevNo}).`);
    const b = fx.balances({ fund, from: `${year}-01-01`, to: `${year}-12-31` });
    const lines = [];
    for (const [code, x] of Object.entries(b)) {
      if (!['4', '5'].includes(code[0])) continue;
      const net = round2(x.debit - x.credit);
      if (net > 0) lines.push({ code, credit: net });
      if (net < 0) lines.push({ code, debit: -net });
    }
    if (!lines.length) fail(`Nothing to close: no revenue or expense in ${year} for fund ${fund}.`);
    const surplus = round2(sum(lines, (l) => l.debit || 0) - sum(lines, (l) => l.credit || 0));
    lines.push(surplus >= 0 ? { code: ACCT.surplus, credit: surplus } : { code: ACCT.surplus, debit: -surplus });
    const j = fx.postJournal({ date: `${year}-12-31`, fund, journal: 'GJ', user, particulars: `Closing of revenue and expense accounts for ${year}`, lines, source: { kind: 'closing', year } });
    save();
    return journalView(j);
  });

  // ----- Finance accounts (users) from the Control panel -----
  const financeAccount = (u) => ({ ...publicUser(u), roleLabel: ROLES[u.role]?.label || u.role, status: u.status, lastLoginAt: u.lastLoginAt || null, permissions: financePermissions(u.role) });
  route('GET', '/api/finance/users', 'finance:finance.settings', () => ({
    users: data().users.filter((u) => FINANCE_ROLES.includes(u.role)).sort((a, b) => a.name.localeCompare(b.name)).map(financeAccount),
    roles: FINANCE_ROLES.filter((r) => r !== 'admin').map((r) => ({ id: r, label: ROLES[r].label, description: ROLES[r].description, permissions: financePermissions(r) })),
    permissions: FINANCE_PERMISSION_LABELS,
  }));
  const FIN_ONLY = () => FINANCE_ROLES.filter((r) => r !== 'admin' && ROLES[r].side === 'hris');
  // Only administrators create or change Finance accounts, so no finance officer can give themselves another role's powers (separation of duties).
  const adminOnly = (u) => (u.role === 'admin' ? u : fail('Only an administrator creates or changes Finance accounts.', 403));
  route('POST', '/api/finance/users', 'finance:finance.settings', ({ user, body, campusId }) => {
    adminOnly(user);
    if (!FIN_ONLY().includes(body.role)) fail('Pick a Finance account type.');
    const fields = validateUserFields({ ...body, role: body.role }, data());
    validatePassword(body.password, data().settings.security);
    const u = { id: randomUUID(), ...fields, campusIds: [campusId || data().campuses[0]?.id].filter(Boolean), status: 'active', mustChangePassword: Boolean(data().settings.security?.forcePasswordChange) || body.mustChangePassword !== false, passwordHash: hashPassword(body.password), createdAt: iso() };
    data().users.push(u);
    fx.audit(user, `Created ${ROLES[u.role].label} account ${u.username}`, { kind: 'user', ref: u.id });
    save();
    return financeAccount(u);
  });
  route('PUT', '/api/finance/users/:id', 'finance:finance.settings', ({ user, params, body }) => {
    adminOnly(user);
    const u = byId(data().users, params.id);
    if (!u || !FIN_ONLY().includes(u.role)) fail('Only Finance accounts are changed here. Administrators and other accounts are managed in the admin panel.', 404);
    if (body.role && body.role !== u.role) {
      if (!FIN_ONLY().includes(body.role)) fail('Pick a Finance account type.');
      if (u.id === user.id) fail('You cannot change your own account type.');
      u.role = body.role;
      ctx.signOutEverywhere(u.id);
    }
    if (body.status && body.status !== u.status) {
      if (!['active', 'disabled'].includes(body.status)) fail('Status is active or disabled.');
      if (u.id === user.id) fail('You cannot disable your own account.');
      u.status = body.status;
      if (u.status === 'disabled') ctx.signOutEverywhere(u.id);
    }
    if (body.password) {
      validatePassword(body.password, data().settings.security);
      u.passwordHash = hashPassword(body.password);
      u.mustChangePassword = true;
      ctx.signOutEverywhere(u.id);
    }
    fx.audit(user, `Changed account ${u.username}`, { kind: 'user', ref: u.id });
    save();
    return financeAccount(u);
  });
  route('GET', '/api/finance/audit', 'finance:finance.view', ({ query }) => {
    const q = String(query.q || '').toLowerCase();
    return data().finAudit.filter((a) => (!q || `${a.action} ${a.by}`.toLowerCase().includes(q)) && (!query.kind || a.kind === query.kind)).slice(-500).reverse();
  });

  // ----- Card file -----
  // Every party the agency deals with: suppliers and contractors, employees (as payees and
  // custodians of property), accountable officers (with their fidelity bond), other agencies
  // and individuals. Each card has its own subsidiary ledger (accounts payable, advances,
  // receivables), its withholding taxes and its documents.
  const cardRow = (c) => ({ ...c, userName: c.userId ? byId(data().users, c.userId)?.name || '' : '' });
  function cardFields(body, existing) {
    const kind = CARD_KINDS.some(([k]) => k === body.kind) ? body.kind : existing?.kind || fail('Pick the kind of card.');
    const name = text(body.name ?? existing?.name, 160) || fail('Name is required.');
    const tin = text(body.tin ?? existing?.tin, 20);
    if (tin && !/^\d{3}-?\d{3}-?\d{3}(-?\d{3,5})?$/.test(tin)) fail('TIN looks like 123-456-789-000.');
    const vat = VAT_STATUS.some(([v]) => v === body.vat) ? body.vat : existing?.vat || (kind === 'supplier' ? 'vat' : 'exempt');
    const taxType = ['individual', 'corporation'].includes(body.taxType) ? body.taxType : existing?.taxType || (kind === 'supplier' ? 'corporation' : 'individual');
    const nature = NATURES.some(([n]) => n === body.nature) ? body.nature : existing?.nature || (kind === 'supplier' ? 'goods' : 'none');
    const userId = body.userId !== undefined ? body.userId || null : existing?.userId || null;
    if (userId && !byId(data().users, userId)) fail('Linked account not found.');
    if (userId && data().finCards.some((c) => c.userId === userId && c.id !== existing?.id)) fail('That account already has a card.');
    const bond = body.bond !== undefined ? { amount: round2(body.bond?.amount || 0), expires: DATE_RE.test(body.bond?.expires || '') ? body.bond.expires : '', policy: text(body.bond?.policy, 40) } : existing?.bond || { amount: 0, expires: '', policy: '' };
    const dup = data().finCards.find((c) => c.id !== existing?.id && c.name.toLowerCase() === name.toLowerCase() && (c.tin || '') === tin);
    if (dup) fail(`${dup.name} already has a card.`);
    return {
      kind, name, tin, vat, taxType, nature, userId, bond,
      address: text(body.address ?? existing?.address, 240), email: text(body.email ?? existing?.email, 160), phone: text(body.phone ?? existing?.phone, 40),
      contact: text(body.contact ?? existing?.contact, 120), position: text(body.position ?? existing?.position, 120), office: text(body.office ?? existing?.office, 20),
      bankName: text(body.bankName ?? existing?.bankName, 120), bankAccount: text(body.bankAccount ?? existing?.bankAccount, 40),
      status: ['active', 'inactive', 'blacklisted'].includes(body.status) ? body.status : existing?.status || 'active',
      notes: text(body.notes ?? existing?.notes, 1000),
    };
  }
  route('GET', '/api/finance/cards', 'finance:finance.view', ({ query }) => {
    const q = String(query.q || '').toLowerCase();
    const bal = fx.balances({ code: (c) => /^(201|204)/.test(c) || c.startsWith('19901') || c.startsWith('103') });
    const byCard = {};
    for (const l of fx.lines({ code: (c) => c in bal })) {
      const k = (byCard[l.cardId] ||= { payable: 0, advances: 0, receivable: 0 });
      const v = round2(l.debit - l.credit);
      if (/^(201|204)/.test(l.code)) k.payable = round2(k.payable - v); // payables and deposits held for the card (not amounts withheld for other agencies, 202)
      else if (l.code.startsWith('19901')) k.advances = round2(k.advances + v);
      else k.receivable = round2(k.receivable + v);
    }
    return data().finCards
      .filter((c) => (!query.kind || c.kind === query.kind) && (!q || `${c.name} ${c.tin} ${c.address}`.toLowerCase().includes(q)) && (query.all || c.status !== 'inactive'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ ...cardRow(c), ...(byCard[c.id] || { payable: 0, advances: 0, receivable: 0 }) }));
  });
  route('POST', '/api/finance/cards', 'finance:finance.cardfile', ({ user, body }) => {
    const c = { id: randomUUID(), ...cardFields(body), createdAt: iso() };
    data().finCards.push(c);
    fx.audit(user, `Added card ${c.name}`, { kind: 'card', ref: c.id });
    save();
    return cardRow(c);
  });
  route('PUT', '/api/finance/cards/:id', 'finance:finance.cardfile', ({ user, params, body }) => {
    const c = fx.card(params.id);
    Object.assign(c, cardFields(body, c), { updatedAt: iso() });
    fx.audit(user, `Changed card ${c.name}`, { kind: 'card', ref: c.id });
    save();
    return cardRow(c);
  });
  // ATLAS accounts a card can be linked to (employees, for self-service and custody of property).
  route('GET', '/api/finance/cards/linkable', 'finance:finance.cardfile', () => data().users
    .filter((u) => u.status === 'active' && !['student', 'guardian'].includes(u.role))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => ({ id: u.id, name: u.name, username: u.username, roleLabel: ROLES[u.role]?.label || u.role, linked: data().finCards.some((c) => c.userId === u.id) })));
  route('GET', '/api/finance/cards/:id', 'finance:finance.view', ({ params }) => {
    const c = fx.card(params.id);
    const lines = fx.lines({ cardId: c.id });
    const ledgers = {};
    for (const l of lines) {
      const g = (ledgers[l.code] ||= { code: l.code, title: fx.accountTitle(l.code), rows: [], balance: 0 });
      const a = fx.account(l.code, { postable: false });
      g.balance = round2(g.balance + (a.normal === 'credit' ? l.credit - l.debit : l.debit - l.credit));
      g.rows.push({ date: l.date, jevNo: l.jevNo, journalId: l.journalId, particulars: l.particulars, debit: l.debit, credit: l.credit, balance: g.balance });
    }
    const d = data();
    return {
      card: cardRow(c),
      ledgers: Object.values(ledgers),
      dvs: d.finDvs.filter((x) => x.payeeId === c.id).map((x) => ({ id: x.id, no: x.no, date: x.date, particulars: x.particulars, gross: x.gross, taxes: x.taxTotal, net: x.net, status: x.status, kind: x.kind })).reverse(),
      pos: d.finPos.filter((x) => x.supplierId === c.id).map((x) => ({ id: x.id, no: x.no, date: x.date, total: x.total, status: x.status })).reverse(),
      receipts: d.finReceipts.filter((x) => x.payorCardId === c.id).map((x) => ({ id: x.id, no: x.no, date: x.date, total: x.total, status: x.status })).reverse(),
      obligations: d.finObligations.filter((x) => x.payeeId === c.id).map((x) => ({ id: x.id, no: x.no, form: x.form, date: x.date, amount: x.amount, status: x.status })).reverse(),
      property: d.finProperty.filter((p) => p.custodianId === c.id && p.status === 'issued').map((p) => ({ id: p.id, propertyNo: p.propertyNo, description: p.description, cost: p.cost, type: p.type, docNo: p.docNo })),
      taxes: Object.values(d.finDvs.filter((x) => x.payeeId === c.id && x.status === 'paid').flatMap((x) => x.taxes.map((t) => ({ ...t, date: x.paidDate }))).reduce((m, t) => {
        const k = `${t.date.slice(0, 4)}-Q${Math.ceil(Number(t.date.slice(5, 7)) / 3)}|${t.atc}`;
        const r = (m[k] ||= { quarter: k.split('|')[0], atc: t.atc, base: 0, amount: 0 });
        r.base = round2(r.base + t.base);
        r.amount = round2(r.amount + t.amount);
        return m;
      }, {})).sort((a, b) => b.quarter.localeCompare(a.quarter)),
    };
  });

  // ----- Chart of accounts -----
  route('GET', '/api/finance/accounts', 'finance:finance.view', ({ query }) => {
    const b = query.balances ? fx.balances({ fund: query.fund || undefined, to: query.asOf || undefined }) : {};
    return data().finAccounts.map((a) => ({ ...a, uacs: `${a.code}00`, balance: b[a.code]?.balance || 0, used: Boolean(b[a.code]) }));
  });
  route('POST', '/api/finance/accounts', 'finance:finance.settings', ({ user, body }) => {
    const code = String(body.code || '').replace(/\D/g, '');
    if (!/^[1-5]\d{7}$/.test(code)) fail('An account code has 8 digits and starts with 1 to 5.');
    if (data().finAccounts.some((a) => a.code === code)) fail(`Account ${code} already exists.`);
    if (!MAJOR[code.slice(0, 3)]) fail(`${code.slice(0, 3)} is not a major account group in the Revised Chart of Accounts.`);
    const title = text(body.title, 160) || fail('Title is required.');
    const contra = Boolean(body.contra);
    const debit = ['1', '5'].includes(code[0]);
    const a = { code, title, group: Number(code[0]), normal: (contra ? !debit : debit) ? 'debit' : 'credit', contra, cls: classOf(code), active: true, custom: true };
    data().finAccounts.push(a);
    data().finAccounts.sort((x, y) => x.code.localeCompare(y.code));
    fx.audit(user, `Added account ${code} ${title}`, { kind: 'account' });
    save();
    return a;
  });
  route('PUT', '/api/finance/accounts/:code', 'finance:finance.settings', ({ user, params, body }) => {
    const a = fx.account(params.code, { postable: false });
    if (body.title !== undefined && a.custom) a.title = text(body.title, 160) || a.title;
    if (body.active !== undefined) {
      if (!body.active && Object.values(ACCT).includes(a.code)) fail(`${a.title} is used by the modules and stays on.`);
      a.active = Boolean(body.active);
    }
    fx.audit(user, `${a.active ? 'Changed' : 'Switched off'} account ${a.code} ${a.title}`, { kind: 'account' });
    save();
    return a;
  });

  // ----- Journal entry vouchers -----
  const journalView = (j) => ({
    ...j,
    lines: j.lines.map((l) => ({ ...l, title: fx.accountTitle(l.code), uacs: `${l.code}00`, cardName: l.cardId ? fx.cardName(l.cardId) : '' })),
    journalLabel: JOURNALS.find(([k]) => k === j.journal)?.[1] || j.journal,
    reversedByNo: j.reversedBy ? byId(data().finJournals, j.reversedBy)?.jevNo : null,
    reversesNo: j.reverses ? byId(data().finJournals, j.reverses)?.jevNo : null,
  });
  fx.journalView = journalView;
  route('GET', '/api/finance/journals', 'finance:finance.view', ({ query }) => {
    const q = String(query.q || '').toLowerCase();
    return data().finJournals
      .filter((j) => (!query.fund || j.fund === query.fund) && (!query.journal || j.journal === query.journal) && (!query.status || j.status === query.status)
        && (!query.from || j.date >= query.from) && (!query.to || j.date <= query.to) && (!q || `${j.jevNo} ${j.particulars}`.toLowerCase().includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, Number(query.limit) || 300)
      .map((j) => ({ id: j.id, jevNo: j.jevNo, date: j.date, fund: j.fund, journal: j.journal, particulars: j.particulars, total: j.total, status: j.status, source: j.source, reversedBy: j.reversedBy || null }));
  });
  route('GET', '/api/finance/journals/:id', 'finance:finance.view', ({ params }) => journalView(byId(data().finJournals, params.id) || fail('Entry not found.', 404)));
  // A manual entry: saved as a draft, posted by an accountant.
  function manualFields(body) {
    const lines = (Array.isArray(body.lines) ? body.lines : []).map((l) => ({ code: String(l.code || ''), debit: round2(l.debit || 0), credit: round2(l.credit || 0), cardId: l.cardId || null, office: text(l.office, 20), memo: l.memo }))
      .filter((l) => l.code || l.debit || l.credit);
    for (const l of lines) fx.account(l.code);
    return { date: fx.date(body.date), fund: fx.fund(String(body.fund || '')), journal: JOURNALS.some(([k]) => k === body.journal) ? body.journal : 'GJ', particulars: text(body.particulars, 500), lines };
  }
  route('POST', '/api/finance/journals', 'finance:finance.accounts', ({ user, body }) => {
    const f = manualFields(body);
    if (!f.particulars) fail('Particulars are required.');
    const j = { id: randomUUID(), jevNo: '', ...f, total: sum(f.lines, (l) => l.debit), source: { kind: 'manual' }, status: 'draft', createdAt: iso(), createdBy: user.name, createdById: user.id };
    data().finJournals.push(j);
    if (body.post) postDraft(j, user);
    save();
    return journalView(j);
  });
  route('PUT', '/api/finance/journals/:id', 'finance:finance.accounts', ({ params, body }) => {
    const j = byId(data().finJournals, params.id) || fail('Entry not found.', 404);
    if (j.status !== 'draft') fail('A posted entry cannot be changed; reverse it instead.');
    Object.assign(j, manualFields({ ...j, ...body }));
    j.total = sum(j.lines, (l) => l.debit);
    save();
    return journalView(j);
  });
  function postDraft(j, user) {
    const posted = fx.postJournal({ ...j, user, source: j.source, status: 'posted' });
    data().finJournals.pop(); // keep the draft's identity
    Object.assign(j, { jevNo: posted.jevNo, lines: posted.lines, total: posted.total, status: 'posted', postedAt: posted.postedAt, postedBy: posted.postedBy });
  }
  route('POST', '/api/finance/journals/:id/post', 'finance:finance.accounts', ({ user, params }) => {
    const j = byId(data().finJournals, params.id) || fail('Entry not found.', 404);
    if (j.status !== 'draft') fail('This entry is already posted.');
    postDraft(j, user);
    save();
    return journalView(j);
  });
  route('POST', '/api/finance/journals/:id/reverse', 'finance:finance.accounts', ({ user, params, body }) => {
    const j = byId(data().finJournals, params.id) || fail('Entry not found.', 404);
    if (j.source?.kind && !['manual', 'closing', 'opening'].includes(j.source.kind)) fail('This entry was made by a module. Undo it there (cancel the voucher, receipt or report).');
    const r = fx.reverseJournal(j, user, text(body.reason, 300) || fail('Give the reason for the reversal.'), body.date && DATE_RE.test(body.date) ? body.date : today());
    save();
    return journalView(r);
  });
  route('DELETE', '/api/finance/journals/:id', 'finance:finance.accounts', ({ params }) => {
    const j = byId(data().finJournals, params.id) || fail('Entry not found.', 404);
    if (j.status !== 'draft') fail('Only drafts can be deleted.');
    data().finJournals = data().finJournals.filter((x) => x !== j);
    save();
    return { ok: true };
  });

  // ----- Books: general ledger, subsidiary ledger, trial balance, statements -----
  route('GET', '/api/finance/ledger/:code', 'finance:finance.view', ({ params, query }) => {
    const a = fx.account(params.code, { postable: false });
    const fund = query.fund || undefined;
    const from = query.from || `${fy()}-01-01`;
    const to = query.to || today();
    const before = fx.balances({ fund, code: a.code, to: prevDay(from) })[a.code];
    let bal = before?.balance || 0;
    const rows = fx.lines({ fund, code: a.code, from, to }).map((l) => {
      bal = round2(bal + (a.normal === 'credit' ? l.credit - l.debit : l.debit - l.credit));
      return { ...l, cardName: l.cardId ? fx.cardName(l.cardId) : '', balance: bal };
    });
    return { account: a, fund: fund || '', from, to, opening: before?.balance || 0, rows, closing: bal, debits: sum(rows, (r) => r.debit), credits: sum(rows, (r) => r.credit) };
  });
  // Trial balance: every account with a balance, debit or credit column.
  function trialBalance({ fund, asOf, from, excludeClosing }) {
    // Before closing entries: leave out only the closing of the year being shown (earlier years stay closed).
    const closingOfYear = (j) => j?.source?.kind === 'closing' && String(j.source.year) === asOf.slice(0, 4);
    const b = fx.balances({ fund, to: asOf, from, exclude: excludeClosing ? (j) => closingOfYear(j) || (j.reverses && closingOfYear(byId(data().finJournals, j.reverses))) : undefined });
    const rows = Object.entries(b).map(([code, x]) => {
      const net = round2(x.debit - x.credit);
      return { code, title: fx.accountTitle(code), uacs: `${code}00`, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
    }).filter((r) => r.debit || r.credit).sort((x, y) => x.code.localeCompare(y.code));
    return { rows, debit: sum(rows, (r) => r.debit), credit: sum(rows, (r) => r.credit) };
  }
  route('GET', '/api/finance/trial-balance', 'finance:finance.view', ({ query }) => {
    const asOf = query.asOf || today();
    const fund = query.fund || undefined;
    return { fund: fund || '', fundName: fund ? fundName(fund) : 'All fund clusters', asOf, ...trialBalance({ fund, asOf, excludeClosing: query.kind === 'pre-closing' }) };
  });
  // Statement of Financial Position: assets (current, non-current), liabilities, net assets/equity.
  route('GET', '/api/finance/statements/position', 'finance:finance.view', ({ query }) => {
    const asOf = query.asOf || today();
    const fund = query.fund || undefined;
    const b = fx.balances({ fund, to: asOf });
    // Revenue less expenses not yet closed to Accumulated Surplus (this year's, and any earlier year not closed yet).
    const perf = b;
    const net = round2(sum(Object.entries(perf).filter(([c]) => c[0] === '4'), ([, x]) => x.credit - x.debit) - sum(Object.entries(perf).filter(([c]) => c[0] === '5'), ([, x]) => x.debit - x.credit));
    const lines = (pred) => {
      const groups = {};
      for (const [code, x] of Object.entries(b)) {
        if (!pred(code)) continue;
        const major = code.slice(0, 3);
        const g = (groups[major] ||= { code: major, title: MAJOR[major] || major, amount: 0, accounts: [] });
        const a = fx.account(code, { postable: false });
        const amt = round2(code[0] === '1' ? x.debit - x.credit : x.credit - x.debit);
        if (!amt) continue;
        g.amount = round2(g.amount + amt);
        g.accounts.push({ code, title: a.title, amount: amt });
      }
      return Object.values(groups).filter((g) => g.accounts.length).sort((x, y) => x.code.localeCompare(y.code));
    };
    const current = lines((c) => c[0] === '1' && CURRENT_ASSETS.includes(c.slice(0, 3)));
    const nonCurrent = lines((c) => c[0] === '1' && !CURRENT_ASSETS.includes(c.slice(0, 3)));
    const liabilities = lines((c) => c[0] === '2');
    const equity = lines((c) => c[0] === '3');
    const total = (gs) => sum(gs, (g) => g.amount);
    const assets = round2(total(current) + total(nonCurrent));
    const liab = total(liabilities);
    const eq = round2(total(equity) + net);
    return { fund: fund || '', fundName: fund ? fundName(fund) : 'All fund clusters', asOf, current, nonCurrent, liabilities, equity, surplusThisYear: net, totals: { current: total(current), nonCurrent: total(nonCurrent), assets, liabilities: liab, equity: eq, balanced: round2(assets - liab - eq) === 0 } };
  });
  // Statement of Financial Performance: revenue less expenses for a period.
  route('GET', '/api/finance/statements/performance', 'finance:finance.view', ({ query }) => {
    const from = query.from || `${fy()}-01-01`;
    const to = query.to || today();
    const fund = query.fund || undefined;
    const b = fx.balances({ fund, from, to, exclude: (j) => j.source?.kind === 'closing' });
    const group = (digit) => {
      const groups = {};
      for (const [code, x] of Object.entries(b)) {
        if (code[0] !== digit) continue;
        const major = code.slice(0, 3);
        const g = (groups[major] ||= { code: major, title: MAJOR[major] || major, amount: 0, accounts: [] });
        const amt = round2(digit === '4' ? x.credit - x.debit : x.debit - x.credit);
        if (!amt) continue;
        g.amount = round2(g.amount + amt);
        g.accounts.push({ code, title: fx.accountTitle(code), amount: amt });
      }
      return Object.values(groups).filter((g) => g.accounts.length).sort((x, y) => x.code.localeCompare(y.code));
    };
    const revenue = group('4');
    const expenses = group('5');
    const tr = sum(revenue, (g) => g.amount);
    const te = sum(expenses, (g) => g.amount);
    return { fund: fund || '', fundName: fund ? fundName(fund) : 'All fund clusters', from, to, revenue, expenses, totals: { revenue: tr, expenses: te, surplus: round2(tr - te) } };
  });

  // ----- Bank reconciliation -----
  // For a cash account and month: the book balance, checks issued not yet cleared, deposits
  // not yet credited by the bank, and the bank statement's balance.
  route('GET', '/api/finance/bank-recon', 'finance:finance.view', ({ query }) => {
    const code = String(query.code || ACCT.cashBank);
    const fund = String(query.fund || S().funds[0]);
    const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : today().slice(0, 7);
    const end = monthEnd(month);
    const saved = data().finBankRecons.find((r) => r.code === code && r.fund === fund && r.month === month) || null;
    const cleared = new Set(data().finBankRecons.filter((r) => r.code === code && r.fund === fund && r.month <= month).flatMap((r) => r.cleared));
    const items = fx.lines({ fund, code, to: end }).filter((l) => !cleared.has(`${l.journalId}|${l.debit}|${l.credit}`) || saved?.cleared.includes(`${l.journalId}|${l.debit}|${l.credit}`))
      .map((l) => ({ key: `${l.journalId}|${l.debit}|${l.credit}`, date: l.date, jevNo: l.jevNo, particulars: l.particulars, debit: l.debit, credit: l.credit, cleared: saved?.cleared.includes(`${l.journalId}|${l.debit}|${l.credit}`) || false }));
    const book = fx.balance(code, { fund, to: end });
    return { code, title: fx.accountTitle(code), fund, month, book, statementBalance: saved?.statementBalance ?? null, items, saved: Boolean(saved), savedBy: saved?.by || '', bankCharges: saved?.bankCharges || 0 };
  });
  route('POST', '/api/finance/bank-recon', 'finance:finance.accounts', ({ user, body }) => {
    const code = String(body.code);
    fx.account(code);
    const fund = fx.fund(String(body.fund));
    const month = /^\d{4}-\d{2}$/.test(body.month || '') ? body.month : fail('Pick the month.');
    const statementBalance = fx.money(body.statementBalance, 'Bank statement balance', { allowZero: true, allowNegative: true });
    const list = data().finBankRecons;
    let r = list.find((x) => x.code === code && x.fund === fund && x.month === month);
    if (!r) list.push((r = { id: randomUUID(), code, fund, month }));
    Object.assign(r, { statementBalance, cleared: (Array.isArray(body.cleared) ? body.cleared : []).map(String), by: user.name, at: iso() });
    fx.audit(user, `Reconciled ${fx.accountTitle(code)} (fund ${fund}) for ${monthLabel(month)}`, { kind: 'bank-recon' });
    save();
    return { ok: true };
  });

  // ----- Find a document by its number (or a check no., a payee or supplier's name) -----
  route('GET', '/api/finance/find', 'finance:finance.view', ({ query }) => {
    const q = String(query.q || '').trim().toLowerCase();
    if (q.length < 2) return [];
    const norm = (v) => String(v || '').toLowerCase();
    const has = (...vals) => vals.some((v) => norm(v).includes(q));
    const d = data();
    const out = [];
    const push = (kind, no, date, text, href) => out.push({ kind, no, date, text, href });
    for (const x of d.finDvs) if (has(x.no, x.checkNo, fx.cardName(x.payeeId))) push('Disbursement voucher', x.no || 'Not yet numbered', x.paidDate || x.date, `${fx.cardName(x.payeeId)} · ${x.particulars}${x.checkNo ? ` · check ${x.checkNo}` : ''}`, `/dvs/${x.id}`);
    for (const x of d.finJournals) if (has(x.jevNo)) push('Journal entry voucher', x.jevNo, x.date, x.particulars, `/journals/${x.id}`);
    for (const x of d.finObligations) if (has(x.no, fx.cardName(x.payeeId))) push(x.form, x.no || 'Not yet numbered', x.obligatedDate || x.date, `${fx.cardName(x.payeeId)} · ${x.particulars}`, `/obligations/${x.id}`);
    for (const x of d.finPrs) if (has(x.no)) push('Purchase request', x.no, x.date, x.purpose, `/prs/${x.id}`);
    for (const x of d.finPos) if (has(x.no, fx.cardName(x.supplierId))) push('Purchase order', x.no, x.date, fx.cardName(x.supplierId), `/pos/${x.id}`);
    for (const x of d.finIars) if (has(x.no, x.invoiceNo)) push('Inspection and acceptance report', x.no, x.date, `Invoice ${x.invoiceNo} · ${fx.cardName(x.supplierId)}`, `/pos/${x.poId}`);
    for (const x of d.finRis) if (has(x.no)) push('Requisition and issue slip', x.no, x.date, x.purpose, `/ris/${x.id}`);
    for (const x of d.finReceipts) if (has(x.no, x.payorName)) push('Official receipt', x.no, x.date, `${x.payorName}${x.status === 'cancelled' ? ' (cancelled)' : ''}`, `/print/or/${x.id}`);
    for (const x of d.finRcds) if (has(x.no)) push('Report of collections and deposits', x.no, x.date, `O.R. ${x.from}–${x.to}`, `/rcds/${x.id}`);
    for (const x of d.finLddaps) if (has(x.no)) push('LDDAP-ADA', x.no, x.date, `${x.dvIds.length} voucher(s)`, `/print/lddap/${x.id}`);
    for (const x of d.finProperty) if (has(x.propertyNo, x.docNo, x.serialNo)) push(x.type === 'ppe' ? 'Property (PAR)' : 'Property (ICS)', x.propertyNo, x.acquired, `${x.description}${x.docNo ? ` · ${x.type === 'ppe' ? 'PAR' : 'ICS'} ${x.docNo}` : ''}`, `/property/${x.id}`);
    for (const x of d.finCards) if (has(x.name, x.tin)) push('Card', x.name, '', x.tin ? `TIN ${x.tin}` : x.kind, `/cards/${x.id}`);
    return out.sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 60);
  });

  // ----- Dashboard -----
  route('GET', '/api/finance/dashboard', 'finance:finance.view', ({ user }) => {
    const d = data();
    const t = today();
    const year = fy();
    const cash = S().funds.map((fund) => {
      const b = fx.balances({ fund, code: (c) => c.startsWith('101') });
      return { fund, name: fundName(fund), total: sum(Object.values(b), (x) => x.balance), accounts: Object.entries(b).filter(([, x]) => x.balance).map(([code, x]) => ({ code, title: fx.accountTitle(code), balance: x.balance })) };
    });
    const budget = ctx.financeBudget.utilization(year);
    const queue = {
      orsToObligate: d.finObligations.filter((o) => o.status === 'draft' && o.submitted).length,
      dvToCertify: d.finDvs.filter((x) => x.status === 'draft' && x.submitted).length,
      dvToApprove: d.finDvs.filter((x) => x.status === 'certified').length,
      dvToPay: d.finDvs.filter((x) => x.status === 'approved').length,
      prToApprove: d.finPrs.filter((x) => x.status === 'submitted').length,
      poToApprove: d.finPos.filter((x) => x.status === 'draft' && x.orsId && byId(d.finObligations, x.orsId)?.status === 'obligated').length,
      risToIssue: d.finRis.filter((x) => ['requested', 'approved'].includes(x.status)).length,
      draftJournals: d.finJournals.filter((j) => j.status === 'draft').length,
      undeposited: d.finRcds.filter((r) => !r.deposit).length,
      unreported: d.finReceipts.filter((r) => r.status === 'issued' && !r.rcdId).length,
      advancesOverdue: ctx.financeCash.advances().filter((a) => a.overdue).length,
      lowStock: d.finItems.filter((i) => i.active !== false && i.reorderPoint > 0 && ctx.financeSupply.onHand(i.id) <= i.reorderPoint).length,
      depreciationDue: ctx.financeSupply.depreciationDue(),
    };
    const revenue = ctx.financeCash.revenueByMonth(year);
    return {
      year, today: t, lockedThrough: S().lockedThrough, cash, budget, queue, revenue,
      permissions: financePermissions(user.role),
      recent: d.finAudit.slice(-10).reverse(),
    };
  });

  registerBudgetRoutes(route, fx);
  registerSupplyRoutes(route, fx);
  registerCashRoutes(route, fx);

  return { permissionsFor: financePermissions, isStaff };
}

export const monthLabel = (ym) => (ym ? new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }) : '');
export const monthEnd = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};
export const prevDay = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const x = new Date(y, m - 1, d - 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
