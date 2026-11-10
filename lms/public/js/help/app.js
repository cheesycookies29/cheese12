// Help & guides (/help/): a guide for each kind of user, with a walkthrough, how-to steps, the
// screens and common questions. The guides come with ATLAS (docs/guides) and are updated with
// it; administrators can edit them here (their version is kept, and ATLAS says when the built-in
// guide has changed since). Opened from the Help button in every system's top bar.
//
// Layout after documentation sites (Starlight, VitePress): guides by system on the left, the
// guide in the middle, "On this page" on the right following the reader, previous/next at the end.
import { api } from '../api.js';
import { html, raw, mount, toast, modal, confirmDialog, fmtDate } from '../ui.js';
import { ctx, applyBranding, setTheme, isDark, renderThemeButton, atlasWord, failureNotice } from '../shell.js';
import { icon, iconSvg } from '../icons.js';
import { parseGuide, renderMarkdown, headingsOf } from '/shared/markdown.js';
import { guideFor } from '/shared/help.js';
import { ROLES } from '/shared/roles.js';

const appEl = document.getElementById('app');
// The systems, in the order they appear, with their icons.
const SYSTEMS = [
  ['home', 'ATLAS home', 'grid'], ['learn', 'ATLAS Learn', 'book'], ['admin', 'Admin panel', 'settings'],
  ['academic', 'ATLAS Academic', 'cap'], ['people', 'ATLAS People', 'users'], ['finance', 'ATLAS Finance', 'wallet'],
];
const SYS = Object.fromEntries(SYSTEMS.map(([k, label, ic]) => [k, { label, icon: ic }]));
const START = ['getting-started', 'whats-new'];
let list = null; // { signedIn, role, roleLabel, canEdit, version, guides }
// Signed out, only "Getting started" can be read (the sign-in pages link here); the rest asks to sign in.
const SIGN_IN = `/?next=${encodeURIComponent('/help/')}`;
const signedIn = () => Boolean(ctx.user);
let dirty = false;
let spy = null;

document.getElementById('theme-btn').addEventListener('click', () => setTheme(!isDark()));
document.getElementById('home-btn').innerHTML = iconSvg('grid');
document.getElementById('menu-btn').innerHTML = iconSvg('menu', 20);
document.querySelector('#top-search .search-ic').innerHTML = iconSvg('search', 16);
window.addEventListener('beforeunload', (e) => dirty && e.preventDefault());

// '#/teacher#gradebook' -> { id: 'teacher', section: 'gradebook' }; '#/' -> home; '#/edit/teacher' -> editor.
function route() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  if (h.startsWith('edit/')) return { edit: h.slice(5) };
  if (h === 'new') return { edit: '' };
  if (h.startsWith('search/')) return { q: h.slice(7) };
  const [id, section] = h.split('#');
  return { id: id || '', section: section || '' };
}

// ----- Sidebar (guides by system) and drawer on small screens -----
const sideOpen = (open) => {
  document.body.classList.toggle('help-nav-open', open);
  document.getElementById('menu-btn').setAttribute('aria-expanded', String(open));
  document.getElementById('help-scrim').hidden = !open;
};
document.getElementById('menu-btn').addEventListener('click', () => sideOpen(!document.body.classList.contains('help-nav-open')));
document.getElementById('help-scrim').addEventListener('click', () => sideOpen(false));

const primarySystem = (g) => g.apps[0] || 'home';
const sysIcon = (g, size = 18) => icon(START.includes(g.id) ? (g.id === 'whats-new' ? 'sparkle' : 'flag') : SYS[primarySystem(g)]?.icon || 'book', size);

