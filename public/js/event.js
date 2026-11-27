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
const code = (location.pathname.match(/^\/event\/([a-z0-9-]+)/) || [])[1] || '';
const api = `/api/public/event/${code}`;
const box = document.getElementById('box');
const updatedEl = document.getElementById('updated');
const STORE = `ca-ev:${code}`;
const KEY = `ca-k:${code}`;
const STILL_MS = 4 * 60000;

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
let token = frag.get('s') || store.get(STORE) || '';
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
    show(`<h1 tabindex="-1">Welcome${name ? `, ${esc(name)}` : ''}.</h1><p>Your seat is</p><span class="big" id="table-no">Table ${esc(st.table)}</span>${st.seat ? `<p class="seat">Seat ${esc(st.seat)}</p>` : ''}<p class="ok">Screenshot this screen to show the usher.</p>`, { focus });
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
