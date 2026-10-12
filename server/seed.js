// Demo data: a handful of employees and ~6 weeks of attendance.
import { randomUUID } from 'node:crypto';
import { emptyData } from './db.js';
import { eachDate, dayOfWeek } from '../shared/calc.js';
import { localDate } from './util.js';

const PEOPLE = [
  ['Maria', 'Santos', 'Reyes', 'HR Manager', 'Human Resources', 'monthly', 55000, 'Female', 'Married'],
  ['Juan', 'Dela Cruz', 'Garcia', 'Software Engineer', 'Engineering', 'monthly', 45000, 'Male', 'Single'],
  ['Andrea', 'Villanueva', 'Lim', 'Accountant', 'Finance', 'monthly', 32000, 'Female', 'Single'],
  ['Mark', 'Bautista', 'Torres', 'Sales Associate', 'Sales', 'monthly', 22000, 'Male', 'Married'],
  ['Kristine', 'Mendoza', 'Aquino', 'Customer Support', 'Operations', 'monthly', 18000, 'Female', 'Single'],
  ['Ramon', 'Castillo', 'Ramos', 'Warehouse Staff', 'Operations', 'daily', 695, 'Male', 'Married'],
];

// Deterministic pseudo-random numbers so the demo looks the same every time.
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (mins) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;

export function demoData() {
  const data = emptyData();

  data.employees = PEOPLE.map(([first, last, middle, position, department, payType, rate, gender, civilStatus], i) => ({
    id: randomUUID(),
    employeeNo: `EMP-${String(i + 1).padStart(4, '0')}`,
    firstName: first,
    middleName: middle,
    lastName: last,
    email: `${first.toLowerCase()}.${last.toLowerCase().replace(/\s+/g, '')}@example.com`,
    phone: `0917${String(1234567 + i * 111111).slice(0, 7)}`,
    birthDate: `${1985 + i * 2}-0${(i % 9) + 1}-1${i}`,
    gender,
    civilStatus,
    address: 'Metro Manila',
    position,
    department,
    employmentStatus: i === 4 ? 'Probationary' : 'Regular',
    hireDate: `${2018 + i}-0${(i % 9) + 1}-01`,
    status: 'Active',
    payType,
    rate,
    allowance: payType === 'monthly' ? 2000 : 0,
    minimumWageEarner: payType === 'daily',
    tin: `${100 + i}-${200 + i}-${300 + i}-000`,
    sssNo: `34-${1234567 + i}-${i}`,
    philhealthNo: `12-${345678901 + i}-${i}`,
    pagibigNo: `1210-${2345 + i}-${6789 + i}`,
    bankName: 'BDO',
    bankAccount: `00${1234567890 + i}`,
    emergencyContactName: 'Family Member',
    emergencyContactPhone: '09171234567',
    schedule: structuredClone(data.settings.schedule),
    createdAt: new Date().toISOString(),
  }));

  const today = localDate();
  const start = new Date(Date.now() - 42 * 86400000);
  const from = localDate(start);
  const rand = rng(42);
  for (const date of eachDate(from, today)) {
    if (![1, 2, 3, 4, 5].includes(dayOfWeek(date))) continue;
    for (const emp of data.employees) {
      const roll = rand();
      if (roll < 0.03) continue; // absent
      if (roll < 0.06) {
        data.timeEntries.push({ id: randomUUID(), employeeId: emp.id, date, type: 'leave', timeIn: null, timeOut: null, otApproved: false, notes: 'Vacation leave' });
        continue;
      }
      const late = rand() < 0.15 ? Math.floor(rand() * 40) + 1 : 0;
      const timeIn = 9 * 60 - Math.floor(rand() * 20) + late;
      const ot = rand() < 0.15 ? 60 + Math.floor(rand() * 4) * 30 : 0;
      const timeOut = 18 * 60 + Math.floor(rand() * 10) + ot;
      const isToday = date === today;
      data.timeEntries.push({
        id: randomUUID(),
        employeeId: emp.id,
        date,
        type: 'work',
        timeIn: hhmm(timeIn),
        timeOut: isToday ? null : hhmm(timeOut),
        otApproved: ot > 0,
        notes: ot > 0 ? 'Approved overtime' : '',
      });
    }
  }
  return data;
}
