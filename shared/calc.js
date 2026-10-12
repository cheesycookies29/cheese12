// Time and payroll calculations. Shared by the server (payroll runs) and the
// browser (DTR display), so this file must stay free of Node/DOM APIs.

export const DEFAULT_SETTINGS = {
  companyName: 'My Company Inc.',
  companyAddress: '',
  companyTin: '',
  payFrequency: 'semi-monthly', // 'semi-monthly' | 'monthly'
  workDaysPerYear: 261, // 5-day work week; use 313 for a 6-day week
  gracePeriodMinutes: 0,
  minimumOvertimeMinutes: 30, // shorter overtime on regular days is ignored
  overtimeMultiplier: 1.25,
  restDayMultiplier: 1.3,
  schedule: { shiftStart: '09:00', shiftEnd: '18:00', breakMinutes: 60, workDays: [1, 2, 3, 4, 5] },
  contributions: { sss: true, philhealth: true, pagibig: true, withholdingTax: true },
};

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------- Dates & times ----------

export function toMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function parseDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export function dayOfWeek(ymd) {
  return parseDate(ymd).getUTCDay();
}

export function eachDate(start, end) {
  const out = [];
  for (let d = parseDate(start); d <= parseDate(end); d = new Date(d.getTime() + 86400000)) {
    out.push(formatDate(d));
  }
  return out;
}

// Suggested pay period that contains `today` (YYYY-MM-DD).
export function currentPeriod(today, frequency) {
  const [y, m, d] = today.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ym = `${y}-${pad(m)}`;
  if (frequency === 'monthly') return { start: `${ym}-01`, end: `${ym}-${pad(lastDay)}` };
  return d <= 15
    ? { start: `${ym}-01`, end: `${ym}-15` }
    : { start: `${ym}-16`, end: `${ym}-${pad(lastDay)}` };
}

// ---------- Schedules & rates ----------

export function scheduleFor(employee, settings) {
  return { ...settings.schedule, ...(employee.schedule || {}) };
}

export function hoursPerDay(schedule) {
  let span = toMinutes(schedule.shiftEnd) - toMinutes(schedule.shiftStart);
  if (span <= 0) span += 1440;
  const hours = (span - (Number(schedule.breakMinutes) || 0)) / 60;
  return hours > 0 ? hours : 8;
}

export function ratesFor(employee, settings) {
  const schedule = scheduleFor(employee, settings);
  const rate = Number(employee.rate) || 0;
  const factor = Number(settings.workDaysPerYear) || 261;
  const daily = employee.payType === 'daily' ? rate : (rate * 12) / factor;
  const monthly = employee.payType === 'daily' ? (rate * factor) / 12 : rate;
  return { monthly, daily, hourly: daily / hoursPerDay(schedule) };
}

// Late / undertime / overtime for a single DTR entry.
export function computeEntry(entry, schedule, settings) {
  const r = { workedMinutes: 0, lateMinutes: 0, undertimeMinutes: 0, overtimeMinutes: 0, restDay: false, leave: false, open: false };
  if (entry.type === 'leave') return { ...r, leave: true };
  if (!entry.timeOut) return { ...r, open: true };

  const inM = toMinutes(entry.timeIn);
  let outM = toMinutes(entry.timeOut);
  if (outM <= inM) outM += 1440; // crossed midnight
  const span = outM - inM;
  const breakMinutes = span > 300 ? Number(schedule.breakMinutes) || 0 : 0; // no break deducted for short days
  r.workedMinutes = Math.max(0, span - breakMinutes);

  if (!schedule.workDays.includes(dayOfWeek(entry.date))) {
    r.restDay = true;
    r.overtimeMinutes = r.workedMinutes;
    return r;
  }

  const start = toMinutes(schedule.shiftStart);
  let end = toMinutes(schedule.shiftEnd);
  if (end <= start) end += 1440;
  const late = inM - start;
  r.lateMinutes = late > (Number(settings.gracePeriodMinutes) || 0) ? late : 0;
  r.undertimeMinutes = Math.max(0, end - outM);
  const overtime = Math.max(0, outM - Math.max(end, inM));
  r.overtimeMinutes = overtime >= (Number(settings.minimumOvertimeMinutes) || 0) ? overtime : 0;
  return r;
}

