// Year-to-date payroll ledger: one row per employee per finalized payroll run, plus opening
// balances (pay earlier in the year from a previous employer, or before CORE was used). The 13th
// month pay, year-end tax annualization, BIR 2316 and the alphalist are built from these totals.
// Rows are written when a run is finalized and never edited; voiding a run marks its rows voided.
import { randomUUID } from 'node:crypto';
import { HttpError } from './util.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Amounts kept per row, in the order the Year to date page shows them.
export const LEDGER_FIELDS = [
  'basicPay', 'overtimePay', 'restDayPay', 'holidayPay', 'nightDiffPay', 'otherEarnings', 'grossPay', 'nonTaxable', 'taxableIncome',
  'sss', 'philhealth', 'pagibig', 'withholdingTax', 'otherDeductions', 'netPay', 'erSss', 'erPhilhealth', 'erPagibig',
];
export const OPENING_SOURCES = { 'before-core': 'LTDC, before CORE', 'previous-employer': 'Previous employer (BIR 2316)' };

function rowFrom(run, p) {
  const e = p.earnings;
  return {
    id: randomUUID(), kind: 'payroll', runId: run.id, employeeId: p.employeeId, year: Number(run.payDate.slice(0, 4)),
    payDate: run.payDate, periodStart: run.periodStart, periodEnd: run.periodEnd,
    basicPay: e.basicPay, overtimePay: e.overtimePay, restDayPay: e.restDayPay, holidayPay: e.holidayPay || 0, nightDiffPay: e.nightDiffPay || 0,
    otherEarnings: e.otherEarnings, grossPay: p.grossPay, nonTaxable: p.allowance, taxableIncome: p.taxableIncome,
    sss: p.deductions.sss, philhealth: p.deductions.philhealth, pagibig: p.deductions.pagibig, withholdingTax: p.deductions.withholdingTax,
    otherDeductions: p.deductions.otherDeductions, netPay: p.netPay,
    erSss: round2(p.employerShare.sss + p.employerShare.sssEc), erPhilhealth: p.employerShare.philhealth, erPagibig: p.employerShare.pagibig,
    postedAt: new Date().toISOString(),
  };
}

// Posts every finalized run that has no rows yet (runs finalized before 0.11, demo runs, restores).
export function syncLedger(db) {
  db.data.payrollLedger ||= [];
  const posted = new Set(db.data.payrollLedger.filter((r) => r.runId).map((r) => r.runId));
  let changed = false;
  for (const run of db.data.payrollRuns) {
    if (run.status !== 'finalized' && run.status !== 'voided') continue;
    if (posted.has(run.id)) continue;
    const rows = run.payslips.map((p) => ({ ...rowFrom(run, p), ...(run.status === 'voided' ? { voided: true, voidedAt: run.voidedAt } : {}) }));
    db.data.payrollLedger.push(...rows);
    changed = true;
  }
  return changed;
}

export function postRun(db, run) {
  db.data.payrollLedger ||= [];
  db.data.payrollLedger = db.data.payrollLedger.filter((r) => r.runId !== run.id);
  db.data.payrollLedger.push(...run.payslips.map((p) => rowFrom(run, p)));
}

export function voidRunRows(db, run, at) {
  for (const r of db.data.payrollLedger || []) if (r.runId === run.id) Object.assign(r, { voided: true, voidedAt: at });
}

// Totals per employee for a year. thirteenthBasis = basic pay earned at LTDC (13th month = 1/12 of it).
export function yearTotals(db, year, employeeId = null) {
  const rows = (db.data.payrollLedger || []).filter((r) => r.year === Number(year) && !r.voided && (!employeeId || r.employeeId === employeeId));
  const by = new Map();
  for (const r of rows) {
    const t = by.get(r.employeeId) || { employeeId: r.employeeId, runs: 0, openings: 0, thirteenthBasis: 0, ...Object.fromEntries(LEDGER_FIELDS.map((f) => [f, 0])) };
    for (const f of LEDGER_FIELDS) t[f] = round2(t[f] + (Number(r[f]) || 0));
    if (r.kind === 'payroll') t.runs += 1;
    else t.openings += 1;
    if (r.kind === 'payroll' || r.source === 'before-core') t.thirteenthBasis = round2(t.thirteenthBasis + (Number(r.basicPay) || 0));
    by.set(r.employeeId, t);
  }
  return [...by.values()].map((t) => ({ ...t, thirteenthMonthSoFar: round2(t.thirteenthBasis / 12) }));
}

