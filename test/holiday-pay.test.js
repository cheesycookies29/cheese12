// Holiday, rest-day and night-shift pay (0.10): the premium matrix, unworked holidays and the
// "present the day before" rule, night differential, the daily-rate factor, the holiday calendar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, DEFAULT_PREMIUMS, computeEntry, computePayslip, ratesFor, suggestedFactor } from '../shared/calc.js';
import { dayTypeFor, presetHolidays } from '../shared/holidays.js';
import { workDates } from '../shared/leave.js';
import { mergeSettings, openDb } from '../server/db.js';
import { createApi } from '../server/api.js';

const settings = structuredClone(DEFAULT_SETTINGS);
const H2026 = presetHolidays(2026);
const emp = { id: 'e1', employeeNo: 'E-1', firstName: 'Ana', lastName: 'Cruz', payType: 'monthly', rate: 26100, hireDate: '2020-01-01', schedule: settings.schedule };
const r2 = (n) => Math.round(n * 100) / 100;
const { daily, hourly } = ratesFor(emp, settings); // 26,100 × 12 / 312 = 1,003.85 a day
const work = (date, timeIn = '09:00', timeOut = '18:00', extra = {}) => ({ id: date, employeeId: 'e1', date, type: 'work', timeIn, timeOut, otApproved: false, ...extra });
// Present on every Monday-to-Friday that is not a day off, between two dates.
function present(start, end, holidays = H2026, extra = {}) {
  return workDates(emp, settings, start, end, holidays).map((d) => ({ ...work(d), ...(extra[d] || {}) }));
}
const slip = (entries, start, end, opts = {}) => computePayslip({ employee: opts.employee || emp, entries, periodStart: start, periodEnd: end, settings: opts.settings || settings, holidays: opts.holidays ?? H2026 });
const line = (p, dayType, part) => p.earnings.lines.find((l) => l.dayType === dayType && l.part === part);

test('day types: holidays on work days and rest days, double holidays', () => {
  const reg = { type: 'regular' };
  const spec = { type: 'special' };
  assert.equal(dayTypeFor([], true), 'ordinary');
  assert.equal(dayTypeFor([], false), 'rest');
  assert.equal(dayTypeFor([spec], true), 'special');
  assert.equal(dayTypeFor([spec], false), 'specialRest');
  assert.equal(dayTypeFor([reg], true), 'regular');
  assert.equal(dayTypeFor([reg], false), 'regularRest');
  assert.equal(dayTypeFor([reg, reg], true), 'double');
  assert.equal(dayTypeFor([reg, spec], true), 'regular', 'a regular holiday wins over a special day');
});

test('premium matrix: every cell, 8 hours plus 2 hours of approved overtime', () => {
  // 09:00 to 20:00 with a 1-hour break: 8 regular hours and 2 hours past the 6 PM shift end.
  const cases = [
    // [date, holidays on it, day type] — 2026-10-05 is a Monday, 2026-10-10 a Saturday.
    ['2026-10-05', [], 'ordinary'],
    ['2026-10-10', [], 'rest'],
    ['2026-10-05', [{ date: '2026-10-05', name: 'S', type: 'special' }], 'special'],
    ['2026-10-10', [{ date: '2026-10-10', name: 'S', type: 'special' }], 'specialRest'],
    ['2026-10-05', [{ date: '2026-10-05', name: 'R', type: 'regular' }], 'regular'],
    ['2026-10-10', [{ date: '2026-10-10', name: 'R', type: 'regular' }], 'regularRest'],
    ['2026-10-05', [{ date: '2026-10-05', name: 'R1', type: 'regular' }, { date: '2026-10-05', name: 'R2', type: 'regular' }], 'double'],
    ['2026-10-10', [{ date: '2026-10-10', name: 'R1', type: 'regular' }, { date: '2026-10-10', name: 'R2', type: 'regular' }], 'doubleRest'],
  ];
  for (const [date, holidays, dayType] of cases) {
    const e = work(date, '09:00', '20:00', { otApproved: true });
    const c = computeEntry(e, settings.schedule, settings, holidays);
    assert.equal(c.dayType, dayType);
    assert.equal(c.regularMinutes, 480, dayType);
    const p = slip([e], date, date, { holidays });
    const m = DEFAULT_PREMIUMS[dayType];
    const restDay = dayType === 'rest' || dayType.endsWith('Rest');
    // On a work day the basic pay already covers 100% of the day; only the premium is added.
    const day = line(p, dayType, 'day');
    if (dayType === 'ordinary') assert.equal(day, undefined);
    else assert.equal(day.amount, r2(8 * hourly * (restDay ? m.day : m.day - 1)), `${dayType} day`);
    assert.equal(line(p, dayType, 'overtime').amount, r2(2 * hourly * m.overtime), `${dayType} overtime`);
  }
  assert.deepEqual(
    Object.fromEntries(Object.entries(DEFAULT_PREMIUMS).map(([k, v]) => [k, [v.day, v.overtime]])),
    { ordinary: [1, 1.25], rest: [1.3, 1.69], special: [1.3, 1.69], specialRest: [1.5, 1.95], regular: [2, 2.6], regularRest: [2.6, 3.38], double: [3, 3.9], doubleRest: [3.9, 5.07] },
  );
});