// ---------- Government contributions (employee + employer shares, monthly) ----------

// SSS 2025 schedule: 15% of Monthly Salary Credit (EE 5%, ER 10%), MSC 5,000 to 35,000.
export function sssContribution(monthlyCompensation) {
  let msc;
  if (monthlyCompensation < 5250) msc = 5000;
  else if (monthlyCompensation >= 34750) msc = 35000;
  else msc = 5500 + Math.floor((monthlyCompensation - 5250) / 500) * 500;
  return { msc, ee: round2(msc * 0.05), er: round2(msc * 0.1), ec: msc < 15000 ? 10 : 30 };
}

// PhilHealth 2024-2025: 5% of monthly basic salary (floor 10,000, ceiling 100,000), split equally.
export function philhealthContribution(monthlyBasic) {
  const base = Math.min(Math.max(monthlyBasic, 10000), 100000);
  const half = round2((base * 0.05) / 2);
  return { ee: half, er: half };
}

// Pag-IBIG (HDMF) from Feb 2024: max fund salary 10,000; EE 1% (<= 1,500) or 2%, ER 2%.
export function pagibigContribution(monthlyBasic) {
  const base = Math.min(monthlyBasic, 10000);
  return { ee: round2(base * (monthlyBasic <= 1500 ? 0.01 : 0.02)), er: round2(base * 0.02) };
}

// BIR withholding tax tables (TRAIN law, effective Jan 1, 2023).
const TAX_TABLES = {
  'semi-monthly': [
    { over: 0, base: 0, rate: 0 },
    { over: 10417, base: 0, rate: 0.15 },
    { over: 16667, base: 937.5, rate: 0.2 },
    { over: 33333, base: 4270.7, rate: 0.25 },
    { over: 83333, base: 16770.7, rate: 0.3 },
    { over: 333333, base: 91770.7, rate: 0.35 },
  ],
  monthly: [
    { over: 0, base: 0, rate: 0 },
    { over: 20833, base: 0, rate: 0.15 },
    { over: 33333, base: 1875, rate: 0.2 },
    { over: 66667, base: 8541.8, rate: 0.25 },
    { over: 166667, base: 33541.8, rate: 0.3 },
    { over: 666667, base: 183541.8, rate: 0.35 },
  ],
};

export function withholdingTax(taxableIncome, frequency) {
  const table = TAX_TABLES[frequency] || TAX_TABLES['semi-monthly'];
  if (taxableIncome <= 0) return 0;
  const bracket = [...table].reverse().find((b) => taxableIncome > b.over) || table[0];
  return round2(bracket.base + (taxableIncome - bracket.over) * bracket.rate);
}

// ---------- Payslip ----------

