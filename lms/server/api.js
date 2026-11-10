// JSON API. Three sides, each with its own session cookie (see shared/roles.js):
//   /api/admin/...  the LMS admin panel (Administrators, Registrars)
//   /api/...        the learning portal (Teachers, Students)
//   /api/hris/...   the HRIS: HR and staff accounts, and any employee's session
// A route's access is one of:
//   'public'                      anyone
//   'portal' | 'teacher' | 'student' | 'guardian'  signed in to the portal (optionally that type only;
//                                    parents & guardians reach only 'guardian' routes and those marked guardians: true)
//   'admin' | 'admin:<permission>'    signed in to the admin panel (optionally with that permission)
//   'hris' | 'hris:<permission>'      any signed-in employee (not students), optionally with that permission
//   'finance' | 'finance:<permission>'    ATLAS Finance: any signed-in employee or student (whichever session the
//                                    browser has), optionally with that permission
//   'academic' | 'academic:<permission>'  ATLAS Academic: administrators, registrars and deans (admin-panel
//                                    session), teachers and students (portal session); optionally with that permission
// Portal routes may also name a module; the call is refused when an administrator
// has switched that module off for the caller's account type.
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { HttpError, localDate, localDateTime, text } from './util.js';
import {
  hashPassword, verifyPassword, validatePassword, publicUser, parseCookies, createSessions, createThrottle,
  sealAllPasswords, needsSealing, sealHash, readableHash, passwordEncryption,
  sessionCookie, clearedCookie, PORTAL_COOKIE, ADMIN_COOKIE, HRIS_COOKIE,
} from './auth.js';
import { clientIp, createRateLimiter } from './ratelimit.js';
import { ROLES, can, setRoleOverrides } from '../shared/roles.js';
import { MODULES, moduleOn, enabledModules } from '../shared/modules.js';
import { registerEnrollmentRoutes } from './enrollment.js';
import { registerAdminRoutes, validateUserFields } from './admin.js';
import { registerClassroomRoutes } from './classroom.js';
import { addDemo, removeDemo, demoStatus } from './demo.js';
import { emptyData } from './db.js';
import { createFileStore } from './files.js';
import { registerNewsRoutes } from './news.js';
import { registerGuideRoutes } from './guides.js';
import { readFileSync } from 'node:fs';

// The version of this ATLAS (package.json), shown with the guides.
const APP_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '';
  } catch {
    return '';
  }
})();
import { themeColors } from '../shared/themes.js';
import { SYSTEMS } from '../shared/systems.js';
import { campusesFor, activeCampusId, campusName } from './campus.js';
import { registerHrisRoutes } from './hris.js';
import { registerGuardianRoutes, guardianChildren } from './guardian.js';
import { HRIS_PERMISSION_LABELS } from '../shared/roles.js';
import { registerAcademicRoutes, ACADEMIC_ROLES } from './academic.js';
import { registerSsoRoutes } from './sso.js';
import { registerFinanceRoutes } from './finance.js';
import { registerConfigRoutes } from './config.js';
import { registerCalendarRoutes } from './calendar.js';
import { addFinanceDemo, removeFinanceDemo } from './finance-demo.js';

const COOKIES = { portal: PORTAL_COOKIE, admin: ADMIN_COOKIE, hris: HRIS_COOKIE };

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};

