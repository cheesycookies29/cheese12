// Tiny JSON-file database. All data lives in data/db.json next to the app.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS } from '../shared/calc.js';

export function emptyData() {
  return {
    version: 1,
    settings: structuredClone(DEFAULT_SETTINGS),
    employees: [],
    timeEntries: [],
    payrollRuns: [],
  };
}

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let data = emptyData();
  if (fs.existsSync(file)) {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.settings = mergeSettings(data.settings);
  }

  const db = {
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
  };
}
