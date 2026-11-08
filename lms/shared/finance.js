// ATLAS Finance rules shared by the server and the browser: the chart of accounts, fund
// clusters, allotment classes, withholding taxes, depreciation, document numbering and the
// amount in words. Sources (docs/FINANCE-PLAN.md): COA Government Accounting Manual for NGAs
// (COA Circular 2015-007) and the Updated Revised Chart of Accounts (COA Circular 2020-001),
// COA-DBM Joint Circular 2013-1 (ORS/BURS, registries), DBM budget execution, BIR withholding
// on government money payments, COA Circular 2022-004 (semi-expendable property).
// Each school can change rates, thresholds, signatories and numbering in the Control panel.

// ----- Fund clusters (GAM Vol. I, Chapter 1) -----
export const FUND_CLUSTERS = [
  { code: '01', name: 'Regular Agency Fund', short: 'RAF' },
  { code: '02', name: 'Foreign Assisted Projects Fund', short: 'FAPF' },
  { code: '03', name: 'Special Account – Locally Funded/Domestic Grants Fund', short: 'SA-LF' },
  { code: '04', name: 'Special Account – Foreign Assisted/Foreign Grants Fund', short: 'SA-FA' },
  { code: '05', name: 'Internally Generated Funds', short: 'IGF' },
  { code: '06', name: 'Business Related Funds', short: 'BRF' },
  { code: '07', name: 'Trust Receipts', short: 'TR' },
];
export const fundName = (code) => FUND_CLUSTERS.find((f) => f.code === code)?.name || code;
// GAA funds (Regular Agency Fund) are obligated on an ORS; all other funds on a BURS.
export const obligationForm = (fund) => (fund === '01' ? 'ORS' : 'BURS');

// ----- Allotment classes (DBM) -----
export const ALLOTMENT_CLASSES = [
  { id: 'PS', label: 'Personnel Services', code: '501' },
  { id: 'MOOE', label: 'Maintenance and Other Operating Expenses', code: '502' },
  { id: 'FE', label: 'Financial Expenses', code: '503' },
  { id: 'CO', label: 'Capital Outlays', code: '506' },
];
export const classLabel = (id) => ALLOTMENT_CLASSES.find((c) => c.id === id)?.label || id;

