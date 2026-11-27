// CUSTOM APP → events: what a staff screen shows, derived from the event every time (never stored):
// the queues (design A2), the room plan's data (US-031) and the reply to the short poll (US-019).
//
//   queue(owner)  the guests one staff member owns who are checked in and have no seat, oldest first
//   superQueue    the Super Administrator's: checked-in guests with no owner (or an owner no longer
//                 on the staff), a released preferred guest who arrived, unlisted guests waiting for
//                 approval, and guests flagged for a look (verified again from another device)
//
// Who sees what follows the access policy (design A9): the owner and the Super Administrator see a
// guest's record (contact details masked); other staff see name, company, industry and table only.
import { isConfirmed, isReserved, tableCounts } from '../../../shared/customapp/seating.js';
import { pollFor, CLASS_LABELS } from '../../../shared/customapp/statuses.js';
import { guestView, changesOf } from './model.js';
import { eventCounts } from './counts.js';

const here = (g) => g.active !== false && g.arrival?.state === 'checked_in';
export const isWaiting = (g) => here(g) && !g.seat;
const releasedPreferred = (g) => Boolean(g.released) && g.classification === 'preferred';
const byArrival = (a, b) => String(a.arrival?.at || '').localeCompare(String(b.arrival?.at || '')) || String(a.ref).localeCompare(String(b.ref));
const activeStaff = (ev) => new Set([ev.superAdminUserId, ...(ev.staff || []).filter((s) => s.active !== false).map((s) => s.userId)].filter(Boolean));

// The guests waiting for one staff member, oldest first.
export function queueOf(state, userId) {
  return state.guests.filter((g) => isWaiting(g) && g.ownerUserId === userId && !releasedPreferred(g)).sort(byArrival);
}

// The Super Administrator's queue, each with why it is there.
export function superQueue(state) {
  const staff = activeStaff(state.event);
  const out = [];
  for (const g of state.guests) {
    if (g.active === false) continue;
    const why = [];
    if (isWaiting(g) && releasedPreferred(g)) why.push('released');
    else if (isWaiting(g) && (!g.ownerUserId || !staff.has(g.ownerUserId) || g.ownerUserId === state.event.superAdminUserId)) why.push('no_owner');
    if (g.classification === 'unlisted' && g.approval?.state === 'pending') why.push('unlisted');
    if ((g.flags || []).length) why.push('flagged');
    if (why.length) out.push({ guest: g, why });
  }
  return out.sort((a, b) => byArrival(a.guest, b.guest));
}

// Guests moved away from this staff member by the Super Administrator in the last 15 minutes (the
// screen greys them out with who has them now, before they leave the list: nothing disappears
// silently).
export function movedAway(db, ev, userId, { users = [], now = Date.now() } = {}) {
  const cutoff = new Date(now - 15 * 60000).toISOString();
  const out = [];
  const list = changesOf(db, ev.id);
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (c.at < cutoff) break;
    if (c.type !== 'delegateGuests') continue;
    for (const d of c.diff || []) {
      if (d.f !== 'ownerUserId' || d.from !== userId) continue;
      out.push({ guestId: d.id, to: d.to || null, toName: users.find((u) => u.id === d.to)?.name || '', byName: users.find((u) => u.id === c.actorId)?.name || '', at: c.at, seq: c.seq });
    }
  }
  return out;
}

const initials = (g) => `${(g.name?.first || '').charAt(0)}${(g.name?.last || '').replace(/^(de la|dela|del|de|van|von)\s+/i, '').charAt(0)}`.toUpperCase() || '?';

