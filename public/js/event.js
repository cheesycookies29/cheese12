// An event's guest page, /event/<code> (CUSTOM APP, 0.72): a guest types their surname and the last 4
// digits of their mobile (or their full email) and is checked in; the page then shows their table and
// seat as soon as staff choose it, and keeps showing it after a reload.
//
// States: closed ("Registration opens at 6:00 PM.", no inputs), verify, pending (after 4 minutes it
// adds that the desk can help), seated (the table number in large type), referred (a code to show at
// the desk) and offline (the last status, and that it will update). Anything that goes wrong points
// to a person at the desk; the page never says "not found", "invalid" or "already checked in".
//
// The status token: the server's answer to a check-in. It is kept in the address after # (#s=…,
// which browsers never send to a server) and in this browser's storage, and sent only in the
// X-Event-Token header. The reception QR may carry a presence key (#k=…), sent with the check-in.
//
// A personal invitation (0.74) opens this page as /event/<code>#i=<token>: the guest's name, the
// event, and "Yes, I will attend" / "No, I can't attend" (changeable until replies close); a Yes
// shows the seat reserved for them, or that their table follows by email. On the night the same
// link offers Check in, with no surname to type, then shows the table. The invitation token stays
// in the address after # (so a reload works), is sent only in the X-Event-Invite header, and is
// never put in this browser's storage (an usher's phone may open many guests' links).
const code = (location.pathname.match(/^\/event\/([a-z0-9-]+)/) || [])[1] || '';
const api = `/api/public/event/${code}`;
const box = document.getElementById('box');
const updatedEl = document.getElementById('updated');
const STORE = `ca-ev:${code}`;
const KEY = `ca-k:${code}`;
const STILL_MS = 4 * 60000;

import { renderRich } from '/shared/richtext.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clock = (d) => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
const store = {
  get: (k, s = localStorage) => { try { return s.getItem(k); } catch { return null; } },
  set: (k, v, s = localStorage) => { try { s.setItem(k, v); } catch {} },
  del: (k, s = localStorage) => { try { s.removeItem(k); } catch {} },
};

// What the address carries after #: s=<token> or k=<presence key>.
const frag = new URLSearchParams(location.hash.slice(1));
if (frag.get('k')) {
  store.set(KEY, frag.get('k'), sessionStorage);
  history.replaceState(null, '', location.pathname);
}
const invite = /^[A-Za-z0-9_-]{43}$/.test(frag.get('i') || '') ? frag.get('i') : '';
let token = invite ? '' : frag.get('s') || store.get(STORE) || '';
let last = null; // the last status shown
let timer = 0;
let seq = null;
let backoff = 0;
let pendingSince = Number(store.get(`${STORE}:pending`)) || 0;

function show(html, { focus = true } = {}) {
  box.innerHTML = html;
  if (focus) box.querySelector('h1')?.focus({ preventScroll: false });
}
const stamp = (offline = false) => {
  updatedEl.textContent = offline ? `Last updated ${clock(new Date(last?.at || Date.now()))}. Will update when you reconnect.` : `Updated ${clock(new Date())}`;
};

const desk = (extra = '') => show(`<h1 tabindex="-1">Please see the registration desk.</h1><p>A staff member will check you in and show you to your table.</p>${extra}`);

function render(st, { focus = true, at = Date.now() } = {}) {
  last = { ...st, at };
  store.set(`${STORE}:last`, JSON.stringify(last));
  const name = st.title || st.firstName || '';
  if (st.state === 'seated') {
    store.del(`${STORE}:pending`);
    show(`<h1 tabindex="-1">Welcome${name ? `, ${esc(name)}` : ''}.</h1><p>Your seat is</p><span class="big" id="table-no">Table ${esc(st.table)}</span>${st.seat ? `<p class="seat">Seat ${esc(st.seat)}</p>` : ''}${st.emailed ? '<p class="ok" id="mail-line">We have emailed your table to you as well.</p>' : '<p class="ok" id="mail-line">Screenshot this screen to show the usher.</p>'}`, { focus });
  } else if (st.state === 'pending') {
    if (!pendingSince) {
      pendingSince = Date.now();
      store.set(`${STORE}:pending`, String(pendingSince));
    }
    const still = Date.now() - pendingSince >= STILL_MS;
    show(`<h1 tabindex="-1">You're checked in${name ? `, ${esc(name)}` : ''}.</h1><p>We're choosing your table. This page updates by itself.</p>${still ? '<p class="note">Still choosing. A staff member can help at the desk.</p>' : ''}`, { focus });
  } else desk();
}