// ----- Chart of accounts -----
// 8-digit account code: group (1) · major group (2) · sub-major group (2) · general ledger (3),
// from the Revised Chart of Accounts (GAM Vol. III), with the 2019 update's titles where agencies'
// reports confirm them (e.g. Mid-Year Bonus 50102160). The UACS object code adds a 2-digit
// sub-object; capital outlays are budgeted under 506 codes (see coObject) while the books debit
// the 106 property accounts.
// Flags: c = contra account (normal balance opposite to its group); h = can only be posted
// through its module (cash, inventory and property accounts are kept by their modules too,
// but may be adjusted by a journal entry).
const CHART = `
10101010|Cash-Collecting Officers
10101020|Petty Cash
10102020|Cash in Bank-Local Currency, Current Account
10102030|Cash in Bank-Local Currency, Savings Account
10102040|Cash in Bank-Local Currency, Time Deposits
10104010|Cash-Treasury/Agency Deposit, Regular
10104020|Cash-Treasury/Agency Deposit, Special Account
10104030|Cash-Treasury/Agency Deposit, Trust
10104040|Cash-Modified Disbursement System (MDS), Regular
10104050|Cash-Modified Disbursement System (MDS), Special Account
10104060|Cash-Modified Disbursement System (MDS), Trust
10104070|Cash-Tax Remittance Advice
10104080|Cash-Constructive Income Remittance
10301010|Accounts Receivable
10301011|Allowance for Impairment-Accounts Receivable|c
10301050|Interests Receivable
10302010|Operating Lease Receivable
10303010|Due from National Government Agencies
10303020|Due from Government-Owned or Controlled Corporations
10303030|Due from Local Government Units
10304050|Due from Other Funds
10305010|Receivables-Disallowances/Charges
10305020|Due from Officers and Employees
10305990|Other Receivables
10401010|Merchandise Inventory
10404010|Office Supplies Inventory
10404020|Accountable Forms, Plates and Stickers Inventory
10404030|Non-Accountable Forms Inventory
10404050|Food Supplies Inventory
10404060|Drugs and Medicines Inventory
10404070|Medical, Dental and Laboratory Supplies Inventory
10404080|Fuel, Oil and Lubricants Inventory
10404090|Agricultural and Marine Supplies Inventory
10404100|Textbooks and Instructional Materials Inventory
10404130|Construction Materials Inventory
10404990|Other Supplies and Materials Inventory
10405010|Semi-Expendable Machinery
10405020|Semi-Expendable Office Equipment
10405030|Semi-Expendable Information and Communications Technology Equipment
10405040|Semi-Expendable Agricultural and Forestry Equipment
10405070|Semi-Expendable Communication Equipment
10405100|Semi-Expendable Medical Equipment
10405120|Semi-Expendable Sports Equipment
10405130|Semi-Expendable Technical and Scientific Equipment
10405190|Semi-Expendable Other Machinery and Equipment
10406010|Semi-Expendable Furniture and Fixtures
10406020|Semi-Expendable Books
10601010|Land
10602990|Other Land Improvements
10602991|Accumulated Depreciation-Other Land Improvements|c
10604010|Buildings
10604011|Accumulated Depreciation-Buildings|c
10604020|School Buildings
10604021|Accumulated Depreciation-School Buildings|c
10604060|Hostels and Dormitories
10604061|Accumulated Depreciation-Hostels and Dormitories|c
10604990|Other Structures
10604991|Accumulated Depreciation-Other Structures|c
10605010|Machinery
10605011|Accumulated Depreciation-Machinery|c
10605020|Office Equipment
10605021|Accumulated Depreciation-Office Equipment|c
10605030|Information and Communications Technology Equipment
10605031|Accumulated Depreciation-Information and Communications Technology Equipment|c
10605040|Agricultural and Forestry Equipment
10605041|Accumulated Depreciation-Agricultural and Forestry Equipment|c
10605070|Communication Equipment
10605071|Accumulated Depreciation-Communication Equipment|c
10605110|Medical Equipment
10605111|Accumulated Depreciation-Medical Equipment|c
10605130|Sports Equipment
10605131|Accumulated Depreciation-Sports Equipment|c
10605140|Technical and Scientific Equipment
10605141|Accumulated Depreciation-Technical and Scientific Equipment|c
10605990|Other Machinery and Equipment
10605991|Accumulated Depreciation-Other Machinery and Equipment|c
10606010|Motor Vehicles
10606011|Accumulated Depreciation-Motor Vehicles|c
10607010|Furniture and Fixtures
10607011|Accumulated Depreciation-Furniture and Fixtures|c
10607020|Books
10607021|Accumulated Depreciation-Books|c
10699010|Construction in Progress-Land Improvements
10699030|Construction in Progress-Buildings and Other Structures
10801020|Computer Software
10801021|Accumulated Amortization-Computer Software|c
19901010|Advances for Operating Expenses
19901020|Advances for Payroll
19901030|Advances to Special Disbursing Officers
19901040|Advances to Officers and Employees
19902010|Advances to Contractors
19902020|Prepaid Rent
19902030|Prepaid Registration
19902050|Prepaid Insurance
19902990|Other Prepayments
19903020|Guaranty Deposits
20101010|Accounts Payable
20101020|Due to Officers and Employees
20201010|Due to BIR
20201020|Due to GSIS
20201030|Due to Pag-IBIG
20201040|Due to PhilHealth
20201050|Due to NGAs
20201060|Due to GOCCs
20201070|Due to LGUs
20301050|Due to Other Funds
20401010|Trust Liabilities
20401040|Guaranty/Security Deposits Payable
20401050|Customers' Deposits Payable
20501990|Other Deferred Credits
20502990|Other Unearned Revenue
20601020|Leave Benefits Payable
29999990|Other Payables
30101010|Accumulated Surplus/(Deficit)
30101030|Contributed Capital
30301010|Revenue and Expense Summary
40201040|Clearance and Certification Fees
40201130|Processing Fees
40201140|Fines and Penalties-Service Income
40201990|Other Service Income
40202010|School Fees
40202020|Affiliation Fees
40202030|Examination Fees
40202040|Seminar/Training Fees
40202050|Rent/Lease Income
40202130|Income from Hostels/Dormitories and Other Like Facilities
40202150|Income from Printing and Publication
40202160|Sales Revenue
40202161|Sales Discounts|c
40202210|Interest Income
40202230|Fines and Penalties-Business Income
40202990|Other Business Income
40301010|Subsidy from National Government
40301020|Subsidy from Other National Government Agencies
40301050|Subsidy from Other Funds
40402010|Income from Grants and Donations in Cash
40402020|Income from Grants and Donations in Kind
40501040|Gain on Sale of Property, Plant and Equipment
40501090|Gain on Sale of Agricultural Produce
40601020|Sale of Unserviceable Property
40609990|Miscellaneous Income
50101010|Salaries and Wages-Regular
50101020|Salaries and Wages-Casual/Contractual
50102010|Personnel Economic Relief Allowance (PERA)
50102020|Representation Allowance (RA)
50102030|Transportation Allowance (TA)
50102040|Clothing/Uniform Allowance
50102050|Subsistence Allowance
50102060|Laundry Allowance
50102100|Honoraria
50102110|Hazard Pay
50102120|Longevity Pay
50102130|Overtime and Night Pay
50102140|Year End Bonus
50102150|Cash Gift
50102160|Mid-Year Bonus
50102990|Other Bonuses and Allowances
50103010|Retirement and Life Insurance Premiums
50103020|Pag-IBIG Contributions
50103030|PhilHealth Contributions
50103040|Employees Compensation Insurance Premiums
50104020|Retirement Gratuity
50104030|Terminal Leave Benefits
50104990|Other Personnel Benefits
50201010|Traveling Expenses-Local
50201020|Traveling Expenses-Foreign
50202010|Training Expenses
50202020|Scholarship Grants/Expenses
50203010|Office Supplies Expenses
50203020|Accountable Forms Expenses
50203030|Non-Accountable Forms Expenses
50203050|Food Supplies Expenses
50203070|Drugs and Medicines Expenses
50203080|Medical, Dental and Laboratory Supplies Expenses
50203090|Fuel, Oil and Lubricants Expenses
50203100|Agricultural and Marine Supplies Expenses
50203110|Textbooks and Instructional Materials Expenses
50203210|Semi-Expendable Machinery and Equipment Expenses
50203220|Semi-Expendable Furniture, Fixtures and Books Expenses
50203990|Other Supplies and Materials Expenses
50204010|Water Expenses
50204020|Electricity Expenses
50205010|Postage and Courier Expenses
50205020|Telephone Expenses
50205030|Internet Subscription Expenses
50205040|Cable, Satellite, Telegraph and Radio Expenses
50206010|Awards/Rewards Expenses
50207020|Research, Exploration and Development Expenses
50211010|Legal Services
50211020|Auditing Services
50211030|Consultancy Services
50211990|Other Professional Services
50212010|Environment/Sanitary Services
50212020|Janitorial Services
50212030|Security Services
50212990|Other General Services
50213020|Repairs and Maintenance-Land Improvements
50213040|Repairs and Maintenance-Buildings and Other Structures
50213050|Repairs and Maintenance-Machinery and Equipment
50213060|Repairs and Maintenance-Transportation Equipment
50213070|Repairs and Maintenance-Furniture and Fixtures
50213210|Repairs and Maintenance –Semi-Expendable Machinery and Equipment
50213220|Repairs and Maintenance-Semi-Expendable Furniture, Fixtures and Books
50214010|Subsidy to NGAs
50214020|Financial Assistance to NGAs
50214050|Financial Assistance to NGOs/POs
50214990|Subsidies-Others
50215010|Taxes, Duties and Licenses
50215020|Fidelity Bond Premiums
50215030|Insurance Expenses
50216010|Labor and Wages
50299010|Advertising, Promotional and Marketing Expenses
50299020|Printing and Publication Expenses
50299030|Representation Expenses
50299040|Transportation and Delivery Expenses
50299050|Rent/Lease Expenses
50299060|Membership Dues and Contributions to Organizations
50299070|Subscription Expenses
50299080|Donations
50299990|Other Maintenance and Operating Expenses
50301020|Interest Expenses
50301040|Bank Charges
50402010|Cost of Sales
50501020|Depreciation-Land Improvements
50501040|Depreciation-Buildings and Other Structures
50501050|Depreciation-Machinery and Equipment
50501060|Depreciation-Transportation Equipment
50501070|Depreciation-Furniture, Fixtures and Books
50501990|Depreciation-Other Property, Plant and Equipment
50502010|Amortization-Intangible Assets
50503020|Impairment Loss-Loans and Receivables
50503070|Impairment Loss-Inventories
50503090|Impairment Loss-Property, Plant and Equipment
50504040|Loss on Sale of Property, Plant and Equipment
50504090|Loss of Assets
`;

