// Student self-registration ("Register account" → Create student account) and signing in with an
// email on the ATLAS home page: server/api.js, shared/registration.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setup } from './support.js';
import { setPasswordKeys } from '../server/auth.js';
import { codeAt, stepAt } from '../server/totp.js';
import { TITLES, normaliseMobile, formatMobile, composeName, usernameFromEmail, checkRegistration, defaultPrivacyText } from '../shared/registration.js';

setPasswordKeys(randomBytes(32).toString('hex')); // 2-step verification secrets are kept encrypted

const PW = 'password123';
const status = (code, re) => (e) => e.status === code && (!re || re.test(e.message));
const START = Date.parse('2026-08-10T10:00:00');

// A school with an administrator, a second campus and registration open (unless `open: false`).
async function school({ open = true } = {}) {
  const time = { now: START };
  const env = setup({ clock: () => new Date(time.now) });
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', email: 'admin@school.test', password: PW, campusName: 'Main Campus' });
  const north = await admin.post('/api/admin/campuses', { name: 'North Campus', code: 'NOR' });
  if (open) await admin.put('/api/admin/settings', { registration: { open: true } });
  const main = env.db.data.campuses.find((c) => c.name === 'Main Campus');
  const form = (extra = {}) => ({
    campusId: main.id, title: 'Mr.', firstName: 'Juan', middleName: 'Santos', lastName: 'Dela Cruz',
    email: 'juan.delacruz@mail.test', mobile: '0917 123 4567', password: 'Secret-2026', confirmPassword: 'Secret-2026', ...extra,
  });
  const user = (pred) => env.db.data.users.find(pred);
  const code = (secret) => {
    time.now += 30 * 1000;
    return codeAt(secret, stepAt(time.now));
  };
  return { env, admin, north, main, form, user, code, time };
}

test('the shared rules: titles, mobile numbers, the display name, usernames from an email', () => {
  assert.deepEqual(TITLES, ['Mr.', 'Ms.', 'Mrs.']);
  for (const ok of ['09171234567', '0917 123 4567', '0917-123-4567', '+639171234567', '+63 917 123 4567', '(0917) 123 4567']) assert.equal(normaliseMobile(ok), '+639171234567', ok);
  for (const bad of ['', '9171234567', '0917123456', '091712345678', '08171234567', '+63917123456', '+649171234567', '639171234567', 'abc', '+63 2 8123 4567']) assert.equal(normaliseMobile(bad), null, bad);
  assert.equal(formatMobile('+639171234567'), '0917 123 4567');
  assert.equal(composeName({ firstName: ' Juan ', middleName: 'santos', lastName: 'Dela  Cruz' }), 'Juan S. Dela Cruz');
  assert.equal(composeName({ firstName: 'Ma. Clara', middleName: '', lastName: 'Reyes' }), 'Ma. Clara Reyes');
  const taken = new Set(['juan', 'juan2', 'jo.student']);
  assert.equal(usernameFromEmail('Juan@mail.test', (n) => taken.has(n)), 'juan3');
  assert.equal(usernameFromEmail('jo@mail.test', (n) => taken.has(n)), 'jo.student2');
  assert.equal(usernameFromEmail('.+x!@mail.test', () => false), 'x.student');
  assert.equal(usernameFromEmail('Ñino+tag@mail.test', () => false), 'inotag');
  assert.match(usernameFromEmail(`${'a'.repeat(80)}@mail.test`, () => false), /^[a-z0-9._-]{3,40}$/);
  assert.equal(checkRegistration({}).problem, 'Choose your preferred campus.');
  const privacy = defaultPrivacyText('Lancaster Academy');
  for (const what of ['preferred campus', 'title', 'first, middle and last name', 'email address', 'mobile number', 'password', 'admission', 'contact you', 'student records', 'registrar']) assert.match(privacy, new RegExp(what), what);
});

