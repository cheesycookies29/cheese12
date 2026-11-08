// The school calendar: kinds of entries, colours and the categories of school events.
// Shared by the server (what each person sees, the calendar feed) and the browser (filters, legend).

// Categories an administrator or registrar gives a school event (Admin panel → School calendar).
export const EVENT_CATEGORIES = [
  { id: 'event', label: 'School event' },
  { id: 'holiday', label: 'Holiday or no classes' },
  { id: 'exam', label: 'Examinations' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'activity', label: 'Activity' },
  { id: 'deadline', label: 'Deadline' },
];
export const EVENT_CATEGORY_IDS = EVENT_CATEGORIES.map((c) => c.id);
export const categoryLabel = (id) => EVENT_CATEGORIES.find((c) => c.id === id)?.label || 'School event';

// Who an event is for. None ticked = everyone.
export const AUDIENCES = [
  { id: 'student', label: 'Students' },
  { id: 'teacher', label: 'Teachers' },
  { id: 'guardian', label: 'Parents & guardians' },
];
export const AUDIENCE_IDS = AUDIENCES.map((a) => a.id);

// What a calendar entry is, for the filters, colours and legend. An event's category decides its kind.
export const KINDS = [
  { id: 'class', label: 'Classes', one: 'Class', icon: 'book' },
  { id: 'due', label: 'Due dates', one: 'Due date', icon: 'clipboard' },
  { id: 'exam', label: 'Examinations', one: 'Examinations', icon: 'quiz' },
  { id: 'event', label: 'School events', one: 'School event', icon: 'megaphone' },
  { id: 'holiday', label: 'Holidays & no classes', one: 'No classes', icon: 'flag' },
  { id: 'term', label: 'Term dates & deadlines', one: 'Term date', icon: 'calendar' },
];
export const KIND_IDS = KINDS.map((k) => k.id);
export const kindOfEvent = (e) => (e.category === 'holiday' || e.noClasses ? 'holiday' : e.category === 'exam' ? 'exam' : e.category === 'deadline' ? 'term' : 'event');

// Whether an event is shown to an account type.
export const forAudience = (e, role) => !e.audience?.length || e.audience.includes(role);

// ----- Dates (YYYY-MM-DD, local) -----
const parse = (ymd) => {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const ymd = (date) => date.toISOString().slice(0, 10);
export const addDays = (s, n) => ymd(new Date(parse(s).getTime() + n * 86400000));
export const weekday = (s) => parse(s).getUTCDay();
export function eachDay(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
