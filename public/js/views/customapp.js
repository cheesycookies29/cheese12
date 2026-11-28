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
// Tier 1 (0.72):
//  - myQueueView (/customapp/queue): where Event staff land. The guests waiting for this staff member
//    (oldest first, with a wait timer), those checked in and seated, and Find guest; kept live by the
//    short poll, with a bar that says how old it is. The Super Administrator's queue is everyone with
//    no owner, released preferred guests who arrived, and guests flagged for a look.
//  - roomPlanView (/customapp/room): the room plan (customapp-room.js), also on Event control.
// Every change is one command to the server (server/customapp/events), which decides: nothing is
// shown as done before it answers, and a refusal redraws the sheet from the state in its reply.
import { api } from '../api.js';
import { ctx, can } from '../state.js';
import { html, raw, mount, modal, toast, confirmDialog, badge } from '../ui.js';
import { icon } from '../icons.js';
import { CLASS_LABELS, FLAG_LABELS, STAGE_SIDES, GUEST_FLAGS, RSVP_LABELS } from '/shared/customapp/statuses.js';
import { fmtManila, toManilaInput } from '/shared/customapp/time.js';
import { livePoll } from './customapp-live.js';
import { mountRoomPlan } from './customapp-room.js';
import qrcode from '../vendor/qrcode.js';
import { richEditor, wireRichEditor } from '../richeditor.js';

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

