// Holiday calendar: national holidays as proclaimed (loaded per year from shared/holidays.js) and
// the ones HR adds (Eid'l Fitr and Eid'l Adha, local holidays, declared special days). Payroll
// reads it for holiday pay; leave and work-from-home requests skip days off.
import { randomUUID } from 'node:crypto';
import { HttpError } from './util.js';
import { HOLIDAY_TYPES, presetHolidays, presetYears, PH_HOLIDAYS } from '../shared/holidays.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const now = () => new Date().toISOString();

// Fresh databases (and backups from before 0.10) start with every proclaimed year CORE knows.
export function initialHolidays() {
  return presetYears().flatMap((y) => presetHolidays(y).map((h) => ({ id: randomUUID(), ...h, createdAt: now() })));
}

export function migrateHolidays(db) {
  if (Array.isArray(db.data.holidays)) return false;
  db.data.holidays = initialHolidays();
  return true;
}

function validateHoliday(body, db, existingId) {
  const h = {
    date: String(body.date || ''),
    name: String(body.name || '').trim().slice(0, 120),
    type: HOLIDAY_TYPES[body.type] ? body.type : null,
    scope: body.scope === 'local' ? 'local' : 'national',
    place: String(body.place || '').trim().slice(0, 80),
    basis: String(body.basis || '').trim().slice(0, 160),
  };
  if (!DATE_RE.test(h.date)) throw new HttpError(400, 'Pick the date.');
  if (!h.name) throw new HttpError(400, 'Give the holiday a name.');
  if (!h.type) throw new HttpError(400, 'Pick whether it is a regular holiday, a special non-working day or a special working day.');
  if (h.scope === 'national') h.place = '';
  else if (!h.place) throw new HttpError(400, 'Say where the local holiday applies, for example Taguig City.');
  const same = db.data.holidays.find((x) => x.id !== existingId && x.date === h.date && x.name.toLowerCase() === h.name.toLowerCase());
  if (same) throw new HttpError(400, `${h.name} is already on ${h.date}.`);
  return h;
}

export function registerHolidayRoutes(route, db, { audit }) {
  const label = (h) => `${h.name}, ${h.date}`;
  const list = (year) => db.data.holidays.filter((h) => !year || h.date.startsWith(String(year))).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  // Every signed-in user sees the calendar: the DTR, requests and payslips use it.
  route('GET', '/api/holidays', 'auth', ({ query }) => list(query.year));
  route('GET', '/api/holidays/presets', 'holidays.manage', () =>
    presetYears().map((year) => ({ year, basis: PH_HOLIDAYS[year].basis, count: PH_HOLIDAYS[year].days.length, loaded: presetHolidays(year).filter((p) => db.data.holidays.some((h) => h.date === p.date && h.name === p.name)).length })),
  );
  route('POST', '/api/holidays', 'holidays.manage', ({ body, user }) => {
    const h = { id: randomUUID(), ...validateHoliday(body, db), createdAt: now(), createdBy: user.name };
    db.data.holidays.push(h);
    db.save();
    audit.record('holiday.create', { entity: 'holiday', entityId: h.id, label: label(h), note: h.type });
    return h;
  });
  // Adds the proclaimed national holidays of a year that are not on the calendar yet.
  route('POST', '/api/holidays/load', 'holidays.manage', ({ body, user }) => {
    const year = Number(body.year);
    if (!PH_HOLIDAYS[year]) throw new HttpError(400, `CORE has no proclaimed list for ${body.year || 'that year'} yet. Add the holidays one by one.`);
    const missing = presetHolidays(year).filter((p) => !db.data.holidays.some((h) => h.date === p.date && h.name === p.name));
    db.data.holidays.push(...missing.map((h) => ({ id: randomUUID(), ...h, createdAt: now(), createdBy: user.name })));
    db.save();
    audit.record('holiday.load', { entity: 'holiday', label: `${year} national holidays`, note: `${missing.length} added (${PH_HOLIDAYS[year].basis})` });
    return { added: missing.length, holidays: list(year) };
  });
  route('PUT', '/api/holidays/:id', 'holidays.manage', ({ params, body, user }) => {
    const h = db.data.holidays.find((x) => x.id === params.id);
    if (!h) throw new HttpError(404, 'Holiday not found.');
    const before = { ...h };
    Object.assign(h, validateHoliday(body, db, h.id), { updatedAt: now(), updatedBy: user.name });
    db.save();
    audit.record('holiday.update', { entity: 'holiday', entityId: h.id, label: label(h), changes: Object.entries(h).filter(([k, v]) => ['date', 'name', 'type', 'scope', 'place', 'basis'].includes(k) && before[k] !== v).map(([k, v]) => ({ field: k, from: before[k] ?? '', to: v })) });
    return h;
  });
  route('DELETE', '/api/holidays/:id', 'holidays.manage', ({ params }) => {
    const h = db.data.holidays.find((x) => x.id === params.id);
    if (!h) throw new HttpError(404, 'Holiday not found.');
    db.data.holidays = db.data.holidays.filter((x) => x.id !== params.id);
    db.save();
    audit.record('holiday.delete', { entity: 'holiday', entityId: h.id, label: label(h) });
    return { ok: true };
  });
}
