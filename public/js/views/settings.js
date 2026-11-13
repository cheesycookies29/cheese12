// Admin panel → Settings & branding (company details, default schedule, brand colour, logo and the
// sign-in headline) and Admin panel → Sign-in & security. Backups and demo data are in admin/data.js.
import { api } from '../api.js';
import { ctx, applyBrand } from '../state.js';
import { html, mount, toast, formErrors, WEEKDAYS } from '../ui.js';
import { icon } from '../icons.js';
import { THEMES, HEX_RE, DEFAULT_HEADLINE, HEADLINE_MAX, LOGO_MAX_BYTES, MIN_CONTRAST, contrast, themeColors } from '/shared/brand.js';
import { pageHead } from './admin/common.js';

// A picked logo, made at most 400 px wide or high and re-drawn as a PNG (or a JPEG if that is
// smaller), so it is small and carries nothing but the picture. SVG is not accepted.
function shrinkLogo(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Pick a picture.'));
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error('Pick a PNG, JPEG or WebP picture.'));
    if (file.size > 8 * 1024 * 1024) return reject(new Error('That picture is too large. Use one under 8 MB.'));
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 400 / img.width, 400 / img.height);
      const c = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(img.width * scale)), height: Math.max(1, Math.round(img.height * scale)) });
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      let out = c.toDataURL('image/png');
      if (out.length * 0.75 > LOGO_MAX_BYTES) out = c.toDataURL('image/jpeg', 0.85);
      if (out.length * 0.75 > LOGO_MAX_BYTES) return reject(new Error('The logo is still over 300 KB after shrinking. Use a simpler picture.'));
      resolve(out);
    };
    img.onerror = () => reject(new Error('That picture could not be read.'));
    img.src = URL.createObjectURL(file);
  });
}

const ratio = (hex) => (HEX_RE.test(hex) ? contrast(hex, '#ffffff') : 0);

