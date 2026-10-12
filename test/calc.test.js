import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, sssContribution, philhealthContribution, pagibigContribution, withholdingTax,
  computeEntry, computePayslip, currentPeriod,
} from '../shared/calc.js';

const settings = structuredClone(DEFAULT_SETTINGS);
const schedule = settings.schedule;

test('SSS contribution brackets', () => {
  assert.deepEqual(sssContribution(4000), { msc: 5000, ee: 250, er: 500, ec: 10 });
  assert.equal(sssContribution(20000).msc, 20000);
  assert.equal(sssContribution(20249).msc, 20000);
  assert.equal(sssContribution(20250).msc, 20500);
  assert.deepEqual(sssContribution(100000), { msc: 35000, ee: 1750, er: 3500, ec: 30 });
});

test('PhilHealth floor and ceiling', () => {
  assert.deepEqual(philhealthContribution(8000), { ee: 250, er: 250 });
  assert.deepEqual(philhealthContribution(30000), { ee: 750, er: 750 });
  assert.deepEqual(philhealthContribution(150000), { ee: 2500, er: 2500 });
});

test('Pag-IBIG cap', () => {
  assert.deepEqual(pagibigContribution(1500), { ee: 15, er: 30 });
  assert.deepEqual(pagibigContribution(30000), { ee: 200, er: 200 });
});

test('withholding tax tables', () => {
  assert.equal(withholdingTax(10000, 'semi-monthly'), 0);
  assert.equal(withholdingTax(20000, 'semi-monthly'), 1604.1); // 937.50 + 20% of 3,333
  assert.equal(withholdingTax(20833, 'monthly'), 0);
  assert.equal(withholdingTax(40000, 'monthly'), 3208.4); // 1,875 + 20% of 6,667
});

test('computeEntry: late, undertime, overtime', () => {
  const mon = '2026-10-05';
  assert.deepEqual(
    computeEntry({ date: mon, type: 'work', timeIn: '09:15', timeOut: '17:30' }, schedule, settings),
    { workedMinutes: 435, lateMinutes: 15, undertimeMinutes: 30, overtimeMinutes: 0, restDay: false, leave: false, open: false },
  );
  const ot = computeEntry({ date: mon, type: 'work', timeIn: '08:55', timeOut: '20:00' }, schedule, settings);
  assert.equal(ot.lateMinutes, 0);
  assert.equal(ot.overtimeMinutes, 120);
  const short = computeEntry({ date: mon, type: 'work', timeIn: '09:00', timeOut: '18:20' }, schedule, settings);
  assert.equal(short.overtimeMinutes, 0); // below 30-minute minimum
  const sat = computeEntry({ date: '2026-10-10', type: 'work', timeIn: '09:00', timeOut: '13:00' }, schedule, settings);
  assert.equal(sat.restDay, true);
  assert.equal(sat.overtimeMinutes, 240);
  assert.equal(computeEntry({ date: mon, type: 'work', timeIn: '09:00' }, schedule, settings).open, true);
});

test('currentPeriod', () => {
  assert.deepEqual(currentPeriod('2026-02-20', 'semi-monthly'), { start: '2026-02-16', end: '2026-02-28' });
  assert.deepEqual(currentPeriod('2026-10-03', 'semi-monthly'), { start: '2026-10-01', end: '2026-10-15' });
  assert.deepEqual(currentPeriod('2026-10-03', 'monthly'), { start: '2026-10-01', end: '2026-10-31' });
});

const employee = { id: 'e1', employeeNo: 'EMP-1', firstName: 'Juan', lastName: 'Cruz', payType: 'monthly', rate: 30000, allowance: 2000, hireDate: '2020-01-01' };

function fullAttendance(start, end, extra = {}) {
  const out = [];
  for (let d = new Date(start + 'T00:00Z'); d <= new Date(end + 'T00:00Z'); d = new Date(+d + 86400000)) {
    const date = d.toISOString().slice(0, 10);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    out.push({ id: date, employeeId: 'e1', date, type: 'work', timeIn: '09:00', timeOut: '18:00', ...(extra[date] || {}) });
  }
  return out;
}

test('payslip: monthly employee with perfect attendance', () => {
  const entries = fullAttendance('2026-10-01', '2026-10-15');
  const p = computePayslip({ employee, entries, periodStart: '2026-10-01', periodEnd: '2026-10-15', settings });
  assert.equal(p.attendance.scheduledDays, 11);
  assert.equal(p.attendance.absentDays, 0);
  assert.equal(p.earnings.basicPay, 15000);
  assert.equal(p.grossPay, 15000);
  assert.equal(p.deductions.sss, 750); // 1,500 / 2
  assert.equal(p.deductions.philhealth, 375);
  assert.equal(p.deductions.pagibig, 100);
  // taxable 13,775 → 15% over 10,417
  assert.equal(p.deductions.withholdingTax, 503.7);
  assert.equal(p.allowance, 1000);
  assert.equal(p.netPay, round(15000 + 1000 - 750 - 375 - 100 - 503.7));
});

test('payslip: absences, tardiness and approved overtime', () => {
  const entries = fullAttendance('2026-10-01', '2026-10-15', {
    '2026-10-05': { timeIn: '09:30' },
    '2026-10-06': { timeOut: '20:00', otApproved: true },
    '2026-10-07': { timeOut: '20:00' }, // not approved
  }).filter((e) => e.date !== '2026-10-08');
  const p = computePayslip({ employee, entries, periodStart: '2026-10-01', periodEnd: '2026-10-15', settings });
  const daily = (30000 * 12) / 261;
  const hourly = daily / 8;
  assert.equal(p.attendance.absentDays, 1);
  assert.equal(p.attendance.lateMinutes, 30);
  assert.equal(p.attendance.overtimeMinutes, 120);
  assert.equal(p.attendance.unapprovedOvertimeMinutes, 120);
  assert.equal(p.earnings.basicPay, round(15000 - daily - hourly / 2));
  assert.equal(p.earnings.overtimePay, round(2 * hourly * 1.25));
});

test('payslip: daily-rated minimum wage earner pays no tax', () => {
  const daily = { ...employee, payType: 'daily', rate: 695, allowance: 0, minimumWageEarner: true };
  const entries = fullAttendance('2026-10-01', '2026-10-15');
  const p = computePayslip({ employee: daily, entries, periodStart: '2026-10-01', periodEnd: '2026-10-15', settings });
  assert.equal(p.earnings.basicPay, 695 * 11);
  assert.equal(p.deductions.withholdingTax, 0);
});

test('payslip: mid-period hire is paid per day worked', () => {
  const hire = { ...employee, hireDate: '2026-10-12' };
  const entries = fullAttendance('2026-10-12', '2026-10-15');
  const p = computePayslip({ employee: hire, entries, periodStart: '2026-10-01', periodEnd: '2026-10-15', settings });
  assert.equal(p.attendance.scheduledDays, 4);
  assert.equal(p.earnings.basicPay, round(((30000 * 12) / 261) * 4));
});

function round(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
