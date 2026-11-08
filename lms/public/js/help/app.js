// Help & guides (/help/): a guide for each kind of user, with a walkthrough, how-to steps, the
// screens and common questions. The guides come with ATLAS (docs/guides) and are updated with
// it; administrators can edit them here (their version is kept, and ATLAS says when the built-in
// guide has changed since). Opened from the Help button in every system's top bar.
import { api } from '../api.js';
import { html, raw, mount, toast, modal, confirmDialog, fmtDate } from '../ui.js';
import { ctx, applyBranding, setTheme, isDark, renderThemeButton, atlasWord } from '../shell.js';
import { icon, iconSvg } from '../icons.js';
import { parseGuide, renderMarkdown, headingsOf } from '/shared/markdown.js';
import { guideFor } from '/shared/help.js';

const appEl = document.getElementById('app');
const APP_LABEL = { home: 'ATLAS home', learn: 'ATLAS Learn', admin: 'Admin panel', academic: 'ATLAS Academic', people: 'ATLAS People', finance: 'ATLAS Finance' };
let list = null; // { role, roleLabel, canEdit, version, guides }
let dirty = false;

document.getElementById('theme-btn').addEventListener('click', () => setTheme(!isDark()));
document.getElementById('home-btn').innerHTML = iconSvg('grid');
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

const card = (g) => html`<a class="guide-card ${g.forYou ? 'mine' : ''}" href="#/${g.id}">
  <span class="guide-ic">${icon(g.id === 'whats-new' ? 'sparkle' : g.id === 'getting-started' ? 'flag' : 'book', 20)}</span>
  <span><strong>${g.title}</strong><small>${g.summary}</small>
  ${g.edited ? html`<span class="badge blue">Edited by the school</span>` : g.custom ? html`<span class="badge blue">The school's guide</span>` : ''}</span></a>`;

function sidebar(activeId) {
  const mine = list.guides.filter((g) => g.forYou && !['getting-started', 'whats-new'].includes(g.id));
  const item = (g) => html`<a class="guide-link ${g.id === activeId ? 'active' : ''}" href="#/${g.id}" ${g.id === activeId ? 'aria-current="page"' : ''}>${g.title}</a>`;
  const byApp = {};
  for (const g of list.guides) {
    if (['getting-started', 'whats-new'].includes(g.id)) continue;
    const app = g.apps[0] || 'home';
    (byApp[app] ||= []).push(g);
  }
  return html`<aside class="help-side" aria-label="Guides">
    <form class="help-search" id="search" role="search"><input type="search" name="q" placeholder="Search the guides" aria-label="Search the guides" value="${route().q || ''}" /></form>
    <a class="guide-link ${activeId === '' ? 'active' : ''}" href="#/">${icon('home', 16)} Help home</a>
    ${list.guides.filter((g) => ['getting-started', 'whats-new'].includes(g.id)).map(item)}
    ${mine.length ? html`<h3>Your guides</h3>${mine.map(item)}` : ''}
    <details ${mine.length ? '' : 'open'}><summary>All guides</summary>
      ${Object.entries(byApp).map(([app, gs]) => html`<h4>${APP_LABEL[app] || app}</h4>${gs.map(item)}`)}
    </details>
    ${list.canEdit ? html`<a class="btn sm guide-new" href="#/new">${icon('plus', 14)} New guide</a>` : ''}
    <p class="muted small help-version">Guides for ATLAS ${list.version}. They are updated with ATLAS.</p>
  </aside>`;
}

function layout(activeId, main) {
  mount(appEl, html`<div class="help-layout">${sidebar(activeId)}<div class="help-content">${main}</div></div>`);
  appEl.querySelector('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = new FormData(e.target).get('q').trim();
    location.hash = q ? `#/search/${encodeURIComponent(q)}` : '#/';
  });
}

function homeView() {
  const mine = list.guides.filter((g) => g.forYou && !['getting-started', 'whats-new'].includes(g.id));
  const others = list.guides.filter((g) => !g.forYou && !['getting-started', 'whats-new'].includes(g.id));
  const start = list.guides.filter((g) => ['getting-started', 'whats-new'].includes(g.id));
  layout('', html`
    <header class="help-hero"><h1>Help & guides</h1>
      <p>Step-by-step guides for each job in ATLAS: a walkthrough to start, how to do each task, every screen, and common questions. You are signed in as <strong>${list.roleLabel}</strong>.</p></header>
    ${start.length ? html`<div class="guide-grid">${start.map(card)}</div>` : ''}
    ${mine.length ? html`<h2>Your guides</h2><div class="guide-grid">${mine.map(card)}</div>` : ''}
    ${others.length ? html`<h2>Other guides</h2><p class="muted small">For the other people you work with.</p><div class="guide-grid">${others.map(card)}</div>` : ''}`);
}

