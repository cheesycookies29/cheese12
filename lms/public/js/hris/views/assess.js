// Recruitment: rating applicants, the comparative list, the applicant profile and the pool of
// applicants (HR, permission hris.recruitment; server/recruitment-assess.js), and the Assessment
// templates card of HR settings (hris.settings). Requests PL-018, PL-019, PL-020, part of PL-021, PL-066.
//  - Rate: a score from 0 to 100 per criterion of the opening's template, with a comment; the weighted
//    total (Σ score × weight / 100, never above 100) and the rank update as HR types.
//  - Comparative list: the rated applicants ranked by total, a column per criterion; CSV, and a
//    print on A4 landscape with the school header, "as of" and the signature line from settings.
//  - Applicant profile: one person, printable on A4; internal remarks and ratings only when ticked.
//  - Pool of applicants: search and filters, Invite to apply (a bell notice), add by hand (only
//    people who opted in) and remove, each with a reason.
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, fmtDate, fmtDateTime, badge, toast, modal, downloadFile, toCsv, today, option } from '../../ui.js';
import { can } from '../state.js';
import { brandProduct } from '../../brand.js';
import { weightedTotal, weightTotal, fmtPoints, ASSESSMENT_LIMITS, EXAMPLE_NOTE, SCORE_MAX, ranksOf } from '/shared/recruitment-assess.js';
import { applicationBadge } from './jobs.js';

const BACK = ['/recruitment', 'Job openings'];
const localDay = (iso) => today(new Date(iso));
const longDate = (ymd) => fmtDate(ymd, { month: 'long', day: 'numeric', year: 'numeric' });
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// The school's header on printed pages: the seal (when the school has one), its name and address.
const schoolHead = (school, title, lines = []) => html`<header class="as-head">
  ${ctx.info.branding?.logo ? html`<img src="${ctx.info.branding.logo}" alt="" />` : ''}
  <div>
    <strong class="as-school">${school.name}</strong>${school.address ? html`<span>${school.address}</span>` : ''}
    <strong class="as-title">${title}</strong>
    ${lines.filter(Boolean).map((l) => html`<span>${l}</span>`)}
  </div>
</header>`;

// A rating as a short badge, "87.50", with "Rank 1" under it (and "so far" while not every criterion has a score), or "Not rated".
export const ratingBadge = (r) => (r ? html`<span class="badge ${r.complete ? 'brand' : 'amber'}" title="${r.complete ? 'Weighted total, out of 100' : 'Not every criterion has a score yet'}">${fmtPoints(r.total)}</span><small class="block muted">${r.rank ? `Rank ${r.rank}` : ''}${r.complete ? '' : `${r.rank ? ' · ' : ''}so far`}</small>` : html`<span class="muted small">Not rated</span>`);