test('working a holiday: no late or undertime, regular hours paid without overtime approval', () => {
  const xmas = work('2026-12-25', '10:00', '15:00'); // Friday, Christmas Day; came late, left early
  const c = computeEntry(xmas, settings.schedule, settings, H2026.filter((h) => h.date === '2026-12-25'));
  assert.deepEqual([c.dayType, c.lateMinutes, c.undertimeMinutes, c.regularMinutes], ['regular', 0, 0, 300]); // 5 hours, no break on a short day
  const p = slip([...present('2026-12-16', '2026-12-31'), xmas], '2026-12-16', '2026-12-31');
  assert.equal(line(p, 'regular', 'day').amount, r2(5 * hourly * 1));
  assert.equal(p.earnings.holidayPay, r2(5 * hourly));
  assert.equal(p.earnings.tardinessDeduction, 0);
});

test('unworked holidays: a monthly salary already pays them; absent the day before loses the regular holiday', () => {
  // Dec 16-31, 2026: Dec 24 and 31 are special days, Dec 25 and 30 regular holidays.
  const full = slip(present('2026-12-16', '2026-12-31'), '2026-12-16', '2026-12-31');
  assert.equal(full.attendance.holidayDays, 4);
  assert.equal(full.attendance.absentDays, 0);
  assert.equal(full.earnings.absenceDeduction, 0);
  assert.equal(full.earnings.basicPay, 13050);
  assert.deepEqual(full.attendance.holidays.map((h) => [h.date, h.paid]), [['2026-12-24', true], ['2026-12-25', true], ['2026-12-30', true], ['2026-12-31', true]]);

  // Absent on Wednesday Dec 23: Christmas Day (after the unworked Dec 24) is not paid.
  const absent = slip(present('2026-12-16', '2026-12-31').filter((e) => e.date !== '2026-12-23'), '2026-12-16', '2026-12-31');
  assert.equal(absent.attendance.absentDays, 1);
  assert.equal(absent.attendance.unpaidHolidayDays, 1);
  assert.equal(absent.earnings.absenceDeduction, r2(2 * daily));
  assert.equal(absent.attendance.holidays.find((h) => h.date === '2026-12-25').paid, false);
  // On paid leave instead: still paid.
  const leave = present('2026-12-16', '2026-12-31').map((e) => (e.date === '2026-12-23' ? { ...e, type: 'leave', paid: true, timeIn: null, timeOut: null } : e));
  assert.equal(slip(leave, '2026-12-16', '2026-12-31').attendance.unpaidHolidayDays, 0);
  // The rule can be switched off.
  const lenient = mergeSettings({ holidayPay: { requirePresentBefore: false } });
  assert.equal(slip(present('2026-12-16', '2026-12-31').filter((e) => e.date !== '2026-12-23'), '2026-12-16', '2026-12-31', { settings: lenient }).attendance.unpaidHolidayDays, 0);
});

test('special days not worked are paid by default; "no work, no pay" when the company says so', () => {
  const unpaid = mergeSettings({ holidayPay: { specialNotWorked: 'unpaid' } });
  const p = slip(present('2026-12-16', '2026-12-31'), '2026-12-16', '2026-12-31', { settings: unpaid });
  assert.equal(p.attendance.unpaidHolidayDays, 2); // Dec 24 and 31
  assert.equal(p.earnings.absenceDeduction, r2(2 * daily));
});

