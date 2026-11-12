// ATLAS Finance – Disbursement and Revenue.
// Disbursement Voucher (DV, GAM Appendix 32): prepared against an obligation (ORS/BURS), with the
// withholding taxes computed from the payee's card; Box A (requesting office), Box C certified by
// the Chief Accountant (obligation and cash available, documents complete), Box D approved by the
// head of agency (never the preparer or the certifier), paid by MDS check, LDDAP-ADA or the fund's
// bank account, which posts the entry (Dr expense / Accounts Payable / advance, Cr Due to BIR,
// Cr cash), and Box E (receipt of payment). Cash advances (COA Circular 97-002): no new advance
// while one is unsettled; special disbursing and payroll advances need a fidelity bond; liquidation
// reports clear them. Taxes: the monthly summary by ATC, BIR Form 2307 per payee and quarter, the
// Quarterly Alphalist of Payees, and remittances (Tax Remittance Advice for fund 01).
// Revenue: Official Receipts (Accountable Form 51) from booklets assigned to collecting officers,
// the Report of Collections and Deposits (RCD) with its entries, deposits, the Report of
// Accountability for Accountable Forms (RAAF) and revenue monitoring against targets.
import { randomUUID } from 'node:crypto';
import { text } from './util.js';
import { userCan } from '../shared/roles.js';
import { ACCT, ADVANCE_TYPES, PAYMENT_MODES, NATURES, round2, sum, withholding, classOf, fundName, tracksCard } from '../shared/finance.js';

