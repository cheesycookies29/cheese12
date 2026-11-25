// The Share dialog of a document or a folder: who inside the school may open it (people, account
// types, departments, everyone signed in), at which level, and links for people outside the school.
// The server refuses anything the person may not give (more than they hold, groups for students,
// links for students), and says why.
import { api } from '../../api.js';
import { ctx } from '../../shell.js';
import { html, mount, modal, toast, option, fmtDateTime, badge, confirmDialog } from '../../ui.js';
import { icon } from '../../icons.js';
import { docs, isStudent, LEVEL_LABEL, MODE_LABEL, LINK_STATE } from '../state.js';

const RANK = { view: 1, edit: 2, manage: 3 };

// item: a document (kind 'document') or folder (kind 'folder') as the server sends it (with acl and
// links when the person manages it). onDone(): redraw the page.
export function openShare(item, kind, onDone) {
  const m = docs.meta;
  const manage = item.level === 'manage' && !(kind === 'folder' && item.personal && !item.parentId);
  let grants = (item.acl || []).map((g) => ({ ...g }));
  let inherit = item.inherit !== false;
  const levels = ['view', 'edit', 'manage'].filter((l) => RANK[l] <= RANK[item.level]);
  const restricted = kind === 'document' && item.classification === 'restricted';
  const linkable = m.sharing.links && item.canShare && !restricted && (kind === 'folder' || m.sharing.classifications.includes(item.classification));

  const { form, close } = modal({
    title: `Share “${kind === 'document' ? item.title : item.name}”`,
    subtitle: kind === 'folder' ? 'People given access to a folder can open everything inside it.' : `${item.number} · ${item.name}`,
    wide: true,
    submitLabel: manage ? 'Save access' : null,
    body: html`
      ${manage ? html`<section class="share-section">
        <h3>People in the school</h3>
        ${!m.sharing.internal ? html`<div class="notice">${icon('lock')}<p>Sharing inside the school is turned off in Document control.</p></div>` : ''}
        <div id="grant-list"></div>
        <div class="share-add">
          <label class="field"><span>Add a person</span><input type="search" id="person-q" placeholder="Type a name or username" autocomplete="off" /></label>
          <div class="person-hits" id="person-hits" role="listbox" aria-label="People found"></div>
          ${m.sharing.groups && !restricted ? html`<div class="share-groups">
            <label class="field"><span>Or a whole account type</span><select id="add-role"><option value="">Choose…</option>${m.roles.map((r) => option(r.id, r.label))}</select></label>
            ${m.departments.length ? html`<label class="field"><span>Or a department</span><select id="add-dept"><option value="">Choose…</option>${m.departments.map((d) => option(d, d))}</select></label>` : ''}
            ${m.sharing.everyone && !restricted ? html`<button type="button" class="btn" id="add-everyone">${icon('users', 16)} Everyone signed in</button>` : ''}
          </div>` : html`<p class="hint">Students share with named people: your teachers, and classmates in your sections.</p>`}
        </div>
        ${kind === 'folder' && item.parentId ? html`<label class="field check"><input type="checkbox" id="inherit" ${inherit ? 'checked' : ''} /> <span>Also let in the people who have access to the folders above</span></label>` : ''}
        ${restricted ? html`<p class="hint">${icon('lock', 14)} Restricted: named people only (sharing the folder it is in does not reach it), and only people who manage it open or download the file.</p>` : ''}
      </section>` : html`<p class="muted">You can see this but not change who has access. ${item.ownerName ? `Ask ${item.ownerName}.` : ''}</p>`}
      <section class="share-section">
        <h3>Links for people outside the school</h3>
        <div id="link-area"></div>
      </section>`,
    async onSubmit() {
      const body = { grants: grants.map(({ type, id, level, download, share, until }) => ({ type, id, level, download, share, until })) };
      if (kind === 'folder') body.inherit = form.querySelector('#inherit') ? form.querySelector('#inherit').checked : inherit;
      await api.put(`/api/docs/${kind === 'document' ? 'documents' : 'folders'}/${item.id}/access`, body);
      toast('Access saved.');
      onDone?.();
    },
  });

  const drawGrants = () => {
    const el = form.querySelector('#grant-list');
    if (!el) return;
    mount(el, grants.length ? html`<ul class="grant-list">${grants.map((g, i) => html`<li>
      <span class="grant-who">${icon(g.type === 'user' ? 'user' : g.type === 'everyone' ? 'users' : g.type === 'role' ? 'shield' : 'building', 16)} <span>${g.label}</span></span>
      <select data-level="${i}" aria-label="Access for ${g.label}">${levels.map((l) => option(l, LEVEL_LABEL[l], l === g.level))}</select>
      <label class="check-inline"><input type="checkbox" data-download="${i}" ${g.download !== false ? 'checked' : ''} ${g.level !== 'view' ? 'disabled' : ''} /> Download</label>
      ${!isStudent() ? html`<label class="check-inline"><input type="checkbox" data-reshare="${i}" ${g.share || g.level === 'manage' ? 'checked' : ''} ${g.level === 'manage' ? 'disabled' : ''} /> Share on</label>` : ''}
      <button type="button" class="icon-btn danger" data-remove="${i}" aria-label="Remove ${g.label}">${icon('x', 16)}</button>
    </li>`)}</ul>` : html`<p class="muted small">Only ${item.ownerId === ctx.user.id ? 'you' : item.ownerName} and document managers${kind === 'document' ? ', and the people who have access to its folder,' : ''} can open it.</p>`);
  };
  const add = (g) => {
    if (grants.some((x) => x.type === g.type && x.id === g.id)) return toast(`${g.label} is already in the list.`);
    grants.push({ level: 'view', download: true, share: false, ...g });
    drawGrants();
  };
  if (manage) {
    drawGrants();
    form.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.level) {
        grants[t.dataset.level].level = t.value;
        drawGrants();
      } else if (t.dataset.download) grants[t.dataset.download].download = t.checked;
      else if (t.dataset.reshare) grants[t.dataset.reshare].share = t.checked;
      else if (t.id === 'add-role' && t.value) {
        add({ type: 'role', id: t.value, label: `Every ${t.selectedOptions[0].textContent} (account type)` });
        t.value = '';
      } else if (t.id === 'add-dept' && t.value) {
        add({ type: 'department', id: t.value, label: `${t.value} (department)` });
        t.value = '';
      } else if (t.id === 'inherit') inherit = t.checked;
    });
    form.addEventListener('click', (e) => {
      const r = e.target.closest('[data-remove]');
      if (r) {
        grants.splice(Number(r.dataset.remove), 1);
        drawGrants();
      }
      const p = e.target.closest('[data-person]');
      if (p) {
        add({ type: 'user', id: p.dataset.person, label: p.dataset.label });
        form.querySelector('#person-q').value = '';
        mount(form.querySelector('#person-hits'), '');
      }
      if (e.target.closest('#add-everyone')) add({ type: 'everyone', id: '*', label: 'Everyone signed in' });
    });
    let timer = null;
    const q = form.querySelector('#person-q');
    q.addEventListener('keydown', (e) => e.key === 'Enter' && e.preventDefault());
    q.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const hits = form.querySelector('#person-hits');
        if (q.value.trim().length < 2) return mount(hits, '');
        const { people } = await api.get(`/api/docs/people?q=${encodeURIComponent(q.value.trim())}`);
        mount(hits, people.length ? html`${people.map((p) => html`<button type="button" class="person-hit" role="option" data-person="${p.id}" data-label="${p.name} (${p.roleLabel})">${icon('user', 16)} <span><strong>${p.name}</strong><small>${p.roleLabel}${p.department ? ` · ${p.department}` : ''}</small></span>${icon('plus', 16)}</button>`)}` : html`<p class="muted small">No one found by that name.</p>`);
      }, 250);
    });
  }

  // ----- Links -----
  let links = item.links || [];
  const drawLinks = (made = null) => {
    const el = form.querySelector('#link-area');
    if (isStudent()) return mount(el, html`<p class="muted small">${icon('lock', 14)} Students do not make links for people outside the school. Share with a teacher or classmate above instead.</p>`);
    if (!m.sharing.links) return mount(el, html`<p class="muted small">Links for people outside the school are turned off, or made only by document managers (Document control).</p>`);
    if (restricted) return mount(el, html`<p class="muted small">${icon('lock', 14)} Restricted documents are never shared by link.</p>`);
    if (!linkable) return mount(el, html`<p class="muted small">${item.canShare ? `${item.classification[0].toUpperCase()}${item.classification.slice(1)} documents are not shared by link here (Document control).` : 'You can see this but not share it by link. Ask the person who manages it.'}</p>`);
    const needPw = m.sharing.passwordRequired || (kind === 'document' && item.classification === 'confidential');
    const modes = kind === 'folder' ? ['view', 'download', ...(m.sharing.uploadLinks && ['edit', 'manage'].includes(item.level) ? ['upload'] : [])] : ['view', ...(item.canDownload ? ['download'] : [])];
    mount(el, html`
      ${made ? html`<div class="notice ok link-made">${icon('checkCircle')}<div><p><strong>Link made.</strong> Copy it now and send it: for safety, ATLAS shows it only this once.</p>
        <div class="copy-row"><input readonly value="${made}" id="made-url" aria-label="The new link" /><button type="button" class="btn sm primary" id="copy-url">${icon('clipboard', 14)} Copy</button></div></div></div>` : ''}
      ${links.length ? html`<ul class="link-list doc-links">${links.map((l) => {
        const [st, kindOf] = LINK_STATE[l.state] || [l.state, 'gray'];
        return html`<li><span>${icon('link', 16)} <strong>…${l.hint}</strong> ${MODE_LABEL[l.mode]} ${badge(st, kindOf)}${l.hasPassword ? html` ${badge('Password', 'blue')}` : ''}
          <small class="muted block">Until ${fmtDateTime(l.expiresAt)} · ${l.opens ? `opened ${l.opens} time(s)` : 'not opened yet'}${l.mode === 'download' ? ` · ${l.downloads}${l.maxDownloads ? ` of ${l.maxDownloads}` : ''} download(s)` : ''}${l.mode === 'upload' ? ` · ${l.uploads} file(s) received` : ''} · by ${l.createdByName}${l.note ? ` · “${l.note}”` : ''}</small></span>
          <button type="button" class="btn sm danger ghost" data-revoke="${l.id}">Turn off</button></li>`;
      })}</ul>` : html`<p class="muted small">No links yet.</p>`}
      <details class="make-link" ${made || links.length ? '' : 'open'}><summary>${icon('plus', 14)} Make a link</summary>
        <div class="grid two">
          <label class="field"><span>What the link allows</span><select id="link-mode">${modes.map((x) => option(x, MODE_LABEL[x], x === (kind === 'folder' ? 'view' : 'download')))}</select></label>
          <label class="field"><span>Works for (days)</span><input type="number" id="link-days" min="1" max="${m.sharing.maxDays}" value="${m.sharing.defaultDays}" /><span class="hint">1 to ${m.sharing.maxDays} days.</span></label>
          <label class="field"><span>Password ${needPw ? html`<em>*</em>` : '(optional)'}</span><input type="text" id="link-pw" autocomplete="off" spellcheck="false" placeholder="At least ${m.sharing.passwordMin} characters" /><span class="hint">${needPw ? (m.sharing.passwordRequired ? 'Every link needs a password here.' : 'Confidential documents need a password.') : 'Send the password separately (by text or phone), not with the link.'}</span></label>
          <label class="field" id="max-dl"><span>Most downloads (0 = no limit)</span><input type="number" id="link-max" min="0" value="${m.sharing.maxDownloads || 0}" /></label>
          <label class="field span-2"><span>Note for the person (optional)</span><input id="link-note" maxlength="200" placeholder="e.g. Signed contract for your records" /></label>
        </div>
        <div class="actions end"><button type="button" class="btn primary" id="make-link">${icon('link', 16)} Make link</button></div>
      </details>`);
    const modeSel = el.querySelector('#link-mode');
    const syncMode = () => (el.querySelector('#max-dl').hidden = modeSel.value !== 'download');
    modeSel?.addEventListener('change', syncMode);
    if (modeSel) syncMode();
    el.querySelector('#copy-url')?.addEventListener('click', async () => {
      const input = el.querySelector('#made-url');
      input.select();
      try {
        await navigator.clipboard.writeText(input.value);
        toast('Link copied.');
      } catch {
        document.execCommand?.('copy');
      }
    });
    el.querySelector('#make-link')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const r = await api.post('/api/docs/links', {
          target: { kind, id: item.id }, mode: modeSel.value, days: Number(el.querySelector('#link-days').value), password: el.querySelector('#link-pw').value,
          maxDownloads: Number(el.querySelector('#link-max').value) || 0, note: el.querySelector('#link-note').value,
        });
        links = [r.link, ...links];
        drawLinks(r.url);
        onDone?.({ keepOpen: true });
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
    el.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog('Turn this link off? Anyone who has it can no longer open it. This cannot be undone; you can make a new link.', { confirmLabel: 'Turn off' }))) return;
      await api.del(`/api/docs/links/${b.dataset.revoke}`);
      links = links.filter((l) => l.id !== b.dataset.revoke);
      toast('Link turned off.');
      drawLinks();
    }));
  };
  drawLinks();
  // Enter in a link's fields makes nothing happen (it would save the access list).
  form.querySelector('#link-area').addEventListener('keydown', (e) => e.key === 'Enter' && e.target.tagName === 'INPUT' && e.preventDefault());
  return { close };
}
