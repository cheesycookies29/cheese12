// CUSTOM APP → Events (0.71, Tier 0: staff-only seating), the pages:
//  - customappHomeView (/customapp): the events this account is part of, and New event for those who
//    manage events.
//  - findGuestView (/customapp/find): Find guest, by part of a name, company or ref; tapping a guest
//    opens their sheet: Check in, then a table and a chair (two taps on a phone), Move, Send back to
//    waiting, Release a reservation.
//  - tablesView (/customapp/tables): every table with its meter ("6 seated · 2 reserved · 2 free").
//  - eventControlView (/customapp/control): the counts, the switches, the exports and the printable
//    plan, the rule check, and handing over the Super Administrator.
//  - eventSetupView (/customapp/setup): event details, the room, tables, industries, staff, the guest list
//    import and the import check.
// Every change is one command to the server (server/customapp/events), which decides: nothing is
// shown as done before it answers, and a refusal redraws the sheet from the state in its reply.
import { api } from '../api.js';
import { ctx, can } from '../state.js';
import { html, mount, modal, toast, confirmDialog, badge } from '../ui.js';
import { icon } from '../icons.js';
import { CLASS_LABELS, FLAG_LABELS, STAGE_SIDES } from '/shared/customapp/statuses.js';
import { fmtManila, toManilaInput } from '/shared/customapp/time.js';

const STORE = 'core-ca-event';
const opId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const option = (v, l, sel) => html`<option value="${v}" ${sel ? 'selected' : ''}>${l}</option>`;
const clock = (iso) => (iso ? fmtManila(iso, { date: false }) : '');
const arrivalText = (g) => (g.arrival?.state === 'checked_in' ? `Checked in ${clock(g.arrival.at)}` : g.arrival?.state === 'cancelled' ? 'Cancelled' : 'Not arrived');
const ROLE_TEXT = { super: 'Super Administrator', staff: 'Staff', manager: 'Administrator (no seating)' };

// The event the pages are about: ?e=…, else the last one chosen on this device, else the first.
async function pickEvent(query) {
  const { events, canCreate } = await api.get('/api/customapp/events');
  let id = query.e;
  try {
    id ||= localStorage.getItem(STORE);
  } catch {}
  if (!events.some((e) => e.id === id)) id = events[0]?.id || null;
  try {
    if (id) localStorage.setItem(STORE, id);
  } catch {}
  return { events, canCreate, id };
}
const noEvent = (canCreate) => html`<div class="card empty">${icon('party', 40)}<h2>No event yet</h2><p>${canCreate ? 'Create the event first, under Events.' : 'When the event\'s Super Administrator adds you to its staff, it shows here.'}</p>${canCreate ? html`<p><a class="btn primary" href="#/customapp">${icon('plus', 16)} Events</a></p>` : ''}</div>`;
// The page head: the event's name, and a switcher when this account is part of several.
function head(title, ev, events, sub = '') {
  return html`<header class="page-head ca-head">
    <div><h1>${title}</h1><p class="muted">${ev.name}${ev.demo ? ' (demo)' : ''} · ${ROLE_TEXT[ev.role] || ''}${sub ? ` · ${sub}` : ''}</p></div>
    ${events.length > 1 ? html`<label class="field ca-switch-ev"><span class="sr-only">Event</span><select data-event aria-label="Event">${events.map((e) => option(e.id, e.name, e.id === ev.id))}</select></label>` : ''}
  </header>`;
}
function wireSwitcher(el, path) {
  el.querySelector('[data-event]')?.addEventListener('change', (e) => {
    location.hash = `#${path}?e=${encodeURIComponent(e.target.value)}`;
  });
}

// The meter: one dot per chair, filled for a seated guest, a ring for a reservation, and the same in
// words beside it (colour is never the only sign).
function meter(t) {
  const dots = [];
  for (let i = 0; i < t.capacity; i++) dots.push(i < t.confirmed ? 'on' : i < t.confirmed + t.reserved ? 'res' : '');
  return html`<span class="ca-meter" aria-hidden="true">${dots.map((d) => html`<i class="${d}"></i>`)}</span><span class="ca-count">${t.confirmed} seated · ${t.reserved} reserved · ${t.free} free</span>`;
}
const statusBadge = (g) => {
  if (g.seat) return badge(`${g.seat.status === 'reserved' ? 'Reserved' : 'Seated'}: T${g.seat.number}${g.seat.seatNo ? ` S${g.seat.seatNo}` : ''}`, g.seat.status === 'reserved' ? 'blue' : 'green');
  if (g.arrival?.state === 'checked_in') return badge('Waiting for a table', 'amber');
  return badge('Not arrived', 'gray');
};

// ----- Events -----
export async function customappHomeView(el) {
  const { events, canCreate } = await api.get('/api/customapp/events');
  mount(el, html`<header class="page-head"><div><h1>${icon('party', 22)} Events</h1><p class="muted">The events you are part of. Choose one to find guests, check them in and seat them.</p></div>
      ${canCreate ? html`<div class="actions"><button type="button" class="btn primary" id="ca-new">${icon('plus', 16)} New event</button></div>` : ''}</header>
    ${events.length ? html`<div class="ca-events">${events.map((e) => html`<a class="card ca-event" href="#/customapp/find?e=${e.id}" data-ev="${e.id}">
        <span class="ca-event-top"><strong>${e.name}</strong>${badge({ draft: 'Draft', live: 'Live', closed: 'Closed', archived: 'Archived' }[e.status] || e.status, e.status === 'live' ? 'green' : 'gray')}${e.demo ? badge('Demo', 'amber') : ''}</span>
        <small class="muted">${[e.date, e.venue].filter(Boolean).join(' · ')}</small>
        <small>You: ${ROLE_TEXT[e.role]}${e.role === 'super' ? '' : ` · Super Administrator: ${e.superAdmin || 'nobody'}`}</small>
        <small>${e.counts.invited} invited · ${e.counts.checkedIn} checked in · ${e.counts.waiting} waiting · ${e.counts.seatsLeft} of ${e.counts.capacity} seats left</small>
      </a>`)}</div>` : noEvent(canCreate)}`);
  el.querySelectorAll('[data-ev]').forEach((a) => a.addEventListener('click', () => {
    try {
      localStorage.setItem(STORE, a.dataset.ev);
    } catch {}
  }));
  el.querySelector('#ca-new')?.addEventListener('click', () => modal({
    title: 'New event',
    subtitle: 'Its tables are made from the room: numbered from the stage, chairs 1 to N clockwise from the one facing the stage.',
    body: html`<label class="field"><span>Name <em>*</em></span><input name="name" required maxlength="120" /></label>
      <div class="ca-pair"><label class="field"><span>Date</span><input type="date" name="date" /></label><label class="field"><span>Venue</span><input name="venue" maxlength="160" /></label></div>
      <div class="ca-pair"><label class="field"><span>Rows of tables</span><input type="number" name="rows" min="1" max="20" value="5" /></label><label class="field"><span>Columns of tables</span><input type="number" name="cols" min="1" max="20" value="5" /></label></div>
      <div class="ca-pair"><label class="field"><span>Chairs per table (at most 10)</span><input type="number" name="chairs" min="1" max="10" value="10" /></label><label class="field"><span>Stage on the</span><select name="stage">${STAGE_SIDES.map((s) => option(s, s, s === 'right'))}</select></label></div>
      <p class="muted small">You become its Super Administrator; an administrator can hand that over later.</p>`,
    submitLabel: 'Create event',
    onSubmit: async (f) => {
      const ev = await api.post('/api/customapp/events', { name: f.name.value, date: f.date.value, venue: f.venue.value, room: { rows: Number(f.rows.value), cols: Number(f.cols.value), chairsPerTable: Number(f.chairs.value), stageSide: f.stage.value } });
      toast(`${ev.name} created with ${ev.tables.length} tables.`);
      location.hash = `#/customapp/setup?e=${ev.id}`;
    },
  }));
}

