// ATLAS Finance – Budget: appropriations (GAA, continuing, board-approved IGF/STF budgets),
// allotments (GARO/SARO/ABM, sub-allotments), notices of cash allocation (NCA), and obligations
// on the Obligation Request and Status (ORS, fund 01) or Budget Utilization Request and Status
// (BURS, other funds), per COA-DBM Joint Circular 2013-1. Reports: the Registry of Allotments,
// Obligations and Disbursements (RAOD), the Statement of Appropriations, Allotments, Obligations,
// Disbursements and Balances (SAAODB, FAR No. 1), the aging of due and demandable obligations
// (FAR No. 3) and the Statement of Comparison of Budget and Actual Amounts (SCBAA).
import { randomUUID } from 'node:crypto';
import { text } from './util.js';
import { can } from '../shared/roles.js';
import { ALLOTMENT_CLASSES, ACCT, round2, sum, classOf, obligationForm, fundName, coObject } from '../shared/finance.js';

const APPROPRIATION_KINDS = ['GAA – New appropriations', 'GAA – Continuing appropriations', 'Automatic appropriations (RLIP)', 'Supplemental / special purpose', 'Board-approved budget (IGF/STF)', 'Trust receipts budget'];
const ALLOTMENT_KINDS = ['GARO / ABM (comprehensive release)', 'SARO', 'Sub-allotment received', 'Board approval (IGF/STF)', 'Allotment for trust receipts'];

