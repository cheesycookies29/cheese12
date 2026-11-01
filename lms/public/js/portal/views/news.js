// School news (react and comment) and events.
import { api } from '../../api.js';
import { html, mount, toast, timeAgo, initials, empty, confirmDialog } from '../../ui.js';
import { pageHead, ctx } from '../../shell.js';
import { icon } from '../../icons.js';
import { roleLabel } from '/shared/roles.js';
import { richText } from './classes.js';
import { dateBox, eventWhen } from './home.js';

const REACTIONS = [['like', 'thumb', 'Like'], ['love', 'heart', 'Love'], ['celebrate', 'party', 'Celebrate']];

export function postCard(n, { admin = false } = {}) {
  return html`<article class="post" data-post="${n.id}">
    <header><div class="author"><span class="avatar">${initials(n.authorName)}</span><div><strong>${n.authorName}</strong><span class="by">${timeAgo(n.createdAt)}${n.updatedAt ? ' · edited' : ''}</span></div></div>
      ${n.pinned ? html`<span class="badge brand">${icon('pin', 13)} Pinned</span>` : ''}
      ${admin ? html`<span class="actions"><button class="icon-btn" data-edit="${n.id}" aria-label="Edit">${icon('edit', 16)}</button><button class="icon-btn danger" data-del="${n.id}" aria-label="Delete">${icon('trash', 16)}</button></span>` : ''}</header>
    <h3 style="margin:4px 0 8px">${n.title}</h3>
    ${n.body ? html`<p class="pre">${richText(n.body)}</p>` : ''}
    <div class="reactions">
      ${REACTIONS.map(([k, ic, label]) => html`<button type="button" class="react ${n.mine?.includes(k) ? 'on' : ''}" data-react="${k}" ${admin ? 'disabled' : ''} title="${label}">${icon(ic, 15)} ${n.reactions?.[k] || 0}</button>`)}
      <span class="spacer"></span><span class="muted small">${icon('comment', 14)} ${n.comments.length} comment${n.comments.length === 1 ? '' : 's'}</span>
    </div>
    ${n.comments.length ? html`<div class="comments">${n.comments.map((c) => html`<div class="comment"><span class="avatar">${initials(c.name)}</span>
      <div class="bubble"><b>${c.name}</b> <span class="muted small">${roleLabel(c.role)} · ${timeAgo(c.createdAt)}</span><div class="pre">${c.body}</div></div>
      ${c.own || admin ? html`<button class="icon-btn danger" data-del-comment="${c.id}" aria-label="Delete comment">${icon('trash', 14)}</button>` : ''}</div>`)}</div>` : ''}
    ${!admin && !n.commentsOff ? html`<form class="comment-form" data-comment="${n.id}"><input name="body" placeholder="Write a comment…" maxlength="2000" /><button class="btn" type="submit">Post</button></form>` : ''}
    ${n.commentsOff ? html`<p class="hint" style="margin-top:8px">Comments are off for this post.</p>` : ''}
  </article>`;
}

export async function newsView(el) {
  const [posts, events] = await Promise.all([api.get('/api/news'), api.get('/api/events')]);
  mount(el, html`
    ${pageHead('News & events', `${ctx.info.branding.schoolName}: announcements for everyone and what's coming up.`)}
    <div class="cols wide-left">
      <div class="posts">${posts.length ? posts.map((n) => postCard(n)) : empty('No news yet')}</div>
      <section class="card"><h2>${icon('calendar')} Upcoming events</h2>
        ${events.length ? html`<div class="list">${events.map((e) => html`<div class="list-item">${dateBox(e.startDate)}<span class="grow"><strong>${e.title}</strong><small>${eventWhen(e)}</small>${e.location ? html`<small>${icon('mapPin', 12)} ${e.location}</small>` : ''}${e.description ? html`<p class="small" style="margin:6px 0 0">${e.description}</p>` : ''}</span></div>`)}</div>` : html`<p class="muted">Nothing scheduled.</p>`}
      </section>
    </div>`);
  const redrawPost = (n) => {
    const old = el.querySelector(`[data-post="${n.id}"]`);
    const tmp = document.createElement('div');
    mount(tmp, postCard(n));
    old.replaceWith(tmp.firstElementChild);
    wire();
  };
  function wire() {
    el.querySelectorAll('[data-react]').forEach((b) => (b.onclick = async () => redrawPost(await api.post(`/api/news/${b.closest('[data-post]').dataset.post}/react`, { reaction: b.dataset.react }))));
    el.querySelectorAll('[data-comment]').forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        redrawPost(await api.post(`/api/news/${f.dataset.comment}/comments`, { body: f.body.value }));
      } catch (err) {
        toast(err.message, 'error');
      }
    }));
    el.querySelectorAll('[data-del-comment]').forEach((b) => (b.onclick = async () => {
      if (!(await confirmDialog('Delete your comment?'))) return;
      redrawPost(await api.del(`/api/news/${b.closest('[data-post]').dataset.post}/comments/${b.dataset.delComment}`));
    }));
  }
  wire();
}
