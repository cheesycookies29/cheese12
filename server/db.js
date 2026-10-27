// Tiny JSON-file database. All data lives in data/db.json next to the app.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, DEFAULT_RATES } from '../shared/calc.js';
import { DEFAULT_LEAVE_TYPES } from '../shared/leave.js';
import { DEFAULT_LOCATION_SETTINGS } from '../shared/geo.js';
import { emptyHelpdesk } from './helpdesk.js';

export function emptyData() {
  return {
    version: 1,
    settings: structuredClone(DEFAULT_SETTINGS),
    employees: [],
    timeEntries: [],
    payrollRuns: [],
    users: [],
    leaveTypes: structuredClone(DEFAULT_LEAVE_TYPES),
    leaveCredits: [], // per-employee, per-year overrides of a leave type's annual credits
    leaveAccess: [], // per-employee: leave types given or taken away by an administrator
    leaveAdjustments: [], // per-employee, per-year +/- days with a reason
    requests: [], // leave and remote-work requests
    assets: [], // IT assets tracked individually
    assetHistory: [], // assignment / status log per asset
    inventoryItems: [], // consumable stock
    stockMovements: [], // stock in / issued / count adjustments
    issueReports: [], // employees' problem reports on assigned equipment
    devlog: { author: null, entries: [], imported: [] }, // release notes, editable by admins (server/devlog.js)
    feedback: [], // feedback from any signed-in user, read by administrators
    tickets: [], // IT Service Desk tickets (server/helpdesk.js)
    helpdesk: emptyHelpdesk(), // service desk settings: mailbox, outgoing mail, categories, SLA, saved replies
  };
}

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
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
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
    },
  };
  if (!fs.existsSync(file)) db.save();
  return db;
}

export function mergeSettings(settings = {}) {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...settings,
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
