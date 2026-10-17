// Dev log (administrators): the developer's notes on every build, newest first,
// which build the server is running, and (for admins) writing and editing entries.
import { api } from '../api.js';
import { ctx, can } from '../state.js';
import { DEVLOG_MODULES, CHANGE_TYPES, APP_VERSION, compareVersions } from '/shared/devlog.js';
import { html, mount, fmtDate, badge, modal, confirmDialog, toast, today } from '../ui.js';

const CHANGE_KIND = { new: 'green', improved: 'blue', fixed: 'amber' };
const when = (iso) => new Date(iso).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const isNewer = (a, b) => compareVersions(a, b) > 0;
// '0.2.3-alpha' -> number '0.2.3' and stage 'alpha'
const split = (v) => ({ num: v.split('-')[0], stage: v.split('-').slice(1).join('-') });
const versionLabel = (v) => html`v${split(v).num}${split(v).stage ? html` <span class="stage">${split(v).stage}</span>` : ''}`;

// "Read up to" version per user, kept in this browser. Never visited: only the newest entry counts as new.
const seenKey = () => `ltdc-devlog-read:${ctx.user?.id}`;
function lastSeen() {
  try {
    return localStorage.getItem(seenKey());
  } catch {
    return null;
  }
}
const isUnseen = (version, newest, seen = lastSeen()) => (seen ? isNewer(version, seen) : version === newest);
export async function unseenCount() {
  const { entries } = await api.get('/api/devlog');
  return entries.filter((e) => isUnseen(e.version, entries[0]?.version)).length;
}
function markSeen(newest) {
  try {
    if (newest) localStorage.setItem(seenKey(), newest);
  } catch {}
  window.dispatchEvent(new Event('devlog:seen'));
}

function uptime(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return h < 48 ? `${h} h ${mins % 60} min` : `${Math.floor(h / 24)} days`;
}

// Next patch number after the newest entry, keeping its stage: 0.2.4-alpha -> 0.2.5-alpha.
function nextVersion(entries) {
  const newest = entries[0]?.version || APP_VERSION;
  const { num, stage } = split(newest);
  const [a, b, c] = num.split('.').map(Number);
  return `${a}.${b}.${c + 1}${stage ? `-${stage}` : ''}`;
}

// ---------- Editor ----------

const changeRow = ([type, module, text] = ['new', 'system', '']) => html`<div class="change-row">
  <select name="ctype" aria-label="Type">${Object.entries(CHANGE_TYPES).map(([k, v]) => html`<option value="${k}" ${k === type ? 'selected' : ''}>${v}</option>`)}</select>
  <select name="cmodule" aria-label="Module">${Object.entries(DEVLOG_MODULES).map(([k, v]) => html`<option value="${k}" ${k === module ? 'selected' : ''}>${v}</option>`)}</select>
  <input name="ctext" value="${text}" maxlength="400" placeholder="What changed, in a sentence" aria-label="Change" />
  <button type="button" class="icon-btn" data-remove-change aria-label="Remove this change">×</button>
</div>`;