// options.clock: () => Date, so tests can pin "today".
// options.setupCode (or the SETUP_CODE environment variable): when set, creating the first
// administrator also needs this code, so nobody else can claim a new server on the internet.
// options.ssoSecret / options.ssoFetch: the Keycloak client secret and fetch, for tests (default: OIDC_CLIENT_SECRET, fetch).
export function createApi(db, { clock = () => new Date(), setupCode = process.env.SETUP_CODE || '', ssoSecret, ssoFetch, rateLimits = process.env.RATE_LIMITS || '', sealAtStart = true } = {}) {
  const sameCode = (given) => {
    const a = createHash('sha256').update(String(given ?? '')).digest();
    const b = createHash('sha256').update(setupCode).digest();
    return timingSafeEqual(a, b);
  };
  const routes = [];
  // Settings → Sign-in & passwords: idle sign-out and lockout apply at once.
  const security = () => db.data.settings.security || {};
  const idleMs = () => Math.min(72, Math.max(1, Number(security().idleHours) || 8)) * 3600 * 1000;
  const sides = { portal: createSessions(idleMs), admin: createSessions(idleMs), hris: createSessions(idleMs) };
  const throttle = createThrottle(() => ({ max: Number(security().lockoutAttempts) || 5, lockMs: (Number(security().lockoutMinutes) || 5) * 60 * 1000 }));
  // Rate limits (server/ratelimit.js). Signed in: per person; not signed in: per network address
  // (four times as many, as a whole school may share one address). RATE_LIMITS=off switches them off.
  const limits = createRateLimiter(() => {
    if (rateLimits === 'off') return {};
    const perMinute = Number(security().requestsPerMinute) || 300;
    const MIN = 60 * 1000;
    return {
      user: { limit: perMinute, windowMs: MIN },
      address: { limit: perMinute * 4, windowMs: MIN },
      signin: { limit: 60, windowMs: MIN }, // sign-in attempts per address (each is a slow password check)
      signinFail: { limit: Number(security().signInFailuresPerAddress) || 30, windowMs: 15 * MIN }, // wrong passwords per address
      password: { limit: 10, windowMs: 15 * MIN }, // password changes per person (each checks the current password)
      apply: { limit: 10, windowMs: 60 * MIN }, // applications per address
      setup: { limit: 20, windowMs: 15 * MIN }, // first-administrator attempts per address
      lookup: { limit: 60, windowMs: MIN }, // document checks, calendar feeds and Keycloak sign-ins per address
    };
  });
  const users = () => db.data.users;
  // Password hashes are encrypted under the current key (server/auth.js): plain ones, and ones under
  // an old key, are encrypted now; ones under a key this server lacks cannot be used until it has it.
  function sealPasswords() {
    const { sealed, unreadable } = sealAllPasswords(users());
    if (sealed) db.save();
    if (unreadable) console.warn(`  ${unreadable} account(s) have passwords encrypted with another key, so they cannot sign in. Set PASSWORD_KEY (or PASSWORD_KEY_OLD) to that key, or reset those passwords.`);
    return { sealed, unreadable };
  }
  // server.js waits until the new version has run for a while (sealAtStart: false), so an update
  // that is rolled back never leaves hashes the previous version cannot read.
  if (sealAtStart) sealPasswords();

  // limit: a rate-limit rule this route also counts against (see `limits`).
  const route = (method, pattern, access, handler, { module = null, duringPasswordChange = false, guardians = false, limit = null } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, access, handler, module, duringPasswordChange, guardians, limit });
  };

  const ctx = {
    db,
    files: createFileStore(db),
    now: () => clock(),
    today: () => localDate(clock()),
    nowLocal: () => localDateTime(clock()),
    signOutEverywhere(userId) {
      for (const side of Object.values(sides)) side.destroyForUser(userId);
    },
  };

  // ----- Sign-in (shared logic for both sides) -----
  // Wrong passwords lock a username for this address (so a stranger cannot lock someone out of
  // every computer), for every address after ten times as many, and pause an address that keeps
  // guessing across many usernames.
  function signIn(side, body, ip = '') {
    const username = String(body.username || '').trim().toLowerCase().slice(0, 120);
    const password = String(body.password || '');
    const key = `${side}:${username}`;
    const here = `${key}@${ip}`;
    limits.check('signinFail', ip, 'Too many wrong passwords from your network.');
    throttle.check(here);
    throttle.check(key);
    const user = users().find((u) => u.username === username);
    if (password.length > 200 || !verifyPassword(password, user?.passwordHash)) {
      limits.add('signinFail', ip);
      throttle.fail(here);
      throttle.fail(key, 10);
      fail('Incorrect username or password.', 401);
    }
    throttle.reset(here);
    throttle.reset(key);
    if (needsSealing(user.passwordHash)) user.passwordHash = sealHash(user.passwordHash); // saved below
    if (ROLES[user.role]?.side !== side) {
      fail(ROLES[user.role]?.side === 'hris'
        ? 'HR and staff accounts sign in on the ATLAS home page and open People.'
        : side === 'admin'
          ? 'Teachers and students sign in on the ATLAS home page, not the admin panel.'
          : 'Administrators and registrars sign in on the admin panel at /admin.', 403);
    }
    if (user.status === 'pending') fail('Your application is still being reviewed. You can sign in once the registrar admits you.', 403);
    if (user.status === 'rejected') fail('Your application was not accepted. Contact the registrar for details.', 403);
    if (user.status !== 'active') fail('This account is disabled. Contact the registrar.', 403);
    // With single sign-on switched on and passwords off, only administrators keep a password (a way in if Keycloak is down).
    const sso = db.data.settings.sso;
    if (sso?.enabled && !sso.allowPasswords && user.role !== 'admin') fail(`This school signs in with Keycloak. Choose "${sso.label}".`, 403);
    user.lastLoginAt = new Date().toISOString();
    db.save();
    return { data: { user: publicUser(user) }, headers: { 'Set-Cookie': sessionCookie(COOKIES[side], sides[side].create(user.id), idleMs()) } };
  }

  // A session for `user` on their side, ending any other side's session in this browser (single sign-on).
  function startSession(user, tokens, extra = {}) {
    const side = ROLES[user.role]?.side;
    if (!side) fail('This account type cannot sign in.', 403);
    for (const [name, sessions] of Object.entries(sides)) if (name !== side) sessions.destroy(tokens[name]);
    user.lastLoginAt = new Date().toISOString();
    return [sessionCookie(COOKIES[side], sides[side].create(user.id, extra), idleMs()), ...Object.keys(sides).filter((n) => n !== side).map((n) => clearedCookie(COOKIES[n]))];
  }

  function changePassword(side, { user, token, body }) {
    if (!verifyPassword(String(body.currentPassword || ''), user.passwordHash)) fail('Your current password is incorrect.');
    validatePassword(body.newPassword, db.data.settings.security);
    if (body.newPassword === body.currentPassword) fail('Choose a password different from the current one.');
    user.passwordHash = hashPassword(body.newPassword);
    user.mustChangePassword = false;
    for (const [name, sessions] of Object.entries(sides)) sessions.destroyForUser(user.id, name === side ? token : undefined);
    db.save();
    return { user: publicUser(user) };
  }

  const setupRequired = () => !users().some((u) => u.role === 'admin');
  // School name, colours and logo, for every page including the sign-in screens.
  const branding = () => {
    const b = db.data.settings.branding;
    const term = db.data.terms.find((t) => t.id === db.data.settings.currentTermId);
    return { schoolName: db.data.settings.schoolName, ...themeColors(b), theme: b.theme, logo: b.logo, tagline: b.tagline, termName: term?.name || '' };
  };
  // The campuses an account can switch between, and the one it is looking at.
  const campusInfo = (user) => {
    const list = campusesFor(db.data, user).map((c) => ({ id: c.id, name: c.name, code: c.code }));
    const active = user ? activeCampusId(db.data, user) : null;
    return { campuses: list, activeCampusId: active, campusName: campusName(db.data, active) };
  };
  function switchCampus(user, body) {
    const id = String(body.campusId || '');
    if (!campusesFor(db.data, user).some((c) => c.id === id)) fail('You do not have access to that campus.', 403);
    user.activeCampusId = id;
    db.save();
    return campusInfo(user);
  }
  const portalInfo = (user) => ({
    ...campusInfo(user),
    schoolName: db.data.settings.schoolName,
    branding: branding(),
    setupRequired: setupRequired(),
    registrationOpen: db.data.settings.registration.open,
    user: publicUser(user),
    modules: user ? enabledModules(db.data.modules, user.role) : [],
    children: user?.role === 'guardian' ? guardianChildren(db.data, user.id).map(({ link, student }) => ({ id: student.id, name: student.name, relationship: link.relationship })) : undefined,
    currentTermId: db.data.settings.currentTermId,
    passingGrade: db.data.settings.passingGrade,
    maxUploadMb: Math.min(15, Number(db.data.settings.learn?.maxUploadMb) || 10),
  });

  // ----- Learning portal: sign-in and admissions -----
  route('GET', '/api/auth/status', 'public', ({ portalUser }) => portalInfo(portalUser));
  route('POST', '/api/auth/login', 'public', ({ body, ip }) => signIn('portal', body, ip), { limit: 'signin' });
  route('POST', '/api/auth/logout', 'public', ({ portalToken }) => {
    sides.portal.destroy(portalToken);
    return { data: { ok: true }, headers: { 'Set-Cookie': clearedCookie(PORTAL_COOKIE) } };
  });
  route('POST', '/api/auth/change-password', 'portal', (a) => changePassword('portal', a), { duringPasswordChange: true, limit: 'password', guardians: true });
  route('POST', '/api/auth/campus', 'portal', ({ user, body }) => switchCampus(user, body), { guardians: true });
  route('POST', '/api/admin/auth/campus', 'admin', ({ user, body }) => switchCampus(user, body));
  route('GET', '/api/auth/campuses', 'public', () => (db.data.settings.registration.open ? db.data.campuses.map((c) => ({ id: c.id, name: c.name })) : []));

  route('GET', '/api/auth/programs', 'public', () => {
    if (!db.data.settings.registration.open) return [];
    return db.data.programs.map((p) => ({ id: p.id, code: p.code, name: p.name }));
  });
  route('POST', '/api/auth/apply', 'public', ({ body }) => {
    if (!db.data.settings.registration.open) fail('Applications are closed. Contact the registrar.', 403);
    const fields = validateUserFields({ ...body, role: 'student', studentNo: '' }, db.data);
    if (!fields.email) fail('Email is required so the registrar can contact you.');
    const campus = db.data.campuses.find((c) => c.id === body.campusId) || (db.data.campuses.length === 1 ? db.data.campuses[0] : null);
    if (!campus) fail('Pick the campus you are applying to.');
    fields.campusIds = [campus.id];
    validatePassword(body.password, db.data.settings.security);
    const user = {
      id: randomUUID(),
      ...fields,
      status: 'pending',
      mustChangePassword: false,
      passwordHash: hashPassword(body.password),
      appliedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      applicationNote: text(body.note, 1000),
    };
    users().push(user);
    db.save();
    return { ok: true };
  });

  // ----- University Portal (/): one sign-in for every system -----
  // The account type decides which session is opened: students and teachers get the
  // portal (LMS) session, administrators and registrars the admin-panel session.
  const portalSystems = (user, side) => SYSTEMS
    .map((s) => {
      const cfg = s.builtIn ? { status: 'live', url: '' } : db.data.settings.systems[s.id] || { status: 'soon', url: '' };
      return { ...s, status: cfg.status, url: s.builtIn ? (s.id === 'lms' && side === 'admin' ? '/admin' : s.path) : cfg.url, external: !s.builtIn };
    })
    .filter((s) => s.status !== 'hidden' && (!user || s.audience.includes(user.role)))
    .map(({ audience, ...s }) => (user ? s : { ...s, url: '' }));
  const AUTH_BASE = { portal: '/api/auth', admin: '/api/admin/auth', hris: '/api/hris/auth' };
  route('GET', '/api/hub/status', 'public', ({ portalUser, adminUser, hrisUser }) => {
    const user = portalUser || adminUser || hrisUser;
    const side = user ? ROLES[user.role].side : null;
    return {
      branding: branding(),
      setupRequired: setupRequired(),
      registrationOpen: db.data.settings.registration.open,
      user: publicUser(user),
      side,
      authBase: AUTH_BASE[side] || '/api/auth',
      sso: sso.publicInfo(),
      systems: portalSystems(user, side),
      ...campusInfo(user),
    };
  });
  // One person per browser: signing in here ends any other session this browser had.
  route('POST', '/api/hub/login', 'public', ({ body, tokens, ip }) => {
    const found = users().find((u) => u.username === String(body.username || '').trim().toLowerCase());
    const side = ROLES[found?.role]?.side || 'portal';
    const out = signIn(side, body, ip);
    for (const [name, sessions] of Object.entries(sides)) if (name !== side) sessions.destroy(tokens[name]);
    out.headers['Set-Cookie'] = [out.headers['Set-Cookie'], ...Object.keys(sides).filter((n) => n !== side).map((n) => clearedCookie(COOKIES[n]))];
    return out;
  }, { limit: 'signin' });
  route('POST', '/api/hub/logout', 'public', ({ tokens, origin }) => {
    // A single sign-on session also ends at Keycloak: the browser goes there next.
    const ssoSession = Object.entries(sides).map(([name, sessions]) => sessions.get(tokens[name])).find((s) => s?.sso);
    const ssoLogout = sso.logoutUrl(ssoSession, origin);
    for (const [name, sessions] of Object.entries(sides)) sessions.destroy(tokens[name]);
    return { data: { ok: true, ssoLogout }, headers: { 'Set-Cookie': Object.values(COOKIES).map(clearedCookie) } };
  });
  // School news and upcoming events for the portal home (when News & events is on for the account type).
  route('GET', '/api/hub/feed', 'public', ({ portalUser, adminUser, hrisUser }) => {
    const user = portalUser || adminUser || hrisUser;
    if (!user) fail('Please sign in.', 401);
    if (portalUser && !moduleOn(db.data.modules, 'news', user.role)) return { news: [], events: [] };
    const campusId = activeCampusId(db.data, user);
    const here = (x) => x.campusId == null || x.campusId === campusId;
    const news = db.data.news.filter(here).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.createdAt.localeCompare(a.createdAt)).slice(0, 4)
      .map(({ reactions, comments, ...n }) => ({ ...n, body: n.body.slice(0, 280), comments: comments?.length || 0 }));
    return { news, events: ctx.upcomingEvents(campusId, portalUser ? user.role : null).slice(0, 5) };
  });

  // ----- Admin panel: sign-in -----
  route('GET', '/api/admin/auth/status', 'public', ({ adminUser }) => ({
    sso: sso.publicInfo(),
    setupRequired: setupRequired(),
    setupCodeRequired: setupRequired() && Boolean(setupCode),
    schoolName: db.data.settings.schoolName,
    branding: branding(),
    user: publicUser(adminUser),
    ...campusInfo(adminUser),
    roleOverrides: adminUser ? db.data.roleOverrides || {} : undefined, // the Admin panel's can() (shared/roles.js)
  }));
  route('POST', '/api/admin/auth/setup', 'public', ({ body, ip }) => {
    if (!setupRequired()) fail('Setup is already complete. Please sign in.');
    if (setupCode) {
      throttle.check(`setup@${ip}`);
      if (!sameCode(body.setupCode)) {
        throttle.fail(`setup@${ip}`);
        fail('That setup code is not correct. It is the one chosen when the server was created.', 403);
      }
    }
    const fields = validateUserFields({ ...body, role: 'admin' }, db.data);
    validatePassword(body.password, db.data.settings.security);
    users().push({ id: randomUUID(), ...fields, status: 'active', mustChangePassword: false, passwordHash: hashPassword(body.password), createdAt: new Date().toISOString() });
    if (body.schoolName) db.data.settings.schoolName = text(body.schoolName, 120);
    if (text(body.campusName, 80)) {
      db.data.campuses[0].name = text(body.campusName, 80);
      db.data.campuses[0].code = db.data.campuses[0].name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'MAIN';
    }
    db.save();
    return signIn('admin', body, ip);
  }, { limit: 'setup' });
  route('POST', '/api/admin/auth/login', 'public', ({ body, ip }) => signIn('admin', body, ip), { limit: 'signin' });
  route('POST', '/api/admin/auth/logout', 'public', ({ adminToken }) => {
    sides.admin.destroy(adminToken);
    return { data: { ok: true }, headers: { 'Set-Cookie': clearedCookie(ADMIN_COOKIE) } };
  });
  route('POST', '/api/admin/auth/change-password', 'admin', (a) => changePassword('admin', a), { duringPasswordChange: true, limit: 'password' });

  // ----- Data: backups and demo data -----
  route('GET', '/api/admin/backup', 'admin:data.manage', () => db.data);
  route('POST', '/api/admin/restore', 'admin:data.manage', ({ body }) => {
    if (!Array.isArray(body.users) || !Array.isArray(body.enrollments)) fail('That file is not an ATLAS backup.');
    const admins = body.users.filter((u) => u.role === 'admin' && u.status === 'active' && u.passwordHash);
    if (!admins.length) fail('The backup has no active administrator, so nobody could sign in.');
    if (!admins.some((u) => readableHash(u.passwordHash))) fail('This backup\'s passwords are encrypted with another server\'s key, so nobody could sign in. Start ATLAS with that key as PASSWORD_KEY_OLD, then restore again.');
    db.replace({ ...emptyData(), ...body });
    setRoleOverrides(db.data.roleOverrides);
    const { unreadable } = sealPasswords();
    return { ok: true, unreadablePasswords: unreadable };
  });
  route('GET', '/api/admin/demo', 'admin:data.manage', () => demoStatus(db.data));
  route('POST', '/api/admin/demo', 'admin:data.manage', () => {
    addDemo(db.data, ctx.today(), ctx.files);
    addFinanceDemo(db.data, ctx);
    db.save();
    return demoStatus(db.data);
  });
  route('DELETE', '/api/admin/demo', 'admin:data.manage', () => {
    for (const u of users().filter((x) => x.demo)) ctx.signOutEverywhere(u.id);
    removeFinanceDemo(db.data);
    removeDemo(db.data, ctx.files);
    db.save();
    return demoStatus(db.data);
  });

  // ----- HRIS (/hris/): sign-in status for any employee -----
  // Teachers and registrars use their own session (portal or admin); HR and staff
  // accounts have the HRIS session. Students have no HRIS.
  const hrisStatus = (user) => {
    const allowed = Boolean(user) && user.role !== 'student' && user.role !== 'guardian';
    return {
      ...campusInfo(allowed ? user : null),
      branding: branding(),
      setupRequired: setupRequired(),
      user: allowed ? publicUser(user) : null,
      deniedUser: user && !allowed ? { name: user.name, role: user.role } : null, // a student: ATLAS People says it is for employees
      allowed,
      side: allowed ? ROLES[user.role].side : null,
      authBase: '/api/hris/auth',
      permissions: allowed ? HRIS_PERMISSION_LABELS.map(([p]) => p).filter((p) => can(user.role, p)) : [],
      employee: allowed ? hris.employeeSummary(user) : null,
    };
  };
  route('GET', '/api/hris/auth/status', 'public', ({ hrisUser, adminUser, portalUser }) => hrisStatus(hrisUser || adminUser || portalUser));
  route('POST', '/api/hris/auth/change-password', 'hris', (a) => changePassword(ROLES[a.user.role].side, a), { duringPasswordChange: true, limit: 'password' });
  route('POST', '/api/hris/auth/campus', 'hris', ({ user, body }) => switchCampus(user, body));
  const hris = registerHrisRoutes(route, ctx);

  // ----- Academic (/academic/): staff with their admin-panel session, teachers and students with the portal's -----
  const academicUser = (adminUser, portalUser) => adminUser || portalUser || null;
  route('GET', '/api/academic/auth/status', 'public', ({ adminUser, portalUser, hrisUser }) => {
    const user = academicUser(adminUser, portalUser) || hrisUser;
    const allowed = Boolean(user) && ACADEMIC_ROLES.includes(user.role);
    return {
      ...campusInfo(allowed ? user : null),
      branding: branding(),
      setupRequired: setupRequired(),
      user: allowed ? publicUser(user) : null,
      deniedUser: user && !allowed ? { name: user.name, role: user.role } : null,
      side: allowed ? ROLES[user.role].side : null,
      authBase: '/api/academic/auth',
      permissions: allowed ? academic.permissionsFor(user.role) : [],
      currentTermId: db.data.settings.currentTermId,
    };
  });
  route('POST', '/api/academic/auth/change-password', 'academic', (a) => changePassword(ROLES[a.user.role].side, a), { duringPasswordChange: true, limit: 'password' });
  route('POST', '/api/academic/auth/campus', 'academic', ({ user, body }) => switchCampus(user, body));
  const academic = registerAcademicRoutes(route, ctx);

  // ----- Finance (/finance/): any employee (finance staff by their finance.* permissions) and students (their receipts) -----
  route('GET', '/api/finance/auth/status', 'public', ({ adminUser, portalUser, hrisUser }) => {
    const user = hrisUser || adminUser || portalUser;
    const allowed = Boolean(user) && user.role !== 'guardian';
    return {
      ...campusInfo(allowed ? user : null),
      branding: branding(),
      setupRequired: setupRequired(),
      user: allowed ? publicUser(user) : null,
      deniedUser: user && !allowed ? { name: user.name, role: user.role } : null,
      side: allowed ? ROLES[user.role].side : null,
      authBase: '/api/finance/auth',
      permissions: allowed ? finance.permissionsFor(user.role) : [],
    };
  });
  route('POST', '/api/finance/auth/change-password', 'finance', (a) => changePassword(ROLES[a.user.role].side, a), { duringPasswordChange: true, limit: 'password' });
  route('POST', '/api/finance/auth/campus', 'finance', ({ user, body }) => switchCampus(user, body));
  const finance = registerFinanceRoutes(route, ctx);
  registerConfigRoutes(route, ctx);
  const sso = registerSsoRoutes(route, ctx, { startSession, ...(ssoSecret !== undefined ? { secret: ssoSecret } : {}), ...(ssoFetch ? { fetchImpl: ssoFetch } : {}) });

  ctx.upcomingEvents = registerNewsRoutes(route, ctx).upcoming;
  registerGuideRoutes(route, { db, version: APP_VERSION });
  registerAdminRoutes(route, ctx);
  registerEnrollmentRoutes(route, ctx);
  const classroom = registerClassroomRoutes(route, ctx);
  registerGuardianRoutes(route, ctx, classroom);
  registerCalendarRoutes(route, ctx, classroom);

  // Call a route as a user, inside the server (demo data is made through the same rules as real work).
  ctx.invoke = (user, method, path, body = {}) => {
    const url = new URL(`http://localhost${path}`);
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const permission = r.access.includes(':') ? r.access.split(':')[1] : null;
      if (permission && !can(user.role, permission)) throw new HttpError(403, `${user.name} cannot ${method} ${path}`);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return r.handler({ params, body, query: Object.fromEntries(url.searchParams), user, campusId: activeCampusId(db.data, user), tokens: {}, cookies: {}, origin: '' });
    }
    throw new HttpError(404, `No route for ${method} ${path}`);
  };

  // ----- Request handling -----
  const MODULE_NAMES = Object.fromEntries(MODULES.map((m) => [m.id, m.label]));

  handle.sealPasswords = sealPasswords;
  return handle;
  async function handle(req, url, body) {
    const cookies = parseCookies(req.headers.cookie);
    const resolve = (side, token) => {
      const s = sides[side].get(token);
      const u = s && users().find((x) => x.id === s.userId && x.status === 'active');
      return u && ROLES[u.role]?.side === side ? u : null;
    };
    const portalToken = cookies[PORTAL_COOKIE];
    const adminToken = cookies[ADMIN_COOKIE];
    const hrisToken = cookies[HRIS_COOKIE];
    const portalUser = resolve('portal', portalToken);
    const adminUser = resolve('admin', adminToken);
    const hrisUser = resolve('hris', hrisToken);
    const tokens = { portal: portalToken, admin: adminToken, hris: hrisToken };
    const ip = clientIp(req);
    const signedIn = portalUser || adminUser || hrisUser;
    if (signedIn) limits.hit('user', signedIn.id);
    else limits.hit('address', ip);
    // This app's own address as the browser sees it (behind Caddy: X-Forwarded-*), for the Keycloak redirects.
    const origin = process.env.PUBLIC_URL?.replace(/\/$/, '') || `${String(req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http')).split(',')[0]}://${req.headers['x-forwarded-host'] || req.headers.host || 'localhost'}`;

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      let user = null;
      let token = null;
      if (r.access === 'hris' || r.access.startsWith('hris:')) {
        // Whoever is signed in on this browser: an HR/staff account, else an admin-panel or portal account.
        [user, token] = hrisUser ? [hrisUser, hrisToken] : adminUser ? [adminUser, adminToken] : [portalUser, portalToken];
        if (!user) fail('Please sign in.', 401);
        if (user.role === 'student' || user.role === 'guardian') fail('People is for school employees.', 403);
        const permission = r.access.split(':')[1];
        if (permission && !can(user.role, permission)) fail('Your account does not have access to this.', 403);
      } else if (r.access === 'academic' || r.access.startsWith('academic:')) {
        user = adminUser || portalUser;
        token = adminUser ? adminToken : portalToken;
        if (!user) fail('Please sign in.', 401);
        if (!ACADEMIC_ROLES.includes(user.role)) fail('Academic is for students, teachers and the registrar\'s office.', 403);
        const permission = r.access.split(':')[1];
        if (permission && !can(user.role, permission)) fail('Your account does not have access to this.', 403);
      } else if (r.access === 'finance' || r.access.startsWith('finance:')) {
        [user, token] = hrisUser ? [hrisUser, hrisToken] : adminUser ? [adminUser, adminToken] : [portalUser, portalToken];
        if (!user) fail('Please sign in.', 401);
        if (user.role === 'guardian') fail('Finance is for the school\'s employees and students.', 403);
        const permission = r.access.split(':')[1];
        if (permission && !can(user.role, permission)) fail('Your account does not have access to this.', 403);
      } else if (r.access.startsWith('admin')) {
        user = adminUser;
        token = adminToken;
        if (!user) fail('Please sign in to the admin panel.', 401);
        const permission = r.access.split(':')[1];
        if (permission && !can(user.role, permission)) fail('Your account does not have access to this.', 403);
      } else if (r.access !== 'public') {
        user = portalUser;
        token = portalToken;
        if (!user) fail('Please sign in.', 401);
        if (['teacher', 'student', 'guardian'].includes(r.access) && user.role !== r.access) fail(r.access === 'guardian' ? 'Only parents and guardians can do this.' : `Only ${r.access}s can do this.`, 403);
        // Parents & guardians see the school through their linked students only.
        if (user.role === 'guardian' && r.access === 'portal' && !r.guardians) fail('This part of Learn is for students and teachers.', 403);
        if (r.module && !moduleOn(db.data.modules, r.module, user.role)) fail(`${MODULE_NAMES[r.module]} is switched off for ${user.role}s.`, 403);
      }
      if (user?.mustChangePassword && !r.duringPasswordChange) fail('Please change your password first.', 403);
      if (r.limit) limits.hit(r.limit, r.limit === 'password' ? user.id : ip);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const campusId = user ? activeCampusId(db.data, user) : null;
      // A Finance change is all or nothing: if any check fails partway, the books are put back as they were.
      const finSnap = req.method !== 'GET' && url.pathname.startsWith('/api/finance/') ? Object.fromEntries(Object.keys(db.data).filter((k) => k.startsWith('fin')).map((k) => [k, structuredClone(db.data[k])])) : null;
      // A settings screen's save is recorded in the Settings center's history (server/config.js).
      const recordSettings = ctx.settingsWatch?.(req.method, url.pathname);
      let result;
      try {
        result = await r.handler({ params, body, query: Object.fromEntries(url.searchParams), user, token, portalUser, adminUser, hrisUser, portalToken, adminToken, tokens, campusId, origin, cookies, ip });
      } catch (err) {
        if (finSnap) Object.assign(db.data, finSnap);
        throw err;
      }
      recordSettings?.(user);
      if (result?.raw != null) return result; // a file, a page or a redirect
      return result && result.headers && 'data' in result ? result : { data: result, headers: {} };
    }
    fail('Not found.', 404);
  };
}
