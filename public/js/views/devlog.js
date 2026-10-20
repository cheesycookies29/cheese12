// Dev log (administrators): the changelog for every build, newest first, the
// build the server is running, and (for admins) writing and editing entries.
import { api } from '../api.js';
import { ctx, can } from '../state.js';
import { DEVLOG_MODULES, MODULE_SCOPES, CHANGE_TYPES, APP_VERSION, compareVersions } from '/shared/devlog.js';
import { html, mount, modal, confirmDialog, toast, today, downloadFile } from '../ui.js';

const TYPE_ORDER = Object.keys(CHANGE_TYPES);
const MODULE_KEYS = Object.keys(DEVLOG_MODULES);
const OPEN_BY_DEFAULT = 3;
// Local time as 'YYYY-MM-DD HH:MM'.
const stamp = (iso) => {
  const d = new Date(iso);
  return `${today(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const isNewer = (a, b) => compareVersions(a, b) > 0;
// '0.2.3-alpha' -> number '0.2.3' and stage 'alpha'
const split = (v) => ({ num: v.split('-')[0], stage: v.split('-').slice(1).join('-') });

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
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return h < 48 ? `${h}h ${mins % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
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
  <input name="ctext" value="${text}" maxlength="400" placeholder="Description of the change" aria-label="Change" />
  <button type="button" class="icon-btn" data-remove-change aria-label="Remove this change">×</button>
</div>`;

function openEditor(entry, entries, onSaved) {
  const e = entry || { version: nextVersion(entries), date: today(), title: '', notes: '', changes: [['new', 'system', '']], known: [] };
  const { form } = modal({
    title: entry ? `Edit ${entry.version}` : 'New release entry',
    submitLabel: entry ? 'Save changes' : 'Add entry',
    wide: true,
    body: html`<div class="grid two">
        <label class="field"><span>Version</span><input name="version" value="${e.version}" required placeholder="0.2.5-alpha" /></label>
        <label class="field"><span>Date</span><input type="date" name="date" value="${e.date}" required /></label>
        <label class="field span-2"><span>Title</span><input name="title" value="${e.title}" maxlength="120" required placeholder="e.g. Payroll performance" /></label>
        <label class="field span-2"><span>Summary</span>
          <textarea name="notes" rows="3" maxlength="2000" required placeholder="One or two sentences on the scope of the release.">${e.notes}</textarea></label>
        <div class="field span-2"><span>Changes</span>
          <div class="change-rows">${e.changes.map(changeRow)}</div>
          <button type="button" class="btn small-btn" id="add-change">+ Add change</button></div>
        <label class="field span-2"><span>Known issues (optional, one per line)</span>
          <textarea name="known" rows="3" placeholder="Limitations or defects present in this build">${(e.known || []).join('\n')}</textarea></label>
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
    title: 'Maintainer',
    submitLabel: 'Save',
    body: html`<label class="field"><span>Name shown as the author of every entry</span><input name="name" value="${current}" maxlength="80" required /></label>
      <p class="muted small">The log has a single maintainer; this name is used for all entries and in the exported CHANGELOG.md.</p>`,
    onSubmit: async (f) => {
      onSaved(await api.put('/api/devlog-author', { name: new FormData(f).get('name') }));
      toast('Maintainer updated.');
    },
  });
}

// ---------- CHANGELOG.md ----------

function toMarkdown(entries, author) {
  const out = ['# Changelog', '', `All notable changes to LTDC ERP, newest first. Maintainer: ${author}.`, ''];
  for (const r of entries) {
    out.push(`## [${r.version}] - ${r.date}`, '', `**${r.title}.** ${r.notes}`, '');
    for (const t of TYPE_ORDER) {
      const items = r.changes.filter((c) => c[0] === t);
      if (items.length) out.push(`### ${CHANGE_TYPES[t]}`, '', ...items.map(([, m, text]) => `- **${MODULE_SCOPES[m]}:** ${text}`), '');
    }
    if (r.known?.length) out.push('### Known issues', '', ...r.known.map((k) => `- ${k}`), '');
  }
  return out.join('\n');
}

// ---------- Page ----------

const tally = (changes) => TYPE_ORDER.map((t) => [t, changes.filter((c) => c[0] === t).length]).filter(([, n]) => n);

