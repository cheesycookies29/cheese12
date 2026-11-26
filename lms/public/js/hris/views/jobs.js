// Job openings, My applications and each application's progress (server/recruitment.js): for job
// applicants (people outside the school, with a temporary applicant account) and for employees
// applying internally from self-service with their own account (request PL-004: no second account).
// The progress tracker (PL-015): the school's recruitment stages, done, current and to come, with
// dates; what happens at the current stage; the notes HR wrote to the applicant; the outcome.
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, money, fmtDate, fmtDateTime, badge, toast, modal, confirmDialog, today } from '../../ui.js';
import { poolTickText, poolPrivacyText } from '/shared/recruitment-assess.js';

// An application's stage or outcome as a badge, coloured by its fixed meaning.
const MEANING_KIND = { 'in-progress': 'blue', selected: 'green', 'not-selected': 'gray', withdrawn: 'gray' };
export const applicationBadge = (a) => badge(a.stageLabel || a.stage, MEANING_KIND[a.status] || '');
export const salaryLine = (o) => (o.salaryGrade ? `SG ${o.salaryGrade}${o.monthlySalary ? ` · ${money(o.monthlySalary)} a month` : ''}` : '');
export const placeLine = (o) => [o.office, o.campusName].filter(Boolean).join(' · ');
const localDay = (iso) => today(new Date(iso));

// "Your applicant account is open until …" (PL-003), on every page an applicant opens.
export const applicantNotice = (applicant, extra = '') => (applicant
  ? html`<div class="notice info job-account">${icon('clock', 18)}<p>Your applicant account is open until <strong>${fmtDate(localDay(applicant.expiresAt))}</strong>.${extra ? html` ${extra}` : ''}</p></div>`
  : '');

// The qualification standards (CSC), as the opening lists them.
export const qualifications = (o) => html`<dl class="info info-grid job-qs">
  ${[['Education', o.education], ['Training', o.training], ['Experience', o.experience], ['Eligibility', o.eligibility]].map(([k, v]) => html`<div><dt>${k}</dt><dd>${v || '—'}</dd></div>`)}
</dl>`;

function openingCard(o) {
  return html`<a class="card job-card" href="#/jobs/${o.id}">
    <div class="job-card-head">
      <span class="item-ic">${icon('briefcase')}</span>
      <span class="grow"><strong>${o.title}</strong><small>${placeLine(o)}</small></span>
      ${o.mine ? applicationBadge(o.mine) : ''}
    </div>
    <div class="job-facts">
      ${salaryLine(o) ? html`<span>${icon('wallet', 14)} ${salaryLine(o)}</span>` : ''}
      <span>${icon('users', 14)} ${o.vacancies} vacanc${o.vacancies === 1 ? 'y' : 'ies'}</span>
      <span>${icon('calendar', 14)} Apply by ${fmtDate(o.closingDate)}</span>
      ${o.audience === 'internal' ? badge('Internal only', 'brand') : ''}
    </div>
  </a>`;
}

export async function jobsView(el) {
  const d = await api.get('/api/hris/jobs');
  mount(el, html`
    ${pageHead('Job openings', d.internal ? 'Positions open at the school. As an employee you apply with your own account; your application is marked Internal.' : 'Positions open at the school. Choose one to read it and apply.',
      html`<a class="btn" href="#/jobs/mine">${icon('inbox', 16)} My applications</a>`)}
    ${applicantNotice(d.applicant)}
    ${d.openings.length
      ? html`<div class="job-grid">${d.openings.map(openingCard)}</div>`
      : html`<div class="card empty">${icon('briefcase', 40)}<h2>No openings right now</h2><p>New openings appear here when HR posts them.</p></div>`}`);
}