// ----- Rate one application -----
export async function ratingView(el, { id, appId }) {
  const v = await api.get(`/api/hris/recruitment/applications/${appId}/rating`);
  const { application: a, opening: o, template: tpl } = v;
  const head = (sub) => pageHead(`Rate ${a.name}`, sub, '', [BACK, [`/recruitment/${o.id}`, o.title]]);
  if (!tpl) {
    return mount(el, html`${head(o.title)}<div class="card empty">${icon('clipboard', 40)}<h2>No assessment template yet</h2><p>Choose a position category and an assessment template for this opening first.</p><p><a class="btn primary" href="#/recruitment/${o.id}/edit">${icon('edit', 16)} Edit the opening</a></p></div>`);
  }
  const blocked = a.own ? 'This is your own application: another HR person rates it.' : a.removed ? 'This applicant was removed.' : a.status === 'withdrawn' ? 'The applicant withdrew this application.' : '';
  const r = v.rating;
  const score = (c) => r?.scores?.[c.id]?.score ?? '';
  const comment = (c) => r?.scores?.[c.id]?.comment ?? '';
  const first = tpl.criteria[0]?.id;
  mount(el, html`
    ${head(html`${o.title} · ${applicationBadge(a)}`)}
    <div class="notice info as-tpl-note">${icon('clipboard', 18)}<div>
      <p><strong>${tpl.name}</strong> <span class="muted small">· version ${tpl.version}${tpl.categoryLabel ? ` · ${tpl.categoryLabel}` : ''}</span> ${tpl.example ? badge('Example', 'amber') : ''}</p>
      <p class="small">${tpl.frozen ? `Fixed for this opening since its first rating (${fmtDate(localDay(tpl.frozenAt))}): changes to the template since do not change these ratings.` : 'The first rating at this opening fixes this version of the template for it: later changes to the template will not change its ratings.'}${tpl.example ? ` ${EXAMPLE_NOTE}` : ''}</p>
    </div></div>
    <div class="stats as-stats">
      <div class="card"><small>Weighted total</small><strong id="as-total">${fmtPoints(r?.total ?? 0)}</strong><small class="muted">out of 100</small></div>
      <div class="card"><small>Rank at this opening</small><strong id="as-rank">${v.rank ? `${v.rank} of ${v.rated}` : '—'}</strong><small class="muted">by weighted total</small></div>
      <div class="card"><small>Rated by</small><strong class="as-who">${r ? r.by : '—'}</strong><small class="muted">${r ? fmtDateTime(r.at) : 'Not rated yet'}</small></div>
    </div>
    <form class="card" id="rate-form" novalidate>
      <div class="card-head"><h2>Scores</h2><span class="muted small">Each criterion 0 to ${SCORE_MAX}; points = score × weight ÷ 100</span></div>
      ${blocked ? html`<div class="notice warn"><p>${blocked}</p></div>` : ''}
      <ol class="as-rate-list">${tpl.criteria.map((c) => html`<li class="as-rate" data-c="${c.id}">
        <div class="as-rate-what"><strong>${c.label}</strong> <span class="badge">${c.weight}%</span>${c.description ? html`<small class="block muted">${c.description}</small>` : ''}</div>
        <label class="field as-score"><span>Score</span><input type="number" name="score" min="0" max="${SCORE_MAX}" step="0.01" inputmode="decimal" value="${score(c)}" ${blocked ? 'disabled' : ''} aria-label="${c.label}: score from 0 to ${SCORE_MAX}" /></label>
        <div class="as-points"><small class="muted">Points</small><strong data-points>${score(c) === '' ? '—' : fmtPoints(r?.points?.[c.id])}</strong></div>
        <label class="field as-comment"><span>Comment (optional)</span><input name="comment" maxlength="500" value="${comment(c)}" ${blocked ? 'disabled' : ''} placeholder="${c.id === first ? 'e.g. Master\'s in IT; two years of part-time teaching.' : ''}" /></label>
      </li>`)}</ol>
      <p class="muted small">${icon('lock', 12)} The applicant does not see scores, comments or the rank. A criterion left blank is not rated yet: the total counts only what has a score.</p>
      <p class="form-error" hidden></p>
      <div class="actions end">
        <a class="btn" href="#/recruitment/${o.id}">Cancel</a>
        <a class="btn" href="#/recruitment/${o.id}/comparative">${icon('table', 16)} Comparative list</a>
        ${blocked ? '' : html`<button class="btn primary" type="submit">${icon('check', 16)} Save rating</button>`}
      </div>
      ${r?.history?.length ? html`<p class="muted small">Earlier ratings: ${r.history.map((x) => `${fmtPoints(x.total)} by ${x.by} on ${fmtDate(localDay(x.at))}`).join('; ')}.</p>` : ''}
    </form>`);
  const form = el.querySelector('#rate-form');
  const read = () => Object.fromEntries([...form.querySelectorAll('[data-c]')].map((li) => [li.dataset.c, { score: li.querySelector('[name=score]').value, comment: li.querySelector('[name=comment]').value }]));
  // The total and the rank as HR types (the server works them out again when saving).
  const others = (await api.get(`/api/hris/recruitment/openings/${o.id}/comparative`).catch(() => ({ rows: [] }))).rows.filter((x) => x.id !== a.id);
  const live = () => {
    const scores = read();
    const clean = Object.fromEntries(Object.entries(scores).filter(([, x]) => x.score !== '' && Number(x.score) >= 0 && Number(x.score) <= SCORE_MAX).map(([k, x]) => [k, { score: Number(x.score) }]));
    const sum = weightedTotal(tpl.criteria, clean);
    el.querySelector('#as-total').textContent = fmtPoints(sum.total);
    form.querySelectorAll('[data-c]').forEach((li) => (li.querySelector('[data-points]').textContent = li.dataset.c in sum.points ? fmtPoints(sum.points[li.dataset.c]) : '—'));
    const ranks = ranksOf([...others.map((x) => ({ id: x.id, total: x.total })), ...(sum.given ? [{ id: a.id, total: sum.total }] : [])]);
    el.querySelector('#as-rank').textContent = sum.given ? `${ranks.get(a.id)} of ${others.length + 1}` : '—';
  };
  form.addEventListener('input', live);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = form.querySelector('.form-error');
    try {
      const saved = await api.put(`/api/hris/recruitment/applications/${a.id}/rating`, { scores: read() });
      toast(`Rating saved: ${fmtPoints(saved.rating.total)} out of 100, rank ${saved.rank} of ${saved.rated}.`);
      location.hash = `#/recruitment/${o.id}`;
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });
}

