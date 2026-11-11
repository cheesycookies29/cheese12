// Tiny JSON-file database. All data lives in data/db.json next to the app.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { keepPrivate } from './util.js';
import { DEFAULT_SETTINGS, DEFAULT_RATES, premiumsOf } from '../shared/calc.js';
import { DEFAULT_LEAVE_TYPES } from '../shared/leave.js';
import { DEFAULT_LOCATION_SETTINGS } from '../shared/geo.js';
import { emptyHelpdesk } from './helpdesk.js';
import { emptyCrm } from './crm.js';
import { emptyPm } from './projects.js';
import { initialHolidays } from './holidays.js';

export function emptyData() {
  return {
    version: 1,
    settings: mergeSettings(),
    employees: [],
    timeEntries: [],
    payrollRuns: [],
    payrollLedger: [], // year-to-date rows per finalized payslip, plus opening balances (server/ledger.js)
    users: [],
    leaveTypes: structuredClone(DEFAULT_LEAVE_TYPES),
    leaveCredits: [], // per-employee, per-year overrides of a leave type's annual credits
    leaveAccess: [], // per-employee: leave types given or taken away by an administrator
    leaveAdjustments: [], // per-employee, per-year +/- days with a reason
    requests: [], // leave and remote-work requests
    holidays: initialHolidays(), // holiday calendar (server/holidays.js)
    assets: [], // IT assets tracked individually
    assetHistory: [], // assignment / status log per asset
    inventoryItems: [], // consumable stock
    stockMovements: [], // stock in / issued / count adjustments
    issueReports: [], // employees' problem reports on assigned equipment
    devlog: { author: null, entries: [], imported: [] }, // release notes, editable by admins (server/devlog.js)
    feedback: [], // feedback from any signed-in user, read by administrators
    tickets: [], // IT Service Desk tickets (server/helpdesk.js)
    helpdesk: emptyHelpdesk(), // service desk settings: mailbox, outgoing mail, categories, SLA, saved replies
    // Sales & CRM (server/crm.js): records, and the sales setup with code counters in `crm`.
    crmAccounts: [],
    crmContacts: [],
    crmLeads: [],
    crmDeals: [],
    crmBids: [],
    crmContracts: [],
    crmActivities: [],
    crm: emptyCrm(),
    // Project Management (server/projects.js): projects, milestones, tasks, comments and time
    // logs, and the Projects setup with the code counter in `pm`.
    pmProjects: [],
    pmMilestones: [],
    pmTasks: [],
    pmComments: [],
    pmTimeLogs: [],
    pm: emptyPm(),
  };
}

// An existing data folder is closed to other accounts too, unless it is plainly not CORE's own:
// a shared folder such as /tmp, someone else's folder, or the home folder.
function closeFolder(dir) {
  try {
    const st = fs.statSync(dir);
    const own = typeof process.getuid !== 'function' || st.uid === process.getuid();
    if (own && !(st.mode & 0o1000) && path.resolve(dir) !== path.resolve(os.homedir())) fs.chmodSync(dir, 0o700);
  } catch {}
}

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  closeFolder(path.dirname(file));
  if (fs.existsSync(file)) keepPrivate(file);
  let data = emptyData();
  if (fs.existsSync(file)) {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.settings = mergeSettings(data.settings);
    // Files from older builds: add collections introduced since.
    data.users ||= [];
    data.leaveTypes ||= structuredClone(DEFAULT_LEAVE_TYPES);
    data.leaveCredits ||= [];
    data.leaveAccess ||= [];
    data.leaveAdjustments ||= [];
    data.requests ||= [];
    data.assets ||= [];
    data.assetHistory ||= [];
    data.inventoryItems ||= [];
    data.stockMovements ||= [];
    data.issueReports ||= [];
    data.feedback ||= [];
    data.tickets ||= [];
    data.payrollLedger ||= [];
  }

  const db = {
    // Folder holding the data file; uploaded files are kept under it.
    dir: path.dirname(file),
    get data() {
      return data;
    },
    replace(next) {
      data = { ...emptyData(), ...next, settings: mergeSettings(next.settings) };
      db.save();
    },
    save() {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
      keepPrivate(tmp); // a temp file left by an older build keeps its old mode otherwise
      fs.renameSync(tmp, file);
    },
  };
  if (!fs.existsSync(file)) db.save();
  return db;
}

export function mergeSettings(settings = {}) {
  // Before 0.10 overtime and rest-day work had one multiplier each; they now live in `premiums`.
  const { overtimeMultiplier, restDayMultiplier, ...rest } = settings;
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...rest,
    premiums: premiumsOf(settings),
    nightDiff: { ...DEFAULT_SETTINGS.nightDiff, ...(settings.nightDiff || {}) },
    holidayPay: { ...DEFAULT_SETTINGS.holidayPay, ...(settings.holidayPay || {}) },
    schedule: { ...DEFAULT_SETTINGS.schedule, ...(settings.schedule || {}) },
    contributions: { ...DEFAULT_SETTINGS.contributions, ...(settings.contributions || {}) },
    location: { ...DEFAULT_LOCATION_SETTINGS, ...(settings.location || {}) },
    rates: {
      sss: { ...DEFAULT_RATES.sss, ...(settings.rates?.sss || {}) },
      philhealth: { ...DEFAULT_RATES.philhealth, ...(settings.rates?.philhealth || {}) },
      pagibig: { ...DEFAULT_RATES.pagibig, ...(settings.rates?.pagibig || {}) },
      tax: { ...structuredClone(DEFAULT_RATES.tax), ...(settings.rates?.tax || {}) },
    },
  };
}
