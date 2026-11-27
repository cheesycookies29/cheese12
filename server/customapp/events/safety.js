// CUSTOM APP → events: the two safety nets of the event night (US-020, design O4).
//  - Every 5 minutes, the export customapp.event/1 of each live event is written to
//    data/backups/events/ by the same function as the download (io.js eventExport), with its seq
//    and sha256, keeping the last 24 per event: at most 5 minutes of data at risk on the box.
//  - Every 60 seconds, checkInvariants() runs over each live event (the same function commit(), the
//    fuzz test and GET …/invariants use). A violation goes to the Security monitor (a check that
//    turns red), to the audit log once, and to the event's health strip on Event control.
// Both run outside commit() and never change the event.
import fs from 'node:fs';
import path from 'node:path';
import { checkInvariants } from '../../../shared/customapp/invariants.js';
import { eventsOf, stateOf } from './model.js';
import { eventExport } from './io.js';

export const SAFETY = Object.freeze({ copyEveryMs: 5 * 60000, keep: 24, checkEveryMs: 60000 });

export function createSafety(db, { now = () => Date.now(), audit = null, dir = null } = {}) {
  const copies = new Map(); // eventId → { at, file, seq, sha256 }
  const checks = new Map(); // eventId → { at, seq, violations }
  const folder = () => dir || path.join(db.dir, 'backups', 'events');
  const live = () => eventsOf(db).filter((ev) => ev.status === 'live');

  // One copy of each live event, then the oldest beyond 24 removed (per event).
  function writeCopies() {
    const out = [];
    const base = folder();
    for (const ev of live()) {
      try {
        fs.mkdirSync(base, { recursive: true, mode: 0o700 });
        const at = new Date(now()).toISOString();
        const exp = eventExport(db, ev, at);
        const stamp = at.replace(/[-:]/g, '').replace(/\.(\d+)Z$/, '$1Z');
        let file = path.join(base, `${ev.code}-${stamp}-seq${exp.seq}.json`);
        for (let n = 2; fs.existsSync(file); n++) file = path.join(base, `${ev.code}-${stamp}-seq${exp.seq}-${n}.json`);
        fs.writeFileSync(file, JSON.stringify(exp), { mode: 0o600 });
        // Named by time (YYYYMMDDTHHMMSSmmmZ), so the name order is the time order.
        const mine = fs.readdirSync(base).filter((f) => f.startsWith(`${ev.code}-`) && /^\d{8}T\d{9}Z-seq\d+(-\d+)?\.json$/.test(f.slice(ev.code.length + 1))).sort().map((f) => ({ f }));
        for (const old of mine.slice(0, Math.max(0, mine.length - SAFETY.keep))) fs.rmSync(path.join(base, old.f), { force: true });
        const rec = { at, file: path.basename(file), seq: exp.seq, sha256: exp.sha256 };
        copies.set(ev.id, rec);
        out.push({ eventId: ev.id, ...rec });
      } catch (err) {
        console.error(`CUSTOM APP: the 5-minute copy of ${ev.name} was not written:`, err.message);
        copies.set(ev.id, { ...(copies.get(ev.id) || {}), error: err.message, errorAt: new Date(now()).toISOString() });
      }
    }
    return out;
  }

  // The rules over each live event; a new violation is written to the audit log once.
  function selfCheck() {
    const out = [];
    for (const ev of live()) {
      const violations = checkInvariants(stateOf(db, ev));
      const before = checks.get(ev.id);
      const rec = { at: new Date(now()).toISOString(), seq: ev.seq || 0, violations };
      checks.set(ev.id, rec);
      if (violations.length && !before?.violations?.length && audit) {
        try {
          audit.record('customapp.selfcheck', { entity: 'caEvent', entityId: ev.id, label: ev.name, note: `${violations.length} rule${violations.length === 1 ? '' : 's'} broken at seq ${rec.seq}: ${violations.map((v) => `${v.rule} ${v.detail}`).join(' ').slice(0, 380)}` });
        } catch {}
      }
      out.push({ eventId: ev.id, ...rec });
    }
    return out;
  }

  // What Event control's health strip shows for one event.
  const health = (eventId) => ({ copy: copies.get(eventId) || null, check: checks.get(eventId) || null });

  // The Security monitor's check: one line per live event.
  const monitorCheck = () => live().map((ev) => {
    const c = checks.get(ev.id);
    const copy = copies.get(ev.id);
    const bad = c?.violations?.length;
    return {
      id: `customapp-${ev.id}`, area: 'software', label: `Event ${ev.name}: seating rules`,
      state: bad ? 'bad' : c ? 'ok' : 'info',
      detail: `${bad ? `${bad} rule${bad === 1 ? '' : 's'} broken: ${c.violations.map((v) => v.detail).join(' ').slice(0, 200)}` : c ? `All rules hold (checked ${c.at.slice(11, 19)} UTC, seq ${c.seq}).` : 'Not checked yet.'}${copy?.at ? ` Newest 5-minute copy ${copy.at.slice(11, 19)} UTC.` : ''}`,
      href: '/#/customapp/control',
    };
  });

  let timers = [];
  return {
    writeCopies, selfCheck, health, monitorCheck,
    start() {
      timers = [setInterval(writeCopies, SAFETY.copyEveryMs), setInterval(selfCheck, SAFETY.checkEveryMs)];
      for (const t of timers) t.unref?.();
    },
    stop() {
      for (const t of timers) clearInterval(t);
      timers = [];
    },
  };
}
