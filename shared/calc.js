// Time and payroll calculations. Shared by the server (payroll runs) and the
// browser (DTR display), so this file must stay free of Node/DOM APIs.

// Government rates as of 2025. Editable in Payroll Setup, so a new circular
// does not need a code change.
export const DEFAULT_RATES = {
  // SSS 2025 schedule: 15% of the Monthly Salary Credit (EE 5%, ER 10%), MSC 5,000 to 35,000 in 500 steps.
  sss: { eeRate: 0.05, erRate: 0.1, minMsc: 5000, maxMsc: 35000, mscStep: 500, ecLow: 10, ecHigh: 30, ecThreshold: 15000 },
  // PhilHealth 2024-2025: 5% of monthly basic salary (floor 10,000, ceiling 100,000), split equally.
  philhealth: { rate: 0.05, floor: 10000, ceiling: 100000 },
  // Pag-IBIG (HDMF) from Feb 2024: fund salary capped at 10,000; EE 1% up to 1,500 then 2%; ER 2%.
  pagibig: { eeRate: 0.02, eeLowRate: 0.01, lowThreshold: 1500, erRate: 0.02, maxFundSalary: 10000 },
  // BIR withholding tax tables (TRAIN law, effective Jan 1, 2023): tax = base + (income - over) x rate.
  tax: {
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
  },
};

