// School details, enrollment rules, student applications; demo data and backups.
import { api } from '../../api.js';
import { html, mount, toast, option, formData, confirmDialog, downloadFile, today } from '../../ui.js';
import { pageHead, ctx, applyBranding, logoSrc, markSrc, isDark } from '../../shell.js';
import { userCan } from '/shared/roles.js';
import { THEMES, themeColors, inkOn, contrast } from '/shared/themes.js';
import { icon } from '../../icons.js';
import { NUMBERING_LABELS } from '/shared/numbering.js';
import { brandHome, schoolBrand } from '../../brand.js';
import { isSchoolBrand, brandName } from '/shared/brand.js';
import { defaultPrivacyText, TERMS_PLACEHOLDER, POLICY_TEXT_MAX, POLICY_URL_MAX } from '/shared/registration.js';

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

// Settings → Branding: the top bar and the sign-in lockup as they would look with these choices.
function brandPreview(b) {
  const school = isSchoolBrand(b);
  const name = brandName(b);
  const seal = school ? b.logo : '';
  const ink = inkOn(b.accent);
  const mark = html`<img src="${markSrc(isDark())}" alt="" />`;
  return html`<div class="bp" style="--brand:${b.brand};--accent:${b.accent};--bp-ink:${ink}">
    <div class="bp-part"><span class="bp-label">Top bar</span>
      <div class="bp-top">${school ? (seal ? html`<img class="bp-seal-img" src="${seal}" alt="" />` : '') : mark}<span class="bp-word${school ? ' school' : ''}"><strong>${name}</strong><em>Learn</em></span><span class="bp-school">${b.schoolName}</span><span class="bp-badge" title="A count on the accent">3</span></div></div>
    <div class="bp-part"><span class="bp-label">Sign-in page</span>
      <div class="bp-auth">
        <div class="bp-lockup">${school ? html`${seal ? html`<img src="${seal}" alt="" />` : ''}<strong class="school">${name}</strong>` : html`${mark}<strong>ATLAS</strong>`}</div>
        <div class="bp-plate"><span class="bp-plate-seal${b.logo ? ' own' : ''}">${b.logo ? html`<img src="${b.logo}" alt="" />` : school ? html`<b>${name}</b>` : html`<img src="/img/brand/atlas-mark-white.svg" alt="" />`}</span>
          <strong>${b.schoolName}</strong><small>${name} · Sign in</small>
          ${school ? html`<span class="bp-powered"><img src="${markSrc(isDark())}" alt="" />Powered by ATLAS</span>` : ''}</div>
      </div></div>
    ${b.mode === 'school' && !school ? html`<p class="hint negative">Type the short name to lead with your school.</p>` : ''}
    <p class="hint">Text on the accent: ${ink === '#ffffff' ? 'white' : 'dark'} (${contrast(b.accent, ink).toFixed(1)}:1; 4.5:1 or more reads well).</p>
  </div>`;
}

