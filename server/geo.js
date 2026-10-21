// Clock-in geotagging. The browser sends its location with a clock-in; the server
// stores it on the time entry with the distance from the office. Only accounts with
// 'attendance.location' (HR Managers and Administrators) ever receive it back.
import { HttpError } from './util.js';
import { can } from '../shared/roles.js';
import { LOCATION_STATUS, CLOCK_SOURCES, DEFAULT_LOCATION_SETTINGS, distanceMeters, hasOffice } from '../shared/geo.js';

const num = (v) => (v === '' || v == null ? null : Number(v));

// { location: { lat, lng, accuracy } } or { locationError } from the browser -> what is kept on the entry.
export function clockInLocation(settings, body, source) {
  const at = new Date().toISOString();
  const loc = body?.location;
  const lat = Number(loc?.lat);
  const lng = Number(loc?.lng);
  if (!loc || !(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) {
    const status = LOCATION_STATUS[body?.locationError] && body.locationError !== 'ok' ? body.locationError : 'unavailable';
    return { status, source, at };
  }
  const accuracy = Math.max(0, Math.round(Number(loc.accuracy) || 0)) || null;
  const office = settings.location;
  const distance = hasOffice(office) ? Math.round(distanceMeters({ lat, lng }, { lat: office.officeLat, lng: office.officeLng })) : null;
  return {
    status: 'ok', source, at,
    lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, accuracy,
    // Inside if within the radius, allowing for the reported accuracy (capped so a vague fix can't pass everywhere).
    distance, inside: distance == null ? null : distance - Math.min(accuracy || 0, office.radius) <= office.radius,
  };
}

export const canSeeLocation = (user) => Boolean(user) && can(user.role, 'attendance.location');
// A time entry as this user may see it.
export const forViewer = (user, entry) => {
  if (!entry || canSeeLocation(user) || !('clockInLocation' in entry)) return entry;
  const { clockInLocation: _hidden, ...rest } = entry;
  return rest;
};

// Removes locations older than the retention period. Returns true if any were removed.
export function purgeOldLocations(db) {
  const days = db.data.settings.location?.retentionDays || DEFAULT_LOCATION_SETTINGS.retentionDays;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  let changed = false;
  for (const e of db.data.timeEntries) {
    if (e.clockInLocation && e.date < cutoff) {
      delete e.clockInLocation;
      changed = true;
    }
  }
  return changed;
}

export function registerGeoRoutes(route, db) {
  // Clock-ins with their location, newest first.
  route('GET', '/api/clock-locations', 'attendance.location', ({ query }) => {
    const { employeeId, from, to } = query;
    const people = new Map(db.data.employees.map((e) => [e.id, e]));
    return db.data.timeEntries
      .filter((e) => e.clockInLocation && people.has(e.employeeId) && (!employeeId || e.employeeId === employeeId) && (!from || e.date >= from) && (!to || e.date <= to))
      .map((e) => {
        const emp = people.get(e.employeeId);
        return {
          entryId: e.id, date: e.date, timeIn: e.timeIn, timeOut: e.timeOut, remote: Boolean(e.remote),
          employeeId: emp.id, employeeNo: emp.employeeNo, name: `${emp.lastName}, ${emp.firstName}`, department: emp.department || '',
          sourceLabel: CLOCK_SOURCES[e.clockInLocation.source] || '', ...e.clockInLocation,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date) || (b.timeIn || '').localeCompare(a.timeIn || ''));
  });

  route('PUT', '/api/location-settings', 'attendance.location', ({ body }) => {
    const next = {
      officeLabel: String(body.officeLabel ?? '').trim().slice(0, 60) || 'Office',
      officeLat: num(body.officeLat),
      officeLng: num(body.officeLng),
      radius: Math.round(Number(body.radius)),
      retentionDays: Math.round(Number(body.retentionDays)),
    };
    if ((next.officeLat == null) !== (next.officeLng == null)) throw new HttpError(400, 'Enter both latitude and longitude, or clear both to turn the office check off.');
    if (next.officeLat != null && !(Math.abs(next.officeLat) <= 90 && Math.abs(next.officeLng) <= 180)) throw new HttpError(400, 'Latitude must be between -90 and 90, and longitude between -180 and 180.');
    if (!(next.radius >= 20 && next.radius <= 5000)) throw new HttpError(400, 'The office radius must be between 20 and 5,000 metres.');
    if (!(next.retentionDays >= 30 && next.retentionDays <= 3650)) throw new HttpError(400, 'Keep locations for between 30 and 3,650 days.');
    db.data.settings.location = next;
    purgeOldLocations(db);
    db.save();
    return next;
  });
}