async function searchView(q) {
  const r = await api.get(`/api/guides?q=${encodeURIComponent(q)}`);
  layout('', html`<header class="help-hero"><h1>Search: “${q}”</h1></header>
    ${r.results?.length ? html`<div class="list">${r.results.map((x) => html`<a class="list-item" href="#/${x.id}${x.section ? `#${x.section.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : ''}">
      <span class="item-ic">${icon('book', 16)}</span><span class="grow"><strong>${x.title}${x.section ? ` › ${x.section}` : ''}</strong><small>${x.snippet}</small></span></a>`)}</div>`
      : html`<div class="empty"><h2>Nothing found</h2><p>Try other words, or open the guide for your job.</p></div>`}`);
}

async function guideView(id, section) {
  const g = await api.get(`/api/guides/${encodeURIComponent(id)}`);
  const { meta, body } = parseGuide(g.markdown);
  const toc = headingsOf(body);
  layout(id, html`
    <article class="guide">
      <header class="guide-head">
        <div><p class="guide-kicker">${(meta.apps || []).map((a) => APP_LABEL[a] || a).join(' · ')}</p><h1>${meta.title || id}</h1>${meta.summary ? html`<p class="guide-summary">${meta.summary}</p>` : ''}</div>
        <div class="actions no-print">
          <button class="btn" id="print">${icon('file', 16)} Print</button>
          ${g.canEdit ? html`<a class="btn primary" href="#/edit/${id}">${icon('edit', 16)} Edit this guide</a>` : ''}
        </div>
      </header>
      ${g.edited || g.custom ? html`<p class="muted small">${g.custom ? 'A guide written by the school' : 'Edited by the school'}${g.editedBy ? ` · ${g.editedBy.name}, ${fmtDate(g.editedBy.at.slice(0, 10))}` : ''}.</p>` : ''}
      ${g.canEdit && g.builtInChanged ? html`<div class="notice info no-print">${icon('sparkle')}<p><strong>ATLAS has updated this guide since it was edited here.</strong> Your school's version is shown. <a href="#/edit/${id}">Compare and update it</a>.</p></div>` : ''}
      ${toc.length > 3 ? html`<nav class="guide-toc no-print" aria-label="On this page"><strong>On this page</strong><ul>${toc.filter((h) => h.level === 2).map((h) => html`<li><a href="#/${id}#${h.id}">${h.text}</a></li>`)}</ul></nav>` : ''}
      <div class="guide-body">${raw(renderMarkdown(body, { guideId: id }))}</div>
    </article>`);
  appEl.querySelector('#print').addEventListener('click', () => window.print());
  document.title = `${meta.title || id} · Help · ATLAS`;
  if (section) document.getElementById(section)?.scrollIntoView();
  else window.scrollTo(0, 0);
}

// The editor (administrators): Markdown on the left, the page as it will look on the right.
async function editView(id) {
  const isNew = !id;
  const g = isNew ? { markdown: `---\nid: \ntitle: \nsummary: \nroles: \napps: home\norder: 90\n---\n\n## Before you start\n\n`, canEdit: list.canEdit } : await api.get(`/api/guides/${encodeURIComponent(id)}`);
  if (!g.canEdit) return guideView(id);
  layout(id, html`
    <section class="guide-editor">
      <header class="guide-head">
        <div><h1>${isNew ? 'New guide' : `Edit: ${parseGuide(g.markdown).meta.title}`}</h1>
          <p class="muted small">Written in Markdown (headings ##, lists, tables, **bold**, screenshots). ${isNew ? '' : 'Your version is kept when ATLAS is updated; ATLAS tells you when its own guide changes.'} <a href="/help/#/admin#edit-a-guide" target="_blank" rel="noopener">How to edit a guide</a></p></div>
        <div class="actions">
          ${!isNew && g.edited ? html`<button class="btn danger ghost" id="restore">Restore the built-in guide</button>` : ''}
          ${!isNew && g.custom ? html`<button class="btn danger ghost" id="remove">Delete this guide</button>` : ''}
          <a class="btn" href="#/${id}">Cancel</a>
          <button class="btn primary" id="save">Save</button>
        </div>
      </header>
      ${g.builtInChanged ? html`<div class="notice info">${icon('sparkle')}<p><strong>ATLAS has updated this guide since it was edited here.</strong> <button type="button" class="link" id="compare">Compare with the new built-in guide</button>, then copy in what you need, or restore it.</p></div>` : ''}
      ${isNew ? html`<label class="field guide-id"><span>Guide id (its web address)</span><input id="new-id" placeholder="e.g. campus-offices" pattern="[a-z0-9][a-z0-9-]{1,40}" required /></label>` : ''}
      <div class="editor-cols">
        <label class="field"><span>Markdown</span><textarea id="md" spellcheck="true" aria-label="Guide text (Markdown)">${g.markdown}</textarea></label>
        <div class="editor-preview"><span class="muted small">Preview</span><div class="guide-body" id="preview"></div></div>
      </div>
      <p class="form-error" hidden></p>
    </section>`);
  const md = appEl.querySelector('#md');
  const preview = () => mount(appEl.querySelector('#preview'), raw(renderMarkdown(parseGuide(md.value).body, { guideId: id })));
  preview();
  md.addEventListener('input', () => {
    dirty = true;
    preview();
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
    layout(r.id || '', html`<div class="empty"><h2>${e.status === 404 ? 'Guide not found' : 'Something went wrong'}</h2><p>${e.message}</p><a class="btn" href="#/">Help home</a></div>`);
  }
}

async function boot() {
  let status;
  try {
    status = await api.get('/api/hub/status');
  } catch {
    return mount(appEl, html`<div class="empty"><h2>Cannot reach the server</h2></div>`);
  }
  ctx.info = status;
  ctx.user = status.user;
  applyBranding(status.branding);
  if (!status.user) return location.replace(`/?next=${encodeURIComponent('/help/')}`);
  document.body.classList.remove('booting');
  mount(document.getElementById('school-name'), atlasWord('Help & guides'));
  mount(document.getElementById('brand-sub'), html`${status.branding.schoolName}`);
  renderThemeButton();
  list = await api.get('/api/guides');
  // From a system's Help button: straight to the guide for this person there.
  const from = new URLSearchParams(location.search).get('from');
  if (from && !location.hash.replace(/^#\/?/, '')) {
    const id = guideFor(from, status.user.role);
    history.replaceState(null, '', `/help/#/${list.guides.some((g) => g.id === id) ? id : ''}`);
  }
  window.addEventListener('hashchange', render);
  render();
}

boot();