test('daily-paid staff are paid for unworked regular holidays (and paid special days)', () => {
  const dailyEmp = { ...emp, payType: 'daily', rate: 755 };
  const p = slip(present('2026-12-16', '2026-12-31'), '2026-12-16', '2026-12-31', { employee: dailyEmp });
  assert.equal(p.earnings.basePay, r2(8 * 755)); // 8 working days
  assert.equal(line(p, 'regular', 'unworked').days, 2);
  assert.equal(line(p, 'special', 'unworked').days, 2);
  assert.equal(p.earnings.holidayPay, 4 * 755);
  // A regular holiday on a Saturday (rest day) is still a day's pay for daily-paid staff.
  const sat = [{ date: '2026-10-10', name: 'R', type: 'regular' }];
  const q = slip(present('2026-10-05', '2026-10-11', sat), '2026-10-05', '2026-10-11', { employee: dailyEmp, holidays: sat });
  assert.equal(line(q, 'regularRest', 'unworked').days, 1);
});

test('the first holiday after go-live is paid when there is no attendance before it', () => {
  // CORE starts on Monday Jan 4, 2027: New Year's Day has no DTR before it.
  const h = presetHolidays(2027);
  const p = slip(present('2027-01-04', '2027-01-15', h), '2027-01-01', '2027-01-15', { holidays: h });
  assert.equal(p.attendance.holidays[0].paid, true);
  assert.equal(p.attendance.unpaidHolidayDays, 0);
  assert.equal(p.attendance.absentDays, 0);
});

test('night shift differential: 10% of the rate for each hour from 10 PM to 6 AM', () => {
  const night = { ...emp, schedule: { shiftStart: '22:00', shiftEnd: '07:00', breakMinutes: 60, workDays: [1, 2, 3, 4, 5] } };
  const sched = { ...night.schedule, flex: false };
  const e = work('2026-10-05', '22:00', '07:00');
  const c = computeEntry(e, sched, settings);
  assert.equal(c.regularMinutes, 480);
  assert.equal(c.lateMinutes + c.undertimeMinutes, 0);
  assert.equal(c.nightMinutes, 427); // 8 night hours less their share of the 1-hour break
  const p = slip([e], '2026-10-05', '2026-10-05', { employee: night });
  assert.equal(p.earnings.nightDiffPay, r2((427 / 60) * hourly * 0.1));
  // On a regular holiday the differential is 10% of the 200% rate.
  const hol = [{ date: '2026-10-05', name: 'R', type: 'regular' }];
  const q = slip([e], '2026-10-05', '2026-10-05', { employee: night, holidays: hol });
  assert.equal(line(q, 'regular', 'night').amount, r2((427 / 60) * hourly * 0.1 * 2));
  // Overtime that runs past 10 PM: 18:00 to 23:00 on a day shift, approved.
  const ot = computeEntry(work('2026-10-06', '09:00', '23:00'), settings.schedule, settings);
  assert.deepEqual([ot.overtimeMinutes, ot.nightMinutes, ot.nightOvertimeMinutes], [300, 0, 60]);
  const o = slip([work('2026-10-06', '09:00', '23:00', { otApproved: true })], '2026-10-06', '2026-10-06');
  assert.equal(line(o, 'ordinary', 'nightOvertime').amount, r2(1 * hourly * 0.1 * 1.25));
});

test('daily-rate factor: company default, the employee’s own, and the suggestion', () => {
  assert.equal(ratesFor(emp, settings).factor, 312);
  assert.equal(r2(ratesFor({ ...emp, workDaysPerYear: 261 }, settings).daily), r2((26100 * 12) / 261));
  assert.equal(suggestedFactor([1, 2, 3, 4, 5]), 261);
  assert.equal(suggestedFactor([1, 2, 3, 4, 5, 6]), 313);
});

