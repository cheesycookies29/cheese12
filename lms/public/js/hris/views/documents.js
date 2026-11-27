// Applicants' documents (HRIS request PL-022, with PL-006 and PL-007; server/recruitment-docs.js):
//  - The applicant's checklist (an opening's page and their application): each document with its
//    note, Required or Optional, its status (Not yet uploaded, Uploaded, Accepted, Needs a new file
//    with HR's note), the files uploaded, and Upload, Replace and Remove while they may. Files go up
//    in pieces of 1 MB; a refused file says why and what to do (too large, a program, the wrong type).
//  - HR's review of one application's documents: download each file, mark each item Accepted or
//    Needs a new file (with a note to the applicant, on the bell). Assessors read the same page.
//  - The requirements editor (an opening's form, and the default checklists in HR settings) and the
//    Applicant documents card of HR settings (the upload policy).
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, fmtDate, fmtDateTime, badge, toast, modal, confirmDialog, today } from '../../ui.js';
import {
  sizeText, sizeMessage, countMessage, docStatusKind, completenessText, allowedExts, typeMessage, POLICY_LIMITS, CHECKLIST_NOTE, MB,
} from '/shared/recruitment-docs.js';

const localDay = (iso) => today(new Date(iso));
const statusBadge = (it) => badge(it.statusLabel, docStatusKind(it.status));

// ----- Uploading one file in pieces -----
const toBase64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
async function uploadFile(openingId, reqId, file, { replace = null, renew = false, policy, count }) {
  // The same checks as the server, first, so a big file is not sent for nothing.
  if (file.size > policy.maxMb * MB) throw new Error(sizeMessage(file.size, policy.maxMb));
  const ext = (file.name.match(/\.([A-Za-z0-9]{1,12})$/)?.[1] || '').toLowerCase();
  if (ext && !allowedExts(policy).includes(ext)) throw new Error(`${file.name}: ${typeMessage(policy)}`);
  if (!replace && !renew && count >= policy.maxFiles) throw new Error(countMessage(policy.maxFiles));
  const base = `/api/hris/jobs/${openingId}/documents/uploads`;
  const up = await api.post(base, { reqId, name: file.name, size: file.size, ...(replace ? { replace } : {}) });
  try {
    for (let at = 0; at < file.size; at += up.chunkBytes) {
      const piece = await file.slice(at, at + up.chunkBytes).arrayBuffer();
      await api.put(`${base}/${up.id}`, { offset: at, data: toBase64(piece) });
    }
    return await api.post(`${base}/${up.id}/finish`, {});
  } catch (err) {
    api.del(`${base}/${up.id}`).catch(() => {});
    throw err;
  }
}