export const DEFAULT_SETTINGS = {
  companyName: 'Lancaster Technology and Development Corporation',
  companyAddress: 'Suite 3201, High St., South Corporate Plaza Tower 2, 26th St. cor. 11th Ave., BGC, Taguig City 1634',
  companyTin: '',
  assetTagPrefix: 'LTDC-IT-',
  payFrequency: 'semi-monthly', // 'semi-monthly' | 'monthly'
  workDaysPerYear: 312, // company policy: 6 days x 52 weeks (261 for a 5-day week)
  gracePeriodMinutes: 0,
  minimumOvertimeMinutes: 30, // shorter overtime on regular days is ignored
  overtimeMultiplier: 1.25,
  restDayMultiplier: 1.3,
  schedule: { shiftStart: '09:00', shiftEnd: '18:00', breakMinutes: 60, workDays: [1, 2, 3, 4, 5] },
  contributions: { sss: true, philhealth: true, pagibig: true, withholdingTax: true },
  rates: DEFAULT_RATES,
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

// flex: the employee is on flexible time (FLEX), so start and end times don't affect pay.
export function scheduleFor(employee, settings) {
  return { ...settings.schedule, ...(employee.schedule || {}), flex: Boolean(employee.flexTime) };
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
  const factor = Number(settings.workDaysPerYear) || 312;
  const daily = employee.payType === 'daily' ? rate : (rate * 12) / factor;
  const monthly = employee.payType === 'daily' ? (rate * factor) / 12 : rate;
  return { monthly, daily, hourly: daily / hoursPerDay(schedule) };
}

// Late / undertime / overtime for a single DTR entry. On flexible time there is no late or
// undertime, and overtime is time worked beyond the scheduled daily hours, whenever it starts.
export function computeEntry(entry, schedule, settings) {
  const r = { workedMinutes: 0, lateMinutes: 0, undertimeMinutes: 0, overtimeMinutes: 0, restDay: false, leave: false, paidLeave: false, remote: Boolean(entry.remote), open: false };
  if (entry.type === 'leave') return { ...r, leave: true, paidLeave: entry.paid !== false };
  // An approved remote-work day with no clock times counts as a full scheduled day.
  if (entry.remote && !entry.timeIn) return { ...r, workedMinutes: Math.round(hoursPerDay(schedule) * 60) };
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

  const minOvertime = Number(settings.minimumOvertimeMinutes) || 0;
  if (schedule.flex) {
    const overtime = Math.max(0, r.workedMinutes - Math.round(hoursPerDay(schedule) * 60));
    r.overtimeMinutes = overtime >= minOvertime ? overtime : 0;
    return r;
  }
  const start = toMinutes(schedule.shiftStart);
  let end = toMinutes(schedule.shiftEnd);
  if (end <= start) end += 1440;
  const late = inM - start;
  r.lateMinutes = late > (Number(settings.gracePeriodMinutes) || 0) ? late : 0;
  r.undertimeMinutes = Math.max(0, end - outM);
  const overtime = Math.max(0, outM - Math.max(end, inM));
  r.overtimeMinutes = overtime >= minOvertime ? overtime : 0;
  return r;
}

// ---------- Government contributions (employee + employer shares, monthly) ----------

const ratesOf = (settings) => ({ ...DEFAULT_RATES, ...(settings?.rates || {}) });

export function sssContribution(monthlyCompensation, r = DEFAULT_RATES.sss) {
  const half = r.mscStep / 2;
  let msc;
  if (monthlyCompensation < r.minMsc + half) msc = r.minMsc;
  else if (monthlyCompensation >= r.maxMsc - half) msc = r.maxMsc;
  else msc = r.minMsc + r.mscStep * (1 + Math.floor((monthlyCompensation - r.minMsc - half) / r.mscStep));
  return { msc, ee: round2(msc * r.eeRate), er: round2(msc * r.erRate), ec: msc < r.ecThreshold ? r.ecLow : r.ecHigh };
}

export function philhealthContribution(monthlyBasic, r = DEFAULT_RATES.philhealth) {
  const base = Math.min(Math.max(monthlyBasic, r.floor), r.ceiling);
  const half = round2((base * r.rate) / 2);
  return { ee: half, er: half };
}

export function pagibigContribution(monthlyBasic, r = DEFAULT_RATES.pagibig) {
  const base = Math.min(monthlyBasic, r.maxFundSalary);
  return { ee: round2(base * (monthlyBasic <= r.lowThreshold ? r.eeLowRate : r.eeRate)), er: round2(base * r.erRate) };
}

export function withholdingTax(taxableIncome, frequency, tables = DEFAULT_RATES.tax) {
  const table = [...(tables[frequency] || tables['semi-monthly'])].sort((a, b) => a.over - b.over);
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

  const att = { flex: schedule.flex, scheduledDays: 0, daysPresent: 0, remoteDays: 0, leaveDays: 0, unpaidLeaveDays: 0, absentDays: 0, lateMinutes: 0, undertimeMinutes: 0, overtimeMinutes: 0, restDayMinutes: 0, openEntries: 0, unapprovedOvertimeMinutes: 0 };

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
    else if (e.type === 'leave' && e.paid === false) att.unpaidLeaveDays += 1;
    else if (e.type === 'leave') att.leaveDays += 1;
    else {
      att.daysPresent += 1;
      if (e.remote) att.remoteDays += 1;
    }
  }

  // Monthly-rated employees get a fixed amount per period, less absences.
  // Daily-rated employees (and monthly-rated hires that started mid-period) are paid per day.
  const paidPerDay = employee.payType === 'daily' || hireDate > periodStart;
  const basePay = paidPerDay ? (att.daysPresent + att.leaveDays) * rates.daily : rates.monthly / divisor;
  // Unpaid leave (e.g. leave without pay) is deducted like an absence. With no day worked or on
  // paid leave, the whole base is deducted, even when the work-days factor would leave a remainder
  // (e.g. 312 days a year with a Monday-to-Friday schedule).
  const paidDays = att.daysPresent + att.leaveDays;
  const absenceDeduction = paidPerDay ? 0 : paidDays ? Math.min(basePay, (att.absentDays + att.unpaidLeaveDays) * rates.daily) : basePay;
  const tardinessDeduction = ((att.lateMinutes + att.undertimeMinutes) / 60) * rates.hourly;
  const basicPay = Math.max(0, basePay - absenceDeduction - tardinessDeduction);

  const overtimePay = (att.overtimeMinutes / 60) * rates.hourly * Number(settings.overtimeMultiplier || 1.25);
  const restDayPay = (att.restDayMinutes / 60) * rates.hourly * Number(settings.restDayMultiplier || 1.3);
  const otherEarnings = Number(adjustments.otherEarnings) || 0;
  const otherDeductions = Number(adjustments.otherDeductions) || 0;
  const grossPay = round2(basicPay + overtimePay + restDayPay + otherEarnings);
  // No pay in the period (e.g. no attendance yet): nothing to deduct from, no allowance.
  const noPay = grossPay <= 0;
  const allowance = noPay ? 0 : (Number(employee.allowance) || 0) / divisor; // de minimis, non-taxable

  const c = noPay ? {} : settings.contributions;
  const gov = ratesOf(settings);
  const sss = c.sss ? sssContribution(rates.monthly, gov.sss) : { ee: 0, er: 0, ec: 0 };
  const ph = c.philhealth ? philhealthContribution(rates.monthly, gov.philhealth) : { ee: 0, er: 0 };
  const hdmf = c.pagibig ? pagibigContribution(rates.monthly, gov.pagibig) : { ee: 0, er: 0 };
  const deductions = {
    sss: round2(sss.ee / divisor),
    philhealth: round2(ph.ee / divisor),
    pagibig: round2(hdmf.ee / divisor),
    withholdingTax: 0,
    otherDeductions: round2(otherDeductions),
  };
  const taxableIncome = round2(Math.max(0, grossPay - deductions.sss - deductions.philhealth - deductions.pagibig));
  if (c.withholdingTax && !employee.minimumWageEarner) deductions.withholdingTax = withholdingTax(taxableIncome, frequency, gov.tax);

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