// The room plan's data (GET …/room): every table where it stands, with its chairs and who holds
// each, and the guests waiting (the side panel). Staff see every table; they may choose chairs only
// at their own (mine), and other tables are marked "Not yours".
export function roomOf(state, { role, userId, users = [] }) {
  const ev = state.event;
  const ind = new Map((ev.industries || []).map((i) => [i.id, i.name]));
  const nameOf = (id) => users.find((u) => u.id === id)?.name || '';
  const seatedAt = new Map();
  for (const g of state.guests) if (g.seat?.tableId) (seatedAt.get(g.seat.tableId) || seatedAt.set(g.seat.tableId, []).get(g.seat.tableId)).push(g);
  const person = (g) => ({
    guestId: g.id, initials: initials(g), name: g.name?.display || `${g.name?.first || ''} ${g.name?.last || ''}`.trim(), company: g.company || '', industry: ind.get(g.industryId) || g.industryText || '',
    industryId: g.industryId || null, classification: g.classification, status: isReserved(g.seat) ? 'reserved' : 'confirmed', rev: g.rev || 0,
    mine: role === 'super' || g.ownerUserId === userId,
  });
  const tables = [...state.tables].sort((a, b) => a.number - b.number).map((t) => {
    const at = seatedAt.get(t.id) || [];
    const chairs = Array.from({ length: t.capacity }, (_, i) => {
      const g = at.find((x) => x.seat.seatNo === i + 1);
      return { seatNo: i + 1, ...(g ? { taken: true, ...person(g) } : { taken: false }) };
    });
    return {
      id: t.id, number: t.number, row: t.row ?? null, col: t.col ?? null, classification: t.classification, classLabel: CLASS_LABELS[t.classification] || t.classification,
      capacity: t.capacity, active: t.active !== false, rev: t.rev || 0, ownerUserId: t.ownerUserId || null, ownerName: nameOf(t.ownerUserId),
      mine: role === 'super' || (role === 'staff' && t.ownerUserId === userId), ...tableCounts(t, state.guests), chairs,
      // A claim without a chair number (an event that numbers preferred guests only) takes a place too.
      unnumbered: at.filter((g) => !g.seat.seatNo).map(person),
      industries: [...new Set(at.map((g) => ind.get(g.industryId)).filter(Boolean))],
    };
  });
  const waitingList = (role === 'super' ? state.guests.filter(isWaiting).sort(byArrival) : queueOf(state, userId))
    .map((g) => ({ ...person(g), ref: g.ref, classLabel: CLASS_LABELS[g.classification] || g.classification, arrivedAt: g.arrival?.at || null, ownerName: nameOf(g.ownerUserId), releasedNeedsSuper: releasedPreferred(g) }));
  return { eventId: ev.id, seq: ev.seq || 0, room: ev.room || null, role, settings: { seatNumbers: ev.settings?.seatNumbers || 'all', releaseDelegable: Boolean(ev.settings?.releaseDelegable) }, tables, waiting: waitingList };
}

// My queue's board (GET …/changes?tab=queue): the staff member's own sections, scoped.
export function queueBoard(db, state, { role, user, users = [], now = Date.now(), extra = {} }) {
  const ev = state.event;
  const view = (g) => guestView(g, { role, userId: user.id, tables: state.tables, industries: ev.industries });
  const mineIds = role === 'super' ? null : user.id;
  const waiting = role === 'super'
    ? superQueue(state).filter((x) => isWaiting(x.guest)).map((x) => ({ ...view(x.guest), why: x.why, waitingSince: x.guest.arrival?.at || null }))
    : queueOf(state, user.id).map((g) => ({ ...view(g), waitingSince: g.arrival?.at || null }));
  const attention = role === 'super' ? superQueue(state).filter((x) => !isWaiting(x.guest)).map((x) => ({ ...view(x.guest), why: x.why, flags: x.guest.flags || [] })) : [];
  const seated = state.guests.filter((g) => here(g) && g.seat && (mineIds === null || g.ownerUserId === mineIds))
    .sort((a, b) => String(b.seat.at || '').localeCompare(String(a.seat.at || ''))).slice(0, 60).map(view);
  const myTables = state.tables.filter((t) => t.active !== false && (role === 'super' ? true : t.ownerUserId === user.id)).sort((a, b) => a.number - b.number)
    .map((t) => ({ id: t.id, number: t.number, ...tableCounts(t, state.guests) }));
  return {
    event: { id: ev.id, name: ev.name, code: ev.code, status: ev.status },
    me: { id: user.id, name: user.name, role },
    counts: eventCounts(state), waiting, attention, seated, tables: role === 'super' ? [] : myTables,
    freeSeats: myTables.reduce((n, t) => n + t.free, 0), confirmedToday: state.guests.filter((g) => isConfirmed(g.seat)).length,
    movedAway: role === 'super' ? [] : movedAway(db, ev, user.id, { users, now }),
    ...extra,
  };
}

// The short-poll reply (design A9): one integer comparison when nothing changed, and no board built;
// otherwise the board. A client ahead of the server (a restored standby) gets a full board. `wait`
// is reserved for a long poll later and ignored.
export function pollReply(ev, since, build, kind = 'staff') {
  const seq = ev.seq || 0;
  const pollMs = pollFor(ev.flags, kind);
  const s = since === undefined || since === null || since === '' ? NaN : Number(since);
  if (Number.isFinite(s) && s === seq) return { seq, pollMs, unchanged: true };
  return { seq, pollMs, board: build() };
}