// ----- The status, asked again every pollMs (the server says how often) -----
function schedule(ms) {
  clearTimeout(timer);
  if (document.hidden) return;
  timer = setTimeout(poll, ms);
}
async function poll() {
  if (!token || document.hidden) return;
  try {
    const r = await fetch(`${api}/status${seq != null ? `?since=${seq}` : ''}`, { headers: { 'X-Event-Token': token }, cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (!r.ok) throw new Error(String(r.status));
    const st = await r.json();
    backoff = 0;
    if (!st.unchanged) {
      const changed = !last || last.state !== st.state || last.table !== st.table || last.seat !== st.seat;
      seq = st.seq;
      if (st.state === 'see_desk') {
        store.del(STORE);
        store.del(`${STORE}:last`);
        token = '';
        last = null;
        desk();
        stamp();
        return;
      }
      if (changed || st.state === 'pending') render(st, { focus: changed });
    } else if (last?.state === 'pending' && !box.querySelector('.note') && Date.now() - pendingSince >= STILL_MS) render(last, { focus: false });
    stamp();
    schedule(st.pollMs || 4000);
  } catch {
    // Offline or the server is restarting: the last status stays, and the page tries again, slower.
    backoff = Math.min(30000, backoff ? backoff * 2 : 4000);
    if (!last) {
      try {
        const kept = JSON.parse(store.get(`${STORE}:last`) || 'null');
        if (kept?.state) render(kept, { focus: false, at: kept.at });
      } catch {}
    }
    if (last) stamp(true);
    else show('<h1 tabindex="-1">Checking your status…</h1><p>Will update when you reconnect.</p>', { focus: false });
    schedule(backoff);
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(timer);
  else poll();
});
addEventListener('online', () => poll());
addEventListener('offline', () => last && stamp(true));

// ----- Verify -----
function verifyForm(useEmail = false) {
  const shownAt = Date.now();
  show(`<h1 tabindex="-1">Check in</h1><p>Type your surname and the last 4 digits of your mobile number.</p>
    <form id="vf" novalidate autocomplete="off">
      <label for="surname">Surname</label><input id="surname" name="surname" required maxlength="80" placeholder="e.g. Dela Cruz" autocapitalize="words" autocomplete="off" spellcheck="false" />
      ${useEmail ? '<label for="email">Your full email address</label><input id="email" name="email" type="email" inputmode="email" required maxlength="254" autocomplete="off" />'
        : '<label for="last4">Last 4 digits of your mobile</label><input id="last4" name="last4" inputmode="numeric" pattern="\\d{4}" maxlength="4" required autocomplete="off" />'}
      <button type="button" class="link" id="swap">${useEmail ? 'Use my mobile number instead' : 'Use email instead'}</button>
      <div class="trap" aria-hidden="true"><label for="website">Leave this empty</label><input id="website" name="website" tabindex="-1" autocomplete="off" /></div>
      <button type="submit" id="go">Check in</button>
    </form>`, { focus: false });
  document.getElementById('surname').focus();
  document.getElementById('swap').addEventListener('click', () => verifyForm(!useEmail));
  document.getElementById('vf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const go = document.getElementById('go');
    go.disabled = true;
    go.textContent = 'Checking…';
    const body = { surname: f.surname.value, website: f.website.value, elapsedMs: Date.now() - shownAt, k: store.get(KEY, sessionStorage) || undefined };
    if (useEmail) body.email = f.email.value;
    else body.last4 = f.last4.value.replace(/\D/g, '');
    try {
      const r = await fetch(`${api}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', referrerPolicy: 'no-referrer' });
      const out = await r.json();
      if (out.token) {
        token = out.token;
        store.set(STORE, token);
        history.replaceState(null, '', `${location.pathname}#s=${token}`);
        seq = out.seq;
        render(out);
        stamp();
        schedule(out.pollMs || 4000);
      } else {
        show(`<h1 tabindex="-1">Please see the registration desk and show this code: <span class="code">${esc(out.referral || '')}</span></h1><p>A staff member will check you in.</p><button type="button" class="link" id="again">Try again</button>`);
        document.getElementById('again').addEventListener('click', () => verifyForm(useEmail));
      }
    } catch {
      show('<h1 tabindex="-1">No connection</h1><p>Please try again in a moment, or go to the registration desk.</p><button type="button" id="again">Try again</button>');
      document.getElementById('again').addEventListener('click', () => verifyForm(useEmail));
    }
  });
}

// ----- A personal invitation (#i=…) -----
const fmtWhen = (iso) => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
let inviteTimer = 0;
async function inviteCall(method, path, body) {
  const r = await fetch(`${api}/${path}`, { method, headers: { 'X-Event-Invite': invite, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', referrerPolicy: 'no-referrer' });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
const seatLine = (s) => `Table ${esc(s.table)}${s.seat ? `, seat ${esc(s.seat)}` : ''}`;
function renderInvite(v, { focus = true, changing = false } = {}) {
  clearTimeout(inviteTimer);
  if (v.state !== 'invite') {
    show(`<h1 tabindex="-1">Please contact the organisers and quote this code: <span class="code">${esc(v.referral || '')}</span></h1><p>At the event, show this code at the registration desk.</p>`, { focus });
    return;
  }
  document.getElementById('ev-name').textContent = v.event.name;
  document.title = `${v.event.name}: your invitation`;
  const name = v.guest.name || v.guest.firstName || '';
  const details = v.event.details?.length ? `<ul class="details" id="ev-details">${v.event.details.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '';
  const notice = { closed: '<p class="note" id="notice">Replies have closed. Please contact the organisers.</p>', door_closed: '<p class="note" id="notice">Check-in opens at the door on the night.</p>', checked_in: '' }[v.notice] || '';
  // At the door, or already in.
  if (v.door.checkedIn) {
    if (v.seat) show(`<h1 tabindex="-1">Welcome${name ? `, ${esc(name)}` : ''}.</h1><p>Your seat is</p><span class="big" id="table-no">Table ${esc(v.seat.table)}</span>${v.seat.seat ? `<p class="seat">Seat ${esc(v.seat.seat)}</p>` : ''}<p class="ok">You're checked in. Show this screen to the usher.</p>`, { focus });
    else {
      show(`<h1 tabindex="-1">You're checked in${name ? `, ${esc(name)}` : ''}.</h1><p>We're choosing your table. This page updates by itself.</p>`, { focus });
      inviteTimer = setTimeout(() => inviteCall('GET', 'invite').then((x) => renderInvite(x, { focus: Boolean(x.seat) })).catch(() => {}), v.pollMs || 4000);
    }
    stamp();
    return;
  }
  if (v.door.open) {
    show(`<h1 tabindex="-1">Welcome${name ? `, ${esc(name)}` : ''}.</h1>${v.seat ? `<p>Your seat: <strong id="seat-line">${seatLine(v.seat)}</strong></p>` : ''}<p>Tap Check in when you arrive at the door.</p><button type="button" id="checkin">Check in</button>${notice}`, { focus });
    document.getElementById('checkin').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = 'Checking in…';
      try {
        renderInvite(await inviteCall('POST', 'checkin', {}));
      } catch {
        show('<h1 tabindex="-1">No connection</h1><p>Please try again in a moment, or go to the registration desk.</p><button type="button" id="again">Try again</button>');
        document.getElementById('again').addEventListener('click', () => inviteStart());
      }
    });
    stamp();
    return;
  }
  // Before the night: the invitation and the answer.
  const head = v.rsvp === 'yes' ? 'Thank you: you are coming.' : v.rsvp === 'no' ? 'Thank you for letting us know.' : `You're invited${name ? `, ${esc(name)}` : ''}.`;
  let status = '';
  if (v.rsvp === 'yes' && v.seat) status = `<p class="ok" id="rsvp-status">Your seat is reserved: <strong id="seat-line">${seatLine(v.seat)}</strong>.${v.emailed ? ' We have emailed it to you.' : ''}</p><p>On the night, show the QR code in your invitation email at the door, or open this page and tap Check in.</p>`;
  else if (v.rsvp === 'yes') status = `<p class="ok" id="rsvp-status">We will email your table.</p><p>On the night, show the QR code in your invitation email at the door, or open this page and tap Check in.</p>`;
  else if (v.rsvp === 'no') status = '<p class="ok" id="rsvp-status">We\'re sorry you can\'t make it.</p>';
  const ask = v.canAnswer && (!v.rsvp || changing);
  const buttons = ask ? `${v.event.rsvpClosesAt ? `<p class="small-print">Please reply by ${esc(fmtWhen(v.event.rsvpClosesAt))}.</p>` : ''}<button type="button" id="rsvp-yes">Yes, I will attend</button><button type="button" class="secondary" id="rsvp-no">No, I can't attend</button>`
    : v.canAnswer ? `<button type="button" class="link" id="rsvp-change">Change my answer</button>` : !v.rsvp ? '<p class="note">Replies are closed. Please contact the organisers.</p>' : '';
  show(`<h1 tabindex="-1">${head}</h1>${!v.rsvp && v.event.intro ? `<div class="ev-intro">${renderRich(v.event.intro, { image: () => null })}</div>` : ''}<p class="ev-title"><strong>${esc(v.event.name)}</strong></p>${details}${status}${notice}${buttons}`, { focus });
  const send = async (answer, b) => {
    b.disabled = true;
    b.textContent = 'Sending…';
    try {
      renderInvite(await inviteCall('POST', 'rsvp', { answer }));
    } catch {
      show('<h1 tabindex="-1">No connection</h1><p>Your answer was not sent. Please try again in a moment.</p><button type="button" id="again">Try again</button>');
      document.getElementById('again').addEventListener('click', () => inviteStart());
    }
  };
  document.getElementById('rsvp-yes')?.addEventListener('click', (e) => send('yes', e.currentTarget));
  document.getElementById('rsvp-no')?.addEventListener('click', (e) => send('no', e.currentTarget));
  document.getElementById('rsvp-change')?.addEventListener('click', () => renderInvite(v, { changing: true }));
  stamp();
}
async function inviteStart() {
  try {
    renderInvite(await inviteCall('GET', 'invite'));
  } catch {
    show('<h1 tabindex="-1">No connection</h1><p>Please try again in a moment.</p><button type="button" id="again">Try again</button>');
    document.getElementById('again').addEventListener('click', () => inviteStart());
  }
}

// ----- Start -----
async function start() {
  let ev = null;
  try {
    const r = await fetch(api, { cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (r.ok) ev = await r.json();
  } catch {}
  if (ev) {
    document.getElementById('ev-name').textContent = ev.name;
    document.title = `${ev.name}: check-in`;
    if (ev.date) document.getElementById('ev-date').textContent = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${ev.date}T12:00:00+08:00`));
  }
  if (invite) return inviteStart();
  if (token) {
    if (frag.get('s') && !store.get(STORE)) store.set(STORE, token);
    if (!location.hash.includes('s=')) history.replaceState(null, '', `${location.pathname}#s=${token}`);
    return poll();
  }
  if (!ev) return desk();
  if (ev.state === 'open') return verifyForm();
  // Closed: before the doors, when it opens; after (self check-in turned off), the desk.
  if (ev.opensAt && Date.now() < Date.parse(ev.opensAt)) return show(`<h1 tabindex="-1">Registration opens at ${esc(clock(new Date(ev.opensAt)))}.</h1><p>Come back then, or go to the registration desk.</p>`);
  return desk();
}
start();