export const GROUPS = { 1: 'Assets', 2: 'Liabilities', 3: 'Equity', 4: 'Revenue', 5: 'Expenses' };
// The 2-digit major groups and 4-digit sub-majors used for statement lines.
export const MAJOR = {
  101: 'Cash and Cash Equivalents', 102: 'Investments', 103: 'Receivables', 104: 'Inventories', 105: 'Investment Property',
  106: 'Property, Plant and Equipment', 107: 'Biological Assets', 108: 'Intangible Assets', 199: 'Other Assets (Advances, Prepayments, Deposits)',
  201: 'Financial Liabilities', 202: 'Inter-Agency Payables', 203: 'Intra-Agency Payables', 204: 'Trust Liabilities', 205: 'Deferred Credits/Unearned Income', 206: 'Provisions', 299: 'Other Payables',
  301: 'Government Equity', 302: 'Revaluation Surplus', 303: 'Intermediate Accounts',
  402: 'Service and Business Income', 403: 'Transfers, Assistance and Subsidy', 404: 'Shares, Grants and Donations', 405: 'Gains', 406: 'Miscellaneous Income',
  501: 'Personnel Services', 502: 'Maintenance and Other Operating Expenses', 503: 'Financial Expenses', 504: 'Direct Costs', 505: 'Non-Cash Expenses',
};
// Current assets on the Statement of Financial Position (advances and prepayments are current).
export const CURRENT_ASSETS = ['101', '102', '103', '104', '199'];
// Accounts kept per payee/officer in subsidiary ledgers: receivables, advances, payables.
export const tracksCard = (code) => /^(103|199|201|202|204)/.test(String(code));

