// Government payroll for a state university or college (national government agency rules).
// Shared by the server (computing payroll runs) and the browser (salary schedule, previews).
//
// Sources, with what each rule here follows:
//  - Salary: Executive Order No. 64, s. 2024 (updated salary schedule for civilian personnel),
//    third tranche from 1 January 2026 and fourth from 1 January 2027 (DBM NBC No. 601 for 2026).
//    Lawphil's text of the fourth tranche prints SG 4 step 4 as 18,751 and SG 14 step 5 as 41,040,
//    both out of sequence; the step increments of those rows give 18,571 and 42,040, used here.
//  - GSIS (RA 8291): personal share 9% and government share 12% of the monthly basic salary;
//    Employees' Compensation (PD 626) P100 a month, paid by the government.
//  - PhilHealth (5% of the monthly basic salary, floor P10,000, ceiling P100,000, shared equally)
//    and Pag-IBIG (2% each of up to P10,000) as in shared/calc.js.
//  - PERA: P2,000 a month, reduced for absences without pay (1/22 of a month per day).
//  - RATA (GAA general provisions): amount set per official; reduced by the days of actual work
//    in the month: 17 or more 100%, 12 to 16 75%, 6 to 11 50%, 1 to 5 25%.
//  - Daily rate: monthly salary / 22 (CSC and DBM); a minute is 1/480 of a day.
//  - Tardiness and undertime are charged to vacation leave credits first (CSC Omnibus Rules on
//    Leave); what the credits cannot cover is deducted from pay.
//  - Overtime (CSC-DBM JC 2, 2015 / JC 2, 2004): earned as compensatory time-off (1.0 hour per hour
//    on work days, 1.5 on rest days) unless the agency pays overtime (125% / 150% of the hourly
//    rate, at most 50% of the monthly basic salary).
//  - Net take-home pay may not fall below P5,000 a month after deductions (GAA general
//    provisions): loans and other authorized deductions that would go below it are not taken.
//  - Mid-year bonus (DBM BC 2017-2): one month's basic salary as of 15 May, for at least four
//    months of service from 1 July of the previous year, still in service on 15 May.
//  - Year-end bonus and P5,000 cash gift (RA 6686 as amended by RA 8441; DBM BC 2016-4 and
//    2024-3): one month's basic salary as of 31 October and the cash gift, for at least four
//    months of service from 1 January, still in service on 31 October. Less than four months:
//    no year-end bonus and a prorated cash gift (40%, 30%, 20%, 10% for 3, 2, 1, under 1 month).
//  - Productivity Enhancement Incentive: P5,000 (amount set by the year's DBM circular).
//  - Clothing/uniform allowance: P7,000 a year (DBM), tax-exempt up to the de minimis ceiling
//    (P8,000 under BIR RR 29-2025).
//  - Tax (TRAIN law tables): mandatory contributions are excluded from taxable pay; 13th-month pay
//    and other benefits (mid-year and year-end bonuses, cash gift, PEI) are exempt up to P90,000 a
//    year. PERA is treated as not taxable (BIR RR 3-98 as amended); a setting changes that.
import { round2, computeEntry, scheduleFor, dayOfWeek, eachDate, philhealthContribution, pagibigContribution, withholdingTax, DEFAULT_RATES } from './calc.js';

