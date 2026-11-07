// Time and payroll calculations. Shared by the server (payroll runs) and the
// browser (DTR display), so this file must stay free of Node/DOM APIs.
import { DAY_TYPES, dayTypeFor, holidayIndex, isDayOff, regularCount } from './holidays.js';

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

// Pay for work on each kind of day, as a multiple of the hourly rate (Labor Code Arts. 87, 93 and
// 94 and DOLE's yearly holiday pay advisory). `day` applies to the first 8 hours (the scheduled
// daily hours), `overtime` to each hour beyond. On a scheduled work day that is a holiday the
// monthly salary already covers 100%, so the payslip adds only the premium above it.
export const DEFAULT_PREMIUMS = {
  ordinary: { day: 1, overtime: 1.25 },
  rest: { day: 1.3, overtime: 1.69 },
  special: { day: 1.3, overtime: 1.69 },
  specialRest: { day: 1.5, overtime: 1.95 },
  regular: { day: 2, overtime: 2.6 },
  regularRest: { day: 2.6, overtime: 3.38 },
  double: { day: 3, overtime: 3.9 },
  doubleRest: { day: 3.9, overtime: 5.07 },
};
// Night shift differential (Art. 86): at least 10% of the hourly rate that applies to each hour
// worked between 10 PM and 6 AM, so on a regular holiday it is 10% of 200%.
export const DEFAULT_NIGHT_DIFF = { rate: 0.1, start: '22:00', end: '06:00' };
// Unworked holidays. A regular holiday is paid when the employee was present (or on paid leave) on
// the last working day before it (or worked the holiday just before it). A special non-working day
// is "no work, no pay" by law unless company policy pays it.
export const DEFAULT_HOLIDAY_PAY = { requirePresentBefore: true, specialNotWorked: 'paid' };

