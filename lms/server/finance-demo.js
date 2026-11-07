// Finance demo data, added with the rest of the demo school (POST /api/admin/demo) and made the
// way real work is: every step goes through Finance's own routes as the right officer, so the
// books balance and each rule applies. The demo covers this fiscal year so far: beginning
// balances, appropriations, allotments and NCAs, procurement from request to payment (one
// delivery late, with liquidated damages), monthly utilities and janitorial services, a legal
// retainer, cash advances (one settled, one overdue), collections and deposits, stock issues and
// the RSMI, property with PAR/ICS, depreciation, a disposal, tax remittances, and a few items
// waiting in each office's queue. Every record it makes is marked demo: true.
import { randomUUID } from 'node:crypto';
import { hashPassword } from './auth.js';
import { DEMO_PASSWORD } from './demo.js';
import { depreciation, round2 } from '../shared/finance.js';

const FIN_ARRAYS = ['finCards', 'finJournals', 'finAppropriations', 'finAllotments', 'finNcas', 'finObligations', 'finItems', 'finStock', 'finPrs', 'finPos', 'finIars', 'finRis', 'finCounts', 'finProperty', 'finDepRuns', 'finDvs', 'finLddaps', 'finLiquidations', 'finRemittances', 'finBankRecons', 'finBooklets', 'finReceipts', 'finRcds', 'finRevenueTargets', 'finAudit'];

export function removeFinanceDemo(data) {
  for (const k of FIN_ARRAYS) data[k] = (data[k] || []).filter((x) => !x.demo);
  if (data.finDemoBackup) {
    const onlyDemo = FIN_ARRAYS.every((k) => k === 'finAudit' || !data[k].length);
    data.finSettings = data.finDemoBackup.settings;
    if (onlyDemo) data.finCounters = data.finDemoBackup.counters;
    delete data.finDemoBackup;
  }
}