// ----- Salary schedules (monthly, pesos; steps 1 to 8, SG 33 has two) -----
const T2026 = {
  1: [14634, 14730, 14849, 14968, 15089, 15211, 15333, 15456],
  2: [15522, 15636, 15752, 15869, 15986, 16103, 16223, 16342],
  3: [16486, 16610, 16732, 16856, 16982, 17106, 17234, 17360],
  4: [17506, 17636, 17767, 17898, 18031, 18163, 18298, 18433],
  5: [18581, 18720, 18858, 18998, 19137, 19280, 19423, 19565],
  6: [19716, 19862, 20009, 20158, 20307, 20456, 20609, 20761],
  7: [20914, 21069, 21224, 21382, 21539, 21699, 21859, 22022],
  8: [22423, 22627, 22832, 23038, 23246, 23456, 23668, 23883],
  9: [24329, 24523, 24720, 24917, 25117, 25318, 25521, 25725],
  10: [26917, 27131, 27347, 27565, 27786, 28007, 28230, 28456],
  11: [31705, 31820, 32109, 32401, 32697, 32998, 33302, 33611],
  12: [33947, 34069, 34357, 34648, 34943, 35242, 35544, 35850],
  13: [36125, 36283, 36599, 36919, 37244, 37572, 37904, 38241],
  14: [38764, 39141, 39523, 39910, 40300, 40696, 41097, 41503],
  15: [42178, 42594, 43015, 43442, 43874, 44310, 44753, 45202],
  16: [45694, 46152, 46615, 47084, 47559, 48040, 48528, 49020],
  17: [49562, 50066, 50576, 51092, 51614, 52144, 52678, 53221],
  18: [53818, 54371, 54933, 55499, 56075, 56657, 57246, 57842],
  19: [59153, 59966, 60793, 61632, 62486, 63353, 64236, 65132],
  20: [66052, 66970, 67904, 68853, 69818, 70772, 71727, 72671],
  21: [73303, 74337, 75388, 76456, 77542, 78645, 79692, 80831],
  22: [81796, 82963, 84151, 85356, 86582, 87746, 89011, 90295],
  23: [91306, 92622, 93962, 95330, 96823, 98341, 99883, 101318],
  24: [102603, 104209, 105841, 107500, 109185, 110898, 112533, 114301],
  25: [116643, 118469, 120326, 122212, 124131, 126079, 128061, 130073],
  26: [131807, 133870, 135968, 138100, 140268, 142469, 144707, 146983],
  27: [148940, 151273, 153644, 155906, 158353, 160235, 162752, 165310],
  28: [167129, 169752, 172418, 174797, 177545, 180339, 182660, 185537],
  29: [187531, 190482, 193480, 196528, 199624, 202005, 205191, 208430],
  30: [210718, 214038, 217207, 220425, 223691, 227224, 230595, 234240],
  31: [300961, 306691, 312532, 318182, 323938, 329989, 336092, 342310],
  32: [356237, 363257, 370418, 377359, 384805, 392400, 400150, 408055],
  33: [449157, 462329],
};
const T2027 = {
  1: [15208, 15304, 15423, 15542, 15663, 15784, 15906, 16030],
  2: [16118, 16233, 16349, 16466, 16582, 16700, 16820, 16939],
  3: [17120, 17244, 17366, 17490, 17616, 17740, 17868, 17994],
  4: [18180, 18309, 18440, 18571, 18704, 18836, 18971, 19106],
  5: [19296, 19434, 19573, 19712, 19852, 19994, 20137, 20280],
  6: [20474, 20620, 20767, 20916, 21065, 21215, 21367, 21520],
  7: [21872, 22034, 22196, 22362, 22526, 22693, 22860, 23030],
  8: [23399, 23603, 23808, 24014, 24221, 24432, 24644, 24859],
  9: [25433, 25627, 25823, 26021, 26220, 26421, 26624, 26828],
  10: [28247, 28462, 28678, 28896, 29116, 29337, 29561, 29787],
  11: [33387, 33501, 33790, 34082, 34378, 34679, 34983, 35292],
  12: [35650, 35771, 36059, 36350, 36645, 36944, 37246, 37552],
  13: [37828, 37987, 38303, 38623, 38948, 39276, 39608, 39945],
  14: [40505, 40882, 41263, 41650, 42040, 42436, 42837, 43243],
  15: [44148, 44564, 44985, 45412, 45844, 46281, 46723, 47172],
  16: [47829, 48286, 48750, 49219, 49694, 50175, 50662, 51154],
  17: [51877, 52381, 52891, 53407, 53929, 54459, 54993, 55536],
  18: [56332, 56885, 57447, 58013, 58589, 59171, 59760, 60356],
  19: [61916, 62729, 63556, 64395, 65249, 66116, 66999, 67895],
  20: [69138, 70056, 70990, 71938, 72903, 73857, 74813, 75756],
  21: [76594, 77628, 78679, 79747, 80833, 81936, 82982, 84121],
  22: [85431, 86598, 87785, 88991, 90216, 91380, 92645, 93930],
  23: [95296, 96612, 97952, 99320, 100814, 102331, 103873, 105308],
  24: [107022, 108627, 110260, 111918, 113603, 115317, 116952, 118719],
  25: [121559, 123385, 125242, 127128, 129047, 130995, 132977, 134989],
  26: [137362, 139425, 141523, 143655, 145823, 148024, 150262, 152538],
  27: [155217, 157550, 159921, 162184, 164630, 166512, 169030, 171587],
  28: [173788, 176411, 179077, 181457, 184205, 186999, 189319, 192196],
  29: [194570, 197521, 200519, 203567, 206663, 209044, 212230, 215469],
  30: [218237, 221556, 224726, 227943, 231209, 234743, 238113, 241758],
  31: [308730, 314460, 320302, 325952, 331707, 337758, 343862, 350080],
  32: [364586, 371607, 378767, 385708, 393154, 400750, 408500, 416404],
  33: [459469, 472641],
};
export const SALARY_SCHEDULES = [
  { effective: '2026-01-01', name: 'EO 64, s. 2024 — third tranche (2026)', grades: T2026 },
  { effective: '2027-01-01', name: 'EO 64, s. 2024 — fourth tranche (2027)', grades: T2027 },
];