export async function settingsView(el, params, q = {}) {
  const [s, terms] = await Promise.all([api.get('/api/admin/settings'), api.get('/api/admin/terms')]);
  const editable = userCan(ctx.user, 'settings.edit');
  const dis = editable ? '' : 'disabled';
  mount(el, html`
    ${pageHead('Settings & branding', `School details, how ${schoolBrand() ? 'the systems look' : 'ATLAS looks'}, enrollment rules, sign-in and passwords, uploads and quizzes, and how new numbers look.`)}
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
      <section class="card" id="branding"><h2>Branding</h2>
        <p class="muted" style="margin-top:-6px">How every system looks: whose name and mark lead, the colours, and the school's seal. They show across every system: the home page, Learn, Academic, People, Finance, Documents, Tools, Help and the sign-in pages.</p>
        <div class="brand-top"><div>
        <fieldset class="brand-modes" ${dis}><legend>Brand</legend>
          <label class="brand-mode"><input type="radio" name="brandMode" value="atlas" ${s.branding.mode !== 'school' ? 'checked' : ''} /><span><strong>ATLAS (default)</strong><small>ATLAS's mark and name lead the top bar and the sign-in pages; your school's name shows beside them.</small></span></label>
          <label class="brand-mode"><input type="radio" name="brandMode" value="school" ${s.branding.mode === 'school' ? 'checked' : ''} /><span><strong>Our school, powered by ATLAS</strong><small>Your seal and short name lead every system ("<span data-short>${s.branding.shortName || 'Short name'}</span> Learn", "<span data-short>${s.branding.shortName || 'Short name'}</span> home") and the browser tab; ATLAS shows only as a small "Powered by ATLAS".</small></span></label>
        </fieldset>
        <label class="field" style="margin-top:12px"><span>School short name</span><input name="shortName" value="${s.branding.shortName || ''}" maxlength="24" placeholder="e.g. the school's initials" autocomplete="off" ${dis} /><span class="hint">The name the school goes by, up to 24 characters. Needed for "Our school, powered by ATLAS".</span></label>
        </div>
        <div><h3 class="brand-sub-head first">Preview</h3><div class="brand-preview" id="brand-preview"></div></div></div>
        <h3 class="brand-sub-head">Colours</h3>
        <div class="swatches">${Object.entries(THEMES).map(([k, t]) => html`<label class="swatch"><input type="radio" name="theme" value="${k}" ${s.branding.theme === k ? 'checked' : ''} ${dis} /><i style="background:linear-gradient(135deg, ${t.brand} 60%, ${t.accent} 60%)"></i>${t.label}</label>`)}
          <label class="swatch"><input type="radio" name="theme" value="custom" ${s.branding.theme === 'custom' ? 'checked' : ''} ${dis} /><i id="custom-dot"></i>School colour <input type="color" name="color" value="${s.branding.color || '#166534'}" aria-label="School colour" ${dis} style="width:56px;height:28px" /></label>
          <label class="swatch">Accent <input type="color" name="accent" value="${s.branding.accent || '#c28618'}" aria-label="Accent colour (for the school colour)" ${dis} style="width:56px;height:28px" /></label></div>
        <p class="hint" style="margin-top:8px">The accent (badges, highlights, the gold rule on the sign-in pages) goes with the school colour; the presets have their own. Text on it is set dark or white, whichever reads better.</p>
        <div class="grid" style="margin-top:16px">
          <div class="field span-2"><span>School logo or seal</span>
            <div class="logo-box"><img id="logo-preview" src="${logoSrc(s.branding)}" alt="" />
              <div class="stack tight"><label class="btn sm">${icon('upload', 15)} Upload logo<input type="file" id="logo" accept="image/png,image/jpeg,image/webp" hidden ${dis} /></label>
                ${s.branding.logo ? html`<button type="button" class="link" id="logo-reset">Remove the school logo</button>` : ''}<span class="hint">Shown on the sign-in pages and on payslips; with "Our school, powered by ATLAS", also in the top bar of every system and as the browser tab's icon, as uploaded (light and dark). A square seal on a transparent background works best; a wide logo works too.</span></div></div></div>
          <label class="field"><span>Sign-in headline</span><input name="tagline" value="${s.branding.tagline}" placeholder="Learning, all in one place." maxlength="160" ${dis} /></label>
        </div>
      </section>
      <section class="card" id="registration"><h2>Registration</h2>
        <label class="field check"><input type="checkbox" name="registrationOpen" ${s.registration.open ? 'checked' : ''} ${dis} /> <span><strong>Let new students register from the sign-in page.</strong> The ${brandHome()} page shows a <strong>Register account</strong> button that opens <strong>Create student account</strong>. New accounts wait under <a href="#/applicants">Applicants</a>; once admitted, students sign in with their email.</span></label>
        <p class="muted" style="margin:14px 0 6px">The form ends with "By using this service, you understand and agree to the ${schoolBrand() && s.branding.shortName ? s.branding.shortName : s.schoolName} online services <strong>Terms of Use</strong> and <strong>Privacy Policy</strong>." For each, give the address of the school's page, or write the text here (an address is used when there is both).</p>
        <div class="grid two">
          <div class="stack tight"><h3 class="brand-sub-head first">Terms of Use</h3>
            <label class="field"><span>Address of the school's page</span><input type="url" name="termsUrl" value="${s.registration.termsUrl || ''}" maxlength="${POLICY_URL_MAX}" placeholder="https://" ${dis} /></label>
            <label class="field"><span>Or the text</span><textarea name="termsText" rows="8" maxlength="${POLICY_TEXT_MAX}" placeholder="${TERMS_PLACEHOLDER}" ${dis}>${s.registration.termsText || ''}</textarea>
              <span class="hint">${s.registration.termsUrl || s.registration.termsText ? 'Students see a Terms of Use link.' : html`<strong>Not set:</strong> students see no Terms of Use link. ATLAS does not write terms for you.`}</span></label></div>
          <div class="stack tight"><h3 class="brand-sub-head first">Privacy Policy</h3>
            <label class="field"><span>Address of the school's page</span><input type="url" name="privacyUrl" value="${s.registration.privacyUrl || ''}" maxlength="${POLICY_URL_MAX}" placeholder="https://" ${dis} /></label>
            <label class="field"><span>Or the text</span><textarea name="privacyText" rows="8" maxlength="${POLICY_TEXT_MAX}" placeholder="Empty: the built-in notice below." ${dis}>${s.registration.privacyText || ''}</textarea>
              <span class="hint">${s.registration.privacyUrl || s.registration.privacyText ? 'Students see the school\'s own policy.' : 'Empty: students see the built-in notice, which lists exactly what the form collects and why.'}</span></label>
            <details class="policy-default"><summary>The built-in privacy notice</summary><div class="policy-text small">${defaultPrivacyText(s.schoolName)}</div>
              ${editable ? html`<button type="button" class="btn sm" id="privacy-copy">Start from this text</button>` : ''}</details></div>
        </div>
      </section>
      <section class="card" id="security"><h2>Sign-in and passwords</h2>
        <p class="muted">Password rules, lock-out, idle sign-out and rate limits apply to every system, so administrators set them under <strong>System → Sign-in and passwords</strong>.${ctx.user.role === 'admin' ? html` <a href="#/sign-in">Open Sign-in and passwords</a>.` : ''}</p>
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
  // The colours as chosen, and the preview of the top bar and the sign-in lockup.
  const colours = (v = formData(form)) => themeColors({ theme: v.theme, color: v.color, accent: v.accent });
  const preview = () => {
    const v = formData(form);
    const c = colours(v);
    const b = { ...ctx.info.branding, ...c, theme: v.theme, logo, schoolName: v.schoolName || s.schoolName, mode: v.brandMode, shortName: String(v.shortName || '').trim() };
    el.querySelector('#custom-dot').style.background = `linear-gradient(135deg, ${v.color} 60%, ${v.accent} 60%)`;
    el.querySelectorAll('[data-short]').forEach((x) => (x.textContent = b.shortName || 'Short name'));
    mount(el.querySelector('#brand-preview'), brandPreview(b));
  };
  preview();
  form.addEventListener('input', preview);
  form.addEventListener('change', (e) => {
    if (['theme', 'color', 'accent'].includes(e.target.name)) {
      if (e.target.name !== 'theme') form.querySelector('input[value=custom]').checked = true;
      // The page itself takes the colours at once, so they can be tried before saving.
      const v = formData(form);
      applyBranding({ ...ctx.info.branding, ...colours(v), theme: v.theme });
    }
    preview();
  });
  el.querySelector('#logo')?.addEventListener('change', async (e) => {
    try {
      logo = await shrinkLogo(e.target.files[0]);
      el.querySelector('#logo-preview').src = logo;
      preview();
      toast('Logo ready. Save settings to use it.');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  // Settings → Registration: the built-in privacy notice as a start for the school's own.
  el.querySelector('#privacy-copy')?.addEventListener('click', () => {
    const box = el.querySelector('[name=privacyText]');
    if (!box.value.trim()) box.value = defaultPrivacyText(s.schoolName);
    box.focus();
  });
  // Opened from elsewhere at one part (#/settings?section=registration).
  if (q.section) el.querySelector(`#${CSS.escape(q.section)}`)?.scrollIntoView({ block: 'start' });
  el.querySelector('#logo-reset')?.addEventListener('click', () => {
    logo = '';
    el.querySelector('#logo-preview').src = logoSrc({});
    preview();
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
        registration: { open: Boolean(v.registrationOpen), termsUrl: v.termsUrl, termsText: v.termsText, privacyUrl: v.privacyUrl, privacyText: v.privacyText },
        branding: { theme: v.theme, color: v.color, accent: v.accent, logo, tagline: v.tagline, mode: v.brandMode, shortName: v.shortName },
        learn: { maxUploadMb: v.maxUploadMb, quizGraceSeconds: v.quizGraceSeconds, absenceAlert: v.absenceAlert },
        numbering: Object.fromEntries(Object.keys(NUMBERING_LABELS).map((k) => [k, v[`num-${k}`]])),
      });
      // The top bar, the sidebar and the tab in the new branding, then this page ("Remove the school logo" after an upload).
      ctx.redrawFrame((await api.get(`${ctx.authBase}/status`)).branding);
      toast('Settings saved.');
      settingsView(el);
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
      <p>Sign in on the ${brandHome()} page as <code>student.demo</code> (Carlo Reyes) or <code>teacher.demo</code> (Maria Santos), or as <code>registrar.demo</code>. Password <code>demo1234</code>.
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
  const editable = userCan(ctx.user, 'settings.edit');
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
