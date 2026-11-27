// CUSTOM APP → events: the counts on Event control and My queue (invited, checked in, not yet arrived,
// waiting for a table, needs approval, seated, reserved, seats left). Recounted from the guests every
// time, never stored; every claim counts toward a table whatever its status (shared/customapp/seating.js).
//   invited       guests on the list (walk-ins and substitutes are not invited: they are counted
//                 under needsApproval until decided, then approvedUnlisted)
//   checkedIn     everyone here: invited and approved unlisted guests
//   waiting       here, approved (or on the list), no seat yet
import { isConfirmed, isReserved } from '../../../shared/customapp/seating.js';

const isUnlisted = (g) => g.classification === 'unlisted';
export const pendingApproval = (g) => g.active !== false && isUnlisted(g) && g.approval?.state === 'pending';

export function eventCounts(state) {
  const guests = state.guests.filter((g) => g.active !== false);
  const invited = guests.filter((g) => !isUnlisted(g));
  const capacity = state.tables.filter((t) => t.active).reduce((n, t) => n + t.capacity, 0);
  const claims = state.guests.filter((g) => g.seat).length;
  const here = guests.filter((g) => g.arrival?.state === 'checked_in');
  const byClass = {};
  for (const g of here) {
    const k = isUnlisted(g) ? 'unlisted' : g.classification;
    byClass[k] = (byClass[k] || 0) + 1;
  }
  return {
    invited: invited.length, checkedIn: here.length, notArrived: invited.filter((g) => g.arrival?.state === 'expected').length,
    waiting: here.filter((g) => !g.seat).length, needsApproval: guests.filter(pendingApproval).length,
    approvedUnlisted: guests.filter((g) => isUnlisted(g) && g.approval?.state === 'approved').length,
    seated: guests.filter((g) => isConfirmed(g.seat)).length, reserved: guests.filter((g) => isReserved(g.seat)).length,
    capacity, seatsLeft: Math.max(0, capacity - claims), released: guests.filter((g) => g.released && !g.seat).length,
    rsvpYes: invited.filter((g) => /^(yes|y|confirmed|attending)$/i.test(String(g.rsvp || '').trim())).length, checkedInByClass: byClass,
  };
}
