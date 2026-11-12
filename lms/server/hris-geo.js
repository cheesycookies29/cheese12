// Clock-in geotagging, from the Lancaster ERP (server/geo.js there). The browser sends its
// location with a clock-in; the server keeps it on the time entry with the distance from
// the campus. Only accounts with 'attendance.location' (HR managers and administrators)
// ever receive it back. Each campus has its own location, radius and retention period.
import { HttpError } from './util.js';
import { userCan } from '../shared/roles.js';
import { LOCATION_STATUS, CLOCK_SOURCES, DEFAULT_LOCATION_SETTINGS, distanceMeters, hasOffice } from '../shared/geo.js';

const num = (v) => (v === '' || v == null ? null : Number(v));

// The location settings of a campus (defaults where none are saved).
export function locationSettings(data, campusId) {
  return { ...DEFAULT_LOCATION_SETTINGS, ...(data.hrSettings?.locations?.[campusId] || {}) };
}

// { location: { lat, lng, accuracy } } or { locationError } from the browser -> what is kept on the entry.
export function clockInLocation(office, body, source, at = new Date()) {
  const loc = body?.location;
  const lat = Number(loc?.lat);
  const lng = Number(loc?.lng);
  const stamp = at.toISOString();
  if (!loc || !(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180) || loc.lat == null || loc.lng == null) {
    const status = LOCATION_STATUS[body?.locationError] && body.locationError !== 'ok' ? body.locationError : 'unavailable';
    return { status, source, at: stamp };
  }
  const accuracy = Math.max(0, Math.round(Number(loc.accuracy) || 0)) || null;
  const distance = hasOffice(office) ? Math.round(distanceMeters({ lat, lng }, { lat: office.officeLat, lng: office.officeLng })) : null;
  return {
    status: 'ok', source, at: stamp,
    lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, accuracy,
    // Inside if within the radius, allowing for the reported accuracy (capped so a vague fix can't pass everywhere).
    distance, inside: distance == null ? null : distance - Math.min(accuracy || 0, office.radius) <= office.radius,
  };
}

export const canSeeLocation = (user) => Boolean(user) && userCan(user, 'attendance.location');
// A time entry as this user may see it.
export const forViewer = (user, entry) => {
  if (!entry || canSeeLocation(user) || !('clockInLocation' in entry)) return entry;
  const { clockInLocation: _hidden, ...rest } = entry;
  return rest;
};

// Removes locations older than each campus's retention period. Returns true if any were removed.
export function purgeOldLocations(data, now = new Date()) {
  const campusOf = new Map(data.employees.map((e) => [e.id, e.campusId]));
  let changed = false;
  for (const e of data.timeEntries || []) {
    if (!e.clockInLocation) continue;
    const days = locationSettings(data, campusOf.get(e.employeeId)).retentionDays;
    const cutoff = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
    if (e.date < cutoff) {
      delete e.clockInLocation;
      changed = true;
    }
  }
  return changed;
}

export function registerGeoRoutes(route, { data, save, campusEmployees, now }) {
  // Clock-ins at this campus with their location, newest first.
  route('GET', '/api/hris/clock-locations', 'hris:attendance.location', ({ query, campusId }) => {
    const { employeeId, from, to } = query;
    const people = new Map(campusEmployees(campusId).map((e) => [e.id, e]));
    return data().timeEntries
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

  // The campus's location, radius and retention period.
  route('PUT', '/api/hris/location-settings', 'hris:attendance.location', ({ body, campusId, user }) => {
    const next = {
      officeLabel: String(body.officeLabel ?? '').trim().slice(0, 60) || 'Campus',
      officeLat: num(body.officeLat),
      officeLng: num(body.officeLng),
      radius: Math.round(Number(body.radius)),
      retentionDays: Math.round(Number(body.retentionDays)),
    };
    if ((next.officeLat == null) !== (next.officeLng == null)) throw new HttpError(400, 'Enter both latitude and longitude, or clear both to turn the campus check off.');
    if (next.officeLat != null && !(Math.abs(next.officeLat) <= 90 && Math.abs(next.officeLng) <= 180)) throw new HttpError(400, 'Latitude must be between -90 and 90, and longitude between -180 and 180.');
    if (!(next.radius >= 20 && next.radius <= 5000)) throw new HttpError(400, 'The radius must be between 20 and 5,000 metres.');
    if (!(next.retentionDays >= 30 && next.retentionDays <= 3650)) throw new HttpError(400, 'Keep locations for between 30 and 3,650 days.');
    const s = data().hrSettings;
    s.locations = { ...(s.locations || {}), [campusId]: { ...next, updatedAt: new Date().toISOString(), updatedBy: user.name } };
    purgeOldLocations(data(), now());
    save();
    return locationSettings(data(), campusId);
  });
}