function sidebar(activeId) {
  const link = (g, withIcon = false) => html`<a class="side-link ${g.id === activeId ? 'active' : ''}" href="#/${g.id}" ${g.id === activeId ? 'aria-current="page"' : ''}>${withIcon ? sysIcon(g, 16) : ''}<span class="side-text">${g.title}</span>${g.edited || g.custom ? html`<span class="dot-school" title="${g.custom ? 'Written by the school' : 'Edited by the school'}"></span>` : ''}</a>`;
  const mine = list.guides.filter((g) => g.forYou && !START.includes(g.id));
  const by = {};
  for (const g of list.guides) if (!START.includes(g.id)) (by[primarySystem(g)] ||= []).push(g);
  return html`<aside class="help-side" id="help-side" aria-label="Guides">
    <nav>
      <p class="side-label">Start here</p>
      <a class="side-link ${activeId === '' ? 'active' : ''}" href="#/" ${activeId === '' ? 'aria-current="page"' : ''}>${icon('home', 16)}<span class="side-text">Help home</span></a>
      ${list.guides.filter((g) => START.includes(g.id)).map((g) => link(g, true))}
      ${mine.length ? html`<p class="side-label">Your guides · ${list.roleLabel}</p>${mine.map((g) => link(g, true))}` : ''}
      ${SYSTEMS.filter(([k]) => by[k]?.length).map(([k, label, ic]) => html`<details class="side-group" ${by[k].some((g) => g.id === activeId) || !mine.length ? 'open' : ''}>
        <summary>${icon(ic, 16)} ${label}<span class="count">${by[k].length}</span></summary>${by[k].map((g) => link(g))}</details>`)}
    </nav>
    <div class="side-foot">
      ${list.canEdit ? html`<a class="btn sm" href="#/new">${icon('plus', 14)} New guide</a>` : ''}
      ${signedIn() ? '' : html`<a class="btn sm primary" href="${SIGN_IN}">${icon('key', 14)} Sign in</a><p>Sign in to see the guides for your own work: classes, records, payslips and more.</p>`}
      <p>Guides for ATLAS ${list.version}. They are updated with ATLAS${list.canEdit ? '; your school\'s edits are kept' : ''}.</p>
    </div>
  </aside>`;
}

function layout(activeId, main, { toc = null, wide = false } = {}) {
  spy?.disconnect();
  sideOpen(false);
  mount(appEl, html`<div class="help-layout ${toc ? 'has-toc' : ''} ${wide ? 'wide' : ''}">${sidebar(activeId)}<div class="help-content" id="help-content">${main}</div>${toc || ''}</div>`);
}

// ----- Search (top bar on wide screens; Help home has its own box) -----
function wireSearch(form) {
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = new FormData(e.target).get('q').trim();
    location.hash = q ? `#/search/${encodeURIComponent(q)}` : '#/';
  });
}
wireSearch(document.getElementById('top-search'));
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '')) {
    e.preventDefault();
    const box = document.querySelector('.hero-search input') || document.querySelector('#top-search input');
    box?.focus();
  }
  if (e.key === 'Escape') sideOpen(false);
});

// ----- Help home -----
const roleChips = (g) => g.roles.filter((r) => ROLES[r]).slice(0, 4).map((r) => html`<span class="chip">${ROLES[r].label}</span>`);
const card = (g, { big = false } = {}) => html`<a class="guide-card ${big ? 'big' : ''}" href="#/${g.id}">
  <span class="guide-ic">${sysIcon(g, big ? 22 : 18)}</span>
  <span class="guide-card-body"><strong>${g.title}</strong><small>${g.summary}</small>
    ${big || g.edited || g.custom ? html`<span class="chips">${g.edited ? html`<span class="chip school">Edited by the school</span>` : g.custom ? html`<span class="chip school">The school's guide</span>` : ''}${big ? roleChips(g) : ''}</span>` : ''}</span>
  <span class="guide-go" aria-hidden="true">${icon('chevronRight', 16)}</span></a>`;

