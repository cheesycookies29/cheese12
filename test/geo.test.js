// Clock-in geotagging: recorded on clock-in, checked against the office, and visible
// only to HR Managers and Administrators.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { distanceMeters } from '../shared/geo.js';

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ltdc-geo-')), 'db.json');
const db = openDb(file);
const handle = createApi(db);
function client() {
  let cookie = '';
  return async (method, url, body = {}) => {
    const res = await handle({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
    if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
    return res.data;
  };
}
const admin = client();
await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
async function account(username, role, employeeId) {
  await admin('POST', '/api/users', { name: username, username, role, employeeId, password: 'secret123', mustChangePassword: false });
  const c = client();
  await c('POST', '/api/auth/login', { username, password: 'secret123' });
  return c;
}
const person = (no, firstName) => admin('POST', '/api/employees', { employeeNo: no, firstName, lastName: 'Santos', hireDate: '2024-01-01', payType: 'monthly', rate: 30000 });
const [ana, ben, cara, dino] = [await person('E-1', 'Ana'), await person('E-2', 'Ben'), await person('E-3', 'Cara'), await person('E-4', 'Dino')];
const asAna = await account('ana', 'employee', ana.id);
const asBen = await account('ben', 'employee', ben.id);
const asCara = await account('cara', 'employee', cara.id);
const hr = await account('hrboss', 'hr');
const payroll = await account('payboss', 'payroll');
// An office in Makati; a point about 60 m away and one in Quezon City (~10 km).
const OFFICE = { lat: 14.554729, lng: 121.024445 };
const NEAR = { lat: 14.555, lng: 121.0249, accuracy: 20 };
const FAR = { lat: 14.6507, lng: 121.0495, accuracy: 15 };

test('clocking in records the location and the distance from the office', async () => {
  await assert.rejects(asAna('PUT', '/api/location-settings', { officeLat: OFFICE.lat, officeLng: OFFICE.lng, radius: 150, retentionDays: 365 }), /does not have access/);
  await assert.rejects(hr('PUT', '/api/location-settings', { officeLat: OFFICE.lat, officeLng: '', radius: 150, retentionDays: 365 }), /both latitude and longitude/);
  await assert.rejects(hr('PUT', '/api/location-settings', { officeLat: OFFICE.lat, officeLng: OFFICE.lng, radius: 5, retentionDays: 365 }), /radius/);
  const saved = await hr('PUT', '/api/location-settings', { officeLabel: 'Makati office', officeLat: OFFICE.lat, officeLng: OFFICE.lng, radius: 150, retentionDays: 365 });
  assert.equal(saved.officeLabel, 'Makati office');

  const res = await asAna('POST', '/api/me/clock', { action: 'in', location: NEAR });
  assert.ok(!('clockInLocation' in res.entry), 'the employee does not get it back');
  await asBen('POST', '/api/me/clock', { action: 'in', location: FAR });
  await asCara('POST', '/api/me/clock', { action: 'in', locationError: 'denied' });
  await hr('POST', '/api/clock', { employeeId: dino.id, action: 'in', location: { lat: 'x', lng: 1 } });

  const stored = (emp) => db.data.timeEntries.find((e) => e.employeeId === emp.id).clockInLocation;
  assert.equal(stored(ana).status, 'ok');
  assert.equal(stored(ana).source, 'self');
  assert.equal(stored(ana).inside, true);
  assert.ok(Math.abs(stored(ana).distance - distanceMeters(NEAR, OFFICE)) <= 1);
  assert.equal(stored(ben).inside, false);
  assert.ok(stored(ben).distance > 9000 && stored(ben).distance < 12000, `about 10 km, got ${stored(ben).distance}`);
  assert.deepEqual([stored(cara).status, stored(cara).lat], ['denied', undefined]);
  assert.deepEqual([stored(dino).status, stored(dino).source], ['unavailable', 'kiosk']);

  // Clocking out does not record a location.
  await asAna('POST', '/api/me/clock', { action: 'out', location: FAR }).catch(() => {});
  assert.equal(stored(ana).lat, Math.round(NEAR.lat * 1e6) / 1e6);
});

test('only HR Managers and Administrators can see clock-in locations', async () => {
  for (const [who, c] of [['employee', asAna], ['payroll officer', payroll]]) {
    const entries = await c('GET', c === asAna ? '/api/me/time-entries' : '/api/time-entries');
    assert.ok(entries.length && entries.every((e) => !('clockInLocation' in e)), `${who} gets entries without locations`);
    await assert.rejects(c('GET', '/api/clock-locations'), /does not have access/);
    await assert.rejects(c('PUT', '/api/location-settings', {}), /does not have access/);
  }
  for (const c of [hr, admin]) {
    const entries = await c('GET', '/api/time-entries');
    assert.equal(entries.find((e) => e.employeeId === ana.id).clockInLocation.status, 'ok');
    const list = await c('GET', '/api/clock-locations');
    assert.equal(list.length, 4);
    assert.deepEqual(list.find((r) => r.employeeId === ben.id).name, 'Santos, Ben');
  }
});

test('editing a record keeps its clock-in location', async () => {
  const entry = (await hr('GET', '/api/time-entries')).find((e) => e.employeeId === ben.id);
  const saved = await hr('PUT', `/api/time-entries/${entry.id}`, { ...entry, timeIn: '08:00', clockInLocation: { status: 'ok', lat: 0, lng: 0 } });
  assert.equal(saved.timeIn, '08:00');
  assert.equal(saved.clockInLocation.lat, entry.clockInLocation.lat, 'the stored location cannot be overwritten through an edit');
});

test('locations older than the retention period are removed', async () => {
  const old = db.data.timeEntries.find((e) => e.employeeId === cara.id);
  old.date = '2020-01-06';
  db.save();
  const reopened = openDb(file);
  createApi(reopened);
  const after = reopened.data.timeEntries.find((e) => e.id === old.id);
  assert.ok(after && !('clockInLocation' in after), 'the record stays, the location goes');
  assert.ok(reopened.data.timeEntries.find((e) => e.employeeId === ana.id).clockInLocation);
});

test('existing data moves to 312 work days per year once; later changes are kept', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ltdc-wdpy-')), 'db.json');
  const old = openDb(f);
  old.data.settings.workDaysPerYear = 261;
  delete old.data.settings.appliedUpdates;
  old.save();
  const a = openDb(f);
  createApi(a);
  assert.equal(a.data.settings.workDaysPerYear, 312);
  a.data.settings.workDaysPerYear = 300; // changed later in Payroll Setup
  a.save();
  const b = openDb(f);
  createApi(b);
  assert.equal(b.data.settings.workDaysPerYear, 300);
});

test('the flexible-time flag is saved on the employee record', async () => {
  const e = await admin('GET', `/api/employees/${ana.id}`);
  const saved = await admin('PUT', `/api/employees/${ana.id}`, { ...e, flexTime: true });
  assert.equal(saved.flexTime, true);
  assert.equal((await admin('PUT', `/api/employees/${ana.id}`, { ...e, flexTime: false })).flexTime, false);
});
