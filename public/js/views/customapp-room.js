// CUSTOM APP → Events: the room plan (US-031), as reviewed in the council's ballroom prototype. An
// inline SVG of the room drawn from GET …/room: the tech booth and the stage where the event's room
// puts them, round tables numbered from the stage, and every chair, its state shown by fill and shape
// as well as colour (open: a hollow ring; reserved: hatched; seated: solid with initials; the chosen
// chair: a thick ring), with a legend. Preferred tables are tinted gold, employee tables dashed, a
// full table says FULL. Choosing a waiting guest rings and ranks their top three tables (the server's
// recommend(), the same as the list) and dims the tables they cannot sit at; tables of other owners
// are dimmed and marked "Not yours".
//
// The side panel: the guests waiting, the recommendations, and the chosen table's chairs as 48 px
// buttons around it ("Chair 4: Maria Santos, Northbay Bank"), so seating works by keyboard, with a
// screen reader and on a 390 px phone where the plan itself is small.
//
// Zoom and pan after n8n's canvas: Fit, + and − buttons; keys + and − zoom, 1 fits; drag or scroll to
// pan when zoomed in, Ctrl+scroll zooms; arrow keys move between tables in the same row or column,
// Enter opens one. Every chair choice is one command to the server (assign, transfer, checkIn,
// release, unseat) with the revisions this screen saw; a refusal redraws the plan from the state in
// the reply and says what happened. Nothing is shown as done before the server answers.
import { api } from '../api.js';
import { html, mount, toast, modal, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';
import { chairAngle, roomGeometry, ROOM_DRAW as G } from '/shared/customapp/room.js';
import { fmtManila } from '/shared/customapp/time.js';
import { livePoll } from './customapp-live.js';

const opId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
let uid = 0;

// Where everything is drawn: the same geometry as the printed plan (shared/customapp/room.js).
const geometry = roomGeometry;

const STATE_TEXT = { reserved: 'reserved, not arrived', confirmed: 'seated' };
const chairLabel = (c) => (c.taken ? `Chair ${c.seatNo}: ${c.name}${c.company ? `, ${c.company}` : ''} (${STATE_TEXT[c.status]})` : `Chair ${c.seatNo}: open`);

// el: where the plan goes; eventId; opts: { title (heading), onChange () after a change }.
export function mountRoomPlan(el, eventId, { onChange = () => {} } = {}) {
  const base = `/api/customapp/events/${eventId}`;
  const id = ++uid;
  const st = { data: null, guestId: null, tableId: null, chair: null, kbd: null, scale: 1, tx: 0, ty: 0, recs: null, recFor: null, notice: '', moving: null, busy: false, q: '' };
  mount(el, html`<div class="ca-room" data-room>
    <div class="ca-live-bar" data-bar role="status"><span>${icon('activity', 14)}</span> <span data-age>Loading…</span></div>
    <div class="ca-room-layout">
      <section class="card ca-room-plan" aria-label="Room plan">
        <div class="ca-room-bar">
          <div class="ca-legend" aria-label="Legend">
            <span><svg width="18" height="18" aria-hidden="true"><circle cx="9" cy="9" r="7" class="ca-c-open"/></svg>Open chair</span>
            <span><svg width="18" height="18" aria-hidden="true"><defs><pattern id="ca-hl-${id}" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" class="ca-hatch-bg"/><rect width="2" height="4" class="ca-hatch-fg"/></pattern></defs><circle cx="9" cy="9" r="7" fill="url(#ca-hl-${id})" class="ca-c-res"/></svg>Reserved, not arrived</span>
            <span><svg width="18" height="18" aria-hidden="true"><circle cx="9" cy="9" r="7" class="ca-c-seat"/><text x="9" y="11.5" text-anchor="middle" class="ca-c-ini">AB</text></svg>Seated</span>
            <span><svg width="18" height="18" aria-hidden="true"><circle cx="9" cy="9" r="6.5" class="ca-c-open ca-c-pick"/></svg>Chosen chair</span>
            <span><svg width="22" height="18" aria-hidden="true"><circle cx="11" cy="9" r="7.5" class="ca-t-top ca-t-pref"/></svg>Preferred table</span>
            <span><svg width="22" height="18" aria-hidden="true"><circle cx="11" cy="9" r="7.5" class="ca-t-top ca-t-emp"/></svg>Employee table</span>
            <span><svg width="26" height="18" aria-hidden="true"><circle cx="11" cy="9" r="7.5" class="ca-t-top ca-t-rec"/><circle cx="20" cy="5" r="4.5" class="ca-rank"/></svg>Recommended (1 to 3)</span>
          </div>
          <div class="ca-zoom" role="group" aria-label="Zoom">
            <button type="button" class="btn ca-sq" data-z="out" title="Zoom out (−)" aria-label="Zoom out">−</button>
            <button type="button" class="btn ca-sq" data-z="in" title="Zoom in (+)" aria-label="Zoom in">+</button>
            <button type="button" class="btn" data-z="fit" title="Fit the room (1)">Fit</button>
          </div>
        </div>
        <svg class="ca-plan" data-plan tabindex="0" role="application" aria-roledescription="room plan" aria-label="Room plan" aria-describedby="ca-kbd-${id}">
          <defs><pattern id="ca-h-${id}" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" class="ca-hatch-bg"/><rect width="2" height="4" class="ca-hatch-fg"/></pattern>
            <pattern id="ca-g-${id}" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" class="ca-floorline"/></pattern></defs>
          <g data-world></g>
        </svg>
        <p id="ca-kbd-${id}" class="sr-only">Arrow keys move between tables, Enter opens a table, plus and minus zoom, 1 fits the room.</p>
      </section>
      <aside class="ca-room-side">
        <section class="card ca-panel" data-queue aria-label="Waiting for a seat"></section>
        <section class="card ca-panel" data-detail aria-live="polite"></section>
      </aside>
    </div></div>`);
  const root = el.querySelector('[data-room]');
  const plan = el.querySelector('[data-plan]');
  const world = el.querySelector('[data-world]');
  const qBox = el.querySelector('[data-queue]');
  const dBox = el.querySelector('[data-detail]');
  const hatch = `url(#ca-h-${id})`;
  let geo = null;

  const tables = () => st.data?.tables || [];
  const tableOf = (tid) => tables().find((t) => t.id === tid) || null;
  const guestOf = (gid) => st.data?.waiting.find((g) => g.guestId === gid) || null;
  const chosenGuest = () => (st.guestId ? guestOf(st.guestId) : null);
  const seatedGuest = (gid) => {
    for (const t of tables()) for (const c of t.chairs) if (c.guestId === gid) return { t, c };
    return null;
  };

  // ----- Drawing the room -----
  function draw() {
    const t0 = performance.now();
    const data = st.data;
    if (!data) return;
    geo = geometry(data.room, data.tables);
    plan.setAttribute('viewBox', `0 0 ${geo.w} ${geo.h}`);
    plan.style.aspectRatio = `${geo.w} / ${geo.h}`;
    const g = chosenGuest();
    const recs = st.recs && st.recFor === st.guestId ? st.recs : null;
    const rank = new Map((recs?.mine || []).slice(0, 3).map((r, i) => [r.tableId, i + 1]));
    const eligibleIds = recs ? new Set([...(recs.mine || []), ...(recs.othersReadOnly || [])].map((r) => r.tableId)) : null;
    const zoneSvg = (z, cls, label, sub) => {
      const cx = z.x + z.w / 2;
      const cy = z.y + z.h / 2;
      return `<rect class="${cls}" x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="9"/><text class="ca-zone-l" x="${cx}" y="${cy + 4}" text-anchor="middle"${z.rot ? ` transform="rotate(${z.rot} ${cx} ${cy})"` : ''}>${label}</text>${sub ? `<text class="ca-zone-s" x="${cx}" y="${z.rot ? z.y + z.h + 16 : cy + 20}" text-anchor="middle">${sub}</text>` : ''}`;
    };
    let s = `<rect x="0" y="0" width="${geo.w}" height="${geo.h}" fill="url(#ca-g-${id})"/>`;
    s += zoneSvg(geo.booth, 'ca-zone', 'TECH BOOTH', 'Sound · lights');
    s += zoneSvg(geo.stage, 'ca-zone ca-stage', 'STAGE', '');
    for (const t of data.tables) {
      const [x, y] = geo.pos.get(t.id);
      const full = t.free < 1;
      const out = !t.active || !t.mine || (eligibleIds && !eligibleIds.has(t.id));
      const cls = ['ca-tbl', `ca-type-${t.classification}`, full ? 'full' : '', st.tableId === t.id ? 'sel' : '', rank.has(t.id) ? 'rec' : '', out ? 'out' : '', st.kbd === t.id && document.activeElement === plan ? 'kbd' : ''].filter(Boolean).join(' ');
      s += `<g class="${cls}" data-table="${t.id}">`;
      s += `<circle class="ca-t-ring" cx="${x}" cy="${y}" r="${G.chairD + G.chairR + 5}"/>`;
      for (const c of t.chairs) {
        const a = (chairAngle(data.room || { stageSide: 'right', chairsPerTable: t.capacity }, c.seatNo) * Math.PI) / 180;
        const cx = (x + G.chairD * Math.cos(a)).toFixed(1);
        const cy = (y + G.chairD * Math.sin(a)).toFixed(1);
        const pick = st.tableId === t.id && st.chair === c.seatNo;
        const state = c.taken ? (c.status === 'reserved' ? 'res' : 'seat') : 'open';
        s += `<circle class="ca-chair ca-c-${state}${pick ? ' ca-c-pick' : ''}" cx="${cx}" cy="${cy}" r="${G.chairR}"${state === 'res' ? ` fill="${hatch}"` : ''}/>`;
        if (state === 'seat') s += `<text class="ca-c-ini" x="${cx}" y="${(Number(cy) + 2.6).toFixed(1)}" text-anchor="middle">${esc(c.initials)}</text>`;
        s += `<circle class="ca-hit" data-chair="${t.id}:${c.seatNo}" cx="${cx}" cy="${cy}" r="${G.chairR + 3}"><title>${esc(`Table ${t.number}. ${chairLabel(c)}`)}</title></circle>`;
      }
      s += `<circle class="ca-t-top" cx="${x}" cy="${y}" r="${G.tableR}"/>`;
      s += `<text class="ca-t-num" x="${x}" y="${y + 3}" text-anchor="middle">${t.number}</text>`;
      s += `<text class="ca-t-count" x="${x}" y="${y + 17}" text-anchor="middle">${!t.active ? 'NOT IN USE' : full ? 'FULL' : `${t.claims}/${t.capacity}`}</text>`;
      if (!t.mine) s += `<text class="ca-t-lock" x="${x}" y="${y - 13}" text-anchor="middle">NOT YOURS</text>`;
      if (rank.has(t.id)) s += `<circle class="ca-rank" cx="${x + 25}" cy="${y - 25}" r="11"/><text class="ca-rank-t" x="${x + 25}" y="${y - 21}" text-anchor="middle">${rank.get(t.id)}</text>`;
      s += '</g>';
    }
    world.innerHTML = s;
    applyView();
    plan.setAttribute('aria-label', `Room plan: ${data.tables.length} tables${data.room ? `, stage on the ${data.room.stageSide}, tech booth on the ${data.room.boothSide}` : ''}${g ? `. Choosing a table for ${g.name}` : ''}.`);
    root.dataset.renderMs = String(Math.round(performance.now() - t0));
  }
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ----- Zoom and pan -----
  function applyView() {
    world.setAttribute('transform', `translate(${st.tx.toFixed(1)} ${st.ty.toFixed(1)}) scale(${st.scale.toFixed(3)})`);
    plan.classList.toggle('zoomed', st.scale > 1.001);
    root.dataset.scale = st.scale.toFixed(2);
  }
  const clampPan = () => {
    st.tx = Math.min(0, Math.max(geo.w - geo.w * st.scale, st.tx));
    st.ty = Math.min(0, Math.max(geo.h - geo.h * st.scale, st.ty));
  };
  function zoomAt(f, cx = geo.w / 2, cy = geo.h / 2) {
    const s = Math.min(4, Math.max(1, st.scale * f));
    st.tx = cx - (cx - st.tx) * (s / st.scale);
    st.ty = cy - (cy - st.ty) * (s / st.scale);
    st.scale = s;
    clampPan();
    applyView();
  }
  const fit = () => {
    st.scale = 1;
    st.tx = 0;
    st.ty = 0;
    applyView();
  };
  const focusTable = (tid) => {
    const p = geo?.pos.get(tid);
    if (!p || st.scale <= 1) return;
    st.tx = geo.w / 2 - p[0] * st.scale;
    st.ty = geo.h / 2 - p[1] * st.scale;
    clampPan();
    applyView();
  };
  el.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => (b.dataset.z === 'in' ? zoomAt(1.35) : b.dataset.z === 'out' ? zoomAt(1 / 1.35) : fit())));
  const toSvg = (e) => {
    const r = plan.getBoundingClientRect();
    return [((e.clientX - r.left) * geo.w) / r.width, ((e.clientY - r.top) * geo.h) / r.height];
  };
  plan.addEventListener('wheel', (e) => {
    if (!geo) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const [x, y] = toSvg(e);
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, x, y);
    } else if (st.scale > 1) {
      e.preventDefault();
      const r = plan.getBoundingClientRect();
      st.tx -= (e.deltaX * geo.w) / r.width;
      st.ty -= (e.deltaY * geo.h) / r.height;
      clampPan();
      applyView();
    }
  }, { passive: false });
  let drag = null;
  plan.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, tx: st.tx, ty: st.ty, moved: false };
  });
  const onMove = (e) => {
    if (!drag || !geo) return;
    const r = plan.getBoundingClientRect();
    const dx = ((e.clientX - drag.x) * geo.w) / r.width;
    const dy = ((e.clientY - drag.y) * geo.h) / r.height;
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 6) drag.moved = true;
    if (drag.moved && st.scale > 1) {
      st.tx = drag.tx + dx;
      st.ty = drag.ty + dy;
      clampPan();
      applyView();
    }
  };
  const onUp = (e) => {
    const d = drag;
    drag = null;
    if (!d || d.moved || !plan.contains(e.target)) return;
    const hit = e.target.closest?.('[data-chair]');
    if (hit) {
      const [tid, n] = hit.dataset.chair.split(':');
      return chooseChair(tid, Number(n));
    }
    const tg = e.target.closest?.('[data-table]');
    if (tg) chooseTable(tg.dataset.table);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  // Keyboard: arrows to the nearest table in the same row or column, Enter opens it.
  plan.addEventListener('keydown', (e) => {
    if (!st.data) return;
    const list = tables();
    const cur = tableOf(st.kbd) || list[0];
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (dir) {
      e.preventDefault();
      if (!st.kbd) st.kbd = cur.id;
      else {
        const [x0, y0] = geo.pos.get(cur.id);
        const next = list.filter((o) => {
          const [x, y] = geo.pos.get(o.id);
          return dir[0] ? Math.abs(y - y0) < 10 && Math.sign(x - x0) === dir[0] : Math.abs(x - x0) < 10 && Math.sign(y - y0) === dir[1];
        }).sort((a, b) => {
          const [ax, ay] = geo.pos.get(a.id);
          const [bx, by] = geo.pos.get(b.id);
          return Math.hypot(ax - x0, ay - y0) - Math.hypot(bx - x0, by - y0);
        });
        if (next.length) st.kbd = next[0].id;
      }
      focusTable(st.kbd);
      draw();
      const t = tableOf(st.kbd);
      announce(`Table ${t.number}, ${t.classLabel}, ${t.claims} of ${t.capacity} taken${t.mine ? '' : ', not yours'}.`);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (st.kbd || cur) chooseTable(st.kbd || cur.id);
    } else if (e.key === '+' || e.key === '=') zoomAt(1.35);
    else if (e.key === '-' || e.key === '_') zoomAt(1 / 1.35);
    else if (e.key === '1' || e.key === '0') fit();
  });
  plan.addEventListener('focus', () => {
    if (!st.kbd && tables()[0]) st.kbd = st.tableId || tables()[0].id;
    draw();
  });
  plan.addEventListener('blur', () => draw());
  const announce = (msg) => {
    const live = dBox.querySelector('[data-announce]');
    if (live) live.textContent = msg;
  };

  // ----- Choosing -----
  async function loadRecs() {
    const gid = st.guestId;
    if (!gid) return (st.recs = null);
    try {
      const r = await api.get(`${base}/recommend?guestIds=${encodeURIComponent(gid)}`);
      if (st.guestId === gid) {
        st.recs = r;
        st.recFor = gid;
      }
    } catch {
      st.recs = null;
    }
  }
  async function chooseGuest(gid) {
    st.guestId = st.guestId === gid ? null : gid;
    st.chair = null;
    st.moving = null;
    st.notice = '';
    await loadRecs();
    render();
  }
  function chooseTable(tid) {
    st.tableId = tid;
    st.kbd = tid;
    st.chair = null;
    render();
  }
  function chooseChair(tid, n) {
    st.tableId = tid;
    st.kbd = tid;
    st.chair = n;
    render();
  }

  // ----- One command; a refusal redraws from the state in the reply and says what happened -----
  async function send(cmd, done, ctx = {}) {
    if (st.busy) return;
    st.busy = true;
    renderDetail();
    try {
      await api.post(`${base}/commands`, { ...cmd, opId: opId() });
      st.notice = '';
      if (done) toast(done);
      if (cmd.type === 'assign' && st.guestId === cmd.guestId) {
        st.guestId = null;
        st.recs = null;
      }
      st.moving = null;
      st.chair = null;
      onChange();
    } catch (err) {
      if (!err.code) {
        st.busy = false;
        renderDetail();
        return toast(err.message, 'error');
      }
      st.notice = recovery(err, cmd, ctx);
      applyFresh(err.fresh);
      st.chair = null;
      if (st.guestId) await loadRecs();
    } finally {
      st.busy = false;
    }
    await refresh();
  }
  function recovery(err, cmd, ctx) {
    const t = tableOf(cmd.tableId);
    const who = ctx.name || 'This guest';
    if (err.code === 'seat_taken') return `Chair ${cmd.seatNo} at table ${t?.number ?? '?'} was just taken on another device. The plan shows it now; choose another chair.`;
    if (err.code === 'table_full') return `Table ${t?.number ?? '?'} just filled. Updated options are ranked on the plan.`;
    if (err.code === 'no_eligible_seat') return `No table that ${who === 'This guest' ? 'this guest' : who} may sit at has a free chair. Refer them to the Super Administrator.`;
    if (err.code === 'guest_moved') return `${who} was seated or moved on another device. The plan shows where they are now.`;
    if (err.code === 'out_of_scope') return `${who} or table ${t?.number ?? ''} is no longer yours: the Super Administrator gave it to someone else. Ask them, or the Super Administrator.`;
    if (err.code === 'stale') return 'This changed on another device since you chose it. The plan shows it as it is now; choose again.';
    return err.message;
  }
  // The refusal's fresh state: the chairs taken now at the tables involved, until the room reloads.
  function applyFresh(fresh) {
    for (const ft of fresh?.tables || []) {
      const t = tableOf(ft.id);
      if (!t) continue;
      for (const c of t.chairs) if (ft.taken.includes(c.seatNo) && !c.taken) Object.assign(c, { taken: true, initials: '?', name: 'Taken just now', company: '', status: 'confirmed', mine: false });
      Object.assign(t, { claims: ft.claims, confirmed: ft.confirmed, reserved: ft.reserved, free: ft.free });
    }
    for (const fg of fresh?.guests || []) if (fg.seat && st.data) st.data.waiting = st.data.waiting.filter((w) => w.guestId !== fg.id);
    draw();
  }

  // ----- Side panels -----
  function renderQueue() {
    const list = st.data?.waiting || [];
    const q = st.q.toLowerCase();
    const shown = list.filter((g) => !q || `${g.name} ${g.company} ${g.industry}`.toLowerCase().includes(q));
    const sa = st.data?.role === 'super';
    mount(qBox, html`<h2>Waiting for a seat <small>${plural(list.length, 'guest')} checked in</small></h2>
      ${list.length > 6 ? html`<input type="search" class="ca-room-q" data-q placeholder="Search name, company, industry" aria-label="Search guests waiting" value="${st.q}" />` : ''}
      ${shown.length ? html`<ul class="ca-room-guests">${shown.map((g) => html`<li><button type="button" class="ca-room-guest" data-guest="${g.guestId}" aria-pressed="${st.guestId === g.guestId}">
          <span class="ca-av" aria-hidden="true">${g.initials}</span><span class="ca-gn">${g.name}</span>
          <span class="ca-gm">${[g.company, g.industry, g.classLabel, sa && g.ownerName ? g.ownerName : '', g.arrivedAt ? `in ${fmtManila(g.arrivedAt, { date: false })}` : ''].filter(Boolean).join(' · ')}</span></button></li>`)}</ul>`
        : html`<p class="hint">${list.length ? 'No guest matches.' : sa ? 'Nobody is waiting for a seat.' : 'Nobody is waiting for you right now.'}</p>`}`);
    qBox.querySelectorAll('[data-guest]').forEach((b) => b.addEventListener('click', () => chooseGuest(b.dataset.guest)));
    const qi = qBox.querySelector('[data-q]');
    qi?.addEventListener('input', () => {
      st.q = qi.value;
      const pos = qi.selectionStart;
      renderQueue();
      const n = qBox.querySelector('[data-q]');
      n?.focus();
      n?.setSelectionRange(pos, pos);
    });
  }

  function renderDetail() {
    const g = chosenGuest();
    const t = tableOf(st.tableId);
    const recs = st.recs && st.recFor === st.guestId ? st.recs : null;
    const sa = st.data?.role === 'super';
    const parts = [];
    if (st.notice) parts.push(html`<p class="ca-notice" role="alert">${icon('alert', 16)} ${st.notice}</p>`);
    if (g) {
      const mine = recs?.mine || [];
      parts.push(html`<h2>Recommended for ${g.name} <small>${g.industry || g.classLabel}</small></h2>
        ${g.releasedNeedsSuper && !sa ? html`<p class="ca-notice">${icon('flag', 16)} This guest's reservation was released: the Super Administrator seats them.</p>` : ''}
        ${!recs ? html`<p class="hint">Loading the recommendations…</p>` : mine.length ? html`<div class="ca-recs">${mine.slice(0, 3).map((r, i) => html`<button type="button" class="ca-rec" data-rec="${r.tableId}"><span class="ca-rec-n">${i + 1}</span>
            <span><strong>Table ${r.number}</strong><br><span class="ca-why">${r.reasons.join(' · ')}</span></span><span class="ca-rec-left">${r.free} open</span></button>`)}</div>
          ${mine.length > 3 ? html`<p class="hint">${plural(mine.length - 3, 'other eligible table')} of yours with open chairs: choose any on the plan.</p>` : ''}`
        : html`<p class="hint">None of your tables can take ${g.name} now. Refer them to the Super Administrator.</p>`}`);
    }
    if (t) {
      const yours = t.mine;
      const open = t.capacity - t.claims;
      const R = 41;
      const dial = t.chairs.map((c) => {
        const a = (chairAngle(st.data.room || { stageSide: 'right', chairsPerTable: t.capacity }, c.seatNo) * Math.PI) / 180;
        const x = 50 + R * Math.cos(a);
        const y = 50 + R * Math.sin(a);
        const state = c.taken ? (c.status === 'reserved' ? 'reserved' : 'seated') : 'open';
        return html`<button type="button" class="ca-dchair ${state} ${st.chair === c.seatNo ? 'pick' : ''}" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%" data-dchair="${c.seatNo}" aria-pressed="${st.chair === c.seatNo}" aria-label="${chairLabel(c)}" title="${chairLabel(c)}">${c.taken ? c.initials : c.seatNo}</button>`;
      });
      parts.push(html`<div class="ca-tview"><div class="ca-tview-head"><strong>Table ${t.number}</strong><span class="ca-pill">${t.classLabel} table · ${open} of ${t.capacity} open</span></div>
        <p class="hint">${!t.active ? 'Not in use.' : yours ? (sa ? (t.ownerName ? `Given to ${t.ownerName}` : 'No owner: yours') : 'Yours') : `${t.ownerName || 'The Super Administrator'}'s table: you can look, not seat.`}</p>
        <div class="ca-dial" role="group" aria-label="Chairs at table ${t.number}">${dial}<div class="ca-dial-top"><span><strong>${t.number}</strong>${t.free < 1 ? 'FULL' : `${t.claims}/${t.capacity}`}</span></div></div>
        ${t.industries.length ? html`<div class="ca-inds">${t.industries.map((x) => html`<span class="ca-pill ${g && x === g.industry ? 'same' : ''}">${x}</span>`)}</div>` : ''}
        ${t.chairs.some((c) => c.taken) || t.unnumbered.length ? html`<ul class="ca-who">${t.chairs.filter((c) => c.taken).map((c) => html`<li><span class="ca-cn">${c.seatNo}</span><span><strong>${c.name}</strong><br><span class="ca-gm">${[c.company, c.industry].filter(Boolean).join(' · ')}</span></span><span class="ca-pill">${c.status === 'reserved' ? 'Reserved' : 'Seated'}</span></li>`)}
          ${t.unnumbered.map((c) => html`<li><span class="ca-cn">–</span><span><strong>${c.name}</strong></span><span class="ca-pill">No chair number</span></li>`)}</ul>` : ''}
        ${confirmBox(g, t)}</div>`);
    }
    if (!g && !t) parts.push(html`<h2>How to seat a guest</h2><p class="hint">1. Choose a guest under <strong>Waiting for a seat</strong>. Their best tables get a gold ring and a number on the plan: same industry first, then related industries, then any table with room.</p><p class="hint">2. Choose a table, then an open chair, and <strong>Seat here</strong>. Each table holds ${tables()[0]?.capacity || 10}; a full table shows FULL.</p><p class="hint">3. Choose a taken chair to see who sits there, and to move them.</p>`);
    parts.push(html`<p class="sr-only" data-announce aria-live="polite"></p>`);
    mount(dBox, parts);
    wireDetail(g, t);
  }

  function confirmBox(g, t) {
    if (st.chair == null) return '';
    const c = t.chairs.find((x) => x.seatNo === st.chair);
    const busy = st.busy ? 'disabled' : '';
    if (!c.taken) {
      if (st.moving) {
        const m = st.moving;
        if (!t.mine) return html`<div class="ca-confirm"><span>Table ${t.number} is not yours. Choose a chair at one of your tables.</span></div>`;
        return html`<div class="ca-confirm"><span>Move <strong>${m.name}</strong> to table ${t.number}, chair ${c.seatNo}?</span><div class="actions"><button type="button" class="btn primary ca-48" data-act="move-here" ${busy}>Move here</button><button type="button" class="btn ca-48" data-act="cancel">Cancel</button></div></div>`;
      }
      if (!g) return html`<div class="ca-confirm"><span>Chair ${c.seatNo} is open. Choose a guest under <strong>Waiting for a seat</strong> to seat them here.</span></div>`;
      if (!t.mine) return html`<div class="ca-confirm"><span>Table ${t.number} is ${t.ownerName || 'the Super Administrator'}'s. Ask them, or the Super Administrator, to seat ${g.name}.</span></div>`;
      if (t.free < 1) return html`<div class="ca-confirm"><span>Table ${t.number} is full.</span></div>`;
      const recs = st.recs && st.recFor === st.guestId ? st.recs : null;
      const ok = recs ? (recs.mine || []).some((r) => r.tableId === t.id) : true;
      if (!ok) return html`<div class="ca-confirm"><span>Table ${t.number} is a ${t.classLabel.toLowerCase()} table; ${g.name} is a ${g.classLabel.toLowerCase()} guest.</span></div>`;
      return html`<div class="ca-confirm"><span>Seat <strong>${g.name}</strong> at table ${t.number}, chair ${c.seatNo}?</span><div class="actions"><button type="button" class="btn primary ca-48" data-act="seat" ${busy}>Seat here</button><button type="button" class="btn ca-48" data-act="cancel">Cancel</button></div></div>`;
    }
    // Moving a guest onto a seated guest's chair: the two swap seats (one command, both or neither).
    if (st.moving && st.moving.guestId !== c.guestId) {
      if (!(c.mine && t.mine) || c.status === 'reserved') return html`<div class="ca-confirm"><span>${c.status === 'reserved' ? `Chair ${c.seatNo} is reserved for ${c.name}.` : `${c.name} is not yours to move.`} Choose another chair.</span><div class="actions"><button type="button" class="btn ca-48" data-act="cancel">Cancel</button></div></div>`;
      return html`<div class="ca-confirm"><span>Swap seats? <strong>${st.moving.name}</strong> takes chair ${c.seatNo} at table ${t.number}, and <strong>${c.name}</strong> takes ${st.moving.name}'s chair.</span><div class="actions"><button type="button" class="btn primary ca-48" data-act="swap" ${busy}>Swap seats</button><button type="button" class="btn ca-48" data-act="cancel">Cancel</button></div></div>`;
    }
    const sa = st.data.role === 'super';
    const can = c.mine && t.mine;
    return html`<div class="ca-confirm"><span><strong>${c.name}</strong>${c.company ? `, ${c.company}` : ''}: chair ${c.seatNo}. ${c.status === 'reserved' ? 'Reserved before the event; not arrived yet.' : 'Seated.'}</span>
      ${can ? html`<div class="actions">${c.status === 'reserved'
        ? html`<button type="button" class="btn primary ca-48" data-act="arrive" ${busy}>Arrived: seat now</button>${sa || st.data.settings?.releaseDelegable ? html`<button type="button" class="btn danger ghost ca-48" data-act="release" ${busy}>Release reservation</button>` : ''}`
        : html`<button type="button" class="btn ca-48" data-act="move" ${busy}>${icon('repeat', 16)} Move</button><button type="button" class="btn ca-48" data-act="unseat" ${busy}>Back to waiting</button>`}</div>` : html`<p class="hint">${c.mine ? 'This table is not yours.' : 'Not your guest: their owner or the Super Administrator changes their seat.'}</p>`}</div>`;
  }

  function wireDetail(g, t) {
    dBox.querySelectorAll('[data-rec]').forEach((b) => b.addEventListener('click', () => {
      chooseTable(b.dataset.rec);
      focusTable(b.dataset.rec);
    }));
    dBox.querySelectorAll('[data-dchair]').forEach((b) => b.addEventListener('click', () => {
      st.chair = Number(b.dataset.dchair);
      render();
      dBox.querySelector(`[data-dchair="${b.dataset.dchair}"]`)?.focus();
    }));
    const act = (name, fn) => dBox.querySelector(`[data-act="${name}"]`)?.addEventListener('click', fn);
    const c = t?.chairs.find((x) => x.seatNo === st.chair);
    act('cancel', () => {
      st.chair = null;
      st.moving = null;
      render();
    });
    act('seat', () => send({ type: 'assign', guestId: g.guestId, tableId: t.id, seatNo: c.seatNo, expect: { [g.guestId]: g.rev, [t.id]: t.rev } }, `${g.name}: table ${t.number}, chair ${c.seatNo}.`, { name: g.name }));
    act('move-here', () => send({ type: 'transfer', guestId: st.moving.guestId, tableId: t.id, seatNo: c.seatNo, expect: { [st.moving.guestId]: st.moving.rev } }, `${st.moving.name} moved to table ${t.number}, chair ${c.seatNo}.`, { name: st.moving.name }));
    act('swap', () => send({ type: 'swap', guestIds: [st.moving.guestId, c.guestId], expect: { [st.moving.guestId]: st.moving.rev, [c.guestId]: c.rev }, reason: 'Swapped on the room plan' }, `${st.moving.name} and ${c.name} swapped seats.`, { name: st.moving.name }));
    act('arrive', () => send({ type: 'checkIn', guestId: c.guestId }, `${c.name} has arrived: table ${t.number}, chair ${c.seatNo}.`, { name: c.name }));
    act('move', () => {
      st.moving = { guestId: c.guestId, name: c.name, rev: c.rev };
      st.notice = `Choose the new chair for ${c.name} on the plan: an open chair to move them, or a seated guest's chair to swap.`;
      st.chair = null;
      render();
    });
    act('unseat', async () => {
      if (await confirmDialog(`Send ${c.name} back to waiting? Table ${t.number}, chair ${c.seatNo} becomes free.`, { confirmLabel: 'Back to waiting', danger: false })) send({ type: 'unseat', guestId: c.guestId, reason: 'Sent back to waiting' }, `${c.name} is waiting for a seat again.`, { name: c.name });
    });
    act('release', () => modal({
      title: 'Release reservation',
      body: html`<p>Release table ${t.number}, chair ${c.seatNo}, reserved for <strong>${c.name}</strong>? The chair becomes free for someone else. If they arrive later, they are referred to the Super Administrator to be seated.</p>
        <label class="field"><span>Reason <em>*</em></span><input name="reason" required maxlength="200" placeholder="e.g. No-show by 8:00 PM" /></label>`,
      submitLabel: 'Release',
      onSubmit: (f) => send({ type: 'release', guestId: c.guestId, reason: f.reason.value }, 'Reservation released.', { name: c.name }),
    }));
  }

  function render() {
    draw();
    renderQueue();
    renderDetail();
  }

  // ----- Data: the room now, then the same short poll as the queues -----
  function take(data) {
    st.data = data;
    if (st.guestId && !guestOf(st.guestId)) {
      st.guestId = null;
      st.recs = null;
    }
    if (st.tableId && !tableOf(st.tableId)) st.tableId = null;
    if (st.moving && !seatedGuest(st.moving.guestId)) st.moving = null;
  }
  const bar = el.querySelector('[data-bar]');
  const poll = livePoll(`${base}/changes?tab=room`, {
    bar,
    onBoard: async (board, reply) => {
      if (!board) {
        mount(el, html`<div class="card empty">${icon('lock', 40)}<h2>${reply.error?.message || 'The room plan is not available.'}</h2></div>`);
        return;
      }
      take(board);
      if (st.guestId) await loadRecs();
      render();
    },
  });
  async function refresh() {
    poll.reset();
  }
  return () => {
    poll.stop();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
}
