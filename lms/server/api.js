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
//   'academic' | 'academic:<permission>'  ATLAS Academic: administrators, registrars and deans (admin-panel
//                                    session), teachers and students (portal session); optionally with that permission
// Portal routes may also name a module; the call is refused when an administrator
// has switched that module off for the caller's account type.
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { HttpError, localDate, localDateTime, text } from './util.js';
import {
  hashPassword, verifyPassword, validatePassword, publicUser, parseCookies, createSessions, createThrottle,
  sessionCookie, clearedCookie, PORTAL_COOKIE, ADMIN_COOKIE, HRIS_COOKIE,
} from './auth.js';
import { ROLES, can } from '../shared/roles.js';
import { MODULES, moduleOn, enabledModules } from '../shared/modules.js';
import { registerEnrollmentRoutes } from './enrollment.js';
import { registerAdminRoutes, validateUserFields } from './admin.js';
import { registerClassroomRoutes } from './classroom.js';
import { addDemo, removeDemo, demoStatus } from './demo.js';
import { emptyData } from './db.js';
import { createFileStore } from './files.js';
import { registerNewsRoutes } from './news.js';
import { themeColors } from '../shared/themes.js';
import { SYSTEMS } from '../shared/systems.js';
import { campusesFor, activeCampusId, campusName } from './campus.js';
import { registerHrisRoutes } from './hris.js';
import { registerGuardianRoutes, guardianChildren } from './guardian.js';
import { HRIS_PERMISSION_LABELS } from '../shared/roles.js';
import { registerAcademicRoutes, ACADEMIC_ROLES } from './academic.js';

const COOKIES = { portal: PORTAL_COOKIE, admin: ADMIN_COOKIE, hris: HRIS_COOKIE };

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};