// ----- The comparative list of an opening (screen, CSV, print on A4 landscape) -----
export async function comparativeView(el, { id }) {
  const v = await api.get(`/api/hris/recruitment/openings/${id}/comparative`);
  const o = v.opening;
  const crit = v.template?.criteria || [];
  const lines = [`${o.title}${o.plantillaItem ? ` · Item no. ${o.plantillaItem}` : ''}${o.salaryGrade ? ` · SG ${o.salaryGrade}` : ''}`, [o.office, o.campusName].filter(Boolean).join(' · '), `As of ${longDate(v.asOf)}${v.template ? ` · ${v.template.name}, version ${v.template.version}` : ''}`];
  const head = schoolHead(v.school, v.print.title, lines);
  const csv = () => toCsv([
    ['Rank', 'Applicant', 'Internal or external', ...crit.map((c) => `${c.label} (${c.weight}%)`), 'Weighted total', 'Complete', 'Stage', 'Rated by', 'Rated on'],
    ...v.rows.map((r) => [r.rank, r.name, r.internal ? 'Internal' : 'External', ...crit.map((c) => r.scores[c.id] ?? ''), fmtPoints(r.total), r.complete ? 'Yes' : 'No', r.stageLabel, r.by, localDay(r.at)]),
  ]);
  mount(el, html`
    <div class="no-print">
      ${pageHead('Comparative list', `${o.title}: rated applicants ranked by weighted total. Prints on A4 landscape; the headings repeat on every page.`, html`
        <button class="btn" id="export" ${v.rows.length ? '' : 'disabled'}>${icon('download', 16)} Export CSV</button>
        <button class="btn primary" id="do-print" ${v.rows.length ? '' : 'disabled'}>${icon('file', 16)} Print</button>`, [BACK, [`/recruitment/${o.id}`, o.title]])}
      ${v.unrated ? html`<div class="notice info"><p>${v.unrated} application${v.unrated === 1 ? ' is' : 's are'} not rated yet and not on the list. Rate them from the opening.</p></div>` : ''}
      ${v.template?.example ? html`<div class="notice warn"><p><strong>${v.template.name}</strong> is an example template. ${EXAMPLE_NOTE}</p></div>` : ''}
    </div>
    ${v.rows.length ? html`<article class="as-doc as-comparative">
      <div class="as-screen-head">${head}</div>
      <div class="table-scroll" tabindex="0" role="region" aria-label="Comparative list">
      <table class="as-table no-stack">
        <thead>
          <tr class="as-head-row"><th colspan="${crit.length + 5}">${head}</th></tr>
          <tr><th class="num">Rank</th><th class="as-who-col">Applicant</th><th>Internal or external</th>${crit.map((c) => html`<th class="num">${c.label}<small>${c.weight}%</small></th>`)}<th class="num">Weighted total</th><th>Stage</th></tr>
        </thead>
        <tbody>${v.rows.map((r) => html`<tr>
          <td class="num"><strong>${r.rank}</strong></td>
          <td>${r.userId ? html`<a href="#/recruitment/profile/${r.userId}">${r.name}</a>` : r.name}${r.complete ? '' : html`<small class="block as-incomplete">Not every criterion rated</small>`}</td>
          <td>${r.internal ? 'Internal' : 'External'}</td>
          ${crit.map((c) => html`<td class="num">${r.scores[c.id] ?? '—'}</td>`)}
          <td class="num"><strong>${fmtPoints(r.total)}</strong></td>
          <td>${r.stageLabel}</td>
        </tr>`)}</tbody>
      </table>
      </div>
      <p class="as-note">Each criterion is scored 0 to 100; the weighted total is the sum of score × weight ÷ 100, out of 100. Equal totals share a rank.</p>
      <div class="as-signs">
        <div class="as-sign"><span class="as-sign-cap">${v.print.signCaption}${v.print.signCaption ? ':' : ''}</span><span class="as-sign-line">${v.print.signName}</span><span class="as-sign-title">${v.print.signTitle}</span></div>
      </div>
      <p class="as-foot">Printed from ${brandProduct('People')} on ${longDate(today())} by ${ctx.user?.name || ''}.</p>
    </article>` : html`<div class="card empty">${icon('table', 40)}<h2>No rated applicants yet</h2><p>Rate the applicants from the opening: choose <strong>Rate</strong> on each row.</p><p><a class="btn" href="#/recruitment/${o.id}">Back to ${o.title}</a></p></div>`}`);
  el.querySelector('#export')?.addEventListener('click', () => downloadFile(`comparative-list-${slug(o.title)}-${today()}.csv`, csv()));
  el.querySelector('#do-print')?.addEventListener('click', () => window.print());
}

