// Phone layouts that are more than CSS: the pure parts, so they can be tested without a browser.

// The timesheet on a phone shows one day of the week at a time. Which day opens first: the one
// asked for (kept when moving between weeks), else today when it is in the week, else Monday.
export function defaultDay(days, today, wanted = null) {
  const n = Number(wanted);
  if (wanted !== null && wanted !== '' && Number.isInteger(n) && n >= 0 && n < days.length) return n;
  const i = days.indexOf(today);
  return i >= 0 ? i : 0;
}

// The hours of each day across the rows, and the week's total.
export function dayTotals(rows, count) {
  const days = Array.from({ length: count }, (_, j) => rows.reduce((n, r) => n + (Number(r.hours[j]) || 0), 0));
  return { days, week: days.reduce((n, h) => n + h, 0) };
}

// Roles & permissions on a phone: the grid shows the permission names and one account type. Returns
// the account type to show: the one picked when it still exists, else the first that can be edited.
export function pickedRole(roleIds, picked) {
  if (picked && roleIds.includes(picked)) return picked;
  return roleIds[0] || null;
}

// The nav drawer's focus trap: where Tab (or Shift+Tab) goes from item i of n. From outside the
// drawer (i = -1), Tab goes to the first item and Shift+Tab to the last; both ends wrap around.
export function nextInTrap(i, n, back = false) {
  if (n <= 0) return -1;
  if (i < 0 || i >= n) return back ? n - 1 : 0;
  return back ? (i - 1 + n) % n : (i + 1) % n;
}