export async function jobView(el, { id }) {
  const o = await api.get(`/api/hris/jobs/${id}`);
  const mine = o.mine;
  const can = o.accepting && (!mine || mine.status === 'withdrawn');
  mount(el, html`
    ${pageHead(o.title, placeLine(o), '', ['/jobs', 'Job openings'])}
    ${applicantNotice(o.applicant)}
    <div class="cols wide-left">
      <section class="card">
        <div class="job-facts big">
          ${salaryLine(o) ? html`<span>${icon('wallet', 16)} ${salaryLine(o)}</span>` : ''}
          <span>${icon('users', 16)} ${o.vacancies} vacanc${o.vacancies === 1 ? 'y' : 'ies'}</span>
          <span>${icon('calendar', 16)} Apply by ${fmtDate(o.closingDate)}</span>
          ${o.plantillaItem ? html`<span>${icon('file', 16)} Item no. ${o.plantillaItem}</span>` : ''}
          ${o.audience === 'internal' ? badge('Internal only', 'brand') : ''}
        </div>
        ${o.description ? html`<p class="pre job-desc">${o.description}</p>` : ''}
        <h2>Qualification standards</h2>
        ${qualifications(o)}
      </section>
      <section class="card" id="apply-card">
        <h2>${icon('briefcase')} Your application</h2>
        ${mine && mine.status !== 'withdrawn'
          ? html`<p>${applicationBadge(mine)} <span class="muted small">since ${fmtDate(localDay(mine.stageSince || mine.updatedAt))}</span></p>
              ${tracker(mine.tracker, { compact: true })}
              <a class="btn" href="#/jobs/mine/${mine.id}">${icon('chart', 16)} See its progress</a>`
          : can
            ? html`<p class="muted small">${o.internal
                ? 'HR sees your name, your current position, salary grade and campus from your employee record, and your note.'
                : 'HR sees your name, email and mobile number from your account, and your note.'}</p>
              ${mine ? html`<p class="small">You withdrew an application for this opening. You can send it again until ${fmtDate(o.closingDate)}.</p>` : ''}
              <button class="btn primary block" id="apply">${icon('check', 16)} ${mine ? 'Apply again' : 'Apply'}</button>`
            : html`<p class="muted">This opening no longer takes applications.</p>`}
      </section>
    </div>`);
  el.querySelector('#apply')?.addEventListener('click', () => modal({
    title: `Apply for ${o.title}`,
    subtitle: placeLine(o),
    submitLabel: 'Send application',
    body: html`<label class="field"><span>Cover note (optional)</span><textarea name="note" maxlength="2000" rows="6" placeholder="Why you are applying, and what HR should know about you."></textarea>
      <span class="hint">${o.internal ? 'Your application is marked Internal and linked to your employee record.' : 'You can follow it under My applications.'}</span></label>`,
    async onSubmit(form) {
      await api.post(`/api/hris/jobs/${o.id}/apply`, { note: form.note.value });
      toast('Application sent. HR will review it.');
      jobView(el, { id });
    },
  }));
}

// ----- The progress tracker -----
// A stepper of the stages: done (a tick and the date), the current one (and since when), to come,
// skipped, and the outcome once decided. Across the page on a wide screen; a list down the page on
// a phone (hris.css). compact: the dots and labels only, for My applications.
const STEP_TEXT = { done: 'Done', current: 'Now', next: 'To come', skipped: 'Skipped', outcome: 'Outcome' };
function stepMark(s, i) {
  if (s.state === 'done') return icon('check', 14);
  if (s.state === 'outcome') return icon(s.meaning === 'selected' ? 'star' : s.meaning === 'withdrawn' ? 'undo' : 'flag', 14);
  if (s.state === 'skipped') return '–';
  return String(i + 1);
}
export function tracker(t, { compact = false } = {}) {
  if (!t?.steps?.length) return '';
  return html`<ol class="tracker ${compact ? 'compact' : ''}" aria-label="Progress of the application">
    ${t.steps.map((s, i) => html`<li class="step ${s.state} ${s.meaning ? `meaning-${s.meaning}` : ''}" ${s.state === 'current' || s.state === 'outcome' ? 'aria-current="step"' : ''}>
      <span class="step-mark" aria-hidden="true">${stepMark(s, i)}</span>
      <span class="step-text">
        <strong>${s.label}</strong>
        <small><span class="sr-only">${STEP_TEXT[s.state]}: </span>${s.at ? (s.state === 'current' ? `Since ${fmtDate(localDay(s.at))}` : fmtDate(localDay(s.at))) : s.state === 'skipped' ? 'Skipped' : s.state === 'next' ? 'To come' : ''}</small>
      </span>
    </li>`)}
  </ol>`;
}

// What happens now (the current stage's description), or the outcome once decided.
function nowBox(a) {
  const t = a.tracker;
  if (t.outcome) {
    const kind = t.outcome.meaning === 'selected' ? 'ok' : 'info';
    return html`<div class="notice ${kind} job-now">${icon(t.outcome.meaning === 'selected' ? 'star' : 'flag', 18)}<div><p><strong>${t.outcome.label}</strong> <span class="muted small">· ${fmtDate(localDay(t.outcome.at))}</span></p>${t.outcome.description ? html`<p>${t.outcome.description}</p>` : ''}</div></div>`;
  }
  return html`<div class="notice info job-now">${icon('clock', 18)}<div><p><strong>Now: ${t.current.label}</strong> <span class="muted small">· step ${t.step} of ${t.of}, since ${fmtDate(localDay(t.current.since))}</span></p>${t.current.description ? html`<p>${t.current.description}</p>` : ''}</div></div>`;
}

