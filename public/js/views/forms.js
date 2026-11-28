// Document circulation (0.70; after Lancaster ATLAS's), the pages:
//  - formsView: a module's "Forms & downloads" (/forms/<module>): the current published version of the
//    forms it gives this person, by category, with a search box.
//  - homeForms: the company-wide forms on the CORE home (filled in once they load; hidden when none).
//  - formsAdminView: Document circulation (/circulation, and Admin panel → Document circulation): one
//    table of every form of the modules this person keeps, with the current version (who uploaded it
//    and when), a Versions list of the earlier ones (choosing one downloads it), and the actions:
//    upload a new version, edit the details, restore a version, publish, retire or bring back, delete a
//    draft. The pages call /api/forms (server/forms.js).
import { api } from '../api.js';
import { html, mount, modal, toast, confirmDialog, badge, fmtDate } from '../ui.js';
import { icon } from '../icons.js';
import { uploadInPieces } from '../chunked.js';
import { carousel } from '../carousel.js';

const STATUS_BADGE = { draft: 'amber', published: 'green', retired: 'gray' };
const option = (v, l, sel) => html`<option value="${v}" ${sel ? 'selected' : ''}>${l}</option>`;
const sizeLabel = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const day = (iso) => fmtDate(String(iso || '').slice(0, 10));
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const KIND = [
  [['pdf'], 'filePdf', 'PDF'], [['doc', 'docx', 'dot', 'dotx', 'odt', 'ott', 'rtf'], 'file', 'Word'], [['xls', 'xlsx', 'xlt', 'xltx', 'ods', 'ots', 'csv'], 'table', 'Spreadsheet'],
  [['ppt', 'pptx', 'pps', 'ppsx', 'pot', 'potx', 'odp', 'otp'], 'slides', 'Slides'], [['jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff', 'bmp', 'heic', 'heif'], 'image', 'Picture'], [['zip'], 'box', 'ZIP'],
];
const kindOf = (ext) => KIND.find(([exts]) => exts.includes(ext)) || [[], 'file', String(ext || '').toUpperCase()];
function download(url) {
  const a = Object.assign(document.createElement('a'), { href: url, download: '' });
  document.body.append(a);
  a.click();
  a.remove();
}

// ----- Forms & downloads -----
// One list of forms, by category.
function formGroups(categories) {
  return html`${categories.map((c) => html`<section class="card form-group" data-group>
    <h2 class="form-group-title">${c.name}</h2>
    <ul class="form-list">${c.forms.map((f) => {
      const [, ic, kind] = kindOf(f.ext);
      return html`<li class="form-item" data-form="${f.id}" data-text="${`${f.title} ${f.code} ${f.description} ${c.name}`.toLowerCase()}">
        <span class="form-ic" aria-hidden="true">${icon(ic, 20)}</span>
        <span class="grow"><strong class="form-title">${f.title}</strong>${f.code ? html` <span class="form-code">${f.code}</span>` : ''}
          ${f.description ? html`<small class="form-desc">${f.description}</small>` : ''}
          <small class="muted form-meta">Updated ${day(f.updatedAt)} · ${kind} · ${sizeLabel(f.size)}</small></span>
        <a class="btn small-btn" href="/api/forms/${f.id}/file" download aria-label="Download ${f.title}">${icon('download', 15)} Download</a>
      </li>`;
    })}</ul></section>`)}`;
}
// A search box over the lists (by title, form code, description or category).
function wireSearch(root) {
  const input = root.querySelector('[data-form-search]');
  input?.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    root.querySelectorAll('[data-group]').forEach((g) => {
      let n = 0;
      g.querySelectorAll('[data-form]').forEach((li) => {
        const hit = !q || li.dataset.text.includes(q);
        li.hidden = !hit;
        n += hit;
      });
      g.hidden = !n;
      shown += n;
    });
    const none = root.querySelector('[data-form-none]');
    if (none) none.hidden = Boolean(shown);
  });
}