export async function settingsView(el) {
  const s = await api.get('/api/settings');
  const b = s.branding;
  const checked = (v) => (v ? 'checked' : '');
  let logo; // undefined: unchanged; '' removed; data: URL new
  const custom = b.theme === 'custom' ? b.color : '#1e3a5f';

  mount(el, html`
    ${pageHead('Settings & branding', 'Company details, the default work schedule, and how CORE looks: the brand colour, the logo and the sign-in headline.', html`<a class="btn ghost" href="#/admin/config?module=admin">${icon('search', 16)} Compare with the defaults</a>`)}
    <form id="settings-form" class="stack" novalidate>
      <section class="card">
        <h2>Company</h2>
        <div class="grid">
          <label class="field"><span>Company name</span><input name="companyName" value="${s.companyName}" required maxlength="200" /></label>
          <label class="field"><span>TIN</span><input name="companyTin" value="${s.companyTin}" maxlength="200" /></label>
          <label class="field span-3"><span>Address</span><input name="companyAddress" value="${s.companyAddress}" maxlength="300" /></label>
        </div>
        <p class="muted small">Printed on every payslip; the name is also on the CORE home and the sign-in page. Pay rules, rates and tax tables are in <a href="#/payroll-setup">Payroll Setup</a>.</p>
      </section>
      <section class="card">
        <h2>Default work schedule</h2>
        <p class="muted small">Used for new employees. Each employee can have their own schedule.</p>
        <div class="grid">
          <label class="field"><span>Shift start</span><input type="time" name="shiftStart" value="${s.schedule.shiftStart}" /></label>
          <label class="field"><span>Shift end</span><input type="time" name="shiftEnd" value="${s.schedule.shiftEnd}" /></label>
          <label class="field"><span>Unpaid break (minutes)</span><input type="number" name="breakMinutes" value="${s.schedule.breakMinutes}" min="0" /></label>
          <fieldset class="field span-3 days-field"><legend>Work days</legend>
            <div class="days">${WEEKDAYS.map((d, i) => html`<label><input type="checkbox" name="workDays" value="${i}" ${checked(s.schedule.workDays.includes(i))} /> ${d}</label>`)}</div>
          </fieldset>
        </div>
      </section>
      <section class="card" id="branding">
        <h2>Branding</h2>
        <p class="muted small">One colour runs through every module, the Admin panel and the sign-in page, in light and dark mode. The colour changes on screen as you choose it; it is kept when you save.</p>
        <fieldset class="brand-field"><legend>Brand colour</legend>
          <div class="swatches">${Object.entries(THEMES).map(([k, t]) => html`<label class="swatch"><input type="radio" name="theme" value="${k}" ${b.theme === k ? 'checked' : ''} /><i style="background:linear-gradient(135deg, ${t.brand} 60%, ${t.accent} 60%)"></i>${t.label}${k === 'core' ? html`<small class="muted">Default</small>` : ''}</label>`)}
            <label class="swatch"><input type="radio" name="theme" value="custom" ${b.theme === 'custom' ? 'checked' : ''} /><i id="custom-dot" style="background:${custom}"></i>Company colour</label></div>
        </fieldset>
        <div class="grid brand-custom">
          <label class="field"><span>Company colour</span><span class="color-pair"><input type="color" name="colorPick" value="${custom}" aria-label="Pick the company colour" /><input name="color" value="${custom}" maxlength="7" spellcheck="false" autocapitalize="none" aria-describedby="contrast-note" /></span></label>
          <p class="field span-2 contrast-note" id="contrast-note" aria-live="polite"></p>
        </div>
        <div class="grid">
          <div class="field span-2"><span>Company logo</span>
            <div class="logo-box"><img id="logo-preview" src="${b.logo || '/img/core-mark-brand.svg'}" alt="${b.logo ? 'The company logo' : 'No logo: the CORE mark'}" />
              <div class="stack tight"><label class="btn sm">${icon('upload', 15)} Upload logo<input type="file" id="logo" accept="image/png,image/jpeg,image/webp" hidden /></label>
                <button type="button" class="link" id="logo-reset" ${b.logo ? '' : 'hidden'}>Remove the logo</button>
                <span class="hint muted small">PNG, JPEG or WebP, under 300 KB once shrunk (CORE makes it at most 400 pixels). Shown on the sign-in page and the CORE home. SVG is not accepted.</span></div></div></div>
          <label class="field"><span>Sign-in headline</span><input name="headline" value="${b.headline}" placeholder="${DEFAULT_HEADLINE}" maxlength="${HEADLINE_MAX}" /><small class="muted">The large line on the sign-in page. Empty: “${DEFAULT_HEADLINE}”</small></label>
        </div>
      </section>
      <p class="form-error" role="alert" hidden></p>
      <div class="actions end"><button class="btn primary" type="submit">Save settings</button></div>
    </form>`);

  const form = el.querySelector('#settings-form');
  const colorText = form.color;
  const colorPick = form.colorPick;
  const note = el.querySelector('#contrast-note');
  const preview = () => {
    const theme = form.theme.value;
    const color = colorText.value.trim().toLowerCase();
    el.querySelector('#custom-dot').style.background = HEX_RE.test(color) ? color : '#888';
    const r = ratio(color);
    mount(note, theme !== 'custom' ? html`<span class="muted">Pick <strong>Company colour</strong> to use your own.</span>`
      : !HEX_RE.test(color) ? html`<span class="bad-text">Type the colour as # and six digits, e.g. #1e3a5f.</span>`
        : r >= MIN_CONTRAST ? html`<span class="ok-text">${icon('check', 14)} Readable: white text on it has a contrast of ${r} : 1 (at least ${MIN_CONTRAST} : 1 is needed).</span>`
          : html`<span class="bad-text">${icon('alert', 14)} Too light: white text on it has a contrast of only ${r} : 1, and at least ${MIN_CONTRAST} : 1 is needed. Choose a darker colour.</span>`);
    if (theme !== 'custom' || (HEX_RE.test(color) && r >= MIN_CONTRAST)) applyBrand(themeColors({ theme, color }));
  };
  form.addEventListener('change', (e) => {
    if (e.target.name === 'colorPick') {
      colorText.value = colorPick.value;
      form.querySelector('input[value=custom]').checked = true;
    }
    if (['theme', 'colorPick', 'color'].includes(e.target.name)) preview();
  });
  colorText.addEventListener('input', () => {
    if (HEX_RE.test(colorText.value.trim())) colorPick.value = colorText.value.trim().toLowerCase();
    form.querySelector('input[value=custom]').checked = true;
    preview();
  });
  preview();
  // Leaving without saving puts the saved colours back.
  const saved = () => applyBrand(ctx.brand || {});

  el.querySelector('#logo').addEventListener('change', async (e) => {
    try {
      logo = await shrinkLogo(e.target.files[0]);
      el.querySelector('#logo-preview').src = logo;
      el.querySelector('#logo-preview').alt = 'The new logo (not saved yet)';
      el.querySelector('#logo-reset').hidden = false;
      toast('Logo ready. Save settings to use it.');
    } catch (err) {
      toast(err.message, 'error');
    }
    e.target.value = '';
  });
  el.querySelector('#logo-reset').addEventListener('click', (e) => {
    logo = '';
    el.querySelector('#logo-preview').src = '/img/core-mark-brand.svg';
    el.querySelector('#logo-preview').alt = 'No logo: the CORE mark';
    e.target.hidden = true;
  });

  const errors = formErrors(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!errors.validate()) return;
    const fd = new FormData(form);
    const branding = { theme: fd.get('theme'), color: fd.get('theme') === 'custom' ? String(fd.get('color')).trim().toLowerCase() : '', headline: fd.get('headline') };
    if (logo !== undefined) branding.logo = logo;
    try {
      await api.put('/api/settings', {
        companyName: fd.get('companyName'), companyTin: fd.get('companyTin'), companyAddress: fd.get('companyAddress'),
        schedule: { shiftStart: fd.get('shiftStart'), shiftEnd: fd.get('shiftEnd'), breakMinutes: fd.get('breakMinutes'), workDays: fd.getAll('workDays').map(Number) },
        branding,
      });
      await Promise.all([ctx.refreshSettings(), ctx.refreshStatus()]);
      errors.clear();
      toast('Settings saved.');
      settingsView(el);
    } catch (err) {
      errors.server(err);
    }
  });
  return saved;
}