// The notes HR wrote to the applicant, oldest first. Always from "HR office", never a person's name.
function notesList(notes) {
  if (!notes.length) return html`<p class="muted">No notes from HR yet. When HR writes to you about this application, the note shows here and on the bell.</p>`;
  return html`<ol class="job-notes">${notes.map((n) => html`<li>
    <div class="job-note-head"><strong>${n.from}</strong><span class="muted small">${fmtDateTime(n.at)} · ${n.stage}</span></div>
    <p class="pre">${n.note}</p>
  </li>`)}</ol>`;
}

const withdraw = async (a, done) => {
  if (!(await confirmDialog(`Withdraw your application for ${a.title}? You can send it again until the opening closes.`, { confirmLabel: 'Withdraw', title: 'Withdraw application' }))) return;
  await api.post(`/api/hris/my-applications/${a.id}/withdraw`);
  toast('Application withdrawn.');
  done();
};
const placeOf = (a) => [a.office, a.campusName].filter(Boolean).join(' · ');

export async function myApplicationsView(el) {
  const d = await api.get('/api/hris/my-applications');
  const removal = d.applicant ? (d.applicant.purgeDays ? `After that you cannot sign in, and ${d.applicant.purgeDays} days later your account and applications are removed.` : 'After that you cannot sign in, and HR removes your account and applications.') : '';
  mount(el, html`
    ${pageHead('My applications', 'Where each application is in the school\'s recruitment stages. You are told on the bell when HR moves it or writes to you.', html`<a class="btn" href="#/jobs">${icon('briefcase', 16)} Job openings</a>`)}
    ${applicantNotice(d.applicant, removal)}
    ${d.applications.length
      ? html`<div class="stack">${d.applications.map((a) => html`<section class="card job-app">
          <div class="job-app-head">
            <span class="grow"><a href="#/jobs/mine/${a.id}"><strong>${a.title}</strong></a><small class="block muted">${placeOf(a)}${a.internal ? ' · Internal' : ''} · applied ${fmtDate(localDay(a.createdAt))}</small></span>
            ${applicationBadge(a)}
          </div>
          ${tracker(a.tracker, { compact: true })}
          ${a.notes.length ? html`<p class="small job-latest"><strong>Latest note from HR</strong> <span class="muted">(${fmtDate(localDay(a.notes.at(-1).at))})</span>: ${a.notes.at(-1).note}</p>` : ''}
          <div class="actions">
            <a class="btn sm primary" href="#/jobs/mine/${a.id}">${icon('chart', 14)} See its progress</a>
            ${a.canWithdraw ? html`<button class="btn sm" data-withdraw="${a.id}">Withdraw</button>` : a.canApplyAgain ? html`<a class="btn sm" href="#/jobs/${a.openingId}">Apply again</a>` : ''}
          </div>
        </section>`)}</div>`
      : html`<div class="card empty">${icon('inbox', 40)}<h2>No applications yet</h2><p>Choose an opening under <a href="#/jobs">Job openings</a> to apply.</p></div>`}
    ${poolCard(d.pool, d.applicant)}`);
  el.querySelectorAll('[data-withdraw]').forEach((b) => b.addEventListener('click', () => withdraw(d.applications.find((x) => x.id === b.dataset.withdraw), () => myApplicationsView(el))));
  wirePool(el, d.pool, () => myApplicationsView(el));
}