// The schedule in force on a date (the earliest one for dates before it).
export function scheduleOn(date) {
  return [...SALARY_SCHEDULES].reverse().find((s) => s.effective <= date) || SALARY_SCHEDULES[0];
}
export const stepsIn = (sg) => (Number(sg) === 33 ? 2 : 8);
export function salaryFor(sg, step, date) {
  const row = scheduleOn(date).grades[Number(sg)];
  if (!row) return null;
  return row[Math.min(Math.max(1, Number(step) || 1), row.length) - 1];
}

// ----- Appointment status -----
export const APPOINTMENTS = ['Permanent', 'Temporary', 'Casual', 'Contractual', 'Coterminous', 'Substitute', 'Job order', 'Contract of service'];
// Job order and contract of service workers are not government employees: no GSIS, PERA or
// bonuses, paid only for days worked; tax is withheld from their pay as set below.
export const isJobOrder = (emp) => ['Job order', 'Contract of service'].includes(emp.appointment) || emp.employmentStatus === 'Job order';

// ----- Loans and other authorized deductions -----
// remit: where the deduction is paid; priority: the order deductions are taken in (GSIS first).
export const DEDUCTION_TYPES = [
  { code: 'GSIS-CONSO', name: 'GSIS Consolidated Loan', remit: 'GSIS', priority: 10 },
  { code: 'GSIS-MPL', name: 'GSIS Multi-Purpose Loan', remit: 'GSIS', priority: 11 },
  { code: 'GSIS-POLICY', name: 'GSIS Policy Loan', remit: 'GSIS', priority: 12 },
  { code: 'GSIS-EMRG', name: 'GSIS Emergency Loan', remit: 'GSIS', priority: 13 },
  { code: 'GSIS-GFAL', name: 'GSIS GFAL / Computer Loan', remit: 'GSIS', priority: 14 },
  { code: 'GSIS-OPT', name: 'GSIS Optional Life Insurance', remit: 'GSIS', priority: 15 },
  { code: 'HDMF-MPL', name: 'Pag-IBIG Multi-Purpose Loan', remit: 'Pag-IBIG', priority: 20 },
  { code: 'HDMF-CAL', name: 'Pag-IBIG Calamity Loan', remit: 'Pag-IBIG', priority: 21 },
  { code: 'HDMF-HOUSING', name: 'Pag-IBIG Housing Loan', remit: 'Pag-IBIG', priority: 22 },
  { code: 'HDMF-MP2', name: 'Pag-IBIG MP2 Savings', remit: 'Pag-IBIG', priority: 23 },
  { code: 'PROVIDENT', name: 'Provident Fund', remit: 'Provident Fund', priority: 30 },
  { code: 'COOP', name: 'Cooperative', remit: 'Cooperative', priority: 31 },
  { code: 'UNION', name: 'Union / association dues', remit: 'Association', priority: 32 },
  { code: 'BANK', name: 'Bank salary loan', remit: 'Bank', priority: 33 },
  { code: 'REFUND', name: 'Refund of overpayment', remit: 'Agency', priority: 34 },
  { code: 'OTHER', name: 'Other authorized deduction', remit: 'Other', priority: 40 },
];
export const deductionType = (code) => DEDUCTION_TYPES.find((t) => t.code === code) || DEDUCTION_TYPES.at(-1);

