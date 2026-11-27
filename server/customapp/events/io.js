// CUSTOM APP → events: what comes in and goes out in bulk.
//  - The guest list (CSV, or .xlsx read with the Office reader CORE already has): headers found by
//    their usual names, every row cleaned and normalised, and a collision report before anything is
//    written (preview); the apply is one commit (engine 'import').
//  - The import check on the live list: ambiguous pairs, guests with no mobile and no email,
//    possible duplicates, unknown industries. Self check-in stays closed until it is clear or the
//    Super Administrator acknowledges it.
//  - The export: one versioned JSON document (customapp.event/1, with seq and sha256), and the CSV
//    and the printable seating plan made from it.
import { createHash, randomUUID } from 'node:crypto';
import { parseCsv } from '../../../shared/csv.js';
import { readZip, parseXml, kid, kids, textOf, dropPrefixes } from '../../pdf/office-core.js';
import { tableCounts, seatClassOf } from '../../../shared/customapp/seating.js';
import { roomGeometry, chairPoint, ROOM_DRAW } from '../../../shared/customapp/room.js';
import { CLASS_LABELS, SEAT_LABELS } from '../../../shared/customapp/statuses.js';
import { fmtManila } from '../../../shared/customapp/time.js';
import { bad, cleanText, canonSurname, last4, lookupOf } from './model.js';

export const IMPORT_LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, rows: 2000 });
export const EXPORT_FORMAT = 'customapp.event/1';

