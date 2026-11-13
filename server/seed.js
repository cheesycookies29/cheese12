// Demo data: a handful of employees and ~6 weeks of attendance.
import { randomUUID } from 'node:crypto';
import { emptyData } from './db.js';
import { eachDate, dayOfWeek } from '../shared/calc.js';
import { localDate } from './util.js';
import { DEFAULT_CRM } from '../shared/crm.js';

const DEFAULT_BID_CHECKLIST = DEFAULT_CRM.bidChecklist;
import { workDates } from '../shared/leave.js';
import { ticketRef, slaDue } from '../shared/helpdesk.js';
import { DEFAULT_STATUSES } from '../shared/projects.js';

const PEOPLE = [
  ['Maria', 'Santos', 'Reyes', 'HR Manager', 'Human Resources', 'monthly', 55000, 'Female', 'Married'],
  ['Juan', 'Dela Cruz', 'Garcia', 'Software Engineer', 'Engineering', 'monthly', 45000, 'Male', 'Single'],
  ['Andrea', 'Villanueva', 'Lim', 'Project Manager', 'Delivery', 'monthly', 32000, 'Female', 'Single'],
  ['Mark', 'Bautista', 'Torres', 'Sales Associate', 'Sales', 'monthly', 22000, 'Male', 'Married'],
  ['Kristine', 'Mendoza', 'Aquino', 'Customer Support', 'Operations', 'monthly', 18000, 'Female', 'Single'],
  ['Ramon', 'Castillo', 'Ramos', 'Warehouse Staff', 'Operations', 'daily', 755, 'Male', 'Married'],
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

const code = (prefix, n) => `${prefix}${String(n).padStart(4, '0')}`;

// Number formats for the demo records. The defaults suit an empty system; when demo data is
// added next to real data (server/demo.js), DEMO- prefixes and later numbers avoid clashes.
const DEFAULT_CODES = { employeePrefix: 'EMP-', assetPrefix: 'LTDC-IT-', skuPrefix: 'SKU-', serialPrefix: '', firstReport: 1, firstTicket: 1 };

export function demoData(codes = {}) {
  const c = { ...DEFAULT_CODES, ...codes };
  const data = emptyData();

  data.employees = PEOPLE.map(([first, last, middle, position, department, payType, rate, gender, civilStatus], i) => ({
    id: randomUUID(),
    employeeNo: code(c.employeePrefix, i + 1),
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
  // Holidays are days off, except at the warehouse, which stays open (so the demo shows holiday pay).
  const daysOff = new Set(data.holidays.filter((h) => h.type === 'regular' || h.type === 'special').map((h) => h.date));
  for (const date of eachDate(from, today)) {
    if (![1, 2, 3, 4, 5].includes(dayOfWeek(date))) continue;
    for (const emp of data.employees) {
      if (daysOff.has(date) && emp.payType !== 'daily') continue;
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
  // Reporting lines: Juan leads Mark and Kristine; Maria (HR Manager) is over Juan, Andrea and Ramon.
  const [maria, , , , , ramon] = data.employees;
  for (const e of [mark, kristine]) e.supervisorId = juan.id;
  for (const e of [juan, andrea, ramon]) e.supervisorId = maria.id;
  // Pending requests get their approval route when the demo accounts exist (server/demo.js).
  const request = (emp, kind, leaveTypeId, start, end, reason, status = 'pending', extra = {}) => {
    const dates = workDates(emp, data.settings, start, end, data.holidays);
    const breakdown = dates.map((date) => ({ date, portion: extra.portions?.[date] || 'whole' }));
    const days = breakdown.reduce((n, d) => n + (d.portion === 'whole' ? 1 : 0.5), 0);
    const filedAt = new Date().toISOString();
    return {
      id: randomUUID(), employeeId: emp.id, kind, leaveTypeId, startDate: start, endDate: end, breakdown, days, paidDays: days, overflowDays: 0,
      reason, destination: extra.destination || '', status, filedAt, filedBy: null, history: [{ at: filedAt, by: `${emp.firstName} ${emp.lastName}`, text: 'Filed' }],
      ...(status === 'rejected' ? { decidedAt: filedAt, decidedByName: 'Demo HR Manager', decisionNote: 'Quarter-end close; please pick another week.' } : {}),
    };
  };
  data.requests.push(
    request(kristine, 'leave', 'vl', inDays(7), inDays(9), 'Family trip to Cebu'),
    request(mark, 'remote', null, inDays(2), inDays(2), 'Waiting for a home appliance delivery'),
    request(mark, 'ob', null, inDays(4), inDays(4), 'Product demo and requirements workshop', 'pending', { destination: 'Meridian Logistics, Pasig City' }),
    request(juan, 'leave', 'sl', inDays(1), inDays(1), 'Medical check-up in the morning', 'pending', { portions: { [inDays(1)]: 'am' } }),
    request(andrea, 'leave', 'vl', inDays(14), inDays(18), 'Out-of-town wedding', 'rejected'),
  );
  data.requests = data.requests.filter((r) => r.days > 0);
  seedAssets(data, c);
  seedTickets(data, c);
  seedCrm(data, c);
  seedProjects(data, c);
  return data;
}

// Sales & CRM: fictional organizations with contacts, leads, deals in every stage, bids and
// contracts. Records are owned by DEMO_OWNER, which addDemo() swaps for the demo sales account.
export const DEMO_OWNER = 'demo-sales-owner';
function seedCrm(data, c) {
  const P = c.crmPrefix ?? '';
  const now = Date.now();
  const at = (days) => new Date(now + days * 86400000).toISOString();
  const day = (days) => at(days).slice(0, 10);
  const base = (created) => ({ id: randomUUID(), ownerId: DEMO_OWNER, createdBy: DEMO_OWNER, createdAt: at(-created), updatedAt: at(-Math.max(0, created - 3)) });
  const event = (type, rec, subject, days) => ({ id: randomUUID(), type: 'event', subject, body: '', related: { type, id: rec.id }, ownerId: DEMO_OWNER, createdBy: DEMO_OWNER, createdAt: at(-days), done: true });
  const acts = [];

  const ACCOUNTS = [
    ['Northfield State University', 'client', 'education', 'Education', 'Calamba, Laguna'],
    ['Municipality of San Rafael', 'prospect', 'government', 'Government', 'San Rafael, Bulacan'],
    ['Meridian Logistics Inc.', 'client', 'private', 'Logistics', 'Pasig City'],
    ['Bayani Foods Corporation', 'prospect', 'private', 'Manufacturing', 'Valenzuela City'],
    ['Provincial Government of Isla Verde', 'prospect', 'government', 'Government', 'Isla Verde Province'],
    ['Luzon Health Partners', 'prospect', 'private', 'Healthcare', 'Quezon City'],
  ];
  const accounts = ACCOUNTS.map(([name, type, sector, industry, address], i) => ({
    ...base(120 - i * 12), name, type, sector, industry, address, tin: `00${i + 1}-45${i}-78${i}-000`,
    website: `www.${name.toLowerCase().replace(/[^a-z]+/g, '')}.example`, email: `info@${name.toLowerCase().replace(/[^a-z]+/g, '')}.example`,
    phone: `(02) 8${700 + i * 11}-${1200 + i * 37}`, tags: sector === 'government' ? ['public sector'] : [], notes: '',
  }));
  const [nsu, sanRafael, meridian, bayani, islaVerde, luzon] = accounts;
  const CONTACTS = [
    [nsu, 'Teresa', 'Villareal', 'Vice President for Administration'], [nsu, 'Paolo', 'Santiago', 'IT Director'],
    [sanRafael, 'Ramon', 'Del Rosario', 'Municipal Administrator'], [sanRafael, 'Liza', 'Ocampo', 'BAC Secretariat Head'],
    [meridian, 'Grace', 'Lim', 'HR and Admin Manager'], [bayani, 'Victor', 'Manalo', 'Chief Operating Officer'],
    [islaVerde, 'Corazon', 'Dimaculangan', 'Provincial IT Officer'], [luzon, 'Miguel', 'Ferrer', 'Finance Director'],
  ];
  const contacts = CONTACTS.map(([a, firstName, lastName, title], i) => ({
    ...base(100 - i * 8), firstName, lastName, title, accountId: a.id, email: `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/\s+/g, '')}@${a.website.slice(4)}`,
    phone: a.phone, mobile: `0917 ${String(5550000 + i * 1371).slice(0, 3)} ${String(5550000 + i * 1371).slice(3)}`, notes: '', tags: [],
  }));
  const byName = (first) => contacts.find((x) => x.firstName === first);

  const STAGED = [
    ['Student information system upgrade', nsu, 'Paolo', 'negotiation', 2850000, 18, 'Referral', 'Final pricing call with the VP'],
    ['E-permit and business licensing portal', sanRafael, 'Ramon', 'proposal', 1950000, 35, 'PhilGEPS', 'Submit the bid for the public bidding'],
    ['Warehouse HR and payroll rollout', meridian, 'Grace', 'won', 1320000, -20, 'Existing client', ''],
    ['Plant attendance and timekeeping', bayani, 'Victor', 'needs', 780000, 50, 'Event', 'Site visit to the Valenzuela plant'],
    ['Provincial helpdesk and asset tracking', islaVerde, 'Corazon', 'qualify', 2400000, 75, 'Website', 'Get the approved budget and timeline'],
    ['Clinic patient portal', luzon, 'Miguel', 'lost', 1100000, -45, 'Cold outreach', ''],
    ['Learning management system, phase 2', nsu, 'Teresa', 'won', 1650000, -46, 'Existing client', ''],
  ];
  const deals = STAGED.map(([title, a, contact, stage, value, closeIn, source, nextStep], i) => {
    // The LMS phase 2 deal was won some weeks ago (its project is running: see seedProjects).
    const deal = { ...base(i === 6 ? 110 : 90 - i * 9), code: `${P}DL-${String(i + 1).padStart(4, '0')}`, title, accountId: a.id, contactId: byName(contact).id, stage, value, expectedClose: day(closeIn), source, nextStep, description: '', lostReason: stage === 'lost' ? 'Lost to a competitor' : '' };
    if (stage === 'won' || stage === 'lost') deal.closedAt = at(closeIn);
    acts.push(event('deal', deal, 'Deal created in Qualification', i === 6 ? 110 : 90 - i * 9));
    if (stage === 'won') acts.push(event('deal', deal, `Won · ${i === 6 ? 'Proposal' : 'Negotiation'} → Won`, -closeIn));
    if (stage === 'lost') acts.push(event('deal', deal, 'Lost (Lost to a competitor) · from Proposal', -closeIn));
    return deal;
  });

  const LEADS = [
    ['Andres Bautista', 'Golden Harvest Cooperative', 'General Manager', 'new', 'Website', 450000, 'Payroll for 140 seasonal workers'],
    ['Joy Navarro', 'Pacific Crest Hotels', 'HR Director', 'contacted', 'Referral', 900000, 'HRIS with leave and payroll for 3 hotels'],
    ['Engr. Felipe Reyes', 'City Engineering Office, Sta. Lucia', 'City Engineer', 'qualified', 'PhilGEPS', 1500000, 'Project monitoring web application'],
    ['Karen Uy', 'BrightPath Tutorials', 'Owner', 'new', 'Public form', 250000, 'Simple LMS for 600 learners'],
    ['Dennis Tolentino', 'Tolentino Hardware', 'Owner', 'disqualified', 'Cold outreach', 120000, 'Inventory app'],
  ];
  const leads = LEADS.map(([name, company, title, status, source, estimatedValue, interest], i) => ({
    ...base(20 - i * 3), code: `${P}LD-${String(i + 1).padStart(4, '0')}`, name, company, title, status, source, estimatedValue, interest,
    email: `${name.split(' ').at(-1).toLowerCase()}@${company.toLowerCase().replace(/[^a-z]+/g, '')}.example`, phone: `0918 ${200 + i} ${4000 + i * 7}`,
    disqualifiedReason: status === 'disqualified' ? 'Budget below our minimum engagement' : '',
  }));

  const checklist = (doneCount) => DEFAULT_BID_CHECKLIST.map((label, i) => ({ id: randomUUID(), label, done: i < doneCount, doneBy: i < doneCount ? 'Demo Sales Manager' : null, doneAt: i < doneCount ? at(-2) : null }));
  const bids = [
    { ...base(14), code: `${P}BID-0001`, title: 'Supply, delivery and installation of an e-permit and licensing system', accountId: sanRafael.id, dealId: deals[1].id, reference: 'SR-2026-ITB-017', mode: 'public', status: 'preparing', budget: 2000000, bidAmount: 1950000, deadline: `${day(6)}T10:00`, openingDate: day(6), preBidDate: day(-3), notes: 'Pre-bid conference attended; supplemental bid bulletin no. 1 received.', checklist: checklist(6) },
    { ...base(40), code: `${P}BID-0002`, title: 'Provincial ICT helpdesk and asset management system', accountId: islaVerde.id, dealId: deals[4].id, reference: 'IV-PG-2026-044', mode: 'public', status: 'submitted', budget: 2500000, bidAmount: 2380000, deadline: `${day(-4)}T09:00`, openingDate: day(-4), preBidDate: day(-18), notes: 'Opened; we are the lowest calculated bid so far. Waiting for post-qualification.', checklist: checklist(10), submittedAt: at(-4) },
    { ...base(70), code: `${P}BID-0003`, title: 'HRIS and payroll for warehouse operations', accountId: meridian.id, dealId: deals[2].id, reference: 'MLI-RFP-2026-03', mode: 'private', status: 'awarded', budget: null, bidAmount: 1320000, deadline: `${day(-35)}T17:00`, openingDate: null, preBidDate: null, notes: 'Awarded after a product demo.', checklist: checklist(10), submittedAt: at(-35) },
  ];
  bids[1].status = 'evaluation';

  const contracts = [
    { ...base(300), code: `${P}CT-0001`, title: 'Student information system support and maintenance', accountId: nsu.id, dealId: null, bidId: null, number: 'NSU-2025-118', value: 480000, startDate: day(-325), endDate: day(40), status: 'active', autoRenew: false, billing: 'Quarterly', terms: '8x5 support, two releases per year.' },
    { ...base(20), code: `${P}CT-0002`, title: 'Warehouse HR and payroll: licence and implementation', accountId: meridian.id, dealId: deals[2].id, bidId: bids[2].id, number: 'MLI-PO-77812', value: 1320000, startDate: day(-15), endDate: day(350), status: 'active', autoRenew: true, billing: '50% on signing, 50% on go-live', terms: '' },
    { ...base(500), code: `${P}CT-0003`, title: 'Website redesign and hosting', accountId: nsu.id, dealId: null, bidId: null, number: 'NSU-2024-031', value: 210000, startDate: day(-500), endDate: day(-135), status: 'expired', autoRenew: false, billing: 'One-time', terms: '' },
    { ...base(45), code: `${P}CT-0004`, title: 'Learning management system, phase 2: implementation', accountId: nsu.id, dealId: deals[6].id, bidId: null, number: 'NSU-2026-204', value: 1650000, startDate: day(-42), endDate: day(80), status: 'active', autoRenew: false, billing: '30% on design sign-off, 70% on acceptance', terms: 'Gradebook and parent portal; four batches of faculty training; 90 days of warranty support.' },
  ];

  const activity = (type, rel, relType, subject, body, dueIn, done, created) => ({
    id: randomUUID(), type, subject, body, dueDate: dueIn === null ? null : day(dueIn), dueTime: null, outcome: '', related: { type: relType, id: rel.id },
    ownerId: DEMO_OWNER, createdBy: DEMO_OWNER, createdAt: at(-created), done, doneAt: done ? at(-created) : null,
  });
  acts.push(
    activity('task', bids[0], 'bid', 'Get the bid security from the bank', '', 0, false, 3),
    activity('task', deals[0], 'deal', 'Send revised price schedule to Paolo', '', -1, false, 4),
    activity('meeting', deals[3], 'deal', 'Site visit: Valenzuela plant', 'Walk through the biometric devices and shift patterns.', 3, false, 2),
    activity('call', deals[0], 'deal', 'Pricing call with the VP for Administration', 'She wants a 3-year support option and staggered payments.', null, true, 6),
    activity('task', contracts[0], 'contract', 'Prepare the renewal quotation', '', 5, false, 1),
    activity('note', bayani, 'account', 'Background', 'Three plants; about 900 employees on shifting schedules. Currently on spreadsheets.', null, true, 30),
    activity('email', deals[6], 'deal', 'Sent the phase 2 proposal', 'Proposal v2 with the gradebook and parent portal.', null, true, 60),
    activity('task', leads[0], 'lead', 'Call Andres about the seasonal payroll', '', 1, false, 1),
    activity('meeting', deals[4], 'deal', 'Discovery meeting with the Provincial IT Office', 'They have about 1,400 devices and no ticketing.', null, true, 21),
  );

  Object.assign(data, { crmAccounts: accounts, crmContacts: contacts, crmLeads: leads, crmDeals: deals, crmBids: bids, crmContracts: contracts, crmActivities: acts });
}

// Project Management: the LMS phase 2 delivery for Northfield State University (won deal and
// contract, about six weeks in), the provincial helpdesk bid being planned, and a small internal
// IT project, among ten. Tasks have sizes (XS to XL), not hours; only the SIS support contract
// tracks time (its support hours matter for the renewal), so only it has time logged. People are written as DEMO_USER('pm.demo') and so on; addDemo() swaps in the demo
// accounts' ids once they exist.
export const DEMO_USER = (username) => `demo-user:${username}`;
function seedProjects(data, c) {
  const P = c.crmPrefix ?? '';
  const now = Date.now();
  const at = (days) => new Date(now + days * 86400000).toISOString();
  const day = (days) => localDate(new Date(now + days * 86400000));
  // A working day: a weekend day or a holiday moves back to the working day before.
  const off = new Set(data.holidays.filter((h) => h.type === 'regular' || h.type === 'special').map((h) => h.date));
  const wd = (days) => {
    for (let n = days; n > days - 10; n--) {
      const dow = new Date(now + n * 86400000).getDay();
      if (dow !== 0 && dow !== 6 && !off.has(day(n))) return day(n);
    }
    return day(days);
  };
  const [pmU, juan, it, sales] = ['pm.demo', 'employee.demo', 'it.demo', 'sales.demo'].map(DEMO_USER);
  const [nsu, , , , islaVerde] = data.crmAccounts;
  const statusIn = (p, id) => p.statuses.find((x) => x.id === id);
  const projects = [];
  const milestones = [];
  const tasks = [];
  const comments = [];
  const logs = [];
  const notes = [];
  const views = [];

  function project(n, fields, ms, rows) {
    const code = `${P}PRJ-${String(n).padStart(4, '0')}`;
    const p = {
      id: randomUUID(), code, statuses: structuredClone(DEFAULT_STATUSES), healthOverride: null, taskSeq: 0, version: 1, timeTracking: false, budgetHours: null,
      accountId: null, dealId: null, contractId: null, description: '', createdAt: at(-60), createdBy: fields.managerId, updatedAt: at(-1), updatedBy: fields.managerId,
      history: [{ at: at(fields.createdDaysAgo ? -fields.createdDaysAgo : -60), by: fields.managerId, field: 'created', from: '', to: '' }], ...fields,
    };
    if (fields.createdDaysAgo) p.createdAt = at(-fields.createdDaysAgo);
    delete p.createdDaysAgo;
    projects.push(p);
    const mIds = ms.map(([name, due, deliverable, billingPercent, submitted, accepted, note], i) => {
      const m = { id: randomUUID(), projectId: p.id, name, dueDate: wd(due), deliverable, billingPercent: billingPercent ?? null, submittedAt: submitted == null ? null : wd(submitted), acceptedAt: accepted == null ? null : wd(accepted), acceptanceNote: note || '', order: i, version: 1, createdAt: at(-60), updatedAt: at(-2) };
      milestones.push(m);
      return m.id;
    });
    const byKey = {};
    rows.forEach(([ref, title, mi, st, who, start, due, size, extra = {}], i) => {
      const n2 = ++p.taskSeq;
      // Added before its start (or as `added` says: a task that came in later, for the burn-up).
      const added = extra.added ?? Math.min(-45, (start ?? -45) - 3);
      const t = {
        id: randomUUID(), projectId: p.id, key: `${code}-${n2}`, title, description: extra.description || '', statusId: st, priority: extra.priority || 'normal',
        assigneeId: who, startDate: start == null ? null : wd(start), dueDate: due == null ? null : wd(due), size: size ?? null,
        milestoneId: mi == null ? null : mIds[mi], parentId: extra.parent ? byKey[extra.parent].id : null,
        checklist: (extra.checklist || []).map(([text, done]) => ({ id: randomUUID(), text, done })), blockedBy: (extra.blockedBy || []).map((k) => byKey[k].id),
        ticketId: extra.ticketId || null, rank: (i + 1) * 1024, completedAt: statusIn(p, st).category === 'done' ? at(due == null ? -1 : Math.min(-1, due)) : null,
        version: 1, createdAt: at(added), createdBy: fields.managerId, updatedAt: at(-1), updatedBy: who || fields.managerId,
        history: [{ at: at(added), by: fields.managerId, field: 'created', from: '', to: '' }],
        // Watchers: who added it (the manager) and its assignee, as CORE does, plus any named here.
        watchers: [...new Set([fields.managerId, who, ...(extra.watchers || [])].filter(Boolean))], attachments: [],
      };
      if (statusIn(p, st).category !== 'todo') t.history.push({ at: at(Math.min(-1, start ?? -1)), by: who || fields.managerId, field: 'status', from: p.statuses[0].name, to: statusIn(p, st).name });
      byKey[ref] = t;
      tasks.push(t);
    });
    return { p, byKey };
  }

  // 1. LMS phase 2 for Northfield State University: active, about six weeks in.
  const won = data.crmDeals[6];
  const lmsContract = data.crmContracts.find((x) => x.dealId === won.id);
  const lms = project(1, {
    name: 'Learning management system, phase 2', icon: { glyph: 'cap', color: 'blue' }, type: 'Client', status: 'active', startDate: wd(-42), endDate: wd(50), managerId: pmU,
    members: [{ userId: pmU, role: 'manager' }, { userId: juan, role: 'member' }, { userId: it, role: 'member' }, { userId: sales, role: 'viewer' }],
    accountId: nsu.id, dealId: won.id, contractId: lmsContract.id,
    description: 'Gradebook and parent portal for the LMS delivered in phase 1, with faculty training. Billing: 30% on design sign-off, 70% on acceptance.',
  }, [
    ['Design and requirements sign-off', -21, true, 30, -22, -18, 'Signed by the VP for Administration.'],
    ['Gradebook and parent portal build', 5, false],
    ['User acceptance testing', 24, false],
    ['Go-live and acceptance', 45, true, 70],
  ], [
    ['kick', 'Kick-off meeting with the deans', 0, 'done', pmU, -42, -41, 'S'],
    ['req', 'Requirements workshops with the three colleges', 0, 'done', pmU, -40, -33, 'M'],
    ['gdd', 'Gradebook design document', 0, 'done', juan, -35, -26, 'M'],
    ['wire', 'Parent portal wireframes', 0, 'done', juan, -33, -27, 'M'],
    ['sign', 'Design sign-off with the VP for Administration', 0, 'done', pmU, -24, -22, 'XS'],
    ['weights', 'Gradebook: grading periods and weights', 1, 'done', juan, -20, -10, 'L'],
    ['import', 'Gradebook: import class lists from the SIS', 1, 'doing', juan, -12, -2, 'S', { priority: 'high', description: '## What it does\nEach night, the gradebook reads the **class lists** from the SIS export and adds or drops students in each section.\n\n## How\n1. The registrar saves the export as CSV (see the [SIS export guide](https://example.com/sis-export)).\n2. The import maps each `course_code` to a gradebook section.\n3. Students in two sections (*cross-enrolled*) appear in both.\n\n> Ask the registrar before changing the export columns: other offices read the same file.', checklist: [['Map SIS course codes', true], ['Handle cross-enrolled students', true], ['Test with the College of Engineering lists', false]] }],
    ['login', 'Parent portal: sign-in and linking to students', 1, 'doing', juan, -8, 3, 'S'],
    ['grades', 'Parent portal: grades and attendance pages', 1, 'todo', juan, 1, 5, 'M', { blockedBy: ['login'] }],
    ['staging', 'Set up the staging server', 1, 'done', it, -18, -14, 'S'],
    ['ssl', 'SSL certificate and domain for the parent portal', 1, 'waiting', it, -10, -3, 'XS', { added: -12, description: 'Waiting for the university\'s IT office to add the DNS record.' }],
    ['privacy', 'Data privacy notice for parents', 1, 'review', pmU, -7, 2, 'S', { added: -8, checklist: [['Draft the notice', true], ['Review with the university\'s DPO', false]] }],
    ['reports', 'Gradebook reports', 1, 'doing', juan, -6, 5, null],
    ['r1', 'Class record report', null, 'done', juan, -6, -3, 'S', { parent: 'reports' }],
    ['r2', 'Report card PDF', null, 'doing', juan, -2, 4, 'S', { parent: 'reports' }],
    ['r3', 'Dean\'s summary of grades', null, 'todo', juan, 3, 5, 'S', { parent: 'reports' }],
    ['scripts', 'UAT test scripts', 2, 'todo', pmU, 2, 12, 'M'],
    ['uat', 'UAT sessions with the registrar and two deans', 2, 'todo', pmU, 14, 20, 'M'],
    ['fixes', 'Fix the UAT findings', 2, 'todo', juan, 18, 23, 'M'],
    ['load', 'Load test with 3,000 parents', 2, 'todo', it, 10, 16, 'S'],
    ['train', 'Faculty training, four batches', 3, 'todo', pmU, 28, 38, 'M', { checklist: [['Book the AVR', false], ['Training manual', false], ['Attendance sheets', false]] }],
    ['announce', 'Parent portal launch announcement', 3, 'todo', pmU, 38, 40, 'S'],
    ['cutover', 'Go-live cut-over', 3, 'todo', it, 41, 42, 'S', { priority: 'high' }],
    ['accept', 'Acceptance certificate signed', 3, 'todo', pmU, 43, 45, 'XS', { watchers: [sales] }],
    ['weekly', 'Weekly status report to the VP', null, 'todo', pmU, null, 2, 'XS'],
    ['shells', 'Migrate phase 1 course shells', null, 'cancelled', juan, -15, -10, 'S', { description: 'Not needed: the university keeps phase 1 as it is.' }],
    ['emails', 'Collect the parents\' email list from the registrar', 1, 'waiting', pmU, -9, -4, 'XS', { added: -10 }],
  ]);
  const k = lms.byKey;
  comments.push(
    { id: randomUUID(), taskId: k.import.id, projectId: lms.p.id, userId: pmU, body: '@employee.demo the Engineering lists have about 40 cross-enrolled students. Can you check them before the build review?', createdAt: at(-3) },
    { id: randomUUID(), taskId: k.import.id, projectId: lms.p.id, userId: juan, body: 'Checked 32 of them. The other 8 need the registrar\'s updated list; I asked Teresa for it.', createdAt: at(-2) },
    { id: randomUUID(), taskId: k.ssl.id, projectId: lms.p.id, userId: it, body: 'Still waiting for Paolo (IT Director) to add the DNS record. Followed up by email today.', createdAt: at(-1) },
    { id: randomUUID(), taskId: k.login.id, projectId: lms.p.id, userId: it, body: 'The staging server has the parent portal build now; the test parent accounts are ready.', createdAt: at(-1) },
    { id: randomUUID(), taskId: k.login.id, projectId: lms.p.id, userId: pmU, body: 'Thanks. Can we show the sign-in to the registrar on Friday?', createdAt: at(-0.2) },
  );
  // "For you" for Juan (employee.demo): unread mentions, comments and an assignment; older ones read.
  const note = (userId, kind, proj, task, actorId, text, daysAgo, read = false) => notes.push({ id: randomUUID(), userId, kind, projectId: proj.id, taskId: task?.id || null, actorId, text, at: at(-daysAgo), readAt: read ? at(-daysAgo + 0.1) : null });
  note(juan, 'mentioned', lms.p, k.import, pmU, `mentioned you on ${k.import.key}: “@employee.demo the Engineering lists have about 40 cross-enrolled students. Can you…”`, 3);
  note(juan, 'commented', lms.p, k.login, it, `commented on ${k.login.key}: “The staging server has the parent portal build now; the test parent accounts are ready.”`, 1);
  note(juan, 'commented', lms.p, k.login, pmU, `commented on ${k.login.key}: “Thanks. Can we show the sign-in to the registrar on Friday?”`, 0.2);
  note(juan, 'assigned', lms.p, k.fixes, pmU, `assigned you ${k.fixes.key} ${k.fixes.title}`, 2);
  note(juan, 'status', lms.p, k.wire, pmU, `moved ${k.wire.key} to Done`, 27, true);
  note(juan, 'added', lms.p, null, pmU, `added you to ${lms.p.code} ${lms.p.name} as member`, 42, true);
  // Saved views shared with the project by its manager.
  views.push(
    { id: randomUUID(), projectId: lms.p.id, userId: null, createdBy: pmU, tab: 'board', name: 'Due this week', query: 'f=week', createdAt: at(-20) },
    { id: randomUUID(), projectId: lms.p.id, userId: null, createdBy: pmU, tab: 'list', name: 'High and urgent, by status', query: 'f=high&group=status', createdAt: at(-20) },
  );
  // The last ten working days up to yesterday (time logged on the SIS support contract).
  const workDays = [];
  for (let i = 1; workDays.length < 10 && i < 30; i++) {
    const dow = new Date(now - i * 86400000).getDay();
    if (dow !== 0 && dow !== 6 && !off.has(day(-i))) workDays.push(i);
  }

  // 2. The provincial helpdesk: a government bid being planned, deliverables from the terms of reference.
  project(2, {
    name: 'Provincial helpdesk and asset tracking', icon: { glyph: 'headset', color: 'teal' }, type: 'Government', status: 'planning', startDate: wd(21), endDate: wd(140), managerId: pmU,
    members: [{ userId: pmU, role: 'manager' }, { userId: it, role: 'member' }, { userId: sales, role: 'viewer' }],
    accountId: islaVerde.id, dealId: data.crmDeals[4].id,
    description: 'If the bid is awarded: an ICT helpdesk and asset management system for 12 provincial offices, about 1,400 devices.',
  }, [
    ['Inception report and work plan', 35, true, 15],
    ['System installed in the 12 offices', 90, true, 45],
    ['Training and turnover', 130, true, 40],
  ], [
    ['kick', 'Kick-off with the Provincial IT Office', 0, 'todo', pmU, 21, 21, 'S'],
    ['inv', 'Inventory of devices per office', 0, 'todo', it, 22, 33, 'L'],
    ['inception', 'Write the inception report', 0, 'todo', pmU, 25, 35, 'M'],
    ['install', 'Install and configure the service desk', 1, 'todo', it, 40, 85, 'XL'],
    ['focal', 'Train the office focal persons', 2, 'todo', pmU, 95, 125, 'L'],
  ]);

  // 3. A small internal IT project.
  project(3, {
    name: 'Office network refresh', icon: { glyph: 'laptop', color: 'violet' }, type: 'Internal', status: 'active', startDate: wd(-10), endDate: wd(20), managerId: it,
    members: [{ userId: it, role: 'manager' }, { userId: juan, role: 'member' }],
    description: 'New PoE switches and cabling on the 3rd floor; Wi-Fi in the meeting rooms.',
  }, [['New switches live', 10, false]], [
    ['survey', 'Survey the 3rd floor cabling', 0, 'done', it, -10, -8, 'S'],
    ['order', 'Order two PoE switches', 0, 'done', it, -8, -7, 'XS'],
    ['replace', 'Replace the switches on the 3rd floor', 0, 'doing', it, 2, 4, 'S', { priority: 'high', checklist: [['Schedule after office hours', true], ['Back up the switch configuration', false], ['Label the patch panel', false]] }],
    ['wifi', 'Wi-Fi access point for meeting room B', 0, 'todo', juan, 5, 9, 'S'],
    ['diagram', 'Update the network diagram', null, 'todo', juan, 12, 15, 'XS'],
  ]);


  // ----- More projects, so every state and view has something to show -----
  const [hrU, payU] = ['hr.demo', 'payroll.demo'].map(DEMO_USER);
  const [, , meridian] = data.crmAccounts;
  const [sisContract, meridianContract, websiteContract] = data.crmContracts;
  const say = (proj, task, userId, body, daysAgo) => comments.push({ id: randomUUID(), taskId: task.id, projectId: proj.p.id, userId, body, createdAt: at(-daysAgo) });
  // Time on the last ten working days (a project that tracks time): rows of [userId, taskRef or
  // null, hours, note] per day.
  const logDays = (proj, perDay) => workDays.forEach((ago, i) => {
    for (const [userId, ref, hours, note] of perDay(i)) logs.push({ id: randomUUID(), projectId: proj.p.id, taskId: ref ? proj.byKey[ref].id : null, userId, date: day(-ago), hours, note: note || '', createdAt: at(-ago) });
  });

  // 4. Meridian's warehouse HR and payroll rollout: won three weeks ago, early in delivery. The
  // In progress column has a WIP limit of 3 (four tasks are in it, so the board warns), and the
  // manager's reading is "off track", worse than what the tasks alone show.
  const meridianRollout = project(4, {
    name: 'Warehouse HR and payroll rollout', icon: { glyph: 'box', color: 'amber' }, type: 'Client', status: 'active', startDate: wd(-14), endDate: wd(75), managerId: pmU,
    members: [{ userId: pmU, role: 'manager' }, { userId: payU, role: 'member' }, { userId: hrU, role: 'member' }, { userId: juan, role: 'member' }, { userId: sales, role: 'viewer' }],
    accountId: meridian.id, dealId: data.crmDeals[2].id, contractId: meridianContract.id,
    description: 'HR records, attendance and payroll for 420 warehouse staff in two sites. Billing: 50% on signing (paid), 50% on go-live.',
    statuses: DEFAULT_STATUSES.map((x) => (x.id === 'doing' ? { ...structuredClone(x), wipLimit: 3 } : structuredClone(x))),
    healthOverride: { value: 'red', note: 'Off track in practice: Meridian\'s HR has not sent the 2026 leave balances, so the parallel run will move a week unless they arrive by Friday.', by: pmU, at: at(-1) },
  }, [
    ['Set-up and data migration', 12, false],
    ['Parallel payroll run', 40, false],
    ['Go-live and acceptance', 70, true, 50],
  ], [
    ['kick', 'Kick-off with Grace Lim and the site supervisors', 0, 'done', pmU, -14, -13, 'S'],
    ['master', 'Employee master file from Meridian\'s spreadsheet', 0, 'doing', hrU, -10, 3, 'M', { checklist: [['Template sent', true], ['Site A file received', true], ['Site B file received', false], ['Duplicates removed', false]] }],
    ['sched', 'Shift schedules for both warehouses', 0, 'doing', juan, -6, 5, 'S'],
    ['leave', 'Opening leave balances for 2026', 0, 'waiting', hrU, -8, 2, 'S', { priority: 'high', description: 'Waiting for Meridian\'s HR to send the balances as of the go-live month.' }],
    ['rates', 'Pay rules: night differential and holiday premiums', 0, 'doing', payU, -5, 6, 'M'],
    ['bio', 'Connect the biometric clocks at Site A', 0, 'doing', juan, -3, 8, 'S', { blockedBy: ['sched'] }],
    ['users', 'User accounts for the site supervisors', 0, 'todo', juan, 7, 10, 'M'],
    ['parallel1', 'Parallel run: first cut-off', 1, 'todo', payU, 20, 27, 'M', { blockedBy: ['master', 'rates'] }],
    ['compare', 'Compare against the old payroll and explain each difference', 1, 'todo', payU, 27, 33, 'S'],
    ['parallel2', 'Parallel run: second cut-off', 1, 'todo', payU, 34, 40, 'M'],
    ['train', 'Train the payroll and HR staff', 2, 'todo', pmU, 50, 60, 'M'],
    ['golive', 'Go-live payroll', 2, 'todo', payU, 62, 66, 'S', { priority: 'high' }],
    ['accept', 'Acceptance and turnover', 2, 'todo', pmU, 66, 70, 'XS'],
  ]);
  say(meridianRollout, meridianRollout.byKey.leave, pmU, '@hr.demo can you call Grace tomorrow? Without the balances the parallel run will be off.', 2);
  note(hrU, 'mentioned', meridianRollout.p, meridianRollout.byKey.leave, pmU, `mentioned you on ${meridianRollout.byKey.leave.key}: “@hr.demo can you call Grace tomorrow? Without the balances the parallel run…”`, 2);
  say(meridianRollout, meridianRollout.byKey.leave, hrU, 'Called her. Site A is ready; Site B will send theirs on Thursday.', 1);
  say(meridianRollout, meridianRollout.byKey.bio, juan, 'Site A has 6 devices of the same model as Bayani\'s. The import should work as is.', 1);

  // 5. Support for the student information system: a year-long contract with its own statuses
  // (Backlog, In progress, Client sign-off, Released), two releases a year, ending in 40 days. It
  // tracks time: the support hours go into the renewal discussion.
  const sis = project(5, {
    name: 'SIS support and maintenance, 2025–2026', icon: { glyph: 'database', color: 'green' }, type: 'Client', status: 'active', startDate: wd(-325), endDate: wd(40), managerId: it, createdDaysAgo: 325,
    members: [{ userId: it, role: 'manager' }, { userId: juan, role: 'member' }, { userId: pmU, role: 'viewer' }, { userId: sales, role: 'viewer' }],
    accountId: nsu.id, contractId: sisContract.id, timeTracking: true, budgetHours: 300,
    description: '8x5 support for the student information system and two releases a year, under contract NSU-2025-118. Renewal is being discussed in Sales & CRM.',
    statuses: [
      { id: 'backlog', name: 'Backlog', category: 'todo', color: 'gray' },
      { id: 'doing', name: 'In progress', category: 'active', color: 'blue', wipLimit: 2 },
      { id: 'signoff', name: 'Client sign-off', category: 'active', color: 'violet' },
      { id: 'released', name: 'Released', category: 'done', color: 'green' },
      { id: 'cancelled', name: 'Cancelled', category: 'cancelled', color: 'gray' },
    ],
  }, [
    ['Release 2025.2', -200, true, 50, -203, -196, 'Accepted by Paolo Santiago.'],
    ['Release 2026.1', 5, true, 50, -2, null],
    ['Renewal decision', 30, false],
  ], [
    ['enrol', 'Online enrolment for second semester', 0, 'released', juan, -260, -205, 'XL'],
    ['tor', 'Transcript of records PDF', 0, 'released', juan, -240, -206, 'M'],
    ['perf', 'Speed up the grade encoding page', 1, 'released', juan, -90, -40, 'L'],
    ['sched', 'Class scheduling conflicts report', 1, 'released', juan, -70, -32, 'M'],
    ['sso', 'Single sign-on with the LMS', 1, 'signoff', juan, -60, 4, 'S', { description: 'Released; Paolo is checking it with the College of Nursing before signing the release.' }],
    ['patch', 'Monthly security patches', null, 'doing', it, -5, 3, 'S'],
    ['backup', 'Restore test of the nightly backup', null, 'backlog', it, 10, 12, 'S'],
    ['report', 'Support report for the renewal (tickets, response times)', 2, 'backlog', it, 15, 25, 'S', { priority: 'high' }],
    ['handover', 'Handover notes if the contract is not renewed', 2, 'backlog', it, 28, 38, 'S'],
    ['mobile', 'Mobile view of the student portal', null, 'cancelled', juan, -150, -120, 'L', { description: 'Moved to the phase 2 proposal instead.' }],
  ]);
  say(sis, sis.byKey.sso, it, '@pm.demo Paolo says the Nursing check takes another week. Can the LMS team keep their test accounts open until then?', 3);
  note(pmU, 'mentioned', sis.p, sis.byKey.sso, it, `mentioned you on ${sis.byKey.sso.key}: “@pm.demo Paolo says the Nursing check takes another week. Can the LMS team…”`, 3);
  logDays(sis, (i) => [[it, i % 2 ? 'patch' : null, 1, i % 2 ? '' : 'Support tickets'], ...(i < 3 ? [[juan, 'sso', 1.5, 'Fixes from the Nursing check']] : [])]);

  // 6. A finished project: the university website, delivered and accepted, contract expired.
  project(6, {
    name: 'University website redesign', type: 'Client', status: 'completed', startDate: wd(-500), endDate: wd(-150), managerId: pmU, createdDaysAgo: 505,
    members: [{ userId: pmU, role: 'manager' }, { userId: juan, role: 'member' }],
    accountId: nsu.id, contractId: websiteContract.id,
    description: 'New public website on the university\'s own hosting, with a news section for each college. Delivered and accepted.',
  }, [
    ['Design approved', -430, true, 40, -432, -428, 'Approved by the Office of the President.'],
    ['Launch and acceptance', -160, true, 60, -165, -158, 'Acceptance certificate NSU-ACC-2025-07.'],
  ], [
    ['brief', 'Content inventory and sitemap', 0, 'done', pmU, -500, -480, 'M'],
    ['design', 'Home and college page designs', 0, 'done', juan, -480, -435, 'XL'],
    ['build', 'Build the templates', 1, 'done', juan, -425, -300, 'XL'],
    ['news', 'News section per college', 1, 'done', juan, -300, -240, 'L'],
    ['migrate', 'Move 1,200 pages from the old site', 1, 'done', pmU, -260, -190, 'L'],
    ['launch', 'Launch and redirects from the old addresses', 1, 'done', juan, -170, -165, 'S'],
    ['handover', 'Train the web editors', 1, 'done', pmU, -165, -160, 'S'],
  ]);

  // 7. Internal, off track: year-end payroll work whose first milestone has passed with work open.
  const yearEnd = project(7, {
    name: 'Year-end payroll and 2027 tax tables', icon: { glyph: 'wallet', color: 'brand' }, type: 'Internal', status: 'active', startDate: wd(-30), endDate: wd(45), managerId: payU,
    members: [{ userId: payU, role: 'manager' }, { userId: hrU, role: 'member' }, { userId: pmU, role: 'viewer' }],
    description: 'Get payroll ready for the year-end: contribution checks, 2027 tax tables in Payroll Setup, the 13th month pay and the annual reports to the BIR.',
  }, [
    ['Contributions reconciled', -3, false],
    ['13th month pay released', 30, false],
    ['Annual reports filed', 45, false],
  ], [
    ['sss', 'Reconcile SSS, PhilHealth and Pag-IBIG remittances, January to October', 0, 'doing', payU, -25, -6, 'M', { priority: 'high', checklist: [['SSS', true], ['PhilHealth', true], ['Pag-IBIG', false]] }],
    ['loans', 'Check the salary loan deductions against the SSS statements', 0, 'todo', payU, -10, -4, 'S'],
    ['tax', 'Enter the 2027 tax tables in Payroll Setup', 1, 'todo', payU, 5, 12, 'S', { description: 'Use the BIR\'s revenue regulations for 2027 once published; check against last year\'s table.' }],
    ['thirteenth', 'Compute the 13th month pay and check it with HR', 1, 'todo', payU, 15, 25, 'S'],
    ['separated', 'Final pay for the three separated employees', 1, 'doing', hrU, -4, 8, 'S'],
    ['alpha', 'Prepare the alphalist of employees', 2, 'todo', payU, 30, 42, 'M'],
    ['certs', 'Certificates of tax withheld for each employee', 2, 'todo', hrU, 32, 44, 'S'],
  ]);
  say(yearEnd, yearEnd.byKey.sss, payU, 'Pag-IBIG\'s statement for September is missing. Requested a copy; the milestone will be a few days late.', 2);

  // 8. On hold, with the manager's note.
  project(8, {
    name: 'Data privacy compliance review (RA 10173)', icon: { glyph: 'shield', color: 'red' }, type: 'Internal', status: 'on_hold', startDate: wd(-50), endDate: wd(60), managerId: hrU,
    members: [{ userId: hrU, role: 'manager' }, { userId: it, role: 'member' }, { userId: pmU, role: 'viewer' }],
    description: 'Annual review of how the company keeps personal data. On hold until the new Data Protection Officer is appointed.',
    healthOverride: { value: 'amber', note: 'Paused on purpose: waiting for the DPO appointment from management, expected next month.', by: hrU, at: at(-12) },
  }, [['Inventory of personal data', -10, false], ['Privacy impact assessment', 40, false]], [
    ['inventory', 'List the systems and files that hold personal data', 0, 'done', hrU, -50, -30, 'M'],
    ['access', 'Review who can see pay and government IDs', 0, 'done', it, -40, -25, 'S', { description: 'Done with the Users & Access table and the audit log.' }],
    ['retention', 'Retention periods for applicant files', 0, 'waiting', hrU, -25, -12, 'XS'],
    ['pia', 'Privacy impact assessment for the clock-in locations', 1, 'todo', hrU, 20, 35, 'M'],
    ['notice', 'Update the employee privacy notice', 1, 'todo', hrU, 30, 40, 'S'],
  ]);

  // 9. Cancelled, with the reason in the description.
  project(9, {
    name: 'Move the file server to the cloud', type: 'Internal', status: 'cancelled', startDate: wd(-90), endDate: wd(-20), managerId: it,
    members: [{ userId: it, role: 'manager' }, { userId: juan, role: 'member' }],
    description: 'Cancelled: the quote for the internet upgrade came in above budget. Revisit next year with the new lease line.',
  }, [['Pilot with the Sales folder', -40, false]], [
    ['quote', 'Quotes for storage and the internet upgrade', 0, 'done', it, -90, -70, 'S'],
    ['pilot', 'Pilot with the Sales folder', 0, 'cancelled', juan, -60, -40, 'M'],
    ['policy', 'Folder permissions plan', 0, 'cancelled', it, -60, -45, 'S'],
  ]);

  // 10. Internal laptop refresh, with a task linked to Juan's service desk ticket.
  const battery = data.tickets.find((x) => x.subject === 'Laptop battery drains very fast');
  const laptops = project(10, {
    name: 'Laptop refresh, engineering team', type: 'Internal', status: 'active', startDate: wd(-7), endDate: wd(30), managerId: it,
    members: [{ userId: it, role: 'manager' }, { userId: juan, role: 'member' }, { userId: payU, role: 'viewer' }],
    description: 'Replace the five oldest engineering laptops and re-image them; the old units go to the training room.',
  }, [['New laptops issued', 21, false]], [
    ['list', 'List the five oldest units from IT Assets', 0, 'done', it, -7, -6, 'XS'],
    ['quote', 'Get three quotes and the purchase approval', 0, 'doing', it, -5, 4, 'S'],
    ['image', 'Prepare the standard image', 0, 'todo', it, 5, 10, 'S'],
    ['juan', 'Juan\'s laptop: battery first, then a replacement unit', 0, 'doing', it, -1, 2, 'XS', { priority: 'high', ticketId: battery?.id || null }],
    ['issue', 'Issue the new laptops and record them in IT Assets', 0, 'todo', it, 15, 21, 'S'],
    ['training', 'Move the old units to the training room', null, 'todo', juan, 22, 28, 'XS'],
  ]);
  say(laptops, laptops.byKey.juan, it, 'Battery ordered. Linked to his ticket so the service desk sees where it is.', 1);

  // People who commented on a task watch it, as in CORE.
  for (const cm of comments) {
    const t = tasks.find((x) => x.id === cm.taskId);
    if (t && !t.watchers.includes(cm.userId)) t.watchers.push(cm.userId);
  }
  Object.assign(data, { pmProjects: projects, pmMilestones: milestones, pmTasks: tasks, pmComments: comments, pmTimeLogs: logs, pmNotifications: notes, pmViews: views });
}

// A few service desk tickets in different states, from the demo employees.
function seedTickets(data, c) {
  const [, juan, andrea, mark, kristine] = data.employees;
  const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
  const person = (e) => ({ userId: null, name: `${e.firstName} ${e.lastName}`, email: e.email });
  const it = { userId: null, name: 'Demo IT Asset Manager', email: null, role: 'agent' };
  const msg = (author, body, at, kind = 'reply') => ({ id: randomUUID(), kind, author, body, at, via: 'web', attachments: [] });
  const make = (n, e, subject, category, priority, status, createdHoursAgo, channel, messages) => {
    const createdAt = ago(createdHoursAgo);
    const firstAgent = messages.find((m) => m.author.role === 'agent' && m.kind === 'reply');
    return {
      id: randomUUID(), number: n, ref: ticketRef(n), subject, status, priority, category, channel,
      requester: person(e), assigneeId: null, assetId: null, ccs: [], createdAt, updatedAt: messages.at(-1).at,
      firstResponseAt: firstAgent?.at || null, resolvedAt: status === 'resolved' ? messages.at(-1).at : null, closedAt: null,
      ...slaDue(createdAt, priority), messages, emailIds: [],
    };
  };
  const r = (e) => ({ ...person(e), role: 'requester' });
  data.tickets = [
    make(c.firstTicket + 0, kristine, 'Outlook keeps asking for my password', 'Email', 'normal', 'resolved', 52, 'email', [
      msg(r(kristine), 'Since this morning Outlook asks for my password every few minutes, even after I enter it.', ago(52)),
      msg(it, 'Your password expired over the weekend. I have reset it; please sign in with the temporary password I sent by SMS and set a new one.', ago(49)),
      msg(r(kristine), 'That fixed it, thank you!', ago(47)),
    ]),
    make(c.firstTicket + 1, mark, 'Request: second monitor for sales desk', 'Hardware', 'low', 'pending', 30, 'portal', [
      msg(r(mark), 'Could I get a second monitor? I work with the price list and CRM side by side all day.', ago(30)),
      msg(it, 'We have a 24" monitor in stock. Is tomorrow 10 am a good time to set it up?', ago(26)),
      msg(it, `Asset ${code(c.assetPrefix, 9)} (27" monitor in stock) can be used.`, ago(26), 'note'),
    ]),
    make(c.firstTicket + 2, juan, 'Laptop battery drains very fast', 'Hardware', 'normal', 'open', 5, 'portal', [
      msg(r(juan), 'My laptop goes from 100% to 20% in about an hour, even with only the browser open.', ago(5)),
    ]),
    make(c.firstTicket + 3, andrea, 'Cannot open the Projects shared drive', 'Account and access', 'high', 'new', 2, 'email', [
      msg(r(andrea), 'I get "Access denied" when I open \\\\fileserver\\projects since this morning. I need it for the client status report due today.', ago(2)),
    ]),
  ];
  data.helpdesk.seq = c.firstTicket + data.tickets.length - 1;
}

// IT assets and consumables, allocated to the demo employees, a department and a location.
function seedAssets(data, c) {
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
      id: randomUUID(), assetTag: code(c.assetPrefix, i + 1), name: `${brand} ${model}`, category, brand, model,
      serialNumber: `${c.serialPrefix}${brand.slice(0, 2).toUpperCase()}${(9137 + i * 7919).toString(36).toUpperCase()}${i}`, specs,
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

  // Two problem reports from employees: one IT is already checking, one still new.
  const reports = [
    [3, 'malfunction', 'limited', 'Battery drains from full to empty in about an hour, so I have to stay plugged in all day.', 6, 'in_progress',
      [[5, 'Demo IT Asset Manager', 'in_progress', 'Battery health is at 41%. Replacement battery ordered; we will swap it when it arrives.']]],
    [2, 'damage', 'cannot_work', 'The laptop fell off my desk. The screen has a crack across the middle and the left hinge is loose.', 1, 'open', []],
  ];
  reports.forEach(([i, type, impact, description, age, status, updates], n) => {
    const asset = data.assets[i];
    const number = code('IR-', c.firstReport + n);
    const by = asset.assignedTo;
    const reportedAt = daysAgo(age);
    data.issueReports.push({
      id: randomUUID(), number, assetId: asset.id, assetTag: asset.assetTag, assetName: asset.name,
      category: asset.category, serialNumber: asset.serialNumber, type, impact, description, noticedOn: dateAgo(age), status,
      reportedBy: { userId: null, employeeId: by.id, name: by.name, employeeNo: by.employeeNo, department: by.department },
      reportedAt, updatedAt: updates.length ? daysAgo(updates.at(-1)[0]) : reportedAt, closedAt: null,
      updates: updates.map(([d, who, st, note]) => ({ at: daysAgo(d), by: who, status: st, note })),
    });
    data.assetHistory.push({ id: randomUUID(), assetId: asset.id, assetTag: asset.assetTag, assetName: asset.name, action: 'issue',
      detail: `${type === 'damage' ? 'Physical damage' : 'Malfunction'} reported by ${by.name} (${number})`, at: reportedAt, by: by.name, notes: description.slice(0, 200) });
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
      id: randomUUID(), sku: code(c.skuPrefix, i + 1), name, category, unit, reorderLevel, location: 'IT Store Room',
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
