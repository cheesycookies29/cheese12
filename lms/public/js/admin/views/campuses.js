// Campuses: the school's sites. Same features and catalog everywhere; each campus has its
// own students, teachers, registrars, sections, news and events.
import { api } from '../../api.js';
import { html, mount, modal, toast, formData, confirmDialog } from '../../ui.js';
import { pageHead, ctx } from '../../shell.js';
import { can } from '/shared/roles.js';
import { icon } from '../../icons.js';

function campusDialog(c, onDone) {
  modal({
    title: c ? `Edit ${c.name}` : 'Add a campus',
    body: html`<div class="stack tight">
      <label class="field"><span>Name<em>*</em></span><input name="name" value="${c?.name || ''}" placeholder="e.g. Sipocot Campus" required /></label>
      <label class="field"><span>Short code</span><input name="code" value="${c?.code || ''}" placeholder="e.g. SIP" maxlength="12" /></label>
      <label class="field"><span>Address</span><input name="address" value="${c?.address || ''}" /></label>
    </div>`,
    async onSubmit(form) {
      await (c ? api.put(`/api/admin/campuses/${c.id}`, formData(form)) : api.post('/api/admin/campuses', formData(form)));
      toast(c ? 'Saved.' : 'Campus added. Switch to it from your name at the top right to add its people and sections.');
      onDone();
    },
  });
}

export async function campusesView(el) {
  const list = await api.get('/api/admin/campuses');
  const editable = can(ctx.user.role, 'campuses.manage');
  const redraw = () => campusesView(el);
  mount(el, html`
    ${pageHead('Campuses', 'Every campus has the same features, catalog and terms. Each has its own students, teachers, registrars, sections, news and events.', editable ? html`<button class="btn primary" id="add">${icon('plus', 16)} Add campus</button>` : '')}
    <div class="tiles">${list.map((c) => html`<section class="tile">
      <span class="code">${c.code || 'CAMPUS'}${c.id === ctx.info.activeCampusId ? ' · you are here' : ''}</span>
      <strong>${c.name}</strong>
      <small>${c.address || 'No address yet'}</small>
      <span class="meta"><span>${icon('cap', 14)} ${c.students} students</span><span>${icon('users', 14)} ${c.teachers} teachers</span><span>${icon('layers', 14)} ${c.sections} sections this term</span></span>
      <span class="actions" style="margin-top:8px">
        ${c.id !== ctx.info.activeCampusId ? html`<button class="btn sm" data-switch="${c.id}">${icon('building', 15)} Switch to it</button>` : ''}
        ${editable ? html`<button class="btn sm" data-edit="${c.id}">${icon('edit', 15)} Edit</button>${list.length > 1 ? html`<button class="btn sm danger ghost" data-del="${c.id}">${icon('trash', 15)} Remove</button>` : ''}` : ''}
      </span>
    </section>`)}</div>
    <p class="hint" style="margin-top:14px">Administrators reach every campus. Registrars and teachers work at the campuses ticked on their account; students belong to one campus. Switch campus from your name at the top right.</p>`);
  el.querySelector('#add')?.addEventListener('click', () => campusDialog(null, redraw));
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => campusDialog(list.find((c) => c.id === b.dataset.edit), redraw)));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const c = list.find((x) => x.id === b.dataset.del);
    if (!(await confirmDialog(`Remove ${c.name}? Only an empty campus can be removed.`, { confirmLabel: 'Remove' }))) return;
    try {
      await api.del(`/api/admin/campuses/${c.id}`);
      redraw();
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
  el.querySelectorAll('[data-switch]').forEach((b) => b.addEventListener('click', async () => {
    await api.post('/api/admin/auth/campus', { campusId: b.dataset.switch });
    location.reload();
  }));
}