// ----- The applicant's checklist -----
// el: where it goes; openingId; title: the card's heading. Calls onChange(view) after each change.
export async function documentsCard(el, openingId, { onChange = () => {}, compact = false } = {}) {
  let v = await api.get(`/api/hris/jobs/${openingId}/documents`);
  if (!v.requirements.length) return mount(el, '');
  const errors = {};
  const fileRow = (it, f) => html`<li class="doc-file">
    <a href="/api/hris/jobs/${openingId}/documents/files/${f.id}" download>${icon('file', 14)} ${f.name}</a>
    <span class="muted small">${sizeText(f.size)} · ${fmtDate(localDay(f.at))}</span>
    ${it.canUpload && v.open ? html`<span class="doc-file-tools"><label class="btn sm ghost">${icon('upload', 14)} Replace<input type="file" class="sr-only" data-replace="${f.id}" data-req="${it.id}" accept="${v.policy.accept}" /></label><button type="button" class="btn sm ghost danger" data-remove="${f.id}">Remove</button></span>` : ''}
  </li>`;
  const draw = () => mount(el, html`<section class="card docs-card" id="docs-card">
    <div class="card-head"><h2>${icon('file')} Your documents</h2>${badge(completenessText(v.completeness), v.completeness.complete ? 'green' : 'amber')}</div>
    <p class="small muted">${v.policy.line}${v.requireBeforeApply && !v.applied ? ' The required documents must be uploaded before you can apply.' : v.applied ? '' : ' You can apply before every required document is uploaded, and add them until the opening closes.'}</p>
    ${!v.canChange && v.closedWhy ? html`<div class="notice">${icon('lock', 16)}<p>${v.closedWhy}${v.requirements.some((it) => it.canUpload) ? ' You can still upload the new file HR asked for.' : ''}</p></div>` : ''}
    <ul class="docs-list">${v.requirements.map((it) => html`<li class="doc-item status-${it.status}" data-item="${it.id}">
      <div class="doc-head"><span class="grow"><strong>${it.name}</strong> ${it.required ? badge('Required', 'brand') : badge('Optional', 'gray')}${it.note ? html`<small class="block muted">${it.note}</small>` : ''}</span>${statusBadge(it)}</div>
      ${it.status === 'needs-new' && it.review?.note ? html`<p class="doc-hr-note">${icon('comment', 14)} <strong>Note from ${it.review.from || 'HR office'}</strong> (${fmtDate(localDay(it.review.at))}): ${it.review.note}</p>` : ''}
      ${it.files.length ? html`<ul class="doc-files">${it.files.map((f) => fileRow(it, f))}</ul>` : ''}
      ${it.canUpload ? (it.status === 'needs-new'
        ? html`<label class="btn sm primary doc-upload">${icon('upload', 14)} Upload the new file<input type="file" class="sr-only" data-upload="${it.id}" data-renew="1" accept="${v.policy.accept}" aria-label="Upload the new file for ${it.name}" /></label><small class="block muted doc-renew-hint">It replaces the file${it.files.length === 1 ? '' : 's'} HR sent back.</small>`
        : html`<label class="btn sm ${it.files.length ? '' : 'primary'} doc-upload">${icon('upload', 14)} ${it.files.length ? 'Add another file' : 'Upload'}<input type="file" class="sr-only" multiple data-upload="${it.id}" accept="${v.policy.accept}" aria-label="Upload ${it.name}" /></label>`) : ''}
      <p class="doc-progress small muted" data-progress="${it.id}" hidden></p>
      ${errors[it.id] ? html`<div class="notice error doc-error" role="alert">${icon('alert', 16)}<div><p>${errors[it.id]}</p>${/ MB|files\b.*at most|combine/.test(errors[it.id]) && v.policy.help ? html`<details open><summary>How to make a file smaller or split it</summary><p class="small">${v.policy.help}</p></details>` : ''}</div></div>` : ''}
    </li>`)}</ul>
    ${compact ? '' : html`<details class="doc-help"><summary>${icon('help', 14)} File too large? How to compress or split a file</summary><p class="small">${v.policy.help}</p></details>`}
  </section>`);
  const refresh = (next) => {
    v = next;
    draw();
    wire();
    onChange(v);
  };
  const busy = (reqId, text) => {
    const p = el.querySelector(`[data-progress="${reqId}"]`);
    if (p) Object.assign(p, { hidden: !text, textContent: text || '' });
  };
  const send = async (reqId, files, replace = null, renew = false) => {
    delete errors[reqId];
    let next = null;
    for (const file of files) {
      busy(reqId, `Uploading ${file.name} (${sizeText(file.size)})…`);
      try {
        next = await uploadFile(openingId, reqId, file, { replace, renew: renew && !next, policy: v.policy, count: (next || v).count });
        toast(`${file.name} uploaded.`);
      } catch (err) {
        errors[reqId] = err.message;
        break;
      }
    }
    busy(reqId, '');
    refresh(next || v);
  };
  const wire = () => {
    el.querySelectorAll('[data-upload]').forEach((inp) => inp.addEventListener('change', () => send(inp.dataset.upload, inp.dataset.renew ? [...inp.files].slice(0, 1) : [...inp.files], null, Boolean(inp.dataset.renew))));
    el.querySelectorAll('[data-replace]').forEach((inp) => inp.addEventListener('change', () => send(inp.dataset.req, [...inp.files].slice(0, 1), inp.dataset.replace)));
    el.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      const it = v.requirements.find((x) => x.files.some((f) => f.id === b.dataset.remove));
      const f = it.files.find((x) => x.id === b.dataset.remove);
      if (!(await confirmDialog(`Remove ${f.name} from ${it.name}?`, { confirmLabel: 'Remove', title: 'Remove file' }))) return;
      try {
        refresh(await api.del(`/api/hris/jobs/${openingId}/documents/files/${f.id}`));
        toast('File removed.');
      } catch (err) {
        errors[it.id] = err.message;
        draw();
        wire();
      }
    }));
  };
  draw();
  wire();
  return v;
}