// ----- Find guest, and the guest sheet -----
export async function findGuestView(el, params, query) {
  const { events, canCreate, id } = await pickEvent(query);
  if (!id) return mount(el, noEvent(canCreate));
  const ev = await api.get(`/api/customapp/events/${id}`);
  if (ev.role === 'manager') return mount(el, html`${head(html`${icon('search', 22)} Find guest`, ev, events)}<div class="card empty">${icon('lock', 40)}<h2>Not on this event's staff</h2><p>As an administrator you can hand over the Super Administrator under Event control; guests and tables are the event staff's.</p></div>`);
  let status = query.status || '';
  let mine = false;
  mount(el, html`${head(html`${icon('search', 22)} Find guest`, ev, events)}
    <div class="stats small ca-strip" id="ca-strip"></div>
    <div class="ca-search"><input type="search" id="ca-q" placeholder="Name, company or ref" aria-label="Find a guest by name, company or ref" autocomplete="off" enterkeyhint="search" /></div>
    <div class="chips ca-chips" role="group" aria-label="Show">
      ${[['', 'Everyone'], ['waiting', 'Waiting for a table'], ['expected', 'Not arrived'], ['seated', 'Seated'], ['reserved', 'Reserved']].map(([v, l]) => html`<button type="button" class="chip ${v === status ? 'on' : ''}" data-status="${v}" aria-pressed="${v === status}">${l}</button>`)}
      ${ev.role === 'staff' ? html`<button type="button" class="chip" data-mine aria-pressed="false">Mine only</button>` : ''}
    </div>
    <div id="ca-results" class="card ca-results" aria-live="polite"></div>`);
  wireSwitcher(el, '/customapp/find');
  const strip = (c) => mount(el.querySelector('#ca-strip'), html`<div><small>Checked in</small><strong>${c.checkedIn}</strong></div><div><small>Waiting</small><strong>${c.waiting}</strong></div><div><small>Not arrived</small><strong>${c.notArrived}</strong></div><div><small>Seats left</small><strong>${c.seatsLeft}</strong></div>`);
  strip(ev.counts);
  let timer = 0;
  let seq = 0;
  async function search() {
    const n = ++seq;
    const q = el.querySelector('#ca-q').value.trim();
    const r = await api.get(`/api/customapp/events/${id}/guests?q=${encodeURIComponent(q)}&status=${status}${mine ? '&mine=1' : ''}&limit=60`);
    if (n !== seq) return;
    mount(el.querySelector('#ca-results'), r.guests.length ? html`<ul class="ca-list">${r.guests.map((g) => html`<li><button type="button" class="ca-guest" data-guest="${g.id}">
        <span class="grow"><strong>${g.displayName}</strong><small>${[g.company, g.industry].filter(Boolean).join(' · ')}</small></span>
        <span class="ca-tags">${badge(g.classLabel, g.classification === 'preferred' ? 'brand' : '')}${statusBadge(g)}</span>
      </button></li>`)}</ul>${r.total > r.guests.length ? html`<p class="muted small">${r.total - r.guests.length} more: type more of the name.</p>` : ''}`
      : html`<p class="muted ca-none">${q ? `No guest matches “${q}”. Check the spelling, try the company, or ask the Super Administrator about a walk-in.` : 'Nobody here.'}</p>`);
    el.querySelectorAll('[data-guest]').forEach((b) => b.addEventListener('click', () => openGuest(id, b.dataset.guest, async () => {
      search();
      strip((await api.get(`/api/customapp/events/${id}`)).counts);
    })));
  }
  el.querySelector('#ca-q').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(search, 200);
  });
  el.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => {
    status = b.dataset.status;
    el.querySelectorAll('[data-status]').forEach((x) => {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    });
    search();
  }));
  el.querySelector('[data-mine]')?.addEventListener('click', (e) => {
    mine = !mine;
    e.currentTarget.classList.toggle('on', mine);
    e.currentTarget.setAttribute('aria-pressed', String(mine));
    search();
  });
  await search();
  if (query.guest) openGuest(id, query.guest, search);
  return () => clearTimeout(timer);
}

