// Demo data: a handful of employees and ~6 weeks of attendance.
import { randomUUID } from 'node:crypto';
import { emptyData } from './db.js';
import { eachDate, dayOfWeek } from '../shared/calc.js';
import { localDate } from './util.js';
import { workDates } from '../shared/leave.js';

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
        data.timeEntries.push({ id: randomUUID(), employeeId: emp.id, date, type: 'leave', leaveTypeId: 'vl', paid: true, timeIn: null, timeOut: null, otApproved: false, remote: false, notes: 'Vacation leave' });
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

  // A few requests so the approval screens have something in them.
  const inDays = (n) => localDate(new Date(Date.now() + n * 86400000));
  const [, juan, andrea, mark, kristine] = data.employees;
  const request = (emp, kind, leaveTypeId, start, end, reason, status = 'pending') => ({
    id: randomUUID(), employeeId: emp.id, kind, leaveTypeId, startDate: start, endDate: end,
    days: workDates(emp, data.settings, start, end).length, reason, status, filedAt: new Date().toISOString(), filedBy: null,
    ...(status === 'rejected' ? { decidedAt: new Date().toISOString(), decidedByName: 'Demo HR Manager', decisionNote: 'Quarter-end close; please pick another week.' } : {}),
  });
  data.requests.push(
    request(kristine, 'leave', 'vl', inDays(7), inDays(9), 'Family trip to Cebu'),
    request(mark, 'remote', null, inDays(2), inDays(2), 'Waiting for a home appliance delivery'),
    request(juan, 'leave', 'sl', inDays(1), inDays(1), 'Medical check-up'),
    request(andrea, 'leave', 'vl', inDays(14), inDays(18), 'Out-of-town wedding', 'rejected'),
  );
  data.requests = data.requests.filter((r) => r.days > 0);
  seedAssets(data);
  return data;
}