export const DEFAULT_SETTINGS = {
  companyName: 'Lancaster Technology and Development Corporation',
  companyAddress: 'Suite 3201, High St., South Corporate Plaza Tower 2, 26th St. cor. 11th Ave., BGC, Taguig City 1634',
  companyTin: '',
  assetTagPrefix: 'LTDC-IT-',
  payFrequency: 'semi-monthly', // 'semi-monthly' | 'monthly'
  workDaysPerYear: 312, // company policy: 6 days x 52 weeks (261 for a 5-day week); employees can override
  gracePeriodMinutes: 0,
  minimumOvertimeMinutes: 30, // shorter overtime on regular days is ignored
  premiums: DEFAULT_PREMIUMS,
  nightDiff: DEFAULT_NIGHT_DIFF,
  holidayPay: DEFAULT_HOLIDAY_PAY,
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

// The daily-rate factor: days a year the monthly salary pays for. An employee's own factor (for
// example 313 for a 6-day week) wins over the company default.
export const factorFor = (employee, settings) => Number(employee?.workDaysPerYear) || Number(settings.workDaysPerYear) || 312;
// The factor that matches a schedule when every day except rest days is paid: 261 for a 5-day
// week, 313 for a 6-day week.
export const suggestedFactor = (workDays = []) => Math.round((365 * workDays.length) / 7);

export function ratesFor(employee, settings) {
  const schedule = scheduleFor(employee, settings);
  const rate = Number(employee.rate) || 0;
  const factor = factorFor(employee, settings);
  const daily = employee.payType === 'daily' ? rate : (rate * 12) / factor;
  const monthly = employee.payType === 'daily' ? (rate * factor) / 12 : rate;
  return { monthly, daily, hourly: daily / hoursPerDay(schedule), factor };
}

export const premiumsOf = (settings = {}) => {
  const p = structuredClone(DEFAULT_PREMIUMS);
  // Settings saved before 0.10 had only an overtime and a rest-day multiplier.
  if (!settings.premiums) {
    if (settings.overtimeMultiplier) p.ordinary.overtime = Number(settings.overtimeMultiplier);
    if (settings.restDayMultiplier) p.rest.day = Number(settings.restDayMultiplier);
  }
  for (const k of Object.keys(p)) Object.assign(p[k], settings.premiums?.[k] || {});
  return p;
};
export const nightDiffOf = (settings = {}) => ({ ...DEFAULT_NIGHT_DIFF, ...(settings.nightDiff || {}) });
export const holidayPayOf = (settings = {}) => ({ ...DEFAULT_HOLIDAY_PAY, ...(settings.holidayPay || {}) });

// Minutes of [a, b] (minutes from the entry date's midnight, b may pass 1440) that fall in the
// night window, which itself crosses midnight.
function nightOverlap(a, b, nd) {
  if (!(b > a)) return 0;
  const s = toMinutes(nd.start);
  let e = toMinutes(nd.end);
  if (s === null || e === null || s === e) return 0;
  if (e < s) e += 1440;
  let total = 0;
  for (const k of [-1, 0, 1]) total += Math.max(0, Math.min(b, e + k * 1440) - Math.max(a, s + k * 1440));
  return total;
}

// Late / undertime / overtime for a single DTR entry. On flexible time there is no late or
// undertime, and overtime is time worked beyond the scheduled daily hours, whenever it starts.
// `holidaysOnDate` are the holidays on the entry's date: they set its day type (regular holiday,
// special day, rest day...). Hours worked on a holiday are not late or undertime; the regular
// hours are paid at the holiday premium. regularMinutes = the paid hours up to the daily hours;
// nightMinutes / nightOvertimeMinutes = the part of the regular / overtime hours between 10 PM and 6 AM.
export function computeEntry(entry, schedule, settings, holidaysOnDate = []) {
  const scheduled = schedule.workDays.includes(dayOfWeek(entry.date));
  const off = holidaysOnDate.filter(isDayOff);
  const dayType = dayTypeFor(off, scheduled);
  const r = {
    workedMinutes: 0, lateMinutes: 0, undertimeMinutes: 0, overtimeMinutes: 0, restDay: false, leave: false, paidLeave: false, remote: Boolean(entry.remote), open: false,
    dayType, holiday: off.map((h) => h.name).join(' and ') || null, regularMinutes: 0, nightMinutes: 0, nightOvertimeMinutes: 0,
  };
  if (entry.type === 'leave') return { ...r, leave: true, paidLeave: entry.paid !== false };
  const std = Math.round(hoursPerDay(schedule) * 60);
  // Half-day leave on a work day: the other half is worked (or remote), timed against half the shift.
  const half = entry.halfLeave?.portion === 'am' || entry.halfLeave?.portion === 'pm' ? entry.halfLeave.portion : null;
  if (half) Object.assign(r, { halfLeave: half, paidLeave: entry.halfLeave.paid !== false });
  // An approved remote-work day with no clock times counts as a full scheduled day (half, beside a half-day leave).
  if (entry.remote && !entry.timeIn) {
    const m = Math.round(std * (half ? 0.5 : 1));
    return { ...r, workedMinutes: m, regularMinutes: m };
  }
  if (half && !entry.timeIn) return r; // not clocked yet, or absent for the other half
  if (!entry.timeOut) return { ...r, open: true };

  const nd = nightDiffOf(settings);
  const inM = toMinutes(entry.timeIn);
  let outM = toMinutes(entry.timeOut);
  if (outM <= inM) outM += 1440; // crossed midnight
  const span = outM - inM;
  const breakMinutes = span > 300 ? Number(schedule.breakMinutes) || 0 : 0; // no break deducted for short days
  r.workedMinutes = Math.max(0, span - breakMinutes);

  // Night hours: regular hours run from `regFrom` to `regTo`, overtime from `otFrom` to the time
  // out. The meal break falls somewhere in the regular hours, so their night share is pro-rated.
  const nightShare = (from, to, paid) => (to > from ? Math.round(nightOverlap(from, to, nd) * Math.min(1, paid / (to - from))) : 0);
  const night = (regFrom, regTo, otFrom) => {
    r.nightMinutes = nightShare(regFrom, regTo, r.regularMinutes);
    r.nightOvertimeMinutes = r.overtimeMinutes ? Math.min(r.overtimeMinutes, nightOverlap(otFrom, outM, nd)) : 0;
  };

  if (!scheduled) {
    // Rest day: every minute needs approval (overtimeMinutes); the first daily hours are paid at
    // the rest-day rate, the rest at its overtime rate.
    r.restDay = true;
    r.overtimeMinutes = r.workedMinutes;
    r.regularMinutes = Math.min(r.workedMinutes, std);
    const excess = r.workedMinutes - r.regularMinutes;
    r.nightMinutes = nightShare(inM, outM - excess, r.regularMinutes);
    r.nightOvertimeMinutes = Math.min(excess, nightOverlap(outM - excess, outM, nd));
    return r;
  }

  const holidayWork = dayType !== 'ordinary';
  const minOvertime = Number(settings.minimumOvertimeMinutes) || 0;
  if (schedule.flex) {
    const overtime = Math.max(0, r.workedMinutes - std);
    r.overtimeMinutes = overtime >= minOvertime ? overtime : 0;
    r.regularMinutes = Math.min(std, r.workedMinutes - overtime);
    night(inM, outM - overtime, outM - r.overtimeMinutes);
    return r;
  }
  let start = toMinutes(schedule.shiftStart);
  let end = toMinutes(schedule.shiftEnd);
  if (end <= start) end += 1440;
  // On leave for the first half: the day starts at mid-shift; for the second half: it ends there.
  if (half) {
    const mid = start + Math.round((end - start) / 2);
    if (half === 'am') start = mid;
    else end = mid;
  }
  if (!holidayWork) {
    const late = inM - start;
    r.lateMinutes = late > (Number(settings.gracePeriodMinutes) || 0) ? late : 0;
    r.undertimeMinutes = Math.max(0, end - outM);
  }
  const otFrom = Math.max(end, inM);
  const overtime = Math.max(0, outM - otFrom);
  r.overtimeMinutes = overtime >= minOvertime ? overtime : 0;
  r.regularMinutes = Math.max(0, Math.min(Math.round(std * (half ? 0.5 : 1)), r.workedMinutes - overtime));
  night(Math.max(inM, start), Math.min(outM, otFrom), otFrom);
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

const HOLIDAY_DAY_TYPES = ['special', 'specialRest', 'regular', 'regularRest', 'double', 'doubleRest'];
const pctText = (m) => `${round2(m * 100)}%`;
function lineLabel(l) {
  const day = DAY_TYPES[l.dayType];
  const lower = day.charAt(0).toLowerCase() + day.slice(1);
  if (l.part === 'unworked') return `${day}, not worked`;
  if (l.part === 'day') return l.premiumOnly ? `${day} worked (premium over the day's pay)` : `${day} worked`;
  if (l.part === 'overtime') return l.dayType === 'ordinary' ? 'Overtime' : `Overtime, ${lower}`;
  if (l.part === 'night') return l.dayType === 'ordinary' ? 'Night differential' : `Night differential, ${lower}`;
  return l.dayType === 'ordinary' ? 'Night differential on overtime' : `Night differential on overtime, ${lower}`;
}

const prevDate = (ymd) => formatDate(new Date(parseDate(ymd).getTime() - 86400000));

// `holidays`: the holiday calendar (any years); only days off (regular and special non-working)
// change pay. Special working days are ordinary days.
export function computePayslip({ employee, entries, periodStart, periodEnd, settings, adjustments = {}, holidays = [] }) {
  const schedule = scheduleFor(employee, settings);
  const rates = ratesFor(employee, settings);
  const frequency = settings.payFrequency;
  const divisor = frequency === 'monthly' ? 1 : 2;
  const P = premiumsOf(settings);
  const nd = nightDiffOf(settings);
  const hp = holidayPayOf(settings);
  const index = holidayIndex(holidays.filter(isDayOff));
  const holidaysOn = (date) => index.get(date) || [];

  const mine = entries.filter((e) => e.employeeId === employee.id);
  const inPeriod = mine.filter((e) => e.date >= periodStart && e.date <= periodEnd);
  const byDate = new Map(inPeriod.map((e) => [e.date, e]));
  const allByDate = new Map(mine.map((e) => [e.date, e]));
  const firstRecord = mine.reduce((min, e) => (!min || e.date < min ? e.date : min), null);

  const att = {
    flex: schedule.flex, scheduledDays: 0, daysPresent: 0, remoteDays: 0, leaveDays: 0, unpaidLeaveDays: 0, absentDays: 0, lateMinutes: 0, undertimeMinutes: 0,
    overtimeMinutes: 0, restDayMinutes: 0, openEntries: 0, unapprovedOvertimeMinutes: 0,
    holidayDays: 0, unpaidHolidayDays: 0, holidayWorkedMinutes: 0, nightMinutes: 0, holidays: [],
  };

  // Pay lines beyond the basic pay, one per kind of day and part (day, overtime, night...).
  const lines = new Map();
  const add = (dayType, part, { minutes = 0, days = 0, multiplier, premiumOnly = false }) => {
    if (!(minutes > 0 || days > 0) || !(multiplier > 0)) return;
    const key = `${dayType}:${part}`;
    const l = lines.get(key) || { dayType, part, minutes: 0, days: 0, multiplier, premiumOnly, amount: 0 };
    l.minutes += minutes;
    l.days += days;
    l.amount += minutes ? (minutes / 60) * rates.hourly * multiplier : days * rates.daily * multiplier;
    lines.set(key, l);
  };
  // Night differential on hours paid at `m` (the day's or overtime multiplier).
  const night = (dayType, part, minutes, m) => {
    if (minutes > 0) att.nightMinutes += minutes;
    add(dayType, part, { minutes, multiplier: nd.rate * m });
  };

  for (const e of inPeriod) {
    const c = computeEntry(e, schedule, settings, holidaysOn(e.date));
    const dt = c.dayType;
    if (c.open) att.openEntries += 1;
    if (c.restDay) {
      // Rest day (or a holiday on a rest day): paid only when approved, at the full rate.
      if (!e.otApproved) {
        att.unapprovedOvertimeMinutes += c.overtimeMinutes;
        continue;
      }
      att.restDayMinutes += c.overtimeMinutes;
      if (dt !== 'rest') att.holidayWorkedMinutes += c.workedMinutes;
      add(dt, 'day', { minutes: c.regularMinutes, multiplier: P[dt].day });
      add(dt, 'overtime', { minutes: c.workedMinutes - c.regularMinutes, multiplier: P[dt].overtime });
      night(dt, 'night', c.nightMinutes, P[dt].day);
      night(dt, 'nightOvertime', c.nightOvertimeMinutes, P[dt].overtime);
      continue;
    }
    att.lateMinutes += c.lateMinutes;
    att.undertimeMinutes += c.undertimeMinutes;
    if (dt !== 'ordinary' && c.regularMinutes) {
      // A holiday on a scheduled work day: the basic pay covers 100%, this adds the premium.
      att.holidayWorkedMinutes += c.regularMinutes;
      add(dt, 'day', { minutes: c.regularMinutes, multiplier: P[dt].day - 1, premiumOnly: true });
    }
    night(dt, 'night', c.nightMinutes, P[dt].day);
    if (e.otApproved) {
      att.overtimeMinutes += c.overtimeMinutes;
      add(dt, 'overtime', { minutes: c.overtimeMinutes, multiplier: P[dt].overtime });
      night(dt, 'nightOvertime', c.nightOvertimeMinutes, P[dt].overtime);
    } else att.unapprovedOvertimeMinutes += c.overtimeMinutes;
  }

  const hireDate = employee.hireDate || periodStart;
  // Monthly-rated employees get a fixed amount per period, less absences.
  // Daily-rated employees (and monthly-rated hires that started mid-period) are paid per day.
  const paidPerDay = employee.payType === 'daily' || hireDate > periodStart;
  const worked = (e) => e && e.type !== 'leave' && Boolean(e.timeIn || e.remote);
  // Holiday pay rule: present or on paid leave on the last working day before the holiday, or
  // worked the holiday just before it. Days before the first DTR record (e.g. before CORE was in
  // use) are not held against the employee.
  const presentBefore = (date) => {
    if (!hp.requirePresentBefore) return true;
    let d = prevDate(date);
    for (let i = 0; i < 31; i += 1, d = prevDate(d)) {
      if (!firstRecord || d < firstRecord) return true;
      if (d < hireDate) return false;
      const e = allByDate.get(d);
      if (holidaysOn(d).length) {
        if (worked(e)) return true;
        continue;
      }
      if (!schedule.workDays.includes(dayOfWeek(d))) continue;
      if (!e) return false;
      if (worked(e)) return true;
      if (e.type === 'leave') return e.paid !== false;
      return Boolean(e.halfLeave && e.halfLeave.paid !== false);
    }
    return true;
  };

  for (const date of eachDate(periodStart, periodEnd)) {
    if (date < hireDate) continue;
    const scheduled = schedule.workDays.includes(dayOfWeek(date));
    const hs = holidaysOn(date);
    const e = byDate.get(date);
    const half = e && e.type !== 'leave' && (e.halfLeave?.portion === 'am' || e.halfLeave?.portion === 'pm');
    if (hs.length && !worked(e) && !(e && e.type === 'leave') && !half) {
      // A holiday not worked.
      const regs = regularCount(hs);
      const dt = dayTypeFor(hs, scheduled);
      const name = hs.map((h) => h.name).join(' and ');
      let paid;
      if (regs) {
        paid = presentBefore(date);
        // Each regular holiday is a day's pay. A monthly salary already includes one.
        if (paid) add(dt, 'unworked', { days: paidPerDay ? regs : scheduled ? regs - 1 : 0, multiplier: 1 });
      } else {
        paid = hp.specialNotWorked === 'paid';
        if (paid && scheduled && paidPerDay) add(dt, 'unworked', { days: 1, multiplier: 1 });
      }
      if (scheduled) {
        att.scheduledDays += 1;
        if (paid) att.holidayDays += 1;
        else att.unpaidHolidayDays += 1;
      }
      if (scheduled || regs) att.holidays.push({ date, name, dayType: dt, worked: false, paid });
      continue;
    }
    if (hs.length && worked(e)) att.holidays.push({ date, name: hs.map((h) => h.name).join(' and '), dayType: dayTypeFor(hs, scheduled), worked: true, paid: true });
    if (!scheduled) continue;
    att.scheduledDays += 1;
    if (!e) att.absentDays += 1;
    else if (e.type === 'leave' && e.paid === false) att.unpaidLeaveDays += 1;
    else if (e.type === 'leave') att.leaveDays += 1;
    else if (half) {
      // Half a day on leave, half worked (or absent if never clocked and not remote).
      if (e.halfLeave.paid === false) att.unpaidLeaveDays += 0.5;
      else att.leaveDays += 0.5;
      if (e.timeIn || e.remote) {
        att.daysPresent += 0.5;
        if (e.remote) att.remoteDays += 0.5;
      } else att.absentDays += 0.5;
    } else {
      att.daysPresent += 1;
      if (e.remote) att.remoteDays += 1;
    }
  }

  const basePay = paidPerDay ? (att.daysPresent + att.leaveDays) * rates.daily : rates.monthly / divisor;
  // Unpaid leave (e.g. leave without pay) and unpaid holidays are deducted like an absence. With no
  // day worked, on paid leave or on a paid holiday, the whole base is deducted, even when the
  // work-days factor would leave a remainder (e.g. 312 days a year with a Monday-to-Friday schedule).
  const paidDays = att.daysPresent + att.leaveDays + att.holidayDays;
  const unpaidDays = att.absentDays + att.unpaidLeaveDays + att.unpaidHolidayDays;
  const absenceDeduction = paidPerDay ? 0 : paidDays ? Math.min(basePay, unpaidDays * rates.daily) : basePay;
  const tardinessDeduction = ((att.lateMinutes + att.undertimeMinutes) / 60) * rates.hourly;
  const basicPay = Math.max(0, basePay - absenceDeduction - tardinessDeduction);

  const premiumLines = [...lines.values()]
    .map((l) => ({ ...l, amount: round2(l.amount), multiplier: round2(l.multiplier * 10000) / 10000, label: lineLabel(l), rateText: pctText(l.multiplier) }))
    .filter((l) => l.amount > 0);
  const sum = (pred) => round2(premiumLines.filter(pred).reduce((a, l) => a + l.amount, 0));
  const isNight = (l) => l.part === 'night' || l.part === 'nightOvertime';
  const overtimePay = sum((l) => l.dayType === 'ordinary' && l.part === 'overtime');
  const restDayPay = sum((l) => l.dayType === 'rest' && !isNight(l));
  const holidayPay = sum((l) => HOLIDAY_DAY_TYPES.includes(l.dayType) && !isNight(l));
  const nightDiffPay = sum(isNight);
  const otherEarnings = Number(adjustments.otherEarnings) || 0;
  const otherDeductions = Number(adjustments.otherDeductions) || 0;
  const grossPay = round2(basicPay + overtimePay + restDayPay + holidayPay + nightDiffPay + otherEarnings);
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
    rates: { monthly: round2(rates.monthly), daily: round2(rates.daily), hourly: round2(rates.hourly), factor: rates.factor },
    attendance: att,
    earnings: {
      basePay: round2(basePay),
      absenceDeduction: round2(absenceDeduction),
      tardinessDeduction: round2(tardinessDeduction),
      basicPay: round2(basicPay),
      overtimePay: round2(overtimePay),
      restDayPay: round2(restDayPay),
      holidayPay: round2(holidayPay),
      nightDiffPay: round2(nightDiffPay),
      otherEarnings: round2(otherEarnings),
      lines: premiumLines,
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