const normalOf = (code, contra) => {
  const debit = ['1', '5'].includes(code[0]);
  return (contra ? !debit : debit) ? 'debit' : 'credit';
};
// Allotment class of an object code: PS (501), MOOE (502), FE (503), CO (property and capital assets).
export function classOf(code) {
  const c = String(code);
  if (c.startsWith('501')) return 'PS';
  if (c.startsWith('502')) return 'MOOE';
  if (c.startsWith('503')) return 'FE';
  if (/^10[5-8]/.test(c) && !/[12]$/.test(c)) return 'CO'; // property, biological and intangible assets (not their contra accounts)
  return null;
}

export const DEFAULT_CHART = CHART.trim().split('\n').map((line) => {
  const [code, title, flags = ''] = line.split('|');
  return { code, title, group: Number(code[0]), normal: normalOf(code, flags.includes('c')), contra: flags.includes('c'), cls: classOf(code), active: true };
});
export const uacs = (code) => `${code}00`;
// Capital outlay budget object for a property account: 106 SS GGG → 506 04 SS 0 + last two of GGG (e.g. ICT equipment 10605030 → 5060405003).
export const coObject = (code) => (/^10[5-8]\d{5}$/.test(code) ? `506${({ 105: '03', 106: '04', 107: '05', 108: '06' })[code.slice(0, 3)]}${code.slice(3, 5)}0${code.slice(5, 7)}` : `${code}00`);

