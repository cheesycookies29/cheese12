// The systems of Lancaster ATLAS, shown as tiles on the ATLAS home page (/).
// ATLAS Learn (the LMS) and ATLAS People (the HRIS) are built in; the others are switched
// live by an administrator (Admin panel → Home page & systems) once they exist, with the
// address they run at. Ids stay as they were (hris, lms…) so saved settings keep working.
// audience: account types that see the tile (students do not see HRIS, for example).

import { productName } from './brand.js';

export const SYSTEMS = [
  {
    id: 'uis',
    product: 'Academic',
    short: 'UIS',
    title: 'Academic records',
    description: 'Admissions, student records, registration, grades and registrar services.',
    icon: 'cap',
    audience: ['student', 'teacher', 'registrar', 'dean', 'admin'],
    builtIn: true,
    path: '/academic/',
  },
  {
    id: 'lms',
    product: 'Learn',
    short: 'LMS',
    title: 'Learning management',
    description: 'Classes, lessons and resources, quizzes and exams, attendance, grades and enrollment.',
    icon: 'laptop',
    audience: ['student', 'guardian', 'teacher', 'registrar', 'admin'],
    builtIn: true,
    path: '/lms/', // administrators and registrars open its admin panel (/admin) instead
  },
  {
    id: 'hris',
    product: 'People',
    short: 'HRIS',
    title: 'Human resources',
    description: 'Employee records, time clock and attendance, leave requests and credits, payroll and payslips.',
    icon: 'users',
    audience: ['teacher', 'registrar', 'dean', 'admin', 'hr', 'payroll', 'staff', 'accountant', 'budget', 'cashier', 'supply', 'approver'],
    builtIn: true,
    path: '/hris/',
  },
  {
    id: 'fmis',
    product: 'Finance',
    short: 'FMIS',
    title: 'Financial management',
    description: 'Government accounting: budget, procurement, inventory and property, disbursements, collections and financial reports.',
    icon: 'coins',
    audience: ['student', 'teacher', 'registrar', 'dean', 'admin', 'hr', 'payroll', 'staff', 'accountant', 'budget', 'cashier', 'supply', 'approver'],
    builtIn: true,
    path: '/finance/',
  },
  {
    id: 'dms',
    product: 'Documents',
    short: 'DMS',
    title: 'Document management',
    description: 'Your files and the school’s documents: folders, versions, sharing with colleagues and classmates, and safe links for people outside.',
    icon: 'folder',
    audience: ['student', 'teacher', 'registrar', 'dean', 'admin', 'hr', 'payroll', 'staff', 'accountant', 'budget', 'cashier', 'supply', 'approver'],
    builtIn: true,
    path: '/documents/',
  },
  {
    id: 'facilities',
    product: 'Facilities',
    short: '',
    title: 'Facilities and property',
    description: 'Rooms and venues, bookings, maintenance requests, and the school’s property and equipment.',
    icon: 'building',
    audience: ['teacher', 'registrar', 'admin', 'hr', 'payroll', 'staff', 'accountant', 'budget', 'cashier', 'supply', 'approver'],
  },
  {
    // REX Bookstore's e-reader: the e-books from the REX Bookstore app's library, for classes.
    // Coming soon; when the connection to the REX Bookstore app is ready, an administrator switches
    // it live with its address (Admin panel → Home page & systems).
    id: 'rex',
    product: 'REX Bookstore e-Reader',
    name: 'REX Bookstore e-Reader',
    short: 'e-Reader',
    title: 'E-books for your classes',
    description: 'Read the REX Bookstore e-books for your subjects on any device: textbooks and workbooks from the REX Bookstore app\'s library.',
    icon: 'book',
    audience: ['student', 'teacher', 'registrar', 'dean', 'admin'],
  },
].map((s) => ({ ...s, name: s.name || `ATLAS ${s.product}` }));

// A system's name under the school's brand: "ATLAS Learn", or "<short name> Learn" when the school
// leads (Settings → Branding → Brand; shared/brand.js). A system with a name of its own keeps it.
export const systemName = (s, branding) => (s.name === `ATLAS ${s.product}` ? productName(branding, s.product) : s.name);

export const SYSTEM_STATUS = ['soon', 'live', 'hidden'];

export function defaultSystemSettings() {
  return Object.fromEntries(SYSTEMS.filter((s) => !s.builtIn).map((s) => [s.id, { status: 'soon', url: '' }]));
}

// The order systems are shown in, on the ATLAS home and in the Systems menu (after CORE's home):
// the ones pinned with the star first, in the order pinned, then the others that can be opened,
// then the ones coming soon. systems: as /api/hub/status gives them ({ id, status, url }).
export const canOpen = (s) => s.status === 'live' && Boolean(s.url);
export function orderSystems(systems, favorites = []) {
  const open = systems.filter(canOpen);
  const first = (favorites || []).map((id) => open.find((s) => s.id === id)).filter(Boolean);
  return [...first, ...open.filter((s) => !first.includes(s)), ...systems.filter((s) => !canOpen(s))];
}

// ATLAS Tools (after CORE's Tools area): utilities anyone may be given, beside the systems. Each is
// switched on per account type by an administrator (Admin panel → Home page & systems → Tools);
// administrators always have them. defaultRoles: who has it until an administrator changes it.
const STAFF = ['registrar', 'dean', 'teacher', 'hr', 'payroll', 'accountant', 'budget', 'cashier', 'supply', 'approver', 'staff'];
export const TOOLS = [
  {
    id: 'pdf',
    code: 'TOOL-01',
    product: 'PDF Studio',
    short: 'PDF',
    title: 'Make, join and sign PDFs',
    description: 'Turn documents, spreadsheets, slides and pictures into PDF; put PDFs together, reorder, turn and number pages; change text and sign.',
    icon: 'filePdf',
    path: '/tools/#/pdf',
    accent: 'red',
    features: ['Word, Excel, PowerPoint', 'Pictures', 'Merge and arrange', 'Page numbers', 'Sign'],
    defaultRoles: STAFF,
  },
];
export const TOOL_ROLES = [...STAFF, 'student', 'guardian'];
export const defaultToolSettings = () => Object.fromEntries(TOOLS.map((x) => [x.id, { roles: [...x.defaultRoles] }]));
// Whether an account type may use a tool (settings: the school's settings).
export const toolOpenFor = (settings, id, role) => role === 'admin' || Boolean(settings?.tools?.[id]?.roles?.includes(role));
