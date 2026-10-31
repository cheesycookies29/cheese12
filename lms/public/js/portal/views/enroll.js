// Student enrollment: browse open sections, request a seat, follow requests, drop.
import { api } from '../../api.js';
import { html, mount, modal, toast, fmtDate, fmtDateTime, statusBadge, option, formData, confirmDialog, empty } from '../../ui.js';
import { pageHead } from '../../shell.js';
import { seatText } from '../common.js';

const tabs = (active, termId) => html`<nav class="tabs">
  <a href="#/enroll${termId ? `?termId=${termId}` : ''}" class="${active === 'catalog' ? 'active' : ''}">Open sections</a>
  <a href="#/enroll/mine${termId ? `?termId=${termId}` : ''}" class="${active === 'mine' ? 'active' : ''}">My enrollment</a>
</nav>`;

function termPicker(terms, selected) {
  return html`<select id="term">${terms.map((t) => option(t.id, `${t.name}${t.current ? ' (current)' : ''}${t.open ? ' · enrollment open' : ''}`, t.id === selected))}</select>`;
}

const OUTCOME = { pending: 'Request a seat', enrolled: 'Enroll', waitlisted: 'Join waitlist' };

export async function catalogView(el, params, query) {
  const terms = await api.get('/api/enrollment/terms');
  const termId = query.termId || terms.find((t) => t.current)?.id || terms.at(-1)?.id || '';
  const data = await api.get(`/api/enrollment/catalog${termId ? `?termId=${termId}` : ''}`);
  const { term, sections, rules } = data;
  const onlyAvailable = query.all !== '1';
  const shown = onlyAvailable ? sections.filter((s) => s.eligibility.ok || s.mine) : sections;
  const units = sections.filter((s) => s.mine && ['enrolled', 'pending', 'waitlisted'].includes(s.mine.status)).reduce((n, s) => n + s.course.units, 0);

  mount(el, html`
    ${pageHead('Enrollment', term ? html`${term.name} · enrollment ${term.open ? html`<strong>open</strong>` : 'closed'} ${fmtDate(term.enrollStart)} – ${fmtDate(term.enrollEnd)}` : 'No terms yet.', terms.length > 1 ? termPicker(terms, termId) : '')}
    ${tabs('catalog', query.termId)}
    ${term ? html`<div class="notice"><p>
      ${term.open ? '' : html`<strong>Enrollment for this term is closed.</strong> `}
      You hold <strong>${units}</strong>${rules.maxUnits ? ` of ${rules.maxUnits}` : ''} units this term.
      ${rules.requireApproval ? 'Requests are reviewed by the registrar before you are enrolled.' : 'A free seat enrolls you at once.'}
      ${rules.allowWaitlist ? 'Full sections take a waitlist; you move up automatically when a seat frees up.' : ''}
    </p></div>` : ''}
    <div class="toolbar">
      <input type="search" id="q" placeholder="Search course, teacher or day" />
      <label class="inline"><input type="checkbox" id="all" ${onlyAvailable ? '' : 'checked'} /> Show sections I can't take, and why</label>
    </div>
    ${shown.length ? html`<div class="card scroll-x"><table class="table">
      <thead><tr><th>Course</th><th>Section</th><th>Schedule</th><th>Seats</th><th></th></tr></thead>
      <tbody>${shown.map((s) => html`<tr>
        <td><strong class="mono">${s.course.code}</strong> ${s.course.title}<small>${s.course.units} units${s.course.prerequisites.length ? ` · requires ${s.course.prerequisites.join(', ')}` : ''}</small></td>
        <td><strong>${s.name}</strong><small>${s.teacher?.name || 'Teacher to be assigned'}</small></td>
        <td>${s.schedule}<small>${s.room}</small></td>
        <td>${seatText(s)}${s.needsKey ? html`<small>🔑 Needs an enrollment key</small>` : ''}</td>
        <td class="row-actions">${s.mine
          ? statusBadge(s.mine.status, s.mine.statusLabel)
          : s.eligibility.ok
            ? html`<button class="btn ${s.eligibility.outcome === 'waitlisted' ? '' : 'primary'}" data-enroll="${s.id}">${OUTCOME[s.eligibility.outcome]}</button>`
            : html`<span class="reason">${s.eligibility.reason}</span>`}</td>
      </tr>`)}</tbody>
    </table></div>` : empty(sections.length ? 'No sections you can take right now' : 'No sections offered yet', sections.length ? 'Tick “Show sections I can’t take” to see the reasons.' : '')}`);

  el.querySelector('#term')?.addEventListener('change', (e) => (location.hash = `#/enroll?termId=${e.target.value}`));
  el.querySelector('#all').addEventListener('change', (e) => (location.hash = `#/enroll?${new URLSearchParams({ ...(query.termId ? { termId: query.termId } : {}), ...(e.target.checked ? { all: '1' } : {}) })}`));
  el.querySelector('#q').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    el.querySelectorAll('tbody tr').forEach((tr) => (tr.hidden = q && !tr.textContent.toLowerCase().includes(q)));
  });
  el.querySelectorAll('[data-enroll]').forEach((btn) => btn.addEventListener('click', () => {
    const s = sections.find((x) => x.id === btn.dataset.enroll);
    const outcome = s.eligibility.outcome;
    modal({
      title: `${OUTCOME[outcome]}: ${s.course.code} ${s.name}`,
      subtitle: `${s.course.title} · ${s.schedule} · ${s.teacher?.name || 'teacher to be assigned'}`,
      body: html`<div class="stack tight">
        ${outcome === 'waitlisted' ? html`<p>This section is full. You will be <strong>#${s.waitlisted + 1}</strong> on the waitlist and move up automatically when a seat frees up.</p>` : ''}
        ${outcome === 'pending' ? html`<p>The registrar reviews your request. You will see it under <strong>My enrollment</strong>.</p>` : ''}
        ${outcome === 'enrolled' ? html`<p>A seat is free; you will be enrolled right away.</p>` : ''}
        ${s.needsKey ? html`<label class="field"><span>Enrollment key</span><input name="key" autocomplete="off" required /><span class="hint">Your teacher or the registrar gives you this key.</span></label>` : ''}
      </div>`,
      submitLabel: OUTCOME[outcome],
      async onSubmit(form) {
        const e = await api.post('/api/enrollment', { sectionId: s.id, key: formData(form).key });
        toast(`${s.course.code} ${s.name}: ${e.statusLabel.toLowerCase()}${e.position ? ` (#${e.position} in line)` : ''}.`);
        catalogView(el, params, query);
      },
    });
  }));
}

export async function myEnrollmentView(el, params, query) {
  const terms = await api.get('/api/enrollment/terms');
  const termId = query.termId || terms.find((t) => t.current)?.id || terms.at(-1)?.id || '';
  const list = await api.get(`/api/enrollment/mine${termId ? `?termId=${termId}` : ''}`);
  const sum = (statuses) => list.filter((e) => statuses.includes(e.status)).reduce((n, e) => n + e.section.course.units, 0);
  mount(el, html`
    ${pageHead('Enrollment', 'Your requests and classes for the term, with every step on record.', terms.length > 1 ? termPicker(terms, termId) : '')}
    ${tabs('mine', query.termId)}
    <div class="stats small">
      <div><small>Enrolled units</small><strong>${sum(['enrolled', 'completed'])}</strong></div>
      <div><small>Pending</small><strong>${sum(['pending'])}</strong></div>
      <div><small>Waitlisted</small><strong>${sum(['waitlisted'])}</strong></div>
    </div>
    ${list.length ? html`<div class="card scroll-x"><table class="table">
      <thead><tr><th>Class</th><th>Schedule</th><th>Units</th><th>Status</th><th>Last update</th><th></th></tr></thead>
      <tbody>${list.map((e) => html`<tr>
        <td><strong>${e.section.course.code} ${e.section.name}</strong><small>${e.section.course.title} · ${e.section.teacher?.name || 'Teacher to be assigned'}</small></td>
        <td>${e.section.schedule}<small>${e.section.room}</small></td>
        <td>${e.section.course.units}</td>
        <td>${statusBadge(e.status, e.statusLabel)}${e.position ? html`<small>#${e.position} in line</small>` : ''}${e.finalGrade != null ? html`<small>Final grade ${e.finalGrade}</small>` : ''}</td>
        <td>${fmtDateTime(e.updatedAt)}<small>${e.history.at(-1)?.note || ''}</small></td>
        <td class="row-actions">${e.canDrop ? html`<button class="btn danger ghost" data-drop="${e.id}">${e.status === 'enrolled' ? 'Drop' : 'Withdraw'}</button>` : ''}</td>
      </tr>`)}</tbody>
    </table></div>` : empty('Nothing yet for this term', 'Request sections under Open sections.')}`);
  el.querySelector('#term')?.addEventListener('change', (ev) => (location.hash = `#/enroll/mine?termId=${ev.target.value}`));
  el.querySelectorAll('[data-drop]').forEach((b) => b.addEventListener('click', async () => {
    const e = list.find((x) => x.id === b.dataset.drop);
    const what = `${e.section.course.code} ${e.section.name}`;
    const msg = e.status === 'enrolled' ? `Drop ${what}? Your seat goes to the next student on the waitlist.` : `Withdraw your request for ${what}?`;
    if (!(await confirmDialog(msg, { confirmLabel: e.status === 'enrolled' ? 'Drop class' : 'Withdraw' }))) return;
    try {
      await api.post(`/api/enrollment/${e.id}/drop`);
      toast(`${what} ${e.status === 'enrolled' ? 'dropped' : 'withdrawn'}.`);
      myEnrollmentView(el, params, query);
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
}