// ----- Reading the file -----
// An .xlsx workbook: the cells of its first visible sheet, as rows of text.
export function readXlsxRows(buf) {
  let zip;
  try {
    zip = readZip(buf, { maxEntryBytes: 20 * 1024 * 1024, maxTotalBytes: 40 * 1024 * 1024 });
  } catch (err) {
    throw bad(err.message || 'That file is not an Excel workbook CORE can read.');
  }
  const xml = (name) => (zip.has(name) ? dropPrefixes(parseXml(zip.read(name))) : null);
  const wb = xml('xl/workbook.xml');
  if (!wb) throw bad('That file is not an Excel workbook (.xlsx). Save it as .xlsx or CSV and try again.');
  const shared = kids(xml('xl/sharedStrings.xml'), 'si').map((si) => kids(si).filter((k) => k.name === 't' || k.name === 'r').map(textOf).join(''));
  const rels = xml('xl/_rels/workbook.xml.rels');
  const sheet = kids(kid(wb, 'sheets'), 'sheet').find((s) => s.attrs.state !== 'hidden' && s.attrs.state !== 'veryHidden');
  if (!sheet) throw bad('That workbook has no sheet to read.');
  const rid = sheet.attrs['r:id'] || sheet.attrs.id;
  const target = kids(rels, 'Relationship').find((r) => r.attrs.Id === rid)?.attrs.Target || 'worksheets/sheet1.xml';
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  const ws = xml(path);
  if (!ws) throw bad('The first sheet of that workbook could not be read.');
  const col = (ref) => [...String(ref).replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const rows = [];
  for (const row of kids(kid(ws, 'sheetData'), 'row')) {
    const out = [];
    for (const c of kids(row, 'c')) {
      const k = c.attrs.r ? col(c.attrs.r) : out.length;
      if (k < 0 || k > 60) continue;
      const v = textOf(kid(c, 'v'));
      out[k] = c.attrs.t === 's' ? shared[Number(v)] ?? '' : c.attrs.t === 'inlineStr' ? textOf(kid(c, 'is')) : v;
    }
    if (out.some((x) => x && String(x).trim())) rows.push(Array.from(out, (x) => (x == null ? '' : String(x))));
    if (rows.length > IMPORT_LIMITS.rows + 1) break;
  }
  return rows;
}

export function rowsOfUpload({ format, data }) {
  if (typeof data !== 'string' || !data) throw bad('Choose a CSV or Excel (.xlsx) file.');
  if (format === 'xlsx') {
    const buf = Buffer.from(data, 'base64');
    if (buf.length > IMPORT_LIMITS.bytes) throw bad('The file is larger than 2 MB. Send the guest list only.');
    return readXlsxRows(buf);
  }
  if (Buffer.byteLength(data) > IMPORT_LIMITS.bytes) throw bad('The file is larger than 2 MB. Send the guest list only.');
  const { rows, error } = parseCsv(data);
  if (error) throw bad(error);
  return rows;
}

// Header names people use, cleaned to letters and digits.
const HEADERS = {
  externalKey: ['ref', 'id', 'guestid', 'guestno', 'guestnumber', 'externalkey', 'key', 'refno', 'reference'],
  first: ['firstname', 'first', 'givenname'],
  salutation: ['salutation', 'honorific', 'prefix', 'mrms'],
  last: ['lastname', 'surname', 'last', 'familyname'],
  full: ['name', 'fullname', 'guest', 'guestname'],
  designation: ['designation', 'title', 'position', 'jobtitle'],
  company: ['company', 'organization', 'organisation', 'org', 'companyname', 'companyororganization'],
  industry: ['industry', 'sector', 'industrysector'],
  email: ['email', 'emailaddress', 'mail'],
  mobile: ['mobile', 'mobilenumber', 'mobileno', 'phone', 'cellphone', 'cellphonenumber', 'contactnumber', 'contact'],
  classification: ['classification', 'class', 'guesttype', 'type', 'category'],
  rsvp: ['rsvp', 'rsvpstatus'],
  owner: ['personnel', 'owner', 'registrationpersonnel', 'designatedpersonnel', 'designatedregistrationpersonnel', 'staff', 'assignedto'],
  table: ['table', 'tableno', 'tablenumber'],
  seat: ['seat', 'seatno', 'seatnumber', 'chair'],
  altSurnames: ['altsurnames', 'alternatesurnames', 'othersurnames', 'aka'],
  deskOnly: ['deskonly'],
};
const headerKey = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
const CLASS_WORDS = { preferred: 'preferred', vip: 'preferred', express: 'preferred', regular: 'regular', guest: 'regular', employee: 'employee', employees: 'employee', staff: 'employee' };
const yes = (v) => /^(y|yes|true|1|x)$/i.test(String(v || '').trim());

// ----- The preview: rows → guests, and what is wrong with them -----
// state: the event as it is; users: [{ id, username, name }]. Returns { adds, updates, report }.
export function previewImport(state, rows, { users = [], now = new Date().toISOString() } = {}) {
  if (!rows.length) throw bad('The file is empty.');
  if (rows.length - 1 > IMPORT_LIMITS.rows) throw bad(`The file has more than ${IMPORT_LIMITS.rows} guests.`);
  const head = rows[0].map(headerKey);
  const at = Object.fromEntries(Object.entries(HEADERS).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]));
  if (at.last < 0 && at.full < 0) throw bad('The first row must name the columns, with at least Surname (or Name).');
  const ev = state.event;
  const industries = ev.industries || [];
  const staffIds = new Set([ev.superAdminUserId, ...(ev.staff || []).filter((s) => s.active !== false).map((s) => s.userId)]);
  const tablesByNo = new Map(state.tables.map((t) => [t.number, t]));
  const byKey = new Map(state.guests.map((g) => [g.externalKey, g]));
  const report = { rows: rows.length - 1, unknownClass: [], unknownTable: [], seatConflict: [], overCapacity: [], wrongTable: [], missingSeat: [], repeatedKey: [], unknownIndustry: [], unknownOwner: [] };
  const prefix = ev.refPrefix || 'G';
  let refNo = state.guests.reduce((m, g) => Math.max(m, Number(String(g.ref).split('-').pop()) || 0), 0);
  const seen = new Set();
  const records = [];
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const cell = (k, max = 120) => (at[k] >= 0 ? cleanText(r[at[k]], max) : '');
    let first = cell('first', 80);
    let last = cell('last', 80);
    const full = cell('full', 160);
    if (!last && full) {
      const comma = full.indexOf(',');
      if (comma > 0) [last, first] = [full.slice(0, comma).trim(), full.slice(comma + 1).trim()];
      else {
        const parts = full.split(' ');
        last = parts.pop();
        first = first || parts.join(' ');
      }
    }
    if (!last) return;
    const clsWord = cell('classification', 40).toLowerCase();
    const classification = clsWord ? CLASS_WORDS[clsWord.replace(/[^a-z]/g, '')] || null : 'regular';
    if (!classification) report.unknownClass.push({ line, value: clsWord });
    const industryText = cell('industry', 80);
    const industry = industryText ? industries.find((x) => x.name.toLowerCase() === industryText.toLowerCase()) : null;
    if (industryText && !industry) report.unknownIndustry.push({ line, value: industryText });
    const ownerText = cell('owner', 80).toLowerCase();
    const owner = ownerText ? users.find((u) => staffIds.has(u.id) && (u.username.toLowerCase() === ownerText || u.name.toLowerCase() === ownerText)) : null;
    if (ownerText && !owner) report.unknownOwner.push({ line, value: ownerText });
    const email = cell('email', 254).toLowerCase();
    const key = cell('externalKey', 60) || `${canonSurname(last)}|${canonSurname(first)}|${cell('company', 160).toLowerCase()}`;
    if (seen.has(key)) report.repeatedKey.push({ line, value: key });
    seen.add(key);
    const rec = {
      line, externalKey: key, name: { first, last, display: `${first} ${last}`.trim(), ...(cell('salutation', 12) ? { title: cell('salutation', 12) } : {}) },
      designation: cell('designation'), company: cell('company', 160), industryId: industry?.id || null, industryText: industry ? '' : industryText,
      email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : '', mobile: cell('mobile', 40), classification: classification || 'regular',
      rsvp: cell('rsvp', 40), ownerUserId: owner?.id || null, altSurnames: cell('altSurnames', 200).split(/[;,]/).map((s) => cleanText(s, 80)).filter(Boolean).slice(0, 5),
      deskOnly: yes(cell('deskOnly', 10)), table: cell('table', 10), seatNo: cell('seat', 10),
    };
    rec.lookup = lookupOf(rec);
    records.push(rec);
  });

  // Preassigned seats (preferred guests): the table must exist and suit the guest, the chair must be
  // free and numbered when it has to be, and no table may hold more than its chairs.
  const importedKeys = new Set(records.map((x) => x.externalKey));
  const kept = state.guests.filter((g) => g.seat && !importedKeys.has(g.externalKey));
  const perTable = new Map();
  const chairs = new Set(kept.filter((g) => g.seat.seatNo).map((g) => `${g.seat.tableId}:${g.seat.seatNo}`));
  for (const g of kept) perTable.set(g.seat.tableId, (perTable.get(g.seat.tableId) || 0) + 1);
  for (const rec of records) {
    const existing = byKey.get(rec.externalKey);
    rec.seat = existing?.seat || null;
    if (!rec.table) continue;
    const t = tablesByNo.get(Number(rec.table));
    if (!t) {
      report.unknownTable.push({ line: rec.line, value: rec.table });
      continue;
    }
    const mixed = ev.settings?.mixedTables;
    if (!(t.classification === rec.classification || (mixed && t.classification === 'mixed'))) report.wrongTable.push({ line: rec.line, value: `${CLASS_LABELS[rec.classification]} guest at a ${CLASS_LABELS[t.classification].toLowerCase()} table ${t.number}` });
    const n = rec.seatNo ? Number(rec.seatNo) : null;
    if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= t.capacity)) report.seatConflict.push({ line: rec.line, value: `table ${t.number}, seat ${rec.seatNo}` });
    else if (n === null && (rec.classification === 'preferred' || ev.settings?.seatNumbers === 'all')) report.missingSeat.push({ line: rec.line, value: `table ${t.number}` });
    else if (n !== null && chairs.has(`${t.id}:${n}`)) report.seatConflict.push({ line: rec.line, value: `table ${t.number}, seat ${n}` });
    if (n !== null) chairs.add(`${t.id}:${n}`);
    perTable.set(t.id, (perTable.get(t.id) || 0) + 1);
    rec.seat = existing?.seat && existing.seat.tableId === t.id && (existing.seat.seatNo ?? null) === n ? existing.seat : { tableId: t.id, seatNo: n, status: 'reserved', at: now, by: null };
  }
  for (const t of state.tables) if ((perTable.get(t.id) || 0) > t.capacity) report.overCapacity.push({ line: null, value: `table ${t.number}: ${perTable.get(t.id)} guests for ${t.capacity} chairs` });

  const adds = [];
  const updates = [];
  const FIELDS = ['name', 'designation', 'company', 'industryId', 'industryText', 'email', 'mobile', 'classification', 'rsvp', 'altSurnames', 'lookup', 'ownerUserId', 'seat'];
  for (const rec of records) {
    const g = byKey.get(rec.externalKey);
    if (g) {
      const patch = {};
      for (const f of FIELDS) if (JSON.stringify(g[f] ?? null) !== JSON.stringify(rec[f] ?? null) && !(f === 'ownerUserId' && !rec.ownerUserId)) patch[f] = rec[f];
      if (rec.deskOnly && !g.deskOnly) patch.deskOnly = true;
      if (Object.keys(patch).length) updates.push({ id: g.id, patch });
      continue;
    }
    refNo++;
    adds.push({
      id: randomUUID(), ref: `${prefix}-${String(refNo).padStart(4, '0')}`, externalKey: rec.externalKey, name: rec.name, designation: rec.designation,
      company: rec.company, industryId: rec.industryId, industryText: rec.industryText, email: rec.email, mobile: rec.mobile, lookup: rec.lookup,
      classification: rec.classification, tags: [], rsvp: rec.rsvp, ownerUserId: rec.ownerUserId, arrival: { state: 'expected', at: null, by: null, via: null },
      approval: { state: 'none' }, seat: rec.seat, statusTokens: [], flags: [], notify: { state: 'none' }, deskOnly: rec.deskOnly, altSurnames: rec.altSurnames, active: true,
    });
  }
  const capacity = state.tables.filter((t) => t.active).reduce((n, t) => n + t.capacity, 0);
  const total = state.guests.filter((g) => g.active !== false).length + adds.length;
  const blocking = ['unknownClass', 'unknownTable', 'seatConflict', 'overCapacity', 'wrongTable', 'missingSeat', 'repeatedKey'].reduce((n, k) => n + report[k].length, 0) + (total > capacity ? 1 : 0);
  // What the list would look like once added: the same check as the live one.
  const after = importIssues({ ...state, guests: [...state.guests.filter((g) => !updates.some((u) => u.id === g.id)), ...state.guests.filter((g) => updates.some((u) => u.id === g.id)).map((g) => ({ ...g, ...updates.find((u) => u.id === g.id).patch })), ...adds] });
  return { adds, updates, capacity, report: { ...report, blocking, total, capacity, tooMany: total > capacity ? total - capacity : 0, adds: adds.length, updates: updates.length, issues: after } };
}