// ----- The applicant profile (PL-019) -----
export async function profileView(el, { userId }, query = {}) {
  const remarks = query.remarks === '1';
  const ratings = query.ratings === '1';
  const p = await api.get(`/api/hris/recruitment/profiles/${userId}?remarks=${remarks ? 1 : 0}&ratings=${ratings ? 1 : 0}`);
  const d = p.details;
  const emp = p.employee;
  const e = p.pool.entry;
  const dl = (rows) => html`<dl class="as-dl">${rows.filter(([, v]) => v !== '' && v != null && v !== false).map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
  const poolLine = e
    ? `In the pool since ${fmtDate(localDay(e.enteredAt))}, until ${fmtDate(localDay(e.until))}${e.how === 'hr' ? ` (added by ${e.addedBy}: ${e.reason})` : ' (after an application ended Not selected or Not qualified)'}${e.invites.length ? `. Invited to: ${e.invites.map((x) => `${x.title} (${fmtDate(localDay(x.at))})`).join(', ')}` : ''}.`
    : p.pool.optedIn ? `Agreed on ${fmtDate(localDay(p.pool.optedInAt))} to be kept in the pool; not in it now.` : 'Did not ask to be kept in the pool.';
  const appBlock = (a) => html`<section class="as-app">
    <div class="as-app-head"><strong>${a.title}</strong><span class="muted small">${[a.office, a.campusName, a.categoryLabel].filter(Boolean).join(' · ')}</span></div>
    ${dl([['Applied', fmtDate(localDay(a.createdAt))], ['Internal or external', a.internal ? 'Internal' : 'External'], ['Stage', a.outcome ? '' : a.stageLabel], ['Outcome', a.outcome ? `${a.outcome.label} (${a.outcome.meaning})` : 'Not decided yet'], ['Cover note', a.note]])}
    ${a.rating ? html`<div class="table-scroll as-mini-wrap"><table class="as-table as-mini no-stack"><thead><tr><th>Criterion</th><th class="num">Weight</th><th class="num">Score</th><th class="num">Points</th><th>Comment</th></tr></thead><tbody>
      ${a.rating.criteria.map((c) => html`<tr><td>${c.label}</td><td class="num">${c.weight}%</td><td class="num">${a.rating.scores[c.id]?.score ?? '—'}</td><td class="num">${a.rating.points[c.id] != null ? fmtPoints(a.rating.points[c.id]) : '—'}</td><td>${a.rating.scores[c.id]?.comment || ''}</td></tr>`)}
      <tr class="as-total-row"><td colspan="3"><strong>Weighted total</strong>${a.rating.rank ? ` · rank ${a.rating.rank} at this opening` : ''}${a.rating.complete ? '' : ' · not every criterion rated'}</td><td class="num"><strong>${fmtPoints(a.rating.total)}</strong></td><td class="small">${a.rating.templateName} · rated by ${a.rating.by}, ${fmtDate(localDay(a.rating.at))}</td></tr>
    </tbody></table></div>` : ''}
    <ol class="as-history">${a.history.map((x) => html`<li><span class="as-h-when">${fmtDateTime(x.at)}</span> <strong>${x.back ? `Back to ${x.stageLabel}` : x.stageLabel}</strong>${x.by ? html` <span class="muted">· ${x.by}</span>` : ''}
      ${x.note ? html`<div class="small">Note to the applicant: ${x.note}</div>` : ''}
      ${x.reason ? html`<div class="small as-internal">Reason for moving back: ${x.reason}</div>` : ''}
      ${x.remark ? html`<div class="small as-internal">${icon('lock', 11)} Internal remark: ${x.remark}</div>` : ''}</li>`)}</ol>
  </section>`;
  mount(el, html`
    <div class="no-print">
      ${pageHead('Applicant profile', p.name, html`<button class="btn primary" id="do-print">${icon('file', 16)} Print</button>`, [['/recruitment/applicants', 'Applicant accounts']])}
      <div class="card toolbar as-tools">
        <label class="check-inline"><input type="checkbox" id="opt-remarks" ${remarks ? 'checked' : ''} /> Include internal remarks</label>
        <label class="check-inline"><input type="checkbox" id="opt-ratings" ${ratings ? 'checked' : ''} /> Include ratings</label>
        <span class="muted small">Shown here as it prints, on A4. Internal remarks and ratings are left out unless ticked.</span>
        <span class="grow"></span>
        ${e ? html`<button class="btn sm danger ghost" id="pool-remove">Remove from the pool</button>` : p.pool.optedIn ? html`<button class="btn sm" id="pool-add">${icon('plus', 14)} Add to the pool</button>` : ''}
      </div>
    </div>
    <article class="as-doc as-profile">
      ${schoolHead(p.school, 'Applicant profile', [`Printed ${longDate(localDay(p.printedAt))} by ${p.printedBy}`])}
      <h2 class="as-name">${p.name} ${p.internal ? badge('Internal', 'brand') : badge('External', 'blue')}</h2>
      <div class="as-cols">
        <section><h3>Contact</h3>${dl([['Email', p.email || '—'], ['Mobile', p.phone || '—']])}</section>
        ${emp
          ? html`<section><h3>Employee record</h3>${dl([['Position', emp.position || '—'], ['Salary grade', emp.salaryGrade ? `SG ${emp.salaryGrade}-${emp.step || 1}` : '—'], ['Appointment', emp.appointment || '—'], ['Campus', emp.campusName], ['Employee no.', emp.employeeNo]])}
              ${can('employees.view') ? html`<p class="no-print small"><a href="#/employees/${emp.id}">${icon('external', 12)} Open the employee record</a></p>` : ''}</section>`
          : html`<section><h3>Given at sign-up</h3>${d ? dl([['Sex', d.sexLabel], ['Date of birth', d.birthDate ? fmtDate(d.birthDate) : ''], ['Home address', d.address], ['Highest educational attainment', d.educationLabel], ['Preferred campus', d.campusName]]) : html`<p class="muted small">Nothing besides name, email and mobile.</p>`}</section>`}
        <section><h3>Account</h3>${p.account.employee
          ? dl([['Account', 'Employee account (does not close)'], ['Last signed in', p.account.lastLoginAt ? fmtDateTime(p.account.lastLoginAt) : 'Never']])
          : dl([['Signed up', fmtDate(localDay(p.account.createdAt))], ['Agreed to the privacy notice', p.account.consentAt ? fmtDate(localDay(p.account.consentAt)) : ''], ['Open until', `${fmtDate(localDay(p.account.expiresAt))}${p.account.keptOpenForPool ? ' (kept open for the pool)' : ''}`], ['Status', p.account.status === 'open' ? 'Open' : `Closed${p.account.removeAfter ? `, removed on ${fmtDate(localDay(p.account.removeAfter))}` : ''}`], ['Last signed in', p.account.lastLoginAt ? fmtDateTime(p.account.lastLoginAt) : 'Never']])}</section>
        <section><h3>Pool of applicants</h3><p class="small">${poolLine}</p></section>
      </div>
      <h3 class="as-apps-title">Applications (${p.applications.length})</h3>
      ${p.applications.length ? p.applications.map(appBlock) : html`<p class="muted">No applications at your campuses.</p>`}
      ${p.elsewhere ? html`<p class="muted small">${p.elsewhere} more application${p.elsewhere === 1 ? '' : 's'} at other campuses.</p>` : ''}
      <p class="as-foot">Applicant profile from ${brandProduct('People')}. Confidential: for the school's HR office and selection board (Data Privacy Act of 2012).${remarks ? ' Includes internal remarks.' : ''}${ratings ? ' Includes ratings.' : ''}</p>
    </article>`);
  const go = () => {
    const q = new URLSearchParams();
    if (el.querySelector('#opt-remarks').checked) q.set('remarks', '1');
    if (el.querySelector('#opt-ratings').checked) q.set('ratings', '1');
    location.hash = `#/recruitment/profile/${userId}${q.size ? `?${q}` : ''}`;
  };
  el.querySelector('#opt-remarks').addEventListener('change', go);
  el.querySelector('#opt-ratings').addEventListener('change', go);
  el.querySelector('#do-print').addEventListener('click', () => window.print());
  const reload = () => profileView(el, { userId }, query);
  el.querySelector('#pool-add')?.addEventListener('click', () => reasonDialog({ title: 'Add to the pool of applicants', subtitle: `${p.name} agreed to be kept in the pool.`, label: 'Reason for adding them', placeholder: 'e.g. Strong applicant for the next Instructor I vacancy.', submit: 'Add to the pool', send: (reason) => api.post('/api/hris/recruitment/pool', { userId, reason }), done: () => { toast(`${p.name} is in the pool. They were told on the bell.`); reload(); } }));
  el.querySelector('#pool-remove')?.addEventListener('click', () => reasonDialog({ title: 'Remove from the pool of applicants', subtitle: p.name, label: 'Reason for removing them', placeholder: 'e.g. Asked by phone to be removed.', submit: 'Remove', danger: true, send: (reason) => api.post(`/api/hris/recruitment/pool/${e.id}/remove`, { reason }), done: () => { toast(`${p.name} is no longer in the pool.`); reload(); } }));
}