// The guest sheet: who they are, Check in, then Seat (a table, then a chair: the first free chair is
// already chosen, so it is two taps), or what can be done with the seat they have.
export function openGuest(eventId, guestId, onChange = () => {}) {
  const { form, close } = modal({ title: 'Guest', body: html`<div class="ca-sheet-body" aria-live="polite"><p class="muted">Loading…</p></div>`, submitLabel: null, className: 'ca-sheet' });
  const box = form.querySelector('.ca-sheet-body');
  const titleEl = form.querySelector('.modal-title h2');
  let notice = '';
  let mode = null; // null, or 'transfer' while choosing a new seat
  let chosen = null; // { tableId, seatNo }
  const send = async (cmd, done) => {
    try {
      await api.post(`/api/customapp/events/${eventId}/commands`, { ...cmd, opId: opId() });
      notice = '';
      mode = null;
      chosen = null;
      if (done) toast(done);
      onChange();
      await load();
    } catch (err) {
      // Refused: the sheet is drawn again from the state as it is now, saying what happened.
      if (!err.code) throw err;
      const t = err.fresh?.tables?.find((x) => x.id === cmd.tableId);
      notice = err.code === 'table_full' && t ? `Table ${t.number} just filled. Updated options:` : err.code === 'seat_taken' && t ? `Seat ${cmd.seatNo} at table ${t.number} was just taken. Choose another seat.` : err.message;
      chosen = null;
      onChange();
      await load();
    }
  };
  async function load() {
    const d = await api.get(`/api/customapp/events/${eventId}/guests/${guestId}`);
    const g = d.guest;
    titleEl.textContent = g.displayName;
    const here = g.arrival.state === 'checked_in';
    const tables = d.options;
    const mineT = tables.filter((t) => t.mine);
    const othersT = tables.filter((t) => !t.mine);
    const pickT = chosen && tables.find((t) => t.id === chosen.tableId);
    const choosing = d.canSeat && ((here && !g.seat && !d.releasedNeedsSuper) || mode === 'transfer');
    // The chosen table opens in place: its chairs (the first free one chosen) and Confirm, right under it.
    const chairs = (t) => html`<div class="ca-chairs" role="group" aria-label="Chairs at table ${t.number}">${Array.from({ length: t.capacity }, (_, i) => i + 1).map((n) => {
        const taken = t.taken.includes(n) && !(g.seat?.tableId === t.id && g.seat.seatNo === n);
        return html`<button type="button" class="ca-chair ${chosen.seatNo === n ? 'on' : ''}" data-chair="${n}" ${taken ? 'disabled' : ''} aria-pressed="${chosen.seatNo === n}" aria-label="Seat ${n}${taken ? ', taken' : ''}">${n}</button>`;
      })}</div>
      <button type="button" class="btn primary ca-big" data-confirm ${chosen.seatNo || d.seatNumbers === 'none' ? '' : 'disabled'}>${mode === 'transfer' ? 'Move' : 'Seat'} at Table ${t.number}${chosen.seatNo ? `, seat ${chosen.seatNo}` : ''}</button>`;
    const tableBtn = (t) => {
      const full = t.free < 1 && !(g.seat && g.seat.tableId === t.id);
      return html`<li><button type="button" class="ca-table ${chosen?.tableId === t.id ? 'on' : ''}" data-table="${t.id}" ${full || !t.mine ? 'disabled' : ''} aria-pressed="${chosen?.tableId === t.id}">
        <span class="ca-tno">Table ${t.number}</span><span class="grow">${meter(t)}<small>${CLASS_LABELS[t.classification]}${t.ownerName ? ` · ${t.ownerName}` : ''}${full ? ' · Full' : !t.mine ? ' · Not yours' : ''}</small></span></button>${pickT === t ? chairs(t) : ''}</li>`;
    };
    mount(box, html`
      <div class="ca-who"><span>${badge(g.classLabel, g.classification === 'preferred' ? 'brand' : '')} <span class="muted">${g.ref}</span></span>
        <p>${[g.designation, g.company].filter(Boolean).join(', ')}${g.industry ? html`<br><span class="muted">${g.industry}</span>` : ''}</p>
        ${g.mine ? html`<p class="muted small">${[g.mobile && `Mobile ${g.mobile}`, g.email && `Email ${g.email}`].filter(Boolean).join(' · ') || 'No mobile or email on the list'}${g.deskOnly ? ' · Desk only' : ''}</p>` : html`<p class="muted small">Not your guest: you can check them in; their owner or the Super Administrator seats them.</p>`}</div>
      ${notice ? html`<p class="ca-notice" role="alert">${icon('alert', 16)} ${notice}</p>` : ''}
      <section class="ca-step"><h3>Arrival</h3><p>${arrivalText(g)}</p>
        ${here ? (d.canSeat ? html`<button type="button" class="btn ghost small-btn" data-undo>Undo check-in</button>` : '') : html`<button type="button" class="btn primary ca-big" data-checkin>${icon('check', 18)} Check in</button>`}</section>
      <section class="ca-step"><h3>Seat</h3>
        ${g.seat ? html`<p class="ca-seat-now"><strong>Table ${g.seat.number}${g.seat.seatNo ? `, seat ${g.seat.seatNo}` : ''}</strong> ${badge(g.seat.status === 'reserved' ? 'Reserved' : 'Seated', g.seat.status === 'reserved' ? 'blue' : 'green')}</p>
            ${g.seat.status === 'reserved' && !here ? html`<p class="muted small">A reservation: it is kept until the guest arrives (checking in confirms it) or the Super Administrator releases it. It never runs out.</p>` : ''}
            ${d.canSeat && mode !== 'transfer' ? html`<div class="actions ca-actions">
              <button type="button" class="btn" data-move>${icon('repeat', 16)} Move</button>
              ${g.seat.status === 'confirmed' ? html`<button type="button" class="btn" data-unseat>Send back to waiting</button>` : ''}
              ${g.seat.status === 'reserved' && d.canRelease ? html`<button type="button" class="btn danger ghost" data-release>Release reservation</button>` : ''}</div>` : ''}`
        : d.releasedNeedsSuper ? html`<p class="ca-notice">${icon('flag', 16)} This guest's reservation was released. Refer them to the Super Administrator to be seated.</p>`
        : !here ? html`<p class="muted">Check the guest in first, then choose their table.</p>`
        : !d.canSeat ? html`<p class="muted">Waiting for a table. Their owner or the Super Administrator seats them.</p>` : ''}
        ${choosing ? html`<p class="small">${mode === 'transfer' ? 'Choose the new table, then the chair.' : 'Choose a table, then confirm the chair.'}</p>
          ${mineT.length ? html`<ul class="ca-tables">${mineT.map(tableBtn)}</ul>` : html`<p class="muted">None of your tables can take this guest. Refer them to the Super Administrator.</p>`}
          ${mode === 'transfer' ? html`<button type="button" class="btn ghost" data-cancel-move>Keep the current seat</button>` : ''}
          ${othersT.length ? html`<details class="ca-others"><summary>Other tables (not yours): ${othersT.length}</summary><ul class="ca-tables">${othersT.map(tableBtn)}</ul></details>` : ''}` : ''}
      </section>
      ${d.history.length ? html`<details class="ca-history"><summary>History (${d.history.length})</summary><ul>${d.history.map((h) => html`<li><span class="muted">${fmtManila(h.at)}</span> ${HISTORY[h.type] || h.type}, by ${h.by}${h.reason ? ` (${h.reason})` : ''}</li>`)}</ul></details>` : ''}`);
    const on = (sel, fn) => box.querySelectorAll(sel).forEach((b) => b.addEventListener('click', fn));
    on('[data-checkin]', () => send({ type: 'checkIn', guestId }, `${g.displayName} checked in.`));
    on('[data-undo]', async () => {
      if (await confirmDialog(`Undo ${g.displayName}'s check-in? They show as not arrived again${g.seat ? '; their chair stays reserved for them' : ''}.`, { confirmLabel: 'Undo check-in', danger: false })) send({ type: 'undoCheckIn', guestId, reason: 'Checked in by mistake' }, 'Check-in undone.');
    });
    on('[data-table]', (e) => {
      const t = tables.find((x) => x.id === e.currentTarget.dataset.table);
      const free = Array.from({ length: t.capacity }, (_, i) => i + 1).find((n) => !t.taken.includes(n));
      chosen = { tableId: t.id, seatNo: d.seatNumbers === 'none' && g.classification !== 'preferred' ? null : free || null };
      load();
    });
    on('[data-chair]', (e) => {
      chosen.seatNo = Number(e.currentTarget.dataset.chair);
      load();
    });
    on('[data-confirm]', () => {
      const t = tables.find((x) => x.id === chosen.tableId);
      if (mode === 'transfer') send({ type: 'transfer', guestId, tableId: t.id, seatNo: chosen.seatNo, expect: { [g.id]: g.rev } }, `${g.displayName} moved to table ${t.number}.`);
      else send({ type: 'assign', guestId, tableId: t.id, seatNo: chosen.seatNo, expect: { [g.id]: g.rev } }, `${g.displayName}: table ${t.number}${chosen.seatNo ? `, seat ${chosen.seatNo}` : ''}.`);
    });
    on('[data-move]', () => {
      mode = 'transfer';
      chosen = null;
      load();
    });
    on('[data-cancel-move]', () => {
      mode = null;
      chosen = null;
      load();
    });
    on('[data-unseat]', async () => {
      if (await confirmDialog(`Send ${g.displayName} back to waiting? Table ${g.seat.number}${g.seat.seatNo ? `, seat ${g.seat.seatNo}` : ''} becomes free.`, { confirmLabel: 'Send back to waiting' })) send({ type: 'unseat', guestId, reason: 'Sent back to waiting' }, `${g.displayName} is waiting for a table again.`);
    });
    on('[data-release]', () => modal({
      title: 'Release reservation',
      body: html`<p>Release table ${g.seat.number}${g.seat.seatNo ? `, seat ${g.seat.seatNo}` : ''}, reserved for <strong>${g.displayName}</strong>? The chair becomes free for someone else. If ${g.name.first} arrives later, they are referred to you to be seated.</p>
        <label class="field"><span>Reason <em>*</em></span><input name="reason" required maxlength="200" placeholder="e.g. No-show by 8:00 PM" /></label>`,
      submitLabel: 'Release',
      onSubmit: (f) => send({ type: 'release', guestId, reason: f.reason.value }, 'Reservation released.'),
    }));
    // Focus stays on what matters next: the Confirm button once a chair is chosen.
    const confirmBtn = box.querySelector('[data-confirm]:not([disabled])');
    confirmBtn?.focus({ preventScroll: true });
    confirmBtn?.scrollIntoView({ block: 'nearest' });
  }
  load().catch((err) => mount(box, html`<p class="form-error">${err.message}</p>`));
  return close;
}
const HISTORY = { checkIn: 'Checked in', selfCheckIn: 'Checked in on their phone', undoCheckIn: 'Check-in undone', assign: 'Seated', transfer: 'Moved', swap: 'Seats swapped', unseat: 'Sent back to waiting', reserve: 'Seat reserved', release: 'Reservation released', 'guest.update': 'Details changed', import: 'Imported', 'table.relocate': 'Moved with their table' };