function openEditor(entry, entries, onSaved) {
  const e = entry || { version: nextVersion(entries), date: today(), title: '', notes: '', changes: [['new', 'system', '']], known: [] };
  const { form } = modal({
    title: entry ? `Edit v${entry.version}` : 'New dev log entry',
    submitLabel: entry ? 'Save changes' : 'Add entry',
    wide: true,
    body: html`<div class="grid two">
        <label class="field"><span>Version</span><input name="version" value="${e.version}" required placeholder="0.2.5-alpha" /></label>
        <label class="field"><span>Date</span><input type="date" name="date" value="${e.date}" required /></label>
        <label class="field span-2"><span>Title</span><input name="title" value="${e.title}" maxlength="120" required placeholder="e.g. Faster payroll runs" /></label>
        <label class="field span-2"><span>Note: what you did and why, in your own words</span>
          <textarea name="notes" rows="4" maxlength="2000" required placeholder="Payroll runs were taking a while with 200+ people, so I…">${e.notes}</textarea></label>
        <div class="field span-2"><span>Changes</span>
          <div class="change-rows">${e.changes.map(changeRow)}</div>
          <button type="button" class="btn small-btn" id="add-change">+ Add change</button></div>
        <label class="field span-2"><span>Known issues (optional, one per line)</span>
          <textarea name="known" rows="3" placeholder="Anything that still doesn't work right in this build">${(e.known || []).join('\n')}</textarea></label>
      </div>`,
    onSubmit: async (f) => {
      const fd = new FormData(f);
      const [types, modules, texts] = [fd.getAll('ctype'), fd.getAll('cmodule'), fd.getAll('ctext')];
      const body = {
        version: fd.get('version'), date: fd.get('date'), title: fd.get('title'), notes: fd.get('notes'), known: fd.get('known'),
        changes: texts.map((t, i) => [types[i], modules[i], t]),
      };
      const saved = entry ? await api.put(`/api/devlog/${entry.id}`, body) : await api.post('/api/devlog', body);
      toast(entry ? 'Entry updated.' : 'Entry added.');
      onSaved(saved);
    },
  });
  const rows = form.querySelector('.change-rows');
  form.querySelector('#add-change').addEventListener('click', () => {
    const holder = document.createElement('div');
    mount(holder, changeRow());
    rows.append(...holder.childNodes);
    rows.lastElementChild.querySelector('input').focus();
  });
  rows.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-remove-change]') && rows.children.length > 1) ev.target.closest('.change-row').remove();
  });
}

function openAuthor(current, onSaved) {
  modal({
    title: 'Dev log author',
    submitLabel: 'Save',
    body: html`<label class="field"><span>Name shown on every entry</span><input name="name" value="${current}" maxlength="80" required /></label>
      <p class="muted small">The log is written by one person. This name appears at the top and on each entry.</p>`,
    onSubmit: async (f) => {
      onSaved(await api.put('/api/devlog-author', { name: new FormData(f).get('name') }));
      toast('Author updated.');
    },
  });
}

// ---------- Page ----------

