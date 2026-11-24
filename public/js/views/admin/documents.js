// Admin panel → Document control (0.67, docs.manage): what Documents accepts (file types by family,
// read from the content; programs, scripts, web pages and macros always refused), the limits on
// uploads and storage, the sharing policy (inside the company and by link), retention, and the
// activity: storage used, working links (turn off one or all), refused uploads, the integrity check.
// Every tab saves the whole settings object; the server cleans it (Restricted is never shared by link).
import { api } from '../../api.js';
import { html, mount, toast, confirmDialog } from '../../ui.js';
import { icon } from '../../icons.js';
import { pageHead, fmtDateTime, timeAgo, bytes, plural } from './common.js';

const TABS = [
  ['types', 'File types', 'file'],
  ['uploads', 'Uploads & storage', 'upload'],
  ['sharing', 'Sharing', 'link'],
  ['retention', 'Retention', 'clock'],
  ['activity', 'Activity', 'activity'],
];
const MODE = { view: 'View only', download: 'Download', upload: 'Upload' };
const CODE = { blocked: 'Never accepted', content: 'Content', mismatch: 'Name does not match content', type: 'Type turned off', size: 'Too large', quota: 'Over the quota', duplicate: 'Duplicate' };

export async function documentControlView(el, params, q = {}) {
  const tab = TABS.some(([id]) => id === q.tab) ? q.tab : 'types';
  const cfg = await api.get('/api/docs/settings');
  let s = structuredClone(cfg.settings);
  const D = cfg.defaults;
  const def = (v, unit = '') => html`<small class="muted dc-def">Default: ${v}${unit}</small>`;
  const num = (name, label, { min = 0, max, unit = '', help = '' }) => html`<label class="field"><span>${label}</span>
    <span class="dc-num"><input type="number" name="${name}" min="${min}" ${max != null ? `max="${max}"` : ''} value="${s[name]}" required />${unit ? html`<span class="muted">${unit}</span>` : ''}</span>
    ${help ? html`<small class="muted">${help}</small>` : ''}${def(D[name], unit ? ` ${unit}` : '')}</label>`;
  const sw = (name, label, help = '') => html`<div class="dc-switch"><label class="switch"><input type="checkbox" name="${name}" ${s[name] ? 'checked' : ''} /> <span><strong>${label}</strong></span></label>${help ? html`<small class="muted">${help} Default: ${D[name] ? 'on' : 'off'}.</small>` : ''}</div>`;

  function typesTab() {
    return html`
      <div class="notice info">${icon('shield')}<p>CORE reads what a file really is from its content (its first bytes, and the parts inside Office and ZIP files), never from its name or the browser. The extension must then agree: a file called <code>.pdf</code> that is really a ZIP or a program is <strong>refused</strong>, not renamed. Turning a kind off stops new uploads of it; documents already stored stay.</p></div>
      <form id="dc-form" class="card dc-card" novalidate>
        <div class="card-head"><h2>${icon('file')} Accepted kinds of file</h2><span class="muted small">${s.families.length} of ${cfg.families.length} on</span></div>
        <ul class="dc-families">${cfg.families.map((f) => html`<li>
          <label class="switch"><input type="checkbox" name="fam" value="${f.id}" ${s.families.includes(f.id) ? 'checked' : ''} aria-label="${f.label}" /></label>
          <span class="grow"><strong>${f.label}</strong>${D.families.includes(f.id) ? '' : html` <span class="badge gray">Off by default</span>`}${f.inline ? html` <span class="badge blue" title="Opens in the browser when someone clicks View">Opens in the browser</span>` : ''}
            <small class="dc-exts">${f.exts.map((x) => html`<code>.${x}</code>`)}</small></span></li>`)}
          <li class="dc-locked">
            <label class="switch"><input type="checkbox" disabled aria-label="${cfg.blocked.label}: always refused" /></label>
            <span class="grow"><strong>${icon('lock', 14)} ${cfg.blocked.label}</strong> <span class="badge red">Always refused</span>
              <small>They can run code on a computer or in a browser, so no setting allows them. Password-protected Office files and ZIPs that unpack to far more than they hold, or that contain any of these, are refused too.</small>
              <small class="dc-exts">${cfg.blocked.exts.map((x) => html`<code>.${x}</code>`)}</small></span></li>
        </ul>
        ${saveRow()}
      </form>`;
  }
  function uploadsTab() {
    return html`<form id="dc-form" class="card dc-card" novalidate>
      <div class="card-head"><h2>${icon('upload')} Uploads and storage</h2></div>
      <div class="grid two">
        ${num('maxUploadMB', 'Largest file', { min: 1, max: cfg.maxUploadMB, unit: 'MB', help: `At most ${cfg.maxUploadMB} MB. Files go up in pieces of 4 MB, so large files work on slow lines.` })}
        ${num('quotaMB', 'Space per person', { min: 0, unit: 'MB', help: 'All versions of the documents someone owns. 0 = no limit.' })}
        ${num('versionsKept', 'Versions kept per document', { min: 1, max: 500, help: 'Older versions are removed when a new one is added (never while on legal hold).' })}
        <label class="field"><span>The same file twice in a folder</span><select name="duplicates">
          <option value="warn" ${s.duplicates === 'warn' ? 'selected' : ''}>Keep it, and say so</option>
          <option value="refuse" ${s.duplicates === 'refuse' ? 'selected' : ''}>Refuse it</option></select>
          <small class="muted">Compared by content (SHA-256), whatever the names.</small>${def(D.duplicates === 'warn' ? 'keep it, and say so' : 'refuse it')}</label>
      </div>
      ${saveRow()}
    </form>`;
  }
  function sharingTab() {
    const cls = cfg.classifications;
    return html`<form id="dc-form" class="card dc-card" novalidate>
      <div class="card-head"><h2>${icon('users')} Inside the company</h2></div>
      ${sw('internalSharing', 'People can share documents and folders with others', 'Off: only document managers change who has access.')}
      ${sw('shareWithEveryone', 'Sharing with “Everyone signed in” is allowed', 'Never for restricted documents.')}
      <div class="card-head dc-sub"><h2>${icon('link')} Links for people outside the company</h2></div>
      ${sw('links', 'Links outside the company are allowed', 'Off: no new links, and every existing link stops working until it is turned on again.')}
      ${sw('uploadLinks', 'Upload links (a folder people send files into) are allowed', 'Files arrive as Received, not reviewed, with every check an upload gets.')}
      <div class="grid two">
        <label class="field"><span>Who makes links</span><select name="linkCreators">
          <option value="all" ${s.linkCreators === 'all' ? 'selected' : ''}>Anyone who may share the document or folder</option>
          <option value="managers" ${s.linkCreators === 'managers' ? 'selected' : ''}>Document managers only</option></select>
          <small class="muted">Links made by someone who may no longer make them stop working.</small>${def(D.linkCreators === 'all' ? 'anyone who may share' : 'managers only')}</label>
        <div class="field">${sw('linkPasswordRequired', 'Every link needs a password', 'Links to confidential documents always need one.')}</div>
        ${num('linkPasswordMin', 'Shortest link password', { min: 6, max: 64, unit: 'characters' })}
        ${num('linkDefaultDays', 'A new link lasts', { min: 1, max: 3650, unit: 'days', help: 'What the Share window suggests.' })}
        ${num('linkMaxDays', 'Longest a link can last', { min: 1, max: 3650, unit: 'days' })}
        ${num('linkMaxDownloads', 'Download limit suggested for new links', { min: 0, max: 100000, help: '0 = no limit. The person making the link can change it.' })}
      </div>
      <fieldset class="dc-cls"><legend>Classifications that may be shared by link</legend>
        ${cls.map((c) => html`<label class="field check"><input type="checkbox" name="linkCls" value="${c.id}" ${c.id === 'restricted' ? 'disabled' : s.linkClassifications.includes(c.id) ? 'checked' : ''} /> <span><strong>${c.label}</strong>${c.id === 'restricted' ? html` ${icon('lock', 12)} <span class="muted">never, whatever is saved</span>` : ''}<small class="muted">${c.help}</small></span></label>`)}
        ${def(D.linkClassifications.map((c) => c[0].toUpperCase() + c.slice(1)).join(', '))}
      </fieldset>
      ${saveRow()}
    </form>
    <section class="card"><div class="card-head"><h2>${icon('shield')} Classification levels</h2></div>
      <table class="table compact"><thead><tr><th>Level</th><th>What it means</th></tr></thead>
        <tbody>${cls.map((c) => html`<tr><td><strong>${c.label}</strong></td><td>${c.help}</td></tr>`)}</tbody></table>
      <p class="muted small">Whoever uploads a document chooses its level (Internal unless they change it); the people who manage it change it later. Files that come in through upload links start as Internal.</p>
    </section>`;
  }
  function retentionTab() {
    return html`<form id="dc-form" class="card dc-card" novalidate>
      <div class="card-head"><h2>${icon('clock')} Retention</h2></div>
      <div class="grid two">
        ${num('trashDays', 'Days in the trash', { min: 1, max: 3650, unit: 'days', help: 'Then deleted for good, with all versions. Documents and folders on legal hold are never deleted.' })}
        ${num('checkoutHours', 'A check-out ends by itself after', { min: 1, max: 24 * 90, unit: 'hours', help: 'So a forgotten check-out does not block others. A manager of the document can end one sooner.' })}
      </div>
      ${saveRow()}
    </form>
    <div class="notice">${icon('lock')}<p><strong>Legal hold</strong> (on a document or a folder, from its <strong>More</strong> or <strong>Folder</strong> menu, for document managers): nothing held can be moved to the trash or deleted, and old versions are kept, until the hold is lifted.</p></div>`;
  }
  const saveRow = () => html`<p class="form-error" role="alert" hidden></p><div class="actions dc-save"><button type="submit" class="btn primary">Save</button><button type="button" class="btn ghost" id="dc-defaults">Use the defaults on this tab</button></div>`;

  async function activityTab() {
    const a = await api.get('/api/docs/admin');
    const integ = a.integrity;
    return html`
      <div class="stats">
        <div class="card"><small>Storage used</small><strong>${a.usage.bytes >= 1e9 ? `${(a.usage.bytes / 1e9).toFixed(1)} GB` : bytes(a.usage.bytes)}</strong><span class="muted small block">${plural(a.usage.files, 'stored file')}, encrypted</span></div>
        <div class="card"><small>Documents</small><strong>${a.documents}</strong><span class="muted small block">${plural(a.versions, 'version')} · ${plural(a.folders, 'folder')}</span></div>
        <div class="card ${a.unreviewed ? 'attention' : ''}"><small>Received, not reviewed</small><strong>${a.unreviewed}</strong><span class="muted small block">${a.trashed} in the trash · ${a.held} on legal hold</span></div>
        <div class="card"><small>Working links</small><strong>${a.links.length}</strong><span class="muted small block">outside the company</span></div>
      </div>
      <section class="card scroll-x" aria-labelledby="dc-links-h">
        <div class="card-head"><h2 id="dc-links-h">${icon('link')} Links outside the company</h2>${a.links.length ? html`<button type="button" class="btn small-btn danger ghost" id="dc-revoke-all">Turn all off</button>` : ''}</div>
        ${a.links.length ? html`<table class="table"><thead><tr><th>Shares</th><th>Kind</th><th>Made by</th><th>Until</th><th>Use</th><th></th></tr></thead><tbody>
          ${a.links.map((l) => html`<tr>
            <td><strong>${l.target.name}</strong><small>${l.target.kind === 'folder' ? 'Folder' : 'Document'} · link …${l.hint}${l.note ? ` · “${l.note}”` : ''}</small></td>
            <td>${MODE[l.mode]}${l.hasPassword ? html`<small>${icon('lock', 11)} password</small>` : html`<small>no password</small>`}</td>
            <td>${l.createdByName}<small>${timeAgo(l.createdAt)}</small></td>
            <td>${fmtDateTime(l.expiresAt)}${l.state === 'used' ? html`<small>download limit reached</small>` : ''}</td>
            <td>${l.mode === 'upload' ? plural(l.uploads, 'file') : `${plural(l.views, 'view')}, ${l.downloads}${l.maxDownloads ? `/${l.maxDownloads}` : ''} downloads`}<small>${l.lastAccessAt ? `last opened ${timeAgo(l.lastAccessAt)}` : 'not opened yet'}</small></td>
            <td class="row-actions"><button type="button" class="btn small-btn danger ghost" data-revoke="${l.id}">Turn off</button></td></tr>`)}
        </tbody></table>` : html`<p class="muted">No working links. People make them from a document or folder's <strong>Share</strong> button.</p>`}
      </section>
      <section class="card scroll-x" aria-labelledby="dc-ref-h">
        <div class="card-head"><h2 id="dc-ref-h">${icon('alert')} Refused uploads</h2>${a.refused.length ? html`<span class="muted small">Newest first; the last 300 are kept</span>` : ''}</div>
        ${a.refused.length ? html`<table class="table"><thead><tr><th>File</th><th>By</th><th>When</th><th>Why</th></tr></thead><tbody>
          ${a.refused.map((r) => html`<tr><td><strong>${r.name}</strong><small>${CODE[r.code] || r.code}</small></td><td>${r.byName}</td><td>${fmtDateTime(r.at)}</td><td>${r.reason}</td></tr>`)}
        </tbody></table>` : html`<p class="muted">Nothing refused yet.</p>`}
      </section>
      <section class="card" aria-labelledby="dc-int-h">
        <div class="card-head"><h2 id="dc-int-h">${icon('shield')} Integrity check</h2><button type="button" class="btn" id="dc-integrity">${icon('checkCircle', 16)} Check every file now</button></div>
        <p class="muted small">Reads every stored version, decrypts it and compares it with the SHA-256 kept when it was added, and counts stored files that no document uses. Each download is checked the same way.</p>
        ${integ ? html`<p class="${integ.problems.length ? 'bad-text' : 'ok-text'}"><strong>${integ.problems.length ? `${plural(integ.problems.length, 'problem')} found` : 'Every file is as it was stored'}</strong> · ${plural(integ.checked, 'file')} checked ${fmtDateTime(integ.at)}${integ.orphans ? ` · ${plural(integ.orphans, 'unused stored file')}` : ''}</p>
          ${integ.problems.length ? html`<ul class="dc-problems">${integ.problems.map((p) => html`<li><strong>${p.document}</strong>, version ${p.version}: ${p.problem}</li>`)}</ul>` : ''}` : html`<p class="muted">Not run yet.</p>`}
      </section>`;
  }

  const hrefOf = (t) => `#/admin/documents?tab=${t}`;
  const body = tab === 'activity' ? await activityTab() : { types: typesTab, uploads: uploadsTab, sharing: sharingTab, retention: retentionTab }[tab]();
  mount(el, html`
    ${pageHead('Document control', 'What Documents accepts, how documents may be shared inside the company and outside it, and how long things are kept. Changes apply at once, to everyone.')}
    <nav class="tabs" aria-label="Document control">${TABS.map(([id, label, ic]) => html`<a href="${hrefOf(id)}" class="${id === tab ? 'active' : ''}" ${id === tab ? 'aria-current="page"' : ''}>${icon(ic, 16)} ${label}</a>`)}</nav>
    ${body}`);

  // Saving: the whole settings object, with this tab's fields read from the form.
  const form = el.querySelector('#dc-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('.form-error');
    err.hidden = true;
    const next = { ...s };
    for (const input of form.querySelectorAll('input[type=number]')) next[input.name] = Number(input.value);
    for (const input of form.querySelectorAll('.switch input[name]:not([name=fam])')) next[input.name] = input.checked;
    for (const sel of form.querySelectorAll('select[name]')) next[sel.name] = sel.value;
    if (tab === 'types') next.families = [...form.querySelectorAll('input[name=fam]:checked')].map((x) => x.value);
    if (tab === 'sharing') next.linkClassifications = [...form.querySelectorAll('input[name=linkCls]:checked')].map((x) => x.value);
    if (tab === 'types' && !next.families.length && !(await confirmDialog('With every kind of file off, nobody can upload anything. Save anyway?', { confirmLabel: 'Save', title: 'No file types' }))) return;
    if (tab === 'sharing' && next.linkDefaultDays > next.linkMaxDays) {
      err.textContent = 'A new link cannot last longer than the longest a link can last.';
      err.hidden = false;
      return;
    }
    if (tab === 'sharing' && s.links && !next.links && !(await confirmDialog('Turn links outside the company off? Every existing link stops working at once (they work again if you turn links back on before they expire).', { confirmLabel: 'Turn links off', title: 'Links outside the company' }))) return;
    try {
      const out = await api.put('/api/docs/settings', { settings: next });
      s = out.settings;
      toast('Document control saved.');
      documentControlView(el, params, q);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
  el.querySelector('#dc-defaults')?.addEventListener('click', () => {
    for (const input of form.querySelectorAll('input[type=number]')) input.value = D[input.name];
    for (const input of form.querySelectorAll('.switch input[name]:not([name=fam])')) input.checked = Boolean(D[input.name]);
    for (const sel of form.querySelectorAll('select[name]')) sel.value = D[sel.name];
    form.querySelectorAll('input[name=fam]').forEach((x) => (x.checked = D.families.includes(x.value)));
    form.querySelectorAll('input[name=linkCls]:not(:disabled)').forEach((x) => (x.checked = D.linkClassifications.includes(x.value)));
    toast('The defaults are filled in. Click Save to use them.');
  });

  // Activity: links, all links, the integrity check.
  el.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Turn this link off? It stops working at once for everyone who has it.', { confirmLabel: 'Turn off', title: 'Turn a link off' }))) return;
    try {
      await api.del(`/api/docs/admin/links/${b.dataset.revoke}`);
      toast('Link turned off.');
      documentControlView(el, params, q);
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
  el.querySelector('#dc-revoke-all')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Turn off every link for people outside the company? They all stop working at once, and cannot be turned on again; people make new ones if they need them.', { confirmLabel: 'Turn all links off', title: 'Turn all links off' }))) return;
    try {
      const r = await api.post('/api/docs/admin/links/revoke-all', {});
      toast(`${plural(r.revoked, 'link')} turned off.`);
      documentControlView(el, params, q);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  el.querySelector('#dc-integrity')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Checking…';
    try {
      const r = await api.post('/api/docs/admin/integrity', {});
      toast(r.problems.length ? `${plural(r.problems.length, 'problem')} found.` : `All ${plural(r.checked, 'file')} are as they were stored.`, r.problems.length ? 'error' : 'ok');
      documentControlView(el, params, q);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