// ----- Settings -----
export const DEFAULT_GOV = {
  gsisPersonal: 0.09, gsisGovernment: 0.12, ecc: 100,
  pera: 2000, peraTaxable: false,
  workingDaysPerMonth: 22,
  netPayFloor: 5000,
  overtime: 'cto', // 'cto' (compensatory time-off) | 'pay'
  overtimeRegular: 1.25, overtimeRestDay: 1.5, overtimeCapPercent: 50,
  tardiness: 'leave', // 'leave' (vacation leave credits first) | 'salary'
  vacationLeaveId: 'vl',
  benefitsExemptCeiling: 90000,
  cashGift: 5000, pei: 5000, clothingAllowance: 7000, clothingExemptCeiling: 8000, clothingMinMonths: 6,
  jobOrderEwt: 0.05, jobOrderPercentageTax: 0.03,
};
export const govSettings = (settings) => ({ ...DEFAULT_GOV, ...(settings?.gov || {}) });

// RATA share by days of actual work in the month.
export function rataShare(days) {
  return days >= 17 ? 1 : days >= 12 ? 0.75 : days >= 6 ? 0.5 : days >= 1 ? 0.25 : 0;
}

// Prorated cash gift (or PEI) for less than four months of service.
export function prorateShare(months) {
  return months >= 4 ? 1 : months >= 3 ? 0.4 : months >= 2 ? 0.3 : months >= 1 ? 0.2 : 0.1;
}

// Months of service from `from` to `to` (inclusive), as a decimal.
export function monthsOfService(from, to) {
  if (!from || !to || from > to) return 0;
  const days = (new Date(`${to}T00:00Z`) - new Date(`${from}T00:00Z`)) / 86400000 + 1;
  return Math.floor((days / 30.4375) * 100) / 100;
}