// Well-known accounts the modules post to.
export const ACCT = {
  cashCollecting: '10101010',
  pettyCash: '10101020',
  cashBank: '10102020',
  cashTreasury: '10104010',
  cashMds: '10104040',
  cashMdsTrust: '10104060',
  cashTra: '10104070',
  cashCir: '10104080',
  receivable: '10301010',
  dueFromOfficers: '10305020',
  advancesOpex: '19901010',
  advancesPayroll: '19901020',
  advancesSdo: '19901030',
  advancesOfficers: '19901040',
  payable: '20101010',
  dueOfficers: '20101020',
  dueBir: '20201010',
  guaranty: '20401040',
  surplus: '30101010',
  summary: '30301010',
  subsidyNg: '40301010',
  fines: '40201140',
  lossOnSale: '50504040',
  lossOfAssets: '50504090',
  miscIncome: '40609990',
  semiExpMachinery: '50203210',
  semiExpFurniture: '50203220',
};

// Cash advances (COA Circular 97-002 / GAM): the advance account by purpose.
export const ADVANCE_TYPES = [
  ['opex', 'Operating expenses (activities, special purposes)', ACCT.advancesOpex],
  ['travel', 'Official local travel', ACCT.advancesOfficers],
  ['foreign', 'Official foreign travel', ACCT.advancesOfficers],
  ['payroll', 'Payroll', ACCT.advancesPayroll],
  ['sdo', 'Special disbursing officer', ACCT.advancesSdo],
];

// ----- Property, plant and equipment (GAM Vol. I Chapter 10; COA Circular 2022-004) -----
// For each PPE account: accumulated depreciation account, depreciation expense and the
// estimated useful life in years (COA Circular 2003-007 Annex A, kept by COA Circular 2015-002:
// concrete buildings 30, office and ICT equipment and books 5, motor vehicles 7, most other
// equipment, furniture and land improvements 10). Each item's life can be changed when registered.
export const PPE_CLASSES = [
  { code: '10602990', life: 10 },
  { code: '10604010', life: 30 },
  { code: '10604020', life: 30 },
  { code: '10604060', life: 30 },
  { code: '10604990', life: 10 },
  { code: '10605010', life: 10 },
  { code: '10605020', life: 5 },
  { code: '10605030', life: 5 },
  { code: '10605040', life: 10 },
  { code: '10605070', life: 10 },
  { code: '10605110', life: 10 },
  { code: '10605130', life: 10 },
  { code: '10605140', life: 10 },
  { code: '10605990', life: 10 },
  { code: '10606010', life: 7 },
  { code: '10607010', life: 10 },
  { code: '10607020', life: 5 },
].map((c) => ({ ...c, accum: c.code.replace(/0$/, '1'), expense: depreciationAccount(c.code) }));
function depreciationAccount(code) {
  const sub = code.slice(0, 5);
  return { 10602: '50501020', 10604: '50501040', 10605: '50501050', 10606: '50501060', 10607: '50501070' }[sub] || '50501990';
}
// Semi-expendable property (below the capitalization threshold): inventory account → expense on issue.
export const SEMI_CLASSES = [
  ['10405010', '50203210'], ['10405020', '50203210'], ['10405030', '50203210'], ['10405040', '50203210'], ['10405070', '50203210'],
  ['10405100', '50203210'], ['10405120', '50203210'], ['10405130', '50203210'], ['10405190', '50203210'],
  ['10406010', '50203220'], ['10406020', '50203220'],
].map(([code, expense]) => ({ code, expense }));
// Supplies inventory account → expense account when issued (RSMI).
export const SUPPLY_CLASSES = [
  ['10404010', '50203010'], ['10404020', '50203020'], ['10404030', '50203030'], ['10404050', '50203050'],
  ['10404060', '50203070'], ['10404070', '50203080'], ['10404080', '50203090'], ['10404090', '50203100'], ['10404100', '50203110'],
  ['10404990', '50203990'],
].map(([code, expense]) => ({ code, expense }));

// Straight-line depreciation (GAM Vol. I Ch. 10): (cost − residual value) ÷ useful life in months,
// for the full month when the asset is available for use on or before the 15th, otherwise from
// the next month; never below the residual value.
export function depreciation({ cost, residual, lifeYears, acquired }, throughMonth) {
  const monthly = round2((cost - residual) / (lifeYears * 12));
  const [y, m, d] = acquired.split('-').map(Number);
  const [ty, tm] = throughMonth.split('-').map(Number);
  const months = Math.max(0, (ty - y) * 12 + (tm - m) + (d <= 15 ? 1 : 0));
  const max = round2(cost - residual);
  const accumulated = Math.min(max, round2(monthly * months));
  return { monthly, months, accumulated, bookValue: round2(cost - accumulated), fully: accumulated >= max };
}

