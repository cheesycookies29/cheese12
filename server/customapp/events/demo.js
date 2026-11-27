// CUSTOM APP → events: the demo event, added and removed with CORE's demo data (Admin panel → Demo
// data). "Demo Gala" is clearly an example: a 5 x 5 room of tables of 10, about 120 made-up guests
// (some checked in and seated, a few waiting, preferred guests with reserved seats), two demo staff
// accounts. Every record is marked demo: true; nothing else is touched. It is a draft event, so its
// window never opens the venue allowances or blocks switching the module off.
import { randomUUID } from 'node:crypto';
import { createEvent } from './commit.js';
import { lookupOf, CA_COLLECTIONS } from './model.js';
import { cleanIndustries } from './engine.js';

const FIRST = ['Maria', 'Jose', 'Ana', 'Juan', 'Carmela', 'Ramon', 'Liza', 'Paolo', 'Grace', 'Miguel', 'Teresa', 'Rafael', 'Joy', 'Carlo', 'Bea', 'Enrique', 'Patricia', 'Andres', 'Kristine', 'Marco'];
const LAST = ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Ocampo', 'Garcia', 'Mendoza', 'Torres', 'Tomas', 'Andrada', 'Castillo', 'Villanueva', 'Ramos', 'Aquino', 'Dela Cruz', 'Navarro', 'Salazar', 'Lim', 'Tan', 'Gonzales', 'Fernandez', 'Pascual', 'De Leon', 'Soriano'];
const COMPANIES = [['Northbay Bank (demo)', 'Banking'], ['Isla Savings (demo)', 'Banking'], ['Harbor Life Assurance (demo)', 'Insurance'], ['Sunrise Mutual (demo)', 'Insurance'], ['Metro Towers Realty (demo)', 'Real estate'], ['Kalye Homes (demo)', 'Real estate'], ['Bitwise Systems (demo)', 'Technology'], ['Cloudpeak Software (demo)', 'Technology'], ['Signal Telecom (demo)', 'Telecommunications'], ['Palengke Retail Group (demo)', 'Retail'], ['Solar Ridge Power (demo)', 'Energy'], ['Agency of Ports (demo)', 'Government']];
const INDUSTRIES = [
  { name: 'Banking', related: ['Insurance', 'Real estate'] }, { name: 'Insurance', related: [] }, { name: 'Real estate', related: [] },
  { name: 'Technology', related: ['Telecommunications'] }, { name: 'Telecommunications', related: [] }, { name: 'Retail', related: [] },
  { name: 'Energy', related: ['Government'] }, { name: 'Government', related: [] },
];

// A small seeded generator, so the demo is the same every time it is loaded.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export const removeDemoEvents = (db) => {
  for (const k of CA_COLLECTIONS) if (Array.isArray(db.data[k])) db.data[k] = db.data[k].filter((x) => !x.demo && !(k !== 'caEvents' && demoEventIds(db).has(x.eventId)));
};
const demoEventIds = (db) => new Set((db.data.caEvents || []).filter((e) => e.demo).map((e) => e.id));