function reasonDialog({ title, subtitle, label, placeholder, submit, danger = false, send, done }) {
  const { form } = modal({
    title, subtitle, submitLabel: submit,
    body: html`<label class="field"><span>${label}<em>*</em></span><textarea name="reason" rows="3" maxlength="500" placeholder="${placeholder}" required></textarea><span class="hint">Kept in the audit log. The person is not shown it.</span></label>`,
    async onSubmit(f) {
      await send(f.reason.value);
      done();
    },
  });
  if (danger) form.querySelector('[type=submit]').classList.add('danger');
}

// ----- The pool of applicants (PL-020) -----
const POOL_FILTERS = ['q', 'category', 'education', 'campus', 'min', 'max', 'from', 'to'];
export async function poolView(el, _params, query = {}) {
  const f = Object.fromEntries(POOL_FILTERS.map((k) => [k, query[k] || '']));
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const v = await api.get(`/api/hris/recruitment/pool${qs ? `?${qs}` : ''}`);
  const sel = (name, label, list, all) => html`<label class="field"><span>${label}</span><select name="${name}">${option('', all, !f[name])}${list.map((x) => option(x.id, x.label || x.name, f[name] === x.id))}</select></label>`;
  mount(el, html`
    ${pageHead('Pool of applicants', `People who asked to be kept for other vacancies, for up to ${v.months} month${v.months === 1 ? '' : 's'}. They enter when an application ends Not selected or Not qualified. Invite them to apply for an open opening; they apply themselves.`, '', BACK)}
    <form class="card as-filters" id="pool-filters">
      <label class="field as-q"><span>Search</span><input type="search" name="q" value="${f.q}" placeholder="Name, email or an opening applied to" /></label>
      ${sel('category', 'Position category', v.categories, 'Any category')}
      ${sel('education', 'Education (at least)', v.education, 'Any')}
      ${sel('campus', 'Preferred campus', v.campuses, 'Any campus')}
      <div class="field as-range"><span>Best rating</span><div class="as-pair"><input type="number" name="min" min="0" max="100" step="0.01" value="${f.min}" placeholder="from" aria-label="Best rating from" /><input type="number" name="max" min="0" max="100" step="0.01" value="${f.max}" placeholder="to" aria-label="Best rating to" /></div></div>
      <div class="field as-range"><span>Entered the pool</span><div class="as-pair"><input type="date" name="from" value="${f.from}" aria-label="Entered from" /><input type="date" name="to" value="${f.to}" aria-label="Entered to" /></div></div>
      <div class="actions"><button class="btn primary sm" type="submit">${icon('search', 14)} Filter</button>${qs ? html`<a class="btn sm ghost" href="#/recruitment/pool">Clear</a>` : ''}</div>
    </form>
    ${v.entries.length
      ? html`<section class="card scroll-x"><p class="muted small">${v.entries.length} of ${v.total} in the pool.</p><table class="table as-pool">
          <thead><tr><th>Person</th><th>Qualifications given</th><th>Applied to</th><th>Best rating</th><th>In the pool</th><th></th></tr></thead>
          <tbody>${v.entries.map((x) => html`<tr data-entry="${x.id}">
            <td><a href="#/recruitment/profile/${x.userId}"><strong>${x.name}</strong></a> ${x.internal ? badge('Internal', 'brand') : ''}<small class="block muted">${[x.email, x.phone].filter(Boolean).join(' · ')}</small></td>
            <td>${x.qualifications.position ? html`${x.qualifications.position}${x.qualifications.salaryGrade ? ` · SG ${x.qualifications.salaryGrade}` : ''}<small class="block muted">${x.qualifications.campusName}</small>` : html`${x.qualifications.educationLabel || html`<span class="muted">—</span>`}${x.qualifications.campusName ? html`<small class="block muted">Prefers ${x.qualifications.campusName}</small>` : ''}`}</td>
            <td>${x.openings.map((o) => html`<span class="block small">${o.title} <span class="muted">· ${o.stageLabel}</span></span>`)}</td>
            <td>${x.bestRatings.length ? x.bestRatings.map((b) => html`<span class="block small"><strong>${fmtPoints(b.total)}</strong> <span class="muted">${b.categoryLabel}</span></span>`) : html`<span class="muted small">Not rated</span>`}</td>
            <td class="nowrap">${fmtDate(localDay(x.enteredAt))}<small class="block muted">until ${fmtDate(localDay(x.until))}${x.how === 'hr' ? ' · added by HR' : ''}</small>${x.invites.length ? html`<small class="block muted">${x.invites.length} invite${x.invites.length === 1 ? '' : 's'}</small>` : ''}</td>
            <td class="row-actions"><button class="btn sm primary" data-invite="${x.id}" ${x.accountOpen ? '' : 'disabled title="Their account has closed"'}>Invite to apply</button><button class="btn sm danger ghost" data-remove="${x.id}">Remove</button></td>
          </tr>`)}</tbody></table></section>`
      : html`<div class="card empty">${icon('users', 40)}<h2>${v.total ? 'Nobody in the pool matches' : 'Nobody in the pool yet'}</h2><p>${v.total ? 'Change or clear the filters.' : 'People tick "Keep me in the school\'s pool of applicants" when they sign up or under My applications. They enter the pool when an application ends Not selected or Not qualified.'}</p></div>`}`);
  el.querySelector('#pool-filters').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const next = new URLSearchParams(POOL_FILTERS.map((k) => [k, String(fd.get(k) || '').trim()]).filter(([, x]) => x));
    location.hash = `#/recruitment/pool${next.size ? `?${next}` : ''}`;
  });
  const find = (id) => v.entries.find((x) => x.id === id);
  const reload = () => poolView(el, _params, query);
  el.querySelectorAll('[data-invite]').forEach((b) => b.addEventListener('click', () => {
    const x = find(b.dataset.invite);
    const can2 = v.openings.filter((o) => (x.internal || o.audience === 'all') && !x.invites.some((i) => i.openingId === o.id) && !x.openings.some((ap) => ap.openingId === o.id && ap.status !== 'withdrawn'));
    modal({
      title: 'Invite to apply',
      subtitle: `${x.name} · in the pool until ${fmtDate(localDay(x.until))}`,
      submitLabel: 'Send the invitation',
      body: can2.length ? html`<div class="stack tight">
        <label class="field"><span>Opening</span><select name="openingId">${can2.map((o) => option(o.id, `${o.title} · ${o.campusName} · closes ${fmtDate(o.closingDate)}${o.audience === 'internal' ? ' · internal only' : ''}`, false))}</select><span class="hint">Open openings at your campuses${x.internal ? '' : ' that anyone may apply for'}.</span></label>
        <label class="field"><span>Note (optional)</span><textarea name="note" rows="3" maxlength="1000" placeholder="e.g. Your rating for the last opening was high; we would welcome your application."></textarea><span class="hint">From "HR office". They get a notice on the bell with a link to the opening, and apply themselves.</span></label>
      </div>` : html`<p>There is no open opening at your campuses to invite ${x.name} to${x.invites.length ? ' that they have not been invited to already' : ''}.</p>`,
      async onSubmit(form) {
        if (!form.openingId) return;
        await api.post(`/api/hris/recruitment/pool/${x.id}/invite`, { openingId: form.openingId.value, note: form.note.value });
        toast(`${x.name} was invited. They were told on the bell.`);
        reload();
      },
    });
  }));
  el.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
    const x = find(b.dataset.remove);
    reasonDialog({ title: 'Remove from the pool of applicants', subtitle: x.name, label: 'Reason for removing them', placeholder: 'e.g. Asked by phone to be removed.', submit: 'Remove', danger: true, send: (reason) => api.post(`/api/hris/recruitment/pool/${x.id}/remove`, { reason }), done: () => { toast(`${x.name} is no longer in the pool.`); reload(); } });
  }));
}