test('registration closed: no Register account button, and the form and the route refuse', async () => {
  const { env, admin, form } = await school({ open: false });
  const visitor = env.client();
  assert.equal((await visitor.get('/api/hub/status')).registrationOpen, false);
  await assert.rejects(visitor.get('/api/auth/register'), status(403, /Registration is closed/));
  await assert.rejects(visitor.post('/api/auth/register', form()), status(403, /Registration is closed/));
  assert.equal(env.db.data.users.length, 1);
  // The old way in is gone: one path only.
  for (const [m, p] of [['post', '/api/auth/apply'], ['get', '/api/auth/campuses'], ['get', '/api/auth/programs']]) await assert.rejects(visitor[m](p, {}), status(404), p);
  await admin.put('/api/admin/settings', { registration: { open: true } });
  assert.equal((await visitor.get('/api/hub/status')).registrationOpen, true);
  const f = await visitor.get('/api/auth/register');
  assert.deepEqual(f.campuses.map((c) => c.name), ['Main Campus', 'North Campus']);
  assert.deepEqual(f.titles, TITLES);
  assert.deepEqual(f.password, { min: 8, lettersAndDigits: false });
});

test('registration: every field is checked, in the order of the form', async () => {
  const { env, admin, form, north } = await school();
  const visitor = env.client();
  // Each from its own address, so the limit of ten an hour does not get in the way.
  let n = 0;
  const refused = async (extra, re, code = 400) => assert.rejects(env.client({ ip: `192.0.2.${++n}` }).post('/api/auth/register', form(extra)), status(code, re), JSON.stringify(extra));
  await refused({ campusId: '' }, /Choose your preferred campus/);
  await refused({ campusId: 'nowhere' }, /campus is not on the list/);
  await refused({ title: '' }, /Choose your title/);
  await refused({ title: 'Dr.' }, /Choose a title from the list: Mr\., Ms\., Mrs\./);
  await refused({ firstName: '  ' }, /Type your first name/);
  await refused({ lastName: '' }, /Type your last name/);
  await refused({ firstName: 'J4an' }, /First name: use letters/);
  await refused({ lastName: '...' }, /Last name: use letters/);
  await refused({ middleName: '<b>' }, /Middle name: use letters/);
  await refused({ firstName: 'A'.repeat(61) }, /First name: at most 60 characters/);
  await refused({ email: '' }, /Type your email address/);
  await refused({ email: 'juan@' }, /does not look right/);
  await refused({ mobile: '' }, /Type your mobile number/);
  await refused({ mobile: '9171234567' }, /Philippine mobile number: 09XXXXXXXXX or \+639XXXXXXXXX/);
  await refused({ mobile: '+6391712345678' }, /Philippine mobile number/);
  await refused({ password: 'short', confirmPassword: 'short' }, /at least 8 characters/);
  await refused({ confirmPassword: 'Secret-2027' }, /passwords do not match/);
  await refused({ confirmPassword: undefined }, /passwords do not match/);
  // The school's password rules apply.
  await admin.put('/api/admin/settings', { security: { minPasswordLength: 10, requireLettersAndDigits: true } });
  assert.deepEqual((await visitor.get('/api/auth/register')).password, { min: 10, lettersAndDigits: true });
  await refused({ password: 'Secret-26', confirmPassword: 'Secret-26' }, /at least 10 characters/);
  await refused({ password: 'only-letters', confirmPassword: 'only-letters' }, /letters and digits/);
  // Fields the form does not have are not taken (no way to make yourself active or an administrator).
  assert.equal(env.db.data.users.length, 1);
  const ok = await visitor.post('/api/auth/register', { ...form({ campusId: north.id, middleName: '', firstName: 'Ma. Niña', lastName: "O'Neil-Reyes", email: 'NINA@Mail.TEST', mobile: '+63 918 765 4321' }), role: 'admin', status: 'active', username: 'boss' });
  assert.deepEqual(ok, { ok: true, name: "Ma. Niña O'Neil-Reyes", email: 'nina@mail.test', mobile: '+639187654321', campusName: 'North Campus' });
  const nina = env.db.data.users.find((u) => u.email === 'nina@mail.test');
  assert.equal(nina.role, 'student');
  assert.equal(nina.status, 'pending');
  assert.equal(nina.username, 'nina');
});

