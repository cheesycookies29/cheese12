// School details, enrollment rules, student applications; demo data and backups.
import { api } from '../../api.js';
import { html, mount, toast, option, formData, confirmDialog, downloadFile, today } from '../../ui.js';
import { pageHead, ctx, applyBranding, logoSrc } from '../../shell.js';
import { can } from '/shared/roles.js';
import { THEMES, themeColors } from '/shared/themes.js';
import { icon } from '../../icons.js';
import { NUMBERING_LABELS } from '/shared/numbering.js';

// Resizes a picked logo to at most 400 px wide, as PNG, so it stays small.
function shrinkLogo(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp|svg\+xml|gif)$/.test(file.type)) return reject(new Error('Pick a PNG, JPEG or WebP picture.'));
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 400 / img.width, 400 / img.height);
      const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('That picture could not be read.'));
    img.src = URL.createObjectURL(file);
  });
}

export async function settingsView(el) {
  const [s, terms] = await Promise.all([api.get('/api/admin/settings'), api.get('/api/admin/terms')]);
  const editable = can(ctx.user.role, 'settings.edit');
  const dis = editable ? '' : 'disabled';
  mount(el, html`
    ${pageHead('Settings & branding', 'School details, how ATLAS looks, enrollment rules, sign-in and passwords, uploads and quizzes, and how new numbers look.')}
    ${!editable ? html`<div class="notice"><p>Only administrators can change these.</p></div>` : ''}
    <form id="settings" class="stack">
      <section class="card"><h2>School</h2><div class="grid">
        <label class="field span-2"><span>School name</span><input name="schoolName" value="${s.schoolName}" ${dis} /></label>
        <label class="field"><span>Current term</span><select name="currentTermId" ${dis}>${option('', 'None')}${terms.map((t) => option(t.id, t.name, t.id === s.currentTermId))}</select><span class="hint">Shown first to students, teachers and on the dashboard.</span></label>
        <label class="field"><span>Passing grade (%)</span><input type="number" name="passingGrade" min="1" max="100" value="${s.passingGrade}" ${dis} /><span class="hint">A final grade at or above this passes and counts as a prerequisite.</span></label>
      </div></section>
      <section class="card"><h2>Enrollment rules</h2><div class="grid">
        <label class="field check span-3"><input type="checkbox" name="requireApproval" ${s.enrollment.requireApproval ? 'checked' : ''} ${dis} /> <span><strong>Requests need approval.</strong> Students' requests wait under Enrollment requests until a registrar approves them. Off: a free seat enrolls them at once.</span></label>
        <label class="field check span-3"><input type="checkbox" name="allowWaitlist" ${s.enrollment.allowWaitlist ? 'checked' : ''} ${dis} /> <span><strong>Waitlists.</strong> A full section puts students in line; when a seat frees up, the first in line moves up automatically.</span></label>
        <label class="field"><span>Waitlist size per section</span><input type="number" name="waitlistLimit" min="0" value="${s.enrollment.waitlistLimit}" ${dis} /><span class="hint">0 = no limit.</span></label>
        <label class="field"><span>Maximum units per term</span><input type="number" name="maxUnits" min="0" step="0.5" value="${s.enrollment.maxUnits}" ${dis} /><span class="hint">Counts enrolled, pending and waitlisted classes. 0 = no limit.</span></label>
      </div>
      <p class="hint">Every request is also checked for: the term's enrollment window, the section's enrollment key, prerequisites passed, already passed or already taking the course, and schedule conflicts. The registrar can override these when adding a student by hand.</p></section>
      <section class="card"><h2>Branding</h2>
        <p class="muted" style="margin-top:-6px">One colour runs through the portal, the admin panel and the sign-in pages.</p>
        <div class="swatches">${Object.entries(THEMES).map(([k, t]) => html`<label class="swatch"><input type="radio" name="theme" value="${k}" ${s.branding.theme === k ? 'checked' : ''} ${dis} /><i style="background:linear-gradient(135deg, ${t.brand} 60%, ${t.accent} 60%)"></i>${t.label}</label>`)}
          <label class="swatch"><input type="radio" name="theme" value="custom" ${s.branding.theme === 'custom' ? 'checked' : ''} ${dis} /><i style="background:${s.branding.color || '#888'}" id="custom-dot"></i>School colour <input type="color" name="color" value="${s.branding.color || '#166534'}" ${dis} style="width:56px;height:28px" /></label></div>
        <div class="grid" style="margin-top:16px">
          <div class="field span-2"><span>School logo or seal</span>
            <div class="logo-box"><img id="logo-preview" src="${logoSrc(s.branding)}" alt="" />
              <div class="stack tight"><label class="btn sm">${icon('upload', 15)} Upload logo<input type="file" id="logo" accept="image/png,image/jpeg,image/webp" hidden ${dis} /></label>
                ${s.branding.logo ? html`<button type="button" class="link" id="logo-reset">Remove the school logo</button>` : ''}<span class="hint">Shown on the sign-in pages and on payslips. A square seal or a wide logo both work.</span></div></div></div>
          <label class="field"><span>Sign-in headline</span><input name="tagline" value="${s.branding.tagline}" placeholder="Learning, all in one place." maxlength="160" ${dis} /></label>
        </div>
      </section>
      <section class="card"><h2>Student applications</h2>
        <label class="field check"><input type="checkbox" name="registrationOpen" ${s.registration.open ? 'checked' : ''} ${dis} /> <span><strong>Let people apply from the sign-in page.</strong> The ATLAS home page shows "New student? Apply for admission". Applicants appear under Applicants and can sign in once admitted.</span></label>
      </section>
      <section class="card" id="security"><h2>Sign-in and passwords</h2>
        <p class="muted">Password rules, lock-out, idle sign-out and rate limits apply to every system, so they are set in <strong>ATLAS Control</strong>, which only administrators open.${ctx.user.role === 'admin' ? html` <a href="/control/#/sign-in">Open Sign-in and passwords in Control</a>.` : ''}</p>
      </section>
      <section class="card" id="learn-rules"><h2>Uploads, quizzes and parent alerts</h2><div class="grid">
        <label class="field"><span>Largest upload (MB)</span><input type="number" name="maxUploadMb" min="1" max="15" value="${s.learn.maxUploadMb}" ${dis} /><span class="hint">Class resources, handed-in work and attachments, 1 to 15.</span></label>
        <label class="field"><span>Quiz grace period (seconds)</span><input type="number" name="quizGraceSeconds" min="0" max="300" value="${s.learn.quizGraceSeconds}" ${dis} /><span class="hint">Answers sent this long after the deadline still count (slow connections).</span></label>
        <label class="field"><span>Absences shown in red to parents</span><input type="number" name="absenceAlert" min="1" max="30" value="${s.learn.absenceAlert}" ${dis} /><span class="hint">From this many in a term, on a parent's dashboard.</span></label>
      </div></section>
      <section class="card" id="numbering"><h2>Numbering</h2>
        <p class="muted" style="margin-top:-6px">How new numbers look. <code>{YYYY}</code> or <code>{YY}</code> is the year, <code>{MM}</code> the month, <code>{N}</code> the serial (<code>{N4}</code>: at least 4 digits). A series starts again at 1 each year when it has the year. Numbers already given never change, and none is given twice.</p>
        <div class="grid">${Object.entries(NUMBERING_LABELS).map(([k, label]) => html`<label class="field"><span>${label}</span><input name="num-${k}" data-series="${k}" value="${s.numbering[k]}" maxlength="40" spellcheck="false" ${dis} /><span class="hint" id="next-${k}">Next: <strong>${s.numberingNext?.[k] || ''}</strong></span></label>`)}</div>
      </section>
      ${editable ? html`<div class="actions end"><a class="btn ghost" href="#/config?module=admin">Compare with the defaults</a><button class="btn primary" type="submit">Save settings</button></div>` : ''}
    </form>`);
  // The next number each format would give, as the administrator types.
  let timer;
  el.querySelectorAll('[data-series]').forEach((input) => input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const r = await api.get(`/api/admin/numbering-preview?kind=${input.dataset.series}&format=${encodeURIComponent(input.value)}`).catch((err) => ({ problem: err.message }));
      const hint = el.querySelector(`#next-${input.dataset.series}`);
      mount(hint, r.problem ? html`<span class="negative">${r.problem}</span>` : html`Next: <strong>${r.next}</strong>`);
      input.setAttribute('aria-invalid', r.problem ? 'true' : 'false');
    }, 250);
  }));
  let logo = s.branding.logo;
  const form = el.querySelector('#settings');
  // Preview the colour right away.
  form.addEventListener('change', (e) => {
    if (e.target.name === 'theme' || e.target.name === 'color') {
      const v = formData(form);
      if (e.target.name === 'color') form.querySelector('input[value=custom]').checked = true;
      el.querySelector('#custom-dot').style.background = v.color;
      applyBranding(themeColors({ theme: formData(form).theme, color: v.color }));
    }
  });
  el.querySelector('#logo')?.addEventListener('change', async (e) => {
    try {
      logo = await shrinkLogo(e.target.files[0]);
      el.querySelector('#logo-preview').src = logo;
      toast('Logo ready. Save settings to use it.');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  el.querySelector('#logo-reset')?.addEventListener('click', () => {
    logo = '';
    el.querySelector('#logo-preview').src = logoSrc({});
  });
  el.querySelector('#settings').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formData(e.target);
    try {
      await api.put('/api/admin/settings', {
        schoolName: v.schoolName,
        currentTermId: v.currentTermId,
        passingGrade: v.passingGrade,
        enrollment: { requireApproval: Boolean(v.requireApproval), allowWaitlist: Boolean(v.allowWaitlist), waitlistLimit: v.waitlistLimit, maxUnits: v.maxUnits },
        registration: { open: Boolean(v.registrationOpen) },
        branding: { theme: v.theme, color: v.color, logo, tagline: v.tagline },
        learn: { maxUploadMb: v.maxUploadMb, quizGraceSeconds: v.quizGraceSeconds, absenceAlert: v.absenceAlert },
        numbering: Object.fromEntries(Object.keys(NUMBERING_LABELS).map((k) => [k, v[`num-${k}`]])),
      });
      ctx.info.branding = { ...ctx.info.branding, schoolName: v.schoolName, ...themeColors({ theme: v.theme, color: v.color }), logo, tagline: v.tagline };
      applyBranding(ctx.info.branding);
      toast('Settings saved.');
      settingsView(el); // shows "Remove the school logo" after an upload
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

export async function dataView(el) {
  const demo = await api.get('/api/admin/demo');
  mount(el, html`
    ${pageHead('Demo data & backup')}
    <section class="card"><h2>Demo data</h2>
      <p>Adds a sample school <strong>next to your own data</strong>: 5 programs (IT, Computer Science, Business, Agriculture, Education), a finished term with grades
        and a current term with enrollment open, 21 courses with prerequisites, about 40 sections this term (one full with a waitlist, one with an enrollment key), 18 teachers,
        about 190 students across four campuses, 11 applicants and about 40 parents and guardians: some 260 accounts. Every class has lessons, announcements,
        a course outline, graded work, a quiz most students have taken, and attendance; plus school news and events, and People records, attendance and payroll.</p>
      <p>Sign in on the ATLAS home page as <code>student.demo</code> (Carlo Reyes) or <code>teacher.demo</code> (Maria Santos), or as <code>registrar.demo</code>. Password <code>demo1234</code>.
        Other teachers: <code>lmercado.demo</code>, <code>gaquino.demo</code>, <code>rvillareal.demo</code>, <code>lgonzales.demo</code>, <code>mtorres.demo</code>, <code>jdelacruz.demo</code>, <code>aramos.demo</code>, <code>psison.demo</code>, <code>rmanalastas.demo</code>, <code>jcabrera.demo</code>, <code>vbayani.demo</code>. Parents: <code>parent.demo</code>, <code>father.demo</code> and the accounts under Parents & guardians.
        Your own current term stays current; if you have none, the demo term becomes current.</p>
      ${demo.loaded ? html`<p><strong>Demo data is loaded:</strong> ${demo.counts.users} accounts, ${demo.counts.courses} courses, ${demo.counts.sections} sections, ${demo.counts.enrollments} enrollments.</p>` : ''}
      <div class="actions"><button class="btn primary" id="add-demo">${demo.loaded ? 'Refresh demo data' : 'Add demo data'}</button>
        ${demo.loaded ? html`<button class="btn danger ghost" id="remove-demo">Remove demo data</button>` : ''}</div>
      <p class="hint">Removing takes out every demo record, and enrollments of real students in demo sections, and leaves everything else as it was.</p>
    </section>
    <section class="card"><h2>Backup</h2>
      <p>Records are stored in <code>data/db.json</code>, and uploaded files (class resources, handed-in work) in <code>data/files/</code>. The download below holds the records only; to keep the files too, copy the whole <code>data</code> folder. The backup includes accounts (passwords as secure hashes), so keep it private.</p>
      <div class="actions"><button class="btn" id="backup">Download backup</button><label class="btn">Restore from backup…<input type="file" id="restore" accept="application/json" hidden /></label></div>
    </section>`);
  el.querySelector('#add-demo').addEventListener('click', async () => {
    await api.post('/api/admin/demo');
    toast('Demo data added.');
    dataView(el);
  });
  el.querySelector('#remove-demo')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Remove all demo data? Your own records stay as they are.', { confirmLabel: 'Remove demo data' }))) return;
    await api.del('/api/admin/demo');
    toast('Demo data removed.');
    dataView(el);
  });
  el.querySelector('#backup').addEventListener('click', async () => {
    const data = await api.get('/api/admin/backup');
    downloadFile(`atlas-backup-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
  });
  el.querySelector('#restore').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!(await confirmDialog('Replace ALL current data with this backup? This cannot be undone.', { confirmLabel: 'Restore' }))) return;
      await api.post('/api/admin/restore', data);
      toast('Backup restored.');
      ctx.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// Activity types and how much each counts toward the running grade.
export async function gradingView(el) {
  const [types, settings] = await Promise.all([api.get('/api/admin/activity-types'), api.get('/api/admin/settings')]);
  const editable = can(ctx.user.role, 'settings.edit');
  const rows = types.map((t) => ({ ...t }));
  const render = () => {
    const total = rows.reduce((n, t) => n + (Number(t.weight) || 0), 0);
    mount(el, html`
      ${pageHead('Activity types & grading', 'Teachers pick a type for each assignment, quiz or exam. Weights decide how much each type counts in the running grade.')}
      <section class="card scroll-x"><table class="table">
        <thead><tr><th>Activity type</th><th>Weight %</th><th>Used by</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows.map((t, i) => html`<tr data-i="${i}">
          <td><input data-f="name" value="${t.name}" aria-label="Activity type name" ${editable ? '' : 'disabled'} /></td>
          <td><input data-f="weight" type="number" min="0" max="100" value="${t.weight}" style="width:100px" aria-label="${t.name}: weight %" ${editable ? '' : 'disabled'} /></td>
          <td>${t.used || 0} activit${t.used === 1 ? 'y' : 'ies'}</td>
          <td><label class="switch"><input type="checkbox" data-f="active" ${t.active !== false ? 'checked' : ''} ${editable ? '' : 'disabled'} /><span class="track"></span>${t.active !== false ? 'On' : 'Off'}</label></td>
          <td class="row-actions">${editable && !t.used ? html`<button class="icon-btn danger" data-del="${i}" aria-label="Remove">${icon('trash', 16)}</button>` : ''}</td></tr>`)}</tbody>
        <tfoot><tr><td><strong>Total</strong></td><td><strong class="${total && total !== 100 ? 'warn' : ''}">${total}%</strong></td><td colspan="3" class="muted">${total === 0 ? 'All weights are 0: every point counts the same.' : total === 100 ? 'Weights add up to 100%.' : 'Weights must add up to 100% (or all be 0).'}</td></tr></tfoot>
      </table></section>
      ${editable ? html`<div class="actions" style="margin-top:12px"><button class="btn" id="add">${icon('plus', 16)} Add a type</button><span class="spacer"></span><button class="btn primary" id="save">Save</button></div>` : html`<div class="notice">${icon('shield')}<p>Only administrators can change these.</p></div>`}
      <p class="muted small" style="margin-top:8px">A type that is off is no longer offered for new work; work already given that type still counts by its weight. To stop it counting, set its weight to 0.</p>
      <section class="card" style="margin-top:16px"><h2>How the running grade works</h2>
        <p>Each type's percentage is worked out from the scored work of that type, then combined by weight. Types with no scored work yet are left out, and the remaining weights are scaled up. Example: assignments 30%, quizzes 20%, exams 50%; a student with 80% on assignments and 90% on quizzes, and no exam yet, has (80×30 + 90×20) ÷ 50 = <strong>84%</strong>.</p>
        <p class="muted">Passing grade: <strong>${settings.passingGrade}%</strong> (under Settings). Teachers post final grades themselves; the running grade helps them.</p>
      </section>`);
    el.querySelectorAll('[data-f]').forEach((input) => input.addEventListener(input.type === 'checkbox' ? 'change' : 'input', () => {
      const t = rows[Number(input.closest('[data-i]').dataset.i)];
      t[input.dataset.f] = input.type === 'checkbox' ? input.checked : input.dataset.f === 'weight' ? Number(input.value) : input.value;
      if (input.dataset.f !== 'name') render();
    }));
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      rows.splice(Number(b.dataset.del), 1);
      render();
    }));
    el.querySelector('#add')?.addEventListener('click', () => {
      rows.push({ name: 'New type', weight: 0, active: true });
      render();
    });
    el.querySelector('#save')?.addEventListener('click', async () => {
      try {
        const saved = await api.put('/api/admin/activity-types', { types: rows });
        rows.splice(0, rows.length, ...saved);
        toast('Activity types saved.');
        gradingView(el);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  };
  render();
}