export function registerBudgetRoutes(route, fx) {
  const { data, save, fail, iso } = fx;
  const D = () => data();

  // ----- Balances -----
  const lineObligated = (l) => round2(l.amount + (l.adjusted || 0));
  const obligated = (o) => (o.status === 'obligated' ? sum(o.lines, lineObligated) : 0);
  // Disbursements charged to each obligation line: paid vouchers' charges.
  function disbursedByLine(o) {
    const out = o.lines.map(() => 0);
    for (const dv of D().finDvs) {
      if (dv.orsId !== o.id || dv.status !== 'paid') continue;
      for (const c of dv.charges || []) if (out[c.line] !== undefined) out[c.line] = round2(out[c.line] + c.amount);
    }
    return out;
  }
  const disbursed = (o) => sum(disbursedByLine(o));
  // Charges on vouchers not yet paid (so two vouchers cannot spend the same balance).
  function pendingByLine(o, exceptDvId) {
    const out = o.lines.map(() => 0);
    for (const dv of D().finDvs) {
      if (dv.orsId !== o.id || dv.id === exceptDvId || ['paid', 'cancelled'].includes(dv.status)) continue;
      for (const c of dv.charges || []) if (out[c.line] !== undefined) out[c.line] = round2(out[c.line] + c.amount);
    }
    return out;
  }
  const allotmentUsed = (a, exceptOrsId) => sum(D().finObligations.filter((o) => o.status === 'obligated' && o.id !== exceptOrsId).flatMap((o) => o.lines.filter((l) => l.allotmentId === a.id)), lineObligated);
  const allotmentView = (a) => {
    const used = allotmentUsed(a);
    return { ...a, classLabel: ALLOTMENT_CLASSES.find((c) => c.id === a.cls)?.label, obligated: used, balance: round2(a.amount - used), papName: fx.S().paps.find((p) => p.code === a.pap)?.name || '' };
  };
  // Allotments under continuing appropriations stay available in later years: what is left at the start of `year`.
  const isContinuing = (a) => Boolean(fx.byId(D().finAppropriations, a.appropriationId)?.kind.includes('Continuing'));
  function carried(year, fund) {
    return D().finAllotments.filter((a) => a.fy < year && (!fund || a.fund === fund) && isContinuing(a)).map((a) => {
      const before = sum(D().finObligations.filter((o) => o.status === 'obligated' && (o.obligatedDate || o.date) < `${year}-01-01`).flatMap((o) => o.lines.map((l, i) => ({ o, l, i }))).filter(({ l }) => l.allotmentId === a.id), ({ o, i }) => obligatedBy(o, i, `${year - 1}-12-31`));
      return { a, amount: round2(a.amount - before) };
    }).filter((x) => x.amount > 0);
  }
  const appropriationAllotted = (ap) => sum(D().finAllotments.filter((a) => a.appropriationId === ap.id), (a) => a.amount);
  const appropriationView = (ap) => ({ ...ap, allotted: appropriationAllotted(ap), unreleased: round2(ap.amount - appropriationAllotted(ap)), papName: fx.S().paps.find((p) => p.code === ap.pap)?.name || '' });

  function obligationView(o, { detail = false } = {}) {
    const paid = disbursedByLine(o);
    const pending = pendingByLine(o);
    const total = sum(o.lines, lineObligated);
    const out = {
      ...o, payeeName: fx.cardName(o.payeeId), payeeAddress: fx.byId(D().finCards, o.payeeId)?.address || '', officeName: fx.office(o.office)?.name || o.office, total, obligatedAmount: obligated(o),
      disbursed: sum(paid), unpaid: o.status === 'obligated' ? round2(obligated(o) - sum(paid)) : 0,
      lines: o.lines.map((l, i) => ({ ...l, title: fx.accountTitle(l.code), uacs: coObject(l.code), obligated: lineObligated(l), disbursed: paid[i], pending: pending[i], available: round2(lineObligated(l) - paid[i] - pending[i]), allotmentRef: fx.byId(D().finAllotments, l.allotmentId)?.ref || '' })),
    };
    if (detail) {
      // Payable: what is due to the payee — accepted deliveries for a purchase order, otherwise what is on vouchers.
      const po = o.source?.kind === 'po' ? fx.byId(D().finPos, o.source.id) : null;
      const accepted = po ? sum(D().finIars.filter((i) => i.poId === po.id), (i) => i.total) : 0;
      out.payable = round2(Math.min(out.status === 'obligated' ? out.obligatedAmount : out.total, Math.max(accepted, out.disbursed + sum(pending))));
      out.dvs = D().finDvs.filter((d) => d.orsId === o.id).map((d) => ({ id: d.id, no: d.no, date: d.date, gross: d.gross, net: d.net, status: d.status, paidDate: d.paidDate }));
      out.po = o.source?.kind === 'po' ? (({ id, no, total: t }) => ({ id, no, total: t }))(fx.byId(D().finPos, o.source.id) || {}) : null;
    }
    return out;
  }
  fx.obligationView = obligationView;
  fx.pendingByLine = pendingByLine;
  fx.disbursedByLine = disbursedByLine;
  fx.lineObligated = lineObligated;

  // ----- Appropriations -----
  route('GET', '/api/finance/appropriations', 'finance:finance.view', ({ query }) => {
    const year = Number(query.fy) || fx.fy();
    return D().finAppropriations.filter((a) => a.fy === year && (!query.fund || a.fund === query.fund)).map(appropriationView);
  });
  function budgetLine(body, kinds) {
    const cls = ALLOTMENT_CLASSES.some((c) => c.id === body.cls) ? body.cls : fail('Pick the allotment class (PS, MOOE, FE or CO).');
    const pap = String(body.pap || '');
    if (!fx.S().paps.some((p) => p.code === pap)) fail('Pick the program/activity/project (add it in the Control panel first).');
    return {
      fy: Number(body.fy) || fx.fy(), fund: fx.fund(String(body.fund || '')), pap, cls,
      kind: kinds.includes(body.kind) ? body.kind : kinds[0], ref: text(body.ref, 60), particulars: text(body.particulars, 300),
      amount: fx.money(body.amount, 'Amount', { allowNegative: Boolean(body.allowNegative) }),
    };
  }
  route('POST', '/api/finance/appropriations', 'finance:finance.budget', ({ user, body }) => {
    const a = { id: randomUUID(), ...budgetLine(body, APPROPRIATION_KINDS), date: fx.date(body.date || fx.today()), createdAt: iso(), createdBy: user.name };
    D().finAppropriations.push(a);
    fx.audit(user, `Recorded appropriation ${a.ref || a.kind}: ${a.cls} ₱${a.amount.toLocaleString()} (fund ${a.fund})`, { kind: 'appropriation', ref: a.id });
    save();
    return appropriationView(a);
  });
  route('PUT', '/api/finance/appropriations/:id', 'finance:finance.budget', ({ user, params, body }) => {
    const a = fx.byId(D().finAppropriations, params.id) || fail('Appropriation not found.', 404);
    const amount = fx.money(body.amount ?? a.amount, 'Amount');
    if (amount < appropriationAllotted(a)) fail(`₱${appropriationAllotted(a).toLocaleString()} of it is already allotted.`);
    Object.assign(a, { amount, ref: text(body.ref ?? a.ref, 60), particulars: text(body.particulars ?? a.particulars, 300) });
    fx.audit(user, `Changed appropriation ${a.ref || a.kind} to ₱${amount.toLocaleString()}`, { kind: 'appropriation', ref: a.id });
    save();
    return appropriationView(a);
  });

  // ----- Allotments -----
  route('GET', '/api/finance/allotments', 'finance:finance.view', ({ query }) => {
    const year = query.fy === 'all' ? null : Number(query.fy) || fx.fy();
    // A year's allotments, and earlier continuing allotments that still have a balance.
    return D().finAllotments.filter((a) => (year == null || a.fy === year || (a.fy < year && isContinuing(a))) && (!query.fund || a.fund === query.fund) && (!query.cls || a.cls === query.cls))
      .map((a) => ({ ...allotmentView(a), continuing: isContinuing(a) }))
      .filter((a) => year == null || a.fy === year || a.balance > 0);
  });
  route('POST', '/api/finance/allotments', 'finance:finance.budget', ({ user, body }) => {
    const a = { id: randomUUID(), ...budgetLine(body, ALLOTMENT_KINDS), date: fx.date(body.date || fx.today()), createdAt: iso(), createdBy: user.name, appropriationId: body.appropriationId || null };
    if (a.appropriationId) {
      const ap = fx.byId(D().finAppropriations, a.appropriationId) || fail('Appropriation not found.');
      if (ap.fund !== a.fund || ap.cls !== a.cls || ap.pap !== a.pap || ap.fy !== a.fy) fail('The allotment must match its appropriation (fund, year, PAP and class).');
      const left = round2(ap.amount - appropriationAllotted(ap));
      if (a.amount > left) fail(`Only ₱${left.toLocaleString()} of that appropriation is unreleased.`);
    }
    D().finAllotments.push(a);
    fx.audit(user, `Recorded allotment ${a.ref || a.kind}: ${a.cls} ₱${a.amount.toLocaleString()} (fund ${a.fund})`, { kind: 'allotment', ref: a.id });
    save();
    return allotmentView(a);
  });
  route('DELETE', '/api/finance/allotments/:id', 'finance:finance.budget', ({ user, params }) => {
    const a = fx.byId(D().finAllotments, params.id) || fail('Allotment not found.', 404);
    if (D().finObligations.some((o) => o.status !== 'cancelled' && o.lines.some((l) => l.allotmentId === a.id))) fail('Obligations are charged to this allotment.');
    D().finAllotments = D().finAllotments.filter((x) => x !== a);
    fx.audit(user, `Removed allotment ${a.ref || a.kind}`, { kind: 'allotment' });
    save();
    return { ok: true };
  });

  // ----- Notices of Cash Allocation (fund 01): cash in the MDS account -----
  route('GET', '/api/finance/ncas', 'finance:finance.view', () => {
    const year = fx.fy();
    return {
      list: D().finNcas.filter((n) => n.date.startsWith(String(year))).map((n) => ({ ...n, jevNo: fx.byId(D().finJournals, n.journalId)?.jevNo || '' })).reverse(),
      received: sum(D().finNcas.filter((n) => n.date.startsWith(String(year))), (n) => n.amount),
      balance: fx.balance(ACCT.cashMds, { fund: '01' }),
    };
  });
  route('POST', '/api/finance/ncas', 'finance:finance.budget', ({ user, body }) => {
    const date = fx.date(body.date);
    const amount = fx.money(body.amount, 'NCA amount');
    const no = text(body.no, 40) || fail('NCA number is required.');
    if (D().finNcas.some((n) => n.no === no)) fail(`NCA ${no} is already recorded.`);
    const j = fx.postJournal({ date, fund: '01', journal: 'GJ', user, particulars: `Receipt of NCA ${no}${body.particulars ? ` – ${text(body.particulars, 200)}` : ''}`, lines: [{ code: ACCT.cashMds, debit: amount }, { code: ACCT.subsidyNg, credit: amount }], source: { kind: 'nca' } });
    const n = { id: randomUUID(), no, date, amount, validUntil: /^\d{4}-\d{2}-\d{2}$/.test(body.validUntil || '') ? body.validUntil : `${date.slice(0, 4)}-12-31`, particulars: text(body.particulars, 200), journalId: j.id, createdBy: user.name };
    j.source.id = n.id;
    D().finNcas.push(n);
    save();
    return n;
  });

  // ----- Obligations (ORS / BURS) -----
  const preparer = (u) => ['finance.budget', 'finance.procure', 'finance.disburse', 'finance.accounts', 'finance.inventory'].some((p) => can(u.role, p));
  route('GET', '/api/finance/obligations', 'finance:finance.view', ({ query }) => {
    const q = String(query.q || '').toLowerCase();
    return D().finObligations
      .filter((o) => (!query.fund || o.fund === query.fund) && (!query.status || (query.status === 'pending' ? o.status === 'draft' && o.submitted : query.status === 'unpaid' ? o.status === 'obligated' && obligationView(o).unpaid > 0 : o.status === query.status))
        && (!query.payeeId || o.payeeId === query.payeeId) && (!q || `${o.no} ${o.particulars} ${fx.cardName(o.payeeId)}`.toLowerCase().includes(q)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((o) => obligationView(o));
  });
  route('GET', '/api/finance/obligations/:id', 'finance:finance.view', ({ params }) => obligationView(fx.byId(D().finObligations, params.id) || fail('Obligation request not found.', 404), { detail: true }));
  function obligationFields(body, existing) {
    const fund = fx.fund(String(body.fund ?? existing?.fund ?? ''));
    const payeeId = (body.payeeId ?? existing?.payeeId) || fail('Pick the payee (from the Card file).');
    fx.card(payeeId);
    const lines = (Array.isArray(body.lines) ? body.lines : existing?.lines || []).map((l) => {
      const a = fx.byId(D().finAllotments, l.allotmentId) || fail('Each line is charged to an allotment.');
      if (a.fund !== fund) fail(`Allotment ${a.ref || a.kind} is for fund ${a.fund}, not ${fund}.`);
      const acct = fx.account(String(l.code || ''));
      if (classOf(acct.code) !== a.cls) fail(`${acct.code} ${acct.title} is not a ${a.cls} object code (the allotment's class).`);
      return { allotmentId: a.id, pap: a.pap, cls: a.cls, code: acct.code, amount: fx.money(l.amount, `Amount for ${acct.title}`), adjusted: 0 };
    });
    if (!lines.length) fail('Add at least one object code and amount.');
    return {
      fund, form: obligationForm(fund), payeeId, date: fx.date(body.date ?? existing?.date ?? fx.today()),
      office: String(body.office ?? existing?.office ?? ''), particulars: text(body.particulars ?? existing?.particulars, 1000) || fail('Particulars are required.'),
      requestedBy: { name: text(body.requestedBy?.name ?? existing?.requestedBy?.name, 120), title: text(body.requestedBy?.title ?? existing?.requestedBy?.title, 120) },
      lines,
    };
  }
  fx.createObligation = (user, body, source = null) => {
    const o = { id: randomUUID(), no: '', ...obligationFields(body), status: 'draft', submitted: Boolean(body.submit), source, createdAt: iso(), createdBy: user.name, createdById: user.id, adjustments: [] };
    o.amount = sum(o.lines, (l) => l.amount);
    D().finObligations.push(o);
    fx.audit(user, `Prepared ${o.form} for ${fx.cardName(o.payeeId)}: ₱${o.amount.toLocaleString()}`, { kind: 'obligation', ref: o.id });
    return o;
  };
  route('POST', '/api/finance/obligations', 'finance', ({ user, body }) => {
    if (!preparer(user)) fail('Your account cannot prepare obligation requests.', 403);
    const o = fx.createObligation(user, body);
    save();
    return obligationView(o);
  });
  route('PUT', '/api/finance/obligations/:id', 'finance', ({ user, params, body }) => {
    if (!preparer(user)) fail('Your account cannot prepare obligation requests.', 403);
    const o = fx.byId(D().finObligations, params.id) || fail('Obligation request not found.', 404);
    if (o.status !== 'draft') fail('Only a draft can be changed.');
    if (o.source?.kind === 'po') fail('This request was made from a purchase order and matches it; change the PO instead (cancel and redo it).');
    Object.assign(o, obligationFields(body, o));
    o.amount = sum(o.lines, (l) => l.amount);
    if (body.submit !== undefined) o.submitted = Boolean(body.submit);
    save();
    return obligationView(o);
  });
  // Box B: the budget officer certifies that the allotment is available and obligated.
  route('POST', '/api/finance/obligations/:id/obligate', 'finance:finance.budget', ({ user, params, body }) => {
    const o = fx.byId(D().finObligations, params.id) || fail('Obligation request not found.', 404);
    if (o.status !== 'draft') fail('This request is not waiting to be obligated.');
    const date = fx.date(body.date || fx.today());
    const need = {};
    for (const l of o.lines) need[l.allotmentId] = round2((need[l.allotmentId] || 0) + l.amount);
    for (const [id, amt] of Object.entries(need)) {
      const a = fx.byId(D().finAllotments, id) || fail('An allotment on this request was removed.');
      if (date < a.date) fail(`Allotment ${a.ref || a.kind} is dated ${a.date}; obligate on or after it.`);
      if (String(a.fy) !== date.slice(0, 4) && !fx.byId(D().finAppropriations, a.appropriationId)?.kind.includes('Continuing')) fail(`Allotment ${a.ref || a.kind} is for ${a.fy}.`);
      const left = round2(a.amount - allotmentUsed(a, o.id));
      if (amt > left) fail(`Not enough allotment: ${a.ref || a.kind} (${a.cls}, ${a.pap}) has ₱${left.toLocaleString(undefined, { minimumFractionDigits: 2 })} left; this request needs ₱${amt.toLocaleString(undefined, { minimumFractionDigits: 2 })}.`);
    }
    o.status = 'obligated';
    o.submitted = true;
    o.obligatedAt = iso();
    o.obligatedDate = date;
    o.no = fx.nextNo('ors', { fund: o.fund, date });
    o.certifiedBy = { name: user.name, title: fx.signatory('budget').title };
    fx.audit(user, `Obligated ${o.form} ${o.no}: ₱${o.amount.toLocaleString()} for ${fx.cardName(o.payeeId)}`, { kind: 'obligation', ref: o.id });
    save();
    return obligationView(o, { detail: true });
  });
  // Adjust an obligation (e.g. the actual payment was less): a negative amount de-obligates.
  route('POST', '/api/finance/obligations/:id/adjust', 'finance:finance.budget', ({ user, params, body }) => {
    const o = fx.byId(D().finObligations, params.id) || fail('Obligation request not found.', 404);
    if (o.status !== 'obligated') fail('Only an obligated request can be adjusted.');
    const i = Number(body.line);
    const l = o.lines[i] || fail('Pick the line to adjust.');
    const amount = fx.money(body.amount, 'Adjustment', { allowNegative: true });
    const paid = disbursedByLine(o)[i] + pendingByLine(o)[i];
    if (lineObligated(l) + amount < paid) fail(`₱${paid.toLocaleString()} of this line is already paid or on a voucher.`);
    if (amount > 0) {
      const a = fx.byId(D().finAllotments, l.allotmentId);
      const left = round2(a.amount - allotmentUsed(a));
      if (amount > left) fail(`The allotment has only ₱${left.toLocaleString()} left.`);
    }
    l.adjusted = round2((l.adjusted || 0) + amount);
    const date = fx.date(body.date || fx.today());
    if (date < (o.obligatedDate || o.date)) fail('An adjustment is dated on or after the obligation.');
    if (date > fx.today()) fail('An adjustment cannot be dated in the future.');
    fx.assertOpen(date);
    o.adjustments.push({ date, line: i, amount, reason: text(body.reason, 300) || fail('Give the reason.'), by: user.name });
    fx.audit(user, `Adjusted ${o.form} ${o.no} by ₱${amount.toLocaleString()}: ${text(body.reason, 200)}`, { kind: 'obligation', ref: o.id });
    save();
    return obligationView(o, { detail: true });
  });
  route('POST', '/api/finance/obligations/:id/cancel', 'finance', ({ user, params, body }) => {
    const o = fx.byId(D().finObligations, params.id) || fail('Obligation request not found.', 404);
    if (o.status === 'cancelled') fail('Already cancelled.');
    if (o.status === 'obligated' && !can(user.role, 'finance.budget')) fail('Only the budget office cancels an obligation.', 403);
    if (o.status === 'draft' && !preparer(user)) fail('Your account cannot change obligation requests.', 403);
    if (D().finDvs.some((d) => d.orsId === o.id && d.status !== 'cancelled')) fail('A voucher is charged to this obligation. Cancel the voucher first, or adjust the obligation.');
    const po = D().finPos.find((x) => x.orsId === o.id && !['draft', 'cancelled'].includes(x.status));
    if (po) fail(`Purchase order ${po.no} is ${po.status === 'approved' ? 'approved' : 'being delivered'} on this obligation; cancel the PO first.`);
    o.status = 'cancelled';
    o.cancelReason = text(body.reason, 300);
    fx.audit(user, `Cancelled ${o.form} ${o.no || '(draft)'}`, { kind: 'obligation', ref: o.id });
    save();
    return obligationView(o);
  });

  // ----- Reports -----
  // What happened to an obligation line up to a date (or within a year): obligated (with adjustments) and paid.
  const paymentsOf = (o, i) => D().finDvs.filter((d) => d.orsId === o.id && d.status === 'paid').flatMap((d) => d.charges.filter((c) => c.line === i).map((c) => ({ date: d.paidDate, amount: c.amount, dv: d })));
  const obligatedBy = (o, i, date) => round2(o.lines[i].amount + sum(o.adjustments.filter((a) => a.line === i && a.date <= date), (a) => a.amount));
  const paidBetween = (o, i, from, to) => sum(paymentsOf(o, i).filter((p) => p.date >= from && p.date <= to), (p) => p.amount);
  const yearObligations = (year, fund) => D().finObligations.filter((o) => o.status === 'obligated' && (o.obligatedDate || o.date).startsWith(String(year)) && (!fund || o.fund === fund));
  // Budget utilization by allotment class (dashboard).
  function utilization(year, fund) {
    return ALLOTMENT_CLASSES.map((c) => {
      const allot = round2(sum(D().finAllotments.filter((a) => a.fy === year && a.cls === c.id && (!fund || a.fund === fund)), (a) => a.amount) + sum(carried(year, fund).filter((x) => x.a.cls === c.id), (x) => x.amount));
      const end = `${year}-12-31`;
      const lines = yearObligations(year, fund).flatMap((o) => o.lines.map((l, i) => ({ o, l, i }))).filter(({ l }) => l.cls === c.id);
      const ob = sum(lines, ({ o, i }) => obligatedBy(o, i, end));
      const disb = sum(lines, ({ o, i }) => paidBetween(o, i, `${year}-01-01`, end));
      return { cls: c.id, label: c.label, allotment: allot, obligations: ob, disbursements: disb, unobligated: round2(allot - ob), unpaid: round2(ob - disb) };
    }).filter((r) => r.allotment || r.obligations);
  }
  fx.ctx.financeBudget = { utilization };

  // SAAODB (FAR No. 1): by PAP and class.
  route('GET', '/api/finance/budget/saaodb', 'finance:finance.view', ({ query }) => {
    const year = Number(query.fy) || fx.fy();
    const fund = query.fund || undefined;
    const rows = {};
    const row = (pap, cls) => (rows[`${pap}|${cls}`] ||= { pap, papName: fx.S().paps.find((p) => p.code === pap)?.name || pap, cls, appropriation: 0, allotment: 0, obligations: [0, 0, 0, 0], disbursements: [0, 0, 0, 0] });
    for (const a of D().finAppropriations.filter((x) => x.fy === year && (!fund || x.fund === fund))) row(a.pap, a.cls).appropriation = round2(row(a.pap, a.cls).appropriation + a.amount);
    for (const a of D().finAllotments.filter((x) => x.fy === year && (!fund || x.fund === fund))) row(a.pap, a.cls).allotment = round2(row(a.pap, a.cls).allotment + a.amount);
    // Continuing appropriations carried in from earlier years (appropriation and allotment alike).
    for (const { a, amount } of carried(year, fund)) {
      const r = row(a.pap, a.cls);
      r.appropriation = round2(r.appropriation + amount);
      r.allotment = round2(r.allotment + amount);
      r.continuing = round2((r.continuing || 0) + amount);
    }
    const q = (date) => Math.min(3, Math.floor((Number(date.slice(5, 7)) - 1) / 3));
    const inYear = (d) => d.startsWith(String(year));
    // This year's obligations (adjustments in the quarter they were made), and payments made this year.
    for (const o of yearObligations(year, fund)) {
      o.lines.forEach((l, i) => {
        const r = row(l.pap, l.cls);
        r.obligations[q(o.obligatedDate || o.date)] = round2(r.obligations[q(o.obligatedDate || o.date)] + l.amount);
        for (const a of o.adjustments.filter((x) => x.line === i && inYear(x.date))) r.obligations[q(a.date)] = round2(r.obligations[q(a.date)] + a.amount);
        for (const p of paymentsOf(o, i).filter((x) => inYear(x.date))) r.disbursements[q(p.date)] = round2(r.disbursements[q(p.date)] + p.amount);
      });
    }
    // Earlier years' obligations paid this year (reported apart from this year's).
    const prior = {};
    for (const o of D().finObligations.filter((x) => x.status === 'obligated' && (!fund || x.fund === fund) && (x.obligatedDate || x.date) < `${year}-01-01`)) {
      o.lines.forEach((l, i) => {
        const r = () => (prior[`${l.pap}|${l.cls}`] ||= { pap: l.pap, papName: fx.S().paps.find((x) => x.code === l.pap)?.name || l.pap, cls: l.cls, adjustments: 0, disbursements: [0, 0, 0, 0] });
        for (const p of paymentsOf(o, i).filter((x) => inYear(x.date))) r().disbursements[q(p.date)] = round2(r().disbursements[q(p.date)] + p.amount);
        for (const a of o.adjustments.filter((x) => x.line === i && inYear(x.date))) r().adjustments = round2(r().adjustments + a.amount);
      });
    }
    const list = Object.values(rows).map((r) => {
      const ob = sum(r.obligations);
      const di = sum(r.disbursements);
      return { ...r, totalObligations: ob, totalDisbursements: di, unreleased: round2(r.appropriation - r.allotment), unobligated: round2(r.allotment - ob), unpaid: round2(ob - di) };
    }).sort((a, b) => a.pap.localeCompare(b.pap) || ALLOTMENT_CLASSES.findIndex((c) => c.id === a.cls) - ALLOTMENT_CLASSES.findIndex((c) => c.id === b.cls));
    const keys = ['appropriation', 'allotment', 'totalObligations', 'totalDisbursements', 'unreleased', 'unobligated', 'unpaid'];
    const priorRows = Object.values(prior).map((r) => ({ ...r, total: sum(r.disbursements) }));
    return { fy: year, fund: fund || '', fundName: fund ? fundName(fund) : 'All fund clusters', rows: list, prior: priorRows, totals: { ...Object.fromEntries(keys.map((k) => [k, sum(list, (r) => r[k])])), priorDisbursements: sum(priorRows, (r) => r.total) } };
  });

  // RAOD: one registry per fund and allotment class, in date order, by object code.
  route('GET', '/api/finance/budget/raod', 'finance:finance.view', ({ query }) => {
    const year = Number(query.fy) || fx.fy();
    const fund = fx.fund(String(query.fund || fx.S().funds[0]));
    const cls = ALLOTMENT_CLASSES.some((c) => c.id === query.cls) ? query.cls : 'MOOE';
    const events = [];
    for (const a of D().finAllotments.filter((x) => x.fy === year && x.fund === fund && x.cls === cls)) events.push({ date: a.date, ref: a.ref || a.kind, particulars: `${a.kind}${a.particulars ? ` – ${a.particulars}` : ''}`, pap: a.pap, allotment: a.amount, obligation: 0, disbursement: 0, code: '' });
    for (const o of yearObligations(year, fund)) {
      o.lines.forEach((l, i) => {
        if (l.cls !== cls) return;
        events.push({ date: o.obligatedDate || o.date, ref: o.no, particulars: `${fx.cardName(o.payeeId)} – ${o.particulars}`, pap: l.pap, code: l.code, allotment: 0, obligation: l.amount, disbursement: 0, kind: 'ors', id: o.id });
        for (const adj of o.adjustments.filter((x) => x.line === i && x.date.startsWith(String(year)))) events.push({ date: adj.date, ref: o.no, particulars: `Adjustment: ${adj.reason}`, pap: l.pap, code: l.code, allotment: 0, obligation: adj.amount, disbursement: 0, kind: 'ors', id: o.id });
        for (const p of paymentsOf(o, i).filter((x) => x.date.startsWith(String(year)))) events.push({ date: p.date, ref: p.dv.no, particulars: `Paid to ${fx.cardName(p.dv.payeeId)}`, pap: l.pap, code: l.code, allotment: 0, obligation: 0, disbursement: p.amount, kind: 'dv', id: p.dv.id });
      });
    }
    for (const { a, amount } of carried(year, fund).filter((x) => x.a.cls === cls)) events.push({ date: `${year}-01-01`, ref: a.ref || a.kind, particulars: `Continuing allotment carried from ${a.fy}`, pap: a.pap, allotment: amount, obligation: 0, disbursement: 0, code: '' });
    events.sort((a, b) => a.date.localeCompare(b.date) || (b.allotment - a.allotment) || (b.obligation - a.obligation));
    let unobligated = 0;
    let unpaid = 0;
    const rows = events.map((e) => {
      unobligated = round2(unobligated + e.allotment - e.obligation);
      unpaid = round2(unpaid + e.obligation - e.disbursement);
      return { ...e, title: e.code ? fx.accountTitle(e.code) : '', unobligated, unpaid };
    });
    const codes = [...new Set(rows.filter((r) => r.code).map((r) => r.code))].sort().map((code) => ({ code, title: fx.accountTitle(code), obligations: sum(rows.filter((r) => r.code === code), (r) => r.obligation), disbursements: sum(rows.filter((r) => r.code === code), (r) => r.disbursement) }));
    // Earlier years' obligations: their payments and adjustments made this year.
    const prior = [];
    for (const o of D().finObligations.filter((x) => x.status === 'obligated' && x.fund === fund && (x.obligatedDate || x.date) < `${year}-01-01`)) {
      o.lines.forEach((l, i) => {
        if (l.cls !== cls) return;
        for (const p of paymentsOf(o, i).filter((x) => x.date.startsWith(String(year)))) prior.push({ date: p.date, ref: p.dv.no, obligationNo: o.no, id: p.dv.id, kind: 'dv', particulars: `Paid to ${fx.cardName(p.dv.payeeId)}`, code: l.code, title: fx.accountTitle(l.code), adjustment: 0, disbursement: p.amount });
        for (const a of o.adjustments.filter((x) => x.line === i && x.date.startsWith(String(year)))) prior.push({ date: a.date, ref: o.no, obligationNo: o.no, id: o.id, kind: 'ors', particulars: `Adjustment: ${a.reason}`, code: l.code, title: fx.accountTitle(l.code), adjustment: a.amount, disbursement: 0 });
      });
    }
    prior.sort((a, b) => a.date.localeCompare(b.date));
    return { fy: year, fund, fundName: fundName(fund), cls, classLabel: ALLOTMENT_CLASSES.find((c) => c.id === cls).label, rows, codes, prior, totals: { allotment: sum(rows, (r) => r.allotment), obligations: sum(rows, (r) => r.obligation), disbursements: sum(rows, (r) => r.disbursement), unobligated, unpaid } };
  });

  // FAR No. 3: aging of due and demandable obligations (obligated, not yet paid).
  route('GET', '/api/finance/budget/aging', 'finance:finance.view', ({ query }) => {
    const asOf = query.asOf ? fx.date(query.asOf, 'As of') : fx.today();
    const fund = query.fund || undefined;
    const days = (d) => Math.floor((Date.parse(`${asOf}T00:00:00`) - Date.parse(`${d}T00:00:00`)) / 86400000);
    // As of the date: obligated (with adjustments made by then) less payments made by then.
    const rows = D().finObligations.filter((o) => o.status === 'obligated' && (!fund || o.fund === fund) && (o.obligatedDate || o.date) <= asOf).map((o) => {
      const unpaid = round2(sum(o.lines.map((_, i) => obligatedBy(o, i, asOf) - paidBetween(o, i, '0000-01-01', asOf))));
      return { id: o.id, no: o.no, form: o.form, fund: o.fund, date: o.obligatedDate || o.date, payee: fx.cardName(o.payeeId), particulars: o.particulars, unpaid, age: days(o.obligatedDate || o.date) };
    }).filter((r) => r.unpaid > 0).sort((a, b) => b.age - a.age);
    const buckets = [['0–30 days', 0, 30], ['31–90 days', 31, 90], ['91–365 days', 91, 365], ['Over 1 year', 366, Infinity]].map(([label, lo, hi]) => ({ label, amount: sum(rows.filter((r) => r.age >= lo && r.age <= hi), (r) => r.unpaid), count: rows.filter((r) => r.age >= lo && r.age <= hi).length }));
    return { asOf, fund: fund || '', rows, buckets, total: sum(rows, (r) => r.unpaid) };
  });

  // SCBAA: budget (original and final) against actual obligations, by class.
  route('GET', '/api/finance/budget/scbaa', 'finance:finance.view', ({ query }) => {
    const year = Number(query.fy) || fx.fy();
    const fund = query.fund || undefined;
    const rows = ALLOTMENT_CLASSES.map((c) => {
      const aps = D().finAppropriations.filter((a) => a.fy === year && a.cls === c.id && (!fund || a.fund === fund));
      const original = sum(aps.filter((a) => /New appropriations|Board-approved|Trust receipts budget|Automatic/.test(a.kind)), (a) => a.amount);
      const final = sum(aps, (a) => a.amount);
      const actual = sum(yearObligations(year, fund).flatMap((o) => o.lines.map((l, i) => ({ o, l, i }))).filter(({ l }) => l.cls === c.id), ({ o, i }) => obligatedBy(o, i, `${year}-12-31`));
      return { cls: c.id, label: c.label, original, adjustments: round2(final - original), final, actual, difference: round2(final - actual) };
    });
    const keys = ['original', 'adjustments', 'final', 'actual', 'difference'];
    return { fy: year, fund: fund || '', fundName: fund ? fundName(fund) : 'All fund clusters', rows, totals: Object.fromEntries(keys.map((k) => [k, sum(rows, (r) => r[k])])) };
  });

  route('GET', '/api/finance/budget/options', 'finance', () => ({ appropriationKinds: APPROPRIATION_KINDS, allotmentKinds: ALLOTMENT_KINDS }));
}