// IT assets and consumables, allocated to the demo employees, a department and a location.
function seedAssets(data) {
  const now = Date.now();
  const daysAgo = (n) => new Date(now - n * 86400000).toISOString();
  const dateAgo = (n) => daysAgo(n).slice(0, 10);
  const emp = (i) => data.employees[i];
  const toEmp = (e) => ({ type: 'employee', id: e.id, name: `${e.firstName} ${e.lastName}`, employeeNo: e.employeeNo, department: e.department });
  const rows = [
    ['Laptop', 'Dell', 'Latitude 7440', 'i7, 16 GB RAM, 512 GB SSD', 78500, 400, 695, toEmp(emp(0))],
    ['Laptop', 'Lenovo', 'ThinkPad T14 Gen 4', 'Ryzen 7, 32 GB RAM, 1 TB SSD', 82000, 380, 715, toEmp(emp(1))],
    ['Laptop', 'HP', 'EliteBook 840 G10', 'i5, 16 GB RAM, 512 GB SSD', 68900, 300, 795, toEmp(emp(2))],
    ['Laptop', 'Lenovo', 'ThinkPad E14', 'i5, 8 GB RAM, 256 GB SSD', 45500, 900, 40, toEmp(emp(3))],
    ['Laptop', 'Dell', 'Vostro 3520', 'i5, 8 GB RAM, 512 GB SSD', 39900, 120, 975, null],
    ['Desktop', 'Lenovo', 'ThinkCentre M70s', 'i5, 16 GB RAM, 512 GB SSD', 42000, 500, 595, toEmp(emp(4))],
    ['Monitor', 'Dell', 'P2423D 24"', 'QHD IPS', 13900, 400, 695, toEmp(emp(0))],
    ['Monitor', 'Dell', 'P2423D 24"', 'QHD IPS', 13900, 380, 715, toEmp(emp(1))],
    ['Monitor', 'LG', '27UP850 27"', '4K IPS, USB-C', 24500, 200, 895, null],
    ['Mobile phone', 'Samsung', 'Galaxy A55', '256 GB, dual SIM', 23990, 150, 580, toEmp(emp(3))],
    ['Printer', 'Epson', 'EcoTank L15160', 'A3 colour, Wi-Fi', 59900, 700, 25, { type: 'location', id: null, name: 'BGC Office, 32F' }],
    ['Network equipment', 'Ubiquiti', 'UniFi U6 Pro', 'Wi-Fi 6 access point', 9800, 650, 80, { type: 'location', id: null, name: 'BGC Office, 32F' }],
    ['Server', 'Dell', 'PowerEdge T150', 'Xeon E-2314, 32 GB, 2x2 TB', 145000, 800, 295, { type: 'department', id: null, name: 'Engineering' }],
    ['Audio-visual', 'Logitech', 'Rally Bar Mini', 'Conference camera', 89000, 260, 470, { type: 'location', id: null, name: 'Boardroom' }],
    ['Laptop', 'Apple', 'MacBook Air 13" M2', '8 GB, 256 GB', 64990, 1200, -460, null, 'retired'],
    ['Peripheral', 'Logitech', 'MX Keys + MX Master 3S', 'Keyboard and mouse set', 9990, 90, 640, null, 'in_repair'],
  ];
  rows.forEach(([category, brand, model, specs, cost, age, warrantyDays, assignedTo, status], i) => {
    const asset = {
      id: randomUUID(), assetTag: `LTDC-IT-${String(i + 1).padStart(4, '0')}`, name: `${brand} ${model}`, category, brand, model,
      serialNumber: `${brand.slice(0, 2).toUpperCase()}${(9137 + i * 7919).toString(36).toUpperCase()}${i}`, specs,
      purchaseDate: dateAgo(age), purchaseCost: cost, supplier: i % 2 ? 'PC Express' : 'Silicon Valley Computer Group',
      warrantyEnd: dateAgo(-warrantyDays), condition: status === 'in_repair' ? 'Damaged' : age > 600 ? 'Fair' : 'Good',
      location: assignedTo?.type === 'location' ? assignedTo.name : 'IT Store Room', notes: '',
      status: status || (assignedTo ? 'assigned' : 'in_stock'), assignedTo, assignedAt: assignedTo ? daysAgo(Math.min(age, 60) - 1) : null,
      expectedReturn: null, createdAt: daysAgo(age),
    };
    data.assets.push(asset);
    const log = (at, action, detail, extra = {}) =>
      data.assetHistory.push({ id: randomUUID(), assetId: asset.id, assetTag: asset.assetTag, assetName: asset.name, action, detail, at, by: 'Demo IT Asset Manager', ...extra });
    log(asset.createdAt, 'created', `Registered as ${category} at IT Store Room`);
    if (assignedTo) log(asset.assignedAt, 'assigned', `Assigned to ${assignedTo.name}`, { assignee: assignedTo });
    if (status) log(daysAgo(10), 'status', `Status set to ${status === 'retired' ? 'Retired' : 'In repair'}`);
  });

  const items = [
    ['USB-C to HDMI adapter', 'Cables & adapters', 'pcs', 30, 10, 650],
    ['Cat6 patch cable, 2 m', 'Cables & adapters', 'pcs', 60, 20, 120],
    ['Wireless mouse', 'Peripherals', 'pcs', 12, 5, 890],
    ['Laptop charger 65 W USB-C', 'Peripherals', 'pcs', 6, 4, 1850],
    ['Epson 003 ink, black', 'Printer supplies', 'bottles', 8, 6, 380],
    ['16 GB DDR4 SO-DIMM', 'Components', 'pcs', 4, 2, 2400],
    ['32 GB USB flash drive', 'Storage media', 'pcs', 15, 5, 450],
  ];
  items.forEach(([name, category, unit, opening, reorderLevel, unitCost], i) => {
    const item = {
      id: randomUUID(), sku: `SKU-${String(i + 1).padStart(4, '0')}`, name, category, unit, reorderLevel, location: 'IT Store Room',
      unitCost, supplier: 'PC Express', notes: '', quantity: 0, createdAt: daysAgo(90),
    };
    data.inventoryItems.push(item);
    const move = (at, type, qty, extra = {}) => {
      item.quantity += qty;
      data.stockMovements.push({ id: randomUUID(), itemId: item.id, sku: item.sku, itemName: name, unit, type, quantity: qty, balanceAfter: item.quantity, at, by: 'Demo IT Asset Manager', issuedTo: null, reference: '', notes: '', ...extra });
    };
    move(daysAgo(90), 'in', opening, { reference: 'Opening stock' });
    // Issue some to people so allocations and low-stock alerts show up.
    const issues = [[3, 1], [5, 2], [2, 3], [4, 0], [3, 1], [3, 1], [4, 2]][i];
    const [qty, who] = issues;
    const to = i === 1 ? { type: 'department', id: null, name: 'Engineering' } : toEmp(emp(who));
    move(daysAgo(30 - i * 3), 'out', -qty, { issuedTo: to, reference: `REQ-${2026100 + i}` });
    if (i === 4) move(daysAgo(5), 'out', -2, { issuedTo: { type: 'location', id: null, name: 'BGC Office, 32F' }, reference: 'Printer refill' });
  });
}
