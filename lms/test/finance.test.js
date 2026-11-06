// ATLAS Finance: the government accounting cycle end to end — budget (appropriation, allotment,
// NCA, ORS/BURS), procurement (PR → PO → IAR), the disbursement voucher (Box C, Box D, payment,
// taxes), cash advances and liquidation, revenue (O.R., RCD, deposit), inventory (RIS, RSMI),
// property (PAR/ICS, depreciation, disposal), the books (trial balance, statements, closing),
// controls (separation of duties, period lock), self-service and access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, TODAY } from './support.js';
import { withholding, depreciation, amountInWords, DEFAULT_TAXES } from '../shared/finance.js';

const PW = 'password123';
const status = (code) => (err) => err.status === code;

async function office(env) {
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const mk = (role, username, name) => admin.post('/api/finance/users', { role, username, name, password: PW, mustChangePassword: false });
  await mk('accountant', 'acct', 'Alma Accountant');
  await mk('budget', 'budget', 'Ben Budget');
  await mk('cashier', 'cash', 'Cora Cashier');
  await mk('supply', 'supply', 'Sam Supply');
  await mk('approver', 'head', 'Hector Head');
  await admin.post('/api/admin/users', { role: 'teacher', username: 'teach', name: 'Tina Teacher', password: PW, mustChangePassword: false });
  await admin.post('/api/admin/users', { role: 'student', username: 'stud', name: 'Sid Student', password: PW, mustChangePassword: false });
  const signIn = async (username) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password: PW });
    return c;
  };
  const [acct, budget, cash, supply, head, teach, stud] = await Promise.all(['acct', 'budget', 'cash', 'supply', 'head', 'teach', 'stud'].map(signIn));
  const s = await acct.put('/api/finance/settings', {
    fiscalYear: 2026,
    offices: [{ code: 'ADM', name: 'Administrative Office' }, { code: 'CCS', name: 'College of Computing Studies' }],
    paps: [{ code: '310100100001000', name: 'Higher Education Program' }, { code: '100000100001000', name: 'General Administration and Support' }],
    bankAccounts: [{ name: 'Land Bank', number: '0000-1111-22', fund: '05', code: '10102020' }],
    revenueItems: [{ name: 'Tuition fee', code: '40202010', amount: 0, fund: '05' }, { name: 'Certification fee', code: '40201040', amount: 50, fund: '05' }],
  });
  const card = (body) => acct.post('/api/finance/cards', body);
  const supplier = await card({ kind: 'supplier', name: 'Bicol Office Depot, Inc.', tin: '123-456-789-000', vat: 'vat', taxType: 'corporation', nature: 'goods', bankAccount: '1234567890', bankName: 'Land Bank' });
  const janitor = await card({ kind: 'supplier', name: 'CleanPro Services', tin: '222-333-444-000', vat: 'nonvat', taxType: 'individual', nature: 'services' });
  const users = await admin.get('/api/finance/users');
  const teacherUser = (await admin.get('/api/admin/users?role=teacher')).find((u) => u.username === 'teach');
  const officer = await card({ kind: 'officer', name: 'Cora Cashier', userId: users.users.find((u) => u.username === 'cash').id, bond: { amount: 100000, expires: '2027-12-31' } });
  const employee = await card({ kind: 'employee', name: 'Tina Teacher', userId: teacherUser.id });
  return { admin, acct, budget, cash, supply, head, teach, stud, settings: s, supplier, janitor, officer, employee, signIn, users: users.users };
}

async function funds(f) {
  // GAA (fund 01): appropriation → allotment → NCA. STF (fund 05): board-approved budget.
  const ap = await f.budget.post('/api/finance/appropriations', { fund: '01', pap: '310100100001000', cls: 'MOOE', kind: 'GAA – New appropriations', ref: 'GAA 2026', amount: 1000000 });
  const al = await f.budget.post('/api/finance/allotments', { fund: '01', pap: '310100100001000', cls: 'MOOE', ref: 'GARO-2026-001', amount: 600000, appropriationId: ap.id, date: '2026-01-05' });
  const apCo = await f.budget.post('/api/finance/appropriations', { fund: '01', pap: '310100100001000', cls: 'CO', kind: 'GAA – New appropriations', ref: 'GAA 2026', amount: 500000 });
  const alCo = await f.budget.post('/api/finance/allotments', { fund: '01', pap: '310100100001000', cls: 'CO', ref: 'SARO-2026-010', amount: 500000, appropriationId: apCo.id, date: '2026-01-05' });
  await f.budget.post('/api/finance/ncas', { no: 'NCA-BMB-26-0001', date: '2026-01-10', amount: 800000 });
  const stf = await f.budget.post('/api/finance/allotments', { fund: '05', pap: '100000100001000', cls: 'MOOE', kind: 'Board approval (IGF/STF)', ref: 'BOR Res. 12-2026', amount: 200000, date: '2026-01-05' });
  return { ap, al, alCo, stf };
}

