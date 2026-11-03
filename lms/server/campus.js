// Campuses: the school's sites. Every campus has the same features, catalog, terms,
// modules and settings; each has its own students, teachers, registrars, sections
// (and so enrollments and class content), news and events.
//
// Accounts carry campusIds: a student belongs to exactly one campus; teachers and
// registrars may work at several; administrators reach every campus. The campus a
// person is looking at (their "active" campus) is remembered on their account.
import { HttpError } from './util.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};

// Campuses an account may open.
export function campusesFor(data, user) {
  if (!user) return [];
  if (user.role === 'admin') return data.campuses;
  const ids = new Set(user.campusIds || []);
  return data.campuses.filter((c) => ids.has(c.id));
}

export function activeCampusId(data, user) {
  const list = campusesFor(data, user);
  return (list.find((c) => c.id === user?.activeCampusId) || list[0])?.id || null;
}

export const inCampus = (u, campusId) => u?.role === 'admin' || (u?.campusIds || []).includes(campusId);

// May `caller` see or manage `target`? Administrators: everyone. Others: people who
// share one of their campuses (and never administrators).
export function canReach(data, caller, target) {
  if (caller.role === 'admin') return true;
  if (target.role === 'admin') return false;
  const mine = new Set(campusesFor(data, caller).map((c) => c.id));
  return (target.campusIds || []).some((id) => mine.has(id));
}

// The campuses chosen for an account in a form, limited to the caller's campuses.
// Students get exactly one; administrators none (they reach every campus).
export function campusIdsFrom(data, caller, role, requested, fallbackId) {
  if (role === 'admin') return [];
  const allowed = new Set(campusesFor(data, caller).map((c) => c.id));
  let ids = [...new Set((Array.isArray(requested) ? requested : requested ? [requested] : []).filter(Boolean))];
  if (!ids.length && fallbackId) ids = [fallbackId];
  for (const id of ids) {
    if (!data.campuses.some((c) => c.id === id)) fail('Campus not found.');
    if (!allowed.has(id)) fail('You can only add people to your own campuses.', 403);
  }
  if (!ids.length) fail('Pick a campus.');
  if (role === 'student' && ids.length > 1) fail('A student belongs to one campus.');
  return ids;
}

export const sectionCampus = (data, sectionId) => data.sections.find((s) => s.id === sectionId)?.campusId || null;
export const campusName = (data, id) => data.campuses.find((c) => c.id === id)?.name || '';