function validateOpening(db, body) {
  const employee = db.data.employees.find((e) => e.id === body.employeeId);
  if (!employee) throw new HttpError(400, 'Pick the employee.');
  const year = Number(body.year);
  if (!(year >= 2000 && year <= 2100)) throw new HttpError(400, 'Pick the year.');
  const source = OPENING_SOURCES[body.source] ? body.source : null;
  if (!source) throw new HttpError(400, 'Say where the amounts come from: earlier at LTDC or a previous employer.');
  const asOf = DATE_RE.test(body.asOf || '') ? body.asOf : `${year}-01-01`;
  if (!asOf.startsWith(String(year))) throw new HttpError(400, 'The "as of" date must be in the same year.');
  const amounts = {};
  for (const f of LEDGER_FIELDS) {
    const n = body[f] === '' || body[f] == null ? 0 : Number(body[f]);
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'Amounts must be zero or more.');
    amounts[f] = round2(n);
  }
  if (!amounts.grossPay) throw new HttpError(400, 'Enter at least the gross pay.');
  // A previous employer's basic pay does not count toward LTDC's 13th month pay.
  const note = String(body.note || '').trim().slice(0, 300);
  if (!note) throw new HttpError(400, 'Add a note, e.g. "BIR 2316 from ABC Corp., Jan–Mar".');
  return { employee, row: { kind: 'opening', source, employeeId: employee.id, year, payDate: asOf, ...amounts, note } };
}

export function registerLedgerRoutes(route, db, { audit }) {
  const name = (id) => {
    const e = db.data.employees.find((x) => x.id === id);
    return e ? `${e.firstName} ${e.lastName}` : 'Former employee';
  };
  route('GET', '/api/payroll-ledger', 'payroll.view', ({ query }) => {
    const year = Number(query.year) || new Date().getFullYear();
    const totals = yearTotals(db, year).map((t) => {
      const e = db.data.employees.find((x) => x.id === t.employeeId);
      return { ...t, employeeNo: e?.employeeNo || '', name: e ? `${e.lastName}, ${e.firstName}` : 'Former employee', department: e?.department || '' };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const openings = (db.data.payrollLedger || []).filter((r) => r.kind === 'opening' && r.year === year && !r.voided).map((r) => ({ ...r, name: name(r.employeeId) }));
    const years = [...new Set([year, new Date().getFullYear(), ...(db.data.payrollLedger || []).map((r) => r.year)])].sort();
    return { year, years, totals, openings, fields: LEDGER_FIELDS, sources: OPENING_SOURCES };
  });
  route('GET', '/api/employees/:id/ytd', 'payroll.view', ({ params, query }) => {
    const year = Number(query.year) || new Date().getFullYear();
    return { year, totals: yearTotals(db, year, params.id)[0] || null };
  });
  route('POST', '/api/payroll-ledger/openings', 'payroll.edit', ({ body, user }) => {
    const { employee, row } = validateOpening(db, body);
    const r = { id: randomUUID(), ...row, postedAt: new Date().toISOString(), postedBy: user.name };
    db.data.payrollLedger.push(r);
    db.save();
    audit.record('payroll.opening.add', { entity: 'employee', entityId: employee.id, label: `${employee.firstName} ${employee.lastName}`, note: `${r.year} opening balance (${OPENING_SOURCES[r.source]}): gross ${r.grossPay}, tax withheld ${r.withholdingTax}. ${r.note}` });
    return r;
  });
  route('DELETE', '/api/payroll-ledger/openings/:id', 'payroll.edit', ({ params, body, query }) => {
    const r = (db.data.payrollLedger || []).find((x) => x.id === params.id && x.kind === 'opening' && !x.voided);
    if (!r) throw new HttpError(404, 'Opening balance not found.');
    const reason = String(body?.reason || query.reason || '').trim().slice(0, 300);
    r.voided = true;
    r.voidedAt = new Date().toISOString();
    db.save();
    audit.record('payroll.opening.remove', { entity: 'employee', entityId: r.employeeId, label: name(r.employeeId), note: `${r.year} opening balance removed (gross ${r.grossPay})${reason ? `: ${reason}` : ''}` });
    return { ok: true };
  });
}
