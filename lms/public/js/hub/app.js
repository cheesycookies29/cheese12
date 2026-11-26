// ATLAS home (/): one sign-in, then a card for each system the account may use (Academic,
// Learn, People, Finance, Facilities). Systems that are not built yet show as "Coming soon".
import { api } from '../api.js';
import { html, mount, option, initials, timeAgo, fmtDate, toast, money, today, modal } from '../ui.js';
import { ctx, applyBranding, failureNotice, authPlate, toastOnNextPage, atlasWord, markSrc, BYLINE, poweredBy, ssoBlock, passwordFields, showSsoError, passwordField, onFormSubmit, forcePasswordView, openChangePassword, setTheme, isDark, renderThemeButton, campusMenu, wireCampusMenu } from '../shell.js';
import { icon, iconSvg } from '../icons.js';
import { roleLabel, userCan } from '/shared/roles.js';
import { mountUserMenu, mountQuick, mountSystems, accountHref } from '../account/topbar.js';
import { mountBell } from '../account/notifications.js';
import { orderSystems, canOpen } from '/shared/systems.js';
import { codeStep, forceTwoFactorView } from '../account/two-factor.js';
import { schoolBrand, brand, brandHome, brandText } from '../brand.js';
import { SEXES, EDUCATION_LEVELS, ADDRESS_MAX, EARLIEST_BIRTH_DATE, listInWords } from '/shared/recruitment.js';
import { poolTickText, poolPrivacyText } from '/shared/recruitment-assess.js';
import { NAME_MAX, EMAIL_MAX, PASSWORDS_DIFFER, formatMobile } from '/shared/registration.js';
import { formsCss, formGroups, wireSearch } from '../forms.js';

const authEl = document.getElementById('auth');
const appEl = document.getElementById('app');
const NEXT_OK = { portal: ['/lms/', '/hris/', '/academic/', '/finance/', '/tools/', '/documents/', '/help/'], admin: ['/admin', '/hris/', '/academic/', '/finance/', '/tools/', '/documents/', '/help/'], hris: ['/hris/', '/finance/', '/tools/', '/documents/', '/help/'] };
const next = new URLSearchParams(location.search).get('next');

document.getElementById('theme-btn').addEventListener('click', () => setTheme(!isDark()));

function showAuth(render) {
  document.body.classList.add('auth-mode');
  document.body.classList.remove('booting');
  render(authEl);
}

// ----- Signed out -----
// jobs: open job openings anyone may apply for; the bar at the top then links to them.
// publicForms: forms anyone may download (Document circulation); the bar then links to them.
let jobsOpen = 0;
let publicForms = 0;
function hubScreen(card, systems, line, { wide = false } = {}) {
  const form = authPlate(authEl, {
    line,
    card,
    wide,
    links: html`${jobsOpen ? html`<a href="#jobs" id="jobs-link">${icon('briefcase', 16)} <span>Job openings</span></a>` : ''}${publicForms ? html`<a href="#forms" id="forms-link">${icon('download', 16)} <span>Forms</span></a>` : ''}`,
    ledger: [...systems.filter((s) => s.status === 'live'), ...systems.filter((s) => s.status !== 'live')].map((s) => [s.product, s.status !== 'live']),
  });
  return form;
}

function signInView(status) {
  if (status.setupRequired) {
    return hubScreen(html`<div class="auth-card"><h2>Not set up yet</h2><p class="muted">An administrator needs to set up the system first: create the administrator account and name the school.</p><a class="btn primary block" href="/admin">Set up in the admin panel</a></div>`, status.systems);
  }
  const form = hubScreen(html`
    <form class="auth-card" novalidate>
      <h2 class="sr-only">Sign in</h2>
      ${ssoBlock(status.sso, next || '/')}
      ${passwordFields(status.sso, html`<label class="field"><span>Username or email</span><input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required /></label>
      ${passwordField('Password', 'password', 'current-password')}
      <button class="btn ${status.sso?.enabled ? '' : 'primary'} block" type="submit">Sign in</button>`)}
      <p class="form-error" hidden></p>
      ${status.registrationOpen ? html`<div class="auth-or"><span>New student?</span></div>
      <button type="button" class="btn block register-btn" id="register">${icon('userPlus', 18)} Register account</button>` : ''}
      ${status.jobs ? html`<p class="auth-switch">Looking for a job? <a href="#jobs" id="see-jobs">See job openings</a></p>` : ''}
      ${status.publicForms ? html`<p class="auth-switch">Need a form? <a href="#forms" id="see-forms">Download forms</a> without signing in.</p>` : ''}
      <p class="auth-foot">${status.sso?.enabled && !status.sso.passwords ? 'Trouble signing in? Ask the registrar or your administrator.' : 'Forgot your password? Ask the registrar or your administrator to reset it.'}</p>
    </form>`, status.systems, brandText('ATLAS · Sign in'));
  form.querySelector('#register')?.addEventListener('click', () => {
    history.replaceState(null, '', `${location.pathname}${location.search}#register`);
    registerView(status);
  });
  showSsoError(form);
  onFormSubmit(form, async ({ username, password }) => {
    if (!username || !password) throw new Error('Enter your username or email, and your password.');
    const res = await api.post('/api/hub/login', { username, password });
    // With 2-step verification on, the code from the authenticator app comes next.
    if (res.twoFactorRequired) {
      return codeStep({ render: (card) => hubScreen(card, status.systems, brandText('ATLAS · Sign in')), verifyUrl: '/api/hub/login/verify', challenge: res.challenge, onSignedIn: boot, onBack: () => signInView(status) });
    }
    boot();
  });
}