function homeView() {
  const start = list.guides.filter((g) => START.includes(g.id));
  const mine = list.guides.filter((g) => g.forYou && !START.includes(g.id));
  const by = {};
  for (const g of list.guides) if (!START.includes(g.id)) (by[primarySystem(g)] ||= []).push(g);
  layout('', html`
    <section class="help-hero">
      <p class="eyebrow">${icon('help', 16)} Help & guides</p>
      <h1>${signedIn() ? `How can we help, ${ctx.user.name.split(' ')[0]}?` : 'How can we help?'}</h1>
      <p>${signedIn()
        ? 'Step-by-step guides for each job in ATLAS: a walkthrough to start, how to do each task, every screen, and common questions.'
        : html`You are not signed in. <strong>Getting started</strong> explains signing in, passwords and what to do when signing in does not work. <a href="${SIGN_IN}">Sign in</a> to see the guides for your own work.`}</p>
      <form class="help-search hero-search" id="hero-search" role="search"><span class="search-ic" aria-hidden="true">${icon('search', 18)}</span><input type="search" name="q" placeholder="${signedIn() ? 'Search, e.g. “post final grades”' : 'Search, e.g. “forgot password”'}" aria-label="Search the guides" /><button class="btn primary">Search</button></form>
      <div class="start-row">${start.map((g) => html`<a class="start-link" href="#/${g.id}">${sysIcon(g, 16)} ${g.title} ${icon('chevronRight', 14)}</a>`)}</div>
    </section>
    ${mine.length ? html`<section class="home-block"><div class="block-head"><h2>Your guides</h2><span class="muted small">For your work as ${list.roleLabel}</span></div>
      <div class="guide-grid big">${mine.map((g) => card(g, { big: true }))}</div></section>` : ''}
    ${signedIn() ? '' : html`<section class="home-block"><div class="block-head"><h2>Trouble signing in?</h2><span class="muted small">Answers you can read without signing in</span></div>
      <div class="guide-grid big">${[['getting-started#sign-in', 'key', 'Sign in', 'Where to sign in, and with which username and password.'], ['getting-started#questions', 'help', 'Forgotten password, locked account and other messages', 'What each sign-in message means and who can help.'], ...(ctx.info?.sso?.enabled ? [['getting-started#sign-in-with-keycloak', 'shield', ctx.info.sso.label || 'Sign in with Keycloak', 'Use your school account instead of an ATLAS password.']] : [])]
    .map(([to, ic, title, text]) => html`<a class="guide-card big" href="#/${to}"><span class="guide-ic">${icon(ic, 22)}</span><span class="guide-card-body"><strong>${title}</strong><small>${text}</small></span><span class="guide-go" aria-hidden="true">${icon('chevronRight', 16)}</span></a>`)}</div></section>`}
    <section class="home-block" ${signedIn() ? '' : 'hidden'}><div class="block-head"><h2>Browse by system</h2><span class="muted small">Guides for the people you work with</span></div>
      <div class="system-grid">${SYSTEMS.filter(([k]) => by[k]?.length).map(([k, label, ic]) => html`<div class="system-col">
        <h3>${icon(ic, 18)} ${label}</h3>
        ${by[k].map((g) => html`<a class="system-link" href="#/${g.id}"><span>${g.title}</span><small>${g.roles.filter((r) => ROLES[r]).map((r) => ROLES[r].label).slice(0, 3).join(', ')}</small></a>`)}
      </div>`)}</div></section>`, { wide: true });
  wireSearch(appEl.querySelector('#hero-search'));
  document.title = 'Help & guides · ATLAS';
  window.scrollTo(0, 0);
}