// ----- Withholding taxes on government money payments (BIR) -----
// kind: ewt (creditable expanded withholding: government payors use WI/WC640 for goods and
// WI/WC157 for services; WI/WC158 and 160 are for private top withholding agents), vat (5%
// creditable VAT withheld by government since 2021, RMC 36-2021; certificate BIR 2307, return
// 1600-VT), pt (3% percentage tax withheld from non-VAT payees since July 2023, return 1600-PT).
// base: the amount net of VAT for VAT-registered payees.
export const DEFAULT_TAXES = [
  { atc: 'WI640', kind: 'ewt', rate: 1, payee: 'individual', nature: 'goods', label: 'Government money payments to individuals – purchase of goods' },
  { atc: 'WC640', kind: 'ewt', rate: 1, payee: 'corporation', nature: 'goods', label: 'Government money payments to corporations – purchase of goods' },
  { atc: 'WI157', kind: 'ewt', rate: 2, payee: 'individual', nature: 'services', label: 'Government money payments to individuals – purchase of services' },
  { atc: 'WC157', kind: 'ewt', rate: 2, payee: 'corporation', nature: 'services', label: 'Government money payments to corporations – purchase of services' },
  { atc: 'WI100', kind: 'ewt', rate: 5, payee: 'individual', nature: 'rent', label: 'Rentals of real and personal property – individuals' },
  { atc: 'WC100', kind: 'ewt', rate: 5, payee: 'corporation', nature: 'rent', label: 'Rentals of real and personal property – corporations' },
  { atc: 'WI010', kind: 'ewt', rate: 5, payee: 'individual', nature: 'professional', label: 'Professional fees – individuals, gross income ₱3M and below' },
  { atc: 'WI011', kind: 'ewt', rate: 10, payee: 'individual', nature: 'professional-high', label: 'Professional fees – individuals, gross income over ₱3M or VAT-registered' },
  { atc: 'WC010', kind: 'ewt', rate: 10, payee: 'corporation', nature: 'professional', label: 'Professional fees – corporations, gross income ₱720K and below' },
  { atc: 'WC011', kind: 'ewt', rate: 15, payee: 'corporation', nature: 'professional-high', label: 'Professional fees – corporations, gross income over ₱720K' },
  { atc: 'WI120', kind: 'ewt', rate: 2, payee: 'individual', nature: 'contractor', label: 'Income payments to contractors – individuals' },
  { atc: 'WC120', kind: 'ewt', rate: 2, payee: 'corporation', nature: 'contractor', label: 'Income payments to contractors – corporations' },
  { atc: 'WV010', kind: 'vat', rate: 5, nature: 'goods', label: 'Creditable VAT withheld by government – purchase of goods (BIR 1600-VT)' },
  { atc: 'WV020', kind: 'vat', rate: 5, nature: 'services', label: 'Creditable VAT withheld by government – purchase of services, rent, contractors, professionals (BIR 1600-VT)' },
  { atc: 'WB080', kind: 'pt', rate: 3, nature: 'any', label: 'Percentage tax withheld by government on payments to non-VAT payees, Sec. 116 (BIR 1600-PT)' },
];
export const NATURES = [
  ['goods', 'Goods (supplies, equipment)'],
  ['services', 'Services'],
  ['contractor', 'Contractor (infrastructure, repairs)'],
  ['rent', 'Rent / lease'],
  ['professional', 'Professional fees'],
  ['professional-high', 'Professional fees (payee above the income threshold)'],
  ['none', 'No withholding (employees\' reimbursements, other agencies, exempt)'],
];
// VAT and percentage tax treat everything that is not goods as services.
const vatNature = (n) => (n === 'goods' ? 'goods' : 'services');

