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
import { isConfirmed, isReserved, tableCounts, whyNot, seatClassOf } from '../../../shared/customapp/seating.js';
import { pollFor, CLASS_LABELS } from '../../../shared/customapp/statuses.js';
import { guestView, changesOf } from './model.js';
import { eventCounts, pendingApproval } from './counts.js';

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

// ----- Event control (Tier 2, US-024): the Super Administrator's exceptions inbox -----
// Everything that needs the Super Administrator, oldest first (the failure alarm on top):
//   walkin            a walk-in waiting for approval
//   substitute        a substitute waiting for approval, as one seat changing hands
//                     ("Seat 3-4: Juan Reyes replaces Pedro Reyes")
//   no_seat_in_scope  a guest waiting whose owner has no table that can take them now
//   no_seat           a guest waiting for whom no table in the event has an eligible chair
//   released_arrived  a preferred guest who arrived after their reservation was released
//   group             guests sent to seat together (their owners differ)
//   capped            a surname whose guest page is paused (too many different wrong numbers)
//   email_failed      a seat email that could not be sent (Resend is on the guest's sheet)
//   alarm             many failed guest page checks in 5 minutes
const nameOfG = (g) => g?.name?.display || `${g?.name?.first || ''} ${g?.name?.last || ''}`.trim();
const seatWords = (state, seat) => {
  if (!seat) return 'No seat yet';
  const t = state.tables.find((x) => x.id === seat.tableId);
  return seat.seatNo ? `Seat ${t?.number ?? '?'}-${seat.seatNo}` : `Table ${t?.number ?? '?'}`;
};
export function substituteLine(state, sub, original) {
  // The seat changing hands: the invitee's until the approval, the substitute's after it.
  return `${seatWords(state, original?.seat || sub?.seat)}: ${nameOfG(sub)} replaces ${nameOfG(original)}`;
}
export function exceptionsOf(state, { gate = null, users = [], outbox = [] } = {}) {
  const ev = state.event;
  const items = [];
  const byId = new Map(state.guests.map((g) => [g.id, g]));
  const userName = (id) => users.find((u) => u.id === id)?.name || '';
  const staff = activeStaff(ev);
  const brief = (g) => ({ id: g.id, ref: g.ref, name: nameOfG(g), company: g.company || '', rev: g.rev || 0, classification: g.classification, seatClass: seatClassOf(g) });
  for (const g of state.guests) {
    if (g.active === false) continue;
    if (pendingApproval(g)) {
      const o = g.substituteFor ? byId.get(g.substituteFor) : null;
      items.push(o
        ? { kind: 'substitute', at: g.approval?.requestedAt || '', guestIds: [g.id, o.id], guest: brief(g), original: { ...brief(o), seat: o.seat ? { number: state.tables.find((t) => t.id === o.seat.tableId)?.number ?? null, seatNo: o.seat.seatNo ?? null, status: o.seat.status } : null }, title: substituteLine(state, g, o), detail: `Recorded by ${userName(g.approval?.requestedBy) || 'staff'}${g.approval?.note ? `: ${g.approval.note}` : ''}` }
        : { kind: 'walkin', at: g.approval?.requestedAt || '', guestIds: [g.id], guest: brief(g), title: `Walk-in: ${nameOfG(g)}${g.company ? `, ${g.company}` : ''}`, detail: `Recorded by ${userName(g.approval?.requestedBy) || 'staff'}${g.approval?.note ? `: ${g.approval.note}` : ''}` });
      continue;
    }
    if (isWaiting(g)) {
      if (releasedPreferred(g)) {
        items.push({ kind: 'released_arrived', at: g.arrival?.at || '', guestIds: [g.id], guest: brief(g), title: `${nameOfG(g)} arrived after their reservation was released`, detail: g.released?.reason ? `Released: ${g.released.reason}` : 'Seat them yourself, or give them to a staff member.' });
      } else {
        const others = state.guests.filter((x) => x.id !== g.id);
        const anywhere = state.tables.some((t) => !whyNot(t, [g], ev, others));
        const owner = g.ownerUserId && staff.has(g.ownerUserId) && g.ownerUserId !== ev.superAdminUserId ? g.ownerUserId : null;
        if (!anywhere) items.push({ kind: 'no_seat', at: g.arrival?.at || '', guestIds: [g.id], guest: brief(g), title: `No eligible seat left for ${nameOfG(g)}`, detail: `Every ${CLASS_LABELS[seatClassOf(g)]?.toLowerCase() || ''} table is full. Open or change a table, or seat them as another class.`.replace('  ', ' ') });
        else if (owner && !state.tables.some((t) => t.ownerUserId === owner && !whyNot(t, [g], ev, others))) items.push({ kind: 'no_seat_in_scope', at: g.arrival?.at || '', guestIds: [g.id], guest: brief(g), ownerUserId: owner, title: `No seat in scope: ${nameOfG(g)}`, detail: `${userName(owner) || 'Their owner'} has no table that can take them now. Seat them yourself, or give them (or a table) to someone else.` });
      }
    }
  }
  // Groups sent to seat together, one item per group.
  const groups = new Map();
  for (const g of state.guests) for (const f of g.flags || []) if (f.kind === 'referred_group' && !g.seat) (groups.get(f.group) || groups.set(f.group, { f, list: [] }).get(f.group)).list.push(g);
  for (const { f, list } of groups.values()) items.push({ kind: 'group', at: f.at, guestIds: list.map((g) => g.id), guests: list.map(brief), title: `Seat together (${list.length}): ${list.map(nameOfG).join(', ')}`, detail: `Sent by ${userName(f.by) || 'staff'}: their owners differ${f.note && f.note !== 'Seat together' ? `. ${f.note}` : ''}` });
  // Seat emails that failed (the latest message per guest).
  const lastMsg = new Map();
  for (const m of outbox) if (m.eventId === ev.id) lastMsg.set(m.guestId, m);
  for (const m of lastMsg.values()) {
    const g = byId.get(m.guestId);
    if (m.state === 'failed' && g && isConfirmed(g.seat)) items.push({ kind: 'email_failed', at: m.failedAt || m.createdAt, guestIds: [g.id], guest: brief(g), title: `Seat email to ${nameOfG(g)} failed`, detail: `${m.lastError || 'Not sent.'} Their seat is safe; tell them their table, or Resend.` });
  }
  if (gate) {
    for (const c of gate.cappedOf(ev.id)) {
      const named = state.guests.filter((g) => g.active !== false && (g.lookup?.surnames || []).includes(c.surnameKey));
      items.push({ kind: 'capped', at: c.at, guestIds: named.map((g) => g.id), guests: named.map(brief), surnameKey: c.surnameKey, title: `Guest page paused for the surname "${named[0]?.name?.last || c.surnameKey}"`, detail: `${c.values} different wrong numbers in 15 minutes. Clear it at the desk (Find guest), or here.` });
    }
    const a = gate.alarmOf(ev.id);
    if (a) items.unshift({ kind: 'alarm', at: a.at, guestIds: [], title: `${a.failures} failed guest page checks in 5 minutes`, detail: 'Nobody is locked out. Guests with a code (R-1234) are helped at the desk: Find guest, type the code.' });
  }
  const top = items.filter((i) => i.kind === 'alarm');
  return [...top, ...items.filter((i) => i.kind !== 'alarm').sort((a, b) => String(a.at).localeCompare(String(b.at)))];
}