// ----- HR's review of one application's documents (and the assessors' read-only view) -----
export async function documentsReviewView(el, { id, appId }, _query = {}, { board = false } = {}) {
  const v = await api.get(`/api/hris/recruitment/applications/${appId}/documents`);
  const a = v.application;
  const base = board ? `/assess/${id}` : `/recruitment/${id}`;
  const crumbs = board ? [['/assess', 'Ratings to do'], [base, v.opening.title]] : [['/recruitment', 'Job openings'], [base, v.opening.title]];
  mount(el, html`
    ${pageHead(`Documents of ${a.name}`, html`${v.opening.title} · ${a.internal ? badge('Internal', 'brand') : badge('External', 'blue')} · ${a.stageLabel}`, v.summary ? badge(completenessText(v.summary), v.summary.complete ? 'green' : 'amber') : '', crumbs)}
    ${v.readOnly ? html`<div class="notice info">${icon('lock', 16)}<p>As an assessor you can open and download the documents. HR checks them and tells the applicant.</p></div>` : html`<div class="notice info">${icon('help', 16)}<p>Open each file, then mark the document <strong>Accepted</strong>, or <strong>Needs a new file</strong> with a note: the applicant is told on the bell and can upload a new one${v.opening.open ? '' : ', even though the opening has closed'}. ${v.opening.open ? 'Until the opening closes, the applicant can also replace or remove files.' : ''}</p></div>`}
    ${v.requirements.length ? html`<section class="card"><ul class="docs-list review">${v.requirements.map((it) => html`<li class="doc-item status-${it.status}" data-item="${it.id}">
      <div class="doc-head"><span class="grow"><strong>${it.name}</strong> ${it.required ? badge('Required', 'brand') : badge('Optional', 'gray')}${it.note ? html`<small class="block muted">${it.note}</small>` : ''}</span>${statusBadge(it)}</div>
      ${it.files.length ? html`<ul class="doc-files">${it.files.map((f) => html`<li class="doc-file"><a href="/api/hris/recruitment/documents/${f.id}" download>${icon('download', 14)} ${f.name}</a><span class="muted small">${sizeText(f.size)} · uploaded ${fmtDateTime(f.at)}</span></li>`)}</ul>` : html`<p class="muted small">No file yet.</p>`}
      ${it.review ? html`<p class="small muted">${it.review.status === 'accepted' ? 'Accepted' : 'Asked for a new file'}${it.review.by ? ` by ${it.review.by}` : ''} on ${fmtDateTime(it.review.at)}${it.review.note ? html`: <em>${it.review.note}</em>` : ''}</p>` : ''}
      ${v.readOnly || a.status === 'withdrawn' ? '' : html`<div class="actions">
        ${it.files.length && it.status !== 'accepted' ? html`<button class="btn sm primary" data-accept="${it.id}">${icon('check', 14)} Accept</button>` : ''}
        ${it.status !== 'needs-new' ? html`<button class="btn sm" data-needs="${it.id}">Needs a new file…</button>` : ''}
        ${it.review ? html`<button class="btn sm ghost" data-clear="${it.id}">Clear the review</button>` : ''}
      </div>`}
    </li>`)}</ul></section>` : html`<div class="card empty">${icon('file', 40)}<h2>No checklist</h2><p>This opening asks for no documents. Add them to its checklist: Edit the opening.</p></div>`}`);
  const reload = () => documentsReviewView(el, { id, appId }, _query, { board });
  const review = (reqId, status, note = '') => api.put(`/api/hris/recruitment/applications/${appId}/documents/${reqId}`, { status, note });
  el.querySelectorAll('[data-accept]').forEach((b) => b.addEventListener('click', async () => {
    await review(b.dataset.accept, 'accepted');
    toast('Accepted. The applicant was told on the bell.');
    reload();
  }));
  el.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', async () => {
    await review(b.dataset.clear, '');
    toast('The review was cleared.');
    reload();
  }));
  el.querySelectorAll('[data-needs]').forEach((b) => b.addEventListener('click', () => {
    const it = v.requirements.find((x) => x.id === b.dataset.needs);
    modal({
      title: 'Ask for a new file',
      subtitle: `${it.name} · ${a.name}`,
      submitLabel: 'Ask and tell the applicant',
      body: html`<label class="field"><span>Note to the applicant<em>*</em></span><textarea name="note" rows="3" maxlength="${POLICY_LIMITS.reviewNote}" required placeholder="e.g. The scan is cut off at the bottom: please upload a full scan of each page."></textarea><span class="hint">They read it on the bell and beside the document, from "HR office".</span></label>`,
      async onSubmit(f) {
        await review(it.id, 'needs-new', f.note.value);
        toast('The applicant was asked for a new file, on the bell.');
        reload();
      },
    });
  }));
}

