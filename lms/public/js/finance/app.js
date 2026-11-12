// ATLAS Finance (/finance/): government accounting for the school, per COA (Government Accounting
// Manual, Revised Chart of Accounts), DBM (budget execution, ORS/BURS) and BIR (withholding on
// government money payments). Modules: Card file, Accounts, Budget, Inventory, Property,
// Disbursement, Revenue and the Control panel; self-service for employees and students.
import { startApp, authScreen } from '../shell.js';
import { systemRoutes, systemNav } from '../system/index.js';
import { html } from '../ui.js';
import { api } from '../api.js';
import { fin, can, isStaff, isStudent, improveAccess } from './state.js';
import { dashboardView, findView } from './views/dashboard.js';
import { cardListView, cardView } from './views/cards.js';
import { journalListView, journalFormView, journalView, ledgerView, trialBalanceView, statementsView, chartView, bankReconView } from './views/accounts.js';
import { budgetView, obligationListView, obligationFormView, obligationView, budgetReportsView } from './views/budget.js';
import { itemListView, stockCardView, prListView, prView, poListView, poFormView, poView, risListView, risView, inventoryReportsView } from './views/inventory.js';
import { propertyListView, propertyView, depreciationView, propertyReportsView } from './views/property.js';
import { dvListView, dvFormView, dvView, lddapView, advancesView, taxesView } from './views/disbursement.js';
import { receiptListView, rcdListView, rcdView, bookletsView, revenueView } from './views/revenue.js';
import { controlView, auditView } from './views/control.js';
import { myView, myRequestsView } from './views/self.js';
import { printView } from './views/print.js';

const perm = (p) => () => can(p);
const staff = () => isStaff();
const employee = () => !isStudent();

const routes = [
  ['/dashboard', dashboardView, staff],
  ['/find', findView, staff],
  ['/cards', cardListView, staff],
  ['/cards/:id', cardView, staff],
  ['/journals', journalListView, staff],
  ['/journals/new', journalFormView, perm('finance.accounts')],
  ['/journals/:id', journalView, staff],
  ['/ledger', ledgerView, staff],
  ['/ledger/:code', ledgerView, staff],
  ['/trial-balance', trialBalanceView, staff],
  ['/statements', statementsView, staff],
  ['/chart', chartView, staff],
  ['/bank-recon', bankReconView, staff],
  ['/budget', budgetView, staff],
  ['/obligations', obligationListView, staff],
  ['/obligations/new', obligationFormView, staff],
  ['/obligations/:id', obligationView, staff],
  ['/budget-reports', budgetReportsView, staff],
  ['/items', itemListView, staff],
  ['/items/:id', stockCardView, staff],
  ['/prs', prListView, employee],
  ['/prs/:id', prView, employee],
  ['/pos', poListView, staff],
  ['/pos/new', poFormView, perm('finance.procure')],
  ['/pos/:id', poView, staff],
  ['/ris', risListView, employee],
  ['/ris/:id', risView, employee],
  ['/inventory-reports', inventoryReportsView, staff],
  ['/property', propertyListView, staff],
  ['/property/:id', propertyView, staff],
  ['/depreciation', depreciationView, staff],
  ['/property-reports', propertyReportsView, staff],
  ['/dvs', dvListView, staff],
  ['/dvs/new', dvFormView, perm('finance.disburse')],
  ['/dvs/:id', dvView, staff],
  ['/lddap', lddapView, staff],
  ['/advances', advancesView, staff],
  ['/taxes', taxesView, staff],
  ['/receipts', receiptListView, staff],
  ['/rcds', rcdListView, staff],
  ['/rcds/:id', rcdView, staff],
  ['/booklets', bookletsView, staff],
  ['/revenue', revenueView, staff],
  ['/control', controlView, () => can('finance.settings') || can('finance.accounts')],
  ['/audit', auditView, staff],
  ['/me', myView],
  ['/me/requests', myRequestsView, employee],
  ['/print/:kind/:id', printView],
  ...systemRoutes(),
];