// options.clock: () => Date, so tests can pin "today".
// options.setupCode (or the SETUP_CODE environment variable): when set, creating the first
// administrator also needs this code, so nobody else can claim a new server on the internet.
export function createApi(db, { clock = () => new Date(), setupCode = process.env.SETUP_CODE || '' } = {}) {
  const sameCode = (given) => {
    const a = createHash('sha256').update(String(given ?? '')).digest();
    const b = createHash('sha256').update(setupCode).digest();
    return timingSafeEqual(a, b);
  };
  const routes = [];
  const sides = { portal: createSessions(), admin: createSessions(), hris: createSessions() };
  const throttle = createThrottle();
  const users = () => db.data.users;

  const route = (method, pattern, access, handler, { module = null, duringPasswordChange = false, guardians = false } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, access, handler, module, duringPasswordChange, guardians });
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
      fail(ROLES[user.role]?.side === 'hris'
        ? 'HR and staff accounts sign in on the ATLAS home page and open People.'
        : side === 'admin'
          ? 'Teachers and students sign in on the ATLAS home page, not the admin panel.'
          : 'Administrators and registrars sign in on the admin panel at /admin.', 403);
    }
    if (user.status === 'pending') fail('Your application is still being reviewed. You can sign in once the registrar admits you.', 403);
    if (user.status === 'rejected') fail('Your application was not accepted. Contact the registrar for details.', 403);
    if (user.status !== 'active') fail('This account is disabled. Contact the registrar.', 403);
    user.lastLoginAt = new Date().toISOString();
    db.save();
    return { data: { user: publicUser(user) }, headers: { 'Set-Cookie': sessionCookie(COOKIES[side], sides[side].create(user.id)) } };
  }

  function changePassword(side, { user, token, body }) {
    if (!verifyPassword(String(body.currentPassword || ''), user.passwordHash)) fail('Your current password is incorrect.');
    validatePassword(body.newPassword);
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
  });

  // ----- Learning portal: sign-in and admissions -----
  route('GET', '/api/auth/status', 'public', ({ portalUser }) => portalInfo(portalUser));
  route('POST', '/api/auth/login', 'public', ({ body }) => signIn('portal', body));
  route('POST', '/api/auth/logout', 'public', ({ portalToken }) => {
    sides.portal.destroy(portalToken);
    return { data: { ok: true }, headers: { 'Set-Cookie': clearedCookie(PORTAL_COOKIE) } };
  });
  route('POST', '/api/auth/change-password', 'portal', (a) => changePassword('portal', a), { duringPasswordChange: true, guardians: true });
  route('POST', '/api/auth/campus', 'portal', ({ user, body }) => switchCampus(user, body), { guardians: true });
  route('POST', '/api/admin/auth/campus', 'admin', ({ user, body }) => switchCampus(user, body));
  route('GET', '/api/auth/campuses', 'public', () => (db.data.settings.registration.open ? db.data.campuses.map((c) => ({ id: c.id, name: c.name })) : []));

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
    const campus = db.data.campuses.find((c) => c.id === body.campusId) || (db.data.campuses.length === 1 ? db.data.campuses[0] : null);
    if (!campus) fail('Pick the campus you are applying to.');
    fields.campusIds = [campus.id];
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
      systems: portalSystems(user, side),
      ...campusInfo(user),
    };
  });
  // One person per browser: signing in here ends any other session this browser had.
  route('POST', '/api/hub/login', 'public', ({ body, tokens }) => {
    const found = users().find((u) => u.username === String(body.username || '').trim().toLowerCase());
    const side = ROLES[found?.role]?.side || 'portal';
    const out = signIn(side, body);
    for (const [name, sessions] of Object.entries(sides)) if (name !== side) sessions.destroy(tokens[name]);
    out.headers['Set-Cookie'] = [out.headers['Set-Cookie'], ...Object.keys(sides).filter((n) => n !== side).map((n) => clearedCookie(COOKIES[n]))];
    return out;
  });
  route('POST', '/api/hub/logout', 'public', ({ tokens }) => {
    for (const [name, sessions] of Object.entries(sides)) sessions.destroy(tokens[name]);
    return { data: { ok: true }, headers: { 'Set-Cookie': Object.values(COOKIES).map(clearedCookie) } };
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
    return { news, events: ctx.upcomingEvents(campusId).slice(0, 5) };
  });

  // ----- Admin panel: sign-in -----
  route('GET', '/api/admin/auth/status', 'public', ({ adminUser }) => ({
    setupRequired: setupRequired(),
    setupCodeRequired: setupRequired() && Boolean(setupCode),
    schoolName: db.data.settings.schoolName,
    branding: branding(),
    user: publicUser(adminUser),
    ...campusInfo(adminUser),
  }));
  route('POST', '/api/admin/auth/setup', 'public', ({ body }) => {
    if (!setupRequired()) fail('Setup is already complete. Please sign in.');
    if (setupCode) {
      throttle.check('setup');
      if (!sameCode(body.setupCode)) {
        throttle.fail('setup');
        fail('That setup code is not correct. It is the one chosen when the server was created.', 403);
      }
    }
    const fields = validateUserFields({ ...body, role: 'admin' }, db.data);
    validatePassword(body.password);
    users().push({ id: randomUUID(), ...fields, status: 'active', mustChangePassword: false, passwordHash: hashPassword(body.password), createdAt: new Date().toISOString() });
    if (body.schoolName) db.data.settings.schoolName = text(body.schoolName, 120);
    if (text(body.campusName, 80)) {
      db.data.campuses[0].name = text(body.campusName, 80);
      db.data.campuses[0].code = db.data.campuses[0].name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'MAIN';
    }
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
    if (!Array.isArray(body.users) || !Array.isArray(body.enrollments)) fail('That file is not an ATLAS backup.');
    if (!body.users.some((u) => u.role === 'admin' && u.status === 'active' && u.passwordHash)) fail('The backup has no active administrator, so nobody could sign in.');
    db.replace({ ...emptyData(), ...body });
    return { ok: true };
  });
  route('GET', '/api/admin/demo', 'admin:data.manage', () => demoStatus(db.data));
  route('POST', '/api/admin/demo', 'admin:data.manage', () => {
    addDemo(db.data, ctx.today(), ctx.files);
    db.save();
    return demoStatus(db.data);
  });
  route('DELETE', '/api/admin/demo', 'admin:data.manage', () => {
    for (const u of users().filter((x) => x.demo)) ctx.signOutEverywhere(u.id);
    removeDemo(db.data, ctx.files);
    db.save();
    return demoStatus(db.data);
  });

  // ----- HRIS (/hris/): sign-in status for any employee -----
  // Teachers and registrars use their own session (portal or admin); HR and staff
  // accounts have the HRIS session. Students have no HRIS.
  const hrisStatus = (user) => {
    const allowed = Boolean(user) && user.role !== 'student';
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
  route('POST', '/api/hris/auth/change-password', 'hris', (a) => changePassword(ROLES[a.user.role].side, a), { duringPasswordChange: true });
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
  route('POST', '/api/academic/auth/change-password', 'academic', (a) => changePassword(ROLES[a.user.role].side, a), { duringPasswordChange: true });
  route('POST', '/api/academic/auth/campus', 'academic', ({ user, body }) => switchCampus(user, body));
  const academic = registerAcademicRoutes(route, ctx);

  ctx.upcomingEvents = registerNewsRoutes(route, ctx).upcoming;
  registerAdminRoutes(route, ctx);
  registerEnrollmentRoutes(route, ctx);
  registerGuardianRoutes(route, ctx, registerClassroomRoutes(route, ctx));

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
    const hrisToken = cookies[HRIS_COOKIE];
    const portalUser = resolve('portal', portalToken);
    const adminUser = resolve('admin', adminToken);
    const hrisUser = resolve('hris', hrisToken);
    const tokens = { portal: portalToken, admin: adminToken, hris: hrisToken };

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
        if (user.role === 'student') fail('People is for school employees.', 403);
        const permission = r.access.split(':')[1];
        if (permission && !can(user.role, permission)) fail('Your account does not have access to this.', 403);
      } else if (r.access === 'academic' || r.access.startsWith('academic:')) {
        user = adminUser || portalUser;
        token = adminUser ? adminToken : portalToken;
        if (!user) fail('Please sign in.', 401);
        if (!ACADEMIC_ROLES.includes(user.role)) fail('Academic is for students, teachers and the registrar\'s office.', 403);
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
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const campusId = user ? activeCampusId(db.data, user) : null;
      const result = await r.handler({ params, body, query: Object.fromEntries(url.searchParams), user, token, portalUser, adminUser, hrisUser, portalToken, adminToken, tokens, campusId });
      if (result?.raw) return result; // a file
      return result && result.headers && 'data' in result ? result : { data: result, headers: {} };
    }
    fail('Not found.', 404);
  };
}