// ----- The requirements editor: name, short note, Required or Optional -----
// Draws into `box`; returns { get() } with the list as typed.
export function requirementsEditor(box, initial, { onEdit = () => {} } = {}) {
  let list = (initial || []).map((x) => ({ ...x }));
  const read = () => box.querySelectorAll('[data-r]').forEach((li) => Object.assign(list[Number(li.dataset.r)], {
    name: li.querySelector('[name=r-name]').value, note: li.querySelector('[name=r-note]').value, required: li.querySelector('[name=r-required]').checked,
  }));
  const draw = () => {
    mount(box, html`<ol class="req-list">${list.map((x, i) => html`<li class="req-row" data-r="${i}">
      <label class="field"><span>Document</span><input name="r-name" value="${x.name}" maxlength="${POLICY_LIMITS.name}" placeholder="e.g. Transcript of records" required /></label>
      <label class="field"><span>Short note for the applicant</span><input name="r-note" value="${x.note}" maxlength="${POLICY_LIMITS.note}" placeholder="e.g. For every degree you list." /></label>
      <label class="check-inline req-required"><input type="checkbox" name="r-required" ${x.required ? 'checked' : ''} /> Required</label>
      <span class="req-tools">
        <button type="button" class="icon-btn" data-rup aria-label="Move ${x.name || 'this document'} up" ${i === 0 ? 'disabled' : ''}>${icon('up', 16)}</button>
        <button type="button" class="icon-btn" data-rdown aria-label="Move ${x.name || 'this document'} down" ${i === list.length - 1 ? 'disabled' : ''}>${icon('down', 16)}</button>
        <button type="button" class="icon-btn" data-rremove aria-label="Remove ${x.name || 'this document'}">${icon('trash', 16)}</button>
      </span>
    </li>`)}</ol>
    ${list.length ? '' : html`<p class="muted small">No documents asked for.</p>`}
    <p><button type="button" class="btn sm" data-radd>${icon('plus', 14)} Add a document</button></p>`);
    const act = (sel, fn) => box.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => {
      read();
      fn(Number(b.closest('[data-r]')?.dataset.r));
      draw();
      onEdit();
    }));
    act('[data-rup]', (i) => ([list[i - 1], list[i]] = [list[i], list[i - 1]]));
    act('[data-rdown]', (i) => ([list[i + 1], list[i]] = [list[i], list[i + 1]]));
    act('[data-rremove]', (i) => list.splice(i, 1));
    act('[data-radd]', () => list.push({ id: '', name: '', note: '', required: true }));
    box.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', onEdit));
  };
  draw();
  return {
    get: () => {
      read();
      return list.map(({ id, name, note, required }) => ({ ...(id ? { id } : {}), name, note, required: Boolean(required) }));
    },
    set: (next) => {
      list = (next || []).map((x) => ({ ...x }));
      draw();
    },
  };
}

