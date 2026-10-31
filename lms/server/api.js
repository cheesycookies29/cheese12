// JSON API. Two sides with separate sign-ins and separate session cookies:
//   /api/admin/...  the admin panel (Administrators, Registrars)
//   /api/...        the learning portal (Teachers, Students)
// A route's access is one of:
//   'public'                      anyone
//   'portal' | 'teacher' | 'student'  signed in to the portal (optionally that type only)
//   'admin' | 'admin:<permission>'    signed in to the admin panel (optionally with that permission)
// Portal routes may also name a module; the call is refused when an administrator
// has switched that module off for the caller's account type.
import { randomUUID } from 'node:crypto';
import { HttpError, localDate, localDateTime, text } from './util.js';
import {
  hashPassword, verifyPassword, validatePassword, publicUser, parseCookies, createSessions, createThrottle,
  sessionCookie, clearedCookie, PORTAL_COOKIE, ADMIN_COOKIE,
} from './auth.js';
import { ROLES, can } from '../shared/roles.js';
import { MODULES, moduleOn, enabledModules } from '../shared/modules.js';
import { registerEnrollmentRoutes } from './enrollment.js';
import { registerAdminRoutes, validateUserFields } from './admin.js';
import { registerClassroomRoutes } from './classroom.js';
import { addDemo, removeDemo, demoStatus } from './demo.js';
import { emptyData } from './db.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};

