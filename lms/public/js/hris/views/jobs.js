// Job openings and My applications (server/recruitment.js): for job applicants (people outside the
// school, with a temporary applicant account) and for employees applying internally from
// self-service with their own account (request PL-004: no second account).
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, money, fmtDate, badge, toast, modal, confirmDialog, today } from '../../ui.js';
import { applicationStatusLabel } from '/shared/recruitment.js';

const STATUS_KIND = { received: 'blue', review: 'amber', shortlisted: 'brand', 'not-selected': 'gray', selected: 'green', withdrawn: 'gray' };
export const applicationBadge = (s) => badge(applicationStatusLabel(s), STATUS_KIND[s] || '');
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
      ${o.mine ? applicationBadge(o.mine.status) : ''}
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
          ? html`<p>${applicationBadge(mine.status)} <span class="muted small">since ${fmtDate(localDay(mine.updatedAt))}</span></p>
              ${mine.statusNote ? html`<p class="small"><strong>Note from HR:</strong> ${mine.statusNote}</p>` : ''}
              <a class="btn" href="#/jobs/mine">My applications</a>`
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

export async function myApplicationsView(el) {
  const d = await api.get('/api/hris/my-applications');
  const removal = d.applicant ? (d.applicant.purgeDays ? `After that you cannot sign in, and ${d.applicant.purgeDays} days later your account and applications are removed.` : 'After that you cannot sign in, and HR removes your account and applications.') : '';
  mount(el, html`
    ${pageHead('My applications', 'Each application, its status and when it last changed. You are told on the bell when HR changes it.', html`<a class="btn" href="#/jobs">${icon('briefcase', 16)} Job openings</a>`)}
    ${applicantNotice(d.applicant, removal)}
    ${d.applications.length
      ? html`<section class="card scroll-x"><table class="table">
          <thead><tr><th>Position</th><th>Applied</th><th>Status</th><th>Last change</th><th>Note from HR</th><th></th></tr></thead>
          <tbody>${d.applications.map((a) => html`<tr>
            <td><a href="#/jobs/${a.openingId}"><strong>${a.title}</strong></a><small class="block muted">${[a.office, a.campusName].filter(Boolean).join(' · ')}${a.internal ? ' · Internal' : ''}</small></td>
            <td>${fmtDate(localDay(a.createdAt))}</td>
            <td>${applicationBadge(a.status)}</td>
            <td>${fmtDate(localDay(a.updatedAt))}</td>
            <td class="notes">${a.statusNote || html`<span class="muted">—</span>`}</td>
            <td class="row-actions">${a.canWithdraw ? html`<button class="btn sm" data-withdraw="${a.id}">Withdraw</button>` : a.canApplyAgain ? html`<a class="btn sm" href="#/jobs/${a.openingId}">Apply again</a>` : ''}</td>
          </tr>`)}</tbody></table></section>`
      : html`<div class="card empty">${icon('inbox', 40)}<h2>No applications yet</h2><p>Choose an opening under <a href="#/jobs">Job openings</a> to apply.</p></div>`}`);
  el.querySelectorAll('[data-withdraw]').forEach((b) => b.addEventListener('click', async () => {
    const a = d.applications.find((x) => x.id === b.dataset.withdraw);
    if (!(await confirmDialog(`Withdraw your application for ${a.title}? You can send it again until the opening closes.`, { confirmLabel: 'Withdraw', title: 'Withdraw application' }))) return;
    await api.post(`/api/hris/my-applications/${a.id}/withdraw`);
    toast('Application withdrawn.');
    myApplicationsView(el);
  }));
}
