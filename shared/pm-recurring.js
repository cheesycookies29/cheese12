// Recurring tasks (0.61): when a project's repeating task is made. Shared by the server (which makes
// the tasks) and the browser (which shows the next dates while the form is filled in).
//
// A schedule: { freq, every, days, monthDay, workingDays, start, until }
//   freq 'daily'   every N days from the start date. With workingDays, weekends and holidays are
//                  skipped (every working day, when N is 1).
//   freq 'weekly'  every N weeks (counted from the week of the start date) on the weekdays in
//                  `days` (0 Sunday … 6 Saturday).
//   freq 'monthly' every N months (counted from the month of the start date) on day `monthDay`
//                  (1–31; a shorter month uses its last day), or on 'first-work' / 'last-work':
//                  the first or last working day of the month.
//   For weekly and monthly, workingDays moves a date that falls on a weekend or holiday to the
//   next working day.
//   start: the first possible date; until: the last (or null: no end).
// `cal` is a working calendar from workCalendar() in shared/projects.js.
import { addDays, weekday, weekStart, daysBetween, isWorkDay } from './projects.js';

export const FREQS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MAX_EVERY = { daily: 30, weekly: 12, monthly: 12 };
export const MAX_DUE_IN = 60; // working days from the day a task is made to its due date
export const MAX_RECURRING = 30; // per project
const SCAN = 800; // days looked ahead for the next date (an every-12-months schedule fits)
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isYmd = (v) => typeof v === 'string' && YMD.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

const monthIndex = (ymd) => Number(ymd.slice(0, 4)) * 12 + Number(ymd.slice(5, 7)) - 1;
const lastDayOf = (ymd) => new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), 0)).getUTCDate();
const dayOf = (ymd) => Number(ymd.slice(8, 10));
const ordinal = (n) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

// The schedule as sent by a form, checked: { schedule } or { error }.
export function cleanSchedule(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Choose how often the task repeats.' };
  const freq = raw.freq;
  if (!Object.hasOwn(FREQS, freq)) return { error: 'Repeats: pick daily, weekly or monthly.' };
  const every = Number(raw.every ?? 1);
  if (!Number.isInteger(every) || every < 1 || every > MAX_EVERY[freq]) return { error: `Repeat every 1 to ${MAX_EVERY[freq]} ${freq === 'daily' ? 'days' : freq === 'weekly' ? 'weeks' : 'months'}.` };
  if (!isYmd(raw.start)) return { error: 'Enter the date it starts.' };
  const until = raw.until == null || raw.until === '' ? null : raw.until;
  if (until !== null && !isYmd(until)) return { error: 'Enter a valid end date, or leave it empty.' };
  if (until && until < raw.start) return { error: 'The end date is before the start date.' };
  const out = { freq, every, days: [], monthDay: null, workingDays: raw.workingDays !== false, start: raw.start, until };
  if (freq === 'weekly') {
    const days = Array.isArray(raw.days) ? [...new Set(raw.days.map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).sort() : [];
    if (!days.length) return { error: 'Tick at least one day of the week.' };
    out.days = days;
  }
  if (freq === 'monthly') {
    const md = raw.monthDay;
    if (md === 'first-work' || md === 'last-work') out.monthDay = md;
    else {
      const n = Number(md);
      if (!Number.isInteger(n) || n < 1 || n > 31) return { error: 'Pick the day of the month (1 to 31), or its first or last working day.' };
      out.monthDay = n;
    }
  }
  return { schedule: out };
}

// Is `ymd` one of the schedule's dates, before any move to a working day?
function isNatural(s, ymd, cal) {
  if (ymd < s.start || (s.until && ymd > s.until)) return false;
  if (s.freq === 'daily') return daysBetween(s.start, ymd) % s.every === 0 && (!s.workingDays || isWorkDay(ymd, cal));
  if (s.freq === 'weekly') {
    const weeks = daysBetween(weekStart(s.start), weekStart(ymd)) / 7;
    return weeks % s.every === 0 && s.days.includes(weekday(ymd));
  }
  if ((monthIndex(ymd) - monthIndex(s.start)) % s.every !== 0) return false;
  if (s.monthDay === 'first-work' || s.monthDay === 'last-work') {
    if (!isWorkDay(ymd, cal)) return false;
    const first = s.monthDay === 'first-work';
    // No working day between it and the start (or end) of the month.
    for (let d = first ? ymd.slice(0, 8) + '01' : addDays(ymd, 1); first ? d < ymd : d.slice(0, 7) === ymd.slice(0, 7); d = addDays(d, 1)) if (isWorkDay(d, cal)) return false;
    return true;
  }
  return dayOf(ymd) === Math.min(s.monthDay, lastDayOf(ymd));
}
// The day a date of the schedule is made on: weekly and monthly dates on a weekend or holiday move
// to the next working day (when workingDays is on).
function moved(s, ymd, cal) {
  if (!s.workingDays || s.freq === 'daily') return ymd;
  let d = ymd;
  for (let i = 0; i < 60 && !isWorkDay(d, cal); i++) d = addDays(d, 1);
  return d;
}

// The first day after `after` that a task is made on, or null when the schedule has ended.
export function nextOccurrence(s, after, cal) {
  const from = addDays(after, -30) < s.start ? s.start : addDays(after, -30); // a date moved forward may land after `after`
  for (let d = from, i = 0; i < SCAN + 30; d = addDays(d, 1), i++) {
    if (s.until && d > s.until) return null;
    if (!isNatural(s, d, cal)) continue;
    const m = moved(s, d, cal);
    if (m > after) return m;
  }
  return null;
}
// The next `n` days a task is made on, from `from` (included).
export function upcoming(s, from, n, cal) {
  const out = [];
  let after = addDays(from, -1);
  while (out.length < n) {
    const d = nextOccurrence(s, after, cal);
    if (!d) break;
    out.push(d);
    after = d;
  }
  return out;
}

const list = (words) => (words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);
// In words: "Every working day", "Every 2 weeks on Monday and Thursday", "Every month on the 15th".
export function describeSchedule(s) {
  const n = s.every;
  let text;
  if (s.freq === 'daily') text = n === 1 ? (s.workingDays ? 'Every working day' : 'Every day') : `Every ${n} days${s.workingDays ? ' (working days only)' : ''}`;
  else if (s.freq === 'weekly') {
    const weekdays = s.days.length === 5 && [1, 2, 3, 4, 5].every((d) => s.days.includes(d));
    text = weekdays && n === 1 ? 'Every weekday (Monday to Friday)' : `${n === 1 ? 'Every week' : `Every ${n} weeks`} on ${weekdays ? 'Monday to Friday' : list(s.days.map((d) => WEEKDAY_NAMES[d]))}`;
  } else {
    const day = s.monthDay === 'first-work' ? 'the first working day' : s.monthDay === 'last-work' ? 'the last working day' : `the ${ordinal(s.monthDay)}`;
    text = `${n === 1 ? 'Every month' : `Every ${n} months`} on ${day}`;
  }
  return text;
}