// ----- HR settings → Assessment templates (PL-018, PL-066) -----
// Position categories with their default template, the templates (criteria with weights that must
// total exactly 100%), and the captions of the printed comparative list. Its own Save.
export async function assessmentTemplatesCard(el) {
  const v = await api.get('/api/hris/recruitment/assessment');
  let cats = v.categories.map((x) => ({ ...x }));
  let tpls = v.templates.map((x) => ({ ...x, criteria: x.criteria.map((c) => ({ ...c })) }));
  const print = { ...v.print };
  const L = ASSESSMENT_LIMITS;
  const catName = (id) => cats.find((c) => c.id === id)?.label || '';
  const totalBadge = (t) => {
    const total = weightTotal(t.criteria.map((c) => ({ weight: Number(c.weight) || 0 })));
    return html`<span class="as-sum ${total === 100 ? 'ok' : 'bad'}" data-sum aria-live="polite">Total ${total}%${total === 100 ? '' : ' · must be 100%'}</span>`;
  };
  const critRow = (c, j, t) => html`<li class="as-crit" data-j="${j}">
    <label class="field"><span>Criterion</span><input name="label" value="${c.label}" maxlength="${L.label}" required /></label>
    <label class="field"><span>What it rates</span><input name="description" value="${c.description}" maxlength="${L.description}" /></label>
    <label class="field as-w"><span>Weight (%)</span><input type="number" name="weight" min="0.01" max="100" step="0.01" value="${c.weight}" required /></label>
    <span class="as-crit-tools">
      <button type="button" class="icon-btn" data-cup aria-label="Move ${c.label || 'this criterion'} up" ${j === 0 ? 'disabled' : ''}>${icon('up', 16)}</button>
      <button type="button" class="icon-btn" data-cdown aria-label="Move ${c.label || 'this criterion'} down" ${j === t.criteria.length - 1 ? 'disabled' : ''}>${icon('down', 16)}</button>
      <button type="button" class="icon-btn" data-cremove aria-label="Remove ${c.label || 'this criterion'}">${icon('trash', 16)}</button>
    </span>
  </li>`;
  const tplBlock = (t, i) => html`<section class="as-tpl ${t.retired ? 'retired' : ''}" data-t="${i}">
    <div class="as-tpl-head">
      <label class="field as-tpl-name"><span>Template name</span><input name="name" value="${t.name}" maxlength="${L.name}" required /></label>
      <label class="field"><span>Position category</span><select name="categoryId">${option('', 'None', !t.categoryId)}${cats.filter((c) => c.id).map((c) => option(c.id, c.label, c.id === t.categoryId))}</select></label>
      <span class="as-tpl-meta">
        ${t.example ? badge('Example', 'amber') : ''}
        ${t.id ? html`<small class="muted">Version ${t.version}${t.openings ? ` · ${t.openings} opening${t.openings === 1 ? '' : 's'}` : ''}${t.fixedOpenings ? ` · fixed at ${t.fixedOpenings} rated` : ''}</small>` : html`<small class="muted">New</small>`}
        <label class="check-inline"><input type="checkbox" name="retired" ${t.retired ? 'checked' : ''} /> Retired</label>
        ${t.openings ? '' : html`<button type="button" class="btn sm danger ghost" data-tremove>${icon('trash', 14)} Remove</button>`}
      </span>
    </div>
    ${t.example ? html`<p class="small as-example">${icon('alert', 14)} ${EXAMPLE_NOTE}</p>` : ''}
    <ol class="as-crit-list">${t.criteria.map((c, j) => critRow(c, j, t))}</ol>
    <div class="as-tpl-foot"><button type="button" class="btn sm" data-cadd>${icon('plus', 14)} Add a criterion</button>${totalBadge(t)}</div>
  </section>`;
  const draw = () => mount(el, html`<section class="card" id="assessment-templates">
    <div class="card-head"><h2>Assessment templates</h2><span class="muted small">How applicants are rated, per position category</span></div>
    <p class="muted small">Each template lists the criteria applicants are rated on, each with a weight. The weights must total exactly 100%. Each criterion is scored 0 to 100, so the weighted total (score × weight ÷ 100, added up) is never more than 100. An opening keeps a copy of its template from its first rating, so changing a template here never changes past ratings.</p>
    <form id="assessment-form" novalidate>
      <h3>Position categories</h3>
      <p class="muted small">Every job opening has one. A new opening in a category starts with its default template.</p>
      <ul class="as-cats">${cats.map((c, i) => html`<li class="as-cat" data-k="${i}">
        <label class="field"><span>Category</span><input name="label" value="${c.label}" maxlength="${L.label}" required /></label>
        <label class="field"><span>Default template</span><select name="templateId">${option('', 'None', !c.templateId)}${tpls.filter((t) => !t.retired && t.id).map((t) => option(t.id, t.name, t.id === c.templateId))}</select></label>
        <span class="as-cat-tools">${c.openings ? html`<small class="muted">${c.openings} opening${c.openings === 1 ? '' : 's'}</small>` : html`<button type="button" class="btn sm danger ghost" data-kremove>${icon('trash', 14)} Remove</button>`}</span>
      </li>`)}</ul>
      <p><button type="button" class="btn sm" id="add-cat">${icon('plus', 14)} Add a category</button></p>
      <h3>Templates</h3>
      <div class="as-tpls">${tpls.map(tplBlock)}</div>
      <p><button type="button" class="btn sm" id="add-tpl">${icon('plus', 14)} Add a template</button></p>
      <h3>Printed comparative list</h3>
      <div class="grid">
        <label class="field span-3"><span>Title</span><input name="p-title" value="${print.title}" maxlength="${L.caption}" /></label>
        <label class="field"><span>Signature caption</span><input name="p-signCaption" value="${print.signCaption}" maxlength="${L.caption}" placeholder="e.g. Prepared by" /></label>
        <label class="field"><span>Name on the signature line</span><input name="p-signName" value="${print.signName}" maxlength="${L.caption}" placeholder="Blank: signed by hand" /></label>
        <label class="field"><span>Title under the line</span><input name="p-signTitle" value="${print.signTitle}" maxlength="${L.caption}" placeholder="e.g. HRMPSB Secretariat" /></label>
      </div>
      <p class="muted small">One assessor per application in this version: several assessors with an average is not available yet.</p>
      <p class="form-error" hidden></p>
      <div class="actions end"><button class="btn primary" type="submit">Save assessment templates</button></div>
    </form>
  </section>`);
  const form = () => el.querySelector('#assessment-form');
  // Keep what was typed before redrawing.
  const read = () => {
    const f = form();
    f.querySelectorAll('[data-k]').forEach((li) => Object.assign(cats[Number(li.dataset.k)], { label: li.querySelector('[name=label]').value, templateId: li.querySelector('[name=templateId]').value }));
    f.querySelectorAll('[data-t]').forEach((sec) => {
      const t = tpls[Number(sec.dataset.t)];
      Object.assign(t, { name: sec.querySelector('[name=name]').value, categoryId: sec.querySelector('[name=categoryId]').value, retired: sec.querySelector('[name=retired]').checked });
      sec.querySelectorAll('[data-j]').forEach((li) => Object.assign(t.criteria[Number(li.dataset.j)], { label: li.querySelector('[name=label]').value, description: li.querySelector('[name=description]').value, weight: li.querySelector('[name=weight]').value }));
    });
    for (const k of ['title', 'signCaption', 'signName', 'signTitle']) print[k] = f.querySelector(`[name=p-${k}]`).value;
  };
  const redraw = () => {
    draw();
    wire();
  };
  const wire = () => {
    const f = form();
    const tAt = (b) => Number(b.closest('[data-t]').dataset.t);
    const jAt = (b) => Number(b.closest('[data-j]').dataset.j);
    const act = (sel, fn) => f.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => {
      read();
      fn(b);
      redraw();
    }));
    act('[data-cup]', (b) => { const c = tpls[tAt(b)].criteria; const j = jAt(b); [c[j - 1], c[j]] = [c[j], c[j - 1]]; });
    act('[data-cdown]', (b) => { const c = tpls[tAt(b)].criteria; const j = jAt(b); [c[j + 1], c[j]] = [c[j], c[j + 1]]; });
    act('[data-cremove]', (b) => tpls[tAt(b)].criteria.splice(jAt(b), 1));
    act('[data-cadd]', (b) => tpls[tAt(b)].criteria.push({ id: '', label: '', description: '', weight: '' }));
    act('[data-tremove]', (b) => tpls.splice(tAt(b), 1));
    act('[data-kremove]', (b) => cats.splice(Number(b.closest('[data-k]').dataset.k), 1));
    act('#add-cat', () => cats.push({ id: '', label: '', templateId: '', openings: 0 }));
    act('#add-tpl', () => tpls.push({ id: '', name: '', categoryId: '', version: 1, openings: 0, fixedOpenings: 0, criteria: [{ id: '', label: '', description: '', weight: 100 }] }));
    // The total of each template as its weights are typed.
    f.querySelectorAll('[data-t]').forEach((sec) => sec.addEventListener('input', (e) => {
      if (e.target.name !== 'weight') return;
      const total = weightTotal([...sec.querySelectorAll('[name=weight]')].map((x) => ({ weight: Number(x.value) || 0 })));
      const s = sec.querySelector('[data-sum]');
      s.className = `as-sum ${total === 100 ? 'ok' : 'bad'}`;
      s.textContent = `Total ${total}%${total === 100 ? '' : ' · must be 100%'}`;
    }));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      read();
      const errEl = f.querySelector('.form-error');
      try {
        const saved = await api.put('/api/hris/recruitment/assessment', {
          categories: cats.map(({ id, label, templateId }) => ({ ...(id ? { id } : {}), label, templateId })),
          templates: tpls.map(({ id, name, categoryId, retired, example, criteria }) => ({ ...(id ? { id } : {}), name, categoryId, retired: Boolean(retired), ...(example ? { example } : {}), criteria: criteria.map((c) => ({ ...(c.id ? { id: c.id } : {}), label: c.label, description: c.description, weight: c.weight === '' ? '' : Number(c.weight) })) })),
          print,
        });
        cats = saved.categories.map((x) => ({ ...x }));
        tpls = saved.templates.map((x) => ({ ...x, criteria: x.criteria.map((c) => ({ ...c })) }));
        Object.assign(print, saved.print);
        redraw();
        toast('Assessment templates saved.');
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
        errEl.scrollIntoView({ block: 'center' });
      }
    });
  };
  redraw();
  return { catName };
}