export async function securityView(el) {
  const security = await api.get('/api/security-settings');
  const checked = (b) => (b ? 'checked' : '');
  mount(el, html`
    ${pageHead('Sign-in & security', 'Who must use 2-step verification, how long people stay signed in, and the limits that slow down password guessing and floods of requests.')}
    <form id="security-form" class="card" novalidate>
      <p class="muted small">Each person sets up 2-step verification under their name → <strong>My security</strong>.</p>
      <div class="grid">
        <label class="field span-3"><span>2-step verification</span>
          <select name="twoFactor">${Object.entries(security.policies).map(([k, v]) => html`<option value="${k}" ${security.twoFactor === k ? 'selected' : ''}>${v}</option>`)}</select>
          <small class="muted">When required, people without it set it up the next time they sign in. Turn it on for your own account first.</small></label>
        <label class="field"><span>Sign out after (idle minutes)</span><input type="number" name="sessionIdleMinutes" min="5" max="1440" value="${security.sessionIdleMinutes}" /><small class="muted">Without using CORE. 480 = 8 hours.</small></label>
        <label class="field"><span>Longest session (hours)</span><input type="number" name="sessionMaxHours" min="1" max="720" value="${security.sessionMaxHours}" /><small class="muted">Then sign in again, even if in use.</small></label>
        <label class="field"><span>Requests per minute, per person</span><input type="number" name="requestsPerMinute" min="60" max="5000" value="${security.requestsPerMinute}" /><small class="muted">More than this is refused for a moment. 300 is plenty for normal use.</small></label>
        <label class="field"><span>Failed sign-ins per network address</span><input type="number" name="signInFailuresPerAddress" min="5" max="1000" value="${security.signInFailuresPerAddress}" /><small class="muted">In 15 minutes, any usernames. Then that address waits. An office behind one address may need more.</small></label>
        <label class="field check span-2"><input type="checkbox" name="blockCommonPasswords" ${checked(security.blockCommonPasswords)} /> <span>Refuse common passwords and passwords with the username or name</span></label>
      </div>
      <p class="muted small">Always on: a username is locked for 5, then 15, then 60 minutes after 5 wrong passwords in a row; changing a password, a role or 2-step verification signs the account out elsewhere; every sign-in, failure and lock is in the <a href="#/admin/audit?area=auth">Audit log</a>.</p>
      <p class="form-error" role="alert" hidden></p>
      <div class="actions end"><a class="btn ghost" href="#/admin/config?q=sign-in">Compare with the defaults</a><button class="btn primary" type="submit">Save sign-in settings</button></div>
    </form>`);
  const secErrors = formErrors(el.querySelector('#security-form'));
  el.querySelector('#security-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!secErrors.validate()) return;
    try {
      await api.put('/api/security-settings', {
        twoFactor: f.twoFactor.value, sessionIdleMinutes: Number(f.sessionIdleMinutes.value), sessionMaxHours: Number(f.sessionMaxHours.value),
        requestsPerMinute: Number(f.requestsPerMinute.value), signInFailuresPerAddress: Number(f.signInFailuresPerAddress.value),
        blockCommonPasswords: f.blockCommonPasswords.checked,
      });
      secErrors.clear();
      toast('Sign-in settings saved.');
    } catch (err) {
      secErrors.server(err);
    }
  });
}