export function computePayslip({ employee, entries, periodStart, periodEnd, settings, adjustments = {} }) {
  const schedule = scheduleFor(employee, settings);
  const rates = ratesFor(employee, settings);
  const frequency = settings.payFrequency;
  const divisor = frequency === 'monthly' ? 1 : 2;

  const inPeriod = entries.filter((e) => e.employeeId === employee.id && e.date >= periodStart && e.date <= periodEnd);
  const byDate = new Map(inPeriod.map((e) => [e.date, e]));

  const att = { scheduledDays: 0, daysPresent: 0, leaveDays: 0, absentDays: 0, lateMinutes: 0, undertimeMinutes: 0, overtimeMinutes: 0, restDayMinutes: 0, openEntries: 0, unapprovedOvertimeMinutes: 0 };

  for (const e of inPeriod) {
    const c = computeEntry(e, schedule, settings);
    if (c.open) att.openEntries += 1;
    if (c.restDay) {
      if (e.otApproved) att.restDayMinutes += c.overtimeMinutes;
      else att.unapprovedOvertimeMinutes += c.overtimeMinutes;
      continue;
    }
    att.lateMinutes += c.lateMinutes;
    att.undertimeMinutes += c.undertimeMinutes;
    if (e.otApproved) att.overtimeMinutes += c.overtimeMinutes;
    else att.unapprovedOvertimeMinutes += c.overtimeMinutes;
  }

  const hireDate = employee.hireDate || periodStart;
  for (const date of eachDate(periodStart, periodEnd)) {
    if (date < hireDate || !schedule.workDays.includes(dayOfWeek(date))) continue;
    att.scheduledDays += 1;
    const e = byDate.get(date);
    if (!e) att.absentDays += 1;
    else if (e.type === 'leave') att.leaveDays += 1;
    else att.daysPresent += 1;
  }

  // Monthly-rated employees get a fixed amount per period, less absences.
  // Daily-rated employees (and monthly-rated hires that started mid-period) are paid per day.
  const paidPerDay = employee.payType === 'daily' || hireDate > periodStart;
  const basePay = paidPerDay ? (att.daysPresent + att.leaveDays) * rates.daily : rates.monthly / divisor;
  const absenceDeduction = paidPerDay ? 0 : att.absentDays * rates.daily;
  const tardinessDeduction = ((att.lateMinutes + att.undertimeMinutes) / 60) * rates.hourly;
  const basicPay = Math.max(0, basePay - absenceDeduction - tardinessDeduction);

  const overtimePay = (att.overtimeMinutes / 60) * rates.hourly * Number(settings.overtimeMultiplier || 1.25);
  const restDayPay = (att.restDayMinutes / 60) * rates.hourly * Number(settings.restDayMultiplier || 1.3);
  const otherEarnings = Number(adjustments.otherEarnings) || 0;
  const otherDeductions = Number(adjustments.otherDeductions) || 0;
  const allowance = (Number(employee.allowance) || 0) / divisor; // de minimis, non-taxable

  const grossPay = round2(basicPay + overtimePay + restDayPay + otherEarnings);

  const c = settings.contributions;
  const sss = c.sss ? sssContribution(rates.monthly) : { ee: 0, er: 0, ec: 0 };
  const ph = c.philhealth ? philhealthContribution(rates.monthly) : { ee: 0, er: 0 };
  const hdmf = c.pagibig ? pagibigContribution(rates.monthly) : { ee: 0, er: 0 };
  const deductions = {
    sss: round2(sss.ee / divisor),
    philhealth: round2(ph.ee / divisor),
    pagibig: round2(hdmf.ee / divisor),
    withholdingTax: 0,
    otherDeductions: round2(otherDeductions),
  };
  const taxableIncome = round2(Math.max(0, grossPay - deductions.sss - deductions.philhealth - deductions.pagibig));
  if (c.withholdingTax && !employee.minimumWageEarner) deductions.withholdingTax = withholdingTax(taxableIncome, frequency);

  const totalDeductions = round2(Object.values(deductions).reduce((a, b) => a + b, 0));

  return {
    employeeId: employee.id,
    employee: {
      employeeNo: employee.employeeNo,
      name: `${employee.lastName}, ${employee.firstName}${employee.middleName ? ' ' + employee.middleName[0] + '.' : ''}`,
      position: employee.position || '',
      department: employee.department || '',
      tin: employee.tin || '',
      sssNo: employee.sssNo || '',
      philhealthNo: employee.philhealthNo || '',
      pagibigNo: employee.pagibigNo || '',
      bankName: employee.bankName || '',
      bankAccount: employee.bankAccount || '',
      payType: employee.payType,
      rate: Number(employee.rate) || 0,
    },
    rates: { monthly: round2(rates.monthly), daily: round2(rates.daily), hourly: round2(rates.hourly) },
    attendance: att,
    earnings: {
      basePay: round2(basePay),
      absenceDeduction: round2(absenceDeduction),
      tardinessDeduction: round2(tardinessDeduction),
      basicPay: round2(basicPay),
      overtimePay: round2(overtimePay),
      restDayPay: round2(restDayPay),
      otherEarnings: round2(otherEarnings),
    },
    allowance: round2(allowance),
    grossPay,
    taxableIncome,
    deductions,
    totalDeductions,
    employerShare: { sss: round2(sss.er / divisor), sssEc: round2(sss.ec / divisor), philhealth: round2(ph.er / divisor), pagibig: round2(hdmf.er / divisor) },
    netPay: round2(grossPay + allowance - totalDeductions),
    adjustments: { otherEarnings, otherDeductions, remarks: adjustments.remarks || '' },
  };
}