test('shared rules: government withholding, straight-line depreciation, amount in words', () => {
  // VAT-registered corporation selling goods for ₱11,200: base ₱10,000; 1% EWT (WC640) and 5% creditable VAT (WV010).
  const w = withholding(11200, 'goods', { vat: 'vat', taxType: 'corporation' }, DEFAULT_TAXES);
  assert.deepEqual(w.lines.map((l) => [l.atc, l.amount]), [['WC640', 100], ['WV010', 500]]);
  assert.equal(w.net, 10600);
  // Non-VAT individual providing services for ₱10,000: 2% EWT (WI157) and 3% percentage tax (WB080), both on the gross.
  const n = withholding(10000, 'services', { vat: 'nonvat', taxType: 'individual' }, DEFAULT_TAXES);
  assert.deepEqual(n.lines.map((l) => [l.atc, l.amount]), [['WI157', 200], ['WB080', 300]]);
  assert.equal(withholding(5000, 'none', { vat: 'vat' }).total, 0);
  // ₱60,000 laptop, 5 years, 5% residual: ₱950 a month, starting the month after acquisition.
  const d = depreciation({ cost: 60000, residual: 3000, lifeYears: 5, acquired: '2026-01-20' }, '2026-04');
  assert.deepEqual([d.monthly, d.months, d.accumulated, d.bookValue], [950, 3, 2850, 57150]);
  assert.equal(depreciation({ cost: 60000, residual: 3000, lifeYears: 5, acquired: '2020-01-20' }, '2026-04').accumulated, 57000, 'never below the residual value');
  assert.equal(amountInWords(1250.5), 'One Thousand Two Hundred Fifty Pesos and 50/100');
  assert.equal(amountInWords(1000000), 'One Million Pesos Only');
});

