// HRIS demo data: employee records for the demo school's teachers, registrar and staff
// (at every demo campus), HR, payroll and staff sign-ins, six weeks of attendance, leave
// requests in every state, and two finalized payroll runs. Added with the LMS demo data
// (server/demo.js) and removed with it. Every record has demo: true.
import { randomUUID } from 'node:crypto';
import { addDays } from './util.js';
import { currentPeriod, scheduleFor, dayOfWeek, eachDate } from '../shared/calc.js';
import { workDates } from '../shared/leave.js';
import { computeRun, deleteEmployees } from './hris.js';

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (mins) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

export function removeHrisDemo(data, files = null) {
  deleteEmployees(data, data.employees.filter((e) => e.demo).map((e) => e.id), (id) => files?.remove(id));
  data.payrollRuns = data.payrollRuns.filter((r) => !r.demo);
  data.leaveAdjustments = data.leaveAdjustments.filter((a) => !a.demo);
}

// people: { main, sipocot, pasacao, calabanga } campuses, the demo users by username, person() to add an account,
// rand() for repeatable "random" numbers, demoPdf() for a sample medical certificate.
export function addHrisDemo(data, today, { campuses, userByName, person, rand, files, demoPdf }) {
  const now = new Date().toISOString();
  const add = (k, rec) => {
    const r = { id: randomUUID(), demo: true, createdAt: now, ...rec };
    data[k].push(r);
    return r;
  };
  const { main, sipocot, pasacao, calabanga } = campuses;
  const s = data.hrSettings;
  const taken = new Set(data.employees.map((e) => e.employeeNo));
  let n = 0;
  const nextNo = () => {
    let no;
    do no = `D-${String(++n).padStart(4, '0')}`;
    while (taken.has(no));
    return no;
  };
  const birth = (age, monthDay) => `${Number(today.slice(0, 4)) - age}-${monthDay}`;
  const thisMonth = today.slice(5, 7);
  const OFFICE = { shiftStart: '08:00', shiftEnd: '17:00', breakMinutes: 60, workDays: [1, 2, 3, 4, 5] };
  const GUARD = { shiftStart: '06:00', shiftEnd: '15:00', breakMinutes: 60, workDays: [1, 2, 3, 4, 5, 6] };

  // [first, last, gender, position, department, category, payType, rate, campus, account username or null, extra]
  const PEOPLE = [
    ['Maria', 'Santos', 'Female', 'Assistant Professor II', 'College of Computing', 'teaching', 'monthly', 46000, main, 'teacher.demo', { birthDate: birth(41, `${thisMonth}-21`), hireDate: '2014-06-02', employmentStatus: 'Regular' }],
    ['Juan', 'Dela Cruz', 'Male', 'Instructor III', 'College of Computing', 'teaching', 'monthly', 36000, main, 'jdelacruz.demo', { hireDate: '2018-08-01' }],
    ['Ana', 'Ramos', 'Female', 'Associate Professor I', 'General Education', 'teaching', 'monthly', 52000, main, 'aramos.demo', { hireDate: '2009-06-15', flexTime: true }],
    ['Leo', 'Mercado', 'Male', 'Instructor I', 'College of Computing', 'teaching', 'monthly', 30000, main, 'lmercado.demo', { hireDate: '2024-08-05', employmentStatus: 'Probationary' }],
    ['Grace', 'Aquino', 'Female', 'Instructor II', 'General Education', 'teaching', 'monthly', 33000, main, 'gaquino.demo', { hireDate: '2021-01-11' }],
    ['Ramon', 'Villareal', 'Male', 'Professor I', 'College of Agriculture', 'teaching', 'monthly', 61000, main, 'rvillareal.demo', { hireDate: '2003-06-16', flexTime: true, birthDate: birth(55, `${thisMonth}-09`) }],
    ['Liza', 'Gonzales', 'Female', 'Instructor III', 'College of Business', 'teaching', 'monthly', 36000, main, 'lgonzales.demo', { hireDate: '2017-06-05' }],
    ['Mark', 'Torres', 'Male', 'Instructor I', 'College of Education', 'teaching', 'monthly', 30000, main, 'mtorres.demo', { hireDate: '2025-01-06', employmentStatus: 'Probationary' }],
    ['Rosa', 'Villanueva', 'Female', 'University Registrar', "Registrar's Office", 'non-teaching', 'monthly', 42000, main, 'registrar.demo', { hireDate: '2012-03-01' }],
    ['Josefina', 'Dimaculangan', 'Female', 'HR Management Officer', 'Human Resources', 'non-teaching', 'monthly', 40000, main, 'hr.demo', { hireDate: '2015-02-02' }],
    ['Benjamin', 'Soriano', 'Male', 'Accountant II', 'Accounting Office', 'non-teaching', 'monthly', 34000, main, 'payroll.demo', { hireDate: '2019-07-15' }],
    ['Nestor', 'Abello', 'Male', 'College Librarian', 'Library', 'non-teaching', 'monthly', 28000, main, 'staff.demo', { hireDate: '2020-09-01' }],
    ['Cecilia', 'Navarro', 'Female', 'Guidance Counselor', 'Guidance Office', 'non-teaching', 'monthly', 31000, main, null, { hireDate: '2016-06-01', birthDate: birth(38, `${thisMonth}-27`) }],
    ['Dolores', 'Bautista', 'Female', 'University Nurse', 'Health Services', 'non-teaching', 'monthly', 29000, main, null, { hireDate: '2022-02-14' }],
    ['Paolo', 'Ilagan', 'Male', 'ICT Support Specialist', 'ICT Office', 'non-teaching', 'monthly', 27000, main, null, { hireDate: '2023-04-03', employmentStatus: 'Contractual' }],
    ['Rogelio', 'Pascual', 'Male', 'Security Guard', 'General Services', 'non-teaching', 'daily', 450, main, null, { hireDate: '2019-01-07', schedule: GUARD, employmentStatus: 'Contractual' }],
    ['Ernesto', 'Lacson', 'Male', 'Utility Worker', 'General Services', 'non-teaching', 'daily', 420, main, null, { hireDate: '2021-05-03', minimumWageEarner: true }],
    ['Teresita', 'Manalo', 'Female', 'Administrative Aide', "Registrar's Office", 'non-teaching', 'monthly', 18500, main, null, { hireDate: '2018-10-01', minimumWageEarner: true }],
    // The smaller campuses: their teachers (LMS accounts) and two staff each
    ['Elena', 'Bonifacio', 'Female', 'Instructor II', 'Faculty', 'teaching', 'monthly', 33000, sipocot, 'ebonifacio.demo', { hireDate: '2019-06-03' }],
    ['Rico', 'Abad', 'Male', 'Instructor I', 'General Education', 'teaching', 'monthly', 30000, sipocot, 'rabad.demo', { hireDate: '2023-06-05' }],
    ['Marites', 'Ocampo', 'Female', 'Campus Administrative Officer', 'Campus Office', 'non-teaching', 'monthly', 32000, sipocot, null, { hireDate: '2016-01-04' }],
    ['Danilo', 'Rivera', 'Male', 'Security Guard', 'General Services', 'non-teaching', 'daily', 450, sipocot, null, { hireDate: '2020-02-03', schedule: GUARD, employmentStatus: 'Contractual' }],
    ['Teresa', 'Llamas', 'Female', 'Instructor III', 'Faculty', 'teaching', 'monthly', 36000, pasacao, 'tllamas.demo', { hireDate: '2015-06-01' }],
    ['Dennis', 'Ortiz', 'Male', 'Instructor I', 'General Education', 'teaching', 'monthly', 30000, pasacao, 'dortiz.demo', { hireDate: '2024-01-08', employmentStatus: 'Probationary' }],
    ['Lourdes', 'Santiago', 'Female', 'Administrative Assistant', 'Campus Office', 'non-teaching', 'monthly', 22000, pasacao, null, { hireDate: '2021-08-02' }],
    ['Gloria', 'Pineda', 'Female', 'Assistant Professor I', 'Faculty', 'teaching', 'monthly', 42000, calabanga, 'gpineda.demo', { hireDate: '2011-06-06' }],
    ['Arnel', 'Cruzado', 'Male', 'Instructor II', 'General Education', 'teaching', 'monthly', 33000, calabanga, 'acruzado.demo', { hireDate: '2020-06-01' }],
    ['Romeo', 'Valdez', 'Male', 'Farm Technician', 'Campus Farm', 'non-teaching', 'daily', 480, calabanga, null, { hireDate: '2018-03-05', schedule: { ...OFFICE, shiftStart: '07:00', shiftEnd: '16:00' } }],
  ];

  // HR, payroll and staff sign-ins (the HRIS-only account types)
  const hrisAccount = (role, username, name, campusIds) => person(role, username, name, { campusIds });
  hrisAccount('hr', 'hr.demo', 'Josefina Dimaculangan', [main.id, sipocot.id]); // HR for two campuses
  hrisAccount('payroll', 'payroll.demo', 'Benjamin Soriano', [main.id]);
  hrisAccount('staff', 'staff.demo', 'Nestor Abello', [main.id]);

  const emps = PEOPLE.map(([firstName, lastName, gender, position, department, category, payType, rate, campus, username, extra]) => {
    const emp = add('employees', {
      employeeNo: nextNo(), firstName, middleName: '', lastName, gender, civilStatus: rand() < 0.6 ? 'Married' : 'Single',
      email: `${firstName}.${lastName}`.toLowerCase().replace(/\s+/g, '') + '@example.edu', phone: `09${String(Math.floor(rand() * 1e9)).padStart(9, '0')}`,
      birthDate: birth(25 + Math.floor(rand() * 30), `${pad(1 + Math.floor(rand() * 12))}-${pad(1 + Math.floor(rand() * 28))}`),
      address: `${campus.name.replace(/ Campus.*/, '')}, Camarines Sur`, position, department, category,
      employmentStatus: 'Regular', status: 'Active', payType, rate, allowance: payType === 'monthly' ? 2000 : 0,
      minimumWageEarner: false, flexTime: false, campusId: campus.id, schedule: OFFICE,
      tin: `${100 + Math.floor(rand() * 900)}-${100 + Math.floor(rand() * 900)}-${100 + Math.floor(rand() * 900)}-000`,
      sssNo: `34-${String(Math.floor(rand() * 1e7)).padStart(7, '0')}-${Math.floor(rand() * 10)}`,
      philhealthNo: `12-${String(Math.floor(rand() * 1e9)).padStart(9, '0')}-${Math.floor(rand() * 10)}`,
      pagibigNo: String(Math.floor(1e11 + rand() * 9e11)),
      bankName: payType === 'monthly' ? 'Land Bank of the Philippines' : '', bankAccount: payType === 'monthly' ? String(Math.floor(1e9 + rand() * 9e9)) : '',
      emergencyContactName: `${['Jose', 'Maria', 'Carmen', 'Antonio'][Math.floor(rand() * 4)]} ${lastName}`, emergencyContactPhone: `09${String(Math.floor(rand() * 1e9)).padStart(9, '0')}`,
      ...extra,
    });
    const account = username && userByName(username);
    if (account) {
      account.employeeId = emp.id;
      if (account.role === 'teacher') account.employeeNo ||= emp.employeeNo;
    }
    return emp;
  });
  const byName = (first) => emps.find((e) => e.firstName === first);

  // ----- Pay periods: two finished ones, and the current one (attendance up to today) -----
  const p0 = currentPeriod(today, s.payFrequency);
  const p1 = currentPeriod(addDays(p0.start, -1), s.payFrequency);
  const p2 = currentPeriod(addDays(p1.start, -1), s.payFrequency);

  // ----- Leave requests: approved (in the DTR), pending, rejected, upcoming -----
  const hr = userByName('hr.demo');
  const requestFor = (emp, typeId, start, end, status, reason, extra = {}) => {
    const dates = workDates(emp, s, start, end);
    if (!dates.length) return null;
    const type = data.leaveTypes.find((t) => t.id === typeId);
    if (typeId && !type) return null;
    const r = add('requests', {
      employeeId: emp.id, kind: typeId ? 'leave' : 'remote', leaveTypeId: typeId, startDate: dates[0], endDate: dates.at(-1), days: dates.length, reason,
      status, filedAt: `${addDays(dates[0], -5)}T01:00:00.000Z`, filedBy: userByName('staff.demo')?.id || null, ...extra,
    });
    if (status !== 'pending') Object.assign(r, { decidedAt: `${addDays(dates[0], -3)}T02:00:00.000Z`, decidedBy: hr?.id || null, decidedByName: 'Josefina Dimaculangan', decisionNote: status === 'rejected' ? 'Enrollment week: please file for another date.' : '' });
    if (status === 'approved') {
      for (const date of dates) {
        if (r.kind === 'leave') add('timeEntries', { employeeId: emp.id, date, type: 'leave', leaveTypeId: type.id, paid: type.paid, timeIn: null, timeOut: null, otApproved: false, remote: false, notes: `${type.name} (approved request)`, requestId: r.id });
        else add('timeEntries', { employeeId: emp.id, date, type: 'work', timeIn: null, timeOut: null, otApproved: false, remote: true, notes: 'Remote work (approved request)', requestId: r.id });
      }
    }
    return r;
  };
  const workdayFrom = (date, emp, step = 1) => {
    let d = date;
    while (!scheduleFor(emp, s).workDays.includes(dayOfWeek(d))) d = addDays(d, step);
    return d;
  };
  const ago = (days, emp) => workdayFrom(addDays(today, -days), emp, -1);
  const ahead = (days, emp) => workdayFrom(addDays(today, days), emp, 1);
  requestFor(byName('Juan'), 'vl', ago(19, byName('Juan')), ago(18, byName('Juan')), 'approved', 'Family event in Naga.');
  requestFor(byName('Grace'), 'sl', ago(9, byName('Grace')), ago(9, byName('Grace')), 'approved', 'Fever.');
  requestFor(byName('Nestor'), 'vl', ago(26, byName('Nestor')), ago(26, byName('Nestor')), 'approved', 'Personal errand.');
  requestFor(byName('Paolo'), null, ago(6, byName('Paolo')), ago(6, byName('Paolo')), 'approved', 'Server migration from home, after hours.');
  requestFor(byName('Liza'), 'vl', ahead(7, byName('Liza')), ahead(8, byName('Liza')), 'approved', 'Out-of-town trip.');
  requestFor(byName('Leo'), 'vl', ahead(14, byName('Leo')), ahead(14, byName('Leo')), 'rejected', 'Birthday.');
  requestFor(byName('Mark'), 'vl', ahead(10, byName('Mark')), ahead(11, byName('Mark')), 'pending', 'Sister’s wedding in Legazpi.');
  requestFor(byName('Elena'), null, ahead(3, byName('Elena')), ahead(3, byName('Elena')), 'pending', 'Preparing modules from home.');
  // A sick leave of four days needs a medical certificate (over 3 days): this one has it attached.
  const cecilia = byName('Cecilia');
  const sick = requestFor(cecilia, 'sl', ahead(1, cecilia), workDates(cecilia, s, ahead(1, cecilia), addDays(ahead(1, cecilia), 6))[3] || ahead(4, cecilia), 'pending', 'Minor surgery and recovery.');
  if (sick && files) {
    const owner = { id: userByName('staff.demo')?.id || 'demo' };
    const meta = files.save({ name: 'Medical certificate.pdf', type: 'application/pdf', data: demoPdf('MEDICAL CERTIFICATE', [`Patient: ${cecilia.firstName} ${cecilia.lastName}`, 'Diagnosis: for minor surgery (excision of cyst)', `Recommended rest: ${sick.days} days`, 'Bicol Medical Center (demo document)']).toString('base64') }, { owner });
    Object.assign(meta, { private: true, purpose: 'hr-certificate', demo: true });
    sick.attachment = { id: meta.id, name: meta.name, type: meta.mime, size: meta.size, uploadedAt: now };
  }
  // A carry-over from last year, recorded by HR.
  add('leaveAdjustments', { employeeId: byName('Ana').id, leaveTypeId: 'vl', year: Number(today.slice(0, 4)), days: 3, reason: 'Carry-over from last year (approved by the President).', at: `${today.slice(0, 4)}-01-15T01:00:00.000Z`, by: 'Josefina Dimaculangan' });

  // ----- Attendance from the start of the earlier finished period to today -----
  const skipToday = new Set(['Maria', 'Nestor']); // they clock in themselves in the demo
  for (const emp of emps) {
    const sch = scheduleFor(emp, s);
    const start = minutes(sch.shiftStart);
    const end = minutes(sch.shiftEnd);
    for (const date of eachDate(p2.start, today)) {
      if (!sch.workDays.includes(dayOfWeek(date)) || date < emp.hireDate) continue;
      if (data.timeEntries.some((e) => e.employeeId === emp.id && e.date === date)) continue;
      if (date === today && skipToday.has(emp.firstName)) continue;
      const r = rand();
      if (r < 0.03 && date !== today) continue; // absent
      const lateBy = r < 0.15 ? 5 + Math.floor(rand() * 35) : 0;
      const timeIn = hhmm(start - (lateBy ? -lateBy : Math.floor(rand() * 20)));
      if (date === today) {
        if (rand() < 0.85) add('timeEntries', { employeeId: emp.id, date, type: 'work', timeIn, timeOut: null, otApproved: false, remote: false, notes: '', clockedIn: true });
        continue;
      }
      const overtime = rand() < 0.1 ? 60 + Math.floor(rand() * 4) * 30 : 0;
      const early = rand() < 0.04 ? 30 + Math.floor(rand() * 60) : 0; // left early (undertime)
      const timeOut = hhmm(end + (overtime || Math.floor(rand() * 15)) - early);
      add('timeEntries', { employeeId: emp.id, date, type: 'work', timeIn, timeOut, otApproved: overtime > 0 && rand() < 0.6, remote: false, notes: overtime ? 'Stayed for enrollment' : '', clockedIn: true });
    }
  }

  // ----- Payroll: both finished periods are finalized at the main campus; the latest at Sipocot -----
  const run = (campus, period) => {
    const employeeIds = data.employees.filter((e) => e.campusId === campus.id && e.status === 'Active' && e.hireDate <= period.end).map((e) => e.id);
    if (!employeeIds.length || data.payrollRuns.some((r) => r.campusId === campus.id && r.periodStart <= period.end && period.start <= r.periodEnd)) return;
    const r = add('payrollRuns', { campusId: campus.id, periodStart: period.start, periodEnd: period.end, payDate: period.end, status: 'draft', employeeIds, payslips: [] });
    computeRun(data, r);
    if (campus === main && period === p1) {
      const slip = r.payslips.find((p) => p.employeeId === byName('Maria').id);
      if (slip) slip.adjustments = { otherEarnings: 1500, otherDeductions: 0, remarks: 'Honorarium: thesis panel' };
      computeRun(data, r);
    }
    Object.assign(r, { status: 'finalized', finalizedAt: `${period.end}T09:00:00.000Z`, finalizedBy: 'Benjamin Soriano' });
  };
  run(main, p2);
  run(main, p1);
  run(sipocot, p1);
}
