// Class meeting times. A section meets on one or more days, each { day: 0-6 (Sun-Sat), start: 'HH:MM', end: 'HH:MM' }.

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

// Two lists of meetings clash when any pair shares a day and overlaps in time
// (a class ending at 10:30 and one starting at 10:30 do not clash).
export function meetingsClash(a = [], b = []) {
  return a.some((x) => b.some((y) => x.day === y.day && toMinutes(x.start) < toMinutes(y.end) && toMinutes(y.start) < toMinutes(x.end)));
}

export function formatTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// "Mon/Wed 9:00 AM–10:30 AM", grouping days that share the same times.
export function formatMeetings(meetings = []) {
  if (!meetings.length) return 'To be arranged';
  const groups = new Map();
  for (const m of [...meetings].sort((a, b) => a.day - b.day)) {
    const key = `${m.start}-${m.end}`;
    if (!groups.has(key)) groups.set(key, { ...m, days: [] });
    groups.get(key).days.push(DAYS[m.day]);
  }
  return [...groups.values()].map((g) => `${g.days.join('/')} ${formatTime(g.start)}–${formatTime(g.end)}`).join(', ');
}
