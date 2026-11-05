// ATLAS home (/): one sign-in, then a card for each system the account may use (Academic,
// Learn, People, Finance, Facilities). Systems that are not built yet show as "Coming soon".
import { api } from '../api.js';
import { html, mount, option, initials, timeAgo, fmtDate } from '../ui.js';
import { ctx, applyBranding, authHero, authLogo, atlasWord, markSrc, BYLINE, passwordField, onFormSubmit, forcePasswordView, openChangePassword, setTheme, isDark, renderThemeButton, campusMenu, wireCampusMenu } from '../shell.js';
import { icon } from '../icons.js';
import { roleLabel } from '/shared/roles.js';

const authEl = document.getElementById('auth');
const appEl = document.getElementById('app');
const NEXT_OK = { portal: ['/lms/', '/hris/'], admin: ['/admin', '/hris/'], hris: ['/hris/'] };
const next = new URLSearchParams(location.search).get('next');

document.getElementById('theme-btn').addEventListener('click', () => setTheme(!isDark()));

function showAuth(render) {
  document.body.classList.add('auth-mode');
  document.body.classList.remove('booting');
  render(authEl);
}

// ----- Signed out -----
function hubScreen(card, systems) {
  const b = ctx.info.branding;
  mount(authEl, html`
    <div class="auth-screen">
      ${authHero({
        kicker: 'Unified education management',
        title: b.tagline || 'One sign-in for every school system.',
        text: `For the students, parents, faculty and staff of ${b.schoolName}.`,
        points: [
          ...systems.filter((s) => s.status === 'live').map((s) => [s.icon, s.product, s.title]),
          ...(systems.some((s) => s.status !== 'live') ? [['clock', 'Coming soon', systems.filter((s) => s.status !== 'live').map((s) => s.product).join(', ')]] : []),
        ],
      })}
      <section class="auth-panel">${card}</section>
    </div>`);
  authEl.querySelectorAll('[data-toggle-pw]').forEach((btn) => btn.addEventListener('click', () => {
    const input = btn.previousElementSibling;
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.textContent = input.type === 'password' ? 'Show' : 'Hide';
  }));
  const form = authEl.querySelector('form');
  form?.querySelector('input')?.focus();
  return form;
}

const cardLogo = authLogo;

function signInView(status) {
  if (status.setupRequired) {
    return hubScreen(html`<div class="auth-card">${cardLogo()}<h2>Not set up yet</h2><p class="muted">An administrator needs to set up the system first: create the administrator account and name the school.</p><a class="btn primary block" href="/admin">Set up in the admin panel</a></div>`, status.systems);
  }
  const form = hubScreen(html`
    <form class="auth-card" novalidate>
      ${cardLogo()}
      <h2>Sign in</h2>
      <p class="muted">Sign in to ATLAS with the account your school gave you.</p>
      <label class="field"><span>Username</span><input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required /></label>
      ${passwordField('Password', 'password', 'current-password')}
      <p class="form-error" hidden></p>
      <button class="btn primary block" type="submit">Sign in</button>
      ${status.registrationOpen ? html`<p class="auth-switch">New student? <button type="button" class="link" id="apply">Apply for admission</button></p>` : ''}
      <p class="auth-foot">Forgot your password? Ask the registrar or your administrator to reset it.</p>
    </form>`, status.systems);
  form.querySelector('#apply')?.addEventListener('click', () => applyView(status));
  onFormSubmit(form, async ({ username, password }) => {
    if (!username || !password) throw new Error('Enter your username and password.');
    await api.post('/api/hub/login', { username, password });
    boot();
  });
}