// ----- My queue (Tier 1) -----
const minutesSince = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000)) : 0);
// The wait timer: amber from 4 minutes, red from 8, and the same in words.
const waitTimer = (iso) => {
  const m = minutesSince(iso);
  return html`<span class="ca-wait ${m >= 8 ? 'red' : m >= 4 ? 'amber' : ''}" data-since="${iso || ''}">Waiting ${m < 1 ? 'under a minute' : `${m} min`}</span>`;
};
const WHY = { no_owner: 'No owner', released: 'Reservation released', unlisted: 'Unlisted, to approve', flagged: 'Flagged' };
export async function myQueueView(el, params, query) {
  const { events, canCreate, id } = await pickEvent(query);
  if (!id) return mount(el, noEvent(canCreate));
  const ev = await api.get(`/api/customapp/events/${id}`);
  if (ev.role === 'manager') return mount(el, html`${head(html`${icon('inbox', 22)} My queue`, ev, events)}<div class="card empty">${icon('lock', 40)}<h2>Not on this event's staff</h2><p>My queue is for the event's staff and its Super Administrator.</p></div>`);
  const base = `/api/customapp/events/${id}`;
  const sa = ev.role === 'super';
  mount(el, html`<div class="ca-sticky" data-bar role="status"><span class="grow"><strong>${ev.name}</strong> · ${ctx.user?.name || ''}</span><span data-age>Loading…</span></div>
    ${head(html`${icon('inbox', 22)} My queue`, ev, events, sa ? 'every guest with no owner' : 'the guests and tables given to you')}
    <section class="card ca-q-sec" data-attn hidden></section>
    <section class="card ca-q-sec" aria-labelledby="ca-q-w"><h2 id="ca-q-w">Waiting for table <span class="ca-n" data-nw></span></h2><p class="muted small ca-q-tip">A group arriving together: tick them, then <strong>Seat together</strong>.</p><div data-waiting><p class="muted">Loading…</p></div><div class="ca-groupbar" data-groupbar hidden role="region" aria-label="Group"></div></section>
    <section class="card ca-q-sec" aria-labelledby="ca-q-s"><h2 id="ca-q-s">Checked in and seated <span class="ca-n" data-ns></span></h2><div data-seated></div></section>
    <section class="card ca-q-sec" aria-labelledby="ca-q-f"><h2 id="ca-q-f">Find guest</h2>
      <div class="ca-search"><input type="search" data-find placeholder="Name, company, ref or a code (R-1234)" aria-label="Find a guest by name, company, ref or referral code" autocomplete="off" enterkeyhint="search" /></div>
      <div data-found aria-live="polite"></div>
      <p class="ca-walkin-row"><button type="button" class="btn" data-walkin>${icon('userPlus', 16)} Add walk-in</button> <small class="muted">Not on the list? The Super Administrator decides.</small></p></section>`);
  wireSwitcher(el, '/customapp/queue');
  const greyed = new Map(); // guestId → { until, text, card }
  let board = null;
  const card = (g, extra = '', pick = false) => html`<li class="${pick ? 'ca-qli' : ''}">${pick ? pickBox(g) : ''}<button type="button" class="ca-qcard" data-guest="${g.id}">
      <span class="grow"><strong>${g.displayName}</strong><small>${g.company || ''}</small></span>
      <span class="ca-tags">${g.industry ? html`<span class="ca-chip">${g.industry}</span>` : ''}${badge(g.classLabel, g.classification === 'preferred' ? 'brand' : '')}${extra}</span></button></li>`;
  function draw() {
    if (!board) return;
    const now = Date.now();
    for (const m of board.movedAway) {
      if (!greyed.has(m.guestId) && now - Date.parse(m.at) < 120000) greyed.set(m.guestId, { until: now + 10000, text: `Moved to ${m.toName ? `${m.toName}'s` : 'the Super Administrator\'s'} queue by ${m.byName ? 'the Super Administrator' : 'the Super Administrator'}, ${fmtManila(m.at, { date: false })}`, guest: shown.get(m.guestId) });
    }
    for (const [gid, x] of greyed) if (x.until < now || !x.guest) greyed.delete(gid);
    const ids = new Set(board.waiting.map((g) => g.id));
    const gone = [...greyed].filter(([gid]) => !ids.has(gid));
    el.querySelector('[data-nw]').textContent = `(${board.waiting.length})`;
    el.querySelector('[data-ns]').textContent = `(${board.seated.length})`;
    const tablesText = board.tables.length ? `Your tables: ${board.tables.map((t) => t.number).join(', ')} (${plural(board.freeSeats, 'seat')} left).` : sa ? '' : 'You have no tables yet: the Super Administrator gives them.';
    mount(el.querySelector('[data-waiting]'), board.waiting.length || gone.length ? html`<ul class="ca-qlist">${board.waiting.map((g) => card(g, html`${(g.why || []).map((w) => badge(WHY[w] || w, 'amber'))}${waitTimer(g.waitingSince)}`, true))}
        ${gone.map(([gid, x]) => html`<li class="ca-moved" data-moved="${gid}" aria-live="polite"><span class="grow"><strong>${x.guest.displayName}</strong><small>${x.text}</small></span></li>`)}</ul>`
      : html`<p class="ca-empty-q">No one is waiting for you.${tablesText ? ` ${tablesText}` : ''}</p>`);
    // The latest 6, the rest folded (Find guest is right below).
    const seatedCard = (g) => card(g, badge(`${g.seat.status === 'reserved' ? 'Reserved' : 'Seated'}: T${g.seat.number}${g.seat.seatNo ? ` S${g.seat.seatNo}` : ''}`, g.seat.status === 'reserved' ? 'blue' : 'green'));
    const openMore = el.querySelector('[data-seated] details')?.open;
    mount(el.querySelector('[data-seated]'), board.seated.length ? html`<ul class="ca-qlist">${board.seated.slice(0, 6).map(seatedCard)}</ul>
      ${board.seated.length > 6 ? html`<details class="ca-others" ${openMore ? 'open' : ''}><summary>${plural(board.seated.length - 6, 'more guest')}</summary><ul class="ca-qlist">${board.seated.slice(6).map(seatedCard)}</ul></details>` : ''}` : html`<p class="muted">Nobody yet.</p>`);
    const attn = el.querySelector('[data-attn]');
    attn.hidden = !(sa && board.attention?.length) && !(sa && board.alarm);
    if (!attn.hidden) {
      mount(attn, html`${board.alarm ? html`<p class="ca-notice" role="alert">${icon('alert', 16)} ${board.alarm.failures} failed guest page checks in 5 minutes. Nobody is locked out: guests with a code are helped at the desk (Find guest, type the code).</p>` : ''}
        ${board.attention?.length ? html`<h2>Needs a look (${board.attention.length})</h2><ul class="ca-qlist">${board.attention.map((g) => card(g, html`${(g.why || []).map((w) => badge(WHY[w] || w, 'amber'))}${(g.flags || []).slice(-1).map((f) => html`<small class="muted">${GUEST_FLAGS[f.kind] || f.kind}, ${fmtManila(f.at, { date: false })}</small>`)}`))}</ul>` : ''}`);
    }
    for (const g of [...board.waiting, ...board.seated, ...(board.attention || [])]) shown.set(g.id, g);
    el.querySelectorAll('[data-guest]').forEach((b) => b.addEventListener('click', () => openGuest(id, b.dataset.guest, () => poll.reset())));
    picker.wire();
  }
  const picker = groupPicker(el, id, { onChange: () => poll.reset(), getGuests: () => board?.waiting || [] });
  el.querySelector('[data-walkin]').addEventListener('click', () => addWalkIn(id, ev, () => poll.reset()));
  const shown = new Map();
  const poll = livePoll(`${base}/changes?tab=queue`, {
    bar: el.querySelector('[data-bar]'),
    onBoard: (b, reply) => {
      if (!b) return mount(el.querySelector('[data-waiting]'), html`<p class="ca-notice">${reply.error?.message || 'Not available.'}</p>`);
      board = b;
      draw();
    },
  });
  // The wait timers and the greyed-out moves age by themselves between polls.
  const ticker = setInterval(() => {
    el.querySelectorAll('.ca-wait[data-since]').forEach((w) => {
      const m = minutesSince(w.dataset.since);
      w.classList.toggle('amber', m >= 4 && m < 8);
      w.classList.toggle('red', m >= 8);
      w.textContent = `Waiting ${m < 1 ? 'under a minute' : `${m} min`}`;
    });
    if ([...greyed.values()].some((x) => x.until < Date.now())) draw();
  }, 5000);
  wireFind(el, id, () => poll.reset());
  return () => {
    poll.stop();
    clearInterval(ticker);
  };
}

// ----- Room plan (Tier 1) -----
export async function roomPlanView(el, params, query) {
  const { events, canCreate, id } = await pickEvent(query);
  if (!id) return mount(el, noEvent(canCreate));
  const ev = await api.get(`/api/customapp/events/${id}`);
  if (ev.role === 'manager') return mount(el, html`${head(html`${icon('mapPin', 22)} Room plan`, ev, events)}<div class="card empty">${icon('lock', 40)}<h2>Not on this event's staff</h2><p>The room plan is for the event's staff and its Super Administrator.</p></div>`);
  mount(el, html`${head(html`${icon('mapPin', 22)} Room plan`, ev, events, ev.room ? `${ev.room.rows} × ${ev.room.cols} tables, stage on the ${ev.room.stageSide}` : '')}<div data-plan-host></div>`);
  wireSwitcher(el, '/customapp/room');
  return mountRoomPlan(el.querySelector('[data-plan-host]'), id);
}

// Find guest inside My queue: by name, company or ref, or a guest page referral code (R-1234), which
// shows what the guest typed and the real reason, with Clear cap and check in.
function wireFind(el, eventId, onChange) {
  const input = el.querySelector('[data-find]');
  const out = el.querySelector('[data-found]');
  let timer = 0;
  let n = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const k = ++n;
      const q = input.value.trim();
      if (!q) return mount(out, '');
      const r = await findOrReferral(eventId, q);
      if (k !== n) return;
      mount(out, r.html);
      wireFound(out, eventId, r, () => {
        input.dispatchEvent(new Event('input'));
        onChange();
      });
    }, 220);
  });
}
const REF_RE = /^r-?\s?(\d{4})$/i;
async function findOrReferral(eventId, q) {
  const base = `/api/customapp/events/${eventId}`;
  const m = q.match(REF_RE);
  if (m) {
    const code = `R-${m[1]}`;
    try {
      const ref = await api.get(`${base}/referral/${code}`);
      const t = ref.typed;
      return {
        ref, guests: ref.guests,
        html: html`<div class="ca-ref" data-ref="${code}"><p><strong>${code}</strong> · ${fmtManila(ref.at, { date: false })}</p>
          <p>${ref.reasonText}</p><p class="small">They typed: surname <strong>“${t.surname || '–'}”</strong>${t.last4 ? html`, last 4 digits <strong>${t.last4}</strong>` : ''}${t.email ? html`, email <strong>${t.email}</strong>` : ''}.</p>
          ${ref.guests.length ? html`<ul class="ca-list">${ref.guests.map((g) => html`<li class="ca-ref-g"><button type="button" class="ca-guest" data-guest="${g.id}"><span class="grow"><strong>${g.displayName}</strong><small>${[g.company, g.mine ? g.mobile : ''].filter(Boolean).join(' · ')}</small></span><span class="ca-tags">${statusBadge(g)}</span></button>
              ${g.arrival.state !== 'checked_in' ? html`<button type="button" class="btn primary ca-big" data-clear-checkin="${g.id}">${icon('check', 18)} ${ref.capped ? 'Clear cap and check in' : 'Check in'}</button>` : ref.capped ? html`<button type="button" class="btn ca-big" data-clear="${g.id}">Clear cap</button>` : ''}</li>`)}</ul>`
            : html`<p class="muted">No guest on the list has that surname. Ask for the name as on the invitation, or refer them to the Super Administrator (a walk-in).</p>`}</div>`,
      };
    } catch (err) {
      return { guests: [], html: html`<p class="ca-notice">${icon('alert', 16)} ${err.message}</p>` };
    }
  }
  const r = await api.get(`${base}/guests?q=${encodeURIComponent(q)}&limit=20`);
  return { guests: r.guests, html: r.guests.length ? html`<ul class="ca-list">${r.guests.map((g) => html`<li><button type="button" class="ca-guest" data-guest="${g.id}"><span class="grow"><strong>${g.displayName}</strong><small>${[g.company, g.industry].filter(Boolean).join(' · ')}</small></span><span class="ca-tags">${badge(g.classLabel, g.classification === 'preferred' ? 'brand' : '')}${statusBadge(g)}</span></button></li>`)}</ul>` : html`<p class="muted ca-none">No guest matches “${q}”.</p>` };
}
function wireFound(box, eventId, r, onChange) {
  const base = `/api/customapp/events/${eventId}`;
  box.querySelectorAll('[data-guest]').forEach((b) => b.addEventListener('click', () => openGuest(eventId, b.dataset.guest, onChange)));
  // One tap at the desk: the cap goes (in memory) and the guest is checked in.
  box.querySelectorAll('[data-clear-checkin]').forEach((b) => b.addEventListener('click', async () => {
    const g = r.guests.find((x) => x.id === b.dataset.clearCheckin);
    b.disabled = true;
    try {
      await api.post(`${base}/caps/clear`, { guestId: g.id });
      await api.post(`${base}/commands`, { type: 'checkIn', guestId: g.id, opId: opId() });
      toast(`${g.displayName} checked in.`);
      onChange();
    } catch (err) {
      b.disabled = false;
      toast(err.message, 'error');
    }
  }));
  box.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', async () => {
    await api.post(`${base}/caps/clear`, { guestId: b.dataset.clear });
    toast('Cap cleared: the guest can use the guest page again.');
    onChange();
  }));
}

// ----- Find guest, and the guest sheet -----
export async function findGuestView(el, params, query) {
  const { events, canCreate, id } = await pickEvent(query);
  if (!id) return mount(el, noEvent(canCreate));
  const ev = await api.get(`/api/customapp/events/${id}`);
  if (ev.role === 'manager') return mount(el, html`${head(html`${icon('search', 22)} Find guest`, ev, events)}<div class="card empty">${icon('lock', 40)}<h2>Not on this event's staff</h2><p>As an administrator you can hand over the Super Administrator under Event control; guests and tables are the event staff's.</p></div>`);
  let status = query.status || '';
  let rsvp = query.rsvp || '';
  let mine = false;
  mount(el, html`${head(html`${icon('search', 22)} Find guest`, ev, events)}
    <div class="stats small ca-strip" id="ca-strip"></div>
    <div class="ca-search"><input type="search" id="ca-q" placeholder="Name, company, ref or code (R-1234)" aria-label="Find a guest by name, company, ref or referral code" autocomplete="off" enterkeyhint="search" /></div>
    <div class="chips ca-chips" role="group" aria-label="Show">
      ${[['', 'Everyone'], ['waiting', 'Waiting for a table'], ['expected', 'Not arrived'], ['seated', 'Seated'], ['reserved', 'Reserved']].map(([v, l]) => html`<button type="button" class="chip ${v === status ? 'on' : ''}" data-status="${v}" aria-pressed="${v === status}">${l}</button>`)}
      ${ev.role === 'staff' ? html`<button type="button" class="chip" data-mine aria-pressed="false">Mine only</button>` : ''}
    </div>
    <div class="chips ca-chips ca-rsvp-chips" role="group" aria-label="RSVP">
      ${[['', 'Any RSVP'], ['yes', 'Said Yes'], ['no', 'Said No'], ['noreply', 'No reply'], ['not_invited', 'Not invited']].map(([v, l]) => html`<button type="button" class="chip ${v === rsvp ? 'on' : ''}" data-rsvp-f="${v}" aria-pressed="${v === rsvp}">${l}</button>`)}
    </div>
    <div id="ca-results" class="card ca-results" aria-live="polite"></div>
    <div class="ca-groupbar" data-groupbar hidden role="region" aria-label="Group"></div>
    <p class="ca-walkin-row"><button type="button" class="btn" data-walkin>${icon('userPlus', 16)} Add walk-in</button> <small class="muted">Someone not on the list, or tick guests waiting for a table to seat them together.</small></p>`);
  wireSwitcher(el, '/customapp/find');
  let lastGuests = [];
  const picker = groupPicker(el, id, { onChange: () => search(), getGuests: () => lastGuests.filter((g) => g.arrival?.state === 'checked_in' && !g.seat) });
  el.querySelector('[data-walkin]').addEventListener('click', () => addWalkIn(id, ev, () => search()));
  const strip = (c) => mount(el.querySelector('#ca-strip'), html`<div><small>Checked in</small><strong>${c.checkedIn}</strong></div><div><small>Waiting</small><strong>${c.waiting}</strong></div><div><small>Not arrived</small><strong>${c.notArrived}</strong></div><div><small>Seats left</small><strong>${c.seatsLeft}</strong></div>`);
  strip(ev.counts);
  let timer = 0;
  let seq = 0;
  async function search() {
    const n = ++seq;
    const q = el.querySelector('#ca-q').value.trim();
    // A guest page referral code (R-1234): what the guest typed, the real reason, Clear cap and check in.
    if (REF_RE.test(q)) {
      const found = await findOrReferral(id, q);
      if (n !== seq) return;
      mount(el.querySelector('#ca-results'), found.html);
      return wireFound(el.querySelector('#ca-results'), id, found, async () => {
        search();
        strip((await api.get(`/api/customapp/events/${id}`)).counts);
      });
    }
    const r = await api.get(`/api/customapp/events/${id}/guests?q=${encodeURIComponent(q)}&status=${status}${rsvp ? `&rsvp=${rsvp}` : ''}${mine ? '&mine=1' : ''}&limit=60`);
    if (n !== seq) return;
    lastGuests = r.guests;
    mount(el.querySelector('#ca-results'), r.guests.length ? html`<ul class="ca-list">${r.guests.map((g) => html`<li class="${g.arrival?.state === 'checked_in' && !g.seat ? 'ca-qli' : ''}">${g.arrival?.state === 'checked_in' && !g.seat ? pickBox(g) : ''}<button type="button" class="ca-guest" data-guest="${g.id}">
        <span class="grow"><strong>${g.displayName}</strong><small>${[g.company, g.industry].filter(Boolean).join(' · ')}</small></span>
        <span class="ca-tags">${badge(g.classLabel, g.classification === 'preferred' ? 'brand' : '')}${statusBadge(g)}${rsvp || g.rsvpStatus === 'yes' || g.rsvpStatus === 'no' ? badge(`RSVP: ${g.rsvpLabel}`, RSVP_BADGE[g.rsvpStatus] || 'gray') : ''}</span>
      </button></li>`)}</ul>${r.total > r.guests.length ? html`<p class="muted small">${r.total - r.guests.length} more: type more of the name.</p>` : ''}`
      : html`<p class="muted ca-none">${q ? `No guest matches “${q}”. Check the spelling, try the company, or ask the Super Administrator about a walk-in.` : 'Nobody here.'}</p>`);
    el.querySelectorAll('[data-guest]').forEach((b) => b.addEventListener('click', () => openGuest(id, b.dataset.guest, async () => {
      search();
      strip((await api.get(`/api/customapp/events/${id}`)).counts);
    })));
    picker.wire();
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
  el.querySelectorAll('[data-rsvp-f]').forEach((b) => b.addEventListener('click', () => {
    rsvp = b.dataset.rsvpF;
    el.querySelectorAll('[data-rsvp-f]').forEach((x) => {
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
      notice = err.code === 'table_full' && t ? `Table ${t.number} just filled. Updated options:`
        : err.code === 'seat_taken' && t ? `Seat ${cmd.seatNo} at table ${t.number} was just taken. Choose another seat.`
        : err.code === 'out_of_scope' ? 'This guest or table is no longer yours: the Super Administrator gave it to someone else. Nothing was changed; ask them, or the Super Administrator.'
        : err.message;
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
    // Up to three recommendations (ranked by the server, with why), then the other eligible tables
    // of this staff member (collapsed), then other people's tables, read only.
    const recT = mineT.filter((t) => t.rank != null).slice(0, 3);
    const restT = mineT.filter((t) => !recT.includes(t));
    const pickT = chosen && tables.find((t) => t.id === chosen.tableId);
    // The Super Administrator reserves a chair ahead of arrival (a guest who said Yes on their
    // invitation and is waiting for a table, a preferred guest): mode 'reserve'.
    const choosing = d.canSeat && ((here && !g.seat && !d.releasedNeedsSuper) || mode === 'transfer' || mode === 'reserve');
    // The chosen table opens in place: its chairs (the first free one chosen) and Confirm, right under it.
    const chairs = (t) => html`<div class="ca-chairs" role="group" aria-label="Chairs at table ${t.number}">${Array.from({ length: t.capacity }, (_, i) => i + 1).map((n) => {
        const taken = t.taken.includes(n) && !(g.seat?.tableId === t.id && g.seat.seatNo === n);
        return html`<button type="button" class="ca-chair ${chosen.seatNo === n ? 'on' : ''}" data-chair="${n}" ${taken ? 'disabled' : ''} aria-pressed="${chosen.seatNo === n}" aria-label="Seat ${n}${taken ? ', taken' : ''}">${n}</button>`;
      })}</div>
      <button type="button" class="btn primary ca-big" data-confirm ${chosen.seatNo || d.seatNumbers === 'none' ? '' : 'disabled'}>${mode === 'transfer' ? 'Move' : mode === 'reserve' ? 'Reserve' : 'Seat'} at Table ${t.number}${chosen.seatNo ? `, seat ${chosen.seatNo}` : ''}</button>`;
    const tableBtn = (t) => {
      const full = t.free < 1 && !(g.seat && g.seat.tableId === t.id);
      return html`<li><button type="button" class="ca-table ${chosen?.tableId === t.id ? 'on' : ''}" data-table="${t.id}" ${full || !t.mine ? 'disabled' : ''} aria-pressed="${chosen?.tableId === t.id}">
        <span class="ca-tno">Table ${t.number}</span><span class="grow">${meter(t)}${t.reasons?.length && !full ? html`<small class="ca-why">${t.reasons.join(' · ')}</small>` : ''}<small>${CLASS_LABELS[t.classification]}${t.ownerName ? ` · ${t.ownerName}` : ''}${full ? ' · Full' : !t.mine ? ' · Not yours' : ''}</small></span></button>${pickT === t ? chairs(t) : ''}</li>`;
    };
    mount(box, html`
      <div class="ca-who"><span>${badge(g.classLabel, g.classification === 'preferred' ? 'brand' : '')} <span class="muted">${g.ref}</span></span>
        <p>${[g.designation, g.company].filter(Boolean).join(', ')}${g.industry ? html`<br><span class="muted">${g.industry}</span>` : ''}</p>
        ${g.mine ? html`<p class="muted small">${[g.mobile && `Mobile ${g.mobile}`, g.email && `Email ${g.email}`].filter(Boolean).join(' · ') || 'No mobile or email on the list'}${g.deskOnly ? ' · Desk only' : ''}</p>` : html`<p class="muted small">Not your guest: you can check them in; their owner or the Super Administrator seats them.</p>`}</div>
      ${notice ? html`<p class="ca-notice" role="alert">${icon('alert', 16)} ${notice}</p>` : ''}
      ${d.approval ? html`<section class="ca-step ca-approval"><h3>${d.approval.kind === 'substitute' ? 'Substitute' : 'Walk-in'}</h3>
        ${d.substitute?.line ? html`<p><strong>${d.substitute.line}</strong></p>` : ''}
        ${d.approval.state === 'pending' ? html`<p class="ca-notice">${icon('flag', 16)} Waiting for the Super Administrator's approval. Until then they are not checked in and cannot be seated.</p>
            ${d.role === 'super' ? html`<div class="actions ca-actions"><button type="button" class="btn primary" data-approve>Approve…</button><button type="button" class="btn danger ghost" data-reject>Do not admit…</button></div>` : ''}`
          : d.approval.state === 'approved' ? html`<p class="small">Approved${d.approval.classification ? ` as ${CLASS_LABELS[d.approval.classification]}` : ''}${d.approval.at ? `, ${fmtManila(d.approval.at, { date: false })}` : ''}.</p>`
          : html`<p class="small">Not admitted.${d.approval.note ? ` ${d.approval.note}` : ''}</p>`}</section>` : ''}
      ${d.substitute?.role === 'original' ? html`<p class="ca-notice">${icon('repeat', 16)} ${d.substitute.line}. ${g.displayName} is not coming.</p>` : ''}
      <section class="ca-step"><h3>Arrival</h3><p>${arrivalText(g)}</p>
        ${here ? (d.canSeat ? html`<button type="button" class="btn ghost small-btn" data-undo>Undo check-in</button>` : '') : d.approval && d.approval.state !== 'approved' ? '' : d.substitute?.role === 'original' ? '' : html`<button type="button" class="btn primary ca-big" data-checkin>${icon('check', 18)} Check in</button>`}
        ${d.canSubstitute ? html`<p><button type="button" class="btn small-btn" data-substitute>${icon('repeat', 14)} Record substitute</button> <small class="muted">Someone here instead of ${g.name?.first || g.displayName}</small></p>` : ''}</section>
      <section class="ca-step"><h3>Seat</h3>
        ${g.seat ? html`<p class="ca-seat-now"><strong>Table ${g.seat.number}${g.seat.seatNo ? `, seat ${g.seat.seatNo}` : ''}</strong> ${badge(g.seat.status === 'reserved' ? 'Reserved' : 'Seated', g.seat.status === 'reserved' ? 'blue' : 'green')}</p>
            ${g.seat.status === 'reserved' && !here ? html`<p class="muted small">A reservation: it is kept until the guest arrives (checking in confirms it) or the Super Administrator releases it. It never runs out.</p>` : ''}
            ${g.seat.status === 'confirmed' && d.email ? (d.email.paused ? html`<p class="muted small" data-email-line>Email is paused: tell ${g.name?.first || 'the guest'} their table, or show them this screen.</p>`
              : d.email.state ? html`<p class="small" data-email-line>${icon('mail', 14)} ${EMAIL_TEXT[d.email.state] || d.email.state}${d.email.lastAt ? `, ${fmtManila(d.email.lastAt, { date: false })}` : ''}${d.email.state === 'failed' && d.email.lastError ? html`: <span class="muted">${d.email.lastError}</span>` : ''}${d.email.state === 'failed' ? '. The seat is safe.' : ''}
                ${d.email.canResend ? html` <button type="button" class="link-btn" data-resend>Resend</button>` : ''}</p>` : '') : ''}
            ${d.canSeat && mode !== 'transfer' ? html`<div class="actions ca-actions">
              <button type="button" class="btn" data-move>${icon('repeat', 16)} Move</button>
              ${g.seat.status === 'confirmed' ? html`<button type="button" class="btn" data-unseat>Send back to waiting</button>` : ''}
              ${g.seat.status === 'reserved' && d.canRelease ? html`<button type="button" class="btn danger ghost" data-release>Release reservation</button>` : ''}</div>` : ''}`
        : d.releasedNeedsSuper ? html`<p class="ca-notice">${icon('flag', 16)} This guest's reservation was released. Refer them to the Super Administrator to be seated.</p>`
        : !here && mode !== 'reserve' ? html`<p class="muted">Check the guest in first, then choose their table.</p>${d.role === 'super' && d.canSeat && g.classification !== 'unlisted' ? html`<button type="button" class="btn small-btn" data-reserve>${icon('mapPin', 14)} Reserve a seat…</button> <small class="muted">${g.rsvpWaiting ? 'They said Yes: CORE emails them the table.' : 'Ahead of arrival; kept until they come or you release it.'}</small>` : ''}`
        : !d.canSeat ? html`<p class="muted">Waiting for a table. Their owner or the Super Administrator seats them.</p>` : ''}
        ${choosing ? html`<p class="small">${mode === 'transfer' ? 'Choose the new table, then the chair.' : 'Choose a table, then confirm the chair.'}</p>
          ${recT.length ? html`<h4 class="ca-sub">Recommended</h4><ul class="ca-tables" data-recs>${recT.map(tableBtn)}</ul>` : html`<p class="muted">None of your tables can take this guest. Refer them to the Super Administrator.</p>`}
          ${restT.length ? html`<details class="ca-others" data-other-eligible ${restT.includes(pickT) ? 'open' : ''}><summary>Other eligible tables: ${restT.length}</summary><ul class="ca-tables">${restT.map(tableBtn)}</ul></details>` : ''}
          ${mode === 'transfer' ? html`<button type="button" class="btn ghost" data-cancel-move>Keep the current seat</button>` : mode === 'reserve' ? html`<button type="button" class="btn ghost" data-cancel-move>Cancel</button>` : ''}
          ${othersT.length ? html`<details class="ca-others" data-not-yours><summary>Not yours: ${othersT.length}</summary><ul class="ca-tables">${othersT.map(tableBtn)}</ul></details>` : ''}` : ''}
      </section>
      ${g.mine && g.classification !== 'unlisted' ? html`<section class="ca-step" data-invite-step><h3>Invitation</h3>
        <p>${badge(g.rsvpLabel || 'Not invited yet', RSVP_BADGE[g.rsvpStatus] || 'gray')}${g.rsvpAt ? html` <small class="muted">answered ${fmtManila(g.rsvpAt)}</small>` : ''}
          <small class="muted"> · ${INVITE_TEXT[g.invite?.state || 'none']}${g.invite?.sentAt ? `, ${fmtManila(g.invite.sentAt)}` : ''}${g.invite?.openedAt ? ` · opened ${fmtManila(g.invite.openedAt)}` : ''}${g.invite?.state === 'failed' && g.invite.lastError ? `: ${g.invite.lastError}` : ''}</small></p>
        ${g.rsvpWaiting ? html`<p class="ca-notice">${icon('flag', 16)} Said Yes and has no seat yet: they were told "We will email your table". Reserve a seat above; CORE emails it to them.</p>` : ''}
        ${d.role === 'super' ? html`<div class="actions ca-actions">
          ${g.hasEmail ? html`<button type="button" class="btn small-btn" data-invite>${icon('mail', 14)} ${g.invite?.state && g.invite.state !== 'none' && g.invite.state !== 'revoked' ? 'Send again (new link)' : 'Send invitation'}</button>` : html`<small class="muted">No email address: add one under Setup → Import check, or tell them by phone.</small>`}
          ${g.invite?.state && !['none', 'revoked'].includes(g.invite.state) ? html`<button type="button" class="btn ghost small-btn" data-invite-revoke>Revoke link</button>` : ''}
          ${!here ? html`<button type="button" class="btn ghost small-btn" data-rsvp="yes">Record Yes</button><button type="button" class="btn ghost small-btn" data-rsvp="no">Record No</button>` : ''}</div>` : ''}
      </section>` : ''}
      ${d.capped || d.flags.length || d.devices || (d.role === 'super' && d.staff.length) ? html`<section class="ca-step"><h3>Guest page and owner</h3>
        ${d.capped ? html`<p class="ca-notice">${icon('lock', 16)} The guest page is paused for this surname (too many different wrong numbers in 15 minutes).</p><button type="button" class="btn ${here ? '' : 'primary'} ca-big" data-clear-cap>${here ? 'Clear cap' : html`${icon('check', 18)} Clear cap and check in`}</button>` : ''}
        ${d.flags.map((f) => html`<p class="small">${icon('flag', 14)} ${GUEST_FLAGS[f.kind] || f.kind}, ${fmtManila(f.at)}</p>`)}
        ${d.flags.length && d.role === 'super' ? html`<button type="button" class="btn small-btn" data-flags-seen>Seen</button>` : ''}
        ${d.devices ? html`<p class="small">Guest page open on ${plural(d.devices, 'device')}. <button type="button" class="link-btn" data-revoke>End it on every device</button></p>` : ''}
        ${d.role === 'super' && d.staff.length ? html`<label class="field ca-give"><span>Owner</span><select data-owner><option value="">No owner (your queue)</option>${d.staff.map((x) => option(x.userId, x.name, x.userId === g.ownerUserId))}</select></label>` : ''}
      </section>` : ''}
      ${d.history.length ? html`<details class="ca-history"><summary>History (${d.history.length})</summary><ul>${d.history.map((h) => html`<li><span class="muted">${fmtManila(h.at)}</span> ${HISTORY[h.type] || h.type}, by ${h.by}${h.reason ? ` (${h.reason})` : ''}</li>`)}</ul></details>` : ''}`);
    const on = (sel, fn) => box.querySelectorAll(sel).forEach((b) => b.addEventListener('click', fn));
    on('[data-checkin]', () => send({ type: 'checkIn', guestId }, `${g.displayName} checked in.`));
    on('[data-resend]', () => send({ type: 'notify', guestId }, `Seat email to ${g.displayName} queued again.`));
    const evInfo = { industries: d.industries || [], staff: d.staff.map((x) => ({ ...x, active: true })) };
    on('[data-substitute]', () => recordSubstitute(eventId, evInfo, g, d.role === 'super', () => {
      onChange();
      load();
    }));
    const item = { kind: d.approval?.kind, guest: { id: g.id, name: g.displayName, company: g.company, rev: g.rev }, title: d.substitute?.line || g.displayName, original: d.substitute?.other ? { name: d.substitute.other.name, seat: d.substitute.otherSeat || null } : null };
    on('[data-approve]', () => decideUnlisted(eventId, evInfo, item, () => {
      onChange();
      load();
    }));
    on('[data-reject]', () => rejectUnlisted(eventId, item, () => {
      onChange();
      load();
    }));
    on('[data-clear-cap]', async () => {
      await api.post(`/api/customapp/events/${eventId}/caps/clear`, { guestId });
      if (here) {
        toast('Cap cleared: the guest can use the guest page again.');
        return load();
      }
      send({ type: 'checkIn', guestId }, `${g.displayName} checked in.`);
    });
    on('[data-flags-seen]', () => send({ type: 'guest.update', guestId, clearFlags: true }, 'Marked as seen.'));
    on('[data-revoke]', async () => {
      if (await confirmDialog(`End ${g.displayName}'s guest page on ${plural(d.devices, 'device')}? Their phone shows "Please see the registration desk" until they check in again.`, { confirmLabel: 'End guest page', danger: false })) send({ type: 'revokeTokens', guestId }, 'Guest page ended.');
    });
    box.querySelector('[data-owner]')?.addEventListener('change', (e) => send({ type: 'delegateGuests', ids: [guestId], ownerUserId: e.target.value || null }, e.target.value ? `${g.displayName} given to ${d.staff.find((x) => x.userId === e.target.value)?.name}.` : `${g.displayName} is in your queue.`));
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
      else if (mode === 'reserve') send({ type: 'reserve', guestId, tableId: t.id, seatNo: chosen.seatNo, reason: g.rsvpWaiting ? 'Said Yes on the invitation' : 'Reserved ahead of arrival', expect: { [g.id]: g.rev } }, `${g.displayName}: table ${t.number}${chosen.seatNo ? `, seat ${chosen.seatNo}` : ''} reserved.`);
      else send({ type: 'assign', guestId, tableId: t.id, seatNo: chosen.seatNo, expect: { [g.id]: g.rev } }, `${g.displayName}: table ${t.number}${chosen.seatNo ? `, seat ${chosen.seatNo}` : ''}.`);
    });
    on('[data-move]', () => {
      mode = 'transfer';
      chosen = null;
      load();
    });
    on('[data-reserve]', () => {
      mode = 'reserve';
      chosen = null;
      load();
    });
    // Invitations (0.74, the Super Administrator).
    on('[data-invite]', async () => {
      const again = g.invite?.state && !['none', 'revoked'].includes(g.invite.state);
      if (again && !(await confirmDialog(`Send ${g.displayName}'s invitation again? It goes with a new personal link and QR code; the link in the earlier email stops working. Their answer and seat stay as they are.`, { confirmLabel: 'Send again', danger: false, title: 'Send again' }))) return;
      try {
        await api.post(`/api/customapp/events/${eventId}/invitations/send`, { guestIds: [guestId], opId: opId() });
        toast(`Invitation to ${g.displayName} queued.`);
        onChange();
        load();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    on('[data-invite-revoke]', async () => {
      if (await confirmDialog(`Revoke ${g.displayName}'s invitation link? It stops working at once (their answer and seat stay). Send it again to give them a new one.`, { confirmLabel: 'Revoke link', danger: false })) send({ type: 'revokeInvite', guestId, reason: 'Revoked on the guest sheet' }, 'Invitation link revoked.');
    });
    on('[data-rsvp]', async (e) => {
      const answer = e.currentTarget.dataset.rsvp;
      if (await confirmDialog(answer === 'yes' ? `Record that ${g.displayName} will attend? With seat on Yes on, CORE reserves their seat now and emails them the table.` : `Record that ${g.displayName} cannot attend? A seat their own Yes reserved is released; any other reservation is kept for you to release.`, { confirmLabel: answer === 'yes' ? 'Record Yes' : 'Record No', danger: false })) send({ type: 'rsvp', guestId, answer, reason: 'Answer given to staff' }, `Answer recorded: ${answer === 'yes' ? 'Yes' : 'No'}.`);
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
const RSVP_BADGE = { yes: 'green', no: 'red', opened: 'blue', invited: 'amber', not_invited: 'gray' };
const INVITE_TEXT = { none: 'Invitation not sent', queued: 'Invitation waiting to go', sending: 'Invitation sending', sent: 'Invitation sent', failed: 'Invitation failed', revoked: 'Invitation link revoked' };
const EMAIL_TEXT = { none: 'No email sent yet', not_applicable: 'No email address', queued: 'Seat email waiting to go', sending: 'Seat email sending', sent: 'Seat email sent', failed: 'Seat email failed' };
const HISTORY = { invite: 'Invitation sent', revokeInvite: 'Invitation link revoked', inviteOpened: 'Opened their invitation', rsvp: 'Answered the invitation', createUnlisted: 'Walk-in recorded', approve: 'Approved', reject: 'Not admitted', substitute: 'Substitute recorded', refer: 'Sent to the Super Administrator', notify: 'Seat email sent again', checkIn: 'Checked in', selfCheckIn: 'Checked in on their phone', undoCheckIn: 'Check-in undone', assign: 'Seated', transfer: 'Moved', swap: 'Seats swapped', unseat: 'Sent back to waiting', reserve: 'Seat reserved', release: 'Reservation released', 'guest.update': 'Details changed', import: 'Imported', 'table.relocate': 'Moved with their table' };

// ----- Groups (Tier 2, US-021) -----
// A group arriving together: only tables with room for all of them are offered ("Seat together at
// Table 5"), best first. When none can, the largest parts that fit are offered, and splitting needs
// its own confirm ("Split group"). Guests with different owners are seated by the Super
// Administrator: staff send the group to them.
export function openGroup(eventId, members, onChange = () => {}) {
  const base = `/api/customapp/events/${eventId}`;
  const ids = members.map((m) => m.id);
  const names = members.map((m) => m.displayName || m.name).join(', ');
  const { form, close } = modal({ title: `Seat together (${members.length})`, subtitle: names, body: html`<div class="ca-group-body" aria-live="polite"><p class="muted">Loading…</p></div>`, submitLabel: null, className: 'ca-sheet' });
  const box = form.querySelector('.ca-group-body');
  let notice = '';
  let chosen = null;
  // The first free chairs at a table for each member (no chair number when the event numbers
  // preferred guests only and this guest is not one).
  const chairsFor = (taken, n, need) => {
    const free = [];
    for (let c = 1; free.length < n && c <= 10; c++) if (!taken.includes(c)) free.push(c);
    return ids.slice(0, n).map((id, i) => (need.get(id) ? free[i] ?? null : null));
  };
  async function load() {
    const r = await api.get(`${base}/recommend?guestIds=${encodeURIComponent(ids.join(','))}`);
    const need = new Map((r.seatNoRequired || []).map((x) => [x.guestId, x.required]));
    const g = r.group || { canSeat: true, mixedOwners: false, split: [] };
    const fits = r.mine || [];
    const sendBtn = html`<button type="button" class="btn ca-big" data-send-super>${icon('users', 18)} Send group to Super Administrator</button>`;
    mount(box, html`${notice ? html`<p class="ca-notice" role="alert">${icon('alert', 16)} ${notice}</p>` : ''}
      ${!g.canSeat ? html`<p class="ca-notice">${icon('users', 16)} ${g.mixedOwners ? 'These guests have different owners, so only the Super Administrator can seat them together.' : 'Not all of these guests are yours.'} Each keeps their own check-in; the Super Administrator gets them as one group.</p>${sendBtn}`
        : fits.length ? html`<p class="small">Tables with ${members.length} free chairs together, best first:</p><ul class="ca-tables">${fits.slice(0, 6).map((t) => html`<li><button type="button" class="ca-table ${chosen === t.tableId ? 'on' : ''}" data-gt="${t.tableId}" aria-pressed="${chosen === t.tableId}"><span class="ca-tno">Table ${t.number}</span><span class="grow">${meter({ ...t, capacity: t.claims + t.free })}<small class="ca-why">${t.reasons.join(' · ')}</small></span></button></li>`)}</ul>
          ${chosen ? html`<button type="button" class="btn primary ca-big" data-seat-together>Seat together at Table ${fits.find((t) => t.tableId === chosen)?.number}</button>` : ''}`
        : html`<p class="ca-notice">${icon('alert', 16)} No table ${r.othersReadOnly?.length ? 'of yours ' : ''}has ${members.length} free chairs together.</p>
          ${g.split?.length ? html`<p class="small">Alternative: split the group over ${g.split.length} tables, the largest parts first. They will not all sit together.</p>
            <p class="ca-split">${g.split.map((p) => `Table ${p.number}: ${plural(p.size, 'guest')}`).join(' · ')}</p>
            <button type="button" class="btn ca-big" data-split>Split group…</button>` : html`<p class="muted">Not even split: refer them to the Super Administrator.</p>`}
          ${r.othersReadOnly?.length ? html`<p class="muted small">Other people's tables that fit: ${r.othersReadOnly.slice(0, 5).map((t) => t.number).join(', ')} (ask their owner or the Super Administrator).</p>` : ''}
          ${sendBtn}`}`);
    box.querySelectorAll('[data-gt]').forEach((b) => b.addEventListener('click', () => {
      chosen = b.dataset.gt;
      notice = '';
      load();
    }));
    const seat = async (placements, allowSplit, done) => {
      try {
        await api.post(`${base}/commands`, { type: 'assign', placements, ...(allowSplit ? { allowSplit: true } : {}), opId: opId() });
        toast(done);
        close();
        onChange();
      } catch (err) {
        if (!err.code && err.status !== 400) throw err;
        notice = err.code === 'table_full' || err.code === 'seat_taken' ? 'That table just changed on another device. Updated options:' : err.message;
        chosen = null;
        load();
      }
    };
    box.querySelector('[data-seat-together]')?.addEventListener('click', () => {
      const t = fits.find((x) => x.tableId === chosen);
      const seats = chairsFor(t.taken || [], members.length, need);
      seat(ids.map((id, i) => ({ guestId: id, tableId: t.tableId, seatNo: seats[i] })), false, `${plural(members.length, 'guest')} seated together at table ${t.number}.`);
    });
    box.querySelector('[data-split]')?.addEventListener('click', async () => {
      const parts = g.split;
      if (!(await confirmDialog(`Split the group? ${parts.map((p) => `${plural(p.size, 'guest')} at table ${p.number}`).join(', ')}. They will not all sit together.`, { confirmLabel: 'Split group', danger: false, title: 'Split group' }))) return;
      const placements = [];
      let k = 0;
      for (const p of parts) {
        const free = [];
        for (let c = 1; free.length < p.size && c <= 10; c++) if (!(p.taken || []).includes(c)) free.push(c);
        for (let i = 0; i < p.size; i++, k++) placements.push({ guestId: ids[k], tableId: p.tableId, seatNo: need.get(ids[k]) ? free[i] : null });
      }
      seat(placements, true, `Group split over tables ${parts.map((p) => p.number).join(' and ')}.`);
    });
    box.querySelector('[data-send-super]')?.addEventListener('click', async () => {
      try {
        await api.post(`${base}/commands`, { type: 'refer', guestIds: ids, reason: 'Seat together', opId: opId() });
        toast('Sent to the Super Administrator to seat together.');
        close();
        onChange();
      } catch (err) {
        notice = err.message;
        load();
      }
    });
  }
  load().catch((err) => mount(box, html`<p class="form-error">${err.message}</p>`));
  return close;
}
// Checkboxes on waiting guests, and the bar that seats them together.
function groupPicker(el, eventId, { onChange, getGuests }) {
  const picked = new Set();
  const bar = el.querySelector('[data-groupbar]');
  const sync = () => {
    const shown = new Map(getGuests().map((g) => [g.id, g]));
    for (const id of [...picked]) if (!shown.has(id)) picked.delete(id);
    el.querySelectorAll('[data-pick]').forEach((c) => {
      c.checked = picked.has(c.dataset.pick);
    });
    if (!bar) return;
    bar.hidden = picked.size < 2;
    mount(bar, html`<span class="grow">${plural(picked.size, 'guest')} selected</span><button type="button" class="btn ghost small-btn" data-pick-clear>Clear</button><button type="button" class="btn primary" data-seat-group>${icon('users', 16)} Seat together (${picked.size})</button>`);
    bar.querySelector('[data-pick-clear]').addEventListener('click', () => {
      picked.clear();
      sync();
    });
    bar.querySelector('[data-seat-group]').addEventListener('click', () => {
      const shownNow = new Map(getGuests().map((g) => [g.id, g]));
      openGroup(eventId, [...picked].map((id) => shownNow.get(id)).filter(Boolean), () => {
        picked.clear();
        sync();
        onChange();
      });
    });
  };
  return {
    wire() {
      el.querySelectorAll('[data-pick]').forEach((c) => c.addEventListener('change', () => {
        if (c.checked) picked.add(c.dataset.pick);
        else picked.delete(c.dataset.pick);
        sync();
      }));
      sync();
    },
  };
}
const pickBox = (g) => html`<label class="ca-pick" title="Select for a group"><input type="checkbox" data-pick="${g.id}" aria-label="Select ${g.displayName} for a group" /></label>`;

// ----- Walk-ins and substitutes (Tier 2, US-022) -----
const industryOptions = (ev, sel = '') => html`<option value="">Not known</option>${(ev.industries || []).filter((i) => i.active !== false).map((i) => option(i.id, i.name, i.id === sel))}`;
const personFields = (ev, { industry = true } = {}) => html`<div class="ca-pair"><label class="field"><span>First name</span><input name="first" maxlength="80" autocomplete="off" /></label><label class="field"><span>Surname <em>*</em></span><input name="last" required maxlength="80" autocomplete="off" /></label></div>
  <div class="ca-pair"><label class="field"><span>Company</span><input name="company" maxlength="160" /></label><label class="field"><span>Designation</span><input name="designation" maxlength="120" /></label></div>
  ${industry ? html`<label class="field"><span>Industry</span><select name="industryId">${industryOptions(ev)}</select></label>` : ''}
  <div class="ca-pair"><label class="field"><span>Email (for their seat by email)</span><input type="email" name="email" maxlength="254" /></label><label class="field"><span>Mobile</span><input type="tel" name="mobile" maxlength="40" /></label></div>`;
const personOf = (f) => ({ first: f.first.value, last: f.last.value, company: f.company.value, designation: f.designation.value, email: f.email.value, mobile: f.mobile.value, ...(f.industryId ? { industryId: f.industryId.value || null } : {}) });
export function addWalkIn(eventId, ev, onChange = () => {}) {
  modal({
    title: 'Add walk-in',
    subtitle: 'Someone who is not on the guest list. They are not checked in yet: the Super Administrator approves (or not) and chooses how they are seated.',
    body: html`${personFields(ev)}<label class="field"><span>Note for the Super Administrator <em>*</em></span><input name="note" required maxlength="300" placeholder="e.g. Says she is with Northbay Bank; invited by Mr. Santos" /></label>`,
    submitLabel: 'Send for approval',
    onSubmit: async (f) => {
      await api.post(`/api/customapp/events/${eventId}/commands`, { type: 'createUnlisted', guest: personOf(f), note: f.note.value, opId: opId() });
      toast('Sent to the Super Administrator for approval.');
      onChange();
    },
  });
}
function recordSubstitute(eventId, ev, g, sa, onChange) {
  const seatText = g.seat ? `table ${g.seat.number}${g.seat.seatNo ? `, seat ${g.seat.seatNo}` : ''}` : '';
  modal({
    title: 'Record substitute',
    subtitle: `Someone here instead of ${g.displayName}. ${sa ? 'As the Super Administrator, this approves them at once.' : 'The Super Administrator approves it; until then nothing changes.'}`,
    body: html`${personFields(ev, { industry: false })}
      ${sa && g.seat ? html`<fieldset class="field ca-seat-choice"><legend>${g.displayName}'s seat (${seatText})</legend><label class="field check"><input type="radio" name="seat" value="transfer" checked /><span>Give it to the substitute</span></label><label class="field check"><input type="radio" name="seat" value="release" /><span>Release it (the substitute waits for a table)</span></label></fieldset>` : ''}
      <label class="field"><span>Note <em>*</em></span><input name="note" required maxlength="300" placeholder="e.g. Pedro is unwell; his son Juan comes instead" /></label>`,
    submitLabel: sa ? 'Record and approve' : 'Send for approval',
    onSubmit: async (f) => {
      await api.post(`/api/customapp/events/${eventId}/commands`, { type: 'substitute', originalId: g.id, newGuest: personOf(f), note: f.note.value, ...(f.seat ? { seat: f.seat.value } : {}), opId: opId() });
      toast(sa ? `Substitute approved${g.seat && (!f.seat || f.seat.value === 'transfer') ? `: ${seatText} is theirs now` : ''}.` : 'Sent to the Super Administrator for approval.');
      onChange();
    },
  });
}
// The Super Administrator's decision on a walk-in or a substitute.
export function decideUnlisted(eventId, ev, item, onChange = () => {}) {
  const sub = item.kind === 'substitute';
  const g = item.guest;
  const staff = ev.staff || [];
  modal({
    title: sub ? 'Approve substitute' : 'Approve walk-in',
    subtitle: sub ? item.title : `${g.name}${g.company ? `, ${g.company}` : ''}`,
    body: html`${sub ? (item.original?.seat ? html`<fieldset class="field ca-seat-choice"><legend>${item.original.name}'s seat (table ${item.original.seat.number}${item.original.seat.seatNo ? `, seat ${item.original.seat.seatNo}` : ''})</legend><label class="field check"><input type="radio" name="seat" value="transfer" checked /><span>Give it to ${g.name}</span></label><label class="field check"><input type="radio" name="seat" value="release" /><span>Release it (${g.name} waits for a table)</span></label></fieldset>` : html`<p class="small">${item.original?.name} has no seat yet: ${g.name} takes their place and waits for a table.</p>`)
        : html`<label class="field"><span>Seat them as <em>*</em></span><select name="classification" required><option value="">Choose…</option>${['regular', 'preferred', 'employee'].map((c) => option(c, CLASS_LABELS[c]))}</select></label>
          <label class="field"><span>Industry</span><select name="industryId">${industryOptions(ev)}</select></label>`}
      <label class="field"><span>Owner</span><select name="owner"><option value="">${sub ? 'As the invitee' : 'No owner (your queue)'}</option>${staff.filter((x) => x.active).map((x) => option(x.userId, x.name))}</select></label>
      <label class="field"><span>Note</span><input name="note" maxlength="300" placeholder="e.g. Confirmed with the host" /></label>`,
    submitLabel: 'Approve',
    onSubmit: async (f) => {
      await api.post(`/api/customapp/events/${eventId}/commands`, { type: 'approve', guestId: g.id, note: f.note.value, ...(sub ? { seat: f.seat?.value || 'transfer' } : { classification: f.classification.value, industryId: f.industryId.value || null }), ...(f.owner.value ? { ownerUserId: f.owner.value } : {}), expect: { [g.id]: g.rev }, opId: opId() });
      toast(sub ? `${g.name} approved.` : `${g.name} approved and checked in.`);
      onChange();
    },
  });
}
export function rejectUnlisted(eventId, item, onChange = () => {}) {
  modal({
    title: 'Not admitted',
    subtitle: item.title,
    body: html`<label class="field"><span>Reason <em>*</em></span><input name="note" required maxlength="300" placeholder="e.g. Not known to the host" /></label>`,
    submitLabel: 'Do not admit',
    onSubmit: async (f) => {
      await api.post(`/api/customapp/events/${eventId}/commands`, { type: 'reject', guestId: item.guest.id, note: f.note.value, opId: opId() });
      toast('Recorded: not admitted.');
      onChange();
    },
  });
}

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
  registrationOpen: [`Turn on self check-in? Guests can check themselves in on the guest page while the event's window is open.`, 'Turn off self check-in? Guests will be sent to the desk.'],
  emailPaused: ['Pause email? Assignments are shown on screen and told by staff; messages wait and go when email is on again.', 'Turn email on? Waiting seat emails go out now, from the event\'s own address.'],
  readOnly: ['Make the event read only? Nobody can check in or seat anyone until it is turned off (use it while reconciling paper).', 'Turn read only off? Check-in and seating work again.'],
};
const INBOX_KIND = { alarm: 'Guest page alarm', walkin: 'Walk-in', substitute: 'Substitute', no_seat_in_scope: 'No seat in scope', no_seat: 'No eligible seat', released_arrived: 'Released, arrived', group: 'Group', capped: 'Guest page paused', email_failed: 'Email failed', rsvp_no_seat: 'Yes, no seat', rsvp_no_reserved: 'No, seat held', invite_failed: 'Invitation failed' };
// Event control (US-024): the counts, the exceptions inbox, the health strip, the room plan, the
// staff and their queues, the switches, the exports, the offline pack and paper reconciliation. The
// counts, inbox, health and workload refresh by the same short poll as every screen (tab=control).
export async function eventControlView(el, params, query) {
  const { events, canCreate, id } = await pickEvent(query);
  if (!id) return mount(el, noEvent(canCreate));
  const ev = await api.get(`/api/customapp/events/${id}`);
  const sa = ev.role === 'super';
  const base = `/api/customapp/events/${id}`;
  const blockedIssues = ev.issues && ev.issues.total > (ev.importAck?.count ?? -1) ? ev.issues.total : 0;
  mount(el, html`${head(html`${icon('toggles', 22)} Event control`, ev, events)}
    ${sa ? html`<div class="ca-sticky" data-bar role="status"><span class="grow"><strong>${ev.name}</strong> · Event control</span><span data-age>Loading…</span></div>` : ''}
    <div class="stats ca-stats" data-counts aria-label="Counts"></div>
    <div data-alarm></div>
    ${sa ? html`<section class="card ca-health" aria-label="Health" data-health></section>
      <section class="card ca-inbox" aria-labelledby="ca-inbox-h"><h2 id="ca-inbox-h">${icon('inbox')} Exceptions <span class="ca-n" data-ninbox></span></h2><div data-inbox><p class="muted">Loading…</p></div></section>
      <section class="card ca-invites" id="ca-invites" aria-labelledby="ca-inv-h"><h2 id="ca-inv-h">${icon('mail')} Invitations</h2>
        <p class="muted small">Each guest gets their own link by email (a button, the address, and a QR code). They answer Yes or No on it; on Yes their seat is reserved at once and emailed to them. On the night the same link, or its QR code, checks them in at the door.</p>
        <div data-invites><p class="muted">Loading…</p></div></section>` : ''}
    <section class="card ca-room-card"><h2>${icon('mapPin')} Room plan</h2><p class="muted small">${sa ? 'Choose a seated chair to move a guest (choose an open chair for a transfer, or a taken one to swap), send them back to waiting, or release a reservation.' : 'Your tables, and everyone else\'s to look at.'}</p><div data-plan-host></div></section>
    ${sa ? html`<section class="card"><h2>${icon('users')} Staff and their queues</h2>
      <p class="muted small">Who has how many guests waiting, for how long, and when they last did anything. <strong>Move to…</strong> gives all of one person's guests and tables to someone else at once (an absent staffer); <strong>One by one…</strong> moves single guests or tables. Seats and check-ins stay as they are.</p>
      <div data-work></div></section>
      <details class="card ca-tables-card"><summary><h2>${icon('grid')} Tables: take out of use, or move their guests</h2></summary>
        <p class="muted small">A table with guests cannot be taken out of use: move its guests to another table first (one change: every guest keeps their chair number where it is free).</p>
        <div class="table-scroll"><table class="table ca-ttable"><thead><tr><th>Table</th><th>Type</th><th>Guests</th><th>Owner</th><th></th></tr></thead><tbody>
          ${ev.tables.map((t) => html`<tr><td>${t.number}</td><td>${CLASS_LABELS[t.classification]}</td><td>${t.claims} of ${t.capacity}${t.active ? '' : ' (not in use)'}</td><td>${t.ownerName || '–'}</td>
            <td class="ca-tact">${t.active ? html`<button type="button" class="btn small-btn" data-off="${t.id}" ${t.claims ? 'disabled' : ''} title="${t.claims ? 'This table has guests: move them first' : ''}">Take out of use</button>${t.claims ? html` <button type="button" class="btn small-btn" data-move-guests="${t.id}">Move guests…</button>` : ''}` : html`<button type="button" class="btn small-btn" data-on="${t.id}">Use again</button>`}</td></tr>`)}
        </tbody></table></div></details>` : ''}
    <section class="card"><h2>${icon('shield')} Super Administrator</h2>
      <p><strong>${ev.superAdmin.name || 'Nobody'}</strong>: the one account with authority over every guest and table of this event. Staff work on the guests and tables given to them.</p>
      ${can('customapp.manage') ? html`<button type="button" class="btn" id="ca-handover">${icon('key', 16)} Hand over the Super Administrator…</button>` : ''}
    </section>
    <section class="card"><h2>${icon('toggles')} Switches</h2>
      <p class="muted small">They take effect on the next request, with no restart. ${sa ? 'Each change is in the audit log.' : 'Only the Super Administrator changes them.'}</p>
      <ul class="ca-flags">${['registrationOpen', 'emailPaused', 'readOnly'].map((f) => {
        // Self check-in cannot open while the import check has issues nobody acknowledged.
        const held = f === 'registrationOpen' && !ev.flags[f] && blockedIssues;
        return html`<li><label class="switch"><input type="checkbox" data-flag="${f}" ${ev.flags[f] ? 'checked' : ''} ${sa && !held ? '' : 'disabled'} /> <span>${FLAG_LABELS[f]}: <strong class="state">${ev.flags[f] ? 'On' : 'Off'}</strong>${held ? html` <small class="muted">· ${plural(blockedIssues, 'issue')} to resolve (<a href="#/customapp/setup?e=${id}">Setup → Import check</a>)</small>` : ''}${f === 'emailPaused' && sa && !ev.settings?.emailFrom ? html` <small class="muted">· no From address yet (<a href="#/customapp/setup?e=${id}">Setup → Event</a>)</small>` : ''}</span></label></li>`;
      })}
        <li><label class="field ca-poll"><span>${FLAG_LABELS.pollMs}</span><input type="number" min="1000" max="30000" step="500" value="${ev.flags.pollMs}" data-poll ${sa ? '' : 'disabled'} /></label><small class="muted">Staff screens ask this often; a guest's page waiting for a table twice as often, once seated five times.</small></li>
        <li><label class="switch"><input type="checkbox" data-qrkey ${ev.qrKey ? 'checked' : ''} ${sa ? '' : 'disabled'} /> <span>Presence key on the reception QR: <strong class="state">${ev.qrKey ? 'On' : 'Off'}</strong> <small class="muted">· only after load test 1 passes</small></span></label></li></ul>
      ${sa ? html`<p><button type="button" class="btn" id="ca-qr">${icon('grid', 16)} Reception QR sheet</button> <a class="small" href="/event/${ev.code}" target="_blank" rel="noopener">Guest page: /event/${ev.code}</a></p>` : ''}
      ${ev.window?.opensAt ? html`<p class="small">Window: ${fmtManila(ev.window.opensAt)} to ${ev.window.closesAt ? fmtManila(ev.window.closesAt) : 'the end of the day'} (Manila time) · status ${ev.status}</p>` : html`<p class="small muted">No window set yet (Setup).</p>`}
    </section>
    ${sa ? html`<section class="card"><h2>${icon('download')} Exports, the printed plan and the offline pack</h2>
      <p class="muted small">The JSON export (format customapp.event/1) is the event's recovery copy: every guest, every seat claim, the change log, with a fingerprint (sha256). The CSV files, the seating plan and the offline pack are made from it. Each download is in the audit log.</p>
      <div class="actions ca-actions"><button type="button" class="btn" data-dl="json">${icon('download', 16)} Event export (JSON)</button>
        <a class="btn" href="${base}/export.csv?kind=guests" download>${icon('table', 16)} Guests (CSV)</a>
        <a class="btn" href="${base}/export.csv?kind=seating" download>${icon('table', 16)} Seating (CSV)</a>
        <a class="btn" href="${base}/plan.html" target="_blank" rel="noopener">${icon('file', 16)} Printable seating plan</a>
        <a class="btn" href="${base}/pack.html" target="_blank" rel="noopener" data-pack>${icon('file', 16)} Offline pack (print)</a></div>
      <p class="muted small">The offline pack: the room, an A–Z list, a sheet for each table and for each staff member, and the desk and easel cards, every page stamped "as of" the time it was printed.</p></section>
      <section class="card" id="ca-reconcile"><h2>${icon('clipboard')} Reconcile paper seating</h2>
        <p class="muted small">After working on paper: one line per entry, <strong>time, ref, table, chair</strong> (for example <code>19:05, DEMO-0054, 5, 3</code>; leave table and chair out for a check-in only). Each line goes through the same rules as on screen (also while <strong>Read only</strong> is on), so a table is never overbooked; a line that cannot be entered comes back as a card to resolve. Entering the same sheet twice changes nothing the second time.</p>
        <label class="field"><span class="sr-only">Paper entries</span><textarea rows="5" data-paper placeholder="19:05, DEMO-0054, 5, 3"></textarea></label>
        <div class="actions"><button type="button" class="btn primary" data-reconcile>Enter paper entries</button></div><div data-recon-out aria-live="polite"></div></section>
      <section class="card"><h2>${icon('checkCircle')} Seating rules check</h2><p class="muted small">Checks every rule at once: no table over its chairs, no chair held twice, no guest with two seats, one Super Administrator, owners who are staff.</p>
        <button type="button" class="btn" id="ca-check">Check now</button> <span id="ca-check-out" aria-live="polite"></span></section>` : ''}`);
  wireSwitcher(el, '/customapp/control');
  const stopPlan = mountRoomPlan(el.querySelector('[data-plan-host]'), id);
  const cmd = (body) => api.post(`${base}/commands`, { ...body, opId: opId() });
  let board = { counts: ev.counts, exceptions: ev.exceptions || [], workload: ev.workload || [], health: ev.health, alarm: ev.alarm };
  const staffOpts = (exceptId) => (board.workload || []).filter((x) => x.userId !== exceptId).map((x) => option(x.userId, x.isSuper ? `${x.name} (no owner)` : x.name));

  // ----- The live parts -----
  function drawCounts() {
    const c = board.counts;
    mount(el.querySelector('[data-counts]'), html`
      <div class="card"><small>Invited</small><strong>${c.invited}</strong></div>
      <div class="card"><small>Checked in</small><strong>${c.checkedIn}</strong></div>
      <div class="card"><small>Not yet arrived</small><strong>${c.notArrived}</strong></div>
      <div class="card ${c.waiting ? 'attention' : ''}"><small>Waiting for table</small><strong>${c.waiting}</strong></div>
      <div class="card ${c.needsApproval ? 'attention' : ''}"><small>Needs approval</small><strong>${c.needsApproval ?? 0}</strong></div>
      ${c.rsvp && c.rsvp.sent + c.rsvp.queued + c.rsvp.failed ? html`<div class="card" data-rsvp-card><small>RSVP</small><strong>${c.rsvp.yes} yes</strong><small class="muted">${c.rsvp.no} no · ${c.rsvp.noReply} no reply · ${c.rsvp.opened} opened</small></div>` : ''}
      <div class="card"><small>Seats left</small><strong>${c.seatsLeft} of ${c.capacity}</strong><small class="muted">${c.seated} seated · ${c.reserved} reserved</small></div>`);
    mount(el.querySelector('[data-alarm]'), sa && board.alarm ? html`<p class="ca-notice" role="alert">${icon('alert', 16)} <span><strong>${board.alarm.failures} failed guest page checks in the last 5 minutes.</strong> Nobody is locked out. Guests who show a code (R-1234) are helped at the desk: Find guest, type the code.</span></p>` : '');
  }
  function drawHealth() {
    const hb = el.querySelector('[data-health]');
    if (!hb) return;
    const h = board.health || {};
    const o = h.outbox || { queued: 0, sending: 0, failed: 0, sent: 0 };
    const v = h.check?.violations || [];
    mount(hb, html`<h2>${icon('activity')} Health</h2><div class="ca-health-row">
      <span><small>Change number</small><strong data-h="seq">${h.seq ?? ev.seq}</strong></span>
      <span><small>Save time (p95)</small><strong data-h="save">${h.saveP95Ms == null ? '–' : `${h.saveP95Ms} ms`}</strong></span>
      <span><small>Email outbox</small><strong data-h="outbox">${h.emailPaused ? `Paused · ${o.queued} waiting` : `${o.queued + o.sending} to send${o.failed ? ` · ${o.failed} failed` : ''}`}</strong></span>
      <span><small>Newest 5-minute copy</small><strong data-h="copy">${h.copy?.at ? ageText(h.copy.at) : ev.status === 'live' ? 'Not yet' : 'Only while live'}</strong></span>
      <span><small>Too many requests (15 min)</small><strong data-h="429">${h.tooMany ?? 0}</strong></span>
      <span><small>Seating rules (every minute)</small><strong data-h="check">${h.check ? (v.length ? html`<span class="badge red">${plural(v.length, 'problem')}</span>` : html`<span class="badge green">All hold</span>`) : ev.status === 'live' ? 'Not checked yet' : 'Only while live'}</strong></span></div>
      ${v.length ? html`<p class="ca-notice ca-banner" role="alert">${icon('alert', 16)} <span><strong>The seating rules check found ${plural(v.length, 'problem')}.</strong> ${v.map((x) => x.detail).join(' ')} Call the on-call developer; keep seating on paper for the tables named.</span></p>` : ''}`);
  }
  function drawInbox() {
    const box = el.querySelector('[data-inbox]');
    if (!box) return;
    const items = board.exceptions || [];
    el.querySelector('[data-ninbox]').textContent = `(${items.length})`;
    mount(box, items.length ? html`<ul class="ca-inbox-list">${items.map((it, i) => html`<li class="ca-inbox-item ca-k-${it.kind}" data-item="${i}"><span class="badge ${it.kind === 'alarm' || it.kind === 'no_seat' || it.kind === 'rsvp_no_seat' ? 'red' : 'amber'}">${INBOX_KIND[it.kind] || it.kind}</span>
        <span class="grow"><strong>${it.title}</strong><small>${it.detail}${it.at ? ` · ${fmtManila(it.at, { date: false })}` : ''}</small></span>
        <span class="actions">${it.kind === 'walkin' || it.kind === 'substitute' ? html`<button type="button" class="btn primary small-btn" data-ia="approve">Approve…</button><button type="button" class="btn small-btn" data-ia="reject">Do not admit…</button>`
          : it.kind === 'group' ? html`<button type="button" class="btn primary small-btn" data-ia="group">Seat together</button>`
          : it.kind === 'capped' ? html`<button type="button" class="btn small-btn" data-ia="clear">Clear</button>`
          : it.kind === 'email_failed' ? html`<button type="button" class="btn small-btn" data-ia="resend">Resend</button>`
          : it.kind === 'invite_failed' ? html`<button type="button" class="btn small-btn" data-ia="open">Open</button>`
          : it.guestIds?.length ? html`<button type="button" class="btn small-btn" data-ia="open">Open</button>` : ''}</span></li>`)}</ul>`
      : html`<p class="ca-empty-q">${icon('checkCircle', 16)} Nothing needs you right now.</p>`);
    box.querySelectorAll('[data-ia]').forEach((b) => b.addEventListener('click', async () => {
      const it = items[Number(b.closest('[data-item]').dataset.item)];
      const done = () => poll.reset();
      try {
        if (b.dataset.ia === 'approve') decideUnlisted(id, ev, it, done);
        else if (b.dataset.ia === 'reject') rejectUnlisted(id, it, done);
        else if (b.dataset.ia === 'group') openGroup(id, it.guests.map((g) => ({ id: g.id, displayName: g.name })), done);
        else if (b.dataset.ia === 'open') openGuest(id, it.guestIds[0], done);
        else if (b.dataset.ia === 'clear') {
          await api.post(`${base}/caps/clear`, { guestId: it.guestIds[0] });
          toast('Cap cleared: the guest page works again for that surname.');
          done();
        } else if (b.dataset.ia === 'resend') {
          await cmd({ type: 'notify', guestId: it.guestIds[0] });
          toast('Seat email queued again.');
          done();
        }
      } catch (err) {
        toast(err.message, 'error');
      }
    }));
  }
  function drawWork() {
    const box = el.querySelector('[data-work]');
    if (!box) return;
    const w = board.workload || [];
    mount(box, html`<div class="table-scroll"><table class="table ca-work"><thead><tr><th>Staff</th><th>Waiting</th><th>Longest wait</th><th>Last active</th><th>Guests</th><th>Tables</th><th>Move to…</th></tr></thead><tbody>
      ${w.map((x) => html`<tr><td>${x.name}${x.isSuper ? ' (you)' : ''}</td><td>${x.waiting}</td><td>${x.longestSince ? `${minutesSince(x.longestSince)} min` : '–'}</td><td>${x.lastActive ? ageText(x.lastActive) : '–'}</td><td>${x.guests}</td><td>${x.tables.join(', ') || '–'}</td>
        <td class="ca-tact">${x.guests || x.tables.length ? html`<select data-move-from="${x.userId}" aria-label="Move all of ${x.name}'s guests and tables to"><option value="">All to…</option>${staffOpts(x.userId)}</select> <button type="button" class="btn small-btn" data-one-by-one="${x.userId}">One by one…</button>` : ''}</td></tr>`)}
    </tbody></table></div>`);
    box.querySelectorAll('[data-move-from]').forEach((sel) => sel.addEventListener('change', async () => {
      const from = w.find((x) => x.userId === sel.dataset.moveFrom);
      const to = w.find((x) => x.userId === sel.value);
      if (!to) return;
      if (!(await confirmDialog(`Give all of ${from.name}'s guests (${from.guests}) and tables (${from.tables.join(', ') || 'none'}) to ${to.isSuper ? 'nobody (your queue)' : to.name}? Their seats and check-ins stay as they are; ${from.name} can no longer seat them.`, { confirmLabel: 'Move', danger: false, title: 'Move to…' }))) return (sel.value = '');
      try {
        const owner = to.isSuper ? null : to.userId;
        if (from.guests) await cmd({ type: 'delegateGuests', fromUserId: from.userId, ownerUserId: owner, reason: 'Moved on Event control' });
        if (from.tables.length) await cmd({ type: 'delegateTables', fromUserId: from.userId, ownerUserId: owner, reason: 'Moved on Event control' });
        toast(`${from.name}'s guests and tables are ${to.isSuper ? 'in your queue' : `${to.name}'s`} now.`);
        poll.reset();
      } catch (err) {
        sel.value = '';
        toast(err.message, 'error');
      }
    }));
    box.querySelectorAll('[data-one-by-one]').forEach((b) => b.addEventListener('click', () => {
      const from = w.find((x) => x.userId === b.dataset.oneByOne);
      const { form } = modal({
        title: `${from.name}: move single guests or tables`,
        subtitle: 'Each move is saved at once. Seats and check-ins stay as they are.',
        body: html`<h3 class="ca-sub">Waiting guests (${from.waitingGuests.length})</h3>${from.waitingGuests.length ? html`<ul class="ca-list ca-move-list">${from.waitingGuests.map((g) => html`<li><span class="grow"><strong>${g.name}</strong><small>${g.since ? `waiting ${minutesSince(g.since)} min` : ''}</small></span><select data-mg="${g.id}" aria-label="Move ${g.name} to"><option value="">Move to…</option>${staffOpts(from.userId)}</select></li>`)}</ul>` : html`<p class="muted">None waiting.</p>`}
          <h3 class="ca-sub">Tables (${from.tableIds.length})</h3>${from.tableIds.length ? html`<ul class="ca-list ca-move-list">${from.tableIds.map((t) => html`<li><span class="grow"><strong>Table ${t.number}</strong><small>${plural(t.claims, 'guest')}</small></span><select data-mt="${t.id}" aria-label="Move table ${t.number} to"><option value="">Move to…</option>${staffOpts(from.userId)}</select></li>`)}</ul>` : html`<p class="muted">No tables.</p>`}`,
        submitLabel: null,
      });
      const ownerOf = (v) => (w.find((x) => x.userId === v)?.isSuper ? null : v);
      form.querySelectorAll('[data-mg]').forEach((sel) => sel.addEventListener('change', async () => {
        if (!sel.value) return;
        try {
          await cmd({ type: 'delegateGuests', ids: [sel.dataset.mg], ownerUserId: ownerOf(sel.value), reason: 'Moved on Event control' });
          sel.closest('li').classList.add('ca-moved-ok');
          sel.disabled = true;
          toast('Guest moved.');
          poll.reset();
        } catch (err) {
          sel.value = '';
          toast(err.message, 'error');
        }
      }));
      form.querySelectorAll('[data-mt]').forEach((sel) => sel.addEventListener('change', async () => {
        if (!sel.value) return;
        try {
          await cmd({ type: 'delegateTables', ids: [sel.dataset.mt], ownerUserId: ownerOf(sel.value), reason: 'Moved on Event control' });
          sel.closest('li').classList.add('ca-moved-ok');
          sel.disabled = true;
          toast('Table moved.');
          poll.reset();
        } catch (err) {
          sel.value = '';
          toast(err.message, 'error');
        }
      }));
    }));
  }
  // ----- Invitations (0.74) -----
  let invites = null;
  let invitesAt = 0;
  async function loadInvites() {
    if (!sa) return;
    invitesAt = Date.now();
    try {
      invites = await api.get(`${base}/invitations`);
      drawInvites();
    } catch (err) {
      mount(el.querySelector('[data-invites]'), html`<p class="form-error">${err.message}</p>`);
    }
  }
  const sentLike = (st) => ['queued', 'sending', 'sent', 'failed'].includes(st);
  function drawInvites() {
    const box = el.querySelector('[data-invites]');
    const d = invites;
    if (!box || !d) return;
    const c = d.counts;
    const blocks = d.warnings.filter((w) => w.level === 'block');
    const warns = d.warnings.filter((w) => w.level === 'warn');
    const infos = d.warnings.filter((w) => w.level === 'info');
    const closes = d.rsvpClosesAt ? (d.settings.rsvpDeadline && d.settings.rsvpDeadline <= d.rsvpClosesAt ? `replies close ${fmtManila(d.rsvpClosesAt)}` : `replies close when self check-in opens, ${fmtManila(d.rsvpClosesAt)}`) : 'no reply deadline';
    mount(box, html`<div class="ca-health-row ca-inv-counts" data-inv-counts>
        ${[['Not invited yet', c.notInvited], ['Waiting to go', c.queued], ['Sent', c.sent], ['Failed', c.failed], ['Opened', c.opened], ['Yes', c.yes], ['No', c.no], ['No reply', c.noReply], ['Yes, no seat yet', c.waitingTable], ['No email address', c.noEmail]].map(([l, n]) => html`<span><small>${l}</small><strong>${n}</strong></span>`)}</div>
      ${blocks.length ? html`<div class="ca-notice ca-inv-warn" role="alert">${icon('alert', 16)} <div><strong>Before sending:</strong><ul>${blocks.map((w) => html`<li data-warn="${w.code}">${w.text}</li>`)}</ul></div></div>` : ''}
      ${warns.length ? html`<div class="ca-notice ca-inv-warn">${icon('alert', 16)} <ul>${warns.map((w) => html`<li data-warn="${w.code}">${w.text}</li>`)}</ul></div>` : ''}
      ${infos.map((w) => html`<p class="small muted ca-inv-info" data-warn="${w.code}">${icon('flag', 14)} ${w.text}</p>`)}
      <p class="small">From <strong>${d.from || 'no address yet'}</strong>${d.replyTo ? ` · replies to ${d.replyTo}` : ''} · links on <strong>${d.linkBase}</strong> · ${closes} · seat on Yes <strong>${d.settings.autoSeatOnConfirm ? 'on' : 'off'}</strong></p>
      <div class="actions ca-actions">
        <button type="button" class="btn primary" data-inv-send ${blocks.length || !c.notInvited ? 'disabled' : ''}>${icon('mail', 16)} Send invitations (${c.notInvited})</button>
        <button type="button" class="btn" data-inv-preview>${icon('eye', 16)} Preview</button>
        <button type="button" class="btn" data-inv-test>Send a test…</button>
        <button type="button" class="btn" data-inv-settings>${icon('settings', 16)} Invitation settings…</button></div>
      ${c.noEmail ? html`<details class="ca-inv-noemail"><summary>No email address (${c.noEmail}): tell them another way, or add an address</summary><ul class="ca-list">${d.guests.filter((g) => !g.hasEmail).map((g) => html`<li><span class="grow"><strong>${g.name}</strong><small>${g.ref}${g.company ? ` · ${g.company}` : ''}</small></span><button type="button" class="btn small-btn" data-inv-email="${g.id}">Add email</button></li>`)}</ul></details>` : ''}
      <details class="ca-inv-list"><summary>Every guest's RSVP (${d.guests.length})</summary><div class="table-scroll"><table class="table ca-inv-table"><thead><tr><th>Guest</th><th>RSVP</th><th>Invitation</th><th>Seat</th><th></th></tr></thead><tbody>
        ${d.guests.map((g) => html`<tr data-inv-row="${g.id}"><td><button type="button" class="link-btn" data-inv-open="${g.id}">${g.name}</button><br><small class="muted">${g.ref}${g.listRsvp ? ` · list says ${g.listRsvp}` : ''}</small></td>
          <td>${badge(g.rsvpLabel, RSVP_BADGE[g.rsvpStatus] || 'gray')}</td>
          <td>${g.hasEmail ? INVITE_TEXT[g.invite.state] || g.invite.state : 'No email address'}${g.invite.state === 'failed' && g.invite.lastError ? html`<br><small class="muted">${g.invite.lastError}</small>` : ''}</td>
          <td>${g.seat ? `Table ${g.seat.number}${g.seat.seatNo ? `, seat ${g.seat.seatNo}` : ''}${g.seat.status === 'reserved' ? ' (reserved)' : ''}` : '–'}</td>
          <td>${g.hasEmail ? html`<button type="button" class="btn small-btn" data-inv-one="${g.id}">${sentLike(g.invite.state) ? 'Send again' : 'Send'}</button>` : ''}</td></tr>`)}
      </tbody></table></div></details>`);
    const on = (sel, fn) => box.querySelectorAll(sel).forEach((b) => b.addEventListener('click', fn));
    const sendTo = async (guestIds, what) => {
      try {
        const r = await api.post(`${base}/invitations/send`, { ...(guestIds ? { guestIds } : {}), opId: opId() });
        toast(`${plural(r.queued, 'invitation')} queued${d.emailPaused ? ': email is paused, so they wait until you turn it on' : ''}.${r.again ? ` ${r.again} with a new link.` : ''}`);
        loadInvites();
        poll.reset();
      } catch (err) {
        toast(err.message, 'error');
      }
      return what;
    };
    on('[data-inv-send]', async () => {
      if (!(await confirmDialog(`Send ${plural(c.notInvited, 'invitation')} from ${d.from}, with links on ${d.linkBase}? Each guest gets their own link and QR code.${d.emailPaused ? ' Email is paused: they wait in the outbox until you turn it on.' : ''}`, { confirmLabel: 'Send invitations', danger: false, title: 'Send invitations' }))) return;
      sendTo(null);
    });
    on('[data-inv-one]', async (e) => {
      const g = d.guests.find((x) => x.id === e.currentTarget.dataset.invOne);
      if (sentLike(g.invite.state) && !(await confirmDialog(`Send ${g.name}'s invitation again? It goes with a new link and QR code; the link in the earlier email stops working. Their answer and seat stay.`, { confirmLabel: 'Send again', danger: false, title: 'Send again' }))) return;
      sendTo([g.id]);
    });
    on('[data-inv-open]', (e) => openGuest(id, e.currentTarget.dataset.invOpen, () => {
      loadInvites();
      poll.reset();
    }));
    on('[data-inv-email]', (e) => {
      const gid = e.currentTarget.dataset.invEmail;
      modal({
        title: 'Add an email address',
        body: html`<label class="field"><span>Email</span><input name="v" type="email" required maxlength="254" /></label>`,
        onSubmit: async (f) => {
          await cmd({ type: 'guest.update', guestId: gid, email: f.v.value });
          toast('Saved. Send their invitation from the list.');
          loadInvites();
        },
      });
    });
    on('[data-inv-preview]', async () => {
      try {
        const p = await api.post(`${base}/invitations/preview`, {});
        modal({
          title: 'Invitation preview', wide: true, submitLabel: null,
          subtitle: `As ${p.guest || 'a guest'} gets it. The link here is a sample that does not work.`,
          body: html`<dl class="ca-mailhead"><dt>From</dt><dd>${d.from || 'no address yet'}</dd>${p.replyTo ? html`<dt>Reply-To</dt><dd>${p.replyTo}</dd>` : ''}<dt>To</dt><dd>${p.to || 'the guest'}</dd><dt>Subject</dt><dd data-preview-subject>${p.subject}</dd></dl>
            <iframe class="ca-mail-frame" title="The email as it looks in an email program" sandbox="" data-preview-html></iframe>
            <details class="ca-mail-plain"><summary>Plain-text version (for email programs that do not show formatting)</summary><pre class="ca-mail-text" data-preview-text>${p.text}</pre></details>`,
        });
        // The HTML part, shown sandboxed (no scripts, no links followed); the QR code's cid: picture
        // becomes the same code as an inline SVG.
        const frame = document.querySelector('[data-preview-html]');
        if (frame) {
          const svg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(p.qrSvg)}`;
          const url = URL.createObjectURL(new Blob([String(p.html || '').split('cid:preview-qr').join(svg)], { type: 'text/html' }));
          frame.src = url;
          frame.addEventListener('load', () => setTimeout(() => URL.revokeObjectURL(url), 1000), { once: true });
        }
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    on('[data-inv-test]', () => modal({
      title: 'Send a test invitation',
      subtitle: `From ${d.from || '(no From address yet)'}, now, with a sample link that does not work. Try a Gmail, an Outlook and a Yahoo address before inviting the guests: it should arrive in the inbox (not spam) with the QR code showing.`,
      body: html`<label class="field"><span>Send to <em>*</em></span><input name="to" type="email" required maxlength="254" placeholder="you@gmail.com" /></label>`,
      submitLabel: 'Send test',
      onSubmit: async (f) => toast((await api.post(`${base}/invitations/test`, { to: f.to.value })).message),
    }));
    on('[data-inv-settings]', () => {
      const st = d.settings;
      const eds = {};
      const { form } = modal({
        title: 'Invitation settings',
        subtitle: 'What the invitation says, when replies close, and whether a Yes reserves a seat at once.',
        body: html`<label class="field"><span>Subject</span><input name="subject" value="${st.subject || ''}" maxlength="160" placeholder="Invitation: ${ev.name}" /></label>
          <div data-ed="intro">${richEditor({ name: 'intro', value: st.intro || '', label: 'Opening text', pictures: false, compact: true, max: 4000, placeholder: `You are invited to ${ev.name}.`, hint: html`Bold, italics, links, lists and headings show in the email and on the guest's page. Type <kbd>/</kbd> for more.` })}</div>
          <div class="ca-pair"><label class="field"><span>Time</span><input name="time" value="${st.time || ''}" maxlength="60" placeholder="6:00 PM" /></label><label class="field"><span>Dress code</span><input name="dressCode" value="${st.dressCode || ''}" maxlength="80" placeholder="Cocktail" /></label></div>
          <label class="field"><span>Venue</span><input name="venue" value="${d.venue || ''}" maxlength="160" /></label>
          <label class="field"><span>Reply by (Manila time)</span><input type="datetime-local" name="rsvpDeadline" value="${toManilaInput(st.rsvpDeadline)}" /><small class="muted">Replies also close when self check-in opens. Until then a guest can change their answer.</small></label>
          <label class="field"><span>Public address for the links</span><input name="publicUrl" value="${st.publicUrl || ''}" maxlength="120" placeholder="${d.origin || 'https://ltdc-core.com'}" /><small class="muted">Empty: the address you are using CORE on now (${d.origin}).</small></label>
          <div data-ed="closing">${richEditor({ name: 'closing', value: st.closing || '', label: 'Closing note (optional)', pictures: false, compact: true, max: 2000, placeholder: 'For example: This email is sent automatically. Please do not reply to it.', hint: 'At the end of the invitation and of the seat email, before the event\'s name.' })}</div>
          <label class="field check"><input type="checkbox" name="autoSeat" ${st.autoSeatOnConfirm ? 'checked' : ''} /><span>Seat on Yes: a guest who says Yes gets the best table for them and its lowest open chair at once, held until the night (preferred guests keep their reserved seats)</span></label>`,
        submitLabel: 'Save',
        onSubmit: async (f) => {
          await api.patch(base, { rev: d.rev, venue: f.venue.value, settings: { autoSeatOnConfirm: f.autoSeat.checked, invitation: { subject: f.subject.value, intro: eds.intro ? eds.intro.value() : f.intro.value, closing: eds.closing ? eds.closing.value() : f.closing.value, time: f.time.value, dressCode: f.dressCode.value, rsvpDeadline: f.rsvpDeadline.value, publicUrl: f.publicUrl.value } } });
          toast('Invitation settings saved.');
          loadInvites();
        },
      });
      for (const k of ['intro', 'closing']) eds[k] = wireRichEditor(form.querySelector(`[data-ed="${k}"]`));
    });
  }

  const drawAll = () => {
    drawCounts();
    drawHealth();
    drawInbox();
    drawWork();
    // The invitations list follows the board, at most every 5 seconds.
    if (sa && Date.now() - invitesAt > 5000) loadInvites();
  };
  drawAll();
  const poll = sa ? livePoll(`${base}/changes?tab=control`, {
    bar: el.querySelector('[data-bar]'),
    onBoard: (b) => {
      if (!b) return;
      board = b;
      drawAll();
    },
  }) : { reset() {}, stop() {} };
  // The health strip and the guest page alarm age by themselves: ask again every 15 s.
  const refresher = sa ? setInterval(() => poll.reset(), 15000) : 0;

  // ----- Tables: out of use, or move their guests -----
  el.querySelectorAll('[data-off]').forEach((b) => b.addEventListener('click', async () => {
    const t = ev.tables.find((x) => x.id === b.dataset.off);
    if (!(await confirmDialog(`Take table ${t.number} out of use? It is not offered for seating until you use it again.`, { confirmLabel: 'Take out of use', danger: false }))) return;
    try {
      await cmd({ type: 'table.update', tableId: t.id, active: false, expect: { [t.id]: t.rev } });
      toast(`Table ${t.number} is out of use.`);
      cleanup();
      eventControlView(el, params, query);
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
  el.querySelectorAll('[data-on]').forEach((b) => b.addEventListener('click', async () => {
    const t = ev.tables.find((x) => x.id === b.dataset.on);
    try {
      await cmd({ type: 'table.update', tableId: t.id, active: true });
      toast(`Table ${t.number} is in use again.`);
      cleanup();
      eventControlView(el, params, query);
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
  el.querySelectorAll('[data-move-guests]').forEach((b) => b.addEventListener('click', () => {
    const t = ev.tables.find((x) => x.id === b.dataset.moveGuests);
    const targets = ev.tables.filter((x) => x.id !== t.id && x.active && x.free >= t.claims);
    modal({
      title: `Move the guests of table ${t.number}`,
      subtitle: `${plural(t.claims, 'guest')}, in one change: they keep their chair numbers where they are free.`,
      body: html`<label class="field"><span>To table <em>*</em></span><select name="to" required><option value="">Choose…</option>${targets.map((x) => option(x.id, `Table ${x.number} (${CLASS_LABELS[x.classification]}, ${x.free} free)`))}</select></label>
        <label class="field check"><input type="checkbox" name="deactivate" checked /><span>Then take table ${t.number} out of use</span></label>`,
      submitLabel: 'Move guests',
      onSubmit: async (f) => {
        await cmd({ type: 'table.relocate', fromTableId: t.id, toTableId: f.to.value, deactivate: f.deactivate.checked, reason: 'Moved on Event control' });
        toast(`Table ${t.number}'s guests moved.`);
        cleanup();
        eventControlView(el, params, query);
      },
    });
  }));

  // ----- Paper reconciliation -----
  el.querySelector('[data-reconcile]')?.addEventListener('click', async (e) => {
    const text = el.querySelector('[data-paper]').value;
    const out = el.querySelector('[data-recon-out]');
    e.currentTarget.disabled = true;
    try {
      const r = await api.post(`${base}/reconcile`, { text });
      mount(out, html`<p class="small" data-recon-summary>${plural(r.lines, 'line')} read: ${plural(r.applied, 'change')} entered, ${r.already} already in CORE${r.cards.length ? `, ${r.cards.length} to resolve` : ''}.</p>
        ${r.cards.length ? html`<ul class="ca-cards">${r.cards.map((c) => html`<li class="ca-recovery card"><strong>Line ${c.line}: ${c.text}</strong><p>${c.name ? `${c.name}: ` : ''}${c.message}</p><small class="muted">Not entered. Seat them on screen, or correct the line and enter it again.</small></li>`)}</ul>` : ''}`);
      poll.reset();
    } catch (err) {
      mount(out, html`<p class="ca-notice" role="alert">${icon('alert', 16)} ${err.message}</p>`);
    } finally {
      e.currentTarget.disabled = false;
    }
  });

  const qrSheet = (url, fresh) => {
    const q = qrcode(0, 'M');
    q.addData(url);
    q.make();
    modal({
      title: 'Reception QR sheet',
      subtitle: fresh ? 'Print it now: the presence key is shown only this once (only its fingerprint is kept). Turning the key off and on again makes a new one.' : 'The guest page address. With the presence key on, print the sheet when you turn the key on.',
      body: html`<div class="ca-qr">${raw(q.createSvgTag({ cellSize: 6, margin: 2, scalable: true, alt: 'QR code for the guest page' }))}<p><strong>${ev.name}</strong>: scan to check in.</p><p class="small muted">If this page doesn't open, please go to the registration desk.</p><p class="small mono">${url.replace(/#k=.*/, '#k=…')}</p></div>`,
      submitLabel: 'Print',
      onSubmit: () => window.print(),
    });
  };
  el.querySelector('#ca-qr')?.addEventListener('click', () => qrSheet(`${location.origin}/event/${ev.code}`, false));
  el.querySelector('[data-qrkey]')?.addEventListener('change', async (e) => {
    const on = e.target.checked;
    const msg = on ? 'Turn on the presence key? Only phones that scanned the new reception QR can check in; a guest who types the address gets the desk. Turn it on only after load test 1 passed, and print the new QR sheet now.' : 'Turn off the presence key? Anyone with the guest page address can check in while self check-in is open.';
    if (!(await confirmDialog(msg, { confirmLabel: 'Confirm', danger: false, title: 'Presence key' }))) return (e.target.checked = !on);
    try {
      const r = await api.post(`${base}/qr-key`, { on, opId: opId() });
      e.target.closest('label').querySelector('.state').textContent = on ? 'On' : 'Off';
      toast(`Presence key ${on ? 'on' : 'off'}.`);
      if (on) qrSheet(`${location.origin}${new URL(r.url, location.origin).pathname}#k=${r.key}`, true);
    } catch (err) {
      e.target.checked = !on;
      toast(err.message, 'error');
    }
  });
  const setFlag = async (flag, value) => {
    await cmd({ type: 'setFlag', flag, value });
    toast(`${FLAG_LABELS[flag]}: ${flag === 'pollMs' ? `${value} ms` : value ? 'on' : 'off'}.`);
  };
  el.querySelectorAll('[data-flag]').forEach((input) => input.addEventListener('change', async () => {
    const f = input.dataset.flag;
    const [onText, offText] = FLAG_EFFECT[f];
    if (!(await confirmDialog(input.checked ? onText : offText, { confirmLabel: 'Confirm', danger: f === 'readOnly' && input.checked, title: FLAG_LABELS[f] }))) return (input.checked = !input.checked);
    try {
      await setFlag(f, input.checked);
      input.closest('label').querySelector('.state').textContent = input.checked ? 'On' : 'Off';
      poll.reset();
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
        cleanup();
        eventControlView(el, params, query);
      },
    });
  });
  function cleanup() {
    stopPlan();
    poll.stop();
    clearInterval(refresher);
  }
  return cleanup;
}
const ageText = (iso) => {
  const m = minutesSince(iso);
  return m < 1 ? 'under a minute ago' : `${m} min ago`;
};

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
        <div class="ca-pair"><label class="field"><span>Email from (the event's own address)</span><input type="email" name="emailFrom" value="${s.emailFrom || ''}" maxlength="254" placeholder="events@yourcompany.com" /></label><label class="field"><span>Reply-To</span><input type="email" name="replyTo" value="${s.replyTo || ''}" maxlength="254" /></label></div>
        <p class="muted small">Seat emails go from this address through CORE's outgoing email (IT Service Desk → Settings → Sending email), never from the IT Service Desk's own mailbox, so a guest's reply never becomes a ticket. The mail account must be allowed to send as it. Email stays paused until the Super Administrator turns it on under Event control.</p>
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
      await api.patch(base, { rev: ev.rev, name: f.name.value, date: f.date.value, venue: f.venue.value, status: f.status.value, window: { opensAt: f.opensAt.value, closesAt: f.closesAt.value }, settings: { seatNumbers: f.seatNumbers.value, mixedTables: f.mixedTables.checked, releaseDelegable: f.releaseDelegable.checked, emailFrom: f.emailFrom.value, replyTo: f.replyTo.value } });
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
