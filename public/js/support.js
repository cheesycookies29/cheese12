// The public service desk page (/support): anyone, with or without an account, sends a complaint
// or request and follows it at /support/t/<token>. No sign-in; nothing here can see other tickets.
import { api } from './api.js';
import { html, mount, toast, formErrors } from './ui.js';
import { ACCEPT, prepareUpload, viewAttachment, sizeLabel } from './attachments.js';
import { TICKET_STATUS } from '/shared/helpdesk.js';

const el = document.getElementById('sp');
const when = (iso) => new Date(iso).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const STATUS_TEXT = {
  new: 'Received: waiting for our team', open: 'In progress', pending: 'Waiting for your reply', on_hold: 'On hold',
  resolved: 'Resolved', closed: 'Closed',
};
const statusPill = (s) => html`<span class="sp-status sp-${s}">${STATUS_TEXT[s] || TICKET_STATUS[s] || s}</span>`;
const files = async (input) => Promise.all([...(input?.files || [])].slice(0, 3).map(prepareUpload));

function setCompany(name) {
  document.getElementById('sp-company').textContent = name || '';
  mount(document.getElementById('sp-foot'), html`<p>${name} · Service desk · Powered by CORE · ERP by Lancaster</p>`);
}

async function showForm() {
  const cfg = await api.get('/api/public/helpdesk');
  setCompany(cfg.companyName);
  document.title = cfg.enabled ? `${cfg.title} · ${cfg.companyName}` : `Service desk · ${cfg.companyName}`;
  if (!cfg.enabled) return mount(el, html`<section class="sp-card"><h1>Service desk</h1><p>This form is not accepting requests at the moment. Please contact us another way.</p></section>`);
  const startedAt = Date.now();
  mount(el, html`<section class="sp-card">
    <h1>${cfg.title}</h1>
    ${cfg.intro ? html`<p class="sp-intro">${cfg.intro}</p>` : ''}
    <form id="sp-form" novalidate>
      <div class="sp-grid">
        <label class="field"><span>Your name <em>*</em></span><input name="name" autocomplete="name" maxlength="120" required /></label>
        <label class="field"><span>Email <em>*</em></span><input name="email" type="email" autocomplete="email" maxlength="200" required /></label>
        <label class="field"><span>Phone${cfg.requirePhone ? html` <em>*</em>` : ' (optional)'}</span><input name="phone" type="tel" autocomplete="tel" maxlength="40" ${cfg.requirePhone ? 'required' : ''} /></label>
        <label class="field"><span>Company or organization (optional)</span><input name="organization" autocomplete="organization" maxlength="120" /></label>
      </div>
      <label class="field"><span>What is it about? <em>*</em></span><select name="category" required>${cfg.categories.map((c) => html`<option>${c}</option>`)}</select></label>
      <label class="field"><span>Subject <em>*</em></span><input name="subject" maxlength="200" required placeholder="A short summary" /></label>
      <label class="field"><span>Details <em>*</em></span><textarea name="message" rows="7" maxlength="5000" required placeholder="What happened, when, and anything that helps us look into it (order or account number, location, names)."></textarea></label>
      ${cfg.allowFiles ? html`<label class="field"><span>Photos or documents (optional, up to ${cfg.maxFiles}, PDF or images, 5 MB each)</span><input type="file" name="files" accept="${ACCEPT}" multiple /></label>` : ''}
      <label class="sp-trap" aria-hidden="true">Leave this empty <input name="website" tabindex="-1" autocomplete="off" /></label>
      <p class="sp-privacy">We use these details only to respond to this request, in line with the Data Privacy Act of 2012.</p>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn primary sp-submit" type="submit">Send</button>
    </form>
  </section>`);
  const form = el.querySelector('#sp-form');
  const errors = formErrors(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Every missing field and a mistyped email are shown at once, before anything is sent.
    if (!errors.validate()) return;
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      const fd = Object.fromEntries(new FormData(form));
      delete fd.files;
      const res = await api.post('/api/public/helpdesk/tickets', { ...fd, elapsedMs: Date.now() - startedAt, attachments: await files(form.files) });
      if (!res.token) return mount(el, html`<section class="sp-card"><h1>Thank you</h1><p>Your message was sent.</p></section>`);
      history.replaceState(null, '', `/support/t/${res.token}`);
      showSent(res);
    } catch (ex) {
      errors.server(ex);
      btn.disabled = false;
      btn.textContent = 'Send';
    }
  });
}