function applyView(status) {
  const back = () => signInView(status);
  const form = hubScreen(html`
    <form class="auth-card" novalidate>
      ${cardLogo()}
      <h2>Apply for admission</h2>
      <p class="muted">The registrar reviews your application; you can sign in once you are admitted.</p>
      <label class="field"><span>Full name</span><input name="name" autocomplete="name" required /></label>
      <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required /></label>
      <label class="field" id="campus-field" hidden><span>Campus</span><select name="campusId" id="campuses"></select></label>
      <label class="field"><span>Program</span><select name="programId" id="programs">${option('', 'Undecided')}</select></label>
      <label class="field"><span>Year level</span><select name="yearLevel">${[1, 2, 3, 4, 5].map((y) => option(y, `Year ${y}`))}</select></label>
      <label class="field"><span>Choose a username</span><input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required /></label>
      ${passwordField('Choose a password (at least 8 characters)', 'password', 'new-password')}
      <label class="field"><span>Anything the registrar should know? (optional)</span><textarea name="note" style="min-height:70px"></textarea></label>
      <p class="form-error" hidden></p>
      <button class="btn primary block" type="submit">Send application</button>
      <p class="auth-switch"><button type="button" class="link" id="back">← Back to sign in</button></p>
    </form>`, status.systems);
  api.get('/api/auth/programs').then((programs) => {
    form.querySelector('#programs').insertAdjacentHTML('beforeend', programs.map((p) => `<option value="${p.id}">${p.code} · ${p.name.replace(/</g, '&lt;')}</option>`).join(''));
  });
  api.get('/api/auth/campuses').then((campuses) => {
    if (campuses.length < 2) return;
    form.querySelector('#campus-field').hidden = false;
    form.querySelector('#campuses').innerHTML = `<option value="">Choose a campus…</option>${campuses.map((c) => `<option value="${c.id}">${c.name.replace(/</g, '&lt;')}</option>`).join('')}`;
  });
  form.querySelector('#back').addEventListener('click', back);
  onFormSubmit(form, async (v) => {
    await api.post('/api/auth/apply', v);
    hubScreen(html`<div class="auth-card"><h2>Application sent</h2><p>Thank you, ${v.name}. The registrar will review it; once you are admitted, sign in here with the username <strong>${v.username.toLowerCase()}</strong>.</p><button class="btn primary block" id="ok">Back to sign in</button></div>`, status.systems);
    authEl.querySelector('#ok').addEventListener('click', back);
  });
}

// ----- Signed in -----
function userMenu(status) {
  const u = status.user;
  const box = document.getElementById('user-box');
  mount(box, html`
    <button type="button" class="user-btn" id="user-btn" aria-haspopup="menu" aria-expanded="false">
      <span class="avatar">${initials(u.name)}</span><span class="who-text"><strong>${u.name}</strong><small>${roleLabel(u.role)}${status.campusName ? ` · ${status.campusName}` : ''}</small></span>${icon('chevronDown', 16)}
    </button>
    <div class="menu-pop" id="user-pop" role="menu" hidden>
      <div class="who"><strong>${u.name}</strong><small>${u.username}${u.email ? ` · ${u.email}` : ''}</small><small>${roleLabel(u.role)}${u.studentNo ? ` · ${u.studentNo}` : ''}</small></div>
      <button type="button" id="change-pw">${icon('key')} Change password</button>
      <button type="button" id="sign-out">${icon('logout')} Sign out</button>
      ${campusMenu(status)}
    </div>`);
  wireCampusMenu(box, status.authBase);
  const pop = box.querySelector('#user-pop');
  box.querySelector('#user-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
  });
  document.addEventListener('click', (e) => !box.contains(e.target) && (pop.hidden = true));
  box.querySelector('#change-pw').addEventListener('click', () => {
    pop.hidden = true;
    openChangePassword(status.authBase);
  });
  box.querySelector('#sign-out').addEventListener('click', signOut);
}

const dateBox = (ymd) => {
  const d = new Date(`${ymd}T00:00:00`);
  return html`<div class="date-box"><b>${d.toLocaleDateString('en-PH', { month: 'short' })}</b><span>${d.getDate()}</span></div>`;
};

function systemCard(s, side) {
  const live = s.status === 'live' && s.url;
  const openLabel = s.id === 'lms' && side === 'admin' ? 'Open the admin panel' : `Open ${s.product}`;
  const body = html`
    <span class="sys-top"><span class="sys-ic">${icon(s.icon, 26)}</span>${live ? html`<span class="sys-code">${s.short}</span>` : html`<span class="badge gray">${icon('lock', 12)} Coming soon</span>`}</span>
    <span class="sys-name">${s.product}</span>
    <strong class="sys-title">${s.title}</strong>
    <p>${s.description}</p>
    <span class="sys-open">${live ? html`${openLabel} ${icon(s.external ? 'external' : 'chevronRight', 16)}` : 'Not available yet'}</span>`;
  return live
    ? html`<a class="sys-card" href="${s.url}" ${s.external ? html`target="_blank" rel="noopener"` : ''}>${body}</a>`
    : html`<div class="sys-card soon" aria-disabled="true" title="${s.product} is coming soon">${body}</div>`;
}

