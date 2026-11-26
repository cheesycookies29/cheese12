// The selection board (HRIS request PL-021; server/recruitment-assess.js):
//  - Ratings to do (/assess): the openings an account is named on as an assessor, with how many
//    applicants it still has to rate. Anyone HR names (not only HR) sees it.
//  - One opening as an assessor sees it (/assess/:id): its applicants, the assessor's own rating of
//    each (none, draft, submitted), their documents (read-only), and the combined result only if the
//    school lets assessors see it after submitting.
//  - The selection board card on HR's opening page: name the assessors, each with an optional title
//    (Chairperson, Member…); "rated by 2 of 3" per applicant is on the opening's list.
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, fmtDate, fmtDateTime, badge, toast, modal, today } from '../../ui.js';
import { fmtPoints, combineLabel } from '/shared/recruitment-assess.js';
import { completenessText } from '/shared/recruitment-docs.js';
import { qualifications, placeLine } from './jobs.js';

const localDay = (iso) => today(new Date(iso));
const BOARD = ['/assess', 'Ratings to do'];
export const docsBadge = (d) => (d ? badge(completenessText(d), d.complete ? 'green' : 'amber') : '');

export async function ratingsToDoView(el) {
  const { openings } = await api.get('/api/hris/assess');
  mount(el, html`
    ${pageHead('Ratings to do', 'The openings HR named you on as an assessor (a member of the selection board). Rate each applicant on your own: you do not see the other assessors\' scores before you submit yours.')}
    ${openings.length
      ? html`<div class="stack">${openings.map((o) => html`<a class="card board-card" href="#/assess/${o.id}">
          <div class="board-card-head">
            <span class="item-ic">${icon('clipboard')}</span>
            <span class="grow"><strong>${o.title}</strong><small>${[o.office, o.campusName].filter(Boolean).join(' · ')}${o.myTitle ? ` · you are ${o.myTitle}` : ''}</small></span>
            ${o.toDo ? badge(`${o.toDo} to rate`, 'amber') : o.applicants ? badge('All rated', 'green') : badge('No applicants yet', 'gray')}
          </div>
          <div class="job-facts">
            <span>${icon('users', 14)} ${o.applicants} applicant${o.applicants === 1 ? '' : 's'}</span>
            <span>${icon('check', 14)} ${o.submitted} submitted${o.drafts ? ` · ${o.drafts} draft${o.drafts === 1 ? '' : 's'}` : ''}</span>
            <span>${icon('calendar', 14)} ${o.status === 'closed' ? 'Closed' : `Applications until ${fmtDate(o.closingDate)}`}</span>
            ${o.templateName ? html`<span>${icon('table', 14)} ${o.templateName} · ${combineLabel(o.rule)}</span>` : ''}
          </div>
        </a>`)}</div>`
      : html`<div class="card empty">${icon('clipboard', 40)}<h2>No ratings to do</h2><p>When HR names you on the selection board of a job opening, it shows here and you are told on the bell.</p></div>`}`);
}

export async function boardOpeningView(el, { id }) {
  const v = await api.get(`/api/hris/assess/openings/${id}`);
  const o = v.opening;
  const status = (m) => (!m ? badge('Not rated', 'gray') : m.submitted ? badge('Submitted', 'green') : badge('Draft', 'amber'));
  mount(el, html`
    ${pageHead(o.title, placeLine(o), '', [BOARD])}
    <div class="notice info">${icon('lock', 18)}<p>${v.onPanel ? 'You are on this opening\'s selection board.' : 'You are rating for the HR office.'} Rate each applicant on your own${v.template ? `, with ${v.template.name} (${combineLabel(v.template.combine)})` : ''}. The applicants never see scores or comments.</p></div>
    <section class="card">
      <div class="card-head"><h2>Applicants</h2><span class="muted small">${v.applications.filter((x) => !x.mine?.submitted).length} of ${v.applications.length} still to rate</span></div>
      ${v.applications.length ? html`<div class="scroll-x"><table class="table board-apps">
        <thead><tr><th>Applicant</th><th>Applied</th><th>Documents</th><th>Your rating</th>${v.applications.some((a) => a.combined) ? html`<th>Combined</th>` : ''}<th></th></tr></thead>
        <tbody>${v.applications.map((a) => html`<tr>
          <td><strong>${a.name}</strong> ${a.internal ? badge('Internal', 'brand') : badge('External', 'blue')}${a.position ? html`<small class="block muted">${a.position}</small>` : ''}${a.note ? html`<p class="small job-note">“${a.note}”</p>` : ''}</td>
          <td class="nowrap">${fmtDate(localDay(a.createdAt))}<small class="block muted">${a.stageLabel}</small></td>
          <td>${a.documents ? html`${docsBadge(a.documents)}<small class="block"><a href="#/assess/${o.id}/documents/${a.id}">${a.documents.files} file${a.documents.files === 1 ? '' : 's'}</a></small>` : html`<span class="muted small">No checklist</span>`}</td>
          <td>${status(a.mine)}${a.mine ? html`<small class="block muted">${fmtPoints(a.mine.total)} · ${fmtDateTime(a.mine.at)}</small>` : ''}</td>
          ${v.applications.some((x) => x.combined) ? html`<td>${a.combined ? html`<strong>${fmtPoints(a.combined.total)}</strong><small class="block muted">${a.combined.rank ? `Rank ${a.combined.rank}` : ''}</small>` : html`<span class="muted small">—</span>`}</td>` : ''}
          <td class="row-actions"><a class="btn sm ${a.mine?.submitted ? '' : 'primary'}" href="#/assess/${o.id}/rate/${a.id}">${a.mine?.submitted ? 'Your rating' : a.mine ? 'Continue' : 'Rate'}</a></td>
        </tr>`)}</tbody></table></div>` : html`<p class="muted">No applications to rate yet.</p>`}
    </section>
    <div class="cols wide-left">
      <section class="card">
        <h2>The position</h2>
        ${qualifications(o)}
      </section>
      <section class="card">
        <h2>Selection board</h2>
        <ul class="board-list">${v.panel.map((p) => html`<li><strong>${p.name}</strong>${p.title ? html` <span class="muted small">· ${p.title}</span>` : ''}</li>`)}</ul>
      </section>
    </div>`);
}