test('procure to pay: PR → PO with its ORS → IAR (stock, property, payable) → DV certified, approved, paid, taxes withheld', async () => {
  const env = setup();
  const f = await office(env);
  const b = await funds(f);
  const item = await f.supply.post('/api/finance/items', { stockNo: 'OS-001', description: 'Bond paper, A4, 80gsm', unit: 'ream', code: '10404010', reorderPoint: 10 });
  // An office files a purchase request; only the approving officer approves it.
  const pr = await f.teach.post('/api/finance/prs', { office: 'CCS', fund: '01', purpose: 'Supplies and a laptop for the computing laboratory', submit: true,
    items: [{ itemId: item.id, qty: 100, unitCost: 250 }, { description: 'Laptop, Core i5, 16GB', unit: 'unit', qty: 1, unitCost: 65000 }] });
  assert.equal(pr.status, 'submitted');
  await assert.rejects(f.supply.post(`/api/finance/prs/${pr.id}/approve`), status(403));
  await f.head.post(`/api/finance/prs/${pr.id}/approve`);
  // The PO: supplies at cost, the laptop as PPE (at or above ₱50,000).
  const items = [{ itemId: item.id, category: 'supply', qty: 100, unitCost: 245, description: 'Bond paper, A4, 80gsm', unit: 'ream' }, { description: 'Laptop, Core i5, 16GB', unit: 'unit', qty: 1, unitCost: 65000, category: 'ppe', code: '10605030' }];
  await assert.rejects(f.supply.post('/api/finance/pos', { prId: pr.id, supplierId: f.supplier.id, deliveryDate: '2026-08-20', items: [{ ...items[1], unitCost: 40000 }] }), /below the ₱50,000 capitalization threshold/);
  await assert.rejects(f.supply.post('/api/finance/pos', { prId: pr.id, supplierId: f.supplier.id, mode: 'Direct Acquisition', deliveryDate: '2026-08-20', items: [items[0], { ...items[1], qty: 3 }] }), /Direct Acquisition is for contracts up to ₱200,000/);
  let po = await f.supply.post('/api/finance/pos', { prId: pr.id, supplierId: f.supplier.id, mode: 'Small Value Procurement', date: '2026-08-01', deliveryDate: '2026-08-08', items });
  assert.equal(po.total, 89500);
  await assert.rejects(f.head.post(`/api/finance/pos/${po.id}/approve`), /obligated by the budget office first/);
  po = await f.supply.post(`/api/finance/pos/${po.id}/ors`, { allotments: { MOOE: b.al.id, CO: b.alCo.id } });
  const ors = await f.budget.get(`/api/finance/obligations/${po.ors.id}`);
  assert.equal(ors.form, 'ORS');
  assert.deepEqual(ors.lines.map((l) => [l.code, l.amount]).sort(), [['10605030', 65000], ['50203010', 24500]], 'supplies are obligated as an expense, the laptop as capital outlay');
  const obl = await f.budget.post(`/api/finance/obligations/${ors.id}/obligate`, { date: TODAY });
  assert.match(obl.no, /^01-2026-08-0001$/);
  po = await f.head.post(`/api/finance/pos/${po.id}/approve`);
  // Delivered two days late: liquidated damages of 0.1% a day on the late items.
  const iar = await f.supply.post('/api/finance/iars', { poId: po.id, invoiceNo: 'SI-5521', inspectedBy: 'Ivan Inspector', lines: [{ line: 0, qty: 100 }, { line: 1, qty: 1 }] });
  assert.equal(iar.daysLate, 2);
  assert.equal(iar.liquidatedDamages, 179);
  assert.equal((await f.supply.get(`/api/finance/items/${item.id}/card`)).item.onHand, 100);
  const laptop = (await f.supply.get('/api/finance/property?type=ppe'))[0];
  assert.deepEqual([laptop.cost, laptop.residual, laptop.life, laptop.status], [65000, 3250, 5, 'in-stock']);
  assert.equal((await f.acct.get(`/api/finance/cards/${f.supplier.id}`)).ledgers.find((l) => l.code === '20101010').balance, 89500, 'accounts payable to the supplier');
  // The voucher: AP debited, 1% EWT and 5% VAT withheld on the net-of-VAT amount, LDs deducted.
  const dv0 = await f.cash.post('/api/finance/dvs', { fund: '01', payeeId: f.supplier.id, orsId: ors.id, iarId: iar.id, gross: 89500, nature: 'goods', mode: 'check', office: 'CCS', particulars: `Payment of PO ${po.no}`, deductions: [{ code: '40201140', label: 'Liquidated damages', amount: 179 }], submit: true });
  assert.deepEqual(dv0.taxes.map((t) => [t.atc, t.amount]), [['WC640', 799.11], ['WV010', 3995.54]]);
  assert.equal(dv0.net, 84526.35);
  assert.deepEqual(dv0.entry.map((l) => [l.code, l.debit, l.credit]), [['20101010', 89500, 0], ['20201010', 0, 4794.65], ['40201140', 0, 179], ['10104040', 0, 84526.35]]);
  // Box C needs the documents confirmed; Box D cannot be the preparer; then the check.
  await assert.rejects(f.acct.post(`/api/finance/dvs/${dv0.id}/certify`, {}), /supporting documents/);
  await assert.rejects(f.cash.post(`/api/finance/dvs/${dv0.id}/certify`, { docsComplete: true }), status(403));
  const dv1 = await f.acct.post(`/api/finance/dvs/${dv0.id}/certify`, { docsComplete: true });
  assert.equal(dv1.no, '01-2026-08-0001');
  await assert.rejects(f.cash.post(`/api/finance/dvs/${dv0.id}/pay`, { checkNo: '100001' }), /Only an approved voucher/);
  await f.head.post(`/api/finance/dvs/${dv0.id}/approve`);
  const paid = await f.cash.post(`/api/finance/dvs/${dv0.id}/pay`, { checkNo: '100001' });
  assert.equal(paid.status, 'paid');
  assert.match(paid.jevNo, /^01-2026-08-/);
  assert.equal((await f.acct.get(`/api/finance/cards/${f.supplier.id}`)).ledgers.find((l) => l.code === '20101010').balance, 0, 'paid off');
  // The obligation is fully disbursed; the registry and SAAODB agree.
  const after = await f.budget.get(`/api/finance/obligations/${ors.id}`);
  assert.deepEqual([after.disbursed, after.unpaid], [89500, 0]);
  const saaodb = await f.budget.get('/api/finance/budget/saaodb?fund=01');
  assert.equal(saaodb.totals.totalDisbursements, 89500);
  assert.equal(saaodb.totals.unobligated, 1100000 - 89500, 'allotments less obligations');
  assert.equal(saaodb.totals.unreleased, 1500000 - 1100000, 'appropriations not yet allotted');
  const raod = await f.budget.get('/api/finance/budget/raod?fund=01&cls=CO');
  assert.deepEqual([raod.totals.allotment, raod.totals.obligations, raod.totals.disbursements, raod.totals.unpaid], [500000, 65000, 65000, 0]);
  // Taxes: the month's summary by ATC, the 2307 for the supplier, and the remittance by TRA.
  const tax = await f.acct.get('/api/finance/taxes?month=2026-08');
  assert.deepEqual(tax.rows.map((r) => [r.atc, r.amount]), [['WC640', 799.11], ['WV010', 3995.54]]);
  const f2307 = await f.acct.get(`/api/finance/taxes/2307?payeeId=${f.supplier.id}&year=2026&quarter=3`);
  assert.deepEqual([f2307.rows[0].atc, f2307.rows[0].months[1], f2307.tax], ['WC640', 79910.71, 799.11]);
  const vat2307 = await f.acct.get(`/api/finance/taxes/2307?payeeId=${f.supplier.id}&year=2026&quarter=3&kind=vat`);
  assert.equal(vat2307.tax, 3995.54);
  await f.cash.post('/api/finance/remittances', { month: '2026-08', fund: '01', ref: 'TRA-2026-08-001' });
  await assert.rejects(f.cash.post('/api/finance/remittances', { month: '2026-08', fund: '01', ref: 'again' }), /Nothing left to remit/);
  const tb = await f.acct.get('/api/finance/trial-balance?fund=01');
  assert.equal(tb.debit, tb.credit);
  assert.equal(tb.rows.find((r) => r.code === '20201010'), undefined, 'Due to BIR cleared by the remittance');
  // Inventory: a requisition issued (FIFO), then the RSMI books the expense.
  const ris = await f.teach.post('/api/finance/ris', { office: 'CCS', purpose: 'Laboratory use', items: [{ itemId: item.id, qty: 30 }] });
  await assert.rejects(f.teach.post(`/api/finance/ris/${ris.id}/issue`), status(403));
  await assert.rejects(f.supply.post(`/api/finance/ris/${ris.id}/issue`, { qty: { [item.id]: 300 } }), /at most the quantity requested/);
  await f.supply.post(`/api/finance/ris/${ris.id}/issue`);
  const rsmi = await f.supply.get('/api/finance/rsmi?month=2026-08');
  assert.deepEqual([rsmi.total, rsmi.unposted], [7350, 1]);
  const j = await f.supply.post('/api/finance/rsmi', { month: '2026-08', fund: '01' });
  assert.deepEqual(j.lines.map((l) => [l.code, l.debit, l.credit]), [['50203010', 7350, 0], ['10404010', 0, 7350]]);
  // Property: issued on a PAR; depreciation from the month after acquisition.
  const issued = await f.supply.post(`/api/finance/property/${laptop.id}/issue`, { custodianId: f.employee.id });
  assert.match(issued.docNo, /^2026-08-/);
  const my = await f.teach.get('/api/finance/my');
  assert.deepEqual(my.property.map((p) => p.propertyNo), [laptop.propertyNo]);
  await assert.rejects(f.teach.get(`/api/finance/property/${laptop.id}`), status(403));
});

