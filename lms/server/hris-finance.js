// From payroll to ATLAS Finance (government payroll), the way a state university pays salaries:
//  1. A finalized payroll run prepares its obligation request (ORS/BURS, Box A): one line per
//     object code (salaries, PERA, RATA, bonuses, and the government shares of GSIS, Pag-IBIG,
//     PhilHealth and Employees' Compensation), charged to the PS allotment (job orders: MOOE).
//  2. Once the budget office has obligated it (Box B), the payroll voucher (DV): gross = the
//     obligation; deductions = what is withheld and the government shares, credited to Due to BIR,
//     GSIS, Pag-IBIG, PhilHealth and Other Payables; net = the take-home pay on the General Payroll.
//     Finance certifies (Box C), approves (Box D) and pays it, and posts the journal entry.
//  3. Once that voucher is paid, the remittance vouchers that settle Due to GSIS, Pag-IBIG,
//     PhilHealth and BIR (no obligation request: they only settle a liability).
// Everything goes through Finance's own routes (ctx.invoke), so its rules apply: allotment
// balances, numbering, separation of duties, closed periods and the audit trail. The payroll
// officer acts for the payroll office (Box A); Finance's officers do the rest.
import { HttpError } from './util.js';
import { BONUS_KINDS } from '../shared/gov-pay.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Object codes (Revised Chart of Accounts / UACS).
export const PAYROLL_CODES = {
  salaryRegular: '50101010', salaryCasual: '50101020', laborWages: '50216010',
  pera: '50102010', representation: '50102020', transportation: '50102030', clothing: '50102040',
  overtime: '50102130', yearEnd: '50102140', cashGift: '50102150', midYear: '50102160', otherBonus: '50102990',
  gsis: '50103010', pagibig: '50103020', philhealth: '50103030', ecc: '50103040',
  dueBir: '20201010', dueGsis: '20201020', duePagibig: '20201030', duePhilhealth: '20201040', otherPayables: '29999990',
};
const BONUS_CODE = { MYB: 'midYear', YEB: 'yearEnd', CG: 'cashGift', PEI: 'otherBonus', CLOTH: 'clothing', OTHER: 'otherBonus' };
const REGULAR = ['Permanent', 'Temporary', 'Coterminous', 'Substitute', ''];
const isJo = (p) => ['Job order', 'Contract of service'].includes(p.employee.appointment);

// What the run obligates and what the voucher withholds.
export function payrollEntry(run) {
  const lines = {};
  const add = (key, amt) => {
    if (!amt) return;
    const code = PAYROLL_CODES[key];
    lines[code] = r2((lines[code] || 0) + amt);
  };
  const credit = {};
  const withhold = (code, label, amt) => {
    if (!amt) return;
    const k = `${code}|${label}`;
    credit[k] = { code, label, amount: r2((credit[k]?.amount || 0) + amt) };
  };
  for (const p of run.payslips) {
    if (!p.grossPay) continue;
    if (run.kind && run.kind !== 'regular') {
      for (const i of p.earnings.items) add(BONUS_CODE[i.code] || 'otherBonus', i.amount);
    } else {
      const e = p.earnings;
      add(isJo(p) ? 'laborWages' : REGULAR.includes(p.employee.appointment) ? 'salaryRegular' : 'salaryCasual', e.basicPay);
      add('pera', e.pera);
      add('representation', e.representation);
      add('transportation', e.transportation);
      add('overtime', e.overtimePay);
      add('otherBonus', (e.allowance || 0) + (e.otherEarnings || 0));
    }
    const s = p.employerShare || {};
    add('gsis', s.gsis);
    add('ecc', s.ecc);
    add('pagibig', s.pagibig);
    add('philhealth', s.philhealth);
    const d = p.deductions;
    withhold(PAYROLL_CODES.dueBir, 'Withholding tax on compensation', (d.withholdingTax || 0) + (d.percentageTax || 0));
    withhold(PAYROLL_CODES.dueGsis, 'GSIS: personal and government shares, EC', (d.gsis || 0) + (s.gsis || 0) + (s.ecc || 0));
    withhold(PAYROLL_CODES.duePhilhealth, 'PhilHealth: employee and employer shares', (d.philhealth || 0) + (s.philhealth || 0));
    withhold(PAYROLL_CODES.duePagibig, 'Pag-IBIG: employee and employer shares', (d.pagibig || 0) + (s.pagibig || 0));
    for (const l of d.items || []) {
      const code = l.remit === 'GSIS' ? PAYROLL_CODES.dueGsis : l.remit === 'Pag-IBIG' ? PAYROLL_CODES.duePagibig : PAYROLL_CODES.otherPayables;
      withhold(code, code === PAYROLL_CODES.otherPayables ? `${l.remit}: ${l.name}` : `${l.remit} loans and savings`, l.amount);
    }
    withhold(PAYROLL_CODES.otherPayables, 'Other deductions', d.otherDeductions);
  }
  const gross = r2(Object.values(lines).reduce((a, v) => a + v, 0));
  const deductions = Object.values(credit);
  const net = r2(gross - deductions.reduce((a, x) => a + x.amount, 0));
  return { lines: Object.entries(lines).map(([code, amount]) => ({ code, amount, cls: code.startsWith('502') ? 'MOOE' : 'PS' })), deductions, gross, net };
}