// ----- Search results, with the words highlighted -----
// The server searches each section of each guide in the reader's own words (server/guide-search.js)
// and says which starts of words to highlight.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const mark = (text, terms) => {
  const alts = terms.filter((t) => t.length > 1).sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s-]+'));
  if (!alts.length) return raw(esc(text));
  return raw(esc(text).replace(new RegExp(`(?<![A-Za-z0-9])((?:${alts.join('|')})[A-Za-z0-9]*)`, 'gi'), '<mark>$1</mark>'));
};
async function searchView(q) {
  const r = await api.get(`/api/guides?q=${encodeURIComponent(q)}`);
  const n = r.results?.length || 0;
  const lead = !n ? 'Nothing in the guides matches these words.'
    : r.partial ? 'No section has all of these words. These are the closest.'
      : `${n} place${n === 1 ? '' : 's'} in the guides${n >= 12 ? ' (the best 12)' : ''}, best match first.`;
  layout(null, html`
    <nav class="crumbs-help" aria-label="Breadcrumb"><a href="#/">Help</a> ${icon('chevronRight', 12)} <span>Search</span></nav>
    <header class="guide-header"><h1>Results for “${q}”</h1><p class="lead" role="status">${lead}</p></header>
    ${n ? html`<div class="results">${r.results.map((x) => html`<a class="result" href="#/${x.id}${x.anchor ? `#${x.anchor}` : ''}">
      <span class="result-path">${x.title}${x.section ? html` ${icon('chevronRight', 12)} ${mark(x.section, r.terms)}` : ''}</span>
      <span class="result-snippet">${mark(x.snippet, r.terms)}</span></a>`)}</div>`
      : html`<div class="empty-state">${icon('search', 32)}<p>Try fewer words, or the name on the screen (for example “enrollment” or “payslip”). ${signedIn() ? 'You can also open the guide for your job from the list.' : html`Only <a href="#/getting-started">Getting started</a> can be searched before you sign in.`}</p><a class="btn" href="#/">Help home</a>${signedIn() ? '' : html` <a class="btn primary" href="${SIGN_IN}">Sign in</a>`}</div>`}
    ${n && !signedIn() ? html`<p class="muted small" style="margin-top:16px">Only Getting started can be searched before you sign in. <a href="${SIGN_IN}">Sign in</a> to search every guide.</p>` : ''}`, { wide: true });
  document.querySelectorAll('.help-search input').forEach((i) => (i.value = q));
  document.title = `Search: ${q} · Help · ATLAS`;
  window.scrollTo(0, 0);
}

// ----- A guide -----
async function guideView(id, section) {
  const g = await api.get(`/api/guides/${encodeURIComponent(id)}`);
  const { meta, body } = parseGuide(g.markdown);
  const toc = headingsOf(body);
  const words = body.split(/\s+/).length;
  const sys = SYS[primarySystem(g)] || SYS.home;
  // Previous and next: the guides in the order of the list.
  const order = list.guides;
  const at = order.findIndex((x) => x.id === id);
  const prev = at > 0 ? order[at - 1] : null;
  const next = at >= 0 && at < order.length - 1 ? order[at + 1] : null;
  const tocEl = toc.length > 2 ? html`<aside class="help-toc" aria-label="On this page"><p class="side-label">On this page</p>
    <ul>${toc.map((h) => html`<li class="lvl-${h.level}"><a href="#/${id}#${h.id}" data-toc="${h.id}">${h.text.replace(/\*\*/g, '')}</a></li>`)}</ul>
    <a class="toc-top" href="#/${id}" data-top>${icon('up', 14)} Back to top</a></aside>` : null;
  layout(id, html`
    <article class="guide">
      <nav class="crumbs-help" aria-label="Breadcrumb"><a href="#/">Help</a> ${icon('chevronRight', 12)} <span>${START.includes(id) ? 'Start here' : sys.label}</span> ${icon('chevronRight', 12)} <span aria-current="page">${meta.title || id}</span></nav>
      <header class="guide-header">
        <div class="guide-systems">${(meta.apps || []).map((a) => html`<span class="sys-chip">${icon(SYS[a]?.icon || 'grid', 14)} ${SYS[a]?.label || a}</span>`)}</div>
        <h1>${meta.title || id}</h1>
        ${meta.summary ? html`<p class="lead">${meta.summary}</p>` : ''}
        <div class="guide-meta">
          ${!START.includes(id) && g.roles?.length ? html`<span>${icon('user', 14)} For ${g.roles.filter((r) => ROLES[r]).map((r) => ROLES[r].label).slice(0, 4).join(', ')}${g.roles.length > 4 ? ' and others' : ''}</span>` : ''}
          <span>${icon('clock', 14)} ${Math.max(1, Math.round(words / 200))} min read</span>
          <span>${g.edited || g.custom ? html`${icon('edit', 14)} ${g.custom ? 'Written' : 'Edited'} by the school${g.editedBy ? ` · ${g.editedBy.name}, ${fmtDate(g.editedBy.at.slice(0, 10))}` : ''}` : html`${icon('checkCircle', 14)} Comes with ATLAS ${list.version}`}</span>
          <span class="meta-actions no-print">
            <button class="btn sm ghost" id="print">${icon('file', 14)} Print</button>
            ${g.canEdit ? html`<a class="btn sm" href="#/edit/${id}">${icon('edit', 14)} Edit this guide</a>` : ''}
          </span>
        </div>
      </header>
      ${g.canEdit && g.builtInChanged ? html`<aside class="callout note no-print" role="note"><p class="callout-title">ATLAS has updated this guide since it was edited here</p><p>Your school's version is shown. <a href="#/edit/${id}">Compare and update it</a>.</p></aside>` : ''}
      ${toc.length > 2 ? html`<details class="toc-inline no-print"><summary>On this page</summary><ul>${toc.filter((h) => h.level === 2).map((h) => html`<li><a href="#/${id}#${h.id}">${h.text}</a></li>`)}</ul></details>` : ''}
      <div class="guide-body">${raw(renderMarkdown(body, { guideId: id }))}</div>
      <footer class="guide-foot no-print">
        <div class="pager">
          ${prev ? html`<a class="pager-link" href="#/${prev.id}"><small>${icon('chevronLeft', 14)} Previous</small><strong>${prev.title}</strong></a>` : html`<span></span>`}
          ${next ? html`<a class="pager-link next" href="#/${next.id}"><small>Next ${icon('chevronRight', 14)}</small><strong>${next.title}</strong></a>` : ''}
        </div>
        <p class="muted small">${g.canEdit ? html`<a href="#/edit/${id}">${icon('edit', 14)} Edit this guide</a> · ` : ''}Something wrong or missing? ${g.canEdit ? 'Edit it for your school, or tell' : 'Tell'} the ATLAS administrator.${signedIn() ? '' : html` <a href="${SIGN_IN}">Sign in</a> to see the guides for your own work.`}</p>
      </footer>
    </article>`, { toc: tocEl });
  appEl.querySelector('#print').addEventListener('click', () => window.print());
  document.title = `${meta.title || id} · Help · ATLAS`;
  wireShots();
  wireSpy();
  if (section) document.getElementById(section)?.scrollIntoView();
  else window.scrollTo(0, 0);
  appEl.querySelector('[data-top]')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// "On this page" follows the reader: the section on screen is highlighted.
function wireSpy() {
  const links = [...appEl.querySelectorAll('[data-toc]')];
  if (!links.length || !('IntersectionObserver' in window)) return;
  const heads = links.map((a) => document.getElementById(a.dataset.toc)).filter(Boolean);
  const visible = new Set();
  spy = new IntersectionObserver((entries) => {
    for (const e of entries) (e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id));
    // The first heading on screen; otherwise the last one passed.
    const top = heads.find((h) => visible.has(h.id)) || [...heads].reverse().find((h) => h.getBoundingClientRect().top < 120) || heads[0];
    for (const a of links) a.classList.toggle('active', a.dataset.toc === top?.id);
  }, { rootMargin: '-72px 0px -60% 0px' });
  heads.forEach((h) => spy.observe(h));
}

// A screenshot opens full size (Escape or a click closes it).
function wireShots() {
  for (const img of appEl.querySelectorAll('.guide-body .guide-shot img')) {
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.setAttribute('aria-label', `${img.alt} (enlarge)`);
    const open = () => {
      const box = document.createElement('div');
      box.className = 'lightbox';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', img.alt);
      box.innerHTML = `<figure><img src="${img.getAttribute('src')}" alt="" /><figcaption></figcaption></figure><button type="button" class="round-btn" aria-label="Close">${iconSvg('x')}</button>`;
      box.querySelector('figcaption').textContent = img.alt;
      const close = () => {
        box.remove();
        document.removeEventListener('keydown', onKey);
        img.focus();
      };
      const onKey = (e) => e.key === 'Escape' && close();
      box.addEventListener('click', close);
      document.addEventListener('keydown', onKey);
      document.body.appendChild(box);
      box.querySelector('button').focus();
    };
    img.addEventListener('click', open);
    img.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open()));
  }
}

// ----- The editor (administrators): Markdown with a formatting bar, and the page as it will look -----
const TOOLS = [
  ['H2', 'Section heading', (s) => `\n## ${s || 'Heading'}\n`],
  ['H3', 'Task heading', (s) => `\n### ${s || 'Do something'}\n`],
  ['B', 'Bold', (s) => `**${s || 'bold'}**`],
  ['→', 'Menu path', (s) => `**${s || 'Admin panel → Terms'}**`],
  ['1.', 'Numbered steps', (s) => `\n${(s || 'First step\nSecond step').split('\n').map((l, i) => `${i + 1}. ${l}`).join('\n')}\n`],
  ['•', 'Bullet list', (s) => `\n${(s || 'One\nTwo').split('\n').map((l) => `- ${l}`).join('\n')}\n`],
  ['Tip', 'Tip', (s) => `\n> **Tip:** ${s || 'A helpful hint.'}\n`],
  ['Note', 'Note', (s) => `\n> **Note:** ${s || 'Something to keep in mind.'}\n`],
  ['!', 'Important', (s) => `\n> **Important:** ${s || 'Something that must not be missed.'}\n`],
  ['Link', 'Link to a guide or page', (s) => `[${s || 'the registrar\'s guide'}](registrar)`],
  ['Image', 'Screenshot', (s) => `\n![${s || 'What it shows'}](file-name.jpg)\n`],
];

async function editView(id) {
  const isNew = !id;
  const g = isNew ? { markdown: `---\nid: \ntitle: \nsummary: \nroles: \napps: home\norder: 90\n---\n\n## Before you start\n\n## Walkthrough\n\n## How to…\n\n## Screens at a glance\n\n## Questions\n`, canEdit: list.canEdit } : await api.get(`/api/guides/${encodeURIComponent(id)}`);
  if (!g.canEdit) return guideView(id);
  layout(id, html`
    <section class="guide-editor">
      <nav class="crumbs-help" aria-label="Breadcrumb"><a href="#/">Help</a> ${icon('chevronRight', 12)} ${isNew ? html`<span>New guide</span>` : html`<a href="#/${id}">${parseGuide(g.markdown).meta.title}</a> ${icon('chevronRight', 12)} <span>Edit</span>`}</nav>
      <header class="editor-head">
        <div><h1>${isNew ? 'New guide' : `Edit: ${parseGuide(g.markdown).meta.title}`}</h1>
          <p class="muted small">${isNew ? 'A guide of your school\'s own, shown with the others.' : 'Your version is kept when ATLAS is updated; ATLAS tells you when its own guide changes.'} <a href="/help/#/admin#edit-a-guide" target="_blank" rel="noopener">How to edit a guide</a></p></div>
        <div class="actions">
          ${!isNew && g.edited ? html`<button class="btn danger ghost" id="restore">Restore the built-in guide</button>` : ''}
          ${!isNew && g.custom ? html`<button class="btn danger ghost" id="remove">Delete this guide</button>` : ''}
          <a class="btn" href="#/${id}">Cancel</a>
          <button class="btn primary" id="save">Save</button>
        </div>
      </header>
      ${g.builtInChanged ? html`<aside class="callout note" role="note"><p class="callout-title">ATLAS has updated this guide since it was edited here</p><p><button type="button" class="link" id="compare">Compare with the new built-in guide</button>, then copy in what you need, or restore it.</p></aside>` : ''}
      ${isNew ? html`<label class="field guide-id"><span>Guide id (its web address)</span><input id="new-id" placeholder="e.g. campus-offices" pattern="[a-z0-9][a-z0-9-]{1,40}" required /></label>` : ''}
      <div class="editor-cols">
        <div class="editor-pane">
          <div class="md-toolbar" role="toolbar" aria-label="Formatting">${TOOLS.map(([label, title], i) => html`<button type="button" class="tool" data-tool="${i}" title="${title}" aria-label="${title}">${label}</button>`)}</div>
          <textarea id="md" spellcheck="true" aria-label="Guide text (Markdown)">${g.markdown}</textarea>
        </div>
        <div class="editor-preview"><p class="side-label">Preview</p><div class="guide-body" id="preview"></div></div>
      </div>
      <p class="form-error" hidden></p>
    </section>`, { wide: true });
  const md = appEl.querySelector('#md');
  const preview = () => mount(appEl.querySelector('#preview'), raw(renderMarkdown(parseGuide(md.value).body, { guideId: id })));
  preview();
  md.addEventListener('input', () => {
    dirty = true;
    preview();
  });
  // Formatting: wraps the selection (or inserts an example) at the cursor.
  appEl.querySelector('.md-toolbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tool]');
    if (!b) return;
    const [, , make] = TOOLS[Number(b.dataset.tool)];
    const { selectionStart: a, selectionEnd: z, value } = md;
    const text = make(value.slice(a, z));
    md.setRangeText(text, a, z, 'end');
    md.focus();
    md.dispatchEvent(new Event('input'));
  });
  appEl.querySelector('#compare')?.addEventListener('click', () => modal({
    title: 'The built-in guide (new version)', wide: true, submitLabel: null,
    body: html`<div class="guide-body compare">${raw(renderMarkdown(parseGuide(g.builtInMarkdown).body, { guideId: id }))}</div>
      <details><summary>Its Markdown, to copy from</summary><textarea readonly class="compare-md" aria-label="Built-in guide Markdown">${g.builtInMarkdown}</textarea></details>`,
  }));
  appEl.querySelector('#save').addEventListener('click', async () => {
    const err = appEl.querySelector('.form-error');
    const saveId = isNew ? appEl.querySelector('#new-id').value.trim() : id;
    try {
      let text = md.value;
      if (isNew) text = text.replace(/^id:\s*$/m, `id: ${saveId}`);
      await api.put(`/api/guides/${encodeURIComponent(saveId)}`, { markdown: text });
      dirty = false;
      list = await api.get('/api/guides');
      toast('Guide saved.');
      location.hash = `#/${saveId}`;
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    }
  });
  const back = async (label, message) => {
    if (!(await confirmDialog(message, { confirmLabel: label }))) return;
    await api.del(`/api/guides/${encodeURIComponent(id)}`);
    dirty = false;
    list = await api.get('/api/guides');
    toast(label === 'Restore' ? 'The built-in guide is back.' : 'Guide deleted.');
    location.hash = label === 'Restore' ? `#/${id}` : '#/';
  };
  appEl.querySelector('#restore')?.addEventListener('click', () => back('Restore', 'Go back to the guide that comes with ATLAS? Your school\'s changes to this guide are removed.'));
  appEl.querySelector('#remove')?.addEventListener('click', () => back('Delete', 'Delete this guide? It is removed for everyone.'));
}

