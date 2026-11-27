// CUSTOM APP → events: reading the ca* collections, cleaning what comes in, and what leaves the
// server about a guest. No client's names here or anywhere in server/customapp: an event is data.
//
// Collections in db.json (design A2): caEvents, caTables, caGuests (the aggregate root: the seat is
// on the guest, so a guest can never hold two), caChanges (append-only history, sync cursor and
// idempotency store) and caOutbox (email, Tier 2). Only server/customapp reads or writes them.
import { randomBytes } from 'node:crypto';
import { HttpError } from '../../util.js';
import { REFUSALS } from '../../../shared/customapp/refusals.js';
import { CLASS_LABELS, SEAT_LABELS } from '../../../shared/customapp/statuses.js';

export const CA_COLLECTIONS = ['caEvents', 'caTables', 'caGuests', 'caChanges', 'caOutbox'];

// db.data is replaced when a backup is restored: always read the current one.
export const coll = (db, k) => (Array.isArray(db.data[k]) ? db.data[k] : (db.data[k] = []));
export const eventsOf = (db) => coll(db, 'caEvents');
export const tablesOf = (db, eventId) => coll(db, 'caTables').filter((t) => t.eventId === eventId);
export const guestsOf = (db, eventId) => coll(db, 'caGuests').filter((g) => g.eventId === eventId);
export const changesOf = (db, eventId) => coll(db, 'caChanges').filter((c) => c.eventId === eventId);
export const stateOf = (db, ev) => ({ event: ev, tables: tablesOf(db, ev.id), guests: guestsOf(db, ev.id) });

// A refusal from the catalogue: its status and message, with the state as it is now.
export function refusal(code, fresh, message) {
  const r = REFUSALS[code];
  if (!r) throw new Error(`Unknown refusal ${code}`);
  return new HttpError(r.status, message || r.message, { code, fresh });
}
export const bad = (message) => new HttpError(400, message);

export function mustEvent(db, id) {
  const ev = eventsOf(db).find((e) => e.id === String(id || ''));
  if (!ev) throw new HttpError(404, 'That event is not there, or you do not have access to it.');
  return ev;
}

// ----- Text that comes in (import, forms) -----
// One line of plain text: control characters (CR and LF too: they would break an email header),
// zero-width and direction marks removed, spaces collapsed.
export const cleanText = (v, max = 120) => (v == null || typeof v === 'object' ? '' : String(v))
  .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
  .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
  .replace(/\s+/g, ' ').trim().slice(0, max);

// The surname as matched (design R2): diacritics stripped, lower case, suffixes (Jr., Sr., II, III,
// IV) dropped, then spaces, hyphens, periods and apostrophes dropped. "Dela Cruz Jr." → "delacruz".
export function canonSurname(v) {
  const s = cleanText(v, 120).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[,]/g, ' ')
    .replace(/(^|\s)(jr|sr|ii|iii|iv)\.?(?=\s|$)/g, ' ');
  return s.replace(/[\s.\-'’‘`]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
}
// The last 4 digits of a mobile number, digits only: "+63 917 123 4567", "09171234567" and
// "917-123-4567" all give "4567"; fewer than 4 digits give "".
export function last4(mobile) {
  const d = String(mobile ?? '').replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : '';
}
export function lookupOf(g) {
  const surnames = [...new Set([canonSurname(g.name?.last), ...(g.altSurnames || []).map(canonSurname)].filter(Boolean))];
  return { surnames, m4: last4(g.mobile) };
}

// An event's code: its name as a slug with a random suffix ("year-end-party-k3f9"), so the guest page
// address cannot be guessed before the QR code is shown.
export function newEventCode(name) {
  const slug = cleanText(name, 80).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'event';
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const suffix = [...randomBytes(4)].map((b) => alphabet[b % alphabet.length]).join('');
  return `${slug}-${suffix}`;
}

// ----- What leaves the server about a guest -----
// The audit log names a guest by reference and a masked name ("G-0012 Maria S."), never the
// mobile or email (design R1).
export const maskedName = (g) => `${g.name?.first || ''} ${(g.name?.last || '').charAt(0)}${g.name?.last ? '.' : ''}`.trim();
export const guestLabel = (g) => `${g.ref} ${maskedName(g)}`.trim();
export const maskMobile = (v) => (last4(v) ? `•••• ${last4(v)}` : '');
export function maskEmail(v) {
  const s = String(v || '');
  const at = s.indexOf('@');
  return at > 0 ? `${s.charAt(0)}•••${s.slice(at)}` : '';
}
export const classLabel = (c) => CLASS_LABELS[c] || c;
export const seatLabel = (s) => (s ? SEAT_LABELS[s.status] || s.status : 'Not seated');

// The event's role for an account: 'super' (the Super Administrator), 'staff', 'manager' (CORE's
// customapp.manage: sees the event and can only hand over the Super Administrator) or null.
export function roleOf(ev, user, canManage = false) {
  if (!user) return null;
  if (ev.superAdminUserId === user.id) return 'super';
  if ((ev.staff || []).some((s) => s.userId === user.id && s.active !== false)) return 'staff';
  return canManage ? 'manager' : null;
}

// A guest as staff see it (design A9 access policy): the owner and the Super Administrator see the
// record with contact details masked; other staff see name, company, industry, class and table only.
export function guestView(g, { role, userId, tables, industries, full = false }) {
  const t = g.seat ? tables.find((x) => x.id === g.seat.tableId) : null;
  const industry = (industries || []).find((i) => i.id === g.industryId);
  const base = {
    id: g.id, ref: g.ref, name: g.name, displayName: g.name?.display || `${g.name?.first || ''} ${g.name?.last || ''}`.trim(),
    company: g.company || '', industry: industry?.name || g.industryText || '', industryId: g.industryId || null,
    classification: g.classification, classLabel: classLabel(g.classification),
    arrival: { state: g.arrival?.state || 'expected', at: g.arrival?.at || null },
    seat: g.seat ? { tableId: g.seat.tableId, number: t?.number ?? null, seatNo: g.seat.seatNo ?? null, status: g.seat.status, label: seatLabel(g.seat) } : null,
    ownerUserId: g.ownerUserId || null, active: g.active !== false, rev: g.rev,
    released: g.released ? { at: g.released.at } : null,
  };
  const mine = role === 'super' || (role === 'staff' && g.ownerUserId === userId);
  if (!mine) return { ...base, limited: true };
  return {
    ...base, mine: true, designation: g.designation || '', rsvp: g.rsvp || '', deskOnly: Boolean(g.deskOnly),
    mobile: maskMobile(g.mobile), email: full && role === 'super' ? g.email || '' : maskEmail(g.email),
    hasMobile: Boolean(last4(g.mobile)), hasEmail: Boolean(g.email), altSurnames: g.altSurnames || [],
    externalKey: g.externalKey || '',
  };
}