// ----- Forms anyone may download (Document circulation, server/forms.js): signed out, no account -----
async function publicFormsView(status) {
  formsCss();
  const line = brandText('ATLAS · Forms');
  hubScreen(html`<div class="auth-card forms-card"><h2>Forms</h2><p class="muted">Loading…</p></div>`, status.systems, line);
  let d;
  try {
    d = await api.get('/api/public/forms');
  } catch (err) {
    d = { total: 0, modules: [], error: err.message };
  }
  hubScreen(html`<div class="auth-card forms-card">
      <h2>Forms</h2>
      <p class="muted">${d.total ? `Forms of ${status.branding.schoolName} you can download without an account, always the latest version.` : d.error || 'There are no forms to download here right now.'}</p>
      ${d.total > 6 ? html`<input type="search" data-form-search placeholder="Search forms…" aria-label="Search forms" />` : ''}
      ${d.modules.map((m) => html`${d.modules.length > 1 ? html`<h3 class="form-module">${m.name}</h3>` : ''}<div class="form-groups">${formGroups(m.categories, (f) => `/api/public/forms/${f.id}/file`)}</div>`)}
      <p class="muted" data-form-none hidden>No form matches.</p>
      <p class="auth-switch">Have an account? <button type="button" class="link" id="back">Sign in</button> for the forms of your systems.</p>
    </div>`, status.systems, line);
  wireSearch(authEl);
  authEl.querySelector('#back').addEventListener('click', () => {
    history.replaceState(null, '', location.pathname + location.search);
    signInView(status);
  });
}

// ----- Job openings and signing up as a job applicant (People → Recruitment; server/recruitment.js) -----
// Signed out, anyone may read the openings that are Open to all, then sign up with basic information
// only: that makes a temporary applicant account, which opens People's jobs area.
const localDay = (iso) => today(new Date(iso));
const jobLine = (o) => [o.office, o.campusName].filter(Boolean).join(' · ');
const salaryOf = (o) => (o.salaryGrade ? `SG ${o.salaryGrade}${o.monthlySalary ? ` · ${money(o.monthlySalary)} a month` : ''}` : '');
async function jobsView(status) {
  const back = () => {
    history.replaceState(null, '', location.pathname + location.search);
    signInView(status);
  };
  hubScreen(html`<div class="auth-card jobs-card"><h2>Job openings</h2><p class="muted">Loading…</p></div>`, status.systems, brandText('ATLAS · Job openings'));
  let d;
  try {
    d = await api.get('/api/jobs/openings');
  } catch (err) {
    d = { openings: [], signUpOpen: false, error: err.message };
  }
  hubScreen(html`<div class="auth-card jobs-card">
      <h2>Job openings</h2>
      <p class="muted">${d.openings.length ? `Positions open at ${status.branding.schoolName}. Choose one to read its qualification standards.` : d.error || 'There are no openings right now. Please check again later.'}</p>
      ${d.openings.length ? html`<div class="job-list">${d.openings.map((o) => html`<details class="job-item">
        <summary><strong>${o.title}</strong><small>${jobLine(o)}</small><small>${[salaryOf(o), `${o.vacancies} vacanc${o.vacancies === 1 ? 'y' : 'ies'}`, `apply by ${fmtDate(o.closingDate)}`].filter(Boolean).join(' · ')}</small></summary>
        ${o.description ? html`<p class="small pre">${o.description}</p>` : ''}
        <dl class="job-qs">${[['Education', o.education], ['Training', o.training], ['Experience', o.experience], ['Eligibility', o.eligibility]].map(([k, v]) => html`<dt>${k}</dt><dd>${v || '—'}</dd>`)}</dl>
      </details>`)}</div>` : ''}
      ${d.signUpOpen ? html`<button type="button" class="btn primary block" id="signup">Sign up to apply</button>` : ''}
      <p class="auth-switch">Signed up already, or work at the school? <button type="button" class="link" id="back">Sign in</button></p>
      <p class="auth-foot">Employees apply with their own account, from People → Job openings.</p>
    </div>`, status.systems, brandText('ATLAS · Job openings'));
  authEl.querySelector('#back').addEventListener('click', back);
  authEl.querySelector('#signup')?.addEventListener('click', () => signUpView(status, d));
}