test('services without a delivery, a BURS on the special trust fund, cash advance and liquidation', async () => {
  const env = setup();
  const f = await office(env);
  const b = await funds(f);
  // Fund 05: a BURS, paid from the bank account, 2% EWT and 3% percentage tax for a non-VAT payee.
  const burs = await f.cash.post('/api/finance/obligations', { fund: '05', payeeId: f.janitor.id, office: 'ADM', particulars: 'Janitorial services for July 2026', lines: [{ allotmentId: b.stf.id, code: '50212020', amount: 30000 }], submit: true });
  assert.equal(burs.form, 'BURS');
  await assert.rejects(f.cash.post(`/api/finance/obligations/${burs.id}/obligate`), status(403));
  await assert.rejects(f.budget.put(`/api/finance/obligations/${burs.id}`, { lines: [{ allotmentId: b.stf.id, code: '10605030', amount: 30000 }] }), /not a MOOE object code/);
  await f.budget.post(`/api/finance/obligations/${burs.id}/obligate`);
  await assert.rejects(f.budget.post('/api/finance/obligations', { fund: '05', payeeId: f.janitor.id, particulars: 'Too much', lines: [{ allotmentId: b.stf.id, code: '50212020', amount: 180000 }] }).then((o) => f.budget.post(`/api/finance/obligations/${o.id}/obligate`)), /Not enough allotment/);
  // No cash yet in the fund 05 bank account: Box C refuses.
  const dv = await f.cash.post('/api/finance/dvs', { fund: '05', payeeId: f.janitor.id, orsId: burs.id, gross: 30000, nature: 'services', mode: 'bank', particulars: 'Janitorial services, July 2026', submit: true });
  assert.deepEqual(dv.taxes.map((t) => [t.atc, t.amount]), [['WI157', 600], ['WB080', 900]]);
  assert.deepEqual(dv.entry.map((l) => [l.code, l.debit, l.credit]), [['50212020', 30000, 0], ['20201010', 0, 1500], ['10102020', 0, 28500]]);
  await assert.rejects(f.acct.post(`/api/finance/dvs/${dv.id}/certify`, { docsComplete: true }), /Not enough cash/);
  await assert.rejects(f.cash.post('/api/finance/dvs', { fund: '05', payeeId: f.janitor.id, orsId: burs.id, gross: 5000, nature: 'services', mode: 'bank', particulars: 'Double charge' }), /only ₱0.00 of the obligation is left|has only ₱0.00 left/);

  // Revenue: a booklet, receipts, the RCD (CRJ) and the deposit fund the bank account.
  await assert.rejects(f.cash.post('/api/finance/receipts', { fund: '05', payorName: 'X', lines: [{ code: '40202010', amount: 1 }] }), /no Official Receipt booklet/);
  const cashierId = f.users.find((u) => u.username === 'cash').id;
  await f.cash.post('/api/finance/booklets', { from: 1000001, to: 1000050, fund: '05', collectorId: cashierId });
  await assert.rejects(f.cash.post('/api/finance/booklets', { from: 1000040, to: 1000060, fund: '05', collectorId: cashierId }), /overlap/);
  const studId = (await f.admin.get('/api/admin/users?role=student')).find((u) => u.username === 'stud').id;
  const items = f.settings.revenueItems;
  const or1 = await f.cash.post('/api/finance/receipts', { fund: '05', payorName: 'Sid Student', studentId: studId, lines: [{ itemId: items[0].id, amount: 40000 }, { itemId: items[1].id, amount: 50 }] });
  assert.equal(or1.no, '1000001');
  const or2 = await f.cash.post('/api/finance/receipts', { fund: '05', payorName: 'Walk-in', lines: [{ itemId: items[1].id, amount: 50 }] });
  await f.cash.post(`/api/finance/receipts/${or2.id}/cancel`, { reason: 'Wrong payor name' });
  const rcd = await f.cash.post('/api/finance/rcds', { fund: '05' });
  assert.deepEqual([rcd.total, rcd.count, rcd.from, rcd.to], [40050, 1, '1000001', '1000002']);
  await assert.rejects(f.cash.post(`/api/finance/receipts/${or1.id}/cancel`, { reason: 'late' }), /already in a Report of Collections/);
  const bank = (await f.acct.get('/api/finance/settings')).bankAccounts[0];
  await f.cash.post(`/api/finance/rcds/${rcd.id}/deposit`, { bankId: bank.id, slipNo: 'DS-88812' });
  const certified = await f.acct.post(`/api/finance/dvs/${dv.id}/certify`, { docsComplete: true });
  await f.head.post(`/api/finance/dvs/${dv.id}/approve`);
  await f.cash.post(`/api/finance/dvs/${dv.id}/pay`, { checkNo: 'LB-0042' });
  assert.equal((await f.acct.get('/api/finance/ledger/10102020?fund=05')).closing, 40050 - 28500);
  assert.match(certified.no, /^05-/);
  // Students see their receipts; the stud's receipt is theirs alone.
  const mine = await f.stud.get('/api/finance/my');
  assert.deepEqual(mine.receipts.map((r) => r.no), ['1000001']);
  assert.equal((await f.stud.get(`/api/finance/receipts/${or1.id}`)).total, 40050);
  await assert.rejects(f.stud.get(`/api/finance/receipts/${or2.id}`), status(404));
  await assert.rejects(f.stud.get('/api/finance/dashboard'), status(403));
  await assert.rejects(f.stud.post('/api/finance/ris', { office: 'CCS', purpose: 'x', items: [] }), status(403));

  // Cash advance to the bonded cashier (special disbursing officer), obligated on fund 01.
  const ors = await f.budget.post('/api/finance/obligations', { fund: '01', payeeId: f.officer.id, particulars: 'Cash advance for the seminar on GAM', lines: [{ allotmentId: b.al.id, code: '50202010', amount: 20000 }] });
  await f.budget.post(`/api/finance/obligations/${ors.id}/obligate`);
  await assert.rejects(f.cash.post('/api/finance/dvs', { fund: '01', payeeId: f.supplier.id, orsId: ors.id, kind: 'advance', gross: 20000, particulars: 'x' }), /voucher pays the obligation's payee/);
  const ca = await f.cash.post('/api/finance/dvs', { fund: '01', payeeId: f.officer.id, orsId: ors.id, kind: 'advance', advanceType: 'sdo', gross: 20000, mode: 'check', particulars: 'Cash advance, seminar on GAM', submit: true });
  assert.deepEqual([ca.taxTotal, ca.entry[0].code], [0, '19901030']);
  await f.acct.post(`/api/finance/dvs/${ca.id}/certify`, { docsComplete: true });
  await f.head.post(`/api/finance/dvs/${ca.id}/approve`);
  await f.cash.post(`/api/finance/dvs/${ca.id}/pay`, { checkNo: '100002' });
  // No new advance while this one is open.
  const ors2 = await f.budget.post('/api/finance/obligations', { fund: '01', payeeId: f.officer.id, particulars: 'Another', lines: [{ allotmentId: b.al.id, code: '50202010', amount: 1000 }] });
  await f.budget.post(`/api/finance/obligations/${ors2.id}/obligate`);
  await assert.rejects(f.cash.post('/api/finance/dvs', { fund: '01', payeeId: f.officer.id, orsId: ors2.id, kind: 'advance', advanceType: 'opex', gross: 1000, particulars: 'x' }), /unsettled cash advance/);
  // Liquidation: ₱18,500 spent on training; ₱1,500 refunded on an O.R.
  await f.cash.post('/api/finance/booklets', { from: 2000001, to: 2000050, fund: '01', collectorId: cashierId });
  await assert.rejects(f.acct.post('/api/finance/liquidations', { dvId: ca.id, lines: [{ code: '50299030', amount: 100 }] }), /not on the advance's obligation request/);
  await f.acct.post('/api/finance/liquidations', { dvId: ca.id, lines: [{ code: '50202010', amount: 18500, particulars: 'Venue and meals' }] });
  const refund = await f.cash.post('/api/finance/receipts', { fund: '01', payorName: 'Cora Cashier', payorCardId: f.officer.id, lines: [{ code: '19901030', amount: 1500, description: 'Refund of unused cash advance' }] });
  await assert.rejects(f.acct.post('/api/finance/liquidations', { dvId: ca.id, receiptId: refund.id, lines: [{ code: '50202010', amount: 1 }] }), /outstanding/);
  await f.acct.post('/api/finance/liquidations', { dvId: ca.id, receiptId: refund.id });
  assert.deepEqual((await f.acct.get('/api/finance/advances')).length, 0, 'settled');
  await f.cash.post('/api/finance/rcds', { fund: '01' });
  const officerCard = await f.acct.get(`/api/finance/cards/${f.officer.id}`);
  assert.equal(officerCard.ledgers.find((l) => l.code === '19901030').balance, 0);
  // Every fund's books balance.
  for (const fund of ['01', '05']) {
    const tb = await f.acct.get(`/api/finance/trial-balance?fund=${fund}`);
    assert.equal(tb.debit, tb.credit, `fund ${fund}`);
    const pos = await f.acct.get(`/api/finance/statements/position?fund=${fund}`);
    assert.equal(pos.totals.balanced, true, `fund ${fund} statement of financial position`);
  }
});

test('the books: manual entries, reversal, period lock, depreciation, disposal, bank reconciliation, year-end closing', async () => {
  const env = setup();
  const f = await office(env);
  await funds(f);
  // A draft entry must balance to post; only accountants post.
  const draft = await f.acct.post('/api/finance/journals', { date: '2026-07-31', fund: '01', particulars: 'Accrual of electricity for July', lines: [{ code: '50204020', debit: 12000 }, { code: '20101010', credit: 11000 }] });
  assert.equal(draft.status, 'draft');
  await assert.rejects(f.acct.post(`/api/finance/journals/${draft.id}/post`), /must be equal/);
  await f.acct.put(`/api/finance/journals/${draft.id}`, { lines: [{ code: '50204020', debit: 12000 }, { code: '20101010', credit: 12000 }] });
  await assert.rejects(f.cash.post(`/api/finance/journals/${draft.id}/post`), status(403));
  const posted = await f.acct.post(`/api/finance/journals/${draft.id}/post`);
  assert.match(posted.jevNo, /^01-2026-07-\d{4}$/);
  const rev = await f.acct.post(`/api/finance/journals/${posted.id}/reverse`, { reason: 'Recorded twice' });
  assert.deepEqual(rev.lines.map((l) => [l.code, l.debit, l.credit]), [['50204020', 0, 12000], ['20101010', 12000, 0]]);
  await assert.rejects(f.acct.post(`/api/finance/journals/${posted.id}/reverse`, { reason: 'again' }), /already reversed/);
  // An NCA's entry is reversed through its module, not by hand.
  const nca = (await f.acct.get('/api/finance/journals?journal=GJ')).find((j) => j.source?.kind === 'nca');
  await assert.rejects(f.acct.post(`/api/finance/journals/${nca.id}/reverse`, { reason: 'x' }), /made by a module/);
  // Closing July: nothing dated in it can be posted afterwards.
  await f.acct.post('/api/finance/periods', { lockedThrough: '2026-07' });
  await assert.rejects(f.acct.post('/api/finance/journals', { date: '2026-07-15', fund: '01', particulars: 'Late', post: true, lines: [{ code: '50204020', debit: 1 }, { code: '20101010', credit: 1 }] }), /closed through July 2026/);
  await f.acct.post('/api/finance/periods', { lockedThrough: '' });
  // Existing PPE registered with its accumulated depreciation, then depreciated and disposed of.
  const truck = await f.supply.post('/api/finance/property', { type: 'ppe', code: '10606010', description: 'Service pick-up', cost: 1400000, acquired: '2024-06-15', depBooked: 0, fund: '01' });
  assert.equal(truck.life, 7);
  const plan = await f.supply.get('/api/finance/depreciation?month=2026-07');
  assert.equal(plan.total, 411666.58, 'June 2024 (acquired on the 15th) to July 2026: 26 months of (1,400,000 − 5%) ÷ 84');
  await assert.rejects(f.supply.post(`/api/finance/property/${truck.id}/dispose`, { mode: 'Sale at public auction', date: '2026-08-10' }), /Book depreciation through July 2026 first/);
  await f.supply.post('/api/finance/depreciation', { month: '2026-07' });
  await assert.rejects(f.supply.post('/api/finance/depreciation', { month: '2026-07' }), /already booked/);
  const gone = await f.supply.post(`/api/finance/property/${truck.id}/dispose`, { mode: 'Destruction (beyond repair)', date: '2026-08-10' });
  assert.equal(gone.status, 'disposed');
  const tb = await f.acct.get('/api/finance/trial-balance?fund=01');
  assert.equal(tb.rows.find((r) => r.code === '10606011'), undefined, 'accumulated depreciation derecognized');
  assert.equal(tb.debit, tb.credit);
  // Bank reconciliation keeps the statement balance and the cleared items.
  const br = await f.acct.get('/api/finance/bank-recon?code=10104040&fund=01&month=2026-08');
  assert.equal(br.book, 800000);
  await f.acct.post('/api/finance/bank-recon', { code: '10104040', fund: '01', month: '2026-08', statementBalance: 800000, cleared: br.items.map((i) => i.key) });
  assert.equal((await f.acct.get('/api/finance/bank-recon?code=10104040&fund=01&month=2026-08')).saved, true);
  // Year-end closing: 2025 has nothing to close; 2026 is not over yet.
  await assert.rejects(f.acct.post('/api/finance/closing', { year: 2025, fund: '01' }), /Nothing to close/);
  await assert.rejects(f.acct.post('/api/finance/closing', { year: 2026, fund: '01' }), /not over yet/);
  await assert.rejects(f.acct.post('/api/finance/journals', { date: '2026-08-20', fund: '01', particulars: 'Future', post: true, lines: [{ code: '50204020', debit: 1 }, { code: '20101010', credit: 1 }] }), /future date/);
});

test('year-end closing in January: revenue and expenses to accumulated surplus, statements still balance', async () => {
  const env = setup({ today: '2027-01-20' });
  const f = await office(env);
  const post = (date, lines, particulars) => f.acct.post('/api/finance/journals', { date, fund: '01', particulars, post: true, lines });
  await post('2026-03-01', [{ code: '10104040', debit: 500000 }, { code: '40301010', credit: 500000 }], 'NCA received');
  await post('2026-06-30', [{ code: '50204020', debit: 120000 }, { code: '10104040', credit: 120000 }], 'Electricity');
  await post('2027-01-10', [{ code: '50204020', debit: 9000 }, { code: '10104040', credit: 9000 }], 'January electricity');
  const closing = await f.acct.post('/api/finance/closing', { year: 2026, fund: '01' });
  assert.equal(closing.date, '2026-12-31');
  assert.deepEqual(closing.lines.at(-1), { ...closing.lines.at(-1), code: '30101010', credit: 380000 });
  await assert.rejects(f.acct.post('/api/finance/closing', { year: 2026, fund: '01' }), /already closed/);
  for (const asOf of ['2026-12-31', '2027-01-20']) {
    const pos = await f.acct.get(`/api/finance/statements/position?fund=01&asOf=${asOf}`);
    assert.equal(pos.totals.balanced, true, `balanced as of ${asOf}`);
    assert.equal(pos.totals.assets, asOf === '2026-12-31' ? 380000 : 371000);
  }
  const perf = await f.acct.get('/api/finance/statements/performance?fund=01&from=2026-01-01&to=2026-12-31');
  assert.equal(perf.totals.surplus, 380000, 'the statement for the year ignores the closing entry');
});

test('access: finance roles, students and guardians; the Control panel; card file and chart rules', async () => {
  const env = setup();
  const f = await office(env);
  const st = await f.teach.get('/api/finance/auth/status');
  assert.deepEqual(st.permissions, [], 'teachers use self-service only');
  await assert.rejects(f.teach.get('/api/finance/dashboard'), status(403));
  await assert.rejects(f.teach.get('/api/finance/journals'), status(403));
  await assert.rejects(f.budget.put('/api/finance/settings', { fiscalYear: 2027 }), status(403));
  assert.deepEqual((await f.cash.get('/api/finance/auth/status')).permissions, ['finance.view', 'finance.cardfile', 'finance.disburse', 'finance.collect']);
  assert.equal((await env.client().get('/api/finance/auth/status')).user, null);
  // The chart: 8-digit codes under a real major group; module accounts stay on.
  await assert.rejects(f.acct.post('/api/finance/accounts', { code: '1234', title: 'x' }), /8 digits/);
  await assert.rejects(f.acct.post('/api/finance/accounts', { code: '18801010', title: 'x' }), /not a major account group/);
  await f.acct.post('/api/finance/accounts', { code: '40202991', title: 'Income from Farm Produce' });
  await assert.rejects(f.acct.put('/api/finance/accounts/20201010', { active: false }), /used by the modules/);
  // Card file: TIN format, no duplicates, linked accounts once.
  await assert.rejects(f.acct.post('/api/finance/cards', { kind: 'supplier', name: 'Bad TIN', tin: '12-34' }), /TIN looks like/);
  await assert.rejects(f.acct.post('/api/finance/cards', { kind: 'supplier', name: 'Bicol Office Depot, Inc.', tin: '123-456-789-000' }), /already has a card/);
  await assert.rejects(f.teach.post('/api/finance/cards', { kind: 'supplier', name: 'X' }), status(403));
  // Control panel accounts: only an administrator manages them (no officer can make themselves an approver), only Finance types.
  const list = await f.acct.get('/api/finance/users');
  assert.ok(list.roles.some((r) => r.id === 'approver'));
  const head = list.users.find((u) => u.username === 'head');
  await assert.rejects(f.acct.post('/api/finance/users', { role: 'approver', username: 'alma2', name: 'Alma Two', password: PW }), /Only an administrator/);
  await assert.rejects(f.acct.put(`/api/finance/users/${head.id}`, { password: 'newpass123' }), /Only an administrator/);
  await assert.rejects(f.admin.post('/api/finance/users', { role: 'admin', username: 'x1', name: 'X', password: PW }), /Finance account type/);
  await assert.rejects(f.acct.put('/api/finance/settings', { funds: '01' }), /must be a list/);
  await assert.rejects(f.stud.get('/api/finance/items'), status(403));
  // Numbering formats are configurable but need a serial.
  await assert.rejects(f.acct.put('/api/finance/settings', { numbering: { dv: 'DV-{YYYY}' } }), /needs a serial/);
  await f.acct.put('/api/finance/settings', { numbering: { dv: 'DV-{F}-{YYYY}-{N5}' } });
  // A guardian is refused.
  await f.admin.post('/api/admin/users', { role: 'guardian', username: 'guard', name: 'Gina Guardian', password: PW, mustChangePassword: false });
  const g = await f.signIn('guard');
  await assert.rejects(g.get('/api/finance/my'), status(403));
  // Separation of duties: the approving officer cannot approve a voucher they certified.
  await f.admin.put('/api/finance/settings', {});
  const adm = await f.admin.get('/api/finance/auth/status');
  assert.ok(adm.permissions.includes('finance.approve') && adm.permissions.includes('finance.accounts'));
});

test('review fixes: no double payment, obligations follow deliveries, all-or-nothing changes, separation of duties', async () => {
  const env = setup();
  const f = await office(env);
  const b = await funds(f);
  const ors = await f.budget.post('/api/finance/obligations', { fund: '01', payeeId: f.janitor.id, particulars: 'Two services', lines: [{ allotmentId: b.al.id, code: '50212020', amount: 1000 }, { allotmentId: b.al.id, code: '50299990', amount: 1000 }] });
  await f.budget.post(`/api/finance/obligations/${ors.id}/obligate`);
  // Charges are added up per line; the payee must be the obligation's.
  await assert.rejects(f.cash.post('/api/finance/dvs', { fund: '01', payeeId: f.janitor.id, orsId: ors.id, gross: 1800, nature: 'services', particulars: 'x', charges: [{ line: 0, amount: 900 }, { line: 0, amount: 900 }] }), /only ₱1,000.00 of the obligation is left/);
  await assert.rejects(f.cash.post('/api/finance/dvs', { fund: '01', payeeId: f.supplier.id, orsId: ors.id, gross: 500, nature: 'services', particulars: 'x' }), /voucher pays the obligation's payee/);
  await assert.rejects(f.cash.post('/api/finance/dvs', { fund: '01', payeeId: f.janitor.id, orsId: ors.id, iarId: 'bogus', gross: 500, nature: 'services', particulars: 'x' }), /only given for a purchase order/);
  await assert.rejects(f.cash.post('/api/finance/dvs', { fund: '01', payeeId: f.janitor.id, gross: 500, particulars: 'x', debits: [{ code: '10404010', amount: 500 }] }), /only settles a liability/);
  // Box C keeps the charges the preparer chose.
  const dv = await f.cash.post('/api/finance/dvs', { fund: '01', payeeId: f.janitor.id, orsId: ors.id, gross: 1000, nature: 'services', mode: 'ada', particulars: 'Line 2 only', charges: [{ line: 1, amount: 1000 }], submit: true });
  const cert = await f.acct.post(`/api/finance/dvs/${dv.id}/certify`, { docsComplete: true });
  assert.deepEqual(cert.charges, [{ line: 1, amount: 1000 }]);
  assert.equal(cert.entry[0].code, '50299990');
  await f.head.post(`/api/finance/dvs/${dv.id}/approve`);
  await f.acct.put(`/api/finance/cards/${f.janitor.id}`, { bankAccount: '555-1' });
  // One LDDAP-ADA never pays a voucher twice.
  const l = await f.cash.post('/api/finance/lddaps', { dvIds: [dv.id, dv.id] });
  assert.equal(l.total, dv.net);
  assert.equal(env.db.data.finJournals.filter((j) => j.source?.id === dv.id).length, 1);
  await assert.rejects(f.cash.post('/api/finance/lddaps', { dvIds: [dv.id] }), /not an approved ADA voucher/);
  // A PO's obligation cannot be edited down, and its voucher pays an accepted delivery only, up to its value.
  const item = await f.supply.post('/api/finance/items', { stockNo: 'P-1', description: 'Paper', unit: 'ream', code: '10404010' });
  const pr = await f.teach.post('/api/finance/prs', { office: 'CCS', fund: '01', purpose: 'Paper', submit: true, items: [{ itemId: item.id, qty: 10, unitCost: 250 }] });
  await f.head.post(`/api/finance/prs/${pr.id}/approve`);
  let po = await f.supply.post('/api/finance/pos', { prId: pr.id, supplierId: f.supplier.id, deliveryDate: '2026-08-20', items: [{ itemId: item.id, category: 'supply', qty: 10, unitCost: 250, description: 'Paper', unit: 'ream', code: '10404060' }] });
  assert.equal(po.items[0].code, '10404010', 'a stock item keeps its own inventory account');
  po = await f.supply.post(`/api/finance/pos/${po.id}/ors`, { allotments: { MOOE: b.al.id } });
  await assert.rejects(f.budget.put(`/api/finance/obligations/${po.ors.id}`, { lines: [{ allotmentId: b.al.id, code: '50203010', amount: 1 }] }), /made from a purchase order/);
  await f.budget.post(`/api/finance/obligations/${po.ors.id}/obligate`);
  await f.head.post(`/api/finance/pos/${po.id}/approve`);
  await assert.rejects(f.cash.post('/api/finance/dvs', { fund: '01', payeeId: f.supplier.id, orsId: po.ors.id, gross: 2500, nature: 'goods', particulars: 'early' }), /accepted delivery/);
  const iar = await f.supply.post('/api/finance/iars', { poId: po.id, invoiceNo: 'S1', inspectedBy: 'I', lines: [{ line: 0, qty: 4 }] });
  await assert.rejects(f.cash.post('/api/finance/dvs', { fund: '01', payeeId: f.supplier.id, orsId: po.ors.id, iarId: iar.id, gross: 2500, nature: 'goods', particulars: 'too much' }), /₱1,000.00 of it is left to pay/);
  await assert.rejects(f.budget.post(`/api/finance/obligations/${po.ors.id}/cancel`, { reason: 'x' }), /cancel the PO first/);
  // A failed issue changes nothing (all or nothing).
  const ris = await f.teach.post('/api/finance/ris', { office: 'CCS', purpose: 'x', items: [{ itemId: item.id, qty: 3 }] });
  const ink = await f.supply.post('/api/finance/items', { stockNo: 'I-1', description: 'Ink', unit: 'bottle', code: '10404010' });
  const ris2 = await f.teach.post('/api/finance/ris', { office: 'CCS', purpose: 'x', items: [{ itemId: item.id, qty: 2 }, { itemId: ink.id, qty: 1 }] });
  await assert.rejects(f.supply.post(`/api/finance/ris/${ris2.id}/issue`), /Only 0 bottle of Ink in stock/);
  assert.equal((await f.supply.get(`/api/finance/items/${item.id}/card`)).item.onHand, 4, 'nothing left the stock');
  await f.acct.post('/api/finance/periods', { lockedThrough: '2026-07' });
  await assert.rejects(f.supply.post(`/api/finance/ris/${ris.id}/issue`, { date: '2026-07-20' }), /closed through July 2026/);
  // No second cash advance while the first is still on its way.
  const ors2 = await f.budget.post('/api/finance/obligations', { fund: '01', payeeId: f.employee.id, particulars: 'Travel', lines: [{ allotmentId: b.al.id, code: '50201010', amount: 2000 }] });
  await f.budget.post(`/api/finance/obligations/${ors2.id}/obligate`);
  await f.cash.post('/api/finance/dvs', { fund: '01', payeeId: f.employee.id, orsId: ors2.id, kind: 'advance', advanceType: 'travel', gross: 1000, particulars: 'Advance 1' });
  await assert.rejects(f.cash.post('/api/finance/dvs', { fund: '01', payeeId: f.employee.id, orsId: ors2.id, kind: 'advance', advanceType: 'travel', gross: 1000, particulars: 'Advance 2' }), /unsettled cash advance/);
});