async function render() {
  const r = route();
  if (dirty && !window.confirm('You have unsaved changes to this guide. Leave without saving?')) return;
  dirty = false;
  try {
    if ('edit' in r) return await editView(r.edit);
    if (r.q) return await searchView(r.q);
    if (!r.id) return homeView();
    await guideView(r.id, r.section);
  } catch (e) {
    if (e.status === 401 || (!signedIn() && e.status === 404)) {
      return layout(r.id || '', html`<div class="empty-state">${icon('key', 32)}<h2>Sign in to read this guide</h2><p>Before you sign in, only <a href="#/getting-started">Getting started</a> can be read. The guides for your own work open once you are signed in.</p><a class="btn primary" href="${SIGN_IN}">Sign in</a> <a class="btn" href="#/">Help home</a></div>`, { wide: true });
    }
    layout(r.id || '', html`<div class="empty-state">${icon('book', 32)}<h2>${e.status === 404 ? 'Guide not found' : 'Something went wrong'}</h2><p>${e.message}</p><a class="btn" href="#/">Help home</a></div>`, { wide: true });
  }
}

async function boot() {
  let status;
  try {
    status = await api.get('/api/hub/status');
  } catch (err) {
    document.body.classList.remove('booting');
    return mount(appEl, failureNotice(err));
  }
  ctx.info = status;
  ctx.user = status.user;
  applyBranding(status.branding);
  document.body.classList.remove('booting');
  if (!status.user) {
    // Signed out: the button that goes to the systems becomes "Sign in".
    const home = document.getElementById('home-btn');
    home.href = SIGN_IN;
    home.title = 'Sign in';
    home.setAttribute('aria-label', 'Sign in');
    home.innerHTML = iconSvg('key');
  }
  mount(document.getElementById('school-name'), atlasWord('Help & guides'));
  mount(document.getElementById('brand-sub'), html`${status.branding.schoolName}`);
  renderThemeButton();
  list = await api.get('/api/guides');
  // From a system's Help button: straight to the guide for this person there.
  const from = new URLSearchParams(location.search).get('from');
  if (from && !location.hash.replace(/^#\/?/, '')) {
    const id = status.user ? guideFor(from, status.user.role) : 'getting-started';
    history.replaceState(null, '', `/help/#/${list.guides.some((g) => g.id === id) ? id : ''}`);
  }
  window.addEventListener('hashchange', render);
  render();
}

boot();
