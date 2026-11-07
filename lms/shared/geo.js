// Clock-in geotagging (from the Lancaster ERP): the location a browser reports when someone clocks in,
// checked against the campus's office location. Shared by the server and the browser.

// Per campus: where the campus is and how far from it still counts as on campus (metres).
// No coordinates = locations are recorded but not checked.
export const DEFAULT_LOCATION_SETTINGS = { officeLabel: 'Campus', officeLat: null, officeLng: null, radius: 300, retentionDays: 365 };

// Why a clock-in has no coordinates (or 'ok' when it has them).
export const LOCATION_STATUS = {
  ok: 'Location recorded',
  denied: 'Location permission denied',
  unavailable: 'Location unavailable',
  timeout: 'Location timed out',
  unsupported: 'Browser does not support location',
  insecure: 'Location needs a secure (https) address',
};

export const CLOCK_SOURCES = { self: 'My day (own device)', kiosk: 'Time clock' };

// Great-circle distance in metres.
export function distanceMeters(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const hasOffice = (s) => Number.isFinite(s?.officeLat) && Number.isFinite(s?.officeLng);
export const fmtDistance = (m) => (m == null ? '' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);