// ----- HR settings → Applicant documents: the upload policy and the default checklists -----
export async function applicantDocsCard(el) {
  const v = await api.get('/api/hris/recruitment/documents-settings');
  mount(el, html`<section class="card" id="applicant-documents">
    <div class="card-head"><h2>Applicant documents</h2><span class="muted small">What applicants upload with an application</span></div>
    <p class="muted small">The upload policy applies to every applicant and employee applying. ATLAS works out what a file is from the file itself, never its name, and always refuses programs, scripts, web pages, Office files with macros and password-protected files.</p>
    <form id="docs-settings" novalidate>
      <h3>Upload policy</h3>
      <div class="field"><span>File types allowed</span><div class="days docs-types">${v.uploadTypes.map((x) => html`<label><input type="checkbox" name="types" value="${x.id}" ${v.types.includes(x.id) ? 'checked' : ''} /> ${x.label}</label>`)}</div><span class="hint">All four by default.</span></div>
      <div class="grid">
        <label class="field"><span>Largest file (MB)</span><input type="number" name="maxMb" min="${v.limits.maxMb[0]}" max="${v.limits.maxMb[1]}" value="${v.maxMb}" /><span class="hint">${v.limits.maxMb[0]} to ${v.limits.maxMb[1]}; 2 MB by default.</span></label>
        <label class="field"><span>Most files per application</span><input type="number" name="maxFiles" min="${v.limits.maxFiles[0]}" max="${v.limits.maxFiles[1]}" value="${v.maxFiles}" /><span class="hint">${v.limits.maxFiles[0]} to ${v.limits.maxFiles[1]}; 15 by default.</span></label>
        <label class="field span-3"><span>Help on compressing and splitting files</span><textarea name="help" rows="3" maxlength="${v.limits.help}">${v.help}</textarea><span class="hint">Shown beside the upload buttons and with a file that is too large.</span></label>
      </div>
      <h3>Default checklists</h3>
      <p class="muted small">Per position category: a new opening copies its category's list, and HR can change it on the opening.</p>
      ${v.categories.map((c) => html`<section class="as-tpl docs-cat" data-cat="${c.id}"><div class="card-head"><h4>${c.label}</h4>${v.examples.includes(c.id) ? badge('Example', 'amber') : ''}</div>${v.examples.includes(c.id) ? html`<p class="small as-example">${icon('alert', 14)} ${CHECKLIST_NOTE}</p>` : ''}<div data-editor></div></section>`)}
      <p class="form-error" hidden></p>
      <div class="actions end"><button class="btn primary" type="submit">Save applicant documents</button></div>
    </form>
  </section>`);
  const editors = Object.fromEntries(v.categories.map((c) => [c.id, requirementsEditor(el.querySelector(`[data-cat="${c.id}"] [data-editor]`), v.checklists[c.id] || [])]));
  const form = el.querySelector('#docs-settings');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const errEl = form.querySelector('.form-error');
    try {
      await api.put('/api/hris/recruitment/documents-settings', {
        types: fd.getAll('types'), maxMb: Number(fd.get('maxMb')), maxFiles: Number(fd.get('maxFiles')), help: fd.get('help'),
        checklists: Object.fromEntries(Object.entries(editors).map(([k, ed]) => [k, ed.get()])),
      });
      errEl.hidden = true;
      toast('Applicant documents saved.');
      applicantDocsCard(el);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      errEl.scrollIntoView({ block: 'center' });
    }
  });
}
