// CUSTOM APP → events: the counts on Event control and My queue (invited, checked in, not yet arrived,
// waiting for a table, needs approval, seated, reserved, seats left). Recounted from the guests every
// time, never stored; every claim counts toward a table whatever its status (shared/customapp/seating.js).
//   invited       guests on the list (walk-ins and substitutes are not invited: they are counted
//                 under needsApproval until decided, then approvedUnlisted)
//   checkedIn     everyone here: invited and approved unlisted guests
//   waiting       here, approved (or on the list), no seat yet
import { isConfirmed, isReserved } from '../../../shared/customapp/seating.js';
import { rsvpStatusOf } from './model.js';

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
    // RSVP-confirmed (spec s.199): a Yes on the invitation link (0.74), or, for a guest who has not
    // answered there, a yes in the imported list.
    rsvpYes: invited.filter((g) => (g.rsvpReply ? g.rsvpReply.answer === 'yes' : /^(yes|y|confirmed|attending)$/i.test(String(g.rsvp || '').trim()))).length, checkedInByClass: byClass,
    rsvp: invitationCounts(state),
  };
}

// The invitations on Event control (0.74): who has an address, how many invitations are waiting, sent
// or failed, opened, and the answers. noReply: invited (the email went or is going) with no answer.
export function invitationCounts(state) {
  const list = state.guests.filter((g) => g.active !== false && !isUnlisted(g) && !g.substitutedBy);
  const st = (g) => rsvpStatusOf(g);
  const inv = (s) => list.filter((g) => g.invite?.state === s).length;
  return {
    guests: list.length, withEmail: list.filter((g) => g.email).length, noEmail: list.filter((g) => !g.email).length,
    notInvited: list.filter((g) => g.email && (!g.invite?.state || g.invite.state === 'none' || g.invite.state === 'revoked')).length,
    queued: inv('queued') + inv('sending'), sent: inv('sent'), failed: inv('failed'),
    opened: list.filter((g) => g.invite?.openedAt).length,
    yes: list.filter((g) => st(g) === 'yes').length, no: list.filter((g) => st(g) === 'no').length,
    noReply: list.filter((g) => ['invited', 'opened'].includes(st(g))).length,
    waitingTable: list.filter((g) => st(g) === 'yes' && !g.seat).length,
    autoSeated: list.filter((g) => g.seat?.via === 'rsvp').length,
  };
}