export async function devlogView(el) {
  const [about, initial] = await Promise.all([api.get('/api/system/about'), api.get('/api/devlog')]);
  let { author, entries } = initial;
  const edit = can('devlog.edit');
  const seen = lastSeen();
  const unseen = new Set(entries.filter((e) => isUnseen(e.version, entries[0]?.version, seen)).map((e) => e.version));
  const open = new Set(entries.slice(0, OPEN_BY_DEFAULT).map((e) => e.id));
  const state = { module: '', type: '', q: '' };
  const update = (data) => (({ author, entries } = data), render());

  function render() {
    const q = state.q.trim().toLowerCase();
    const filtered = !!(state.module || state.type);
    const list = entries
      .map((r) => ({ ...r, changes: r.changes.filter(([t, m]) => (!state.module || m === state.module) && (!state.type || t === state.type))
        .sort((a, b) => TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0])) }))
      .filter((r) => r.changes.length)
      .filter((r) => !q || [r.version, r.title, r.notes, ...(r.known || []), ...r.changes.map((c) => c[2])].join(' ').toLowerCase().includes(q));
    const total = entries.reduce((n, r) => n + r.changes.length, 0);

    mount(el.querySelector('#byline'), html`Maintainer <strong>${author}</strong>${edit ? html` <button type="button" class="link" id="edit-author">change</button>` : ''}`);
    mount(el.querySelector('#count'), html`${entries.length} releases · ${total} changes${entries.length ? html` · since ${entries.at(-1).date}` : ''}`);
    el.querySelectorAll('[data-module-filter]').forEach((b) => b.classList.toggle('active', b.dataset.moduleFilter === state.module));
    el.querySelectorAll('[data-type-filter]').forEach((b) => b.classList.toggle('active', b.dataset.typeFilter === state.type));
    mount(el.querySelector('#shown'), list.length === entries.length && !filtered ? '' : html`${list.length} of ${entries.length} shown`);

    mount(el.querySelector('#releases'), list.length
      ? list.map((r) => html`<details class="release ${unseen.has(r.version) ? 'unseen' : ''}" id="v${r.version}" data-id="${r.id}" ${q || open.has(r.id) ? 'open' : ''}>
          <summary>
            <span class="rel-version">${r.version}</span>
            <time datetime="${r.date}">${r.date}</time>
            <span class="rel-title">${r.title}</span>
            <span class="rel-scopes">${MODULE_KEYS.filter((m) => r.modules.includes(m)).map((m) => html`<code>${MODULE_SCOPES[m]}</code>`)}</span>
            <span class="rel-tally">${tally(r.changes).map(([t, n]) => html`<span class="t-${t}" title="${n} ${CHANGE_TYPES[t].toLowerCase()}">${n} ${CHANGE_TYPES[t].toLowerCase()}</span>`)}</span>
            <span class="rel-flags">${r.version === about.version ? html`<span class="flag installed">installed</span>` : ''}${unseen.has(r.version) ? html`<span class="flag new">new</span>` : ''}</span>
            ${edit ? html`<span class="rel-actions"><button type="button" class="link" data-edit="${r.id}">Edit</button><button type="button" class="link danger" data-delete="${r.id}">Delete</button></span>` : ''}
          </summary>
          <div class="rel-body">
            <p class="rel-notes">${r.notes}</p>
            <ul class="changes">${r.changes.map(([type, m, text]) => html`<li>
              <span class="ctype t-${type}">${CHANGE_TYPES[type]}</span><code class="cscope">${MODULE_SCOPES[m]}</code><span class="ctext">${text}</span></li>`)}</ul>
            ${r.known?.length && !filtered ? html`<div class="known"><span class="ctype t-known">Known</span><ul>${r.known.map((k) => html`<li>${k}</li>`)}</ul></div>` : ''}
            <p class="rel-meta">${author} · ${r.source === 'release' ? 'built-in' : 'added manually'}${r.updatedAt ? html` · edited ${stamp(r.updatedAt)}` : ''}</p>
          </div>
        </details>`)
      : html`<div class="card empty"><p>${entries.length ? 'No changes match the current filters.' : 'No entries yet.'}</p></div>`);
    el.querySelectorAll('#releases details').forEach((d) => d.addEventListener('toggle', () => (d.open ? open.add(d.dataset.id) : open.delete(d.dataset.id))));
  }

  const current = about.version === APP_VERSION;
  const kv = (k, v) => html`<span class="kv"><span>${k}</span>${v}</span>`;
  mount(el, html`<div class="devlog-page">
    <header class="page-head">
      <div><h1>Dev log</h1><p class="muted mono-line"><span id="count"></span> · <span class="byline" id="byline"></span></p></div>
      <div class="actions"><button class="btn" id="export-md">Export CHANGELOG.md</button>${edit ? html`<button class="btn primary" id="new-entry">+ New entry</button>` : ''}</div>
    </header>
    <section class="buildbar" aria-label="Installed build">
      ${kv('version', html`<strong>${about.version}</strong><span class="flag ${current ? 'ok' : 'warn'}">${current ? 'current' : `client ${APP_VERSION}`}</span>`)}
      ${kv('commit', about.commit ? about.commit.slice(0, 7) : '—')}
      ${kv('channel', about.channel || '—')}
      ${kv('installed', about.installedAt ? stamp(about.installedAt) : '—')}
      ${kv('uptime', html`<span title="since ${stamp(about.startedAt)}">${uptime(about.startedAt)}</span>`)}
      ${kv('node', about.node)}
    </section>
    <div class="log-toolbar">
      <div class="seg-btns" role="group" aria-label="Module">
        <button type="button" data-module-filter="">all</button>
        ${Object.keys(DEVLOG_MODULES).map((k) => html`<button type="button" data-module-filter="${k}" title="${DEVLOG_MODULES[k]}">${MODULE_SCOPES[k]}</button>`)}
      </div>
      <div class="seg-btns" role="group" aria-label="Change type">
        <button type="button" data-type-filter="">all types</button>
        ${TYPE_ORDER.map((t) => html`<button type="button" data-type-filter="${t}">${CHANGE_TYPES[t].toLowerCase()}</button>`)}
      </div>
      <input type="search" id="q" placeholder="Search version, title or text…" />
      <span class="spacer"></span>
      <small class="muted" id="shown"></small>
      <button type="button" class="link" id="expand-all">Expand all</button>
      <button type="button" class="link" id="collapse-all">Collapse all</button>
    </div>
    <div id="releases" class="releases"></div>
  </div>`);
  // Listen on this page's own root, not on the shared app container.
  const root = el.querySelector('.devlog-page');

  render();
  el.querySelectorAll('[data-module-filter]').forEach((b) => b.addEventListener('click', () => ((state.module = b.dataset.moduleFilter), render())));
  el.querySelectorAll('[data-type-filter]').forEach((b) => b.addEventListener('click', () => ((state.type = b.dataset.typeFilter), render())));
  el.querySelector('#q').addEventListener('input', (e) => ((state.q = e.target.value), render()));
  el.querySelector('#expand-all').addEventListener('click', () => (entries.forEach((e) => open.add(e.id)), render()));
  el.querySelector('#collapse-all').addEventListener('click', () => (open.clear(), render()));
  el.querySelector('#export-md').addEventListener('click', () => downloadFile('CHANGELOG.md', toMarkdown(entries, author), 'text/markdown'));
  el.querySelector('#new-entry')?.addEventListener('click', () => openEditor(null, entries, update));
  root.addEventListener('click', async (ev) => {
    if (ev.target.closest('#edit-author')) return openAuthor(author, update);
    const editId = ev.target.closest('[data-edit]')?.dataset.edit;
    // Buttons sit inside <summary>; keep them from toggling the release.
    if (editId) return ev.preventDefault(), openEditor(entries.find((x) => x.id === editId), entries, update);
    const delId = ev.target.closest('[data-delete]')?.dataset.delete;
    if (delId) {
      ev.preventDefault();
      const r = entries.find((x) => x.id === delId);
      if (!(await confirmDialog(`Delete the entry for ${r.version} (“${r.title}”)? This cannot be undone.`))) return;
      update(await api.del(`/api/devlog/${delId}`));
      toast('Entry deleted.');
    }
  });
  markSeen(entries[0]?.version);
}