// ----- Tables -----
export async function tablesView(el, params, query) {
  const { events, canCreate, id } = await pickEvent(query);
  if (!id) return mount(el, noEvent(canCreate));
  const ev = await api.get(`/api/customapp/events/${id}`);
  if (!ev.tables) return mount(el, html`${head(html`${icon('grid', 22)} Tables`, ev, events)}<div class="card empty"><p>Tables are for the event's staff.</p></div>`);
  let filter = query.filter || '';
  const draw = () => {
    const list = ev.tables.filter((t) => (filter === 'mine' ? t.mine : filter === 'room' ? t.active && t.free > 0 : true));
    mount(el.querySelector('#ca-grid'), list.length ? list.map((t) => html`<button type="button" class="card ca-tcard ${t.free < 1 ? 'full' : ''} ${t.active ? '' : 'off'}" data-t="${t.id}">
        <span class="ca-tcard-top"><strong>Table ${t.number}</strong>${t.free < 1 ? badge('Full', 'gray') : ''}${!t.active ? badge('Not in use', 'gray') : ''}${t.mine && ev.role === 'staff' ? badge('Yours', 'brand') : ''}</span>
        <small>${CLASS_LABELS[t.classification]}${t.ownerName ? ` · ${t.ownerName}` : ' · No owner'}</small>${meter(t)}</button>`) : html`<p class="muted">No table matches.</p>`);
    el.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => openTable(id, ev, ev.tables.find((t) => t.id === b.dataset.t))));
  };
  const total = ev.tables.filter((t) => t.active).reduce((a, t) => ({ c: a.c + t.confirmed, r: a.r + t.reserved, f: a.f + t.free }), { c: 0, r: 0, f: 0 });
  mount(el, html`${head(html`${icon('grid', 22)} Tables`, ev, events, `${total.c} seated · ${total.r} reserved · ${total.f} free`)}
    <div class="chips ca-chips" role="group" aria-label="Show">${[['', 'All tables'], ['room', 'With free chairs'], ...(ev.role === 'staff' ? [['mine', 'Mine']] : [])].map(([v, l]) => html`<button type="button" class="chip ${v === filter ? 'on' : ''}" data-f="${v}" aria-pressed="${v === filter}">${l}</button>`)}</div>
    <div class="ca-tgrid" id="ca-grid"></div>
    <p class="muted small page-note">A filled dot is a seated guest, a ring a reservation for a guest who has not arrived; both take the chair. Tables are numbered from the stage.</p>`);
  wireSwitcher(el, '/customapp/tables');
  el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.f;
    el.querySelectorAll('[data-f]').forEach((x) => {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    });
    draw();
  }));
  draw();
}
async function openTable(eventId, ev, t) {
  const r = await api.get(`/api/customapp/events/${eventId}/guests?table=${t.number}&limit=50`);
  const bySeat = new Map(r.guests.filter((g) => g.seat?.seatNo).map((g) => [g.seat.seatNo, g]));
  modal({
    title: `Table ${t.number}`,
    subtitle: `${CLASS_LABELS[t.classification]} · ${t.confirmed} seated · ${t.reserved} reserved · ${t.free} free${t.ownerName ? ` · ${t.ownerName}` : ''}`,
    body: html`<ol class="ca-chairlist">${Array.from({ length: t.capacity }, (_, i) => i + 1).map((n) => {
      const g = bySeat.get(n);
      return html`<li><span class="ca-cn">${n}</span>${g ? html`<button type="button" class="link-btn" data-g="${g.id}">${g.displayName}</button> <small class="muted">${g.company}</small> ${badge(g.seat.status === 'reserved' ? 'Reserved' : 'Seated', g.seat.status === 'reserved' ? 'blue' : 'green')}` : html`<span class="muted">Free</span>`}</li>`;
    })}</ol>${r.guests.filter((g) => !g.seat?.seatNo).map((g) => html`<p>${g.displayName} (no chair number)</p>`)}`,
    submitLabel: null,
  }).form.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => openGuest(eventId, b.dataset.g)));
}