export async function devlogView(el) {
  const [about, initial] = await Promise.all([api.get('/api/system/about'), api.get('/api/devlog')]);
  let { author, entries } = initial;
  const edit = can('devlog.edit');
  const seen = lastSeen();
  const unseen = new Set(entries.filter((e) => isUnseen(e.version, entries[0]?.version, seen)).map((e) => e.version));
  const state = { module: '', q: '' };
  const info = (label, value) => html`<div class="info"><dt>${label}</dt><dd>${value || html`<span class="muted">—</span>`}</dd></div>`;
  const update = (data) => (({ author, entries } = data), render());

  function render() {
    const q = state.q.trim().toLowerCase();
    const list = entries.map((r) => ({ ...r, changes: r.changes.filter(([, m]) => !state.module || m === state.module) }))
      .filter((r) => r.changes.length)
      .filter((r) => !q || [r.version, r.title, r.notes, ...(r.known || []), ...r.changes.map((c) => c[2])].join(' ').toLowerCase().includes(q));
    mount(el.querySelector('#byline'), html`Written by <strong>${author}</strong>${edit ? html` · <button type="button" class="link" id="edit-author">change</button>` : ''}`);
    mount(el.querySelector('#count'), html`${entries.length} builds${entries.length ? html` since ${fmtDate(entries.at(-1).date)}` : ''}`);
    el.querySelectorAll('[data-module-filter]').forEach((b) => {
      b.classList.toggle('active', b.dataset.moduleFilter === state.module);
      b.querySelector('em').textContent = b.dataset.moduleFilter ? entries.filter((r) => r.modules.includes(b.dataset.moduleFilter)).length : entries.length;
    });
    mount(el.querySelector('#releases'), list.length
      ? list.map((r) => html`<article class="release ${unseen.has(r.version) ? 'unseen' : ''}" id="v${r.version}">
          <aside>
            <p class="rel-version">${versionLabel(r.version)}</p>
            <time datetime="${r.date}">${fmtDate(r.date)}</time>
            <p class="rel-author">by ${author}${r.updatedAt ? html`<br /><span>edited ${fmtDate(r.updatedAt.slice(0, 10))}</span>` : ''}</p>
            <div class="rel-flags">${r.version === about.version ? badge('Installed', 'maroon') : ''}${unseen.has(r.version) ? badge('New', 'amber') : ''}</div>
          </aside>
          <div class="rel-body">
            <div class="rel-head"><h2>${r.title}</h2>
              ${edit ? html`<div class="rel-actions"><button type="button" class="btn small-btn" data-edit="${r.id}">Edit</button><button type="button" class="btn small-btn danger ghost" data-delete="${r.id}">Delete</button></div>` : ''}</div>
            <p class="rel-notes">${r.notes}</p>
            <p class="rel-modules">${r.modules.map((m) => html`<span class="chip">${DEVLOG_MODULES[m]}</span>`)}</p>
            <ul class="changes">${r.changes.map(([type, m, text]) => html`<li>
              ${badge(CHANGE_TYPES[type], CHANGE_KIND[type])}<span>${text}${r.modules.length > 1 && !state.module ? html` <small class="muted">· ${DEVLOG_MODULES[m]}</small>` : ''}</span></li>`)}</ul>
            ${r.known?.length && !state.module ? html`<div class="known"><h3>Known issues</h3><ul>${r.known.map((k) => html`<li>${k}</li>`)}</ul></div>` : ''}
          </div>
        </article>`)
      : html`<div class="card empty"><p>${entries.length ? 'Nothing matches.' : 'No entries yet.'}</p></div>`);
  }

  mount(el, html`<div class="devlog-page">
    <header class="page-head">
      <div><h1>Dev log</h1><p class="muted">My notes on every build of LTDC ERP, newest first: <span id="count"></span>. Still in alpha, so expect rough edges.</p>
        <p class="byline" id="byline"></p></div>
      <div class="actions">${edit ? html`<button class="btn primary" id="new-entry">+ New entry</button>` : ''}</div>
    </header>
    <section class="card about-card">
      <div class="card-head"><h2>Installed version</h2>${about.version === APP_VERSION ? badge('Up to date', 'green') : badge(`Server reports ${about.version}`, 'amber')}</div>
      <dl class="info-grid four">
        ${info('Version', html`<strong class="big-version">${versionLabel(about.version)}</strong>`)}
        ${info('Build', about.commit ? html`<span class="mono">${about.commit.slice(0, 7)}</span><small class="muted"> · ${about.channel}</small>` : about.channel)}
        ${info('Installed', about.installedAt ? when(about.installedAt) : '')}
        ${info('Running for', html`${uptime(about.startedAt)}<small class="muted"> · since ${when(about.startedAt)}</small>`)}
      </dl>
    </section>
    <section class="card">
      <div class="toolbar">
        <div class="filter-chips">
          <button type="button" class="chip-filter" data-module-filter="">All builds <em></em></button>
          ${Object.entries(DEVLOG_MODULES).map(([k, v]) => html`<button type="button" class="chip-filter" data-module-filter="${k}">${v} <em></em></button>`)}
        </div>
        <input type="search" id="q" placeholder="Search the log…" />
      </div>
    </section>
    <div id="releases" class="releases"></div>
  </div>`);
  // Listen on this page's own root, not on the shared app container.
  const root = el.querySelector('.devlog-page');

  render();
  el.querySelectorAll('[data-module-filter]').forEach((b) => b.addEventListener('click', () => ((state.module = b.dataset.moduleFilter), render())));
  el.querySelector('#q').addEventListener('input', (e) => ((state.q = e.target.value), render()));
  el.querySelector('#new-entry')?.addEventListener('click', () => openEditor(null, entries, update));
  root.addEventListener('click', async (ev) => {
    if (ev.target.closest('#edit-author')) return openAuthor(author, update);
    const editId = ev.target.closest('[data-edit]')?.dataset.edit;
    if (editId) return openEditor(entries.find((x) => x.id === editId), entries, update);
    const delId = ev.target.closest('[data-delete]')?.dataset.delete;
    if (delId) {
      const r = entries.find((x) => x.id === delId);
      if (!(await confirmDialog(`Delete the entry for v${r.version} (“${r.title}”)? This can't be undone.`))) return;
      update(await api.del(`/api/devlog/${delId}`));
      toast('Entry deleted.');
    }
  });
  markSeen(entries[0]?.version);
}
