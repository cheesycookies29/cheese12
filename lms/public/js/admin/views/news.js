// Admin: post school news and manage events.
import { api } from '../../api.js';
import { html, mount, modal, toast, formData, confirmDialog, empty } from '../../ui.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { postCard } from '../../portal/views/news.js';
import { dateBox, eventWhen } from '../../portal/views/home.js';

function postDialog(post, onDone) {
  modal({
    title: post ? 'Edit post' : 'New post',
    wide: true,
    body: html`<div class="stack tight">
      <label class="field"><span>Title<em>*</em></span><input name="title" value="${post?.title || ''}" required /></label>
      <label class="field"><span>Message</span><textarea name="body" style="min-height:180px">${post?.body || ''}</textarea><span class="hint">Plain text; links become clickable.</span></label>
      <label class="field check"><input type="checkbox" name="pinned" ${post?.pinned ? 'checked' : ''} /> <span>Pin to the top</span></label>
      <label class="field check"><input type="checkbox" name="commentsOff" ${post?.commentsOff ? 'checked' : ''} /> <span>Turn comments off</span></label>
    </div>`,
    submitLabel: post ? 'Save' : 'Post',
    async onSubmit(form) {
      const v = formData(form);
      const body = { ...v, pinned: Boolean(v.pinned), commentsOff: Boolean(v.commentsOff) };
      await (post ? api.put(`/api/admin/news/${post.id}`, body) : api.post('/api/admin/news', body));
      toast(post ? 'Saved.' : 'Posted. Students and teachers see it on their home page.');
      onDone();
    },
  });
}

function eventDialog(ev, onDone) {
  modal({
    title: ev ? 'Edit event' : 'New event',
    wide: true,
    body: html`<div class="grid">
      <label class="field span-3"><span>Title<em>*</em></span><input name="title" value="${ev?.title || ''}" required /></label>
      <label class="field"><span>Starts<em>*</em></span><input type="date" name="startDate" value="${ev?.startDate || ''}" required /></label>
      <label class="field"><span>Ends</span><input type="date" name="endDate" value="${ev?.endDate || ''}" /></label>
      <label class="field"><span>Location</span><input name="location" value="${ev?.location || ''}" /></label>
      <label class="field"><span>From</span><input type="time" name="startTime" value="${ev?.startTime || ''}" /></label>
      <label class="field"><span>To</span><input type="time" name="endTime" value="${ev?.endTime || ''}" /></label>
      <label class="field span-3"><span>Description</span><textarea name="description" style="min-height:90px">${ev?.description || ''}</textarea></label>
    </div>`,
    async onSubmit(form) {
      await (ev ? api.put(`/api/admin/events/${ev.id}`, formData(form)) : api.post('/api/admin/events', formData(form)));
      toast('Saved.');
      onDone();
    },
  });
}

export async function newsAdminView(el) {
  const [posts, events] = await Promise.all([api.get('/api/admin/news'), api.get('/api/admin/events')]);
  const redraw = () => newsAdminView(el);
  const todayStr = new Date().toISOString().slice(0, 10);
  mount(el, html`
    ${pageHead('News & events', 'Posts appear on every student’s and teacher’s home page (when the News & events module is on).', html`<button class="btn primary" id="new-post">${icon('plus', 16)} New post</button><button class="btn" id="new-event">${icon('calendar', 16)} New event</button>`)}
    <div class="cols wide-left">
      <div class="posts">${posts.length ? posts.map((n) => postCard(n, { admin: true })) : empty('No posts yet', 'Share announcements with the whole school.')}</div>
      <section class="card"><h2>${icon('calendar')} Events</h2>
        ${events.length ? html`<div class="list">${events.map((e) => html`<div class="list-item" style="${(e.endDate || e.startDate) < todayStr ? 'opacity:.6' : ''}">${dateBox(e.startDate)}
          <span class="grow"><strong>${e.title}</strong><small>${eventWhen(e)}${e.location ? ` · ${e.location}` : ''}</small></span>
          <span class="actions"><button class="icon-btn" data-edit-event="${e.id}" aria-label="Edit">${icon('edit', 16)}</button><button class="icon-btn danger" data-del-event="${e.id}" aria-label="Delete">${icon('trash', 16)}</button></span></div>`)}</div>` : html`<p class="muted">No events yet.</p>`}
      </section>
    </div>`);
  el.querySelector('#new-post').addEventListener('click', () => postDialog(null, redraw));
  el.querySelector('#new-event').addEventListener('click', () => eventDialog(null, redraw));
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => postDialog(posts.find((p) => p.id === b.dataset.edit), redraw)));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete this post and its comments?'))) return;
    await api.del(`/api/admin/news/${b.dataset.del}`);
    redraw();
  }));
  el.querySelectorAll('[data-del-comment]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Remove this comment?'))) return;
    await api.del(`/api/admin/news/${b.closest('[data-post]').dataset.post}/comments/${b.dataset.delComment}`);
    redraw();
  }));
  el.querySelectorAll('[data-edit-event]').forEach((b) => b.addEventListener('click', () => eventDialog(events.find((e) => e.id === b.dataset.editEvent), redraw)));
  el.querySelectorAll('[data-del-event]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete this event?'))) return;
    await api.del(`/api/admin/events/${b.dataset.delEvent}`);
    redraw();
  }));
}