function nav() {
  if (isStudent()) return [{ heading: 'Finance' }, { href: '/me', label: 'My payments', icon: 'receipt' }];
  if (!isStaff()) {
    return [
      { heading: 'Self-service' },
      { href: '/me', label: 'My accountabilities', icon: 'shield', exact: true },
      { href: '/me/requests', label: 'Supply & purchase requests', icon: 'cart', also: ['/ris', '/prs'] },
    ];
  }
  // Each page has one name, used in the sidebar, its title and its breadcrumb.
  return [
    { heading: 'Finance' },
    { href: '/dashboard', label: 'Dashboard', icon: 'chart' },
    { href: '/find', label: 'Find a document', icon: 'search' },
    { href: '/cards', label: 'Card file', icon: 'users' },
    { heading: 'Accounts' },
    { href: '/journals', label: 'Journal entries', icon: 'book', badge: 'journals' },
    { href: '/ledger', label: 'Ledgers', icon: 'table' },
    { href: '/trial-balance', label: 'Trial balance', icon: 'scale' },
    { href: '/statements', label: 'Financial statements', icon: 'file' },
    { href: '/bank-recon', label: 'Bank reconciliation', icon: 'bank' },
    { href: '/chart', label: 'Chart of accounts', icon: 'layers' },
    { heading: 'Budget' },
    { href: '/budget', label: 'Budget & allotments', icon: 'wallet' },
    { href: '/obligations', label: 'Obligations', icon: 'clipboard', badge: 'ors' },
    { href: '/budget-reports', label: 'Budget reports', icon: 'chart' },
    { heading: 'Inventory' },
    { href: '/prs', label: 'Purchase requests', icon: 'cart', badge: 'prs' },
    { href: '/pos', label: 'Purchase orders', icon: 'truck', badge: 'pos' },
    { href: '/ris', label: 'Requisitions', icon: 'inbox', badge: 'ris' },
    { href: '/items', label: 'Stock', icon: 'box' },
    { href: '/inventory-reports', label: 'Inventory reports', icon: 'clipboard' },
    { heading: 'Property' },
    { href: '/property', label: 'Property', icon: 'building' },
    { href: '/depreciation', label: 'Depreciation', icon: 'down' },
    { href: '/property-reports', label: 'Property reports', icon: 'clipboard' },
    { heading: 'Disbursement' },
    { href: '/dvs', label: 'Disbursement vouchers', icon: 'file', badge: 'dvs' },
    { href: '/lddap', label: 'LDDAP-ADA', icon: 'bank' },
    { href: '/advances', label: 'Cash advances', icon: 'coins', badge: 'advances' },
    { href: '/taxes', label: 'Taxes withheld', icon: 'percent' },
    { heading: 'Revenue' },
    { href: '/receipts', label: 'Official receipts', icon: 'receipt' },
    { href: '/rcds', label: 'Collections & deposits', icon: 'bank', badge: 'rcds' },
    { href: '/booklets', label: 'Accountable forms', icon: 'book' },
    { href: '/revenue', label: 'Revenue monitoring', icon: 'chart' },
    { heading: 'Control panel' },
    (can('finance.settings') || can('finance.accounts')) && { href: '/control', label: 'Control panel', icon: 'settings' },
    { href: '/audit', label: 'Audit trail', icon: 'shield' },
    { heading: 'Me' },
    { href: '/me', label: 'My accountabilities', icon: 'user', exact: true },
    ...systemNav(),
  ].filter(Boolean);
}

const home = () => (isStaff() ? '/dashboard' : '/me');

function signedOutView(el, { status }) {
  if (status.deniedUser) {
    return authScreen(el, {}, html`<div class="auth-card"><h2>Finance is for the school</h2>
      <p class="muted">You are signed in as ${status.deniedUser.name}. ATLAS Finance is for the school's employees and students. Your systems are on the ATLAS home page.</p>
      <a class="btn primary block" href="/">Back to ATLAS home</a></div>`);
  }
  location.replace(`/?next=${encodeURIComponent('/finance/')}`);
}

let dash = null;
const dashboard = async () => {
  if (!dash || Date.now() - dash.at > 4000) dash = { at: Date.now(), d: await api.get('/api/finance/dashboard') };
  return dash.d;
};
const q = async (k) => (isStaff() ? (await dashboard()).queue[k] : 0);

startApp({
  side: 'finance',
  authBase: '/api/finance/auth',
  product: 'Finance',
  routes,
  nav,
  home,
  signedOutView,
  passwordView: () => location.replace(`/?next=${encodeURIComponent('/finance/')}`),
  async onSignedIn() {
    await fin.refreshSettings();
  },
  badges: {
    journals: async () => (can('finance.accounts') ? q('draftJournals') : 0),
    ors: async () => (can('finance.budget') ? q('orsToObligate') : 0),
    prs: async () => (can('finance.approve') ? q('prToApprove') : 0),
    pos: async () => (can('finance.approve') ? q('poToApprove') : 0),
    ris: async () => (can('finance.inventory') ? q('risToIssue') : 0),
    dvs: async () => (can('finance.accounts') ? await q('dvToCertify') : 0) + (can('finance.approve') ? await q('dvToApprove') : 0) + (can('finance.disburse') ? await q('dvToPay') : 0),
    advances: async () => q('advancesOverdue'),
    rcds: async () => (can('finance.collect') ? q('undeposited') : 0),
  },
});

// Every page and dialog: names for unlabelled controls, keyboard access to scrolling tables.
let pending = 0;
new MutationObserver(() => {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => improveAccess(document));
}).observe(document.body, { childList: true, subtree: true });