// Remittances due once the payroll voucher is paid (agency → amount).
const REMIT = [
  ['GSIS', PAYROLL_CODES.dueGsis, 'Government Service Insurance System'],
  ['PhilHealth', PAYROLL_CODES.duePhilhealth, 'Philippine Health Insurance Corporation'],
  ['Pag-IBIG', PAYROLL_CODES.duePagibig, 'Home Development Mutual Fund (Pag-IBIG Fund)'],
  ['BIR', PAYROLL_CODES.dueBir, 'Bureau of Internal Revenue'],
];

export function registerPayrollFinanceRoutes(route, ctx, { data, save, findRun }) {
  // Finance acts for the payroll office; the permission to do so is checked on the People route.
  const asFinance = (user) => ({ ...user, role: 'admin' });
  const call = (user, method, path, body) => ctx.invoke(asFinance(user), method, path, body);
  const runName = (run) => (run.kind && run.kind !== 'regular' ? `${BONUS_KINDS[run.kind]?.name || run.kind} ${run.year}` : `salaries for ${run.periodStart} to ${run.periodEnd}`);
  const settingsFund = () => data().hrSettings.gov?.payrollFund || '01';

  // The payee card for a campus's payroll, and for each remittance agency (made once).
  // Paid by LDDAP-ADA: the payroll credits each employee's account per the General Payroll; an
  // agency is paid to its collection account per its remittance form.
  function cardFor(user, name, kind) {
    const found = data().finCards.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    return call(user, 'POST', '/api/finance/cards', {
      kind, name, vat: 'exempt', nature: 'none', bankName: 'Land Bank of the Philippines',
      bankAccount: kind === 'employee' ? "Each employee's account, per the General Payroll" : "Per the agency's remittance form",
      notes: 'Made by ATLAS People for payroll.',
    }).id;
  }
  const payrollPayee = (user, run) => cardFor(user, `Officials and employees, ${run.campusName || 'Main Campus'} (General Payroll)`, 'employee');

  function status(run) {
    const f = run.finance || {};
    const ors = f.orsId && data().finObligations.find((o) => o.id === f.orsId);
    const dv = f.dvId && data().finDvs.find((d) => d.id === f.dvId);
    const doc = (d, kind) => d && { id: d.id, no: d.no || '', status: d.status, submitted: Boolean(d.submitted), amount: kind === 'ors' ? d.amount : d.gross, form: d.form || 'DV', jevNo: d.journalId ? data().finJournals.find((j) => j.id === d.journalId)?.jevNo || '' : '' };
    return {
      ors: doc(ors, 'ors'),
      dv: doc(dv, 'dv'),
      remittances: (f.remittances || []).map((r) => ({ agency: r.agency, ...doc(data().finDvs.find((d) => d.id === r.dvId), 'dv') })).filter((r) => r.id),
    };
  }

  route('GET', '/api/hris/payroll-runs/:id/finance', 'hris:payroll.view', ({ params, campusId, user }) => {
    const run = findRun(params.id, campusId);
    if (run.system !== 'government') fail('Only government payroll goes to Finance.');
    const entry = payrollEntry(run);
    const fund = run.finance?.fund || settingsFund();
    const classes = [...new Set(entry.lines.map((l) => l.cls))];
    const allotments = classes.length ? call(user, 'GET', `/api/finance/allotments?fund=${fund}&fy=${run.payDate.slice(0, 4)}`).filter((a) => classes.includes(a.cls)).map((a) => ({ id: a.id, cls: a.cls, ref: a.ref || a.kind, pap: a.pap, papName: a.papName, balance: a.balance, fund: a.fund })) : [];
    const title = (code) => data().finAccounts?.find((x) => x.code === code)?.title || code;
    return {
      fund, allotments, ...status(run),
      entry: { ...entry, lines: entry.lines.map((l) => ({ ...l, title: title(l.code) })), deductions: entry.deductions.map((d) => ({ ...d, title: title(d.code) })) },
    };
  });

  // 1. The obligation request (Box A), submitted to the budget office.
  route('POST', '/api/hris/payroll-runs/:id/finance/ors', 'hris:payroll.edit', ({ params, body, campusId, user }) => {
    const run = findRun(params.id, campusId);
    if (run.system !== 'government') fail('Only government payroll goes to Finance.');
    if (run.status !== 'finalized') fail('Finalize the payroll run first.');
    const s = status(run);
    if (s.ors && s.ors.status !== 'cancelled') fail(`This run already has ${s.ors.form} ${s.ors.no || '(being obligated)'}.`);
    const entry = payrollEntry(run);
    if (!entry.gross) fail('Nothing to pay in this run.');
    const fund = String(body.fund || settingsFund());
    const pick = body.allotments || {};
    const lines = entry.lines.map((l) => ({ allotmentId: pick[l.cls] || fail(`Pick the ${l.cls} allotment to charge.`), code: l.code, amount: l.amount }));
    const ors = call(user, 'POST', '/api/finance/obligations', {
      fund, payeeId: payrollPayee(user, run), date: body.date || run.payDate, submit: true,
      particulars: `Payroll: ${runName(run)}, ${run.campusName || ''} (${run.payslips.filter((p) => p.grossPay).length} employees), per General Payroll ${run.id.slice(0, 8).toUpperCase()}`,
      requestedBy: { name: user.name, title: 'Payroll Officer' }, lines,
    });
    run.finance = { ...(run.finance || {}), fund, orsId: ors.id, dvId: null, remittances: [] };
    save();
    return status(run);
  });

  // 2. The payroll voucher (Box A), once the budget office has obligated the request.
  route('POST', '/api/hris/payroll-runs/:id/finance/dv', 'hris:payroll.edit', ({ params, body, campusId, user }) => {
    const run = findRun(params.id, campusId);
    const s = status(run);
    if (!s.ors) fail('Prepare the obligation request first.');
    if (s.ors.status !== 'obligated') fail(`${s.ors.form} is not obligated yet (Box B, budget office).`);
    if (s.dv && s.dv.status !== 'cancelled') fail(`This run already has a voucher${s.dv.no ? ` (DV ${s.dv.no})` : ''}.`);
    const entry = payrollEntry(run);
    const ors = data().finObligations.find((o) => o.id === run.finance.orsId);
    const dv = call(user, 'POST', '/api/finance/dvs', {
      fund: ors.fund, payeeId: ors.payeeId, orsId: ors.id, kind: 'payment', nature: 'none', gross: entry.gross,
      mode: ['check', 'ada', 'bank'].includes(body.mode) ? body.mode : 'ada', date: body.date || run.payDate, submit: true,
      particulars: `Payment of ${runName(run)}, ${run.campusName || ''}, per General Payroll ${run.id.slice(0, 8).toUpperCase()}: net pay ₱${entry.net.toLocaleString('en-PH', { minimumFractionDigits: 2 })} credited to the employees' accounts.`,
      deductions: entry.deductions, boxA: { name: user.name, title: 'Payroll Officer' },
    });
    if (Math.abs(dv.net - entry.net) > 0.01) fail('The voucher does not match the payroll net pay.');
    run.finance.dvId = dv.id;
    save();
    return status(run);
  });

  // 3. Remittance vouchers for GSIS, PhilHealth, Pag-IBIG and BIR, once the payroll is paid.
  route('POST', '/api/hris/payroll-runs/:id/finance/remittances', 'hris:payroll.edit', ({ params, campusId, user }) => {
    const run = findRun(params.id, campusId);
    const s = status(run);
    if (s.dv?.status !== 'paid') fail('The payroll voucher has to be paid first.');
    const entry = payrollEntry(run);
    const done = new Set(s.remittances.filter((r) => r.status !== 'cancelled').map((r) => r.agency));
    const fund = run.finance.fund;
    for (const [agency, code, name] of REMIT) {
      if (done.has(agency)) continue;
      const amount = r2(entry.deductions.filter((d) => d.code === code).reduce((a, d) => a + d.amount, 0));
      if (!amount) continue;
      const dv = call(user, 'POST', '/api/finance/dvs', {
        fund, payeeId: cardFor(user, name, 'agency'), kind: 'payment', nature: 'none', gross: amount, mode: 'ada', date: ctx.today(), submit: true,
        debits: [{ code, amount }], particulars: `Remittance to ${agency} of ${runName(run)}, ${run.campusName || ''} (General Payroll ${run.id.slice(0, 8).toUpperCase()}).`,
        boxA: { name: user.name, title: 'Payroll Officer' },
      });
      run.finance.remittances = [...(run.finance.remittances || []).filter((r) => r.agency !== agency), { agency, dvId: dv.id }];
    }
    save();
    return status(run);
  });

  return { status, payrollEntry };
}