test('registration: a pending student account with the name parts, title, mobile and a username from the email', async () => {
  const { env, admin, form, main, user } = await school();
  const visitor = env.client();
  await visitor.post('/api/auth/register', form({ firstName: '  Juan ', lastName: 'Dela   Cruz' }));
  const u = user((x) => x.email === 'juan.delacruz@mail.test');
  assert.equal(u.role, 'student');
  assert.equal(u.status, 'pending');
  assert.equal(u.name, 'Juan S. Dela Cruz');
  assert.deepEqual([u.title, u.firstName, u.middleName, u.lastName], ['Mr.', 'Juan', 'Santos', 'Dela Cruz']);
  assert.equal(u.mobile, '+639171234567');
  assert.equal(u.username, 'juan.delacruz');
  assert.deepEqual(u.campusIds, [main.id]);
  assert.equal(u.studentNo, '');
  assert.equal(u.programId, null);
  assert.ok(u.passwordHash && !String(u.passwordHash).includes('Secret-2026'));
  assert.equal(u.appliedAt, new Date(START).toISOString());
  // Academic's student record has the name parts and the mobile number (TORs and certificates read them).
  const p = env.db.data.studentProfiles.find((x) => x.studentId === u.id);
  assert.deepEqual([p.lastName, p.firstName, p.middleName, p.contactNo, p.studentType], ['Dela Cruz', 'Juan', 'Santos', '+639171234567', 'new']);
  const rec = await admin.get(`/api/academic/students/${u.id}`);
  assert.deepEqual(rec.names, { last: 'Dela Cruz', first: 'Juan', middle: 'Santos' });
  // A second Juan from another mail: a username of his own.
  await visitor.post('/api/auth/register', form({ email: 'juan.delacruz@other.test', mobile: '09181112222' }));
  assert.equal(user((x) => x.email === 'juan.delacruz@other.test').username, 'juan.delacruz2');
  // The registrar sees them under Applicants with the new fields, and the audit trail has it.
  const list = await admin.get('/api/admin/users?role=student&status=pending');
  assert.deepEqual(list.map((x) => [x.name, x.title, x.lastName, x.mobile, x.campusNames.join()]), [['Juan S. Dela Cruz', 'Mr.', 'Dela Cruz', '+639171234567', 'Main Campus'], ['Juan S. Dela Cruz', 'Mr.', 'Dela Cruz', '+639181112222', 'Main Campus']]);
  assert.ok(list.every((x) => !('passwordHash' in x)));
  assert.ok(env.api.audit.entries().some((e) => /Registered for a student account/.test(e.action)));
  assert.equal((await admin.get('/api/admin/enrollments/summary')).applicants, 2);
});