export async function formsView(el, params) {
  const moduleId = params.module;
  const d = await api.get(`/api/forms?module=${encodeURIComponent(moduleId)}`);
  mount(el, html`<header class="page-head">
      <div><h1>${icon('download', 22)} Forms &amp; downloads</h1><p class="muted">${moduleId === 'home' ? 'The company-wide forms and files, for everyone' : `The forms and files ${d.moduleName} gives you`}, always the latest version. Download one, fill it in, and hand it in where it says.</p></div>
      ${d.manages ? html`<div class="actions"><a class="btn" href="#/circulation/${moduleId}">${icon('settings', 16)} Document circulation</a></div>` : ''}
    </header>
    ${d.total ? html`${d.total > 4 ? html`<div class="toolbar"><input type="search" data-form-search placeholder="Search forms…" aria-label="Search forms" /></div>` : ''}
      <div class="form-groups">${formGroups(d.categories)}</div>
      <p class="muted" data-form-none hidden>No form matches.</p>`
    : html`<div class="card empty">${icon('folder', 40)}<h2>No forms here yet</h2><p>When the people who keep ${d.moduleName}'s forms publish one for you, it shows here.</p></div>`}`);
  wireSearch(el);
}

// The CORE home's company-wide forms: fills `section` (hidden until there is something to show).
export async function homeForms(section) {
  if (!section) return;
  let d;
  try {
    d = await api.get('/api/forms?module=home');
  } catch {
    return;
  }
  if (!d.total && !d.manages) return;
  section.hidden = false;
  // More than 4 forms (0.75.1): compact cards in a sliding row, like "Your modules", with a link to
  // all of them as a searchable list; up to 4, the lists by category as before.
  const slide = d.total > HOME_FORMS_LIST_MAX;
  mount(section, html`<div class="card-head"><h2 id="forms-heading">${icon('download')} Forms &amp; downloads</h2>
      <div class="sys-nav"><span class="muted small">Company-wide forms · always the latest version${slide ? html` · <a href="#/forms/home">All ${d.total}</a>` : ''}${d.manages ? html` · <a href="#/circulation/home">Document circulation</a>` : ''}</span>
        ${slide ? html`<span class="sys-arrows fm-arrows" hidden><button type="button" class="icon-btn" data-fm-prev aria-label="Previous forms" aria-controls="fm-track">${icon('chevronLeft', 18)}</button><button type="button" class="icon-btn" data-fm-next aria-label="More forms" aria-controls="fm-track">${icon('chevronRight', 18)}</button></span>` : ''}</div></div>
    ${!d.total ? html`<p class="muted">No company-wide forms yet. Upload one in <a href="#/circulation/home">Document circulation</a>.</p>`
      : slide ? html`<div class="sys-carousel fm-carousel"><ul class="sys-track fm-track" id="fm-track" role="region" aria-labelledby="forms-heading" tabindex="0">${d.categories.flatMap((c) => c.forms.map((f) => formCard(f, c.name)))}</ul></div>
        <div class="sys-dots fm-dots" hidden></div>`
      : html`<div class="form-groups home-forms">${formGroups(d.categories)}</div>`}`);
  if (slide) {
    const wrap = section.querySelector('.fm-carousel');
    carousel({ wrap, track: wrap.querySelector('.fm-track'), arrows: section.querySelector('.fm-arrows'), prev: section.querySelector('[data-fm-prev]'), next: section.querySelector('[data-fm-next]'), dots: section.querySelector('.fm-dots'), label: 'Forms' });
  }
}
// Up to this many company-wide forms show as lists on the home; more slide (0.75.1).
export const HOME_FORMS_LIST_MAX = 4;
// One form as a compact card in the home's sliding row.
function formCard(f, category) {
  const [, ic, kind] = kindOf(f.ext);
  return html`<li class="fm-card" data-form="${f.id}">
    <span class="fm-card-top"><span class="form-ic" aria-hidden="true">${icon(ic, 20)}</span><small class="muted fm-card-cat">${category}</small></span>
    <strong class="form-title fm-card-title" title="${f.title}">${f.title}</strong>
    ${f.code ? html`<span class="form-code">${f.code}</span>` : ''}
    ${f.description ? html`<small class="fm-card-desc" title="${f.description}">${f.description}</small>` : ''}
    <small class="muted fm-card-meta">${kind} · ${sizeLabel(f.size)} · ${day(f.updatedAt)}</small>
    <a class="btn small-btn fm-card-dl" href="/api/forms/${f.id}/file" download aria-label="Download ${f.title}">${icon('download', 15)} Download</a>
  </li>`;
}

// ----- Document circulation -----
const versionUrl = (f, no) => `/api/forms/manage/${f.id}/versions/${no}/file`;

export async function formsAdminView(el, params, query = {}) {
  const state = { module: params.module || query.module || '', category: '', status: '', audience: '', q: '' };
  const inPanel = location.hash.startsWith('#/admin/');
  let d;

  const load = async () => {
    d = await api.get('/api/forms/manage');
    if (state.module && !d.modules.some((m) => m.id === state.module)) state.module = '';
    draw();
  };
  const moduleOf = (id) => d.modules.find((m) => m.id === id);
  const roleName = (r) => d.roles.find((x) => x.id === r)?.label || r;
  const audienceShort = (f) => {
    if (f.everyone) return html`<small>Everyone who opens it</small>`;
    const all = f.audience.map(roleName).join(', ');
    if (f.audience.length <= 3) return html`<small>${all}</small>`;
    return html`<small title="${all}" aria-label="${all}">${f.audience.slice(0, 2).map(roleName).join(', ')} <span class="muted">+${f.audience.length - 2} more</span></small>`;
  };
  const shown = () => d.forms.filter((f) => (!state.module || f.module === state.module)
    && (!state.category || f.category === state.category)
    && (!state.status || f.status === state.status)
    && (!state.audience || f.audience.includes(state.audience))
    && (!state.q || `${f.title} ${f.code} ${f.category} ${f.description} ${f.current?.name || ''} ${f.current?.byName || ''}`.toLowerCase().includes(state.q.toLowerCase())));

  function draw() {
    const one = d.modules.length === 1 ? d.modules[0] : null;
    const total = d.forms.length;
    mount(el, html`
      <header class="page-head">
        <div><h1>${icon('folder', 22)} Document circulation</h1><p class="muted">${one
          ? `The forms and files ${one.name} gives its people to download. Upload a new version whenever a form changes: its users always get the latest, and the earlier ones stay here.`
          : 'Every form and file the company gives its people to download, in one place. Upload a new version whenever a form changes: users always get the latest, and the earlier ones stay here.'}</p></div>
        <div class="actions">${d.canSettings ? html`<button type="button" class="btn" id="fm-settings">${icon('settings', 16)} Settings</button>` : ''}
          <button type="button" class="btn primary" id="fm-upload">${icon('upload', 16)} Upload a form</button></div>
      </header>
      <div class="stats fm-stats" aria-label="Forms per module">
        ${d.modules.map((m) => html`<button type="button" class="card fm-stat ${state.module === m.id ? 'on' : ''}" data-module="${m.id}" aria-pressed="${state.module === m.id}">
          <small>${m.id === 'home' ? 'Company-wide' : m.name}</small><strong>${m.counts.published}</strong> <span class="fm-stat-word">published</span>
          <span class="fm-stat-more muted small">${m.counts.draft} draft · ${m.counts.retired} retired</span></button>`)}
      </div>
      <section class="card">
        <form class="toolbar fm-filters" id="fm-filter">
          <input type="search" name="q" placeholder="Search title, form code, file, uploader…" value="${state.q}" aria-label="Search forms" />
          ${d.modules.length > 1 ? html`<select name="module" aria-label="Module">${option('', 'All modules', !state.module)}${d.modules.map((m) => option(m.id, m.id === 'home' ? 'Company-wide (CORE home)' : m.name, state.module === m.id))}</select>` : ''}
          <select name="category" aria-label="Category">${option('', 'All categories', !state.category)}${[...new Set(d.forms.map((f) => f.category).filter(Boolean))].sort().map((c) => option(c, c, state.category === c))}</select>
          <select name="status" aria-label="Status">${[['', 'Any status'], ['published', 'Published'], ['draft', 'Draft'], ['retired', 'Retired']].map(([k, l]) => option(k, l, state.status === k))}</select>
          <select name="audience" aria-label="Who it is for">${option('', 'Anyone', !state.audience)}${d.roles.map((r) => option(r.id, r.label, state.audience === r.id))}</select>
        </form>
        <div id="fm-list"></div>
      </section>
      <p class="muted small">${total} form${total === 1 ? '' : 's'}. Users see only the current version of published forms, on each module's <strong>Forms &amp; downloads</strong> page (company-wide forms on the CORE home), and only the forms of the modules they open. Retired forms are hidden from users and kept here.${inPanel ? '' : ' Administrators also find this in the Admin panel.'}</p>`);
    drawList();
    el.querySelector('#fm-upload').addEventListener('click', () => uploadForm());
    el.querySelector('#fm-settings')?.addEventListener('click', settingsDialog);
    el.querySelectorAll('[data-module]').forEach((b) => b.addEventListener('click', () => {
      state.module = state.module === b.dataset.module ? '' : b.dataset.module;
      draw();
    }));
    const form = el.querySelector('#fm-filter');
    form.addEventListener('submit', (e) => e.preventDefault());
    form.addEventListener('change', (e) => {
      if (!e.target.name || e.target.name === 'q') return;
      state[e.target.name] = e.target.value;
      if (e.target.name === 'module') draw();
      else drawList();
    });
    form.querySelector('[name=q]').addEventListener('input', (e) => {
      state.q = e.target.value;
      drawList();
    });
  }

  function drawList() {
    const list = shown();
    const box = el.querySelector('#fm-list');
    if (!list.length) {
      return mount(box, html`<div class="empty">${icon('folder', 36)}<p>${d.forms.length ? 'No form matches these filters.' : 'No forms yet. Choose Upload a form to add the first one.'}</p></div>`);
    }
    mount(box, html`<div class="scroll-x"><table class="table fm-table">
      <thead><tr><th>Form</th><th>Module</th><th>Category</th><th>For</th><th>Status</th><th>Current version</th><th>Size</th><th>Versions</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${list.map((f) => html`<tr data-id="${f.id}">
        <td><strong>${f.title}</strong>${f.code ? html`<small class="block fm-code">${f.code}</small>` : ''}</td>
        <td>${f.module === 'home' ? 'Company-wide' : f.moduleName}</td>
        <td>${f.category || html`<span class="muted">—</span>`}</td>
        <td class="fm-aud">${audienceShort(f)}</td>
        <td>${badge(f.statusLabel, STATUS_BADGE[f.status])}</td>
        <td>${f.current ? html`<span class="fm-cur">${icon(kindOf(f.current.ext)[1], 15)} v${f.current.no}${f.current.restoredFrom ? html` <small class="muted">(from v${f.current.restoredFrom})</small>` : ''}</span>
          <small class="block"><strong>${f.current.byName}</strong> · ${when(f.current.at)}</small>${f.current.note ? html`<small class="block muted">${f.current.note}</small>` : ''}` : '—'}</td>
        <td class="nowrap">${f.current ? sizeLabel(f.current.size) : '—'}</td>
        <td>${f.versions.length ? html`<select class="fm-versions" data-versions="${f.id}" aria-label="Earlier versions of ${f.title}: choose one to download it">
            <option value="">${f.versions.length} earlier</option>
            ${f.versions.map((v) => html`<option value="${v.no}">v${v.no} · ${when(v.at)} · ${v.byName}${v.note ? ` · ${v.note}` : ''}</option>`)}</select>`
          : html`<span class="muted small">None yet</span>`}</td>
        <td class="fm-actions"><button type="button" class="btn small-btn" data-act="version" data-id="${f.id}" title="Upload a new version" aria-label="Upload a new version of ${f.title}">${icon('upload', 14)}<span class="fm-act-label">New version</span></button>
          <details class="fm-more"><summary class="btn small-btn" title="More: edit, restore, publish or retire" aria-label="More for ${f.title}">${icon('more', 14)}<span class="fm-act-label">More</span></summary>
            <div class="menu-pop fm-menu" role="menu">
              <button type="button" role="menuitem" data-act="edit" data-id="${f.id}">${icon('edit')} Edit details</button>
              <button type="button" role="menuitem" data-act="download" data-id="${f.id}">${icon('download')} Download current version</button>
              ${f.versions.length ? html`<button type="button" role="menuitem" data-act="restore" data-id="${f.id}">${icon('undo')} Restore a version</button>` : ''}
              ${f.status === 'draft' ? html`<button type="button" role="menuitem" data-act="publish" data-id="${f.id}">${icon('checkCircle')} Publish</button>` : ''}
              ${f.status === 'published' ? html`<button type="button" role="menuitem" data-act="retire" data-id="${f.id}">${icon('lock')} Retire</button>` : ''}
              ${f.status === 'retired' ? html`<button type="button" role="menuitem" data-act="unretire" data-id="${f.id}">${icon('eye')} Bring back</button>` : ''}
              ${f.deletable ? html`<button type="button" role="menuitem" class="danger-text" data-act="delete" data-id="${f.id}">${icon('trash')} Delete draft</button>` : ''}
            </div></details></td>
      </tr>`)}</tbody></table></div>`);
    box.querySelectorAll('[data-versions]').forEach((s) => s.addEventListener('change', () => {
      if (!s.value) return;
      const f = d.forms.find((x) => x.id === s.dataset.versions);
      download(versionUrl(f, s.value));
      toast(`Downloading version ${s.value} of ${f.title}.`);
      s.value = '';
    }));
    // One "More" menu open at a time.
    box.querySelectorAll('details.fm-more').forEach((dt) => dt.addEventListener('toggle', () => {
      if (dt.open) box.querySelectorAll('details.fm-more[open]').forEach((o) => o !== dt && (o.open = false));
    }));
    box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      b.closest('details')?.removeAttribute('open');
      act(b.dataset.act, d.forms.find((x) => x.id === b.dataset.id));
    }));
  }
  // A click elsewhere closes the open "More" menu.
  const closeMenus = (e) => {
    if (!e.target.closest?.('details.fm-more')) el.querySelectorAll('details.fm-more[open]').forEach((o) => (o.open = false));
  };
  document.addEventListener('click', closeMenus);

  async function act(what, f) {
    try {
      if (what === 'version') return uploadForm(f);
      if (what === 'edit') return detailsDialog(f);
      if (what === 'restore') return restoreDialog(f);
      if (what === 'download') return download(versionUrl(f, f.current.no));
      if (what === 'publish') {
        await api.post(`/api/forms/manage/${f.id}/publish`, {});
        toast(`${f.title} is published: its users can download it now.`);
      } else if (what === 'retire') {
        if (!(await confirmDialog(`Retire ${f.title}? It is hidden from users at once. It stays here with its versions, and you can bring it back.`, { confirmLabel: 'Retire', title: 'Retire this form', danger: false }))) return;
        await api.post(`/api/forms/manage/${f.id}/retire`, {});
        toast(`${f.title} is retired.`);
      } else if (what === 'unretire') {
        await api.post(`/api/forms/manage/${f.id}/unretire`, {});
        toast(`${f.title} is published again.`);
      } else if (what === 'delete') {
        if (!(await confirmDialog(`Delete the draft ${f.title} and its file${f.versionCount === 1 ? '' : 's'}? This cannot be undone.`, { confirmLabel: 'Delete draft' }))) return;
        await api.del(`/api/forms/manage/${f.id}`);
        toast(`${f.title} was deleted.`);
      }
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ----- Details -----
  const detailFields = (f = null) => {
    const moduleId = f?.module || state.module || d.modules[0].id;
    const everyone = f ? f.everyone : true;
    const chosen = f ? f.audience : d.roles.map((r) => r.id);
    return html`
      <label class="field"><span>Title</span><input name="title" maxlength="200" required value="${f?.title || ''}" placeholder="e.g. Leave application form" /></label>
      <div class="fm-pair">
        <label class="field"><span>Module</span><select name="module">${d.modules.map((m) => option(m.id, m.id === 'home' ? 'Company-wide (CORE home)' : m.name, m.id === moduleId))}</select></label>
        <label class="field"><span>Category</span><input name="category" maxlength="60" list="fm-cats" value="${f?.category || ''}" placeholder="e.g. Leave, Requests, Quotations" /><datalist id="fm-cats">${d.categories.map((c) => html`<option value="${c}"></option>`)}</datalist></label>
      </div>
      <label class="field"><span>Form code / revision <span class="muted">(optional)</span></span><input name="code" maxlength="60" value="${f?.code || ''}" placeholder="e.g. HR-F-012 Rev. 3" /><small class="hint">As your company numbers its controlled forms. Shown with the title.</small></label>
      <label class="field"><span>Description <span class="muted">(optional)</span></span><textarea name="description" rows="2" maxlength="1000" placeholder="What it is for, and where to hand it in">${f?.description || ''}</textarea></label>
      <fieldset class="field fm-aud-field"><legend>Who may see and download it</legend>
        <label class="field check"><input type="radio" name="who" value="everyone" ${everyone ? 'checked' : ''} /> <span><strong>Everyone who opens the module</strong> (for company-wide forms: everyone)</span></label>
        <label class="field check"><input type="radio" name="who" value="some" ${everyone ? '' : 'checked'} /> <span><strong>Only these account types</strong> (of those who open the module):</span></label>
        <div class="fm-checks" id="fm-aud" ${everyone ? 'hidden' : ''}>${d.roles.map((r) => html`<label class="field check fm-check"><input type="checkbox" name="aud" value="${r.id}" ${chosen.includes(r.id) ? 'checked' : ''} /> <span>${r.label}</span></label>`)}</div>
      </fieldset>`;
  };
  const wireDetails = (form) => {
    form.querySelectorAll('[name=who]').forEach((r) => r.addEventListener('change', () => {
      form.querySelector('#fm-aud').hidden = form.querySelector('[name=who]:checked').value === 'everyone';
    }));
  };
  const readDetails = (form) => {
    const v = (n) => form.querySelector(`[name=${n}]`)?.value || '';
    const everyone = form.querySelector('[name=who]:checked').value === 'everyone';
    return { title: v('title'), module: v('module'), category: v('category'), code: v('code'), description: v('description'), audience: everyone ? d.roles.map((r) => r.id) : [...form.querySelectorAll('[name=aud]:checked')].map((x) => x.value) };
  };

  // ----- Upload: a new form (f empty) or a new version of f -----
  function uploadForm(f = null) {
    const { form } = modal({
      title: f ? `New version of ${f.title}` : 'Upload a form',
      subtitle: f ? `Version ${f.versionCount + 1}. Users get it at once if the form is published; version ${f.current?.no || 1} stays in Versions.` : `PDF, Word, Excel, PowerPoint, OpenDocument, pictures or ZIP, up to ${d.settings.maxUploadMB} MB.`,
      wide: !f,
      submitLabel: f ? 'Upload version' : 'Upload',
      body: html`<div class="stack">
        <label class="field"><span>File</span><input type="file" name="file" accept="${d.accept}" required /><small class="hint">Programs, scripts, web pages, Office files with macros and password-protected files are never accepted.</small></label>
        ${f ? '' : detailFields()}
        <label class="field"><span>Change note <span class="muted">(optional)</span></span><input name="note" maxlength="300" placeholder="${f ? 'e.g. Signatories updated' : 'First version'}" /></label>
        ${f ? '' : html`<fieldset class="field fm-aud-field"><legend>When users see it</legend>
          <label class="field check"><input type="radio" name="status" value="draft" checked /> <span><strong>Keep as a draft</strong>: only the people who keep the forms see it; publish it later.</span></label>
          <label class="field check"><input type="radio" name="status" value="published" /> <span><strong>Publish now</strong>: its users can download it at once.</span></label></fieldset>`}
        <p class="muted small" id="fm-progress" role="status" hidden></p>
      </div>`,
      async onSubmit(frm) {
        const file = frm.querySelector('[name=file]').files[0];
        if (!file) throw new Error('Choose the file to upload.');
        if (file.size > d.settings.maxUploadMB * 1024 * 1024) throw new Error(`${file.name} is larger than ${d.settings.maxUploadMB} MB, the most a form may be.`);
        const note = frm.querySelector('[name=note]').value;
        const finish = f ? { formId: f.id, note } : { ...readDetails(frm), note, status: frm.querySelector('[name=status]:checked').value };
        if (!f && !finish.title) throw new Error('Give the form a title.');
        const progress = frm.querySelector('#fm-progress');
        progress.hidden = false;
        const base = '/api/forms/manage/uploads';
        const id = await uploadInPieces(base, file, file.name, (p) => (progress.textContent = p < 1 ? `Uploading… ${Math.round(p * 100)}%` : 'Checking the file…'));
        const row = await api.post(`${base}/${id}/finish`, finish);
        toast(f ? `Version ${row.current.no} of ${row.title} uploaded.` : `${row.title} uploaded${row.status === 'published' ? ' and published' : ' as a draft'}.`);
        await load();
      },
    });
    if (!f) wireDetails(form);
    // The title from the file's name, until one is typed.
    const title = form.querySelector('[name=title]');
    form.querySelector('[name=file]').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (title && file && !title.value) title.value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    });
  }

  function detailsDialog(f) {
    const { form } = modal({
      title: 'Edit details', subtitle: f.title, wide: true,
      body: html`<div class="stack">${detailFields(f)}</div>`,
      async onSubmit(frm) {
        await api.put(`/api/forms/manage/${f.id}`, readDetails(frm));
        toast('Details saved.');
        await load();
      },
    });
    wireDetails(form);
  }

  function restoreDialog(f) {
    modal({
      title: 'Restore a version', subtitle: f.title, submitLabel: 'Restore',
      body: html`<div class="stack">
        <p class="muted">The version you choose becomes current again as version ${f.versionCount + 1}, a copy of it. Nothing is removed: every version stays in the list.</p>
        <label class="field"><span>Version</span><select name="no">${f.versions.map((v, i) => option(v.no, `v${v.no} · ${when(v.at)} · ${v.byName}${v.note ? ` · ${v.note}` : ''}`, i === 0))}</select></label>
        <label class="field"><span>Change note <span class="muted">(optional)</span></span><input name="note" maxlength="300" placeholder="Restored from version …" /></label>
      </div>`,
      async onSubmit(frm) {
        const no = Number(frm.querySelector('[name=no]').value);
        const row = await api.post(`/api/forms/manage/${f.id}/restore`, { no, note: frm.querySelector('[name=note]').value });
        toast(`Version ${no} is current again, as version ${row.current.no}.`);
        await load();
      },
    });
  }

  function settingsDialog() {
    const s = d.settings;
    modal({
      title: 'Document circulation settings', subtitle: 'For every module\'s forms.',
      body: html`<div class="stack">
        <label class="field"><span>Largest file (MB)</span><input type="number" name="maxUploadMB" min="${s.range[0]}" max="${s.range[1]}" value="${s.maxUploadMB}" required /><small class="hint">${s.range[0]} to ${s.range[1]} MB. The default is 20.</small></label>
        <fieldset class="field fm-aud-field"><legend>File types accepted</legend><div class="fm-checks">
          ${s.familyLabels.map((x) => html`<label class="field check fm-check"><input type="checkbox" name="fam" value="${x.id}" ${s.families.includes(x.id) ? 'checked' : ''} /> <span>${x.label} <small class="muted">${x.exts.slice(0, 4).map((e) => `.${e}`).join(' ')}</small></span></label>`)}
        </div><small class="hint">Programs, scripts, web pages, Office files with macros and password-protected files are always refused.</small></fieldset>
      </div>`,
      async onSubmit(frm) {
        await api.put('/api/forms/settings', { maxUploadMB: Number(frm.querySelector('[name=maxUploadMB]').value), families: [...frm.querySelectorAll('[name=fam]:checked')].map((x) => x.value) });
        toast('Settings saved.');
        await load();
      },
    });
  }

  await load();
  return () => document.removeEventListener('click', closeMenus);
}