// options.clock: () => Date, so tests can pin "today".
export function createApi(db, { clock = () => new Date() } = {}) {
  const routes = [];
  const sides = { portal: createSessions(), admin: createSessions() };
  const throttle = createThrottle();
  const users = () => db.data.users;

  const route = (method, pattern, access, handler, { module = null, duringPasswordChange = false } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, access, handler, module, duringPasswordChange });
  };

  const ctx = {
    db,
    today: () => localDate(clock()),
    nowLocal: () => localDateTime(clock()),
    signOutEverywhere(userId) {
      sides.portal.destroyForUser(userId);
      sides.admin.destroyForUser(userId);
    },
  };

  // ----- Sign-in (shared logic for both sides) -----
  function signIn(side, body) {
    const username = String(body.username || '').trim().toLowerCase();
    const key = `${side}:${username}`;
    throttle.check(key);
    const user = users().find((u) => u.username === username);
    if (!verifyPassword(String(body.password || ''), user?.passwordHash)) {
      throttle.fail(key);
      fail('Incorrect username or password.', 401);
    }
    throttle.reset(key);
    if (ROLES[user.role]?.side !== side) {
      fail(side === 'admin'
        ? 'Teachers and students sign in on the learning portal, not the admin panel.'
        : 'Administrators and registrars sign in on the admin panel at /admin.', 403);
    }
    if (user.status === 'pending') fail('Your application is still being reviewed. You can sign in once the registrar admits you.', 403);
    if (user.status === 'rejected') fail('Your application was not accepted. Contact the registrar for details.', 403);
    if (user.status !== 'active') fail('This account is disabled. Contact the registrar.', 403);
    user.lastLoginAt = new Date().toISOString();
    db.save();
    const cookie = side === 'admin' ? ADMIN_COOKIE : PORTAL_COOKIE;
    return { data: { user: publicUser(user) }, headers: { 'Set-Cookie': sessionCookie(cookie, sides[side].create(user.id)) } };
  }

  function changePassword(side, { user, token, body }) {
    if (!verifyPassword(String(body.currentPassword || ''), user.passwordHash)) fail('Your current password is incorrect.');
    validatePassword(body.newPassword);
    if (body.newPassword === body.currentPassword) fail('Choose a password different from the current one.');
    user.passwordHash = hashPassword(body.newPassword);
    user.mustChangePassword = false;
    sides.portal.destroyForUser(user.id, side === 'portal' ? token : undefined);
    sides.admin.destroyForUser(user.id, side === 'admin' ? token : undefined);
    db.save();
    return { user: publicUser(user) };
  }

  const setupRequired = () => !users().some((u) => u.role === 'admin');
  const portalInfo = (user) => ({
    schoolName: db.data.settings.schoolName,
    setupRequired: setupRequired(),
    registrationOpen: db.data.settings.registration.open,
    user: publicUser(user),
    modules: user ? enabledModules(db.data.modules, user.role) : [],
    currentTermId: db.data.settings.currentTermId,
    passingGrade: db.data.settings.passingGrade,
  });

  // ----- Learning portal: sign-in and admissions -----
  route('GET', '/api/auth/status', 'public', ({ portalUser }) => portalInfo(portalUser));
  route('POST', '/api/auth/login', 'public', ({ body }) => signIn('portal', body));
  route('POST', '/api/auth/logout', 'public', ({ portalToken }) => {
    sides.portal.destroy(portalToken);
    return { data: { ok: true }, headers: { 'Set-Cookie': clearedCookie(PORTAL_COOKIE) } };
  });
  route('POST', '/api/auth/change-password', 'portal', (a) => changePassword('portal', a), { duringPasswordChange: true });

  route('GET', '/api/auth/programs', 'public', () => {
    if (!db.data.settings.registration.open) return [];
    return db.data.programs.map((p) => ({ id: p.id, code: p.code, name: p.name }));
  });
  route('POST', '/api/auth/apply', 'public', ({ body }) => {
    if (!db.data.settings.registration.open) fail('Applications are closed. Contact the registrar.', 403);
    throttle.check('apply');
    throttle.fail('apply'); // a 5-minute pause after every 5 applications slows down scripted sign-ups
    const fields = validateUserFields({ ...body, role: 'student', studentNo: '' }, db.data);
    if (!fields.email) fail('Email is required so the registrar can contact you.');
    validatePassword(body.password);
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

  // ----- Admin panel: sign-in -----
  route('GET', '/api/admin/auth/status', 'public', ({ adminUser }) => ({
    setupRequired: setupRequired(),
    schoolName: db.data.settings.schoolName,
    user: publicUser(adminUser),
  }));
  route('POST', '/api/admin/auth/setup', 'public', ({ body }) => {
    if (!setupRequired()) fail('Setup is already complete. Please sign in.');
    const fields = validateUserFields({ ...body, role: 'admin' }, db.data);
    validatePassword(body.password);
    users().push({ id: randomUUID(), ...fields, status: 'active', mustChangePassword: false, passwordHash: hashPassword(body.password), createdAt: new Date().toISOString() });
    if (body.schoolName) db.data.settings.schoolName = text(body.schoolName, 120);
    db.save();
    return signIn('admin', body);
  });
  route('POST', '/api/admin/auth/login', 'public', ({ body }) => signIn('admin', body));
  route('POST', '/api/admin/auth/logout', 'public', ({ adminToken }) => {
    sides.admin.destroy(adminToken);
    return { data: { ok: true }, headers: { 'Set-Cookie': clearedCookie(ADMIN_COOKIE) } };
  });
  route('POST', '/api/admin/auth/change-password', 'admin', (a) => changePassword('admin', a), { duringPasswordChange: true });

  // ----- Data: backups and demo data -----
  route('GET', '/api/admin/backup', 'admin:data.manage', () => db.data);
  route('POST', '/api/admin/restore', 'admin:data.manage', ({ body }) => {
    if (!Array.isArray(body.users) || !Array.isArray(body.enrollments)) fail('That file is not an LTDC LMS backup.');
    if (!body.users.some((u) => u.role === 'admin' && u.status === 'active' && u.passwordHash)) fail('The backup has no active administrator, so nobody could sign in.');
    db.replace({ ...emptyData(), ...body });
    return { ok: true };
  });
  route('GET', '/api/admin/demo', 'admin:data.manage', () => demoStatus(db.data));
  route('POST', '/api/admin/demo', 'admin:data.manage', () => {
    addDemo(db.data, ctx.today());
    db.save();
    return demoStatus(db.data);
  });
  route('DELETE', '/api/admin/demo', 'admin:data.manage', () => {
    for (const u of users().filter((x) => x.demo)) ctx.signOutEverywhere(u.id);
    removeDemo(db.data);
    db.save();
    return demoStatus(db.data);
  });

  registerAdminRoutes(route, ctx);
  registerEnrollmentRoutes(route, ctx);
  registerClassroomRoutes(route, ctx);

  // ----- Request handling -----
  const MODULE_NAMES = Object.fromEntries(MODULES.map((m) => [m.id, m.label]));

  return async function handle(req, url, body) {
    const cookies = parseCookies(req.headers.cookie);
    const resolve = (side, token) => {
      const s = sides[side].get(token);
      const u = s && users().find((x) => x.id === s.userId && x.status === 'active');
      return u && ROLES[u.role]?.side === side ? u : null;
    };
    const portalToken = cookies[PORTAL_COOKIE];
    const adminToken = cookies[ADMIN_COOKIE];
    const portalUser = resolve('portal', portalToken);
    const adminUser = resolve('admin', adminToken);

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      let user = null;
      let token = null;
      if (r.access.startsWith('admin')) {
        user = adminUser;
        token = adminToken;
        if (!user) fail('Please sign in to the admin panel.', 401);
        const permission = r.access.split(':')[1];
        if (permission && !can(user.role, permission)) fail('Your account does not have access to this.', 403);
      } else if (r.access !== 'public') {
        user = portalUser;
        token = portalToken;
        if (!user) fail('Please sign in.', 401);
        if ((r.access === 'teacher' || r.access === 'student') && user.role !== r.access) fail(`Only ${r.access}s can do this.`, 403);
        if (r.module && !moduleOn(db.data.modules, r.module, user.role)) fail(`${MODULE_NAMES[r.module]} is switched off for ${user.role}s.`, 403);
      }
      if (user?.mustChangePassword && !r.duringPasswordChange) fail('Please change your password first.', 403);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const result = await r.handler({ params, body, query: Object.fromEntries(url.searchParams), user, token, portalUser, adminUser, portalToken, adminToken });
      return result && result.headers && 'data' in result ? result : { data: result, headers: {} };
    }
    fail('Not found.', 404);
  };
}
