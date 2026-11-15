// The bell's wording and rules that need no page: the count on the badge, its label for screen
// readers, which links are followed, relative times and the Today / Yesterday / Earlier groups.
// Kept apart from notifications.js so the tests run them in Node (test/notifications.test.js).
export const badgeText = (n) => (n > 99 ? '99+' : String(Math.max(0, n | 0)));
export const bellLabel = (n) => `Notifications, ${n} unread`;
// Only CORE's own routes are followed.
export const safeLink = (link) => (typeof link === 'string' && /^#\/[^\s"'<>\\]*$/.test(link) ? link : null);
const startOfDay = (ms) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
// Today, Yesterday or Earlier, by the calendar day where the browser is.
export function dayGroup(iso, now = Date.now()) {
  const t = Date.parse(iso);
  const today = startOfDay(now);
  if (t >= today) return 'Today';
  if (t >= startOfDay(today - 1)) return 'Yesterday';
  return 'Earlier';
}
// "Just now", "5 min ago", "3 h ago", "Yesterday", "Nov 9", "Nov 9, 2025".
export function relTime(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.floor((now - t) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const group = dayGroup(iso, now);
  if (group === 'Today') return `${Math.floor(mins / 60)} h ago`;
  if (group === 'Yesterday') return 'Yesterday';
  const d = new Date(t);
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
}
// Items (newest first) under Today, Yesterday and Earlier: [[heading, items], …].
export function groupByDay(items, now = Date.now()) {
  const out = [];
  for (const n of items) {
    const g = dayGroup(n.at, now);
    if (!out.length || out.at(-1)[0] !== g) out.push([g, []]);
    out.at(-1)[1].push(n);
  }
  return out;
}
