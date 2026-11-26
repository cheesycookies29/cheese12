// Forms & downloads: the forms and files a system gives its people, kept in Document circulation
// (server/forms.js). Each app adds one sidebar item for it (route /forms); the ATLAS home shows its
// school-wide forms on the home page, and the public ones on its signed-out Forms page. Only the
// current published version is listed; earlier versions are for the people who keep the forms.
import { api } from './api.js';
import { html, mount, fmtDate, fmtSize } from './ui.js';
import { icon } from './icons.js';
import { pageHead } from './shell.js';

// The styles of these pages and of Document circulation (public/css/forms.css), loaded once.
export function formsCss() {
  if (document.getElementById('forms-css')) return;
  document.head.append(Object.assign(document.createElement('link'), { id: 'forms-css', rel: 'stylesheet', href: '/css/forms.css' }));
}

const KIND = [
  [['pdf'], 'filePdf', 'PDF'], [['doc', 'docx', 'dot', 'dotx', 'odt', 'ott', 'rtf'], 'file', 'Word'], [['xls', 'xlsx', 'xlt', 'xltx', 'ods', 'ots'], 'table', 'Spreadsheet'],
  [['ppt', 'pptx', 'pps', 'ppsx', 'pot', 'potx', 'odp', 'otp'], 'slides', 'Slides'], [['jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff', 'bmp', 'heic', 'heif'], 'image', 'Picture'], [['zip'], 'box', 'ZIP'],
];
export const kindOf = (ext) => KIND.find(([exts]) => exts.includes(ext)) || [[], 'file', String(ext || '').toUpperCase()];
const day = (iso) => fmtDate(String(iso || '').slice(0, 10));

// One list of forms, by category. href(form) → where its Download button goes.
export function formGroups(categories, href) {
  return html`${categories.map((c) => html`<section class="card form-group" data-group>
    <h2 class="form-group-title">${c.name}</h2>
    <ul class="form-list">${c.forms.map((f) => {
      const [, ic, kind] = kindOf(f.ext);
      return html`<li class="form-item" data-form="${f.id}" data-text="${`${f.title} ${f.code} ${f.description} ${c.name}`.toLowerCase()}">
        <span class="form-ic" aria-hidden="true">${icon(ic, 20)}</span>
        <span class="grow"><strong class="form-title">${f.title}</strong>${f.code ? html` <span class="form-code">${f.code}</span>` : ''}
          ${f.description ? html`<small class="form-desc">${f.description}</small>` : ''}
          <small class="muted form-meta">Updated ${day(f.updatedAt)} · ${kind} · ${fmtSize(f.size)}</small></span>
        <a class="btn sm" href="${href(f)}" download aria-label="Download ${f.title}">${icon('download', 15)} Download</a>
      </li>`;
    })}</ul></section>`)}`;
}

// A search box over the lists (by title, form code, description or category).
export function wireSearch(root) {
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

// The page: /forms in Learn, Academic, People, Finance and Tools. moduleId: shared/forms.js FORM_MODULES.
export async function formsView(el, moduleId) {
  formsCss();
  const d = await api.get(`/api/forms?module=${encodeURIComponent(moduleId)}`);
  mount(el, html`${pageHead('Forms & downloads', `The forms and files ${d.moduleName} gives you, always the latest version. Download one, fill it in, and hand it in where it says.`)}
    ${d.total ? html`<div class="toolbar"><input type="search" data-form-search placeholder="Search forms…" aria-label="Search forms" /></div>
      <div class="form-groups">${formGroups(d.categories, (f) => `/api/forms/${f.id}/file`)}</div>
      <p class="muted" data-form-none hidden>No form matches.</p>`
    : html`<div class="card empty">${icon('folder', 40)}<h2>No forms here yet</h2><p>When the office that keeps ${d.moduleName}'s forms publishes one for you, it shows here.</p></div>`}`);
  wireSearch(el);
}