// lead: the demo Super Administrator's account; staff: the demo staffer's. Today's date decides the
// event's date (a week ahead), so the demo always looks upcoming.
export function addDemoEvent(db, { lead, staff, now = new Date() }) {
  removeDemoEvents(db);
  if (!lead) return null;
  const day = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const ctx = { db, audit: null, now: () => now.toISOString() };
  // Ids removed first, then the event made by the same function as a real one (without a save: the
  // demo route saves once at the end).
  const marks = new Set(demoEventIds(db));
  const ev = createEvent(ctx, lead, { name: 'Demo Gala', venue: 'Grand Ballroom (demo)', date: day, refPrefix: 'DEMO', demo: true, noSave: true, superAdminUserId: lead.id,
    room: { rows: 5, cols: 5, chairsPerTable: 10, stageSide: 'right', boothSide: 'left' }, settings: { seatNumbers: 'all' },
    window: { opensAt: `${day}T18:00`, closesAt: `${day}T23:00` }, industries: INDUSTRIES });
  ev.industries = cleanIndustries(INDUSTRIES);
  ev.staff = staff ? [{ userId: staff.id, role: 'staff', active: true }] : [];
  const tables = db.data.caTables.filter((t) => t.eventId === ev.id).sort((a, b) => a.number - b.number);
  // Tables 1-3 (nearest the stage) for preferred guests, 22-25 for employees, the rest regular; the
  // demo staffer owns tables 4 to 12.
  for (const t of tables) {
    t.classification = t.number <= 3 ? 'preferred' : t.number >= 22 ? 'employee' : 'regular';
    if (staff && t.number >= 4 && t.number <= 12) t.ownerUserId = staff.id;
  }
  const ind = new Map(ev.industries.map((i) => [i.name, i.id]));
  const rand = rng(20261209);
  const at = (mins) => new Date(now.getTime() - mins * 60000).toISOString();
  const guests = [];
  for (let i = 0; i < 120; i++) {
    const first = FIRST[i % FIRST.length];
    const last = LAST[Math.floor(i / FIRST.length) * 5 % LAST.length + (i % 5)] || LAST[i % LAST.length];
    const [company, industry] = COMPANIES[Math.floor(rand() * COMPANIES.length)];
    const classification = i < 24 ? 'preferred' : i >= 104 ? 'employee' : 'regular';
    const mobile = `+63 9${String(17 + (i % 3))} ${String(100 + Math.floor(rand() * 900))} ${String(1000 + ((i * 7919) % 9000)).padStart(4, '0')}`;
    const g = {
      id: randomUUID(), eventId: ev.id, ref: `DEMO-${String(i + 1).padStart(4, '0')}`, externalKey: `DEMO-${i + 1}`,
      name: { first, last, display: `${first} ${last}` }, designation: ['Director', 'Manager', 'Vice President', 'Partner', 'Head of Sales', 'Analyst'][i % 6],
      company: classification === 'employee' ? 'Host company (demo)' : company, industryId: classification === 'employee' ? null : ind.get(industry), industryText: '',
      email: i % 9 === 4 ? '' : `${first}.${last}`.toLowerCase().replace(/\s+/g, '') + (i + 1) + '@example.com', mobile: i % 23 === 11 ? '' : mobile,
      classification, tags: [], rsvp: i % 10 === 3 ? 'Maybe' : 'Yes', ownerUserId: staff && classification === 'regular' && i % 2 === 0 ? staff.id : null,
      arrival: { state: 'expected', at: null, by: null, via: null }, approval: { state: 'none' }, seat: null, statusTokens: [], flags: [], notify: { state: 'none' },
      deskOnly: false, altSurnames: last.includes(' ') ? [last.split(' ').pop()] : [], active: true, rev: 0, demo: true,
    };
    g.lookup = lookupOf(g);
    guests.push(g);
  }
  // Two guests that the guest page could not tell apart (the import check shows them).
  guests[60].mobile = guests[40].mobile;
  guests[60].name = { ...guests[60].name, last: guests[40].name.last, display: `${guests[60].name.first} ${guests[40].name.last}` };
  guests[60].lookup = lookupOf(guests[60]);
  // Preferred guests hold reserved seats at tables 1-3 (24 of 30 chairs); the first 10 have arrived.
  const pref = guests.filter((g) => g.classification === 'preferred');
  pref.forEach((g, k) => {
    const t = tables[Math.floor(k / 8)];
    g.seat = { tableId: t.id, seatNo: (k % 8) + 1, status: 'reserved', at: at(600), by: lead.id };
    if (k < 10) {
      g.arrival = { state: 'checked_in', at: at(40 - k), by: lead.id, via: 'desk' };
      g.seat.status = 'confirmed';
    }
  });
  // Regular guests: 30 have arrived; 22 of them are seated at tables 4-9, 8 are waiting for a table.
  const regular = guests.filter((g) => g.classification === 'regular');
  regular.slice(0, 30).forEach((g, k) => {
    g.arrival = { state: 'checked_in', at: at(35 - k), by: staff?.id || lead.id, via: 'desk' };
    if (k < 22) {
      const t = tables[3 + Math.floor(k / 4)];
      g.seat = { tableId: t.id, seatNo: (k % 4) + 1, status: 'confirmed', at: at(30 - k), by: staff?.id || lead.id };
      if (t.ownerUserId) g.ownerUserId = t.ownerUserId;
      else g.ownerUserId = null;
    }
  });
  // Employees: 4 seated at table 22.
  guests.filter((g) => g.classification === 'employee').slice(0, 4).forEach((g, k) => {
    g.arrival = { state: 'checked_in', at: at(20 - k), by: lead.id, via: 'desk' };
    g.seat = { tableId: tables[21].id, seatNo: k + 1, status: 'confirmed', at: at(18 - k), by: lead.id };
  });
  db.data.caGuests = [...(db.data.caGuests || []), ...guests];
  ev.seq = 1;
  marks.clear();
  return ev;
}