// Taxes on a payment of `gross` (VAT-inclusive for VAT-registered payees).
// payee: { taxType: 'individual'|'corporation', vat: 'vat'|'nonvat'|'exempt' }.
export function withholding(gross, nature, payee, taxes = DEFAULT_TAXES) {
  const g = round2(gross);
  if (!g || nature === 'none' || payee?.vat === 'exempt') return { base: g, lines: [], total: 0, net: g };
  const vatReg = payee?.vat === 'vat';
  const base = vatReg ? round2(g / 1.12) : g;
  const pick = (kind, n, who) => taxes.find((t) => t.kind === kind && t.nature === n && (!who || !t.payee || t.payee === who));
  const lines = [];
  const ewt = pick('ewt', nature, payee?.taxType === 'corporation' ? 'corporation' : 'individual');
  if (ewt) lines.push({ atc: ewt.atc, kind: 'ewt', rate: ewt.rate, base, amount: round2((base * ewt.rate) / 100) });
  if (vatReg) {
    const v = pick('vat', vatNature(nature));
    if (v) lines.push({ atc: v.atc, kind: 'vat', rate: v.rate, base, amount: round2((base * v.rate) / 100) });
  } else {
    const p = taxes.find((t) => t.kind === 'pt');
    if (p) lines.push({ atc: p.atc, kind: 'pt', rate: p.rate, base, amount: round2((base * p.rate) / 100) });
  }
  const total = sum(lines, (l) => l.amount);
  return { base, lines, total, net: round2(g - total) };
}