// ----- HR: the selection board card on an opening -----
// Name the assessors: any active staff account; each with an optional title. Someone who has rated
// stays on the board.
export function panelCard(o) {
  const p = o.assessment.panel || [];
  return html`<section class="card" id="panel-card">
    <div class="card-head"><h2>${icon('users')} Selection board</h2><button class="btn sm" id="edit-panel">${icon('edit', 14)} ${p.length ? 'Change' : 'Name the assessors'}</button></div>
    ${p.length ? html`<ul class="board-list">${p.map((x) => html`<li><strong>${x.name}</strong>${x.title ? html` <span class="muted small">· ${x.title}</span>` : ''} <span class="muted small">· ${x.role}${x.active ? '' : ' · account not active'}</span> ${x.rated ? badge(`${x.rated} rated`, 'green') : badge('Not rated yet', 'gray')}</li>`)}</ul>
      <p class="muted small">Each assessor rates each applicant on their own under <strong>Ratings to do</strong>, and sees nobody else's scores before submitting. ${combineLabel(o.assessment.combine)}${o.assessment.combine === 'consensus' ? ': you enter the agreed scores on each applicant\'s rating page.' : '.'}</p>`
      : html`<p class="muted small">No assessors named yet: ratings are the HR office's own. Name the selection board members (any staff account, not only HR); each is told on the bell and rates on their own.</p>`}
  </section>`;
}
export function wirePanel(el, o, done) {
  el.querySelector('#edit-panel')?.addEventListener('click', async () => {
    let list = (o.assessment.panel || []).map((x) => ({ userId: x.userId, name: x.name, title: x.title, rated: x.rated, role: x.role }));
    const { form } = modal({
      title: 'Selection board',
      subtitle: o.title,
      wide: true,
      submitLabel: 'Save the board',
      body: html`<div class="stack tight">
        <ul class="board-edit" id="board-edit"></ul>
        <label class="field"><span>Add an assessor</span><input type="search" id="board-q" placeholder="Type a name, position or office" autocomplete="off" /><span class="hint">Any active staff account. They are told on the bell and see only this opening's applicants, applications and documents.</span></label>
        <ul class="board-found" id="board-found" role="listbox" aria-label="Accounts found"></ul>
      </div>`,
      async onSubmit() {
        await api.put(`/api/hris/recruitment/openings/${o.id}/panel`, { assessors: list.map(({ userId, title }) => ({ userId, title })) });
        toast('Selection board saved. New assessors were told on the bell.');
        done();
      },
    });
    const box = form.querySelector('#board-edit');
    const draw = () => {
      mount(box, list.length ? html`${list.map((x, i) => html`<li data-i="${i}"><span class="grow"><strong>${x.name}</strong><small class="block muted">${x.role || ''}${x.rated ? ` · has rated ${x.rated}` : ''}</small></span>
        <input name="title" value="${x.title || ''}" maxlength="80" placeholder="Title (optional), e.g. Chairperson" aria-label="Title of ${x.name}" />
        ${x.rated ? html`<span class="muted small" title="Their ratings are part of the result">Stays</span>` : html`<button type="button" class="icon-btn" data-remove aria-label="Remove ${x.name}">${icon('trash', 16)}</button>`}</li>`)}` : html`<li class="muted small">No assessors yet.</li>`);
      box.querySelectorAll('[name=title]').forEach((inp) => inp.addEventListener('input', () => (list[Number(inp.closest('[data-i]').dataset.i)].title = inp.value)));
      box.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
        list.splice(Number(b.closest('[data-i]').dataset.i), 1);
        draw();
      }));
    };
    draw();
    const found = form.querySelector('#board-found');
    let timer = null;
    const search = async () => {
      const q = form.querySelector('#board-q').value.trim();
      if (!q) return mount(found, '');
      const people = (await api.get(`/api/hris/recruitment/assessors?q=${encodeURIComponent(q)}`)).filter((u) => !list.some((x) => x.userId === u.id)).slice(0, 8);
      mount(found, people.length ? html`${people.map((u) => html`<li><button type="button" class="board-pick" data-add="${u.id}"><strong>${u.name}</strong> <small class="muted">${[u.role, u.position, u.department].filter(Boolean).join(' · ')}</small></button></li>`)}` : html`<li class="muted small">Nobody found.</li>`);
      found.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
        const u = people.find((x) => x.id === b.dataset.add);
        list.push({ userId: u.id, name: u.name, title: '', role: u.role, rated: 0 });
        form.querySelector('#board-q').value = '';
        mount(found, '');
        draw();
      }));
    };
    form.querySelector('#board-q').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(search, 200);
    });
    form.querySelector('#board-q').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });
  });
}
