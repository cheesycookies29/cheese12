// Document control (Admin panel → Document control; also in ATLAS Documents for holders of
// docs.manage who do not use the Admin panel): which kinds of file ATLAS Documents accepts, uploads
// and storage, sharing and links, retention, and the activity: storage used, links that work (turn
// one or all off), refused uploads with the reason, and the integrity check of every stored file.
// Every save is recorded in the Settings center's history.
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, toast, badge, fmtDateTime, fmtSize, confirmDialog, formData, timeAgo } from '../../ui.js';

const TABS = [['types', 'File types'], ['storage', 'Uploads & storage'], ['sharing', 'Sharing'], ['retention', 'Retention'], ['activity', 'Activity']];
const MODE = { view: 'View only', download: 'View and download', upload: 'Upload only' };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const CODE = { blocked: 'Never accepted', content: 'Content', mismatch: 'Name and content differ', kind: 'Wrong kind for a new version', type: 'Type not accepted', size: 'Too large', quota: 'Over the storage limit', duplicate: 'Duplicate' };

export async function documentControlView(el, _params = {}, query = {}, { base = '#/documents' } = {}) {
  const tab = TABS.some(([k]) => k === query.tab) ? query.tab : 'types';
  const [cfg, act] = await Promise.all([api.get('/api/docs/settings'), tab === 'activity' ? api.get('/api/docs/admin') : null]);
  const s = cfg.settings;
  const num = (name, label, hint, min, max) => html`<label class="field"><span>${label}</span><input type="number" name="${name}" value="${s[name]}" min="${min}" max="${max}" /><span class="hint">${hint}</span></label>`;
  const check = (name, label, hint = '') => html`<label class="field check"><input type="checkbox" name="${name}" ${s[name] ? 'checked' : ''} /> <span><strong>${label}</strong>${hint ? html` ${hint}` : ''}</span></label>`;
  const save = html`<div class="actions end"><button class="btn primary" type="submit">Save</button></div>`;
  const views = {
    types: () => html`<form class="card" data-form="types">
      <h2>${icon('file')} Kinds of file people may add</h2>
      <p class="muted">ATLAS reads each file's bytes to tell what it really is, whatever it is called, and refuses a file whose name does not match its content (a “.pdf” that is not a PDF).</p>
      <div class="check-grid doc-families">${cfg.families.map((f) => html`<label class="field check"><input type="checkbox" name="family" value="${f.id}" ${s.families.includes(f.id) ? 'checked' : ''} /> <span><strong>${f.label}</strong><small class="muted block">${f.exts.map((e) => `.${e}`).join(' ')}</small></span></label>`)}</div>
      <div class="notice bad locked">${icon('lock')}<div><p><strong>Always refused, whatever is ticked:</strong> ${cfg.blocked.label.replace(/^./, (c) => c.toLowerCase())}, password-protected Office files, and ZIP files that unpack to far more than they hold or contain any of these.</p>
        <p class="small mono">${cfg.blocked.exts.map((e) => `.${e}`).join(' ')}</p></div></div>
      ${save}</form>`,
    storage: () => html`<form class="card" data-form="storage">
      <h2>${icon('upload')} Uploads and storage</h2>
      <div class="grid two">
        ${num('maxUploadMB', 'Largest file (MB)', `Up to ${cfg.maxUploadMB} MB. Files go up in pieces of 4 MB.`, 1, cfg.maxUploadMB)}
        ${num('quotaMB', 'Storage per person (MB)', 'All versions of the documents a person owns. 0 = no limit.', 0, 1048576)}
        ${num('versionsKept', 'Versions kept per document', 'Older versions beyond this are removed (never while on legal hold).', 1, 500)}
        <label class="field"><span>The same file twice in one folder</span><select name="duplicates"><option value="warn" ${s.duplicates === 'warn' ? 'selected' : ''}>Add it, and say it is a duplicate</option><option value="refuse" ${s.duplicates === 'refuse' ? 'selected' : ''}>Refuse it</option></select></label>
      </div>
      <p class="hint">Every file is encrypted on the server with its own key, under the server key (<code>server.key</code> beside the data file, or <code>SERVER_KEY</code>). Keep a copy of that key with your backups: without it, stored documents cannot be opened.</p>
      ${save}</form>`,
    sharing: () => html`<form class="card" data-form="sharing">
      <h2>${icon('users')} Sharing inside the school</h2>
      ${check('internalSharing', 'People may share documents and folders with others in ATLAS.', 'Off: only document managers change who has access.')}
      ${check('shareWithEveryone', 'Staff may share with everyone signed in at once.', 'Students never can; they share with named people only.')}
      <h2 class="mt">${icon('link')} Links for people outside the school</h2>
      ${check('links', 'Staff may make links for people without an ATLAS account.', 'Students never can.')}
      ${check('uploadLinks', 'Upload links: people outside may send files into a folder.', 'Files arrive as “Received, not reviewed”, with every check an upload gets.')}
      <div class="grid two">
        <label class="field"><span>Who makes links</span><select name="linkCreators"><option value="all" ${s.linkCreators === 'all' ? 'selected' : ''}>All staff (who may share the item)</option><option value="managers" ${s.linkCreators === 'managers' ? 'selected' : ''}>Document managers only</option></select></label>
        <div class="field">${check('linkPasswordRequired', 'Every link needs a password.')}</div>
        ${num('linkPasswordMin', 'Shortest link password', '6 to 64 characters.', 6, 64)}
        ${num('linkMaxDownloads', 'Downloads per link, unless changed', '0 = no limit.', 0, 100000)}
        ${num('linkDefaultDays', 'A link lasts (days), unless changed', '', 1, 3650)}
        ${num('linkMaxDays', 'Longest a link may last (days)', '', 1, 3650)}
      </div>
      <h2 class="mt">${icon('shield')} Classifications</h2>
      <table class="table compact doc-classes"><thead><tr><th>Classification</th><th>Rule</th><th>By link</th></tr></thead>
        <tbody>${cfg.classifications.map((c) => html`<tr><td><strong>${c.label}</strong></td><td data-label="Rule">${c.help}</td>
          <td data-label="By link"><label class="check-inline"><input type="checkbox" name="linkClass" value="${c.id}" ${s.linkClassifications.includes(c.id) ? 'checked' : ''} ${c.id === 'restricted' ? 'disabled' : ''} /> ${c.id === 'restricted' ? 'Never' : 'Allowed'}</label></td></tr>`)}</tbody></table>
      ${save}</form>`,
    retention: () => html`<form class="card" data-form="retention">
      <h2>${icon('trash')} Trash and check-out</h2>
      <div class="grid two">
        ${num('trashDays', 'Days in the trash', 'Then removed for good, files included (not while on legal hold).', 1, 3650)}
        ${num('checkoutHours', 'Longest check-out (hours)', 'A check-out ends by itself after this.', 1, 2160)}
      </div>
      <p class="hint">A legal hold, placed by a document manager on a document or folder, keeps it from being deleted and keeps all its versions.</p>
      ${save}</form>`,
    activity: () => html`
      <div class="stats">
        <div class="card"><small>Storage used</small><strong>${fmtSize(act.usage.bytes)}</strong></div>
        <div class="card"><small>Documents</small><strong>${act.documents}</strong></div>
        <div class="card"><small>Versions</small><strong>${act.versions}</strong></div>
        <div class="card"><small>Folders</small><strong>${act.folders}</strong></div>
        <div class="card"><small>In the trash</small><strong>${act.trashed}</strong></div>
        <div class="card"><small>On legal hold</small><strong>${act.held}</strong></div>
        <div class="card ${act.unreviewed ? 'accent' : ''}"><small>Received, not reviewed</small><strong>${act.unreviewed}</strong></div>
      </div>
      <section class="card">
        <div class="card-head"><h2>${icon('shield')} Integrity check</h2><button type="button" class="btn" id="integrity">${icon('checkCircle', 16)} Check every file now</button></div>
        <p class="muted">Opens every stored file and compares it with its fingerprint (SHA-256): a file changed or damaged on the disk, or missing after a restore, is listed here.</p>
        <div id="integrity-out">${integrityResult(act.integrity)}</div>
      </section>
      <section class="card scroll-x">
        <div class="card-head"><h2>${icon('link')} Links that work (${act.links.length})</h2>${act.links.length ? html`<button type="button" class="btn danger ghost sm" id="revoke-all">Turn all off</button>` : ''}</div>
        ${act.links.length ? html`<table class="table compact"><thead><tr><th>Link</th><th>For</th><th>Made by</th><th>Until</th><th>Used</th><th></th></tr></thead><tbody>
          ${act.links.map((l) => html`<tr><td><strong>…${l.hint}</strong> ${l.hasPassword ? badge('Password', 'blue') : ''}<small>${MODE[l.mode]}</small></td><td data-label="For">${l.target.name}<small>${l.target.kind === 'folder' ? 'Folder' : 'Document'}</small></td>
            <td data-label="Made by">${l.createdByName}<small>${timeAgo(l.createdAt)}</small></td><td data-label="Until">${fmtDateTime(l.expiresAt)}</td>
            <td data-label="Used">${l.mode === 'upload' ? plural(l.uploads, 'file') : `${plural(l.opens, 'open')}, ${plural(l.downloads, 'download')}`}${l.lastAccessAt ? html`<small>Last ${timeAgo(l.lastAccessAt)}</small>` : ''}</td>
            <td class="row-actions"><button type="button" class="btn sm danger ghost" data-revoke="${l.id}">Turn off</button></td></tr>`)}
        </tbody></table>` : html`<p class="muted" style="padding:0 20px 16px">No link for people outside the school is working.</p>`}
      </section>
      <section class="card scroll-x">
        <h2>${icon('flag')} Refused uploads</h2>
        ${act.refused.length ? html`<table class="table compact"><thead><tr><th>File</th><th>Why</th><th>By</th><th>When</th></tr></thead><tbody>
          ${act.refused.map((r) => html`<tr><td><strong>${r.name}</strong><small>${CODE[r.code] || r.code}</small></td><td data-label="Why">${r.reason}</td><td data-label="By">${r.byName}</td><td data-label="When">${timeAgo(r.at)}</td></tr>`)}
        </tbody></table>` : html`<p class="muted" style="padding:0 20px 16px">No file has been refused.</p>`}
      </section>`,
  };
  mount(el, html`
    ${pageHead('Document control', 'The rules of ATLAS Documents for the whole school: what may be added, how it is kept, and how it may be shared.')}
    <nav class="tabs">${TABS.map(([k, l]) => html`<a href="${base}?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`)}</nav>
    ${views[tab]()}`);

  const reload = () => documentControlView(el, _params, query, { base });
  const form = el.querySelector('form[data-form]');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formData(form);
    const boxes = (name) => [...form.querySelectorAll(`input[name=${name}]:checked`)].map((x) => x.value);
    const ints = (...names) => Object.fromEntries(names.filter((n) => n in v).map((n) => [n, Number(v[n])]));
    const bools = (...names) => Object.fromEntries(names.map((n) => [n, Boolean(form.querySelector(`[name=${n}]`)?.checked)]));
    const next = {
      types: () => ({ families: boxes('family') }),
      storage: () => ({ ...ints('maxUploadMB', 'quotaMB', 'versionsKept'), duplicates: v.duplicates }),
      sharing: () => ({ ...bools('internalSharing', 'shareWithEveryone', 'links', 'uploadLinks', 'linkPasswordRequired'), ...ints('linkPasswordMin', 'linkMaxDownloads', 'linkDefaultDays', 'linkMaxDays'), linkCreators: v.linkCreators, linkClassifications: boxes('linkClass') }),
      retention: () => ints('trashDays', 'checkoutHours'),
    }[form.dataset.form]();
    try {
      await api.put('/api/docs/settings', { settings: next });
      toast('Document control saved. It applies at once.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  el.querySelector('#integrity')?.addEventListener('click', async (e) => {
    // Keep the button: e.currentTarget is null once the handler has awaited.
    const btn = e.currentTarget;
    const out = el.querySelector('#integrity-out');
    btn.disabled = true;
    mount(out, html`<p class="muted">Checking every file…</p>`);
    try {
      mount(out, integrityResult(await api.post('/api/docs/admin/integrity', {})));
    } catch (err) {
      mount(out, html`<div class="notice bad">${icon('flag')}<div><p><strong>The check did not finish.</strong> ${err.message}</p></div></div>`);
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
  el.querySelector('#revoke-all')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Turn off every link for people outside the school? They stop working at once; people can make new ones.', { confirmLabel: 'Turn all off' }))) return;
    const r = await api.post('/api/docs/admin/links/revoke-all', {});
    toast(`${plural(r.revoked, 'link')} turned off.`);
    reload();
  });
  el.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
    await api.del(`/api/docs/admin/links/${b.dataset.revoke}`);
    toast('Link turned off.');
    reload();
  }));
}

function integrityResult(r) {
  if (!r) return html`<p class="muted">Not run yet.</p>`;
  return html`<div class="notice ${r.problems.length ? 'bad' : 'ok'}">${icon(r.problems.length ? 'flag' : 'checkCircle')}<div>
    <p><strong>${r.problems.length ? plural(r.problems.length, 'problem') : 'Every file is as it was stored.'}</strong> ${plural(r.checked, 'file version')} checked ${fmtDateTime(r.at)}${r.byName ? ` by ${r.byName}` : ''}.${r.orphans ? ` ${r.orphans === 1 ? '1 stored file belongs' : `${r.orphans} stored files belong`} to no document (left from a restore or an interrupted upload).` : ''}</p>
    ${r.problems.length ? html`<ul>${r.problems.map((p) => html`<li><strong>${p.document}</strong>, version ${p.version}: ${p.problem}</li>`)}</ul>` : ''}</div></div>`;
}