// ----- The pool of applicants (PL-020): the person's own choice, never ticked for them -----
// Not ticked: the tick box with its privacy note. Ticked: what it means, and Leave the pool.
function poolCard(p, applicant) {
  if (!p) return '';
  const months = p.months;
  if (p.inPool) {
    return html`<section class="card pool-card" id="pool-card">
      <h2>${icon('users')} Pool of applicants</h2>
      <p>You are in the school's pool of applicants until <strong>${fmtDate(localDay(p.until))}</strong>. HR may invite you to apply for other openings; you are told on the bell, and you apply yourself.${applicant ? ' Your applicant account stays open until then.' : ''}</p>
      ${p.invites.length ? html`<p class="small"><strong>Invited to apply:</strong> ${p.invites.map((x, i) => html`${i ? ', ' : ''}<a href="#/jobs/${x.openingId}">${x.title}</a> <span class="muted">(${fmtDate(localDay(x.at))})</span>`)}</p>` : ''}
      <div class="actions"><button class="btn sm" id="pool-leave">Leave the pool</button></div>
    </section>`;
  }
  if (p.optedIn) {
    return html`<section class="card pool-card" id="pool-card">
      <h2>${icon('users')} Pool of applicants</h2>
      <p>You asked to be kept in the school's pool of applicants for ${months} month${months === 1 ? '' : 's'}. If an application of yours ends <em>Not selected</em> or <em>Not qualified</em>, you enter the pool and are told on the bell.</p>
      <div class="actions"><button class="btn sm" id="pool-leave">Leave the pool</button></div>
    </section>`;
  }
  return html`<section class="card pool-card" id="pool-card">
    <h2>${icon('users')} Pool of applicants</h2>
    <label class="check-row"><input type="checkbox" id="pool-tick" /> <span>${poolTickText(months)}</span></label>
    <p class="muted small">${poolPrivacyText(months)}</p>
    <div class="actions"><button class="btn sm primary" id="pool-join" disabled>Save my choice</button></div>
  </section>`;
}
function wirePool(el, p, done) {
  const tick = el.querySelector('#pool-tick');
  const join = el.querySelector('#pool-join');
  tick?.addEventListener('change', () => (join.disabled = !tick.checked));
  join?.addEventListener('click', async () => {
    const r = await api.put('/api/hris/my-pool', { optIn: true });
    toast(r.inPool ? `You are in the pool of applicants until ${fmtDate(localDay(r.until))}.` : 'Saved. You are kept in the pool if an application ends Not selected or Not qualified.');
    done();
  });
  el.querySelector('#pool-leave')?.addEventListener('click', async () => {
    if (!(await confirmDialog(p.inPool ? 'Leave the pool of applicants? HR will no longer invite you to other openings. If your applicant account was kept open for the pool, it closes on its own date, or now if that has passed.' : 'Withdraw your agreement to be kept in the pool of applicants?', { confirmLabel: 'Leave the pool', title: 'Leave the pool of applicants' }))) return;
    await api.put('/api/hris/my-pool', { optIn: false });
    toast('You are no longer in the pool of applicants.');
    done();
  });
}

// One application: the tracker, what happens now, the notes from HR, and the application itself.
// The bell's notice on each change opens this page.
export async function applicationView(el, { id }) {
  const a = await api.get(`/api/hris/my-applications/${id}`);
  mount(el, html`
    ${pageHead(a.title, html`${placeOf(a)}${a.internal ? ' · Internal application' : ''}`, applicationBadge(a), ['/jobs/mine', 'My applications'])}
    ${applicantNotice(a.applicant)}
    <section class="card">
      <div class="card-head"><h2>${icon('chart')} Progress</h2>${a.tracker.of ? html`<span class="muted small">Step ${a.tracker.step} of ${a.tracker.of}</span>` : ''}</div>
      ${tracker(a.tracker)}
      ${nowBox(a)}
    </section>
    <div class="cols wide-left">
      <section class="card">
        <h2>${icon('comment')} Notes from HR</h2>
        ${notesList(a.notes)}
      </section>
      <section class="card">
        <h2>${icon('briefcase')} Your application</h2>
        <dl class="info job-app-info">
          <div><dt>Sent</dt><dd>${fmtDate(localDay(a.createdAt))}</dd></div>
          <div><dt>Opening</dt><dd><a href="#/jobs/${a.openingId}">${a.title}</a>${a.closingDate ? html`<small class="block muted">Applications until ${fmtDate(a.closingDate)}</small>` : ''}</dd></div>
          <div><dt>Your cover note</dt><dd class="pre">${a.note || html`<span class="muted">None</span>`}</dd></div>
        </dl>
        <div class="actions">
          ${a.canWithdraw ? html`<button class="btn" id="withdraw">Withdraw</button>` : a.canApplyAgain ? html`<a class="btn primary" href="#/jobs/${a.openingId}">Apply again</a>` : ''}
        </div>
        ${a.canWithdraw ? html`<p class="muted small">You can withdraw while the opening is not closed and HR has not decided.</p>` : ''}
      </section>
    </div>`);
  el.querySelector('#withdraw')?.addEventListener('click', () => withdraw(a, () => applicationView(el, { id })));
}