// ----- The import check (on the list as it is) -----
// Pairs that self check-in could not tell apart (same surname and the same last 4 of the mobile),
// guests with no way to verify (no mobile, no email), possible duplicates and unknown industries.
// A guest marked "desk only" is checked in at the desk and is not part of any of these.
export function importIssues(state) {
  const guests = state.guests.filter((g) => g.active !== false);
  const ambiguous = [];
  const groups = new Map();
  for (const g of guests) {
    if (g.deskOnly) continue;
    const m4 = g.lookup?.m4 || last4(g.mobile);
    if (!m4) continue;
    for (const s of g.lookup?.surnames || [canonSurname(g.name?.last)]) {
      const k = `${s}|${m4}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(g);
    }
  }
  const pairKeys = new Set();
  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const [a, b] = [list[i], list[j]];
      if (a.email && b.email) continue; // both can verify with their full email instead
      const k = [a.id, b.id].sort().join('|');
      if (!pairKeys.has(k)) pairKeys.add(k), ambiguous.push([a.id, b.id]);
    }
  }
  const noContact = guests.filter((g) => !g.deskOnly && !last4(g.mobile) && !g.email).map((g) => g.id);
  const duplicates = [];
  const seenName = new Map();
  const seenEmail = new Map();
  for (const g of guests) {
    const nk = `${canonSurname(g.name?.last)}|${canonSurname(g.name?.first)}|${(g.company || '').toLowerCase()}`;
    const other = seenName.get(nk) || (g.email && seenEmail.get(g.email));
    if (other) duplicates.push([other.id, g.id]);
    seenName.set(nk, g);
    if (g.email) seenEmail.set(g.email, g);
  }
  const unknownIndustry = guests.filter((g) => g.industryText && !g.industryId).map((g) => g.id);
  return { ambiguous, noContact, duplicates, unknownIndustry, total: ambiguous.length + noContact.length + duplicates.length + unknownIndustry.length };
}

// ----- Export customapp.event/1 -----
// Everything about the event that a recovery needs: the event, its tables, every guest with their
// seat claim (reserved and confirmed), the change log and the outbox. Status tokens, lookup keys,
// per-device flags and invitation link hashes (and sealed links waiting in the outbox) are left out. sha256 is the SHA-256 of this JSON with sha256 set to "".
const GUEST_EXPORT = ['id', 'ref', 'externalKey', 'name', 'designation', 'company', 'industryId', 'industryText', 'email', 'mobile', 'classification', 'tags', 'rsvp', 'ownerUserId', 'arrival', 'approval', 'substituteFor', 'substitutedBy', 'groupId', 'seat', 'released', 'notify', 'deskOnly', 'altSurnames', 'active', 'rev'];
const EVENT_EXPORT = ['id', 'app', 'code', 'name', 'venue', 'date', 'status', 'superAdminUserId', 'staff', 'industries', 'settings', 'window', 'flags', 'room', 'refPrefix', 'importAck', 'seq', 'rev', 'demo'];
const only = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

export function exportEvent({ event, tables, guests, changes = [], outbox = [] }, { now = new Date().toISOString() } = {}) {
  const out = {
    format: EXPORT_FORMAT, exportedAt: now, eventId: event.id, seq: event.seq || 0, sha256: '',
    event: only(event, EVENT_EXPORT),
    tables: [...tables].sort((a, b) => a.number - b.number).map((t) => only(t, ['id', 'number', 'classification', 'capacity', 'ownerUserId', 'tags', 'active', 'row', 'col', 'rev'])),
    // The invitation's state and the guest's answer (0.74, optional fields), never the link's hash.
    guests: [...guests].sort((a, b) => String(a.ref).localeCompare(String(b.ref))).map((g) => ({ ...only(g, GUEST_EXPORT), ...(g.rsvpReply ? { rsvpReply: g.rsvpReply } : {}), ...(g.invite ? { invite: (({ hash, ...rest }) => rest)(g.invite) } : {}) })),
    changes: changes.map((c) => ({ ...c })),
    // A sealed invitation link waiting to be emailed never leaves the server (0.74).
    outbox: outbox.map(({ tokenSealed, ...m }) => ({ ...m })),
  };
  out.sha256 = exportHash(out);
  return out;
}
// The event's export as the routes and the 5-minute copies make it (the same function for both).
export const eventExport = (db, ev, now) => exportEvent({ event: ev, tables: (db.data.caTables || []).filter((t) => t.eventId === ev.id), guests: (db.data.caGuests || []).filter((g) => g.eventId === ev.id), changes: (db.data.caChanges || []).filter((c) => c.eventId === ev.id), outbox: (db.data.caOutbox || []).filter((m) => m.eventId === ev.id) }, { now });
export const exportHash = (exp) => createHash('sha256').update(JSON.stringify({ ...exp, sha256: '' })).digest('hex');

// ----- CSV, from the export -----
// A cell a spreadsheet would run as a formula (= + - @, tab, return) starts with ' so it opens as text.
export function csvCell(v) {
  let t = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r']/.test(t) || t !== t.trim() ? `"${t.replace(/"/g, '""')}"` : t;
}
const csv = (rows) => `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

export function exportCsv(exp, kind = 'guests', { names = {} } = {}) {
  const tables = new Map(exp.tables.map((t) => [t.id, t]));
  const industries = new Map((exp.event.industries || []).map((i) => [i.id, i.name]));
  const arrival = (g) => ({ expected: 'Expected', checked_in: 'Checked in', cancelled: 'Cancelled' })[g.arrival?.state] || '';
  if (kind === 'seating') {
    const rows = [['Table', 'Seat', 'Ref', 'Name', 'Company', 'Class', 'Status', 'Arrived']];
    const seated = exp.guests.filter((g) => g.seat).sort((a, b) => (tables.get(a.seat.tableId)?.number ?? 0) - (tables.get(b.seat.tableId)?.number ?? 0) || (a.seat.seatNo ?? 99) - (b.seat.seatNo ?? 99));
    for (const g of seated) rows.push([tables.get(g.seat.tableId)?.number ?? '', g.seat.seatNo ?? '', g.ref, g.name?.display, g.company, CLASS_LABELS[g.classification], SEAT_LABELS[g.seat.status] || g.seat.status, arrival(g)]);
    return csv(rows);
  }
  const rows = [['Ref', 'First name', 'Surname', 'Designation', 'Company', 'Industry', 'Class', 'RSVP', 'Email', 'Mobile', 'Owner', 'Arrival', 'Checked in at', 'Table', 'Seat', 'Seat status', 'Desk only']];
  for (const g of exp.guests) {
    rows.push([g.ref, g.name?.first, g.name?.last, g.designation, g.company, industries.get(g.industryId) || g.industryText || '', CLASS_LABELS[g.classification], g.rsvp, g.email, g.mobile, names[g.ownerUserId] || '', arrival(g), g.arrival?.at ? fmtManila(g.arrival.at) : '', g.seat ? tables.get(g.seat.tableId)?.number ?? '' : '', g.seat?.seatNo ?? '', g.seat ? SEAT_LABELS[g.seat.status] || g.seat.status : '', g.deskOnly ? 'Yes' : '']);
  }
  return csv(rows);
}

// ----- The printable seating plan, from the export -----
// One page of HTML that prints cleanly (black on white, a table per block, never split across
// pages), stamped with the time it was made: the room drawn as on the room plan (the same geometry,
// shared/customapp/room.js: the stage and tech booth where they are, every table where it stands,
// numbered from the stage, and its chairs 1 to N clockwise from the one facing the stage), in black
// and white: an open chair is a white circle with its number, a reserved chair is hatched, a seated
// guest's chair is black with a white number. Then every table with its chairs.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function roomSvg(exp) {
  const room = exp.event.room;
  const tables = exp.tables.filter((t) => t.active !== false);
  if (!tables.length) return '';
  const G = ROOM_DRAW;
  const geo = roomGeometry(room, tables);
  const at = new Map();
  for (const g of exp.guests) if (g.seat?.tableId && g.seat.seatNo) at.set(`${g.seat.tableId}:${g.seat.seatNo}`, g.seat.status);
  const zone = (z, label) => {
    const cx = z.x + z.w / 2;
    const cy = z.y + z.h / 2;
    return `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="9" fill="#fff" stroke="#000" stroke-width="2"/><text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="18" font-weight="700" letter-spacing="3"${z.rot ? ` transform="rotate(${z.rot} ${cx} ${cy})"` : ''}>${label}</text>`;
  };
  let out = `<svg class="roomsvg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${geo.w} ${geo.h}" role="img" aria-label="Room plan: ${tables.length} tables${room ? `, stage on the ${room.stageSide}` : ''}" font-family="Arial, Helvetica, sans-serif">`;
  out += '<defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#fff"/><rect width="2" height="5" fill="#000"/></pattern></defs>';
  if (room) out += zone(geo.booth, 'TECH BOOTH') + zone(geo.stage, 'STAGE');
  for (const t of tables) {
    const [x, y] = geo.pos.get(t.id);
    const c = tableCounts(t, exp.guests);
    out += `<g class="t" data-n="${t.number}"><circle cx="${x}" cy="${y}" r="${G.tableR}" fill="#fff" stroke="#000" stroke-width="${t.classification === 'preferred' ? 4 : 2}"${t.classification === 'employee' ? ' stroke-dasharray="6 4"' : ''}/>`;
    out += `<text x="${x}" y="${y + 2}" text-anchor="middle" font-size="22" font-weight="700">${t.number}</text><text x="${x}" y="${y + 18}" text-anchor="middle" font-size="10">${c.free < 1 ? 'FULL' : `${c.claims}/${t.capacity}`}</text>`;
    for (let n = 1; n <= t.capacity; n++) {
      const [cx, cy] = chairPoint(room, t.capacity, n, x, y).map((v) => v.toFixed(1));
      const st = at.get(`${t.id}:${n}`);
      out += `<circle class="c${st ? ` ${st}` : ''}" cx="${cx}" cy="${cy}" r="${G.chairR + 1.5}" fill="${st === 'confirmed' ? '#000' : st === 'reserved' ? 'url(#hatch)' : '#fff'}" stroke="#000" stroke-width="1.4"/>`;
      out += `<text x="${cx}" y="${(Number(cy) + 3.6).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700"${st === 'confirmed' ? ' fill="#fff"' : st === 'reserved' ? ' fill="#000" stroke="#fff" stroke-width="2.5" paint-order="stroke"' : ''}>${n}</text>`;
    }
    out += '</g>';
  }
  return `${out}</svg>`;
}
const LEGEND = '<p class="legend"><span class="k open"></span> Open chair <span class="k res"></span> Reserved (not arrived) <span class="k seat"></span> Seated · a thick table edge is a preferred table, a dashed one an employee table · chair 1 faces the stage, chairs run clockwise</p>';

const STYLE = `body{font:13px/1.35 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#000;background:#fff;margin:16px}
h1{font-size:20px;margin:0}h2{font-size:15px;margin:16px 0 6px}h3{font-size:14px;margin:0 0 4px}h3 span{font-weight:normal;font-size:12px}
.stamp{font-size:12px;margin:2px 0 12px}.small,.sides,.legend{font-size:11px;margin:4px 0}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #000;padding:2px 6px;text-align:left;vertical-align:top}th{background:#eee}
td.n{width:3em;text-align:center}td.box{width:4.5em}
.roomsvg{width:100%;height:auto;max-height:180mm;display:block}
.k{display:inline-block;width:10px;height:10px;border:1px solid #000;border-radius:50%;vertical-align:-1px;margin-left:8px}.k.res{background:repeating-linear-gradient(45deg,#000 0 1px,#fff 1px 3px)}.k.seat{background:#000}
.tables{columns:2 340px;column-gap:16px}.tbl{break-inside:avoid;margin:0 0 12px}
.sheet{break-before:page}.sheet:first-of-type{break-before:auto}thead .st th{background:#fff;border:0;border-bottom:2px solid #000;font-weight:normal;font-size:11px;padding:0 0 4px}
.card{border:2px solid #000;padding:12px 16px;margin:12px 0;break-inside:avoid}.card p{font-size:16px;margin:6px 0}
@page room{size:A4 landscape;margin:10mm}.roompage{page:room}
@media print{body{margin:0}@page{margin:12mm}.tables{columns:2}a{color:#000}}`;

export function planHtml(exp, { names = {}, now = exp.exportedAt } = {}) {
  const ev = exp.event;
  const room = ev.room;
  const stamp = fmtManila(now);
  const guestsAt = (t) => exp.guests.filter((g) => g.seat?.tableId === t.id);
  let grid = '';
  if (room || exp.tables.length) {
    const side = (s) => (room?.stageSide === s ? 'Stage' : room?.boothSide === s ? 'Tech booth' : '');
    grid = `<section class="room roompage"><h2>Room</h2>${room ? `<p class="sides">${['top', 'left', 'right', 'bottom'].filter(side).map((s) => `${side(s)}: ${s}`).join(' · ')}</p>` : ''}${roomSvg(exp)}${LEGEND}<p class="small">Tables are numbered from the stage; chair 1 faces the stage and chairs run clockwise. The same drawing as the room plan on screen.</p></section>`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(ev.name)}: seating plan</title><style>
${STYLE}
</style></head><body><h1>${esc(ev.name)}: seating plan</h1><p class="stamp">As of ${esc(stamp)} · seq ${exp.seq} · ${exp.guests.filter((g) => g.seat).length} seats claimed of ${exp.tables.filter((t) => t.active !== false).reduce((n, t) => n + t.capacity, 0)}</p>${grid}<section><h2>Tables</h2><div class="tables">${tableBlocks(exp, names, guestsAt)}</div></section></body></html>`;
}
function tableBlocks(exp, names, guestsAt) {
  return exp.tables.filter((t) => t.active !== false).map((t) => {
    const at = guestsAt(t);
    const c = tableCounts(t, exp.guests);
    const bySeat = new Map(at.filter((g) => g.seat.seatNo).map((g) => [g.seat.seatNo, g]));
    const rows = Array.from({ length: t.capacity }, (_, i) => {
      const g = bySeat.get(i + 1);
      return `<tr><td class="n">${i + 1}</td><td>${g ? esc(g.name?.display) : ''}</td><td>${g ? esc(g.company) : ''}</td><td>${g ? esc(SEAT_LABELS[g.seat.status] || g.seat.status) : 'Free'}</td></tr>`;
    }).join('') + at.filter((g) => !g.seat.seatNo).map((g) => `<tr><td class="n">–</td><td>${esc(g.name?.display)}</td><td>${esc(g.company)}</td><td>${esc(SEAT_LABELS[g.seat.status] || g.seat.status)}</td></tr>`).join('');
    return `<section class="tbl"><h3>Table ${t.number} <span>${esc(CLASS_LABELS[t.classification])}${t.ownerUserId ? ` · ${esc(names[t.ownerUserId] || '')}` : ''} · ${c.confirmed} seated · ${c.reserved} reserved · ${c.free} free</span></h3><table><thead><tr><th>Seat</th><th>Guest</th><th>Company</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  }).join('');
}

// ----- The offline pack (US-025): what the desk works from if CORE cannot be reached -----
// From the same export v1: the room drawing, an A–Z list of every guest with their seat, one sheet
// per table and one per staff member (their guests and tables), and the desk and easel cards. Every
// printed page carries "as of HH:MM" (each sheet is a table whose heading row repeats on every
// page), so nobody works from an older sheet without knowing. Staff write each check-in and seat
// on their own sheet with the time; the Super Administrator enters them afterwards (Reconcile paper
// seating), through the same commands, so paper can never overbook a table.
export function packHtml(exp, { names = {}, now = exp.exportedAt, standby = '' } = {}) {
  const ev = exp.event;
  const asOf = `as of ${fmtManila(now, { date: false })}`;
  const tables = new Map(exp.tables.map((t) => [t.id, t]));
  const active = exp.guests.filter((g) => g.active !== false && !(g.classification === 'unlisted' && g.approval?.state !== 'approved'));
  const ownerName = (id) => (id ? names[id] || 'Former staff' : 'No owner (Super Administrator)');
  const status = (g) => (g.seat ? SEAT_LABELS[g.seat.status] || g.seat.status : g.arrival?.state === 'checked_in' ? 'Waiting for a table' : g.arrival?.state === 'cancelled' ? 'Not coming' : 'Not arrived');
  const seatOf = (g) => (g.seat ? [tables.get(g.seat.tableId)?.number ?? '', g.seat.seatNo ?? ''] : ['', '']);
  const cls = (g) => esc(CLASS_LABELS[seatClassOf(g)] || CLASS_LABELS[g.classification] || '');
  const head = (title, cols) => `<thead><tr class="st"><th colspan="${cols.length}">${esc(ev.name)} · ${esc(title)} · <strong>${esc(asOf)}</strong> · seq ${exp.seq}</th></tr><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead>`;
  const byName = (a, b) => String(a.name?.last || '').localeCompare(String(b.name?.last || '')) || String(a.name?.first || '').localeCompare(String(b.name?.first || ''));
  const guestRow = (g) => {
    const [tn, sn] = seatOf(g);
    return `<tr><td>${esc(g.name?.last)}, ${esc(g.name?.first)}</td><td>${esc(g.company)}</td><td>${cls(g)}</td><td>${esc(ownerName(g.ownerUserId))}</td><td class="n">${tn}</td><td class="n">${sn}</td><td>${esc(status(g))}</td><td class="box"></td><td class="box"></td></tr>`;
  };
  const COLS = ['Guest', 'Company', 'Class', 'Owner', 'Table', 'Seat', 'Status', 'Arrived (time)', 'Seated at'];
  const az = `<section class="sheet" data-sheet="az"><table>${head('A–Z guest list', COLS)}<tbody>${[...active].sort(byName).map(guestRow).join('')}</tbody></table></section>`;
  const perTable = exp.tables.filter((t) => t.active !== false).map((t) => {
    const at = exp.guests.filter((g) => g.seat?.tableId === t.id);
    const c = tableCounts(t, exp.guests);
    const bySeat = new Map(at.filter((g) => g.seat.seatNo).map((g) => [g.seat.seatNo, g]));
    const rows = Array.from({ length: t.capacity }, (_, i) => {
      const g = bySeat.get(i + 1);
      return `<tr><td class="n">${i + 1}</td><td>${g ? esc(g.name?.display) : ''}</td><td>${g ? esc(g.company) : ''}</td><td>${g ? esc(SEAT_LABELS[g.seat.status] || g.seat.status) : 'Free'}</td><td class="box"></td></tr>`;
    }).join('') + at.filter((g) => !g.seat.seatNo).map((g) => `<tr><td class="n">–</td><td>${esc(g.name?.display)}</td><td>${esc(g.company)}</td><td>${esc(SEAT_LABELS[g.seat.status] || g.seat.status)}</td><td class="box"></td></tr>`).join('');
    return `<section class="sheet" data-sheet="table-${t.number}"><table>${head(`Table ${t.number} · ${CLASS_LABELS[t.classification]} · ${ownerName(t.ownerUserId)} · ${c.confirmed} seated, ${c.reserved} reserved, ${c.free} free`, ['Chair', 'Guest', 'Company', 'Status', 'Written in (name, time)'])}<tbody>${rows}</tbody></table></section>`;
  }).join('');
  const owners = [...new Set([...(ev.staff || []).filter((s) => s.active !== false).map((s) => s.userId), ...exp.guests.map((g) => g.ownerUserId || null), ...exp.tables.map((t) => t.ownerUserId || null)])];
  const perStaff = owners.map((uid) => {
    const mine = active.filter((g) => (g.ownerUserId || null) === uid).sort(byName);
    const tbls = exp.tables.filter((t) => (t.ownerUserId || null) === uid && t.active !== false).map((t) => `${t.number} (${tableCounts(t, exp.guests).free} free)`);
    if (!mine.length && !tbls.length) return '';
    return `<section class="sheet" data-sheet="staff-${esc(uid || 'none')}"><table>${head(`${ownerName(uid)} · tables ${tbls.join(', ') || 'none'}`, COLS)}<tbody>${mine.map(guestRow).join('') || `<tr><td colspan="${COLS.length}">No guests.</td></tr>`}</tbody></table><p class="small">Seat only at your own tables. Write each arrival and seat with the time; the Super Administrator enters them when CORE is back.</p></section>`;
  }).join('');
  const room = `<section class="sheet roompage" data-sheet="room"><table>${head('Room', [''])}<tbody><tr><td style="border:0;padding:0">${roomSvg(exp)}${LEGEND}</td></tr></tbody></table></section>`;
  const cards = `<section class="sheet" data-sheet="cards"><table>${head('Cards', [''])}<tbody><tr><td style="border:0;padding:0">
    <div class="card"><p><strong>Easel card (under the QR code)</strong></p><p>If this page doesn't open, please go to the registration desk.</p></div>
    <div class="card"><p><strong>Staff desk card</strong></p><p>Standby address: ${standby ? esc(standby) : '________________________________'}</p><p>If the app restarts you'll be signed out. Sign in again and you'll land back on your queue.</p><p>If CORE cannot be reached: use this pack. Seat only at your own tables, and write each arrival and seat with the time.</p></div></td></tr></tbody></table></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(ev.name)}: offline pack</title><style>
${STYLE}
</style></head><body><h1>${esc(ev.name)}: offline pack</h1><p class="stamp">Printed ${esc(asOf)} (${esc(fmtManila(now))}) · seq ${exp.seq} · ${active.length} guests · ${exp.guests.filter((g) => g.seat).length} seats claimed</p>${room}${az}${perTable}${perStaff}${cards}</body></html>`;
}