// ----- Money -----
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const sum = (list, fn = (x) => x) => list.reduce((s, x) => s + Math.round(Number(fn(x) || 0) * 100), 0) / 100;
export const peso = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function words(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`;
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${words(n % 100)}` : ''}`;
  for (const [size, name] of [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']]) {
    if (n >= size) return `${words(Math.floor(n / size))} ${name}${n % size ? ` ${words(n % size)}` : ''}`;
  }
  return '';
}
// "One Thousand Two Hundred Pesos and 50/100" — as written on checks and vouchers.
export function amountInWords(amount) {
  const a = round2(Math.abs(amount));
  const pesos = Math.floor(a);
  const cents = Math.round((a - pesos) * 100);
  return `${pesos ? words(pesos) : 'Zero'} Peso${pesos === 1 ? '' : 's'}${cents ? ` and ${String(cents).padStart(2, '0')}/100` : ' Only'}`;
}

// ----- Document numbering -----
// Formats use {F} fund cluster, {YYYY} year, {MM} month, {N} serial (with digits: {N4}).
export const DEFAULT_NUMBERING = {
  jev: '{F}-{YYYY}-{MM}-{N4}',
  ors: '{F}-{YYYY}-{MM}-{N4}',
  dv: '{F}-{YYYY}-{MM}-{N4}',
  pr: '{YYYY}-{MM}-{N4}',
  po: '{YYYY}-{MM}-{N4}',
  iar: '{YYYY}-{MM}-{N4}',
  ris: '{YYYY}-{MM}-{N4}',
  par: '{YYYY}-{MM}-{N4}',
  ics: '{YYYY}-{MM}-{N4}',
  ptr: '{YYYY}-{MM}-{N4}',
  iirup: '{YYYY}-{MM}-{N4}',
  property: '{YYYY}-{N4}',
  rcd: '{F}-{YYYY}-{MM}-{N4}',
  lddap: '{F}-{YYYY}-{MM}-{N4}',
  liq: '{YYYY}-{MM}-{N4}',
};
// GAM Volume II appendix of each form (shown on printouts).
export const APPENDIX = { jev: 36, ors: 11, burs: 14, dv: 32, pr: 60, po: 61, iar: 62, ris: 63, rsmi: 64, rpci: 66, raaf: 67, pc: 70, ppelc: 72, par: 73, rpcppe: 74, iirup: 75, ptr: 77, ics: 59, sc: 58, slc: 57, rcd: 26, crrec: 29, lddap: 42, liq: 44, raod: 9, rbud: 10, saaodb: 17, far3: 22, brs: 81 };
export const DOC_LABELS = {
  jev: 'Journal Entry Voucher', ors: 'Obligation Request and Status', burs: 'Budget Utilization Request and Status', dv: 'Disbursement Voucher',
  pr: 'Purchase Request', po: 'Purchase Order', iar: 'Inspection and Acceptance Report', ris: 'Requisition and Issue Slip',
  par: 'Property Acknowledgment Receipt', ics: 'Inventory Custodian Slip', ptr: 'Property Transfer Report', iirup: 'Inventory and Inspection Report of Unserviceable Property',
  property: 'Property number', rcd: 'Report of Collections and Deposits', lddap: 'List of Due and Demandable Accounts Payable – ADA', liq: 'Liquidation Report',
};
export function formatNo(format, { fund = '', date, serial }) {
  const [y, m] = date.split('-');
  return format.replace(/\{F\}/g, fund).replace(/\{YYYY\}/g, y).replace(/\{YY\}/g, y.slice(2)).replace(/\{MM\}/g, m)
    .replace(/\{N(\d?)\}/g, (_, d) => String(serial).padStart(Number(d) || 1, '0'));
}

// ----- Journals (GAM books of accounts) -----
export const JOURNALS = [
  ['GJ', 'General Journal'],
  ['CRJ', 'Cash Receipts Journal'],
  ['CDJ', 'Cash Disbursements Journal'],
  ['CKDJ', 'Check Disbursements Journal'],
];

// ----- Statuses -----
export const ORS_STATUS = { draft: 'Draft', obligated: 'Obligated', cancelled: 'Cancelled' };
export const DV_STATUS = { draft: 'Draft', certified: 'Certified (Box C)', approved: 'Approved (Box D)', paid: 'Paid', cancelled: 'Cancelled' };
export const PR_STATUS = { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', ordered: 'Ordered', cancelled: 'Cancelled' };
export const PO_STATUS = { draft: 'Draft', approved: 'Approved', partial: 'Partly delivered', delivered: 'Delivered', cancelled: 'Cancelled' };
export const RIS_STATUS = { requested: 'Requested', approved: 'Approved', issued: 'Issued', cancelled: 'Cancelled' };
// Modes of procurement under the New Government Procurement Act (RA 12009, IRR effective 25 Feb 2025).
export const PROCUREMENT_MODES = [
  'Small Value Procurement', 'Direct Acquisition', 'Competitive Bidding', 'Limited Source Bidding', 'Direct Contracting', 'Repeat Order',
  'Negotiated Procurement – Agency-to-Agency', 'Negotiated Procurement – Emergency Cases', 'Negotiated Procurement – Direct Retail Purchase',
  'Negotiated Procurement – Lease of Real Property', 'Direct Sales', 'Direct Procurement for Science, Technology and Innovation', 'Procurement Service – DBM (PS-DBM)',
];
export const PAYMENT_MODES = [
  ['check', 'MDS check'],
  ['ada', 'LDDAP-ADA (online)'],
  ['bank', 'Check from the agency bank account'],
  ['cash', 'Cash (petty cash / disbursing officer)'],
];

// ----- Permissions -----
export const FINANCE_PERMISSION_LABELS = [
  ['finance.view', 'Finance dashboard, books and reports'],
  ['finance.cardfile', 'Card file: suppliers, payees and accountable officers'],
  ['finance.accounts', 'Accounting: journal entries, certifying vouchers (Box C), liquidations, bank reconciliation, closing'],
  ['finance.budget', 'Budget: appropriations, allotments, NCAs, obligation requests (Box B)'],
  ['finance.procure', 'Procurement: purchase requests and purchase orders'],
  ['finance.inventory', 'Inventory: deliveries (IAR), stock, requisitions (RIS), physical count'],
  ['finance.property', 'Property: PPE and semi-expendable property, PAR/ICS/PTR, depreciation, disposal'],
  ['finance.disburse', 'Disbursement: vouchers, checks and LDDAP-ADA, cash advances, tax remittances'],
  ['finance.collect', 'Revenue: official receipts, collections and deposits, accountable forms'],
  ['finance.approve', 'Approving officer: purchase requests and orders, vouchers (Box D)'],
  ['finance.settings', 'Control panel: entity, funds, offices, signatories, numbering, taxes, periods, users'],
];

export const CARD_KINDS = [
  ['supplier', 'Supplier / contractor'],
  ['employee', 'Employee'],
  ['officer', 'Accountable officer'],
  ['agency', 'Government agency'],
  ['individual', 'Individual / customer'],
];
export const VAT_STATUS = [['vat', 'VAT-registered'], ['nonvat', 'Non-VAT (percentage tax)'], ['exempt', 'Exempt from withholding']];