// Each staff member's workload: waiting guests, the longest wait, when they last changed anything.
export function workloadOf(db, state, users = []) {
  const ev = state.event;
  const lastActive = new Map();
  for (const c of changesOf(db, ev.id)) if (c.actorId) lastActive.set(c.actorId, c.at);
  const nameOf = (id) => users.find((u) => u.id === id)?.name || '';
  return [...(ev.staff || []).filter((x) => x.active !== false).map((x) => x.userId), ev.superAdminUserId].map((uid) => {
    const isSuper = uid === ev.superAdminUserId;
    const q = isSuper ? superQueue(state).filter((x) => isWaiting(x.guest)).map((x) => x.guest) : queueOf(state, uid);
    return {
      userId: uid, name: nameOf(uid), isSuper, waiting: q.length, longestSince: q[0]?.arrival?.at || null, lastActive: lastActive.get(uid) || null,
      waitingGuests: q.slice(0, 40).map((g) => ({ id: g.id, ref: g.ref, name: nameOfG(g), since: g.arrival?.at || null, rev: g.rev || 0 })),
      guests: state.guests.filter((g) => g.ownerUserId === uid).length,
      tables: state.tables.filter((t) => t.ownerUserId === uid).map((t) => t.number).sort((a, b) => a - b),
      tableIds: state.tables.filter((t) => t.ownerUserId === uid).sort((a, b) => a.number - b.number).map((t) => ({ id: t.id, number: t.number, claims: tableCounts(t, state.guests).claims })),
    };
  });
}
