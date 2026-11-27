// CUSTOM APP → events: an event's times are stored as UTC instants (ISO 8601 with Z) and shown in
// the event's time zone, Asia/Manila (UTC+8, no daylight saving). Staff type local times
// ("2026-12-09T18:00"), which mean Manila time; a time with its own offset or Z is taken as it is.
export const EVENT_TZ = 'Asia/Manila';
const MANILA_OFFSET = '+08:00';

// A typed time as a UTC instant ("2026-12-09T10:00:00.000Z"), or null when empty. Throws on nonsense.
export function toUtc(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s);
  const d = new Date(local ? `${s}${s.length === 16 ? ':00' : ''}${MANILA_OFFSET}` : s);
  if (Number.isNaN(d.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(s)) throw new Error('Write the time as YYYY-MM-DDTHH:MM (Manila time).');
  return d.toISOString();
}

// For a datetime-local box: "2026-12-09T18:00" in Manila time.
export function toManilaInput(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 8 * 3600000);
  return d.toISOString().slice(0, 16);
}

// For people: "9 Dec 2026, 6:00 PM".
export function fmtManila(iso, { date = true } = {}) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-PH', { timeZone: EVENT_TZ, ...(date ? { day: 'numeric', month: 'short', year: 'numeric' } : {}), hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
}