test('registration: one account per email, without regard to capitals, across every kind of account', async () => {
  const { env, admin, form } = await school();
  const visitor = env.client();
  await admin.post('/api/admin/users', { role: 'teacher', username: 'teach1', name: 'Tess Teacher', email: 'Tess@School.test', password: PW });
  await assert.rejects(visitor.post('/api/auth/register', form({ email: 'tess@school.TEST' })), status(409, /already exists/));
  await assert.rejects(visitor.post('/api/auth/register', form({ email: 'ADMIN@school.test' })), status(409, /already exists/));
  await visitor.post('/api/auth/register', form());
  await assert.rejects(visitor.post('/api/auth/register', form({ email: 'Juan.DelaCruz@Mail.Test' })), status(409, /already exists/));
  // Two sent at once with the same email: the check after the slow password hash keeps it to one.
  const both = await Promise.allSettled([1, 2].map(() => env.client().post('/api/auth/register', form({ email: 'twice@mail.test' }))));
  assert.deepEqual(both.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(env.db.data.users.filter((u) => u.email === 'twice@mail.test').length, 1);
  // Closed while the hash was worked out: refused.
  const late = env.client().post('/api/auth/register', form({ email: 'late@mail.test' }));
  env.db.data.settings.registration.open = false;
  await assert.rejects(late, status(403, /closed/));
});

test('registration: ten an hour from one network address, as applications were', async () => {
  const { env, form } = await school();
  const here = env.client({ ip: '203.0.113.40' });
  for (let i = 0; i < 10; i++) await here.post('/api/auth/register', form({ email: `kid${i}@mail.test` }));
  await assert.rejects(here.post('/api/auth/register', form({ email: 'kid10@mail.test' })), (e) => e.status === 429 && Boolean(e.headers['Retry-After']));
  await env.client({ ip: '203.0.113.41' }).post('/api/auth/register', form({ email: 'kid11@mail.test' })); // another address still can
});

test('admission: the registrar admits a registered student, who then signs in with the email', async () => {
  const { env, admin, form, user } = await school();
  await env.client().post('/api/auth/register', form());
  const u = user((x) => x.email === 'juan.delacruz@mail.test');
  // Waiting: the right password shows the "still being reviewed" message, by email or by username.
  for (const username of ['juan.delacruz@mail.test', 'JUAN.DELACRUZ@MAIL.TEST', 'juan.delacruz']) {
    await assert.rejects(env.client().post('/api/hub/login', { username, password: 'Secret-2026' }), status(403, /still being reviewed/), username);
  }
  // A wrong password says nothing about the account.
  await assert.rejects(env.client().post('/api/hub/login', { username: 'juan.delacruz@mail.test', password: 'wrong-one-1' }), status(401, /^Incorrect username or password\.$/));
  const program = await admin.post('/api/admin/programs', { code: 'BSIT', name: 'BS Information Technology' });
  const admitted = await admin.post(`/api/admin/users/${u.id}/approve`, { programId: program.id });
  assert.equal(admitted.status, 'active');
  assert.match(admitted.studentNo, /^\d{4}-\d{4}$/);
  assert.equal(admitted.programId, program.id);
  const student = env.client();
  const res = await student.post('/api/hub/login', { username: 'Juan.DelaCruz@mail.test', password: 'Secret-2026' });
  assert.equal(res.user.id, u.id);
  assert.equal(res.user.role, 'student');
  const [bell] = (await student.get('/api/me/notifications')).items;
  assert.match(bell.title, /^You are admitted to /);
  // Declining another works as before.
  await env.client().post('/api/auth/register', form({ email: 'other@mail.test', mobile: '09990001111' }));
  const other = user((x) => x.email === 'other@mail.test');
  assert.equal((await admin.post(`/api/admin/users/${other.id}/reject`, { note: 'Incomplete' })).status, 'rejected');
  await assert.rejects(env.client().post('/api/hub/login', { username: 'other@mail.test', password: 'Secret-2026' }), status(403, /not accepted/));
});

test('sign-in by email on the ATLAS home page: only an email that names exactly one account', async () => {
  const { env, admin } = await school();
  const mk = (username, email, role = 'teacher') => admin.post('/api/admin/users', { role, username, name: username, email, password: PW, mustChangePassword: false });
  await mk('teach1', 'Teach1@School.test');
  await mk('teach2', 'shared@school.test');
  await mk('stud9', 'shared@school.test', 'student');
  const hub = (username, password = PW) => env.client().post('/api/hub/login', { username, password });
  const generic = status(401, /^Incorrect username or password\.$/);
  // One account: by email, any capitals, with spaces around; and still by username.
  assert.equal((await hub('teach1@school.test')).user.username, 'teach1');
  assert.equal((await hub('  TEACH1@SCHOOL.TEST ')).user.username, 'teach1');
  assert.equal((await hub('teach1')).user.username, 'teach1');
  assert.equal((await hub('admin@school.test')).user.role, 'admin'); // every kind of account
  // Two accounts with that email, or none: the same answer as a wrong password, even with the right one.
  await assert.rejects(hub('shared@school.test'), generic);
  await assert.rejects(hub('nobody@school.test'), generic);
  await assert.rejects(hub('teach1@school.test', 'wrong-password'), generic);
  // Both still sign in with their usernames.
  assert.equal((await hub('teach2')).user.username, 'teach2');
  assert.equal((await hub('stud9')).user.username, 'stud9');
  // The other sign-in pages take usernames only.
  await assert.rejects(env.client().post('/api/admin/auth/login', { username: 'admin@school.test', password: PW }), generic);
});

test('sign-in by email: the lock-out counts against the account it names, and 2-step verification still asks for a code', async () => {
  const { env, admin, code } = await school();
  await admin.post('/api/admin/users', { role: 'teacher', username: 'teach1', name: 'Tess Teacher', email: 'tess@school.test', password: PW, mustChangePassword: false });
  const hub = (username, password = PW, ip = '198.51.100.7') => env.client({ ip }).post('/api/hub/login', { username, password });
  // Five wrong passwords by email lock the username too (and the other way round).
  for (let i = 0; i < 5; i++) await assert.rejects(hub('tess@school.test', 'wrong-password'), status(401));
  await assert.rejects(hub('teach1'), status(429, /Too many failed attempts/));
  await assert.rejects(hub('TESS@school.test'), status(429, /Too many failed attempts/));
  // From another network the account is not locked yet.
  const tess = env.client({ ip: '198.51.100.8' });
  await tess.post('/api/hub/login', { username: 'tess@school.test', password: PW });
  // 2-step verification: the email sign-in gets a challenge, and the code opens the session.
  const { secret } = await tess.post('/api/me/2fa/setup', { password: PW });
  await tess.post('/api/me/2fa/enable', { code: code(secret) });
  const c = env.client({ ip: '198.51.100.9' });
  const first = await c.post('/api/hub/login', { username: 'tess@school.test', password: PW });
  assert.deepEqual(Object.keys(first).sort(), ['challenge', 'twoFactorRequired']);
  const done = await c.post('/api/hub/login/verify', { challenge: first.challenge, code: code(secret) });
  assert.equal(done.user.username, 'teach1');
  // Every sign-in by email is in the audit trail under the account.
  const entries = env.api.audit.entries().filter((e) => e.kind === 'signin' && e.targetName !== '(unknown username)');
  assert.ok(entries.some((e) => /Sign-in failed: wrong password/.test(e.action)));
});

test('Terms of Use and Privacy Policy: an address or a text the school writes; no invented terms', async () => {
  const { env, admin } = await school();
  const visitor = env.client();
  // Built in: no Terms of Use link, and the privacy notice that lists what the form collects.
  let f = await visitor.get('/api/auth/register');
  assert.equal(f.terms, null);
  assert.equal(f.privacy.url, '');
  assert.equal(f.privacy.builtIn, true);
  assert.equal(f.privacy.text, defaultPrivacyText('Lancaster Academy'));
  // The school's own text, then an address (an address wins over a text).
  await admin.put('/api/admin/settings', { registration: { termsText: '  Our terms.\r\n\r\nSecond part.  ', privacyText: 'Our privacy policy.' } });
  f = await visitor.get('/api/auth/register');
  assert.deepEqual(f.terms, { url: '', text: 'Our terms.\n\nSecond part.' });
  assert.deepEqual(f.privacy, { url: '', text: 'Our privacy policy.', builtIn: false });
  await admin.put('/api/admin/settings', { registration: { termsUrl: 'https://school.test/terms', privacyUrl: 'https://school.test/privacy' } });
  f = await visitor.get('/api/auth/register');
  assert.deepEqual(f.terms, { url: 'https://school.test/terms', text: '' });
  assert.equal(f.privacy.url, 'https://school.test/privacy');
  // Saving only "open" keeps them.
  await admin.put('/api/admin/settings', { registration: { open: true } });
  assert.equal(env.db.data.settings.registration.termsUrl, 'https://school.test/terms');
  // Only web addresses; sizes are limited.
  for (const bad of ['javascript:alert(1)', 'school.test/terms', 'https://a b']) await assert.rejects(admin.put('/api/admin/settings', { registration: { termsUrl: bad } }), status(400, /starting with https/), bad);
  await assert.rejects(admin.put('/api/admin/settings', { registration: { privacyText: 'x'.repeat(20001) } }), status(400, /at most 20000/));
  await assert.rejects(admin.put('/api/admin/settings', { registration: 'open' }), status(400));
  // A registrar may read but not change settings.
  await admin.post('/api/admin/users', { role: 'registrar', username: 'reg1', name: 'Rhea Registrar', password: PW, mustChangePassword: false });
  const reg = env.client();
  await reg.post('/api/admin/auth/login', { username: 'reg1', password: PW });
  await assert.rejects(reg.put('/api/admin/settings', { registration: { termsText: 'x' } }), status(403));
  // The Settings center lists them, with their defaults, and restores them.
  let c = await admin.get('/api/admin/config');
  const find = (path) => c.settings.find((s) => s.area === 'enrollment' && s.path === path);
  for (const p of ['registration.open', 'registration.termsUrl', 'registration.termsText', 'registration.privacyUrl', 'registration.privacyText']) assert.ok(find(p), p);
  assert.equal(find('registration.termsUrl').changed, true);
  assert.equal(find('registration.termsText').default, '');
  await admin.post('/api/admin/config/reset', { area: 'enrollment', path: 'registration.termsUrl' });
  c = await admin.get('/api/admin/config');
  assert.equal(find('registration.termsUrl').value, '');
  assert.deepEqual((await visitor.get('/api/auth/register')).terms, { url: '', text: 'Our terms.\n\nSecond part.' });
});