const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`)) / 86400000);

export function addFinanceDemo(data, ctx) {
  removeFinanceDemo(data); // a refresh starts over (the demo accounts were just made again)
  const before = Object.fromEntries(FIN_ARRAYS.map((k) => [k, new Set(data[k].map((x) => x.id))]));
  data.finDemoBackup = { settings: structuredClone(data.finSettings), counters: structuredClone(data.finCounters) };
  const today = ctx.today();
  let Y = Number(today.slice(0, 4));
  let end = addDays(today, -1); // the demo's last day
  if (days(`${Y}-01-02`, end) < 120) { // early in the year: the demo keeps last year's books instead
    Y -= 1;
    end = `${Y}-12-28`;
  }
  const start = [addDays(end, -150), `${Y}-01-02`].sort().at(-1);
  const span = Math.max(1, days(start, end));
  const at = (f) => addDays(start, Math.round(span * f)); // a date in the demo's window (0 = start, 1 = end)
  const month = (d) => d.slice(0, 7);
  const prevMonth = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  };

  // ----- Accounts for the finance offices -----
  const main = data.campuses.find((c) => c.code === 'MAIN') || data.campuses[0];
  const hash = hashPassword(DEMO_PASSWORD);
  const account = (role, username, name) => {
    const u = { id: randomUUID(), demo: true, role, username: data.users.some((x) => x.username === username) ? `${username}2` : username, name, email: `${username}@example.edu`, status: 'active', mustChangePassword: false, passwordHash: hash, campusIds: [main.id], createdAt: new Date().toISOString() };
    data.users.push(u);
    return u;
  };
  const acct = account('accountant', 'accountant.demo', 'Teresita Lopez');
  const bud = account('budget', 'budget.demo', 'Ramil Ortega');
  const cash = account('cashier', 'cashier.demo', 'Lorna Esguerra');
  const sup = account('supply', 'supply.demo', 'Edgar Manalo');
  const head = account('approver', 'head.demo', 'Alicia Bautista');
  const as = (u) => ({
    get: (p) => ctx.invoke(u, 'GET', p),
    post: (p, b = {}) => ctx.invoke(u, 'POST', p, b),
    put: (p, b = {}) => ctx.invoke(u, 'PUT', p, b),
  });
  const A = as(acct);
  const B = as(bud);
  const C = as(cash);
  const S = as(sup);
  const H = as(head);
  const userBy = (username, name) => data.users.find((u) => u.demo && (u.username === username || u.name === name));

  // ----- Control panel -----
  const s = A.put('/api/finance/settings', {
    entity: { name: data.settings.schoolName, agencyCode: '08 099 0000000', address: 'San Jose, Pili, Camarines Sur 4418', tin: '000-123-456-000' },
    fiscalYear: Y,
    funds: ['01', '05', '07'],
    offices: [
      { code: 'OP', name: 'Office of the President', head: 'Dr. Alicia Bautista' }, { code: 'ADM', name: 'Administrative Services', head: 'Mr. Ronaldo Pascual' },
      { code: 'ACCT', name: 'Accounting Office', head: 'Ms. Teresita Lopez, CPA' }, { code: 'REG', name: 'Office of the Registrar', head: 'Ms. Rosa Villanueva' },
      { code: 'CCS', name: 'College of Computing Studies', head: 'Dr. Elena Cruz' }, { code: 'CA', name: 'College of Agriculture', head: 'Dr. Ramon Villareal' },
      { code: 'CBM', name: 'College of Business and Management', head: 'Dr. Liza Gonzales' }, { code: 'LIB', name: 'Library', head: 'Ms. Grace Aquino' },
    ],
    paps: [
      { code: '100000100001000', name: 'General Administration and Support Services' }, { code: '310100100001000', name: 'Higher Education Program' },
      { code: '320100100001000', name: 'Research Program' }, { code: '330100100001000', name: 'Technical Advisory Extension Program' },
    ],
    bankAccounts: [{ name: 'Bureau of the Treasury (agency deposit)', number: 'BTr-0499-001', fund: '01', code: '10104010' }, { name: 'LANDBANK Pili Branch', number: '0352-1047-88', fund: '05', code: '10102020' }, { name: 'LANDBANK Pili Branch (trust)', number: '0352-1047-96', fund: '07', code: '10102020' }],
    revenueItems: [
      { name: 'Free Higher Education billing (CHED-UniFAST)', code: '40202010', amount: 0, fund: '05' }, { name: 'Certification fee', code: '40201040', amount: 50, fund: '05' },
      { name: 'Transcript of records', code: '40201040', amount: 150, fund: '05' }, { name: 'Entrance examination fee', code: '40202030', amount: 200, fund: '05' },
      { name: 'Dormitory fee', code: '40202130', amount: 1500, fund: '05' }, { name: 'Canteen rental', code: '40202050', amount: 20000, fund: '05' },
      { name: 'Sale of farm produce', code: '40202160', amount: 0, fund: '05' },
    ],
    signatories: {
      head: { name: 'Dr. Alicia M. Bautista', title: 'University President' }, accountant: { name: 'Teresita D. Lopez, CPA', title: 'Chief Accountant' },
      budget: { name: 'Ramil C. Ortega', title: 'Budget Officer III' }, cashier: { name: 'Lorna P. Esguerra', title: 'Cashier III' },
      supply: { name: 'Edgar T. Manalo', title: 'Supply Officer III' }, inspector: { name: 'Engr. Paolo R. Sison', title: 'Chair, Inspection Committee' },
    },
  });
  const fee = (name) => s.revenueItems.find((r) => r.name.startsWith(name)).id;
  const bank05 = s.bankAccounts.find((b) => b.fund === '05').id;

  // ----- Card file -----
  const card = (body) => A.post('/api/finance/cards', body);
  const sp = {
    depot: card({ kind: 'supplier', name: 'Bicol Office Depot, Inc.', tin: '004-512-338-000', vat: 'vat', taxType: 'corporation', nature: 'goods', address: 'Magsaysay Ave., Naga City', contact: 'Ms. Joy Bermudez', phone: '(054) 472-1180', bankName: 'BDO', bankAccount: '0081-2233-44' }),
    tech: card({ kind: 'supplier', name: 'Naga Tech Solutions Corp.', tin: '009-221-874-000', vat: 'vat', taxType: 'corporation', nature: 'goods', address: 'Panganiban Drive, Naga City', contact: 'Mr. Kevin Tan', bankName: 'LANDBANK', bankAccount: '1702-0458-12' }),
    agri: card({ kind: 'supplier', name: 'Agri-Pinoy Farm Supply', tin: '412-305-998-000', vat: 'nonvat', taxType: 'individual', nature: 'goods', address: 'Del Rosario, Pili, Camarines Sur', contact: 'Mr. Danilo Rivera' }),
    janitor: card({ kind: 'supplier', name: 'Kalinisan Multi-Purpose Cooperative', tin: '277-640-115-000', vat: 'nonvat', taxType: 'corporation', nature: 'services', address: 'Cadlan, Pili, Camarines Sur' }),
    power: card({ kind: 'supplier', name: 'Camarines Sur II Electric Cooperative, Inc.', tin: '000-604-112-000', vat: 'vat', taxType: 'corporation', nature: 'services', address: 'Naga City' }),
    lawyer: card({ kind: 'individual', name: 'Atty. Ramon S. Garcia', tin: '145-882-301-000', vat: 'nonvat', taxType: 'individual', nature: 'professional', address: 'Peñafrancia Ave., Naga City' }),
    ched: card({ kind: 'agency', name: 'Commission on Higher Education – UniFAST', tin: '000-861-117-000', vat: 'exempt', address: 'Quezon City' }),
    old: card({ kind: 'supplier', name: 'Pili Printing Press', tin: '301-117-226-000', vat: 'nonvat', taxType: 'individual', nature: 'services', status: 'blacklisted', notes: 'Blacklisted after repeated non-delivery.' }),
  };
  const empCard = (u, position, office, extra = {}) => card({ kind: extra.kind || 'employee', name: u.name, userId: u.id, position, office, ...extra });
  const staffU = userBy('staff.demo', 'Nestor Abello');
  const people = {
    lorna: empCard(cash, 'Cashier III', 'ACCT', { kind: 'officer', bond: { amount: 150000, expires: `${Y + 1}-06-30`, policy: 'BTr-FB-2025-0331' } }),
    edgar: empCard(sup, 'Supply Officer III', 'ADM', { kind: 'officer', bond: { amount: 100000, expires: `${Y + 1}-06-30`, policy: 'BTr-FB-2025-0332' } }),
    maria: userBy('teacher.demo', 'Maria Santos') && empCard(userBy('teacher.demo', 'Maria Santos'), 'Associate Professor II', 'CCS'),
    juan: userBy('jdelacruz.demo', 'Juan Dela Cruz') && empCard(userBy('jdelacruz.demo', 'Juan Dela Cruz'), 'Instructor III', 'CCS', { bankName: 'LANDBANK', bankAccount: '1702-7741-30' }),
    leo: userBy('lmercado.demo', 'Leo Mercado') && empCard(userBy('lmercado.demo', 'Leo Mercado'), 'Laboratory custodian', 'CCS'),
    ramon: userBy('rvillareal.demo', 'Ramon Villareal') && empCard(userBy('rvillareal.demo', 'Ramon Villareal'), 'Dean, College of Agriculture', 'CA'),
    rosa: userBy('registrar.demo', 'Rosa Villanueva') && empCard(userBy('registrar.demo', 'Rosa Villanueva'), 'Registrar III', 'REG'),
    nestor: staffU && empCard(staffU, 'Administrative Aide (driver)', 'ADM'),
  };
  const custodian = (k) => people[k] || people.edgar;

  // ----- Beginning balances (fund 01 property, fund 05 cash) -----
  const last = `${Y - 1}-12`;
  const OLD = [
    ['Administration Building', '10604010', 18500000, '2012-06-10', 1, 'nestor'], ['Computer Laboratory Building', '10604020', 12000000, '2018-01-15', 1, 'leo'],
    ['Toyota Hilux 4x4 service vehicle (SAA 1234)', '10606010', 1650000, '2021-03-05', 1, 'nestor'], ['Kubota farm tractor L4508', '10605040', 1250000, '2019-08-20', 1, 'ramon'],
    ['Desktop computer, Core i5, 16GB, 24" monitor', '10605030', 55000, '2023-06-01', 6, 'leo'], ['Split-type air conditioner, 2.5 HP', '10605020', 68000, '2022-04-12', 2, 'rosa'],
    ['Conference table with 12 chairs', '10607010', 75000, '2020-02-03', 1, 'rosa'], ['Photocopier, heavy duty (old)', '10605020', 95000, '2014-05-20', 1, 'edgar'],
  ];
  const lines = [];
  const items = [];
  for (const [description, code, cost, acquired, qty, who] of OLD) {
    for (let n = 0; n < qty; n++) {
      const life = { 10604010: 30, 10604020: 30, 10606010: 7, 10605040: 10, 10605030: 5, 10605020: 5, 10607010: 10 }[code];
      const dep = depreciation({ cost, residual: round2(cost * 0.05), lifeYears: life, acquired }, last).accumulated;
      items.push({ description: qty > 1 ? `${description} (unit ${n + 1})` : description, code, cost, acquired, depBooked: dep, who });
    }
  }
  const byCode = {};
  for (const i of items) {
    byCode[i.code] ||= { cost: 0, dep: 0 };
    byCode[i.code].cost = round2(byCode[i.code].cost + i.cost);
    byCode[i.code].dep = round2(byCode[i.code].dep + i.depBooked);
  }
  for (const [code, x] of Object.entries(byCode)) {
    lines.push({ code, debit: x.cost });
    lines.push({ code: code.replace(/0$/, '1'), credit: x.dep });
  }
  const net = round2(Object.values(byCode).reduce((t, x) => t + x.cost - x.dep, 0));
  lines.push({ code: '30101010', credit: net });
  A.post('/api/finance/journals', { date: `${Y}-01-01`, fund: '01', journal: 'GJ', particulars: `Beginning balances of property, plant and equipment as of January 1, ${Y}`, lines, post: true });
  A.post('/api/finance/journals', { date: `${Y}-01-01`, fund: '05', journal: 'GJ', particulars: `Beginning balance of cash in bank (special trust fund) as of January 1, ${Y}`, lines: [{ code: '10102020', debit: 2500000 }, { code: '30101010', credit: 2500000 }], post: true });
  const registered = items.map((i) => ({ ...i, rec: S.post('/api/finance/property', { type: 'ppe', code: i.code, description: i.description, cost: i.cost, acquired: i.acquired, fund: '01', depBooked: i.depBooked, office: i.code === '10605040' ? 'CA' : i.code === '10605030' ? 'CCS' : 'ADM' }) }));
  for (const i of [['Steel filing cabinet, 4 drawers', '10406010', 12500, '2023-08-14'], ['Steel filing cabinet, 4 drawers', '10406010', 12500, '2023-08-14'], ['LCD projector, 4000 lumens', '10405030', 28000, '2024-01-22']]) {
    registered.push({ who: 'rosa', semi: true, rec: S.post('/api/finance/property', { type: 'semi', description: i[0], code: i[1], cost: i[2], acquired: i[3], fund: '01', expensed: true, office: 'REG' }) });
  }
  // Issue what is in use to its custodians (the old photocopier stays in the supply office).
  for (const r of registered) {
    if (r.description?.includes('(old)')) continue;
    S.post(`/api/finance/property/${r.rec.id}/issue`, { custodianId: custodian(r.who).id, date: at(0.01) });
  }

  // ----- Budget: appropriations, allotments, cash allocations -----
  const appr = (fund, pap, cls, kind, ref, amount) => B.post('/api/finance/appropriations', { fy: Y, fund, pap, cls, kind, ref, amount, date: start });
  const allot = (fund, pap, cls, kind, ref, amount, appropriationId) => B.post('/api/finance/allotments', { fy: Y, fund, pap, cls, kind, ref, amount, appropriationId, date: start });
  const HE = '310100100001000';
  const GA = '100000100001000';
  const apHE = appr('01', HE, 'MOOE', 'GAA – New appropriations', `GAA ${Y}, SUC item`, 12000000);
  const apGA = appr('01', GA, 'MOOE', 'GAA – New appropriations', `GAA ${Y}, SUC item`, 6000000);
  const apCO = appr('01', HE, 'CO', 'GAA – New appropriations', `GAA ${Y}, capital outlay`, 8000000);
  const apPS = appr('01', HE, 'PS', 'GAA – New appropriations', `GAA ${Y}, personnel services`, 64000000);
  const ap05 = appr('05', GA, 'MOOE', 'Board-approved budget (IGF/STF)', `BOR Res. No. 03, s. ${Y}`, 3000000);
  const al = {
    he: allot('01', HE, 'MOOE', 'GARO / ABM (comprehensive release)', `GARO-${Y}-01-0142`, 9000000, apHE.id),
    ga: allot('01', GA, 'MOOE', 'GARO / ABM (comprehensive release)', `GARO-${Y}-01-0142`, 4500000, apGA.id),
    co: allot('01', HE, 'CO', 'SARO', `SARO-BMB-C-${String(Y).slice(2)}-0003511`, 5000000, apCO.id),
    stf: allot('05', GA, 'MOOE', 'Board approval (IGF/STF)', `BOR Res. No. 03, s. ${Y}`, 3000000, ap05.id),
    // Personnel services: salaries and benefits, paid through ATLAS People's payroll.
    ps: allot('01', HE, 'PS', 'GARO / ABM (comprehensive release)', `GARO-${Y}-01-0142`, 48000000, apPS.id),
  };
  B.post('/api/finance/ncas', { no: `NCA-BMB-${String(Y).slice(2)}-${String(Y).slice(2)}0412`, date: start, amount: 6000000, particulars: 'MOOE and capital outlay, first release' });
  B.post('/api/finance/ncas', { no: `NCA-BMB-${String(Y).slice(2)}-${String(Y).slice(2)}1188`, date: at(0.5), amount: 5000000, particulars: 'MOOE and capital outlay, second release' });
  B.post('/api/finance/ncas', { no: `NCA-BMB-${String(Y).slice(2)}-${String(Y).slice(2)}0413`, date: start, amount: 30000000, particulars: 'Personnel services (salaries and benefits)' });

  // ----- Collections: FHE billing, fees, rent, farm produce (fund 05) -----
  const booklet = (from, fund, date) => C.post('/api/finance/booklets', { form: '51', from, to: from + 49, fund, collectorId: cash.id, date });
  booklet(4512001, '05', start);
  booklet(7730001, '01', start);
  const students = data.users.filter((u) => u.demo && u.role === 'student' && u.status === 'active').slice(0, 12);
  const carlo = data.users.find((u) => u.username === 'student.demo');
  const receipt = (date, payorName, lines, extra = {}) => C.post('/api/finance/receipts', { fund: '05', date, payorName, lines, ...extra });
  const rcdAndDeposit = (date, depositDate, fund = '05') => {
    const r = C.post('/api/finance/rcds', { fund, date });
    if (depositDate && fund === '05') C.post(`/api/finance/rcds/${r.id}/deposit`, { bankId: bank05, date: depositDate, slipNo: `DS-${String(400000 + Math.round(days(start, depositDate) * 37)).slice(0, 6)}` });
    return r;
  };
  receipt(at(0.04), 'Commission on Higher Education – UniFAST', [{ itemId: fee('Free Higher'), amount: 1850000, description: 'FHE billing, tuition and other school fees, 2nd semester' }], { payorCardId: sp.ched.id, mode: 'online' });
  rcdAndDeposit(at(0.04), at(0.05));
  const fees = [['Certification fee', 50], ['Transcript of records', 150], ['Entrance examination fee', 200], ['Dormitory fee', 1500]];
  for (let w = 0; w < 6; w++) {
    const d = at(0.1 + w * 0.14);
    students.slice(w, w + 4).forEach((st, k) => {
      const [name, amt] = fees[(w + k) % fees.length];
      receipt(d, st.name, [{ itemId: fee(name), amount: amt }], { studentId: st.id });
    });
    if (w % 2 === 0) receipt(d, 'Aling Nena\'s Canteen', [{ itemId: fee('Canteen rental'), amount: 20000, description: 'Canteen rental for the month' }]);
    if (w === 3) receipt(d, 'Pili Farmers Association', [{ itemId: fee('Sale of farm produce'), amount: 38500, description: 'Palay, 55 cavans' }]);
    rcdAndDeposit(d, addDays(d, 1) > end ? null : addDays(d, 1));
  }
  receipt(at(0.62), 'Commission on Higher Education – UniFAST', [{ itemId: fee('Free Higher'), amount: 1625000, description: 'FHE billing, tuition and other school fees, 1st semester' }], { payorCardId: sp.ched.id, mode: 'online' });
  rcdAndDeposit(at(0.62), at(0.63));
  if (carlo) receipt(end, carlo.name, [{ itemId: fee('Certification fee'), amount: 50 }, { itemId: fee('Transcript of records'), amount: 150 }], { studentId: carlo.id });
  rcdAndDeposit(end, null); // reported, not yet deposited
  if (students[0]) receipt(end, students[0].name, [{ itemId: fee('Certification fee'), amount: 50 }], { studentId: students[0].id }); // not yet reported
  C.put('/api/finance/revenue/targets', { fy: Y, fund: '05', targets: { 40202010: 6000000, 40201040: 120000, 40202030: 90000, 40202130: 300000, 40202050: 240000, 40202160: 400000 } });

  // ----- Stock catalog -----
  const item = (stockNo, description, unit, code, reorderPoint) => S.post('/api/finance/items', { stockNo, description, unit, code, reorderPoint });
  const it = {
    paper: item('OS-0001', 'Bond paper, A4, 80gsm', 'ream', '10404010', 60), legal: item('OS-0002', 'Bond paper, legal, 80gsm', 'ream', '10404010', 30),
    pen: item('OS-0003', 'Ballpen, black, 0.5mm', 'box', '10404010', 10), ink: item('OS-0004', 'Printer ink, black, 70ml', 'bottle', '10404010', 12),
    folder: item('OS-0005', 'Folder, long, kraft', 'pack', '10404010', 15), fert: item('AG-0001', 'Fertilizer, complete 14-14-14', 'bag', '10404090', 20),
    seeds: item('AG-0002', 'Hybrid rice seeds, certified', 'bag', '10404090', 10), para: item('MD-0001', 'Paracetamol 500mg', 'box', '10404060', 5),
  };

  // ----- Procurement 1: office supplies, on time, paid by MDS check -----
  let check = 1047301;
  const payCheck = (dv, date) => {
    A.post(`/api/finance/dvs/${dv.id}/certify`, { docsComplete: true, date });
    H.post(`/api/finance/dvs/${dv.id}/approve`);
    return C.post(`/api/finance/dvs/${dv.id}/pay`, { checkNo: String(check++), date });
  };
  const procure = ({ office, fund = '01', purpose, prItems, poItems, supplier, mode = 'Small Value Procurement', allotments, d0, deliverIn, deliveredAfter, payDays, pay = 'check' }) => {
    const requester = (people[{ CCS: 'maria', CA: 'ramon', ADM: 'nestor', REG: 'rosa' }[office]] && data.users.find((u) => u.id === people[{ CCS: 'maria', CA: 'ramon', ADM: 'nestor', REG: 'rosa' }[office]].userId)) || sup;
    const pr = as(requester).post('/api/finance/prs', { office, fund, date: d0, purpose, submit: true, items: prItems, requesterTitle: 'Head of office' });
    H.post(`/api/finance/prs/${pr.id}/approve`);
    const date = addDays(d0, 3);
    let po = S.post('/api/finance/pos', { prId: pr.id, supplierId: supplier.id, mode, date, deliveryDate: addDays(date, deliverIn), place: 'Supply Office, Administration Building', paymentTerm: 'Upon complete delivery and acceptance', items: poItems, office });
    po = S.post(`/api/finance/pos/${po.id}/ors`, { allotments });
    B.post(`/api/finance/obligations/${po.ors.id}/obligate`, { date: addDays(date, 1) });
    H.post(`/api/finance/pos/${po.id}/approve`);
    if (deliveredAfter == null) return { pr, po };
    const iarDate = addDays(date, deliveredAfter);
    const iar = S.post('/api/finance/iars', { poId: po.id, date: iarDate, invoiceNo: `SI-${String(10000 + Math.round(days(start, iarDate) * 13))}`, invoiceDate: iarDate, inspectedBy: 'Engr. Paolo R. Sison', lines: po.items.map((l, i) => ({ line: i, qty: l.qty })) });
    if (payDays == null) return { pr, po, iar };
    const dv = C.post('/api/finance/dvs', { fund, payeeId: supplier.id, orsId: po.ors.id, iarId: iar.id, gross: iar.total, nature: 'goods', mode: pay, office, date: addDays(iarDate, 1), particulars: `Payment for ${purpose.toLowerCase()} per PO ${po.no}, IAR ${iar.no}, invoice ${iar.invoiceNo}`, deductions: iar.liquidatedDamages ? [{ code: '40201140', label: `Liquidated damages (${iar.daysLate} days late)`, amount: iar.liquidatedDamages }] : [], submit: true, boxA: { name: 'Dr. Elena Cruz', title: 'Dean, College of Computing Studies' } });
    return { pr, po, iar, dv, payDate: addDays(iarDate, payDays) };
  };
  const p1 = procure({
    office: 'CCS', purpose: 'Office and laboratory supplies, first semester', supplier: sp.depot, allotments: { MOOE: al.he.id }, d0: at(0.06), deliverIn: 10, deliveredAfter: 8, payDays: 4,
    prItems: [{ itemId: it.paper.id, qty: 200, unitCost: 245 }, { itemId: it.legal.id, qty: 80, unitCost: 265 }, { itemId: it.pen.id, qty: 30, unitCost: 180 }, { itemId: it.ink.id, qty: 40, unitCost: 395 }, { itemId: it.folder.id, qty: 40, unitCost: 120 }],
    poItems: [[it.paper, 200, 238], [it.legal, 80, 259], [it.pen, 30, 172], [it.ink, 40, 389], [it.folder, 40, 115]].map(([i, qty, unitCost]) => ({ itemId: i.id, category: 'supply', qty, unitCost, description: i.description, unit: i.unit, code: i.code })),
  });
  payCheck(p1.dv, p1.payDate);

  // ----- Procurement 2: ICT equipment, delivered 3 days late, paid by LDDAP-ADA -----
  const p2 = procure({
    office: 'CCS', purpose: 'ICT equipment for the computing laboratory', supplier: sp.tech, allotments: { MOOE: al.he.id, CO: al.co.id }, d0: at(0.18), deliverIn: 15, deliveredAfter: 18, payDays: 3, pay: 'ada',
    prItems: [{ description: 'Laptop computer, Core i7, 16GB RAM, 512GB SSD', unit: 'unit', qty: 3, unitCost: 60000 }, { description: 'Laser printer, monochrome, duplex', unit: 'unit', qty: 2, unitCost: 18500 }],
    poItems: [{ description: 'Laptop computer, Core i7, 16GB RAM, 512GB SSD', unit: 'unit', qty: 3, unitCost: 58500, category: 'ppe', code: '10605030' }, { description: 'Laser printer, monochrome, duplex', unit: 'unit', qty: 2, unitCost: 17950, category: 'semi', code: '10405030' }],
  });
  A.post(`/api/finance/dvs/${p2.dv.id}/certify`, { docsComplete: true, date: p2.payDate });
  H.post(`/api/finance/dvs/${p2.dv.id}/approve`);
  C.post('/api/finance/lddaps', { dvIds: [p2.dv.id], date: p2.payDate });
  const newProp = data.finProperty.filter((p) => p.source?.id === p2.iar.id);
  const laptops = newProp.filter((p) => p.type === 'ppe');
  const printers = newProp.filter((p) => p.type === 'semi');
  if (laptops[0]) S.post(`/api/finance/property/${laptops[0].id}/issue`, { custodianId: custodian('maria').id, date: addDays(p2.payDate, 1), office: 'CCS' });
  if (laptops[1]) S.post(`/api/finance/property/${laptops[1].id}/issue`, { custodianId: custodian('juan').id, date: addDays(p2.payDate, 1), office: 'CCS' });
  if (printers[0]) S.post(`/api/finance/property/${printers[0].id}/issue`, { custodianId: custodian('leo').id, date: addDays(p2.payDate, 1), office: 'CCS' });

  // ----- Procurement 3: agricultural supplies, partly delivered, voucher waiting for Box D -----
  const p3 = procure({
    office: 'CA', purpose: 'Agricultural supplies for the demonstration farm', supplier: sp.agri, allotments: { MOOE: al.he.id }, d0: at(0.7), deliverIn: 14, deliveredAfter: null,
    prItems: [{ itemId: it.fert.id, qty: 60, unitCost: 1650 }, { itemId: it.seeds.id, qty: 25, unitCost: 2400 }],
    poItems: [{ itemId: it.fert.id, category: 'supply', qty: 60, unitCost: 1620, description: it.fert.description, unit: 'bag', code: '10404090' }, { itemId: it.seeds.id, category: 'supply', qty: 25, unitCost: 2380, description: it.seeds.description, unit: 'bag', code: '10404090' }],
  });
  const iar3 = S.post('/api/finance/iars', { poId: p3.po.id, date: at(0.8), invoiceNo: 'DR-0773', inspectedBy: 'Engr. Paolo R. Sison', lines: [{ line: 0, qty: 40 }, { line: 1, qty: 25 }] });
  const dv3 = C.post('/api/finance/dvs', { fund: '01', payeeId: sp.agri.id, orsId: p3.po.ors.id, iarId: iar3.id, gross: iar3.total, nature: 'goods', mode: 'check', office: 'CA', date: at(0.82), particulars: `Partial payment for agricultural supplies per PO ${p3.po.no}, IAR ${iar3.no}`, submit: true, boxA: { name: 'Dr. Ramon Villareal', title: 'Dean, College of Agriculture' } });
  A.post(`/api/finance/dvs/${dv3.id}/certify`, { docsComplete: true, date: at(0.84) });

  // A purchase request waiting for the head's approval, and one for the procurement unit.
  as(custodian('rosa').userId ? data.users.find((u) => u.id === custodian('rosa').userId) : sup).post('/api/finance/prs', { office: 'REG', fund: '05', date: at(0.9), purpose: 'Security paper and toner for transcripts and certifications', submit: true, items: [{ description: 'Security paper, A4, with dry seal watermark', unit: 'ream', qty: 20, unitCost: 1450 }, { description: 'Toner cartridge, laser printer', unit: 'piece', qty: 6, unitCost: 3900 }] });

  // ----- Requisitions and issues; RSMI for each month before this one -----
  const ris = (who, office, purpose, lines, d, issue = true) => {
    const u = data.users.find((x) => x.id === custodian(who).userId) || sup;
    const r = as(u).post('/api/finance/ris', { office, purpose, date: d, items: lines.map(([i, qty]) => ({ itemId: i.id, qty })) });
    if (issue) S.post(`/api/finance/ris/${r.id}/issue`, { date: addDays(d, 1) });
    return r;
  };
  const after = addDays(p1.iar.date, 1);
  ris('maria', 'CCS', 'Laboratory activities and class records', [[it.paper, 40], [it.pen, 6], [it.ink, 8]], after);
  ris('rosa', 'REG', 'Registrar\'s forms and certifications', [[it.paper, 30], [it.legal, 25], [it.folder, 12]], addDays(after, 5));
  ris('nestor', 'ADM', 'Administrative office supplies', [[it.paper, 25], [it.pen, 5], [it.folder, 10]], [addDays(after, 20), at(0.65)].sort()[0]);
  ris('maria', 'CCS', 'Midterm examinations', [[it.paper, 60], [it.ink, 10]], at(0.72));
  ris('ramon', 'CA', 'Demonstration farm planting', [[it.fert, 20], [it.seeds, 10]], addDays(iar3.date, 1) > end ? end : addDays(iar3.date, 1));
  ris('rosa', 'REG', 'Enrollment period forms', [[it.paper, 20], [it.legal, 10]], end, false); // waiting for the supply office
  const issueMonths = [...new Set(data.finStock.filter((m) => m.kind === 'issue').map((m) => month(m.date)))].filter((m) => m < month(today)).sort();
  for (const m of issueMonths) S.post('/api/finance/rsmi', { month: m, fund: '01' });

  // ----- Monthly services: electricity (fund 01), janitorial (fund 05) -----
  const monthsBack = [];
  for (let m = [prevMonth(month(today)), month(end)].sort()[0]; monthsBack.length < 4 && `${m}-28` >= start; m = prevMonth(m)) monthsBack.unshift(m);
  monthsBack.forEach((m, k) => {
    const billDate = [`${m}-20`, start].sort().at(-1);
    const payDate = addDays(billDate, 6) > end ? end : addDays(billDate, 6);
    const kwh = 92000 + k * 4350;
    const ors = B.post('/api/finance/obligations', { fund: '01', payeeId: sp.power.id, office: 'ADM', date: billDate, particulars: `Electricity consumption for ${new Date(`${m}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}`, lines: [{ allotmentId: al.ga.id, code: '50204020', amount: kwh }], requestedBy: { name: 'Mr. Ronaldo Pascual', title: 'Chief Administrative Officer' } });
    B.post(`/api/finance/obligations/${ors.id}/obligate`, { date: billDate });
    payCheck(C.post('/api/finance/dvs', { fund: '01', payeeId: sp.power.id, orsId: ors.id, gross: kwh, nature: 'services', mode: 'check', office: 'ADM', date: billDate, particulars: ors.particulars, submit: true, boxA: { name: 'Mr. Ronaldo Pascual', title: 'Chief Administrative Officer' } }), payDate);
    const burs = B.post('/api/finance/obligations', { fund: '05', payeeId: sp.janitor.id, office: 'ADM', date: billDate, particulars: `Janitorial services for ${new Date(`${m}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}, 8 personnel`, lines: [{ allotmentId: al.stf.id, code: '50212020', amount: 136000 }], requestedBy: { name: 'Mr. Ronaldo Pascual', title: 'Chief Administrative Officer' } });
    B.post(`/api/finance/obligations/${burs.id}/obligate`, { date: billDate });
    payCheck(C.post('/api/finance/dvs', { fund: '05', payeeId: sp.janitor.id, orsId: burs.id, gross: 136000, nature: 'services', mode: 'bank', bankId: bank05, office: 'ADM', date: billDate, particulars: burs.particulars, submit: true, boxA: { name: 'Mr. Ronaldo Pascual', title: 'Chief Administrative Officer' } }), payDate);
  });

  // ----- Legal retainer (professional fee: 5% EWT and 3% percentage tax) -----
  const legal = B.post('/api/finance/obligations', { fund: '01', payeeId: sp.lawyer.id, office: 'OP', date: at(0.55), particulars: 'Legal retainer, two months', lines: [{ allotmentId: al.ga.id, code: '50211010', amount: 50000 }], requestedBy: { name: 'Dr. Alicia M. Bautista', title: 'University President' } });
  B.post(`/api/finance/obligations/${legal.id}/obligate`, { date: at(0.55) });
  payCheck(C.post('/api/finance/dvs', { fund: '01', payeeId: sp.lawyer.id, orsId: legal.id, gross: 50000, nature: 'professional', mode: 'check', office: 'OP', date: at(0.56), particulars: 'Legal retainer, two months', submit: true, boxA: { name: 'Dr. Alicia M. Bautista', title: 'University President' } }), at(0.58));

  // ----- Cash advances: the cashier's (settled) and a teacher's travel (overdue) -----
  const caOrs = B.post('/api/finance/obligations', { fund: '01', payeeId: people.lorna.id, office: 'OP', date: at(0.3), particulars: 'Cash advance for meals of student athletes, regional athletic meet', lines: [{ allotmentId: al.he.id, code: '50203050', amount: 50000 }] });
  B.post(`/api/finance/obligations/${caOrs.id}/obligate`, { date: at(0.3) });
  const ca = C.post('/api/finance/dvs', { fund: '01', payeeId: people.lorna.id, orsId: caOrs.id, kind: 'advance', advanceType: 'sdo', gross: 50000, mode: 'check', office: 'OP', date: at(0.3), particulars: 'Cash advance for meals of student athletes, regional athletic meet', submit: true, boxA: { name: 'Dr. Alicia M. Bautista', title: 'University President' } });
  payCheck(ca, at(0.31));
  A.post('/api/finance/liquidations', { dvId: ca.id, date: at(0.38), lines: [{ code: '50203050', amount: 46800, particulars: 'Meals, 52 athletes and coaches, 3 days' }] });
  const refund = C.post('/api/finance/receipts', { fund: '01', date: at(0.38), payorName: 'Lorna P. Esguerra', payorCardId: people.lorna.id, lines: [{ code: '19901030', amount: 3200, description: 'Refund of unused cash advance' }] });
  A.post('/api/finance/liquidations', { dvId: ca.id, date: at(0.38), receiptId: refund.id });
  const r01 = C.post('/api/finance/rcds', { fund: '01', date: at(0.38) });
  C.post(`/api/finance/rcds/${r01.id}/deposit`, { bankId: s.bankAccounts.find((b) => b.fund === '01').id, date: at(0.39), slipNo: 'BTr-OR-0117' });
  if (people.juan) {
    const tOrs = B.post('/api/finance/obligations', { fund: '01', payeeId: people.juan.id, office: 'CCS', date: [[addDays(today, -45), start].sort().at(-1), addDays(end, -20)].sort()[0], particulars: 'Travel to Manila: national ICT educators\' conference', lines: [{ allotmentId: al.he.id, code: '50201010', amount: 18500 }] });
    B.post(`/api/finance/obligations/${tOrs.id}/obligate`, { date: tOrs.date });
    const t = C.post('/api/finance/dvs', { fund: '01', payeeId: people.juan.id, orsId: tOrs.id, kind: 'advance', advanceType: 'travel', gross: 18500, mode: 'check', office: 'CCS', date: tOrs.date, particulars: 'Cash advance for travel: national ICT educators\' conference', submit: true, boxA: { name: 'Dr. Elena Cruz', title: 'Dean, College of Computing Studies' } });
    payCheck(t, tOrs.date);
  }

  // ----- Waiting in the queues -----
  const pending = B.post('/api/finance/obligations', { fund: '01', payeeId: sp.depot.id, office: 'LIB', date: end, particulars: 'Subscription to online journals and databases, academic year', lines: [{ allotmentId: al.he.id, code: '50299070', amount: 185000 }], submit: true, requestedBy: { name: 'Ms. Grace Aquino', title: 'Chief Librarian' } });
  void pending;
  const waterOrs = B.post('/api/finance/obligations', { fund: '05', payeeId: sp.janitor.id, office: 'ADM', date: end, particulars: 'Additional janitorial personnel for the enrollment period', lines: [{ allotmentId: al.stf.id, code: '50212020', amount: 34000 }] });
  B.post(`/api/finance/obligations/${waterOrs.id}/obligate`, { date: end });
  C.post('/api/finance/dvs', { fund: '05', payeeId: sp.janitor.id, orsId: waterOrs.id, gross: 34000, nature: 'services', mode: 'bank', bankId: bank05, office: 'ADM', date: end, particulars: 'Additional janitorial personnel for the enrollment period', submit: true, boxA: { name: 'Mr. Ronaldo Pascual', title: 'Chief Administrative Officer' } });
  A.post('/api/finance/journals', { date: end, fund: '01', journal: 'GJ', particulars: 'To accrue water consumption for the month (billing not yet received)', lines: [{ code: '50204010', debit: 18250, office: 'ADM' }, { code: '20101010', credit: 18250 }] });

  // ----- Property: depreciation through last month, a transfer, a disposal -----
  const lastMonth = [prevMonth(month(today)), month(end)].sort()[0];
  if (lastMonth >= `${Y}-01`) S.post('/api/finance/depreciation', { month: lastMonth });
  const desk = registered.find((r) => r.description?.startsWith('Desktop computer') && r.description.includes('unit 6'));
  if (desk && people.maria) S.post(`/api/finance/property/${desk.rec.id}/transfer`, { custodianId: people.maria.id, reason: 'Reassigned to the faculty room', date: at(0.75) });
  const copier = registered.find((r) => r.description?.includes('(old)'));
  if (copier) S.post(`/api/finance/property/${copier.rec.id}/dispose`, { mode: 'Destruction (beyond repair)', appraised: 0, reason: 'Unserviceable; parts no longer available', date: [`${month(today)}-01`, start].sort().at(-1) > end ? end : [`${month(today)}-01`, start].sort().at(-1) });

  // ----- Taxes withheld: remitted for every month before last -----
  const taxMonths = [...new Set(data.finDvs.filter((d) => d.status === 'paid' && d.taxTotal).map((d) => `${d.fund}|${month(d.paidDate)}`))];
  for (const k of taxMonths) {
    const [fund, m] = k.split('|');
    if (m >= lastMonth) continue;
    const [y, mm] = m.split('-').map(Number);
    const due = `${mm === 12 ? y + 1 : y}-${String(mm === 12 ? 1 : mm + 1).padStart(2, '0')}-10`;
    C.post('/api/finance/remittances', { month: m, fund, date: due > end ? end : due, ref: fund === '01' ? `TRA-${m.replace('-', '')}-01` : `eFPS-${m.replace('-', '')}-${fund}` });
  }

  // Mark everything made here as demo data.
  for (const k of FIN_ARRAYS) for (const x of data[k]) if (!before[k].has(x.id)) x.demo = true;
}