test('settings saved before 0.10 keep their overtime and rest-day rates', () => {
  const s = mergeSettings({ overtimeMultiplier: 1.3, restDayMultiplier: 1.4 });
  assert.equal(s.premiums.ordinary.overtime, 1.3);
  assert.equal(s.premiums.rest.day, 1.4);
  assert.equal(s.premiums.regular.day, 2);
  assert.equal('overtimeMultiplier' in s, false);
});

test('holiday calendar API, leave days and payroll setup', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-holidays-')), 'db.json');
  const db = openDb(file);
  const handle = createApi(db);
  const client = () => {
    let cookie = '';
    return async (method, url, body = {}) => {
      const res = await handle({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
      if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
      return res.data;
    };
  };
  const admin = client();
  await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
  const list = await admin('GET', '/api/holidays?year=2027');
  assert.equal(list.length, 19);
  assert.equal(list[0].name, "New Year's Day");
  // Loading a year again adds nothing; deleting one and loading brings it back.
  assert.equal((await admin('POST', '/api/holidays/load', { year: 2027 })).added, 0);
  await admin('DELETE', `/api/holidays/${list[0].id}`);
  assert.equal((await admin('POST', '/api/holidays/load', { year: 2027 })).added, 1);
  await assert.rejects(admin('POST', '/api/holidays/load', { year: 2031 }), /no proclaimed list/);
  // Local holidays need a place; Eid'l Fitr is added by hand.
  await assert.rejects(admin('POST', '/api/holidays', { date: '2027-03-10', name: 'Eid', type: 'regular', scope: 'local' }), /where the local holiday applies/);
  const eid = await admin('POST', '/api/holidays', { date: '2027-03-10', name: "Eid'l Fitr", type: 'regular', basis: 'Proclamation (to follow)' });
  assert.equal(eid.scope, 'national');
  await assert.rejects(admin('POST', '/api/holidays', { date: '2027-03-10', name: "Eid'l Fitr", type: 'regular' }), /already on/);

  // Leave over Christmas counts only the work day.
  const e = await admin('POST', '/api/employees', { employeeNo: 'E-1', firstName: 'Ana', lastName: 'Cruz', hireDate: '2024-01-01', payType: 'monthly', rate: 30000, gender: 'Female', workDaysPerYear: 261 });
  assert.equal(e.workDaysPerYear, 261);
  await assert.rejects(admin('PUT', `/api/employees/${e.id}`, { ...e, workDaysPerYear: 100 }), /between 200 and 366/);
  await admin('POST', '/api/users', { name: 'ana', username: 'ana', role: 'employee', employeeId: e.id, password: 'secret123', mustChangePassword: false });
  const ana = client();
  await ana('POST', '/api/auth/login', { username: 'ana', password: 'secret123' });
  const req = await ana('POST', '/api/me/requests', { kind: 'leave', leaveTypeId: 'vl', startDate: '2026-12-24', endDate: '2026-12-28', reason: 'Holidays' });
  assert.deepEqual(req.breakdown.map((d) => d.date), ['2026-12-28']);
  await assert.rejects(ana('POST', '/api/me/requests', { kind: 'leave', leaveTypeId: 'vl', startDate: '2026-12-25', endDate: '2026-12-25' }), /Christmas Day \(regular holiday\)/);
  await assert.rejects(ana('POST', '/api/holidays', { date: '2027-03-10', name: 'X', type: 'special' }), /does not have access/);
  assert.ok((await ana('GET', '/api/holidays')).length >= 38, 'everyone can read the calendar');

  // Payroll setup: the premium matrix and night shift hours are validated.
  const s = await admin('GET', '/api/settings');
  await assert.rejects(admin('PUT', '/api/payroll-config', { ...s, premiums: { ...s.premiums, regular: { day: 0.5, overtime: 2.6 } } }), /Regular holiday: first 8 hours/);
  await assert.rejects(admin('PUT', '/api/payroll-config', { ...s, nightDiff: { rate: 0.1, start: '22:00', end: '22:00' } }), /night shift hours/);
  const saved = await admin('PUT', '/api/payroll-config', { ...s, premiums: { ...s.premiums, special: { day: 1.3, overtime: 1.69 } }, holidayPay: { specialNotWorked: 'unpaid' } });
  assert.equal(saved.holidayPay.specialNotWorked, 'unpaid');
  assert.equal(saved.holidayPay.requirePresentBefore, true);
});