// The sign-up form: the fixed fields (always required), then the fields HR shows (PL-016), each marked
// required or optional, and a privacy notice that lists exactly what this form collects.
const req = (required) => (required ? html`<em aria-hidden="true">*</em>` : html` <span class="muted">(optional)</span>`);
const flag = (required) => (required ? 'required' : '');
function signUpField(f, form) {
  switch (f.id) {
    case 'phone':
      return html`<label class="field"><span>Mobile number${req(f.required)}</span><input type="tel" name="phone" autocomplete="tel" placeholder="09xx xxx xxxx" ${flag(f.required)} /></label>`;
    case 'sex':
      return html`<label class="field"><span>Sex${req(f.required)}</span><select name="sex" ${flag(f.required)}>${option('', f.required ? 'Choose…' : '—')}${SEXES.map(([k, l]) => option(k, l))}</select></label>`;
    case 'birthDate':
      return html`<label class="field"><span>Date of birth${req(f.required)}</span><input type="date" name="birthDate" autocomplete="bday" min="${EARLIEST_BIRTH_DATE}" max="${form.latestBirthDate}" ${flag(f.required)} /><span class="hint" id="dob-hint">You must be at least ${form.minAge} years old.</span></label>`;
    case 'address':
      return html`<label class="field"><span>Home address${req(f.required)}</span><textarea name="address" rows="2" maxlength="${ADDRESS_MAX}" autocomplete="street-address" placeholder="House no., street, barangay, town or city, province" ${flag(f.required)}></textarea></label>`;
    case 'education':
      return html`<label class="field"><span>Highest educational attainment${req(f.required)}</span><select name="education" ${flag(f.required)}>${option('', f.required ? 'Choose…' : '—')}${EDUCATION_LEVELS.map(([k, l]) => option(k, l))}</select><span class="hint">The highest level you have reached, finished or not.</span></label>`;
    case 'campus':
      return html`<label class="field"><span>Preferred campus or place of assignment${req(f.required)}</span><select name="campus" ${flag(f.required)}>${option('', f.required ? 'Choose…' : 'No preference')}${form.campuses.map((c) => option(c.id, c.name))}</select></label>`;
    default:
      return '';
  }
}
function signUpView(status, jobs) {
  const closes = fmtDate(localDay(new Date(Date.now() + jobs.accountDays * 86400000).toISOString()));
  const form = jobs.signUp;
  const aboutYou = form.fields.some((f) => f.id !== 'phone');
  const el = hubScreen(html`
    <form class="auth-card" novalidate>
      <h2>Sign up to apply</h2>
      <p class="muted">Basic information only: your name, how to reach you${aboutYou ? ', a few details about you' : ''} and a password. Documents come later, with each application. Fields marked <em class="req">*</em> are required.</p>
      <label class="field"><span>Full name${req(true)}</span><input name="name" autocomplete="name" required /></label>
      <label class="field"><span>Email${req(true)}</span><input type="email" name="email" autocomplete="email" required /></label>
      ${form.fields.map((f) => signUpField(f, form))}
      <label class="field"><span>Choose a username${req(true)}</span><input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required /><span class="hint">3 to 40 lowercase letters, numbers, dots, dashes or underscores.</span></label>
      ${passwordField(html`Choose a password (at least 8 characters)${req(true)}`, 'password', 'new-password')}
      <div class="privacy-notice" role="note">
        <strong>${icon('shield', 15)} Your privacy</strong>
        <p>${status.branding.schoolName} keeps what you give here (your ${listInWords(form.collects)}) and your applications, only to consider you for its job openings and to contact you about them. The school's HR staff see them; other applicants never do.</p>
        <p>Your applicant account is open for ${jobs.accountDays} days, until ${closes}. ${jobs.purgeDays ? `${jobs.purgeDays} days after it closes, the account and the personal details in your applications are removed.` : 'Once it closes, HR removes the account and the personal details in your applications.'} You can ask HR to remove them sooner (Data Privacy Act of 2012).</p>
        <p id="pool-notice" hidden><strong>Pool of applicants:</strong> ${poolPrivacyText(jobs.poolMonths)}</p>
      </div>
      <label class="check-row"><input type="checkbox" name="pool" value="yes" id="pool-tick" /> <span>${poolTickText(jobs.poolMonths)} <span class="muted">(optional)</span></span></label>
      <label class="check-row"><input type="checkbox" name="consent" value="yes" /> <span>I have read this notice and agree to it.</span></label>
      <p class="form-error" hidden></p>
      <button class="btn primary block" type="submit">Create my applicant account</button>
      <p class="auth-switch"><button type="button" class="link" id="back">← Back to job openings</button></p>
    </form>`, status.systems, brandText('ATLAS · Job openings'));
  el.querySelector('#back').addEventListener('click', () => jobsView(status));
  // The privacy notice names the pool only when the box is ticked.
  el.querySelector('#pool-tick').addEventListener('change', (e) => (el.querySelector('#pool-notice').hidden = !e.target.checked));
  // The date as ATLAS shows it, under the date box: the box itself follows the browser's language.
  const dob = el.querySelector('[name=birthDate]');
  dob?.addEventListener('change', () => {
    el.querySelector('#dob-hint').textContent = dob.value ? `${fmtDate(dob.value)}. You must be at least ${form.minAge} years old.` : `You must be at least ${form.minAge} years old.`;
  });
  onFormSubmit(el, async (v) => {
    const answers = Object.fromEntries(form.fields.map((f) => [f.id, v[f.id] ?? '']));
    const out = await api.post('/api/jobs/signup', { name: v.name, email: v.email, username: v.username, password: v.password, ...answers, pool: v.pool === 'yes', consent: v.consent === 'yes' });
    // Signed in at once, and on to People's Job openings (boot sends applicants there).
    const res = await api.post('/api/hub/login', { username: out.username, password: v.password });
    if (res.twoFactorRequired) {
      return codeStep({ render: (card) => hubScreen(card, status.systems, brandText('ATLAS · Sign in')), verifyUrl: '/api/hub/login/verify', challenge: res.challenge, onSignedIn: boot, onBack: () => signInView(status) });
    }
    toastOnNextPage('Your applicant account is ready. Choose an opening to apply.', 'ok');
    boot();
  });
}

// ----- Create student account ("Register account" on the sign-in card; shared/registration.js) -----
// New students register themselves: campus, title, name, email, mobile number and a password. The
// account waits for the registrar (Admin panel → Applicants); once admitted, they sign in with the email.
const REG_LINE = 'Create Student Account';
const regTitle = (what) => `${what} · ${brand()}`; // the short name in school mode (brand.js)
// What the agreement line calls the school: its short name when its brand leads, else its name.
const schoolCalled = (b) => (schoolBrand() && b.shortName ? b.shortName : b.schoolName);
function backToSignIn(status) {
  history.replaceState(null, '', location.pathname + location.search);
  document.title = `${brand()} · ${status.branding.schoolName}`;
  signInView(status);
}
// A password box with an eye button that shows or hides what was typed.
const eyeField = (label, name, hint = '') => html`<label class="field"><span>${label}</span>
  <div class="pw-wrap eye"><input type="password" name="${name}" autocomplete="new-password" maxlength="200" required /><button type="button" class="pw-eye" data-eye aria-label="Show password" aria-pressed="false" title="Show password">${icon('eye', 18)}</button></div>
  ${hint ? html`<span class="hint">${hint}</span>` : ''}</label>`;
// The Terms of Use or Privacy Policy: a link to the school's page, or its text in a window.
function policyLink(policy, label, id) {
  if (!policy) return '';
  return policy.url
    ? html`<a href="${policy.url}" target="_blank" rel="noopener">${label}</a>`
    : html`<button type="button" class="link" id="${id}">${label}</button>`;
}
function showPolicy(title, policy) {
  modal({ title, wide: true, submitLabel: null, body: html`<div class="policy-text">${policy.text}</div>` });
}