// ----- Event control -----
const FLAG_EFFECT = {
  registrationOpen: [`Open self check-in? Guests can check themselves in on the guest page while the event's window is open.`, 'Close self check-in? Guests will be sent to the desk.'],
  emailPaused: ['Pause email? Assignments are shown on screen and told by staff; messages wait.', 'Send email again?'],
  readOnly: ['Make the event read only? Nobody can check in or seat anyone until it is turned off (use it while reconciling paper).', 'Turn read only off? Check-in and seating work again.'],
};
export async function eventControlView(el, params, query) {
  const { events, canCreate, id } = await pickEvent(query);
  if (!id) return mount(el, noEvent(canCreate));
  const ev = await api.get(`/api/customapp/events/${id}`);
  const sa = ev.role === 'super';
  const c = ev.counts;
  const base = `/api/customapp/events/${id}`;
  const blockedIssues = ev.issues && ev.issues.total > (ev.importAck?.count ?? -1) ? ev.issues.total : 0;
  mount(el, html`${head(html`${icon('toggles', 22)} Event control`, ev, events)}
    <div class="stats ca-stats">
      <div class="card"><small>Invited</small><strong>${c.invited}</strong></div>
      <div class="card"><small>Checked in</small><strong>${c.checkedIn}</strong></div>
      <div class="card"><small>Not yet arrived</small><strong>${c.notArrived}</strong></div>
      <div class="card ${c.waiting ? 'attention' : ''}"><small>Waiting for a table</small><strong>${c.waiting}</strong></div>
      <div class="card"><small>Seated · reserved</small><strong>${c.seated} · ${c.reserved}</strong></div>
      <div class="card"><small>Seats left</small><strong>${c.seatsLeft} of ${c.capacity}</strong></div>
    </div>
    <section class="card"><h2>${icon('shield')} Super Administrator</h2>
      <p><strong>${ev.superAdmin.name || 'Nobody'}</strong>: the one account with authority over every guest and table of this event. Staff work on the guests and tables given to them.</p>
      ${can('customapp.manage') ? html`<button type="button" class="btn" id="ca-handover">${icon('key', 16)} Hand over the Super Administrator…</button>` : ''}
    </section>
    <section class="card"><h2>${icon('toggles')} Switches</h2>
      <p class="muted small">They take effect on the next request, with no restart. ${sa ? 'Each change is in the audit log.' : 'Only the Super Administrator changes them.'}</p>
      <ul class="ca-flags">${['registrationOpen', 'emailPaused', 'readOnly'].map((f) => {
        // Self check-in cannot open while the import check has issues nobody acknowledged.
        const held = f === 'registrationOpen' && !ev.flags[f] && blockedIssues;
        return html`<li><label class="switch"><input type="checkbox" data-flag="${f}" ${ev.flags[f] ? 'checked' : ''} ${sa && !held ? '' : 'disabled'} /> <span>${FLAG_LABELS[f]}: <strong class="state">${ev.flags[f] ? 'On' : 'Off'}</strong>${held ? html` <small class="muted">· ${plural(blockedIssues, 'issue')} to resolve (<a href="#/customapp/setup?e=${id}">Setup → Import check</a>)</small>` : ''}</span></label></li>`;
      })}
        <li><label class="field ca-poll"><span>${FLAG_LABELS.pollMs}</span><input type="number" min="1000" max="30000" step="500" value="${ev.flags.pollMs}" data-poll ${sa ? '' : 'disabled'} /></label></li></ul>
      ${ev.window?.opensAt ? html`<p class="small">Window: ${fmtManila(ev.window.opensAt)} to ${ev.window.closesAt ? fmtManila(ev.window.closesAt) : 'the end of the day'} (Manila time) · status ${ev.status}</p>` : html`<p class="small muted">No window set yet (Setup).</p>`}
    </section>
    ${sa ? html`<section class="card"><h2>${icon('download')} Exports and the printed plan</h2>
      <p class="muted small">The JSON export (format customapp.event/1) is the event's recovery copy: every guest, every seat claim, the change log, with a fingerprint (sha256). The CSV files and the seating plan are made from it. Each download is in the audit log.</p>
      <div class="actions ca-actions"><button type="button" class="btn" data-dl="json">${icon('download', 16)} Event export (JSON)</button>
        <a class="btn" href="${base}/export.csv?kind=guests" download>${icon('table', 16)} Guests (CSV)</a>
        <a class="btn" href="${base}/export.csv?kind=seating" download>${icon('table', 16)} Seating (CSV)</a>
        <a class="btn" href="${base}/plan.html" target="_blank" rel="noopener">${icon('file', 16)} Printable seating plan</a></div></section>
      <section class="card"><h2>${icon('checkCircle')} Seating rules check</h2><p class="muted small">Checks every rule at once: no table over its chairs, no chair held twice, no guest with two seats, one Super Administrator, owners who are staff.</p>
        <button type="button" class="btn" id="ca-check">Check now</button> <span id="ca-check-out" aria-live="polite"></span></section>` : ''}`);
  wireSwitcher(el, '/customapp/control');
  const setFlag = async (flag, value) => {
    await api.post(`${base}/commands`, { type: 'setFlag', flag, value, opId: opId() });
    toast(`${FLAG_LABELS[flag]}: ${flag === 'pollMs' ? `${value} ms` : value ? 'on' : 'off'}.`);
  };
  el.querySelectorAll('[data-flag]').forEach((input) => input.addEventListener('change', async () => {
    const f = input.dataset.flag;
    const [onText, offText] = FLAG_EFFECT[f];
    if (!(await confirmDialog(input.checked ? onText : offText, { confirmLabel: 'Confirm', danger: f === 'readOnly' && input.checked, title: FLAG_LABELS[f] }))) return (input.checked = !input.checked);
    try {
      await setFlag(f, input.checked);
      input.closest('label').querySelector('.state').textContent = input.checked ? 'On' : 'Off';
    } catch (err) {
      input.checked = !input.checked;
      toast(err.message, 'error');
    }
  }));
  el.querySelector('[data-poll]')?.addEventListener('change', (e) => setFlag('pollMs', Number(e.target.value)).catch((err) => toast(err.message, 'error')));
  el.querySelector('[data-dl="json"]')?.addEventListener('click', async () => {
    const exp = await api.get(`${base}/export.json`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(exp, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: `${ev.code}-seq${exp.seq}.json` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Exported at seq ${exp.seq}.`);
  });
  el.querySelector('#ca-check')?.addEventListener('click', async () => {
    const r = await api.get(`${base}/invariants`);
    mount(el.querySelector('#ca-check-out'), r.violations.length ? html`<span class="badge red">${plural(r.violations.length, 'problem')}</span> ${r.violations.map((v) => v.detail).join(' ')}` : html`<span class="badge green">All rules hold</span> at seq ${r.seq}`);
  });
  el.querySelector('#ca-handover')?.addEventListener('click', async () => {
    const { people } = await api.get(`${base}/people`);
    modal({
      title: 'Hand over the Super Administrator',
      subtitle: 'There is always exactly one. The current one loses every power in the same moment; what they owned goes to the new one\'s queue.',
      body: html`<label class="field"><span>New Super Administrator <em>*</em></span><select name="userId" required><option value="">Choose…</option>${people.filter((p) => p.id !== ev.superAdmin.id).map((p) => option(p.id, `${p.name} (${p.type})`))}</select></label>
        <label class="field"><span>Reason <em>*</em></span><input name="reason" required maxlength="300" placeholder="e.g. Maria is unwell; Jose takes over" /></label>
        <label class="field"><span>Your password <em>*</em></span><input type="password" name="password" required autocomplete="current-password" /></label>`,
      submitLabel: 'Hand over',
      onSubmit: async (f) => {
        const r = await api.post(`${base}/super-admin`, { userId: f.userId.value, reason: f.reason.value, password: f.password.value, opId: opId() });
        toast(`${r.superAdmin.name} is now the Super Administrator.`);
        eventControlView(el, params, query);
      },
    });
  });
}

// ----- Setup -----
export async function eventSetupView(el, params, query) {
  const { events, canCreate, id } = await pickEvent(query);
  if (!id) return mount(el, noEvent(canCreate));
  const ev = await api.get(`/api/customapp/events/${id}`);
  const base = `/api/customapp/events/${id}`;
  if (ev.role !== 'super') {
    return mount(el, html`${head(html`${icon('settings', 22)} Setup`, ev, events)}<div class="card empty">${icon('lock', 40)}<h2>Setup is the Super Administrator's</h2><p>${ev.superAdmin.name} sets up the event: its details, room, tables, staff and the guest list.</p></div>`);
  }
  const people = (await api.get(`${base}/people`)).people;
  const issues = await api.get(`${base}/issues`);
  const s = ev.settings;
  const blocked = issues.total > (ev.importAck?.count ?? -1) && issues.total > 0;
  mount(el, html`${head(html`${icon('settings', 22)} Setup`, ev, events)}
    <section class="card" id="ca-import"><h2>${icon('upload')} Guest list</h2>
      <p class="muted small">Import the list as CSV or Excel (.xlsx), up to 2,000 rows and 2 MB. The first row names the columns: Ref, First name, Surname (or Name), Designation, Company, Industry, Email, Mobile, Classification (preferred, regular, employee), RSVP, Personnel (a staff username), Table, Seat. Nothing is added until you have seen the check. Importing again updates guests by their Ref.</p>
      <label class="btn">${icon('upload', 16)} Choose a file… <input type="file" id="ca-file" accept=".csv,.xlsx,text/csv" hidden /></label>
      <div id="ca-preview" aria-live="polite"></div>
    </section>
    <section class="card" id="ca-issues"><h2>${icon('alert')} Import check</h2>
      ${issues.total ? html`<p>${plural(issues.total, 'issue')} to resolve. ${blocked ? html`<strong>Self check-in stays closed</strong> until they are resolved or acknowledged.` : html`Acknowledged by the Super Administrator: self check-in may open.`}</p>`
        : html`<p>${badge('Clear', 'green')} Every guest can be told apart and has a way to verify.</p>`}
      ${issues.groups.filter((g) => g.items.length).map((gr) => html`<details class="ca-issue" open><summary><strong>${gr.label} (${gr.items.length})</strong></summary><p class="muted small">${gr.fix}</p>
        <ul class="ca-list">${gr.items.map((pair) => html`<li class="ca-issue-row">${pair.filter(Boolean).map((g) => html`<span class="ca-issue-g"><strong>${g.name}</strong> <small class="muted">${g.ref} · ${g.company}</small>
          <span class="actions"><button type="button" class="btn small-btn" data-fix="email" data-g="${g.id}">Add email</button><button type="button" class="btn small-btn" data-fix="mobile" data-g="${g.id}">Add mobile</button><button type="button" class="btn small-btn" data-fix="desk" data-g="${g.id}">Desk only</button></span></span>`)}</li>`)}</ul></details>`)}
      ${issues.total && blocked ? html`<button type="button" class="btn" id="ca-ack">Acknowledge ${plural(issues.total, 'issue')}</button>` : ''}
    </section>
    <section class="card"><h2>${icon('party')} Event</h2>
      <form id="ca-ev" class="ca-form">
        <label class="field"><span>Name</span><input name="name" value="${ev.name}" maxlength="120" required /></label>
        <div class="ca-pair"><label class="field"><span>Date</span><input type="date" name="date" value="${ev.date}" /></label><label class="field"><span>Venue</span><input name="venue" value="${ev.venue}" maxlength="160" /></label></div>
        <div class="ca-pair"><label class="field"><span>Self check-in opens (Manila time)</span><input type="datetime-local" name="opensAt" value="${toManilaInput(ev.window?.opensAt)}" /></label><label class="field"><span>Closes (Manila time)</span><input type="datetime-local" name="closesAt" value="${toManilaInput(ev.window?.closesAt)}" /></label></div>
        <div class="ca-pair"><label class="field"><span>Status</span><select name="status">${[['draft', 'Draft'], ['live', 'Live'], ['closed', 'Closed'], ['archived', 'Archived']].map(([v, l]) => option(v, l, v === ev.status))}</select></label>
          <label class="field"><span>Chair numbers</span><select name="seatNumbers">${[['all', 'Every guest gets a chair number'], ['preferred', 'Preferred guests only'], ['none', 'Tables only (preferred guests still get one)']].map(([v, l]) => option(v, l, v === s.seatNumbers))}</select></label></div>
        <label class="field check"><input type="checkbox" name="mixedTables" ${s.mixedTables ? 'checked' : ''} /><span>Mixed tables in use (any guest may sit at a table marked Mixed)</span></label>
        <label class="field check"><input type="checkbox" name="releaseDelegable" ${s.releaseDelegable ? 'checked' : ''} /><span>Owners may release reservations at their tables (otherwise only the Super Administrator)</span></label>
        <div class="actions"><button type="submit" class="btn primary">Save</button></div>
      </form></section>
    <section class="card"><h2>${icon('grid')} Room and tables</h2>
      ${ev.room ? html`<p>${ev.room.rows} rows × ${ev.room.cols} columns of tables, ${ev.room.chairsPerTable} chairs each (${ev.room.rows * ev.room.cols * ev.room.chairsPerTable} seats), stage on the ${ev.room.stageSide}, tech booth on the ${ev.room.boothSide}. Table 1 is nearest the stage; chair 1 faces the stage.</p>` : ''}
      <button type="button" class="btn" id="ca-room">Lay out the room again…</button>
      <div class="table-scroll"><table class="table ca-ttable"><thead><tr><th>Table</th><th>Type</th><th>Chairs</th><th>Owner</th><th>Guests</th><th></th></tr></thead><tbody>
        ${ev.tables.map((t) => html`<tr><td>${t.number}</td><td>${CLASS_LABELS[t.classification]}</td><td>${t.capacity}</td><td>${t.ownerName || '–'}</td><td>${t.claims}${t.active ? '' : ' (not in use)'}</td><td><button type="button" class="btn small-btn" data-edit-t="${t.id}">Edit</button></td></tr>`)}
      </tbody></table></div></section>
    <section class="card"><h2>${icon('layers')} Industries</h2>
      <p class="muted small">One per line, with the related ones after a colon: <code>Banking: Insurance, Real estate</code>. Related industries are kept both ways.</p>
      <form id="ca-ind"><label class="field"><span class="sr-only">Industries</span><textarea name="list" rows="6">${(ev.industries || []).map((i) => `${i.name}${i.related.length ? `: ${i.related.map((r) => ev.industries.find((x) => x.id === r)?.name).filter(Boolean).join(', ')}` : ''}`).join('\n')}</textarea></label>
        <div class="actions"><button type="submit" class="btn">Save industries</button></div></form></section>
    <section class="card"><h2>${icon('users')} Staff</h2>
      <p class="muted small">Accounts that can use CUSTOM APP (Event staff, administrators). Staff check in anyone; they seat only the guests and tables given to them.</p>
      <form id="ca-staff"><ul class="ca-checks">${people.filter((p) => p.id !== ev.superAdmin.id).map((p) => html`<li><label class="field check"><input type="checkbox" name="staff" value="${p.id}" ${ev.staff.some((x) => x.userId === p.id && x.active) ? 'checked' : ''} /><span>${p.name} <small class="muted">${p.username} · ${p.type}</small></span></label></li>`)}</ul>
        <div class="actions"><button type="submit" class="btn">Save staff</button></div></form></section>`);
  wireSwitcher(el, '/customapp/setup');
  const reload = () => eventSetupView(el, params, query);
  const cmd = (body) => api.post(`${base}/commands`, { ...body, opId: opId() });

  el.querySelector('#ca-ev').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api.patch(base, { rev: ev.rev, name: f.name.value, date: f.date.value, venue: f.venue.value, status: f.status.value, window: { opensAt: f.opensAt.value, closesAt: f.closesAt.value }, settings: { seatNumbers: f.seatNumbers.value, mixedTables: f.mixedTables.checked, releaseDelegable: f.releaseDelegable.checked } });
      toast('Event saved.');
      reload();
    } catch (err) {
      toast(err.code === 'stale' ? 'Someone changed the event meanwhile. It is shown as it is now; make your change again.' : err.message, 'error');
      if (err.code === 'stale') reload();
    }
  });
  el.querySelector('#ca-ind').addEventListener('submit', async (e) => {
    e.preventDefault();
    const lines = e.target.list.value.split('\n').map((l) => l.trim()).filter(Boolean);
    const industries = lines.map((l) => {
      const [name, rel = ''] = l.split(':');
      return { id: ev.industries.find((i) => i.name.toLowerCase() === name.trim().toLowerCase())?.id, name: name.trim(), related: rel.split(',').map((r) => r.trim()).filter(Boolean) };
    });
    try {
      await api.patch(base, { rev: ev.rev, industries });
      toast('Industries saved.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  el.querySelector('#ca-staff').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ids = [...e.target.querySelectorAll('input[name=staff]:checked')].map((x) => x.value);
    try {
      await api.patch(base, { rev: ev.rev, staff: ids.map((userId) => ({ userId, active: true })) });
      toast('Staff saved.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  el.querySelectorAll('[data-edit-t]').forEach((b) => b.addEventListener('click', () => {
    const t = ev.tables.find((x) => x.id === b.dataset.editT);
    modal({
      title: `Table ${t.number}`,
      body: html`<label class="field"><span>Type</span><select name="classification">${['preferred', 'regular', 'employee', 'mixed'].map((c) => option(c, CLASS_LABELS[c], c === t.classification))}</select></label>
        <label class="field"><span>Chairs (1 to 10)</span><input type="number" name="capacity" min="1" max="10" value="${t.capacity}" /></label>
        <label class="field"><span>Owner</span><select name="owner"><option value="">No owner (the Super Administrator's)</option>${ev.staff.filter((x) => x.active).map((x) => option(x.userId, x.name, x.userId === t.ownerUserId))}</select></label>
        <label class="field check"><input type="checkbox" name="active" ${t.active ? 'checked' : ''} /><span>In use</span></label>`,
      onSubmit: async (f) => {
        await cmd({ type: 'table.update', tableId: t.id, classification: f.classification.value, capacity: Number(f.capacity.value), ownerUserId: f.owner.value || null, active: f.active.checked, expect: { [t.id]: t.rev } });
        toast(`Table ${t.number} saved.`);
        reload();
      },
    });
  }));
  el.querySelector('#ca-room').addEventListener('click', () => modal({
    title: 'Lay out the room',
    subtitle: 'Makes the tables from the room: numbered from the stage. Only while nobody has a seat.',
    body: html`<div class="ca-pair"><label class="field"><span>Rows</span><input type="number" name="rows" min="1" max="20" value="${ev.room?.rows || 5}" /></label><label class="field"><span>Columns</span><input type="number" name="cols" min="1" max="20" value="${ev.room?.cols || 5}" /></label></div>
      <div class="ca-pair"><label class="field"><span>Chairs per table</span><input type="number" name="chairs" min="1" max="10" value="${ev.room?.chairsPerTable || 10}" /></label><label class="field"><span>Stage on the</span><select name="stage">${STAGE_SIDES.map((x) => option(x, x, x === (ev.room?.stageSide || 'right')))}</select></label></div>`,
    submitLabel: 'Lay out',
    onSubmit: async (f) => {
      await cmd({ type: 'room.set', room: { rows: Number(f.rows.value), cols: Number(f.cols.value), chairsPerTable: Number(f.chairs.value), stageSide: f.stage.value } });
      toast('Room laid out.');
      reload();
    },
  }));
  el.querySelector('#ca-ack')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Acknowledge ${plural(issues.total, 'issue')}? Self check-in may then open with them; those guests are helped at the desk.`, { confirmLabel: 'Acknowledge', danger: false }))) return;
    await cmd({ type: 'importAck' });
    toast('Acknowledged.');
    reload();
  });
  el.querySelectorAll('[data-fix]').forEach((b) => b.addEventListener('click', async () => {
    const gid = b.dataset.g;
    if (b.dataset.fix === 'desk') {
      await cmd({ type: 'guest.update', guestId: gid, deskOnly: true });
      toast('Marked desk only.');
      return reload();
    }
    const email = b.dataset.fix === 'email';
    modal({
      title: email ? 'Add the full email' : 'Add a direct mobile',
      body: html`<label class="field"><span>${email ? 'Email' : 'Mobile'}</span><input name="v" type="${email ? 'email' : 'tel'}" required /></label>`,
      onSubmit: async (f) => {
        await cmd({ type: 'guest.update', guestId: gid, [email ? 'email' : 'mobile']: f.v.value });
        toast('Saved.');
        reload();
      },
    });
  }));
  el.querySelector('#ca-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const out = el.querySelector('#ca-preview');
    if (file.size > 2 * 1024 * 1024) return toast('The file is larger than 2 MB.', 'error');
    const xlsx = /\.xlsx$/i.test(file.name);
    let data;
    if (xlsx) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      data = btoa(bin);
    } else data = await file.text();
    try {
      const pv = await api.post(`${base}/import`, { format: xlsx ? 'xlsx' : 'csv', data });
      const r = pv.report;
      const lines = [['unknownClass', 'Classification not known'], ['unknownTable', 'No such table'], ['wrongTable', 'Table of another type'], ['seatConflict', 'Chair taken or not at that table'], ['missingSeat', 'Preferred guest without a chair number'], ['overCapacity', 'Table over its chairs'], ['repeatedKey', 'The same Ref twice']].filter(([k]) => r[k].length);
      mount(out, html`<div class="ca-pv"><p><strong>${r.rows}</strong> rows read: <strong>${r.adds}</strong> new guests, <strong>${r.updates}</strong> to update. The room seats ${r.capacity}; with this list there would be ${r.total}.</p>
        ${r.tooMany ? html`<p class="ca-notice" role="alert">${icon('alert', 16)} ${r.tooMany} more guests than seats. Shorten the list to ${r.capacity} and choose it again.</p>` : ''}
        ${lines.length ? html`<p class="ca-notice" role="alert">${icon('alert', 16)} Fix these in the file, then choose it again:</p><ul>${lines.map(([k, l]) => html`<li>${l}: ${r[k].length} (${r[k].slice(0, 5).map((x) => (x.line ? `row ${x.line}` : x.value)).join(', ')})</li>`)}</ul>` : ''}
        ${r.unknownIndustry.length || r.unknownOwner.length ? html`<p class="muted small">${r.unknownIndustry.length ? `${plural(r.unknownIndustry.length, 'industry', 'industries')} not in the event's list (kept as text, shown in the import check). ` : ''}${r.unknownOwner.length ? `${plural(r.unknownOwner.length, 'personnel name')} not on the staff: those guests go to the Super Administrator's queue.` : ''}</p>` : ''}
        <p class="small">After the import, the check would show ${plural(r.issues.total, 'issue')}: ${r.issues.ambiguous.length} ambiguous pairs, ${r.issues.noContact.length} without mobile or email, ${r.issues.duplicates.length} possible duplicates.</p>
        ${pv.sample.length ? html`<p class="muted small">First new guests: ${pv.sample.map((g) => `${g.ref} ${g.name}`).join(', ')}</p>` : ''}
        <div class="actions"><button type="button" class="btn primary" id="ca-apply" ${r.blocking || !(r.adds + r.updates) ? 'disabled' : ''}>${r.adds ? `Add ${r.adds} guests` : 'Update guests'}${r.updates && r.adds ? ` and update ${r.updates}` : ''}</button></div></div>`);
      out.querySelector('#ca-apply')?.addEventListener('click', async () => {
        const a = await api.post(`${base}/import/${pv.jobId}/apply`, {});
        toast(`${a.added} guests added, ${a.updated} updated.`);
        reload();
      });
    } catch (err) {
      mount(out, html`<p class="ca-notice" role="alert">${icon('alert', 16)} ${err.message}</p>`);
    }
  });
}