function showSent(res) {
  mount(el, html`<section class="sp-card sp-done">
    <p class="sp-kicker">Request received</p>
    <h1>Your reference is <span class="mono">${res.ref}</span></h1>
    <p>${res.emailed ? 'We have emailed you a confirmation with this link.' : 'Keep this link to follow your request and reply to us.'}</p>
    <div class="sp-link"><code class="sp-url" id="track-url" aria-label="Tracking link">${res.trackUrl}</code><button class="btn" id="copy">Copy link</button></div>
    <p class="sp-actions"><a class="btn primary" href="/support/t/${res.token}">View my request</a> <a class="btn" href="/support">Send another</a></p>
  </section>`);
  el.querySelector('#copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(res.trackUrl);
      toast('Link copied.');
    } catch {
      getSelection().selectAllChildren(el.querySelector('#track-url'));
    }
  });
}

async function showTicket(token) {
  let t;
  try {
    t = await api.get(`/api/public/helpdesk/track/${encodeURIComponent(token)}`);
  } catch (ex) {
    const cfg = await api.get('/api/public/helpdesk').catch(() => ({}));
    setCompany(cfg.companyName);
    return mount(el, html`<section class="sp-card"><h1>Request not found</h1><p>${ex.message}</p><p><a class="btn" href="/support">Send a new request</a></p></section>`);
  }
  setCompany(t.companyName);
  document.title = `${t.ref} · ${t.companyName}`;
  const render = () => {
    mount(el, html`<section class="sp-card">
      <p class="sp-kicker mono">${t.ref}</p>
      <h1>${t.subject}</h1>
      <p class="sp-meta">${statusPill(t.status)} <span>${t.category} · sent ${when(t.createdAt)}</span></p>
      <ol class="sp-thread">${t.messages.map((m) => m.kind === 'event'
        ? html`<li class="sp-event">${m.body} · ${when(m.at)}</li>`
        : html`<li class="sp-msg ${m.fromRequester ? 'mine' : 'theirs'}"><header><strong>${m.fromRequester ? 'You' : m.author}</strong><time>${when(m.at)}</time></header>
            <div class="hd-body">${m.body}</div>
            ${m.attachments.length ? html`<div class="hd-files">${m.attachments.map((a) => html`<button type="button" class="link" data-file="${a.id}">📎 ${a.name} (${sizeLabel(a.size)})</button>`)}</div>` : ''}</li>`)}</ol>
      ${t.canReply
        ? html`<form id="sp-reply" class="sp-reply" novalidate>
            <label class="field"><span>${t.status === 'resolved' ? 'Not solved? Reply and we will look again' : 'Add a message'}</span><textarea name="message" rows="4" maxlength="5000" required></textarea></label>
            ${t.allowFiles ? html`<label class="field"><span>Attach files (optional)</span><input type="file" name="files" accept="${ACCEPT}" multiple /></label>` : ''}
            <p class="form-error" hidden></p>
            <button class="btn primary" type="submit">Send message</button>
          </form>`
        : html`<p class="sp-intro">This request is closed. <a href="/support">Send a new request</a> and mention ${t.ref} if you need more help.</p>`}
    </section>`);
    const form = el.querySelector('#sp-reply');
    const errors = form && formErrors(form);
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!errors.validate()) return;
      try {
        t = await api.post(`/api/public/helpdesk/track/${encodeURIComponent(token)}/messages`, { message: form.message.value, attachments: await files(form.files) });
        toast('Message sent.');
        render();
      } catch (ex) {
        errors.server(ex);
      }
    });
  };
  render();
  el.addEventListener('click', (e) => {
    const id = e.target.closest('[data-file]')?.dataset.file;
    if (id) viewAttachment(`/api/public/helpdesk/track/${encodeURIComponent(token)}/files/${id}`, 'Attachment').catch((ex) => toast(ex.message, 'error'));
  });
}

const m = location.pathname.match(/^\/support\/t\/([A-Za-z0-9_-]+)\/?$/);
(m ? showTicket(m[1]) : showForm()).catch((ex) => mount(el, html`<section class="sp-card"><h1>Something went wrong</h1><p>${ex.message}</p></section>`));