async function registerView(status) {
  const b = status.branding;
  const plate = (card) => hubScreen(card, status.systems, REG_LINE, { wide: true });
  document.title = regTitle(REG_LINE);
  plate(html`<div class="auth-card"><p class="muted">Loading…</p></div>`);
  let f;
  try {
    f = await api.get('/api/auth/register');
  } catch (err) {
    plate(html`<div class="auth-card"><h2>Registration is closed</h2><p class="muted">${err.status === 403 ? 'New student accounts cannot be created here right now. Contact the registrar\'s office.' : err.message}</p><button type="button" class="btn primary block" id="back">Back to sign in</button></div>`);
    return authEl.querySelector('#back').addEventListener('click', () => backToSignIn(status));
  }
  const one = f.campuses.length === 1 ? f.campuses[0] : null;
  const rule = `At least ${f.password.min} characters${f.password.lettersAndDigits ? ', with letters and digits' : ''}.`;
  const form = plate(html`
    <form class="auth-card reg-card" novalidate>
      <h2 class="sr-only">${REG_LINE}</h2>
      <p class="muted">For new students. The registrar reviews your registration; once you are admitted, you sign in with your email.</p>
      ${one
        ? html`<label class="field"><span>Preferred Campus</span><input value="${one.name}" readonly required aria-describedby="campus-hint" /><input type="hidden" name="campusId" value="${one.id}" /><span class="hint" id="campus-hint">The school's only campus.</span></label>`
        : html`<label class="field"><span>Preferred Campus</span><select name="campusId" required>${option('', 'Select Option')}${f.campuses.map((c) => option(c.id, c.name))}</select></label>`}
      <div class="reg-pair">
        <label class="field"><span>Title</span><select name="title" autocomplete="honorific-prefix" required>${option('', 'Select Option')}${f.titles.map((t) => option(t, t))}</select></label>
        <label class="field"><span>First Name</span><input name="firstName" autocomplete="given-name" maxlength="${NAME_MAX}" required /></label>
      </div>
      <div class="reg-pair">
        <label class="field"><span>Middle Name <span class="muted field-optional">(optional)</span></span><input name="middleName" autocomplete="additional-name" maxlength="${NAME_MAX}" /></label>
        <label class="field"><span>Last Name</span><input name="lastName" autocomplete="family-name" maxlength="${NAME_MAX}" required /></label>
      </div>
      <div class="reg-pair">
        <label class="field"><span>Email Address</span><input type="email" name="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="${EMAIL_MAX}" required /><span class="hint">You sign in with it.</span></label>
        <label class="field"><span>Mobile Number</span><input type="tel" name="mobile" autocomplete="tel" inputmode="tel" maxlength="20" placeholder="09XX XXX XXXX" required /><span class="hint">09XXXXXXXXX or +639XXXXXXXXX.</span></label>
      </div>
      <div class="reg-pair">
        ${eyeField('Password', 'password', rule)}
        ${eyeField('Confirm Password', 'confirmPassword')}
      </div>
      <p class="form-error" hidden></p>
      <button class="btn primary block" type="submit">Register student account</button>
      <p class="auth-switch">Already have an account? <button type="button" class="link" id="to-sign-in">Click here</button> to sign in</p>
      <p class="auth-foot reg-agree">By using this service, you understand and agree to the ${schoolCalled(b)} online services ${f.terms ? html`${policyLink(f.terms, 'Terms of Use', 'terms-link')} and ` : ''}${policyLink(f.privacy, 'Privacy Policy', 'privacy-link')}.</p>
    </form>`);
  // The form starts at the top: the first box is the campus (or the title when there is one campus).
  (one ? form.querySelector('[name=title]') : form.querySelector('[name=campusId]'))?.focus();
  form.querySelector('#to-sign-in').addEventListener('click', () => backToSignIn(status));
  form.querySelector('#terms-link')?.addEventListener('click', () => showPolicy('Terms of Use', f.terms));
  form.querySelector('#privacy-link')?.addEventListener('click', () => showPolicy('Privacy Policy', f.privacy));
  form.querySelectorAll('[data-eye]').forEach((btn) => btn.addEventListener('click', () => {
    const input = btn.previousElementSibling;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    const label = show ? 'Hide password' : 'Show password';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.innerHTML = iconSvg(show ? 'eyeOff' : 'eye', 18);
  }));
  onFormSubmit(form, async (v) => {
    if (v.password && v.confirmPassword && v.password !== v.confirmPassword) throw new Error(PASSWORDS_DIFFER);
    const out = await api.post('/api/auth/register', {
      campusId: v.campusId, title: v.title, firstName: v.firstName, middleName: v.middleName, lastName: v.lastName,
      email: v.email, mobile: v.mobile, password: v.password, confirmPassword: v.confirmPassword,
    });
    registeredView(status, out);
  });
}

// After registering: what happens next. The account waits for the registrar.
function registeredView(status, out) {
  history.replaceState(null, '', location.pathname + location.search);
  document.title = regTitle('Registration received');
  hubScreen(html`<div class="auth-card reg-done" role="status">
      <span class="reg-done-ic" aria-hidden="true">${icon('checkCircle', 30)}</span>
      <h2>Registration received</h2>
      <p class="muted">Thank you, ${out.name}. Your student account for ${out.campusName} is registered and waiting for the registrar.</p>
      <h3>What happens next</h3>
      <ol class="reg-steps">
        <li><strong>The registrar reviews your registration.</strong> They may contact you at ${out.email} or ${formatMobile(out.mobile)}. You do not need to register again.</li>
        <li><strong>You are admitted.</strong> You get a student number, and your account opens.</li>
        <li><strong>You sign in with your email</strong>, <span class="mono">${out.email}</span>, and the password you chose. Until you are admitted, signing in shows that your registration is still being reviewed.</li>
      </ol>
      <p class="auth-foot">Questions about your registration? Contact the registrar's office.</p>
      <button type="button" class="btn primary block" id="ok">Back to sign in</button>
    </div>`, status.systems, 'Registration received');
  authEl.querySelector('#ok').addEventListener('click', () => backToSignIn(status));
  authEl.querySelector('#ok').focus();
}

// ----- Signed in -----
// The menu under your name and Quick access, as in every system (public/js/account/topbar.js).
function userMenu(status) {
  mountUserMenu(document.getElementById('user-box'), status.user, {
    info: status,
    here: '/',
    onPassword: () => openChangePassword(status.authBase),
    onSignOut: signOut,
    onTheme: () => setTheme(!isDark()),
    campusMenu: campusMenu(status),
    wireCampus: (root) => wireCampusMenu(root, status.authBase),
  });
  if (document.getElementById('quick-btn')) return;
  mountSystems(document.getElementById('help-btn'));
  mountQuick(document.getElementById('help-btn'), {
    user: status.user,
    current: () => null, // the home page itself is one click away (the mark in the top bar)
    suggestions: () => [
      ...status.systems.filter((s) => s.status === 'live' && s.url && !s.external).map((s) => ({ href: s.url, label: s.product, icon: s.icon })),
      ...(status.tools || []).map((t) => ({ href: t.path, label: t.product, icon: t.icon })),
      { href: accountHref(status.user, 'profile'), label: 'My profile', icon: 'user' },
      { href: accountHref(status.user, 'security'), label: 'My security', icon: 'shield' },
    ],
  });
  mountBell(document.getElementById('help-btn'), { user: status.user, here: '/' }); // after Quick access
}

const dateBox = (ymd) => {
  const d = new Date(`${ymd}T00:00:00`);
  return html`<div class="date-box"><b>${d.toLocaleDateString('en-PH', { month: 'short' })}</b><span>${d.getDate()}</span></div>`;
};

// A name never breaks at its hyphen ("e-Reader" stays whole): the hyphens become non-breaking ones.
const noBreak = (name) => String(name).replace(/-/g, '\u2011');

function systemCard(s, side, figures = []) {
  const live = s.status === 'live' && s.url;
  // The admin panel has its own place under Administration; from here it is where Learn is run.
  const openLabel = s.id === 'lms' && side === 'admin' ? 'Manage Learn' : `Open ${s.product}`;
  const body = html`
    <span class="sys-top"><span class="sys-ic">${icon(s.icon, 26)}</span>${live ? html`<span class="sys-code">${s.short}</span>` : html`<span class="badge gray">${icon('lock', 12)} Coming soon</span>`}</span>
    <span class="sys-name" title="${s.title}">${noBreak(s.product)}</span>
    <p>${s.description}</p>
    ${live && figures.length ? html`<ul class="sys-figs">${figures.map((f) => html`<li>${f}</li>`)}</ul>` : ''}
    <span class="sys-open">${live ? html`${openLabel} ${icon(s.external ? 'external' : 'chevronRight', 16)}` : 'Not available yet'}</span>`;
  return live
    ? html`<a class="sys-card" href="${s.url}" data-system="${s.id}" ${s.external ? html`target="_blank" rel="noopener"` : ''}>${body}</a>`
    : html`<div class="sys-card soon" data-system="${s.id}" aria-disabled="true" title="${s.product} is coming soon">${body}</div>`;
}

// The star that pins a system to the front (after CORE's home, 0.40).
const pinButton = (s, on, size = 18) => html`<button type="button" class="sys-pin" data-pin="${s.id}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${on ? `Unpin ${s.product}` : `Pin ${s.product} to the front`}" title="${on ? 'Pinned to the front: click to unpin' : 'Pin to the front'}">${icon('star', size)}</button>`;
// A card in the sliding row: a system you can open has its star.
const cardSlot = (s, side, figures, on) => (canOpen(s) ? html`<div class="sys-slot${on ? ' pinned' : ''}" data-system="${s.id}">${systemCard(s, side, figures)}${pinButton(s, on)}</div>` : systemCard(s, side));
// A tile in the compact view (CORE 0.46): every system at once, the first figure (or what it is) under its name.
function miniTile(s, figures, on) {
  if (!canOpen(s)) return html`<div class="sys-mini soon" data-system="${s.id}" aria-disabled="true" title="${s.product}: coming soon"><span class="sys-ic">${icon(s.icon, 20)}</span><span class="grow"><strong>${noBreak(s.product)}</strong><small>${icon('lock', 11)} Coming soon</small></span></div>`;
  return html`<div class="sys-mini-slot${on ? ' pinned' : ''}" data-system="${s.id}"><a class="sys-mini" href="${s.url}" title="Open ${s.product}" ${s.external ? html`target="_blank" rel="noopener"` : ''}><span class="sys-ic">${icon(s.icon, 20)}</span><span class="grow"><strong>${noBreak(s.product)}</strong><small>${figures[0] || s.title}</small></span></a>${pinButton(s, on, 16)}</div>`;
}

// "Your systems" as a carousel: the cards scroll sideways and snap into place (swipe on a phone,
// arrows or dots elsewhere, or arrow keys once the row has focus). Live systems come first.
// The arrows and dots only show when some cards are out of view.
// Returns a function to call after the cards are redrawn (a system pinned or unpinned).
function systemsCarousel(wrap) {
  const track = wrap.querySelector('#sys-track');
  const arrows = document.querySelector('.sys-arrows');
  const prev = document.getElementById('sys-prev');
  const next = document.getElementById('sys-next');
  const dots = document.getElementById('sys-dots');
  const smooth = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
  const cardStep = () => (track.children[1] ? track.children[1].offsetLeft - track.children[0].offsetLeft : track.clientWidth);
  const perPage = () => Math.max(1, Math.round(track.clientWidth / cardStep()));
  const pages = () => Math.max(1, Math.ceil(track.children.length / perPage() - 0.01));
  const atEnd = () => track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
  const pageNow = () => (atEnd() ? pages() - 1 : Math.min(pages() - 1, Math.round(track.scrollLeft / (cardStep() * perPage()))));
  const goPage = (n) => track.scrollTo({ left: Math.max(0, n) * cardStep() * perPage(), behavior: smooth() });
  let drawn = -1;
  const update = () => {
    const overflow = track.scrollWidth > track.clientWidth + 2;
    arrows.hidden = !overflow;
    dots.hidden = !overflow;
    wrap.classList.toggle('more-left', overflow && track.scrollLeft > 4);
    wrap.classList.toggle('more-right', overflow && track.scrollLeft + track.clientWidth < track.scrollWidth - 4);
    prev.disabled = track.scrollLeft <= 4;
    next.disabled = atEnd();
    if (!overflow) return;
    if (drawn !== pages()) {
      drawn = pages();
      dots.innerHTML = Array.from({ length: drawn }, (_, i) => `<button type="button" data-page="${i}" aria-label="Systems, page ${i + 1} of ${drawn}"></button>`).join('');
    }
    [...dots.children].forEach((d, i) => d.setAttribute('aria-current', i === pageNow() ? 'true' : 'false'));
  };
  prev.addEventListener('click', () => goPage(pageNow() - 1));
  next.addEventListener('click', () => goPage(pageNow() + 1));
  dots.addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b) goPage(Number(b.dataset.page));
  });
  track.addEventListener('keydown', (e) => {
    if (e.target !== track || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    track.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * cardStep(), behavior: smooth() });
  });
  // A card reached with Tab is brought fully into view.
  track.addEventListener('focusin', (e) => {
    const card = e.target.closest('.sys-slot, .sys-card');
    if (card && card !== track) card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: smooth() });
  });
  let raf = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(update);
  }, { passive: true });
  new ResizeObserver(update).observe(track);
  update();
  return () => {
    drawn = -1;
    update();
  };
}

// Administration, as on CORE's home page: the admin panel, and shortcuts to the pages in it that
// apply to every system. Only for accounts that open the admin panel (administrators, registrars),
// and each shortcut only for those whose account may open that page.
function administration(status) {
  const u = status.user;
  if (status.side !== 'admin' || !userCan(u, 'dashboard')) return '';
  const admin = u.role === 'admin';
  const tiles = [
    admin && ['/admin#/system/users', 'users', 'Users & Access', 'Every account, its access and sign-in'],
    userCan(u, 'settings.edit') && ['/admin#/config', 'search', 'Settings center', 'Every setting, its history and undo'],
    admin && ['/admin#/system/audit', 'table', 'Audit log', 'Sign-ins, changes and refused requests'],
    userCan(u, 'enrollment.manage') && ['/admin#/enrollment', 'clipboard', 'Enrollment requests', 'Waiting for the registrar'],
    userCan(u, 'students.manage') && ['/admin#/applicants', 'userPlus', 'Applicants', 'Applications for admission'],
  ].filter(Boolean).slice(0, 3);
  tiles.push(['/help/#/whats-new', 'sparkle', 'What\'s new', 'What changed in each update']);
  const covers = admin
    ? 'Users and access, campuses, the catalog, modules, the Settings center, branding, sign-in security, data and backups'
    : 'Enrollment, applicants and students, the catalog, terms and sections, news and the school calendar';
  return html`<section class="hub-wrap" aria-labelledby="admin-heading">
    <div class="card-head"><h2 id="admin-heading">${icon('settings')} Administration</h2><span class="muted small">Applies to every system</span></div>
    <a class="admin-hero" href="/admin">
      <span class="admin-hero-ic">${icon('shield', 26)}</span>
      <span class="grow"><strong>Admin panel</strong><small>${covers}</small></span>
      <span class="admin-hero-open">Open ${icon('chevronRight', 16)}</span>
    </a>
    <div class="admin-tiles">${tiles.map(([href, ic, title, sub]) => html`<a class="admin-tile" href="${href}"><span class="ic-box">${icon(ic, 20)}</span><span class="grow"><strong>${title}</strong><small>${sub}</small></span>${icon('chevronRight', 16)}</a>`)}</div>
  </section>`;
}

// Tools (/tools/): PDF Studio and the like, for the account types an administrator switched them on
// for (Admin panel → Home page & systems → Tools). One tile each, under the systems.
function toolsSection(status, view) {
  const tools = status.tools || [];
  if (!tools.length) return '';
  const card = (t) => html`<a class="sys-card tool-card int-${t.accent || 'red'}" href="${t.path}" data-tool="${t.id}">
      <span class="sys-top"><span class="sys-ic">${icon(t.icon || 'file', 24)}</span><span class="tool-badge">${t.code}</span></span>
      <span class="sys-name">${t.product}</span>
      <p>${t.description}</p>
      ${(t.features || []).length ? html`<ul class="tool-feats" aria-label="What it does">${t.features.map((f) => html`<li>${f}</li>`)}</ul>` : ''}
      <span class="sys-open">Open ${t.product} ${icon('chevronRight', 16)}</span>
    </a>`;
  const mini = (t) => html`<a class="sys-mini tool-mini int-${t.accent || 'red'}" href="${t.path}" data-tool="${t.id}"><span class="sys-ic">${icon(t.icon || 'file', 20)}</span><span class="grow"><strong>${t.product}</strong><small>${t.title}</small></span></a>`;
  return html`<section class="hub-wrap sys-section tool-section${view === 'compact' ? ' compact' : ''}" id="tool-section" aria-labelledby="tools-heading">
    <div class="card-head"><h2 id="tools-heading">${icon('grid')} Tools</h2><span class="muted small">For any work, in any system</span></div>
    <div class="tool-grid">${tools.map(card)}</div>
    <div class="sys-compact">${tools.map(mini)}</div>
  </section>`;
}

async function homeView(status) {
  const u = status.user;
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  // Pinned first (in the order pinned), then the others you can open, then coming soon (shared/systems.js).
  const pinned = () => (u.favoriteSystems || []).filter((id) => status.systems.some((s) => s.id === id && canOpen(s)));
  const ordered = () => orderSystems(status.systems, pinned());
  const live = status.systems.filter(canOpen).length;
  const soon = status.systems.length - live;
  let figures = {};
  const trackItems = () => html`${ordered().map((s) => cardSlot(s, status.side, figures[s.id] || [], pinned().includes(s.id)))}`;
  const compactItems = () => html`${ordered().map((s) => miniTile(s, figures[s.id] || [], pinned().includes(s.id)))}`;
  // Cards (the sliding row) or Compact (all at once), kept in this browser; a phone starts in Compact.
  const VIEW_KEY = 'atlas-home-view';
  let view = matchMedia('(max-width: 760px)').matches ? 'compact' : 'cards';
  try {
    const chosen = localStorage.getItem(VIEW_KEY);
    if (chosen === 'compact' || chosen === 'cards') view = chosen;
  } catch {}
  mount(appEl, html`
    <section class="hub-hero">${schoolBrand() ? (status.branding.logo ? html`<img class="hero-mark hero-seal" src="${status.branding.logo}" alt="" />` : '') : html`<img class="hero-mark" src="/img/brand/atlas-mark-white.svg" alt="" />`}<div class="hub-wrap">
      <p class="hub-kicker">${new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${status.branding.termName ? ` · ${status.branding.termName}` : ''}</p>
      <h1>${hello}, ${u.name.split(' ')[0]}</h1>
      <p>${schoolBrand() ? `Welcome to ${brand()}'s online services. Choose a system to continue.` : `Welcome to ATLAS, the education platform of ${status.branding.schoolName}. Choose a system to continue.`}</p>
      <a class="hub-role" href="${accountHref(u, 'profile')}" title="My profile">${icon('user', 14)} ${u.title || roleLabel(u.role)}${u.studentNo ? ` · ${u.studentNo}` : ''}</a>
      ${status.campusName ? html`<span class="hub-role">${icon('building', 14)} ${status.campusName}${status.campuses.length > 1 ? html` · <button type="button" class="link hub-switch" id="hub-switch">switch</button>` : ''}</span>` : ''}
    </div></section>
    <section class="hub-wrap sys-section${view === 'compact' ? ' compact' : ''}" id="sys-section">
      <div class="card-head"><h2 id="sys-heading">${icon('grid')} Your systems</h2>
        <div class="sys-nav"><span class="muted small sys-count">${live} available to you${soon ? ` · ${soon} coming soon` : ''}</span>
          <div class="seg-btns sys-view" role="group" aria-label="How to show the systems">${[['cards', 'Cards', 'Large cards with live figures, in a sliding row'], ['compact', 'Compact', 'Every system at once, in a grid']].map(([k, label, title]) => html`<button type="button" data-view="${k}" class="${view === k ? 'active' : ''}" aria-pressed="${view === k ? 'true' : 'false'}" title="${title}">${label}</button>`)}</div>
          <span class="sys-arrows" hidden><button type="button" class="icon-btn" id="sys-prev" aria-label="Previous systems" aria-controls="sys-track">${icon('chevronLeft', 18)}</button><button type="button" class="icon-btn" id="sys-next" aria-label="More systems" aria-controls="sys-track">${icon('chevronRight', 18)}</button></span></div></div>
      <div class="sys-carousel" id="sys-carousel">
        <div class="sys-track" id="sys-track" role="region" aria-labelledby="sys-heading" tabindex="0">${trackItems()}</div>
      </div>
      <div class="sys-dots" id="sys-dots" hidden></div>
      <div class="sys-compact" id="sys-compact" role="region" aria-labelledby="sys-heading">${compactItems()}</div>
    </section>
    ${toolsSection(status, view)}
    <section class="hub-wrap hub-forms" id="hub-forms" aria-labelledby="forms-heading" hidden></section>
    ${administration(status)}
    <section class="hub-wrap cols wide-left" id="feed"></section>
    <footer class="hub-foot"><div class="hub-wrap"><span>© ${new Date().getFullYear()} ${status.branding.schoolName}</span>${schoolBrand() ? html`<span class="atlas-foot">${poweredBy()}</span>` : html`<span class="atlas-foot"><img src="${markSrc(isDark())}" alt="" />ATLAS · ${BYLINE}</span>`}</div></footer>`);
  const refresh = systemsCarousel(appEl.querySelector('#sys-carousel'));
  const track = appEl.querySelector('#sys-track');
  const compact = appEl.querySelector('#sys-compact');
  const section = appEl.querySelector('#sys-section');
  const redraw = () => {
    mount(track, trackItems());
    mount(compact, compactItems());
    refresh();
  };
  appEl.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    view = b.dataset.view;
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {}
    section.classList.toggle('compact', view === 'compact');
    appEl.querySelector('#tool-section')?.classList.toggle('compact', view === 'compact');
    appEl.querySelectorAll('[data-view]').forEach((x) => {
      x.classList.toggle('active', x.dataset.view === view);
      x.setAttribute('aria-pressed', String(x.dataset.view === view));
    });
    if (view === 'cards') refresh();
  }));
  // Pin or unpin: saved on the account (it follows you), then both views are redrawn in the new
  // order with the focus kept on the same star.
  const onPin = async (e) => {
    const btn = e.target.closest('[data-pin]');
    if (!btn) return;
    e.preventDefault();
    const id = btn.dataset.pin;
    const was = pinned();
    const next = was.includes(id) ? was.filter((x) => x !== id) : [...was, id];
    btn.disabled = true;
    try {
      u.favoriteSystems = (await api.put('/api/me/favorite-systems', { systems: next })).favoriteSystems;
    } catch (err) {
      btn.disabled = false;
      return toast(err.message || 'Could not save your pinned systems.', 'error');
    }
    redraw();
    track.scrollTo({ left: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    (view === 'compact' ? compact : track).querySelector(`[data-pin="${id}"]`)?.focus({ preventScroll: true });
    window.dispatchEvent(new Event('systems:changed')); // the Systems menu puts pinned ones first too
    const name = status.systems.find((s) => s.id === id)?.product || id;
    toast(next.includes(id) ? `${name} is pinned: it comes first on your ${brandHome()}.` : `${name} is no longer pinned.`);
  };
  track.addEventListener('click', onPin);
  compact.addEventListener('click', onPin);
  // A few live figures on each card, once they are worked out (the page does not wait for them).
  api.get('/api/hub/figures').then((f) => {
    figures = f || {};
    if (appEl.contains(track)) redraw();
  }).catch(() => {});
  appEl.querySelector('#hub-switch')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('user-pop').hidden = false;
  });
  // Forms & downloads: the school-wide forms for this person (Document circulation), when there are any.
  api.get('/api/forms?module=home').then((d) => {
    const box = appEl.querySelector('#hub-forms');
    if (!box || !d.total) return;
    formsCss();
    mount(box, html`<div class="card-head"><h2 id="forms-heading">${icon('download')} Forms &amp; downloads</h2><span class="muted small">School-wide forms, always the latest version</span></div>
      <div class="form-groups">${formGroups(d.categories, (f) => `/api/forms/${f.id}/file`)}</div>`);
    box.hidden = false;
  }).catch(() => {});
  const feed = await api.get('/api/hub/feed').catch(() => ({ news: [], events: [] }));
  if (!feed.news.length && !feed.events.length) return appEl.querySelector('#feed').remove();
  mount(appEl.querySelector('#feed'), html`
    <section class="card"><div class="card-head"><h2>${icon('news')} Announcements</h2></div>
      ${feed.news.length ? html`<div class="list">${feed.news.map((n) => html`<div class="list-item"><span class="item-ic">${icon(n.pinned ? 'pin' : 'megaphone')}</span>
        <span class="grow"><strong>${n.title}</strong><small>${n.authorName} · ${timeAgo(n.createdAt)}${n.comments ? ` · ${n.comments} comment${n.comments === 1 ? '' : 's'}` : ''}</small>${n.body ? html`<p class="small pre" style="margin:6px 0 0">${n.body}${n.body.length >= 280 ? '…' : ''}</p>` : ''}</span></div>`)}</div>` : html`<p class="muted">No announcements.</p>`}
    </section>
    <section class="card"><div class="card-head"><h2>${icon('calendar')} Upcoming events</h2></div>
      ${feed.events.length ? html`<div class="list">${feed.events.map((e) => html`<div class="list-item">${dateBox(e.startDate)}<span class="grow"><strong>${e.title}</strong><small>${fmtDate(e.startDate)}${e.endDate && e.endDate !== e.startDate ? ` – ${fmtDate(e.endDate)}` : ''}${e.location ? ` · ${e.location}` : ''}</small></span></div>`)}</div>` : html`<p class="muted">Nothing scheduled.</p>`}
    </section>`);
}

async function signOut() {
  const out = await api.post('/api/hub/logout').catch(() => ({}));
  location.href = out?.ssoLogout || '/'; // a Keycloak session ends at Keycloak, which comes back here
}

async function boot() {
  let status;
  try {
    status = await api.get('/api/hub/status');
  } catch (err) {
    return showAuth((el) => mount(el, failureNotice(err)));
  }
  ctx.info = status;
  ctx.user = status.user;
  applyBranding(status.branding);
  document.title = `${brand()} · ${status.branding.schoolName}`;
  jobsOpen = status.jobs || 0;
  publicForms = status.publicForms || 0;
  if (!status.user) {
    const view = location.hash === '#jobs' ? jobsView : location.hash === '#forms' && publicForms ? publicFormsView : location.hash === '#register' && status.registrationOpen ? registerView : signInView;
    return showAuth(() => view(status));
  }
  if (status.user.mustChangePassword) {
    return showAuth((el) => forcePasswordView(el, { admin: status.side === 'admin', authBase: status.authBase, onDone: boot, onSignOut: signOut }));
  }
  if (status.user.twoFactorSetupRequired) {
    return showAuth((el) => forceTwoFactorView(el, { render: (card) => hubScreen(card, status.systems, brandText('ATLAS · 2-step verification')), onDone: boot, onSignOut: signOut }));
  }
  // A job applicant has only People's jobs area (and Help).
  if (status.user.role === 'applicant') return location.replace(next === '/help/' ? next : '/hris/#/jobs');
  // Came from a system that needed a sign-in: go straight back there.
  if (next && NEXT_OK[status.side]?.includes(next)) return location.replace(next);
  document.body.classList.remove('auth-mode', 'booting');
  mount(authEl, '');
  mount(document.getElementById('school-name'), atlasWord());
  mount(document.getElementById('brand-sub'), html`${status.branding.schoolName}${status.campusName ? html` · <strong class="campus-name">${status.campusName}</strong>` : ''}${status.branding.termName ? ` · ${status.branding.termName}` : ''}`);
  renderThemeButton();
  const helpBtn = document.getElementById('help-btn');
  helpBtn.innerHTML = iconSvg('help');
  helpBtn.hidden = false;
  userMenu(status);
  homeView(status);
}

window.addEventListener('auth:expired', () => boot());
// "Job openings" (the bar at the top, the sign-in card, or a link to /#jobs): the openings, signed out.
// "Register account" (or a link to /#register): Create student account, while registration is open.
window.addEventListener('hashchange', () => {
  if (ctx.user || !ctx.info) return;
  if (location.hash === '#jobs') jobsView(ctx.info);
  else if (location.hash === '#forms' && publicForms) publicFormsView(ctx.info);
  else if (location.hash === '#register' && ctx.info.registrationOpen) registerView(ctx.info);
});
boot();