const monthEnd = (ymd) => {
  const [y, m] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

// Monthly basic salary of an employee on a date: from the salary grade and step when set,
// otherwise the monthly rate on the record (null for daily-paid workers).
export function monthlySalary(emp, date) {
  if (emp.salaryGrade) return salaryFor(emp.salaryGrade, emp.step, date);
  return emp.payType === 'daily' ? null : Number(emp.rate) || 0;
}

const attendanceOf = (employee, entries, periodStart, periodEnd, settings) => {
  const schedule = scheduleFor(employee, settings);
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
  return att;
};

// Days of actual work in a calendar month (for RATA): days with a work record, on site or remote.
function workDaysInMonth(employee, entries, month) {
  return new Set(entries.filter((e) => e.employeeId === employee.id && e.date.startsWith(month) && e.type === 'work' && (e.timeIn || e.remote)).map((e) => e.date)).size;
}

const employeeInfo = (employee, monthly, date) => ({
  employeeNo: employee.employeeNo,
  name: `${employee.lastName}, ${employee.firstName}${employee.middleName ? ` ${employee.middleName[0]}.` : ''}`,
  position: employee.position || '', department: employee.department || '',
  salaryGrade: employee.salaryGrade || null, step: employee.salaryGrade ? Number(employee.step) || 1 : null,
  schedule: employee.salaryGrade ? scheduleOn(date).name : '',
  itemNo: employee.plantillaItem || '', appointment: employee.appointment || '',
  tin: employee.tin || '', gsisNo: employee.gsisNo || '', philhealthNo: employee.philhealthNo || '', pagibigNo: employee.pagibigNo || '',
  bankName: employee.bankName || '', bankAccount: employee.bankAccount || '',
  payType: employee.salaryGrade ? 'monthly' : employee.payType, rate: monthly ?? (Number(employee.rate) || 0),
});

// Recurring deductions active in a period, taken while net pay stays at or above the floor.
function takeDeductions(list, { periodStart, periodEnd, divisor, paidSoFar, room }) {
  const taken = [];
  const skipped = [];
  const active = list
    .filter((d) => d.startDate <= periodEnd && (!d.endDate || d.endDate >= periodStart))
    .sort((a, b) => deductionType(a.type).priority - deductionType(b.type).priority || (a.createdAt || '').localeCompare(b.createdAt || ''));
  for (const d of active) {
    let amt = round2((Number(d.monthly) || 0) / divisor);
    if (d.total) amt = round2(Math.min(amt, Math.max(0, Number(d.total) - (paidSoFar[d.id] || 0))));
    if (amt <= 0) continue;
    const item = { id: d.id, type: d.type, name: d.name || deductionType(d.type).name, remit: deductionType(d.type).remit, amount: amt };
    if (room - amt < -0.005) {
      skipped.push({ ...item, reason: 'Net pay would fall below the P5,000 a month floor (GAA)' });
      continue;
    }
    room = round2(room - amt);
    taken.push(item);
  }
  return { taken, skipped };
}

// ----- Regular payroll -----
// deductions: the employee's recurring deductions; paidSoFar: amount already deducted per
// deduction in finalized runs; vlRemaining: vacation leave credits left (days).
export function computeGovPayslip({ employee, entries, periodStart, periodEnd, settings, adjustments = {}, deductions = [], paidSoFar = {}, vlRemaining = 0 }) {
  const g = govSettings(settings);
  const frequency = settings.payFrequency;
  const divisor = frequency === 'monthly' ? 1 : 2;
  const jo = isJobOrder(employee);
  const monthly = monthlySalary(employee, periodEnd);
  const daily = monthly != null ? monthly / g.workingDaysPerMonth : Number(employee.rate) || 0;
  const perMinute = daily / 480;
  const att = attendanceOf(employee, entries, periodStart, periodEnd, settings);
  const excluded = Boolean(adjustments.excluded);
  const paidDays = att.daysPresent + att.leaveDays;
  const unpaidDays = att.absentDays + att.unpaidLeaveDays;

  // Basic salary for the period, less absences without pay.
  const perDay = monthly == null || jo;
  let basePay = perDay ? (jo ? att.daysPresent : paidDays) * daily : monthly / divisor;
  if (!perDay && employee.hireDate > periodStart) basePay = Math.min(basePay, daily * att.scheduledDays); // started mid-period
  const absenceDeduction = perDay ? 0 : paidDays ? Math.min(basePay, unpaidDays * daily) : basePay;

  // Tardiness and undertime: vacation leave credits first, the rest from pay.
  const lateMinutes = att.flex ? 0 : att.lateMinutes + att.undertimeMinutes;
  let leaveChargedDays = 0;
  if (lateMinutes && g.tardiness === 'leave' && !jo) leaveChargedDays = Math.min(Math.round((lateMinutes / 480) * 1000) / 1000, Math.max(0, Math.floor((Number(vlRemaining) || 0) * 1000) / 1000));
  const salaryMinutes = Math.max(0, lateMinutes - Math.round(leaveChargedDays * 480));
  const tardinessDeduction = Math.min(Math.max(0, basePay - absenceDeduction), salaryMinutes * perMinute);
  const basicPay = excluded ? 0 : Math.max(0, basePay - absenceDeduction - tardinessDeduction);
  const anyPay = basicPay > 0;

  // PERA, less 1/22 of the monthly amount per day of absence without pay.
  const peraEligible = !jo && employee.pera !== false && monthly != null;
  const pera = peraEligible && anyPay ? Math.max(0, g.pera / divisor - (g.pera / g.workingDaysPerMonth) * unpaidDays) : 0;

  // RATA, for the whole month, in the run that ends on the last day of the month.
  let rata = { representation: 0, transportation: 0, days: null, share: 0 };
  const rep = Number(employee.rataRepresentation) || 0;
  const trans = Number(employee.rataTransportation) || 0;
  if ((rep || trans) && !jo && periodEnd === monthEnd(periodEnd) && !excluded) {
    const days = workDaysInMonth(employee, entries, periodEnd.slice(0, 7));
    const share = rataShare(days);
    rata = { representation: round2(rep * share), transportation: round2(trans * share), days, share };
  }

  // Overtime: compensatory time-off, or paid at 125% / 150% within 50% of the monthly salary.
  const hourly = daily / 8;
  let overtimePay = 0;
  const cocHours = round2((att.overtimeMinutes / 60) * 1 + (att.restDayMinutes / 60) * 1.5);
  if (g.overtime === 'pay' && !excluded) {
    overtimePay = (att.overtimeMinutes / 60) * hourly * g.overtimeRegular + (att.restDayMinutes / 60) * hourly * g.overtimeRestDay;
    if (monthly) overtimePay = Math.min(overtimePay, (monthly * g.overtimeCapPercent) / 100 / divisor);
  }

  const allowance = anyPay && !jo ? (Number(employee.allowance) || 0) / divisor : 0; // other non-taxable allowance
  const otherEarnings = excluded ? 0 : Number(adjustments.otherEarnings) || 0;
  const grossPay = round2(basicPay + pera + rata.representation + rata.transportation + allowance + overtimePay + otherEarnings);

  // Mandatory contributions on the monthly basic salary.
  const c = settings.contributions || {};
  const rates = { ...DEFAULT_RATES, ...(settings.rates || {}) };
  const contributing = !jo && anyPay && monthly;
  const gsisOn = contributing && c.gsis !== false;
  const ph = contributing && c.philhealth ? philhealthContribution(monthly, rates.philhealth) : { ee: 0, er: 0 };
  const hdmf = contributing && c.pagibig ? pagibigContribution(monthly, rates.pagibig) : { ee: 0, er: 0 };
  const ded = {
    gsis: gsisOn ? round2((monthly * g.gsisPersonal) / divisor) : 0,
    philhealth: round2(ph.ee / divisor),
    pagibig: round2(hdmf.ee / divisor),
    withholdingTax: 0,
    percentageTax: 0,
    otherDeductions: round2(Number(adjustments.otherDeductions) || 0),
    items: [],
  };
  const taxableIncome = round2(Math.max(0, basicPay + overtimePay + otherEarnings + (g.peraTaxable ? pera : 0) - ded.gsis - ded.philhealth - ded.pagibig));
  if (jo) {
    ded.withholdingTax = round2(grossPay * g.jobOrderEwt);
    ded.percentageTax = round2(grossPay * g.jobOrderPercentageTax);
  } else if (c.withholdingTax !== false && !employee.minimumWageEarner) {
    ded.withholdingTax = withholdingTax(taxableIncome, frequency, rates.tax);
  }

  // Loans and other deductions, in order, keeping net pay at or above the floor.
  const mandatory = ded.gsis + ded.philhealth + ded.pagibig + ded.withholdingTax + ded.percentageTax + ded.otherDeductions;
  const floor = jo ? 0 : g.netPayFloor / divisor;
  const { taken, skipped } = excluded ? { taken: [], skipped: [] } : takeDeductions(deductions, { periodStart, periodEnd, divisor, paidSoFar, room: round2(grossPay - mandatory - floor) });
  ded.items = taken;
  const totalDeductions = round2(mandatory + taken.reduce((a, d) => a + d.amount, 0));

  return {
    system: 'government', kind: 'regular',
    employeeId: employee.id,
    employee: employeeInfo(employee, monthly, periodEnd),
    rates: { monthly: round2(monthly || 0), daily: round2(daily), hourly: round2(hourly), perMinute: Math.round(perMinute * 10000) / 10000 },
    attendance: att,
    earnings: {
      basePay: round2(basePay), absenceDeduction: round2(absenceDeduction), tardinessDeduction: round2(tardinessDeduction), basicPay: round2(basicPay),
      pera: round2(pera), representation: rata.representation, transportation: rata.transportation, rataDays: rata.days, rataShare: rata.share,
      allowance: round2(allowance), overtimePay: round2(overtimePay), otherEarnings: round2(otherEarnings),
    },
    leave: { tardinessMinutes: lateMinutes, chargedToLeaveDays: leaveChargedDays, salaryMinutes, cocHours: g.overtime === 'cto' ? cocHours : 0 },
    grossPay,
    taxableIncome,
    deductions: ded,
    skippedDeductions: skipped,
    totalDeductions,
    employerShare: {
      gsis: gsisOn ? round2((monthly * g.gsisGovernment) / divisor) : 0,
      ecc: gsisOn ? round2(g.ecc / divisor) : 0,
      philhealth: round2(ph.er / divisor),
      pagibig: round2(hdmf.er / divisor),
    },
    netPay: round2(grossPay - totalDeductions),
    adjustments: { otherEarnings: Number(adjustments.otherEarnings) || 0, otherDeductions: Number(adjustments.otherDeductions) || 0, remarks: adjustments.remarks || '', excluded },
  };
}

// ----- Bonus and allowance runs -----
export const BONUS_KINDS = {
  'mid-year': { name: 'Mid-year bonus', cutoff: '05-15', windowStart: (y) => `${y - 1}-07-01` },
  'year-end': { name: 'Year-end bonus and cash gift', cutoff: '10-31', windowStart: (y) => `${y}-01-01` },
  pei: { name: 'Productivity Enhancement Incentive', cutoff: '11-30', windowStart: (y) => `${y}-01-01` },
  clothing: { name: 'Clothing / uniform allowance', cutoff: null, windowStart: null },
};

// One employee's bonus. year: the year of the bonus; payDate: when it is paid; ytdExempt: the part of
// the P90,000 exemption already used this year; monthlyTaxable: regular monthly taxable pay (for the tax on any excess).
export function computeGovBonus({ employee, kind, year, payDate, settings, ytdExempt = 0, monthlyTaxable = 0, adjustments = {} }) {
  const g = govSettings(settings);
  const def = BONUS_KINDS[kind];
  const cutoff = def.cutoff ? `${year}-${def.cutoff}` : payDate;
  const monthly = monthlySalary(employee, cutoff) || 0;
  const hire = employee.hireDate || cutoff;
  const inService = employee.status === 'Active' && hire <= cutoff && !isJobOrder(employee);
  const months = def.windowStart ? monthsOfService(hire > def.windowStart(year) ? hire : def.windowStart(year), cutoff) : monthsOfService(hire, payDate);
  const items = [];
  let note = '';
  if (!inService) note = isJobOrder(employee) ? 'Not entitled: job order / contract of service' : 'Not in service on the cut-off date';
  else if (adjustments.excluded) note = adjustments.remarks || 'Not included';
  else if (kind === 'mid-year') {
    if (months >= 4) items.push({ code: 'MYB', name: 'Mid-year bonus (1 month basic salary as of 15 May)', amount: monthly, exempt: true });
    else note = `Less than 4 months of service from 1 July ${year - 1} (${months.toFixed(1)})`;
  } else if (kind === 'year-end') {
    if (months >= 4) items.push({ code: 'YEB', name: 'Year-end bonus (1 month basic salary as of 31 October)', amount: monthly, exempt: true });
    else note = `Less than 4 months of service (${months.toFixed(1)}): no year-end bonus; prorated cash gift`;
    const share = prorateShare(months);
    items.push({ code: 'CG', name: `Cash gift${share < 1 ? ` (${share * 100}%)` : ''}`, amount: round2(g.cashGift * share), exempt: true });
  } else if (kind === 'pei') {
    const share = prorateShare(months);
    items.push({ code: 'PEI', name: `Productivity Enhancement Incentive${share < 1 ? ` (${share * 100}%)` : ''}`, amount: round2(g.pei * share), exempt: true });
  } else if (kind === 'clothing') {
    if (months >= g.clothingMinMonths) items.push({ code: 'CLOTH', name: 'Clothing / uniform allowance', amount: g.clothingAllowance, exempt: false, deMinimis: true });
    else note = `Less than ${g.clothingMinMonths} months of service`;
  }
  const extra = Number(adjustments.otherEarnings) || 0;
  if (extra && items.length) items.push({ code: 'OTHER', name: 'Other', amount: extra, exempt: false });
  const grossPay = round2(items.reduce((a, i) => a + i.amount, 0));
  // The P90,000 exemption for 13th-month pay and other benefits; clothing above the de minimis ceiling joins it.
  const counted = round2(items.filter((i) => i.exempt).reduce((a, i) => a + i.amount, 0) + items.filter((i) => i.deMinimis).reduce((a, i) => a + Math.max(0, i.amount - g.clothingExemptCeiling), 0));
  const excess = round2(Math.max(0, ytdExempt + counted - g.benefitsExemptCeiling) - Math.max(0, ytdExempt - g.benefitsExemptCeiling));
  const taxable = round2(excess + items.filter((i) => !i.exempt && !i.deMinimis).reduce((a, i) => a + i.amount, 0));
  const rates = { ...DEFAULT_RATES, ...(settings.rates || {}) };
  const tax = taxable && settings.contributions?.withholdingTax !== false ? round2(withholdingTax(monthlyTaxable + taxable, 'monthly', rates.tax) - withholdingTax(monthlyTaxable, 'monthly', rates.tax)) : 0;
  const otherDeductions = round2(Number(adjustments.otherDeductions) || 0);
  const totalDeductions = round2(tax + otherDeductions);
  return {
    system: 'government', kind,
    employeeId: employee.id,
    employee: employeeInfo(employee, monthly, cutoff),
    eligibility: { cutoff, months, inService, note },
    earnings: { items },
    grossPay,
    benefitsCounted: counted,
    taxableIncome: taxable,
    deductions: { withholdingTax: tax, otherDeductions, items: [] },
    skippedDeductions: [],
    totalDeductions,
    employerShare: {},
    netPay: round2(grossPay - totalDeductions),
    adjustments: { otherEarnings: extra, otherDeductions, remarks: adjustments.remarks || '', excluded: Boolean(adjustments.excluded) },
  };
}