async function homeView(status) {
  const u = status.user;
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const systems = [...status.systems].sort((a, b) => (b.status === 'live' && b.url ? 1 : 0) - (a.status === 'live' && a.url ? 1 : 0));
  const live = systems.filter((s) => s.status === 'live' && s.url).length;
  mount(appEl, html`
    <section class="hub-hero"><img class="hero-mark" src="/img/brand/atlas-mark-white.svg" alt="" /><div class="hub-wrap">
      <p class="hub-kicker">${new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${status.branding.termName ? ` · ${status.branding.termName}` : ''}</p>
      <h1>${hello}, ${u.name.split(' ')[0]}</h1>
      <p>Welcome to ATLAS, the education platform of ${status.branding.schoolName}. Choose a system to continue.</p>
      <span class="hub-role">${icon('user', 14)} ${roleLabel(u.role)}${u.studentNo ? ` · ${u.studentNo}` : ''}</span>
      ${status.campusName ? html`<span class="hub-role">${icon('building', 14)} ${status.campusName}${status.campuses.length > 1 ? html` · <button type="button" class="link hub-switch" id="hub-switch">switch</button>` : ''}</span>` : ''}
    </div></section>
    <section class="hub-wrap">
      <div class="card-head"><h2>${icon('grid')} Your systems</h2><span class="muted small">${live} of ${systems.length} available</span></div>
      <div class="sys-grid">${systems.map((s) => systemCard(s, status.side))}</div>
    </section>
    <section class="hub-wrap cols wide-left" id="feed"></section>
    <footer class="hub-foot"><div class="hub-wrap"><span>© ${new Date().getFullYear()} ${status.branding.schoolName}</span><span class="atlas-foot"><img src="${markSrc(isDark())}" alt="" />ATLAS · ${BYLINE}</span></div></footer>`);
  appEl.querySelector('#hub-switch')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('user-pop').hidden = false;
  });
  const feed = await api.get('/api/hub/feed').catch(() => ({ news: [], events: [] }));
  if (!feed.news.length && !feed.events.length) return appEl.querySelector('#feed').remove();
  mount(appEl.querySelector('#feed'), html`
    <section class="card"><div class="card-head"><h2>${icon('news')} Announcements</h2></div>
      ${feed.news.length ? html`<div class="list">${feed.news.map((n) => html`<div class="list-item"><span class="item-ic">${icon(n.pinned ? 'pin' : 'megaphone')}</span>
        <span class="grow"><strong>${n.title}</strong><small>${n.authorName} · ${timeAgo(n.createdAt)}${n.comments ? ` · ${n.comments} comment${n.comments === 1 ? '' : 's'}` : ''}</small>${n.body ? html`<p class="small pre" style="margin:6px 0 0">${n.body}${n.body.length >= 280 ? '…' : ''}</p>` : ''}</span></div>`)}</div>` : html`<p class="muted">No announcements.</p>`}
    </section>
    <section class="card"><div class="card-head"><h2>${icon('calendar')} Upcoming events</h2></div>
      ${feed.events.length ? html`<div class="list">${feed.events.map((e) => html`<div class="list-item">${dateBox(e.startDate)}<span class="grow"><strong>${e.title}</strong><small>${fmtDate(e.startDate)}${e.endDate && e.endDate !== e.startDate ? ` – ${fmtDate(e.endDate)}` : ''}${e.location ? ` · ${e.location}` : ''}</small></span></div>`)}</div>` : html`<p class="muted">Nothing scheduled.</p>`}
    </section>`);
}

async function signOut() {
  await api.post('/api/hub/logout').catch(() => {});
  location.href = '/';
}

async function boot() {
  let status;
  try {
    status = await api.get('/api/hub/status');
  } catch {
    return showAuth((el) => mount(el, html`<div class="empty"><h2>Cannot reach the server</h2><p>Start it (double-click “Start ATLAS”, or <code>npm start</code>), then reload this page.</p></div>`));
  }
  ctx.info = status;
  ctx.user = status.user;
  applyBranding(status.branding);
  document.title = `ATLAS · ${status.branding.schoolName}`;
  if (!status.user) return showAuth(() => signInView(status));
  if (status.user.mustChangePassword) {
    return showAuth((el) => forcePasswordView(el, { admin: status.side === 'admin', authBase: status.authBase, onDone: boot, onSignOut: signOut }));
  }
  // Came from a system that needed a sign-in: go straight back there.
  if (next && NEXT_OK[status.side]?.includes(next)) return location.replace(next);
  document.body.classList.remove('auth-mode', 'booting');
  mount(authEl, '');
  mount(document.getElementById('school-name'), atlasWord());
  mount(document.getElementById('brand-sub'), html`${status.branding.schoolName}${status.campusName ? html` · <strong class="campus-name">${status.campusName}</strong>` : ''}${status.branding.termName ? ` · ${status.branding.termName}` : ''}`);
  renderThemeButton();
  userMenu(status);
  homeView(status);
}

window.addEventListener('auth:expired', () => boot());
boot();