export function registerCashRoutes(route, fx) {
  const { data, save, fail, iso } = fx;
  const D = () => data();
  const S = () => fx.S();

  // ----- Disbursement vouchers -----
  const advanceAccount = (type) => ADVANCE_TYPES.find(([k]) => k === type)?.[2] || ACCT.advancesOfficers;
  const dvView = (d) => {
    const payee = fx.byId(D().finCards, d.payeeId) || {};
    const ors = fx.byId(D().finObligations, d.orsId);
    // Once certified, a voucher pays the bank account it was certified with (d.payTo), whatever
    // the payee's card says afterwards: the account that was checked and approved is the one paid.
    const bank = d.payTo || { bankName: payee.bankName || '', bankAccount: payee.bankAccount || '' };
    const cardChanged = Boolean(d.payTo && d.status !== 'paid' && d.status !== 'cancelled' && ((payee.bankAccount || '') !== d.payTo.bankAccount || (payee.bankName || '') !== d.payTo.bankName));
    return {
      ...d, payee: { id: payee.id, name: payee.name, tin: payee.tin, address: payee.address, kind: payee.kind, bankName: bank.bankName, bankAccount: bank.bankAccount, vat: payee.vat, taxType: payee.taxType },
      payToChanged: cardChanged ? { bankName: payee.bankName || '', bankAccount: payee.bankAccount || '' } : null,
      ors: ors ? { id: ors.id, no: ors.no, form: ors.form, status: ors.status } : null,
      pap: ors ? [...new Set((d.charges || []).map((c) => ors.lines[c.line]?.pap).filter(Boolean))].join(', ') : '',
      objectCodes: ors ? [...new Set((d.charges || []).map((c) => ors.lines[c.line]?.code).filter(Boolean))].join(', ') : d.debits.map((x) => x.code).join(', '),
      iar: d.iarId ? (({ id, no, date }) => ({ id, no, date }))(fx.byId(D().finIars, d.iarId) || {}) : null,
      officeName: fx.office(d.office)?.name || d.office,
      entry: entryLines(d).map((l) => ({ ...l, title: fx.accountTitle(l.code), uacs: `${l.code}00` })),
      jevNo: fx.byId(D().finJournals, d.journalId)?.jevNo || '', lddapNo: fx.byId(D().finLddaps, d.lddapId)?.no || '',
      modeLabel: PAYMENT_MODES.find(([k]) => k === d.mode)?.[1] || d.mode, natureLabel: NATURES.find(([k]) => k === d.nature)?.[1] || d.nature,
    };
  };
  // Box B: the accounting entry the payment posts.
  function entryLines(d) {
    const cash = fx.cashAccount(d.fund, d.mode, d.bankId);
    return [
      ...d.debits.map((x) => ({ code: x.code, debit: x.amount, credit: 0, cardId: x.cardId || null, office: d.office })),
      ...(d.taxTotal ? [{ code: ACCT.dueBir, debit: 0, credit: d.taxTotal, cardId: null }] : []),
      ...d.deductions.map((x) => ({ code: x.code, debit: 0, credit: x.amount, cardId: tracksCard(x.code) ? d.payeeId : null })),
      { code: cash, debit: 0, credit: d.net, cardId: d.mode === 'cash' ? d.officerId || null : null },
    ].filter((l) => l.debit || l.credit);
  }
  // Outstanding cash advances: advance vouchers paid, less liquidations and refunds.
  function advances() {
    const t = fx.today();
    return D().finDvs.filter((d) => d.kind === 'advance' && d.status === 'paid').map((d) => {
      const liquidated = sum(D().finLiquidations.filter((l) => l.dvId === d.id), (l) => l.expenses);
      const refunded = sum(D().finLiquidations.filter((l) => l.dvId === d.id), (l) => l.refund);
      const outstanding = round2(d.gross - liquidated - refunded);
      const due = d.liquidateBy || addDays(d.paidDate, S().liquidationDays[d.advanceType] || 30);
      return { id: d.id, no: d.no, payeeId: d.payeeId, payee: fx.cardName(d.payeeId), advanceType: d.advanceType, typeLabel: ADVANCE_TYPES.find(([k]) => k === d.advanceType)?.[1], particulars: d.particulars, paidDate: d.paidDate, amount: d.gross, liquidated, refunded, outstanding, due, overdue: outstanding > 0 && t > due, daysOut: Math.floor((Date.parse(`${t}T00:00:00`) - Date.parse(`${d.paidDate}T00:00:00`)) / 86400000) };
    });
  }
  // Open advances for a payee: paid and not yet settled, or on their way (prepared, certified, approved).
  const unsettled = (cardId) => [
    ...advances().filter((a) => a.payeeId === cardId && a.outstanding > 0),
    ...D().finDvs.filter((d) => d.kind === 'advance' && d.payeeId === cardId && ['draft', 'certified', 'approved'].includes(d.status)).map((d) => ({ id: d.id, no: d.no || '(not yet paid)', outstanding: d.gross })),
  ];

  function dvFields(body, existing, user) {
    const fund = fx.fund(String(body.fund ?? existing?.fund ?? ''));
    const payee = fx.card(body.payeeId ?? existing?.payeeId);
    if (payee.status === 'blacklisted') fail(`${payee.name} is blacklisted.`);
    const kind = (body.kind ?? existing?.kind) === 'advance' ? 'advance' : 'payment';
    const mode = PAYMENT_MODES.some(([k]) => k === body.mode) ? body.mode : existing?.mode || (fund === '01' ? 'check' : 'bank');
    const gross = fx.money(body.gross ?? existing?.gross, 'Amount (gross)');
    const nature = kind === 'advance' ? 'none' : NATURES.some(([k]) => k === body.nature) ? body.nature : existing?.nature || payee.nature || 'none';
    const orsId = body.orsId !== undefined ? body.orsId || null : existing?.orsId || null;
    const iarId = body.iarId !== undefined ? body.iarId || null : existing?.iarId || null;
    const advanceType = kind === 'advance' ? (ADVANCE_TYPES.some(([k]) => k === body.advanceType) ? body.advanceType : existing?.advanceType || 'opex') : null;
    let charges = [];
    let debits;
    if (orsId) {
      const ors = fx.byId(D().finObligations, orsId) || fail('Obligation request not found.');
      if (ors.status !== 'obligated') fail(`${ors.form} ${ors.no || '(draft)'} is not obligated yet.`);
      if (ors.fund !== fund) fail(`The ${ors.form} is for fund ${ors.fund}.`);
      if (ors.payeeId !== payee.id) fail(`The ${ors.form} is for ${fx.cardName(ors.payeeId)}; the voucher pays the obligation's payee.`);
      // A purchase order's obligation is paid for what was delivered and accepted, delivery by delivery.
      const poId = ors.source?.kind === 'po' ? ors.source.id : null;
      if (poId && kind === 'payment') {
        if (!iarId) fail('Pay a purchase order against an accepted delivery (IAR).');
        const iar = fx.byId(D().finIars, iarId);
        if (!iar || iar.poId !== poId) fail('That delivery (IAR) is not on this obligation\'s purchase order.');
        const before = sum(D().finDvs.filter((x) => x.iarId === iar.id && x.id !== existing?.id && x.status !== 'cancelled'), (x) => x.gross);
        if (gross > round2(iar.total - before) + 0.001) fail(`IAR ${iar.no} accepted ₱${iar.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}; ₱${round2(iar.total - before).toLocaleString(undefined, { minimumFractionDigits: 2 })} of it is left to pay.`);
      } else if (iarId) fail('A delivery (IAR) is only given for a purchase order\'s obligation.');
      const view = fx.obligationView(ors);
      const pending = fx.pendingByLine(ors, existing?.id);
      const paid = fx.disbursedByLine(ors);
      const avail = ors.lines.map((l, i) => round2(fx.lineObligated(l) - paid[i] - pending[i]));
      const given = Array.isArray(body.charges) && body.charges.length ? body.charges : body.charges === undefined && existing?.orsId === orsId && existing?.charges?.length ? existing.charges : null;
      if (given) {
        const perLine = {};
        for (const c of given) {
          const line = Number(c.line);
          if (avail[line] === undefined) fail('Unknown obligation line.');
          perLine[line] = round2((perLine[line] || 0) + round2(c.amount));
        }
        charges = Object.entries(perLine).map(([line, amount]) => ({ line: Number(line), amount })).filter((c) => c.amount > 0);
        for (const c of charges) {
          if (c.amount > avail[c.line] + 0.001) fail(`${view.lines[c.line].title}: only ₱${avail[c.line].toLocaleString(undefined, { minimumFractionDigits: 2 })} of the obligation is left.`);
        }
      } else {
        // Charge the obligation's lines in order until the gross is covered.
        let left = gross;
        avail.forEach((a, i) => {
          const take = round2(Math.min(a, left));
          if (take > 0) charges.push({ line: i, amount: take });
          left = round2(left - take);
        });
        if (left > 0) fail(`The ${ors.form} has only ₱${sum(avail).toLocaleString(undefined, { minimumFractionDigits: 2 })} left to disburse.`);
      }
      if (sum(charges, (c) => c.amount) !== gross) fail('The charges to the obligation must add up to the gross amount.');
      if (kind === 'advance') debits = [{ code: advanceAccount(advanceType), amount: gross, cardId: payee.id }];
      else if (poId) {
        // Deliveries were booked as Accounts Payable when accepted.
        debits = [{ code: ACCT.payable, amount: gross, cardId: payee.id }];
      } else {
        const by = {};
        for (const c of charges) by[ors.lines[c.line].code] = round2((by[ors.lines[c.line].code] || 0) + c.amount);
        debits = Object.entries(by).map(([code, amount]) => ({ code, amount }));
      }
    } else {
      // No obligation: only non-budgetary payments (remitting withholdings and trust liabilities, refunds of deposits, paying prior-year payables).
      debits = (Array.isArray(body.debits) ? body.debits : existing?.debits || []).map((x) => ({ code: fx.account(String(x.code)).code, amount: fx.money(x.amount, 'Debit'), cardId: x.cardId || null }));
      if (!debits.length) fail('Pick the obligation request (ORS/BURS) to charge, or the account to debit for a payment that needs none.');
      for (const x of debits) {
        if (classOf(x.code) || x.code[0] === '5') fail(`${fx.accountTitle(x.code)} is an expense or capital outlay: it needs an obligation request first.`);
        if (x.code[0] !== '2') fail(`${fx.accountTitle(x.code)}: a payment without an obligation request only settles a liability (payables, amounts due to BIR, GSIS and others, trust liabilities).`);
      }
      if (sum(debits, (x) => x.amount) !== gross) fail('The debits must add up to the gross amount.');
      if (kind === 'advance') fail('A cash advance is charged to an obligation request.');
    }
    const taxes = kind === 'advance' ? { lines: [], total: 0 } : withholding(gross, nature, payee, S().taxes);
    const deductions = (Array.isArray(body.deductions) ? body.deductions : existing?.deductions || []).map((x) => ({ code: fx.account(String(x.code)).code, label: text(x.label, 120) || fx.accountTitle(String(x.code)), amount: fx.money(x.amount, 'Deduction') }));
    const net = round2(gross - taxes.total - sum(deductions, (x) => x.amount));
    if (net <= 0) fail('Taxes and deductions are more than the amount.');
    if (kind === 'advance') {
      if (!['employee', 'officer'].includes(payee.kind)) fail('Cash advances are granted to employees and accountable officers only.');
      const open = unsettled(payee.id).filter((a) => a.id !== existing?.id);
      if (open.length) fail(`${payee.name} has an unsettled cash advance (DV ${open[0].no}, ₱${open[0].outstanding.toLocaleString()} outstanding). No new advance until it is liquidated (COA Circular 97-002).`);
      if (['sdo', 'payroll'].includes(advanceType)) {
        const bond = payee.bond || {};
        if (!(bond.amount >= gross) || !bond.expires || bond.expires < fx.today()) fail(`${payee.name} needs a fidelity bond of at least ₱${gross.toLocaleString()} that has not expired (Card file → bond).`);
      }
    }
    let officerId = null;
    if (mode === 'cash') {
      const o = fx.card(body.officerId ?? existing?.officerId ?? fail('Paid in cash: pick the special disbursing officer who pays it (their advance is reduced).'));
      if (o.kind !== 'officer') fail('Cash payments are made by an accountable officer (a special disbursing officer).');
      officerId = o.id;
    }
    return {
      fund, payeeId: payee.id, kind, advanceType, mode, gross, nature, orsId, iarId, charges, debits, officerId,
      taxes: taxes.lines, taxTotal: taxes.total, deductions, net,
      bankId: body.bankId ?? existing?.bankId ?? null, office: String(body.office ?? existing?.office ?? ''),
      date: fx.date(body.date ?? existing?.date ?? fx.today()), particulars: text(body.particulars ?? existing?.particulars, 1000) || fail('Particulars are required.'),
      liquidateBy: /^\d{4}-\d{2}-\d{2}$/.test(body.liquidateBy || '') ? body.liquidateBy : existing?.liquidateBy || null,
      boxA: { name: text(body.boxA?.name ?? existing?.boxA?.name, 120) || user.name, title: text(body.boxA?.title ?? existing?.boxA?.title, 120) },
    };
  }
  route('GET', '/api/finance/dvs', 'finance:finance.view', ({ query }) => {
    const q = String(query.q || '').toLowerCase();
    return D().finDvs.filter((d) => (!query.status || d.status === query.status || (query.status === 'pending' && d.status === 'draft' && d.submitted) || (query.status === 'open' && ['draft', 'certified', 'approved'].includes(d.status)))
      && (!query.fund || d.fund === query.fund) && (!query.kind || d.kind === query.kind) && (!query.mode || d.mode === query.mode) && (!q || `${d.no} ${d.particulars} ${fx.cardName(d.payeeId)}`.toLowerCase().includes(q)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(dvView);
  });
  route('GET', '/api/finance/dvs/:id', 'finance:finance.view', ({ params }) => dvView(fx.byId(D().finDvs, params.id) || fail('Voucher not found.', 404)));
  route('POST', '/api/finance/dvs/preview', 'finance:finance.view', ({ user, body }) => {
    const f = dvFields(body, null, user);
    return { ...f, entry: entryLines(f).map((l) => ({ ...l, title: fx.accountTitle(l.code) })) };
  });
  route('POST', '/api/finance/dvs', 'finance:finance.disburse', ({ user, body }) => {
    const d = { id: randomUUID(), no: '', ...dvFields(body, null, user), status: 'draft', submitted: Boolean(body.submit), createdAt: iso(), createdBy: user.name, createdById: user.id };
    D().finDvs.push(d);
    fx.audit(user, `Prepared DV for ${fx.cardName(d.payeeId)}: ₱${d.gross.toLocaleString()}`, { kind: 'dv', ref: d.id });
    save();
    return dvView(d);
  });
  route('PUT', '/api/finance/dvs/:id', 'finance:finance.disburse', ({ user, params, body }) => {
    const d = fx.byId(D().finDvs, params.id) || fail('Voucher not found.', 404);
    if (d.status !== 'draft') fail('Only a draft voucher can be changed.');
    Object.assign(d, dvFields({ ...body }, d, user));
    if (body.submit !== undefined) d.submitted = Boolean(body.submit);
    save();
    return dvView(d);
  });
  // Box C: the Chief Accountant certifies.
  route('POST', '/api/finance/dvs/:id/certify', 'finance:finance.accounts', ({ user, params, body }) => {
    const d = fx.byId(D().finDvs, params.id) || fail('Voucher not found.', 404);
    if (d.status !== 'draft') fail('This voucher is not waiting for certification.');
    if (!d.submitted) fail('The voucher has not been submitted by the disbursing office.');
    if (!body.docsComplete) fail('Confirm that the supporting documents are complete and proper.');
    Object.assign(d, dvFields({}, d, user)); // re-check the obligation and the taxes as they are now
    const cash = fx.cashAvailable(d.fund, d.mode, d.bankId, d.id);
    if (d.net > cash.available) fail(`Not enough cash: ${cash.title} has ₱${cash.available.toLocaleString(undefined, { minimumFractionDigits: 2 })} available (after vouchers already approved); this voucher needs ₱${d.net.toLocaleString(undefined, { minimumFractionDigits: 2 })}.`);
    const date = fx.date(body.date || fx.today());
    const payee = fx.byId(D().finCards, d.payeeId) || {};
    if (d.mode === 'ada' && !payee.bankAccount) fail(`${payee.name || 'The payee'} has no bank account on their card. Add it before certifying a voucher paid by LDDAP-ADA.`);
    d.payTo = { bankName: payee.bankName || '', bankAccount: payee.bankAccount || '', at: iso() };
    Object.assign(d, { status: 'certified', no: fx.nextNo('dv', { fund: d.fund, date }), certifiedBy: { id: user.id, name: user.name, title: fx.signatory('accountant').title, at: iso() }, docsComplete: true });
    fx.audit(user, `Certified DV ${d.no} (Box C)`, { kind: 'dv', ref: d.id });
    save();
    return dvView(d);
  });
  // Box D: approved for payment, by someone other than whoever prepared or certified it.
  route('POST', '/api/finance/dvs/:id/approve', 'finance:finance.approve', ({ user, params }) => {
    const d = fx.byId(D().finDvs, params.id) || fail('Voucher not found.', 404);
    if (d.status !== 'certified') fail('Only a certified voucher can be approved.');
    if (d.createdById === user.id || d.certifiedBy?.id === user.id) fail('The approving officer must be someone other than the person who prepared or certified the voucher.');
    Object.assign(d, { status: 'approved', approvedBy: { id: user.id, name: user.name, title: fx.signatory('head').title, at: iso() } });
    fx.audit(user, `Approved DV ${d.no} for payment (Box D)`, { kind: 'dv', ref: d.id });
    save();
    return dvView(d);
  });
  function payDv(d, user, { date, checkNo = '', lddapId = null }) {
    if (d.status !== 'approved') fail(`DV ${d.no} is not an approved voucher waiting for payment.`);
    if (date > fx.today()) fail('A payment cannot be dated in the future.');
    fx.assertOpen(date);
    if (d.kind === 'advance' && unsettled(d.payeeId).some((a) => a.id !== d.id && a.outstanding > 0 && a.no !== '(not yet paid)')) fail(`${fx.cardName(d.payeeId)} has an unsettled cash advance; liquidate it first.`);
    if (date < d.date) fail('Payment is dated before the voucher.');
    const cash = fx.cashAvailable(d.fund, d.mode, d.bankId, d.id);
    if (d.net > cash.balance) fail(`Not enough cash in ${cash.title} (₱${cash.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}).`);
    const j = fx.postJournal({
      date, fund: d.fund, journal: d.mode === 'check' || d.mode === 'bank' ? 'CKDJ' : 'CDJ', user,
      particulars: `DV ${d.no}${checkNo ? `, check ${checkNo}` : ''}${lddapId ? `, LDDAP-ADA ${fx.byId(D().finLddaps, lddapId).no}` : ''} – ${fx.cardName(d.payeeId)}: ${d.particulars}`,
      lines: entryLines(d), source: { kind: 'dv', id: d.id },
    });
    Object.assign(d, { status: 'paid', paidDate: date, checkNo, lddapId, journalId: j.id, paidBy: user.name });
  }
  route('POST', '/api/finance/dvs/:id/pay', 'finance:finance.disburse', ({ user, params, body }) => {
    const d = fx.byId(D().finDvs, params.id) || fail('Voucher not found.', 404);
    if (d.status !== 'approved') fail('Only an approved voucher can be paid.');
    if (d.mode === 'ada') fail('ADA payments go on a List of Due and Demandable Accounts Payable (Disbursement → LDDAP-ADA).');
    const checkNo = ['check', 'bank'].includes(d.mode) ? text(body.checkNo, 20) || fail('Check number is required.') : '';
    if (checkNo && D().finDvs.some((x) => x.checkNo === checkNo && x.id !== d.id && x.status === 'paid' && fx.cashAccount(x.fund, x.mode, x.bankId) === fx.cashAccount(d.fund, d.mode, d.bankId))) fail(`Check ${checkNo} was already issued.`);
    payDv(d, user, { date: fx.date(body.date || fx.today()), checkNo });
    fx.audit(user, `Paid DV ${d.no}${checkNo ? ` by check ${checkNo}` : ''}`, { kind: 'dv', ref: d.id });
    save();
    return dvView(d);
  });
  // A spoiled, stale or cancelled check: the payment is reversed and the voucher can be paid again.
  route('POST', '/api/finance/dvs/:id/void-payment', 'finance:finance.accounts', ({ user, params, body }) => {
    const d = fx.byId(D().finDvs, params.id) || fail('Voucher not found.', 404);
    if (d.status !== 'paid') fail('This voucher is not paid.');
    if (d.lddapId) fail('ADA payments are corrected with the bank (invalidated ADA entries), not here.');
    if (D().finLiquidations.some((l) => l.dvId === d.id)) fail('This advance is already partly liquidated.');
    const reason = text(body.reason, 300) || fail('Give the reason (spoiled, stale, cancelled).');
    if (d.taxTotal && D().finRemittances.some((r) => r.fund === d.fund && r.month === d.paidDate.slice(0, 7))) fail(`The taxes withheld in ${fx.monthLabel(d.paidDate.slice(0, 7))} were already remitted and certified (2307); correct this payment with a journal entry instead.`);
    fx.reverseJournal(fx.byId(D().finJournals, d.journalId), user, `Check ${d.checkNo} ${reason}`, fx.date(body.date || fx.today()));
    d.voided = [...(d.voided || []), { checkNo: d.checkNo, date: d.paidDate, reason, by: user.name }];
    Object.assign(d, { status: 'approved', paidDate: null, checkNo: '', journalId: null, receipt: null });
    fx.audit(user, `Voided payment of DV ${d.no}: ${reason}`, { kind: 'dv', ref: d.id });
    save();
    return dvView(d);
  });
  // Box E: receipt of payment.
  route('POST', '/api/finance/dvs/:id/receipt', 'finance:finance.disburse', ({ user, params, body }) => {
    const d = fx.byId(D().finDvs, params.id) || fail('Voucher not found.', 404);
    if (d.status !== 'paid') fail('Record the receipt after payment.');
    d.receipt = { receivedBy: text(body.receivedBy, 120) || fx.cardName(d.payeeId), date: fx.date(body.date || fx.today()), orNo: text(body.orNo, 40), by: user.name };
    save();
    return dvView(d);
  });
  route('POST', '/api/finance/dvs/:id/cancel', 'finance', ({ user, params, body }) => {
    const d = fx.byId(D().finDvs, params.id) || fail('Voucher not found.', 404);
    if (!userCan(user, 'finance.disburse') && !userCan(user, 'finance.accounts')) fail('Your account cannot cancel vouchers.', 403);
    if (['paid', 'cancelled'].includes(d.status)) fail(d.status === 'paid' ? 'A paid voucher is not cancelled; void the payment first.' : 'Already cancelled.');
    Object.assign(d, { status: 'cancelled', cancelReason: text(body.reason, 300), cancelledBy: user.name });
    fx.audit(user, `Cancelled DV ${d.no || '(draft)'}`, { kind: 'dv', ref: d.id });
    save();
    return dvView(d);
  });

  // ----- LDDAP-ADA -----
  const lddapView = (l) => ({ ...l, bank: S().bankAccounts.find((b) => b.id === l.bankId) || null, dvs: l.dvIds.map((id) => dvView(fx.byId(D().finDvs, id))), fundName: fundName(l.fund) });
  route('GET', '/api/finance/lddaps', 'finance:finance.view', () => D().finLddaps.slice().reverse().map(lddapView));
  route('GET', '/api/finance/lddaps/:id', 'finance:finance.view', ({ params }) => lddapView(fx.byId(D().finLddaps, params.id) || fail('LDDAP-ADA not found.', 404)));
  route('POST', '/api/finance/lddaps', 'finance:finance.disburse', ({ user, body }) => {
    const dvs = [...new Set(Array.isArray(body.dvIds) ? body.dvIds : [])].map((id) => fx.byId(D().finDvs, id) || fail('Voucher not found.'));
    if (!dvs.length) fail('Pick the approved ADA vouchers to include.');
    const fund = dvs[0].fund;
    for (const d of dvs) {
      if (d.status !== 'approved' || d.mode !== 'ada') fail(`DV ${d.no} is not an approved ADA voucher.`);
      if (d.fund !== fund) fail('One LDDAP-ADA per fund cluster.');
      const p = fx.byId(D().finCards, d.payeeId);
      if (!(d.payTo ? d.payTo.bankAccount : p.bankAccount)) fail(`${p.name} had no bank account when DV ${d.no} was certified. Cancel the voucher and prepare it again once the account is on their card.`);
    }
    const date = fx.date(body.date || fx.today());
    if (body.bankId && S().bankAccounts.find((b) => b.id === body.bankId)?.fund !== fund) fail(`Pick a fund ${fund} account for this list.`);
    const l = { id: randomUUID(), no: fx.nextNo('lddap', { fund, date }), date, fund, dvIds: dvs.map((d) => d.id), total: sum(dvs, (d) => d.net), bankId: body.bankId || null, createdBy: user.name, createdAt: iso() };
    D().finLddaps.push(l);
    for (const d of dvs) payDv(d, user, { date, lddapId: l.id });
    fx.audit(user, `Issued LDDAP-ADA ${l.no}: ${dvs.length} voucher${dvs.length === 1 ? '' : 's'}, ₱${l.total.toLocaleString()}`, { kind: 'lddap', ref: l.id });
    save();
    return lddapView(l);
  });

  // ----- Cash advances and liquidation -----
  route('GET', '/api/finance/advances', 'finance:finance.view', ({ query }) => advances().filter((a) => query.all || a.outstanding > 0).sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.due.localeCompare(b.due)));
  route('GET', '/api/finance/liquidations', 'finance:finance.view', ({ query }) => D().finLiquidations.filter((l) => !query.dvId || l.dvId === query.dvId).slice().reverse().map((l) => ({ ...l, payee: fx.cardName(fx.byId(D().finDvs, l.dvId)?.payeeId), dvNo: fx.byId(D().finDvs, l.dvId)?.no, jevNo: fx.byId(D().finJournals, l.journalId)?.jevNo || '' })));
  route('POST', '/api/finance/liquidations', 'finance:finance.accounts', ({ user, body }) => {
    const d = fx.byId(D().finDvs, body.dvId) || fail('Cash advance not found.');
    const a = advances().find((x) => x.id === d.id) || fail('That voucher is not a paid cash advance.');
    const date = fx.date(body.date || fx.today());
    const ors = fx.byId(D().finObligations, d.orsId);
    const allowed = new Set((ors?.lines || []).map((l) => l.code));
    const lines = (Array.isArray(body.lines) ? body.lines : []).map((l) => {
      const acct = fx.account(String(l.code));
      if (allowed.size && !allowed.has(acct.code)) fail(`${acct.title} is not on the advance's obligation request.`);
      return { code: acct.code, amount: fx.money(l.amount, acct.title), particulars: text(l.particulars, 200) };
    });
    const expenses = sum(lines, (l) => l.amount);
    let refund = 0;
    let receipt = null;
    if (body.receiptId) {
      receipt = fx.byId(D().finReceipts, body.receiptId) || fail('Official receipt not found.');
      if (receipt.status !== 'issued') fail('That receipt was cancelled.');
      if (receipt.payorCardId !== d.payeeId || receipt.fund !== d.fund) fail(`O.R. ${receipt.no} is not a refund from ${fx.cardName(d.payeeId)} to fund ${d.fund}.`);
      if (D().finLiquidations.some((x) => x.receiptId === receipt.id)) fail(`O.R. ${receipt.no} is already used for a refund.`);
      refund = sum(receipt.lines.filter((x) => x.code === d.debits[0].code), (x) => x.amount);
      if (!refund) fail(`O.R. ${receipt.no} has no line for ${fx.accountTitle(d.debits[0].code)}.`);
    }
    if (!expenses && !refund) fail('Enter the expenses, or the receipt for the refund.');
    if (round2(expenses + refund) > a.outstanding + 0.001) fail(`Only ₱${a.outstanding.toLocaleString(undefined, { minimumFractionDigits: 2 })} of this advance is outstanding. Expenses beyond it are reimbursed on a new voucher.`);
    const liq = { id: randomUUID(), no: fx.nextNo('liq', { date }), dvId: d.id, date, lines, expenses, refund, receiptId: receipt?.id || null, receiptNo: receipt?.no || '', createdBy: user.name, createdAt: iso() };
    if (expenses) {
      const j = fx.postJournal({
        date, fund: d.fund, journal: 'GJ', user, particulars: `Liquidation ${liq.no} of cash advance DV ${d.no} – ${fx.cardName(d.payeeId)}`,
        lines: [...lines.map((l) => ({ code: l.code, debit: l.amount, office: d.office, memo: l.particulars })), { code: d.debits[0].code, credit: expenses, cardId: d.payeeId }],
        source: { kind: 'liquidation', id: liq.id },
      });
      liq.journalId = j.id;
    }
    D().finLiquidations.push(liq);
    fx.audit(user, `Liquidation ${liq.no} of DV ${d.no}: ₱${expenses.toLocaleString()} expenses${refund ? `, ₱${refund.toLocaleString()} refunded (O.R. ${liq.receiptNo})` : ''}`, { kind: 'liquidation', ref: liq.id });
    save();
    return liq;
  });

  // ----- Taxes -----
  const paidIn = (from, to) => D().finDvs.filter((d) => d.status === 'paid' && d.paidDate >= from && d.paidDate <= to);
  const quarterRange = (year, q) => [`${year}-${String(q * 3 - 2).padStart(2, '0')}-01`, fx.monthEnd(`${year}-${String(q * 3).padStart(2, '0')}`)];
  route('GET', '/api/finance/taxes', 'finance:finance.view', ({ query }) => {
    const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : fx.today().slice(0, 7);
    const rows = {};
    for (const d of paidIn(`${month}-01`, fx.monthEnd(month))) {
      for (const t of d.taxes) {
        const k = `${d.fund}|${t.atc}`;
        const tax = S().taxes.find((x) => x.atc === t.atc);
        rows[k] ||= { fund: d.fund, atc: t.atc, kind: t.kind, label: tax?.label || t.atc, rate: t.rate, base: 0, amount: 0, payees: new Set() };
        rows[k].base = round2(rows[k].base + t.base);
        rows[k].amount = round2(rows[k].amount + t.amount);
        rows[k].payees.add(d.payeeId);
      }
    }
    const list = Object.values(rows).map((r) => ({ ...r, payees: r.payees.size })).sort((a, b) => a.fund.localeCompare(b.fund) || a.kind.localeCompare(b.kind) || a.atc.localeCompare(b.atc));
    const remitted = D().finRemittances.filter((r) => r.month === month);
    // What is still to be remitted for this month, per fund (the same figure the remittance takes),
    // and its BIR deadline: the 10th of the following month.
    const [y, m] = month.split('-').map(Number);
    const dueDate = `${m === 12 ? y + 1 : y}-${String((m % 12) + 1).padStart(2, '0')}-10`;
    const toRemit = S().funds.map((f) => {
      const withheld = sum(list.filter((r) => r.fund === f), (r) => r.amount);
      const already = sum(remitted.filter((r) => r.fund === f), (r) => r.amount);
      return { fund: f, withheld, remitted: already, due: round2(Math.max(0, Math.min(withheld - already, fx.balance(ACCT.dueBir, { fund: f })))) };
    }).filter((x) => x.withheld > 0);
    return { month, rows: list, total: sum(list, (r) => r.amount), remittances: remitted.map((r) => ({ ...r, jevNo: fx.byId(D().finJournals, r.journalId)?.jevNo || '' })), toRemit, dueDate, dueBir: S().funds.map((f) => ({ fund: f, balance: fx.balance(ACCT.dueBir, { fund: f }) })) };
  });
  // Quarterly Alphalist of Payees (for the 1601-EQ) or the VAT/percentage tax withheld.
  route('GET', '/api/finance/taxes/alphalist', 'finance:finance.view', ({ query }) => {
    const year = Number(query.year) || Number(fx.today().slice(0, 4));
    const q = Math.min(4, Math.max(1, Number(query.quarter) || Math.ceil(Number(fx.today().slice(5, 7)) / 3)));
    const kinds = query.kind === 'vat' ? ['vat', 'pt'] : ['ewt'];
    const [from, to] = quarterRange(year, q);
    const rows = {};
    for (const d of paidIn(from, to)) {
      for (const t of d.taxes.filter((x) => kinds.includes(x.kind))) {
        const p = fx.byId(D().finCards, d.payeeId);
        const k = `${p.id}|${t.atc}`;
        rows[k] ||= { payeeId: p.id, tin: p.tin || '', name: p.name, atc: t.atc, rate: t.rate, base: 0, amount: 0 };
        rows[k].base = round2(rows[k].base + t.base);
        rows[k].amount = round2(rows[k].amount + t.amount);
      }
    }
    const list = Object.values(rows).sort((a, b) => a.name.localeCompare(b.name) || a.atc.localeCompare(b.atc));
    return { year, quarter: q, kind: query.kind === 'vat' ? 'vat' : 'ewt', rows: list, base: sum(list, (r) => r.base), total: sum(list, (r) => r.amount) };
  });
  // BIR Form 2307 for one payee and quarter: income payments and tax withheld by month and ATC.
  route('GET', '/api/finance/taxes/2307', 'finance:finance.view', ({ query }) => {
    const p = fx.card(query.payeeId);
    const year = Number(query.year) || Number(fx.today().slice(0, 4));
    const q = Math.min(4, Math.max(1, Number(query.quarter) || 1));
    const [from, to] = quarterRange(year, q);
    const kinds = query.kind === 'vat' ? ['vat', 'pt'] : ['ewt'];
    const rows = {};
    for (const d of paidIn(from, to).filter((x) => x.payeeId === p.id)) {
      const m = (Number(d.paidDate.slice(5, 7)) - 1) % 3;
      for (const t of d.taxes.filter((x) => kinds.includes(x.kind))) {
        const tax = S().taxes.find((x) => x.atc === t.atc);
        rows[t.atc] ||= { atc: t.atc, label: tax?.label || t.atc, months: [0, 0, 0], total: 0, tax: 0 };
        rows[t.atc].months[m] = round2(rows[t.atc].months[m] + t.base);
        rows[t.atc].total = round2(rows[t.atc].total + t.base);
        rows[t.atc].tax = round2(rows[t.atc].tax + t.amount);
      }
    }
    const e = S().entity;
    return {
      year, quarter: q, from, to, kind: kinds[0] === 'ewt' ? 'ewt' : 'vat',
      payee: { name: p.name, tin: p.tin, address: p.address }, payor: { name: e.name || D().settings.schoolName, tin: e.tin, address: e.address },
      rows: Object.values(rows), total: sum(Object.values(rows), (r) => r.total), tax: sum(Object.values(rows), (r) => r.tax),
      signatory: fx.signatory('accountant'),
    };
  });
  route('GET', '/api/finance/remittances', 'finance:finance.view', () => D().finRemittances.slice().reverse().map((r) => ({ ...r, jevNo: fx.byId(D().finJournals, r.journalId)?.jevNo || '' })));
  // Remit the taxes withheld in a month: by Tax Remittance Advice (fund 01, through the MDS) or
  // from the fund's bank account (eFPS / authorized bank).
  route('POST', '/api/finance/remittances', 'finance:finance.disburse', ({ user, body }) => {
    const month = /^\d{4}-\d{2}$/.test(body.month || '') ? body.month : fail('Pick the month.');
    const fund = fx.fund(String(body.fund || ''));
    const date = fx.date(body.date || fx.today());
    const withheld = sum(paidIn(`${month}-01`, fx.monthEnd(month)).filter((d) => d.fund === fund), (d) => d.taxTotal);
    const already = sum(D().finRemittances.filter((r) => r.month === month && r.fund === fund), (r) => r.amount);
    // Never more than is owed to BIR on the books (a voided and re-paid voucher must not be remitted twice).
    const amount = round2(Math.min(withheld - already, fx.balance(ACCT.dueBir, { fund })));
    if (amount <= 0) fail(`Nothing left to remit for ${fx.monthLabel(month)}, fund ${fund}.`);
    const mode = fund === '01' && body.mode !== 'bank' ? 'tra' : 'bank';
    const ref = text(body.ref, 60) || fail(mode === 'tra' ? 'TRA number is required.' : 'Payment reference (eFPS/bank) is required.');
    const cash = mode === 'tra' ? ACCT.cashTra : fx.cashAccount(fund, 'bank', body.bankId);
    const lines = mode === 'tra'
      ? [{ code: ACCT.cashTra, debit: amount }, { code: ACCT.subsidyNg, credit: amount }, { code: ACCT.dueBir, debit: amount }, { code: ACCT.cashTra, credit: amount }]
      : [{ code: ACCT.dueBir, debit: amount }, { code: cash, credit: amount }];
    const j = fx.postJournal({ date, fund, journal: mode === 'tra' ? 'GJ' : 'CKDJ', user, particulars: `Remittance of taxes withheld for ${fx.monthLabel(month)} (${mode === 'tra' ? `TRA ${ref}` : ref})`, lines, source: { kind: 'remittance' } });
    const r = { id: randomUUID(), month, fund, date, amount, mode, ref, journalId: j.id, by: user.name, at: iso() };
    j.source.id = r.id;
    D().finRemittances.push(r);
    save();
    return r;
  });

  // ----- Revenue: accountable forms -----
  const bookletView = (b) => {
    const used = D().finReceipts.filter((r) => r.bookletId === b.id);
    return { ...b, collectorName: fx.byId(D().users, b.collectorId)?.name || '', issued: used.filter((r) => r.status === 'issued').length, cancelled: used.filter((r) => r.status === 'cancelled').length, remaining: b.status === 'active' ? b.to - b.next + 1 : 0, quantity: b.to - b.from + 1 };
  };
  route('GET', '/api/finance/collectors', 'finance:finance.view', () => D().users.filter((u) => u.status === 'active' && userCan(u, 'finance.collect')).map((u) => ({ id: u.id, name: u.name })));
  route('GET', '/api/finance/booklets', 'finance:finance.view', () => D().finBooklets.slice().reverse().map(bookletView));
  route('POST', '/api/finance/booklets', 'finance:finance.collect', ({ user, body }) => {
    const from = Number(body.from);
    const to = Number(body.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to - from > 999) fail('Serial numbers: from and to, at most 1,000 receipts.');
    const form = text(body.form, 20) || '51';
    if (D().finBooklets.some((b) => b.form === form && !(to < b.from || from > b.to))) fail('Those serial numbers overlap a booklet already recorded.');
    const collector = fx.byId(D().users, body.collectorId) || fail('Pick the collecting officer.');
    if (!userCan(collector, 'finance.collect')) fail(`${collector.name} is not a collecting officer (needs the Revenue permission).`);
    const b = { id: randomUUID(), form, from, to, next: from, fund: fx.fund(String(body.fund || '05')), collectorId: collector.id, issuedDate: fx.date(body.date || fx.today()), status: 'active', createdBy: user.name };
    D().finBooklets.push(b);
    fx.audit(user, `Issued AF ${form} booklet ${from}–${to} to ${collector.name}`, { kind: 'booklet', ref: b.id });
    save();
    return bookletView(b);
  });

  // Students, for receipts (tuition and fees paid by a student show on their self-service page).
  route('GET', '/api/finance/students', 'finance:finance.collect', ({ query }) => {
    const q = String(query.q || '').toLowerCase();
    if (q.length < 2) return [];
    return D().users.filter((u) => u.role === 'student' && u.status === 'active' && `${u.name} ${u.studentNo || ''} ${u.username}`.toLowerCase().includes(q)).slice(0, 20).map((u) => ({ id: u.id, name: u.name, studentNo: u.studentNo || '' }));
  });

  // ----- Official receipts -----
  const pad = (n) => String(n).padStart(7, '0');
  const receiptView = (r) => ({ ...r, payorCard: r.payorCardId ? fx.cardName(r.payorCardId) : '', rcdNo: fx.byId(D().finRcds, r.rcdId)?.no || '', entity: { name: S().entity.name || D().settings.schoolName, address: S().entity.address }, fundName: fundName(r.fund) });
  route('GET', '/api/finance/receipts', 'finance:finance.view', ({ query }) => {
    const q = String(query.q || '').toLowerCase();
    return D().finReceipts.filter((r) => (!query.date || r.date === query.date) && (!query.from || r.date >= query.from) && (!query.to || r.date <= query.to) && (!query.collectorId || r.collectorId === query.collectorId)
      && (!query.unreported || !r.rcdId) && (!q || `${r.no} ${r.payorName}`.toLowerCase().includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no)).slice(0, 500).map(receiptView);
  });
  route('GET', '/api/finance/receipts/:id', 'finance', ({ user, params }) => {
    const r = fx.byId(D().finReceipts, params.id) || fail('Receipt not found.', 404);
    const mineCard = fx.cardOfUser(user.id);
    if (!fx.isStaff(user) && r.studentId !== user.id && (!mineCard || r.payorCardId !== mineCard.id)) fail('Receipt not found.', 404);
    return receiptView(r);
  });
  route('POST', '/api/finance/receipts', 'finance:finance.collect', ({ user, body }) => {
    const fund = fx.fund(String(body.fund || '05'));
    const date = fx.date(body.date || fx.today());
    if (date > fx.today()) fail('A receipt cannot be dated in the future.');
    const b = D().finBooklets.find((x) => x.collectorId === user.id && x.fund === fund && x.status === 'active') || fail(`You have no Official Receipt booklet for fund ${fund}. The cashier issues one (Revenue → Accountable forms).`);
    const student = body.studentId ? fx.byId(D().users, body.studentId) : null;
    if (body.studentId && student?.role !== 'student') fail('Student not found.');
    const card = body.payorCardId ? fx.card(body.payorCardId) : null;
    const payorName = text(body.payorName, 160) || student?.name || card?.name || fail('Payor is required.');
    const lines = (Array.isArray(body.lines) ? body.lines : []).map((l) => {
      const item = l.itemId ? S().revenueItems.find((x) => x.id === l.itemId) : null;
      const code = String(item?.code || l.code || '');
      const a = fx.account(code);
      if (a.group !== 4 && !tracksCard(code)) fail(`${a.title}: receipts are credited to revenue, receivable, advance, trust or payable accounts.`);
      if (tracksCard(code) && !code.startsWith('204') && !card) fail(`${a.title} needs the payor's card (for the subsidiary ledger).`);
      return { itemId: item?.id || null, code, description: text(l.description || item?.name || a.title, 160), amount: fx.money(l.amount, l.description || a.title) };
    });
    if (!lines.length) fail('Add what is being paid for.');
    const mode = ['cash', 'check', 'online'].includes(body.mode) ? body.mode : 'cash';
    const r = {
      id: randomUUID(), no: pad(b.next), bookletId: b.id, form: b.form, date, fund, payorName, payorCardId: card?.id || null, studentId: student?.id || null,
      lines, total: sum(lines, (l) => l.amount), mode, checkNo: mode === 'check' ? text(body.checkNo, 30) || fail('Check number is required.') : '', bank: text(body.bank, 80),
      collectorId: user.id, collectorName: user.name, status: 'issued', rcdId: null, createdAt: iso(),
    };
    b.next += 1;
    if (b.next > b.to) b.status = 'used';
    D().finReceipts.push(r);
    fx.audit(user, `Issued O.R. ${r.no} to ${payorName}: ₱${r.total.toLocaleString()}`, { kind: 'receipt', ref: r.id });
    save();
    return receiptView(r);
  });
  route('POST', '/api/finance/receipts/:id/cancel', 'finance:finance.collect', ({ user, params, body }) => {
    const r = fx.byId(D().finReceipts, params.id) || fail('Receipt not found.', 404);
    if (r.status !== 'issued') fail('Already cancelled.');
    if (r.rcdId) fail('This receipt is already in a Report of Collections and Deposits.');
    if (r.collectorId !== user.id && user.role !== 'admin') fail('Only the collector who issued it can cancel it.');
    if (D().finLiquidations.some((l) => l.receiptId === r.id)) fail('This receipt is a refund on a liquidation.');
    Object.assign(r, { status: 'cancelled', cancelReason: text(body.reason, 300) || fail('Give the reason (all copies are kept).'), cancelledAt: iso() });
    fx.audit(user, `Cancelled O.R. ${r.no}: ${r.cancelReason}`, { kind: 'receipt', ref: r.id });
    save();
    return receiptView(r);
  });

  // ----- Reports of Collections and Deposits -----
  const rcdView = (c) => ({
    ...c, collectorName: fx.byId(D().users, c.collectorId)?.name || '', fundName: fundName(c.fund),
    receipts: D().finReceipts.filter((r) => r.rcdId === c.id).sort((a, b) => a.no.localeCompare(b.no)).map((r) => ({ id: r.id, no: r.no, date: r.date, payorName: r.payorName, total: r.status === 'issued' ? r.total : 0, status: r.status, lines: r.lines })),
    jevNo: fx.byId(D().finJournals, c.journalId)?.jevNo || '', depositJevNo: fx.byId(D().finJournals, c.deposit?.journalId)?.jevNo || '',
    bank: c.deposit ? S().bankAccounts.find((b) => b.id === c.deposit.bankId) || null : null,
    overdue: !c.deposit && fx.today() > addDays(c.date, S().depositDays),
  });
  route('GET', '/api/finance/rcds', 'finance:finance.view', () => D().finRcds.slice().reverse().map(rcdView));
  route('GET', '/api/finance/rcds/:id', 'finance:finance.view', ({ params }) => rcdView(fx.byId(D().finRcds, params.id) || fail('Report not found.', 404)));
  route('POST', '/api/finance/rcds', 'finance:finance.collect', ({ user, body }) => {
    const fund = fx.fund(String(body.fund || '05'));
    const date = fx.date(body.date || fx.today());
    fx.assertOpen(date);
    const receipts = D().finReceipts.filter((r) => r.collectorId === user.id && r.fund === fund && !r.rcdId && r.date <= date);
    const issued = receipts.filter((r) => r.status === 'issued');
    if (!issued.length) fail(`You have no unreported collections for fund ${fund} through ${date}.`);
    const credit = {};
    for (const r of issued) {
      for (const l of r.lines) {
        const k = `${l.code}|${tracksCard(l.code) ? r.payorCardId || '' : ''}`;
        credit[k] = round2((credit[k] || 0) + l.amount);
      }
    }
    const total = sum(issued, (r) => r.total);
    const c = { id: randomUUID(), no: fx.nextNo('rcd', { fund, date }), date, fund, collectorId: user.id, from: receipts.map((r) => r.no).sort()[0], to: receipts.map((r) => r.no).sort().at(-1), total, count: issued.length, createdAt: iso(), deposit: null };
    const collectorCard = fx.cardOfUser(user.id);
    const j = fx.postJournal({
      date, fund, journal: 'CRJ', user, particulars: `Collections per RCD ${c.no}, O.R. ${c.from}–${c.to} (${user.name})`,
      lines: [{ code: ACCT.cashCollecting, debit: total, cardId: collectorCard?.id || null }, ...Object.entries(credit).map(([k, amt]) => ({ code: k.split('|')[0], credit: amt, cardId: k.split('|')[1] || null }))],
      source: { kind: 'rcd', id: c.id },
    });
    c.journalId = j.id;
    for (const r of receipts) r.rcdId = c.id;
    D().finRcds.push(c);
    fx.audit(user, `Prepared RCD ${c.no}: ₱${total.toLocaleString()} (${issued.length} receipts)`, { kind: 'rcd', ref: c.id });
    save();
    return rcdView(c);
  });
  route('POST', '/api/finance/rcds/:id/deposit', 'finance:finance.collect', ({ user, params, body }) => {
    const c = fx.byId(D().finRcds, params.id) || fail('Report not found.', 404);
    if (c.deposit) fail('Already deposited.');
    const date = fx.date(body.date || fx.today());
    if (date < c.date) fail('The deposit is dated before the collections.');
    const bank = S().bankAccounts.find((b) => b.id === body.bankId && b.fund === c.fund) || fail(`Pick the fund ${c.fund} bank account (set them up in the Control panel).`);
    const slipNo = text(body.slipNo, 40) || fail('Validated deposit slip number is required.');
    const collectorCard = fx.cardOfUser(c.collectorId);
    const j = fx.postJournal({ date, fund: c.fund, journal: 'CRJ', user, particulars: `Deposit of collections per RCD ${c.no}, deposit slip ${slipNo}, ${bank.name} ${bank.number}`, lines: [{ code: bank.code, debit: c.total }, { code: ACCT.cashCollecting, credit: c.total, cardId: collectorCard?.id || null }], source: { kind: 'deposit', id: c.id } });
    c.deposit = { date, bankId: bank.id, slipNo, journalId: j.id, by: user.name };
    fx.audit(user, `Deposited RCD ${c.no}: ₱${c.total.toLocaleString()}`, { kind: 'rcd', ref: c.id });
    save();
    return rcdView(c);
  });

  // ----- Revenue monitoring -----
  function revenueActual(year, fund) {
    const rows = {};
    // Own-source income only: subsidies from the national government and other agencies (403) are not collections.
    for (const l of fx.lines({ fund, from: `${year}-01-01`, to: `${year}-12-31`, code: (c) => c[0] === '4' && !c.startsWith('403'), exclude: (j) => j.source?.kind === 'closing' })) {
      const r = (rows[l.code] ||= { code: l.code, title: fx.accountTitle(l.code), months: Array(12).fill(0) });
      const m = Number(l.date.slice(5, 7)) - 1;
      r.months[m] = round2(r.months[m] + l.credit - l.debit);
    }
    return rows;
  }
  route('GET', '/api/finance/revenue', 'finance:finance.view', ({ query }) => {
    const year = Number(query.fy) || fx.fy();
    const fund = query.fund || undefined;
    const actual = revenueActual(year, fund);
    const targets = D().finRevenueTargets.filter((t) => t.fy === year && (!fund || t.fund === fund));
    for (const t of targets) actual[t.code] ||= { code: t.code, title: fx.accountTitle(t.code), months: Array(12).fill(0) };
    const rows = Object.values(actual).map((r) => {
      const target = sum(targets.filter((t) => t.code === r.code), (t) => t.amount);
      const total = sum(r.months);
      return { ...r, target, total, percent: target ? Math.round((total / target) * 1000) / 10 : null, variance: round2(total - target) };
    }).sort((a, b) => a.code.localeCompare(b.code));
    return { fy: year, fund: fund || '', rows, totals: { target: sum(rows, (r) => r.target), actual: sum(rows, (r) => r.total), months: Array.from({ length: 12 }, (_, m) => sum(rows, (r) => r.months[m])) } };
  });
  route('PUT', '/api/finance/revenue/targets', 'finance', ({ user, body }) => {
    if (!userCan(user, 'finance.collect') && !userCan(user, 'finance.budget')) fail('Revenue targets are set by the budget or revenue office.', 403);
    const year = Number(body.fy) || fx.fy();
    const fund = fx.fund(String(body.fund || '05'));
    const targets = body.targets || {};
    const next = Object.entries(targets).map(([code, amount]) => {
      const a = fx.account(code);
      if (a.group !== 4) fail(`${a.title} is not a revenue account.`);
      return { id: randomUUID(), fy: year, fund, code, amount: fx.money(amount, a.title, { allowZero: true }) };
    }).filter((t) => t.amount);
    D().finRevenueTargets = [...D().finRevenueTargets.filter((t) => !(t.fy === year && t.fund === fund)), ...next];
    fx.audit(user, `Set ${year} revenue targets for fund ${fund}`, { kind: 'revenue' });
    save();
    return { ok: true };
  });
  function revenueByMonth(year) {
    const months = Array(12).fill(0);
    // Revenue collected on official receipts (not deposits held in trust, refunds of advances or collections of receivables).
    for (const r of D().finReceipts) {
      if (r.status !== 'issued' || !r.date.startsWith(String(year))) continue;
      const m = Number(r.date.slice(5, 7)) - 1;
      months[m] = round2(months[m] + sum(r.lines.filter((l) => l.code[0] === '4'), (l) => l.amount));
    }
    const targets = sum(D().finRevenueTargets.filter((t) => t.fy === year), (t) => t.amount);
    return { months, total: sum(months), target: targets };
  }

  // ----- Self-service -----
  // Employees: property in their custody and their cash advances. Students: their receipts.
  route('GET', '/api/finance/my', 'finance', ({ user }) => {
    const card = fx.cardOfUser(user.id);
    const receipts = D().finReceipts.filter((r) => r.status === 'issued' && (r.studentId === user.id || (card && r.payorCardId === card.id))).sort((a, b) => b.date.localeCompare(a.date)).map((r) => ({ id: r.id, no: r.no, date: r.date, total: r.total, lines: r.lines.map((l) => ({ description: l.description, amount: l.amount })) }));
    if (user.role === 'student') return { card: null, receipts };
    return {
      card: card ? { id: card.id, name: card.name } : null,
      property: card ? D().finProperty.filter((p) => p.custodianId === card.id && p.status === 'issued').map((p) => ({ id: p.id, propertyNo: p.propertyNo, description: p.description, cost: p.cost, type: p.type, docNo: p.docNo, acquired: p.acquired, serialNo: p.serialNo })) : [],
      advances: card ? advances().filter((a) => a.payeeId === card.id && a.outstanding > 0) : [],
      receipts,
      requisitions: D().finRis.filter((r) => r.requestedBy.userId === user.id).length,
    };
  });

  fx.ctx.financeCash = { advances, revenueByMonth };
}

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
