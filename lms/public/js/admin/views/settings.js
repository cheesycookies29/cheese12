// School details, enrollment rules, student applications; demo data and backups.
import { api } from '../../api.js';
import { html, mount, toast, option, formData, confirmDialog, downloadFile, today } from '../../ui.js';
import { pageHead, ctx } from '../../shell.js';
import { can } from '/shared/roles.js';

export async function settingsView(el) {
  const [s, terms] = await Promise.all([api.get('/api/admin/settings'), api.get('/api/admin/terms')]);
  const editable = can(ctx.user.role, 'settings.edit');
  const dis = editable ? '' : 'disabled';
  mount(el, html`
    ${pageHead('Settings', 'School details and the rules every enrollment request is checked against.')}
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
      <section class="card"><h2>Student applications</h2>
        <label class="field check"><input type="checkbox" name="registrationOpen" ${s.registration.open ? 'checked' : ''} ${dis} /> <span><strong>Let people apply from the learning portal.</strong> The sign-in page shows "Apply as a student". Applicants appear under Applicants and can sign in once admitted.</span></label>
      </section>
      ${editable ? html`<div class="actions end"><button class="btn primary" type="submit">Save settings</button></div>` : ''}
    </form>`);
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
      });
      toast('Settings saved.');
      ctx.info.schoolName = v.schoolName;
      document.getElementById('school-name').textContent = v.schoolName;
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
      <p>Adds a sample school <strong>next to your own data</strong>: 3 programs, a finished term and a current term with enrollment open, 9 courses with prerequisites,
        11 sections (one full with a waitlist, one with an enrollment key), 3 teachers, 9 students with past grades, 2 applicants, and lessons, announcements and assignments in IT201 A.</p>
      <p>Sign in to the learning portal as <code>student.demo</code> or <code>teacher.demo</code>, or here as <code>registrar.demo</code>. Password <code>demo1234</code>.
        Your own current term stays current; if you have none, the demo term becomes current.</p>
      ${demo.loaded ? html`<p><strong>Demo data is loaded:</strong> ${demo.counts.users} accounts, ${demo.counts.courses} courses, ${demo.counts.sections} sections, ${demo.counts.enrollments} enrollments.</p>` : ''}
      <div class="actions"><button class="btn primary" id="add-demo">${demo.loaded ? 'Refresh demo data' : 'Add demo data'}</button>
        ${demo.loaded ? html`<button class="btn danger ghost" id="remove-demo">Remove demo data</button>` : ''}</div>
      <p class="hint">Removing takes out every demo record, and enrollments of real students in demo sections, and leaves everything else as it was.</p>
    </section>
    <section class="card"><h2>Backup</h2>
      <p>Everything is stored in one file, <code>data/db.json</code>. Download a copy here, or copy the <code>data</code> folder. The backup includes accounts (passwords as secure hashes), so keep it private.</p>
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
    downloadFile(`ltdc-lms-backup-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
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
