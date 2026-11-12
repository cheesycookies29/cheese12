// ATLAS Control (/control/): the administrators' control panel for the whole of ATLAS.
//   - Overview: accounts, who is signed in now, sign-in trouble today, and a security checklist.
//   - Accounts: every account in every system, one list: open one to see what it can reach, its
//     sessions and its trail; make staff accounts, change an account's type, campuses or status,
//     reset its password, end its sessions, unlock it, unlink it from Keycloak.
//   - Sessions: everyone signed in now, where from; end one, or everyone else's.
//   - Locked sign-ins: usernames locked after wrong passwords; unlock them.
//   - Access map: which account types open which systems and Learn modules, with their permissions.
//   - Audit trail: server/audit.js, with the Settings history, Finance's and Academic's logs.
// Administrators only (role 'admin'), whatever Roles & permissions gives other account types.
import { randomUUID } from 'node:crypto';
import { HttpError } from './util.js';
import { ROLES, roleLabel, permissionsOf, permissionsOfUser, ADMIN_ONLY_PERMISSIONS } from '../shared/roles.js';
import { PERMISSION_GROUPS, grantable } from './config.js';
import { MODULES, MODULE_ROLES, moduleOn } from '../shared/modules.js';
import { SYSTEMS } from '../shared/systems.js';
import { publicUser, hashPassword, validatePassword, passwordEncryption } from './auth.js';
import { validateUserFields } from './admin.js';
import { campusName } from './campus.js';
import { combinedTrail, filterTrail, trailCsv, sideLabel, SYSTEM_LABELS, KIND_LABELS, SOURCE_LABELS } from './audit.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
const DAY = 24 * 3600 * 1000;
// Account types made here: everyone but students and parents (the registrar makes those, in the Admin panel).
export const STAFF_ROLES = Object.keys(ROLES).filter((r) => !['student', 'guardian'].includes(r));

export function registerControlRoutes(route, ctx, { sides, throttle, limitsOff = false }) {
  const { db } = ctx;
  const data = () => db.data;
  const save = () => db.save();
  const only = (user) => {
    if (user?.role !== 'admin') fail('ATLAS Control is for administrators.', 403);
  };
  // Every Control route: administrators only, and its own entry in the audit trail.
  const control = (method, pattern, handler) => route(method, pattern, 'admin', (a) => {
    only(a.user);
    return handler(a);
  }, { audit: false });
  const log = (a, e) => ctx.audit({ system: 'control', actor: a.user, ip: a.ip, agent: a.agent, ...e });
  const trail = () => ctx.auditLog.entries();
  const everything = () => combinedTrail(data(), trail());
  const permLabel = () => Object.fromEntries(PERMISSION_GROUPS.flatMap((g) => g.permissions));
  const describeAccess = (acc) => [...(acc.add || []).map((p) => `+ ${permLabel()[p] || p}`), ...(acc.remove || []).map((p) => `− ${permLabel()[p] || p}`)].join('; ');
  const found = (id) => data().users.find((u) => u.id === id) || fail('Account not found.', 404);
  const activeAdmins = () => data().users.filter((u) => u.role === 'admin' && u.status === 'active');

  // ----- Sessions and locks, as Control shows them -----
  const allSessions = () => Object.entries(sides).flatMap(([side, s]) => s.list().map((x) => ({ ...x, side })));
  const sessionsOf = (userId) => allSessions().filter((s) => s.userId === userId);
  // Throttle keys: "side:username" (locked everywhere) or "side:username@address" (locked on that address).
  const parseLock = ({ key, until }) => {
    const m = key.match(/^(portal|admin|hris):([^@]*)(?:@(.*))?$/);
    if (!m) return null;
    const account = data().users.find((u) => u.username === m[2]);
    return { key, side: m[1], username: m[2], ip: m[3] ?? null, until: new Date(until).toISOString(), accountId: account?.id || null, name: account?.name || '' };
  };
  const locks = () => throttle.locked().map(parseLock).filter(Boolean);
  const unlockUsername = (username) => {
    let n = 0;
    for (const side of Object.keys(sides)) {
      for (const l of throttle.locked()) if (l.key === `${side}:${username}` || l.key.startsWith(`${side}:${username}@`)) (throttle.reset(l.key), n++);
      throttle.reset(`${side}:${username}`);
    }
    return n;
  };

  // The systems an account can open from the ATLAS home page (shared/systems.js; hidden ones and
  // ones only coming soon do not count).
  const systemsFor = (role) => SYSTEMS.filter((s) => s.audience.includes(role)).map((s) => {
    const cfg = s.builtIn ? { status: 'live' } : data().settings.systems[s.id] || { status: 'soon' };
    return { id: s.id, name: s.name, product: s.product, status: cfg.status };
  }).filter((s) => s.status !== 'hidden');

  const campusesOf = (u) => (u.role === 'admin' ? ['All campuses'] : (u.campusIds || []).map((id) => campusName(data(), id)).filter(Boolean));
  const row = (u, sessions, lockedNames) => ({
    id: u.id, name: u.name, username: u.username, email: u.email || '', role: u.role, roleLabel: roleLabel(u.role), side: ROLES[u.role]?.side || '',
    status: u.status, campuses: campusesOf(u), lastLoginAt: u.lastLoginAt || null, createdAt: u.createdAt || null,
    sso: Boolean(u.ssoSubject), mustChangePassword: Boolean(u.mustChangePassword), sessions: sessions.get(u.id) || 0, locked: lockedNames.has(u.username),
    studentNo: u.studentNo || '', employeeId: u.employeeId || null, demo: Boolean(u.demo),
    ownAccess: (u.access?.add?.length || 0) + (u.access?.remove?.length || 0),
  });

  // ----- Overview -----
  control('GET', '/api/control/overview', () => {
    const d = data();
    const now = Date.now();
    const since = new Date(now - DAY).toISOString();
    const recent = [...trail(), ...(d.auditDemo || [])].filter((e) => e.at >= since);
    const sess = allSessions();
    const byRole = {};
    for (const u of d.users) byRole[u.role] = (byRole[u.role] || 0) + 1;
    const sec = d.settings.security || {};
    const admins = activeAdmins();
    const staleStaff = d.users.filter((u) => u.status === 'active' && STAFF_ROLES.includes(u.role) && u.role !== 'admin' && (!u.lastLoginAt || now - Date.parse(u.lastLoginAt) > 90 * DAY)).length;
    const checks = [
      { id: 'key', ok: passwordEncryption().on, label: 'Password hashes are encrypted', detail: passwordEncryption().on ? 'Every hash is encrypted with the server\'s password key.' : 'The server has no password key: hashes are not encrypted.' },
      { id: 'length', ok: Number(sec.minPasswordLength) >= 10, label: 'Passwords of 10 characters or more', detail: `New passwords need at least ${sec.minPasswordLength || 8} characters.`, fix: '#/sign-in' },
      { id: 'mix', ok: Boolean(sec.requireLettersAndDigits), label: 'Passwords mix letters and digits', detail: sec.requireLettersAndDigits ? 'On.' : 'Off: a password can be all letters.', fix: '#/sign-in' },
      { id: 'first', ok: Boolean(sec.forcePasswordChange), label: 'First passwords are always changed', detail: sec.forcePasswordChange ? 'New and reset passwords must be changed at the first sign-in.' : 'Staff may untick it when they make an account.', fix: '#/sign-in' },
      { id: 'admins', ok: admins.length >= 2 && admins.length <= 5, label: 'Two to five administrators', detail: `${admins.length} active administrator${admins.length === 1 ? '' : 's'}. ${admins.length < 2 ? 'With one, nobody can get back in if that person is away.' : admins.length > 5 ? 'Each administrator can do everything: keep the list short.' : ''}`.trim(), fix: '#/accounts?role=admin' },
      { id: 'sso', ok: Boolean(d.settings.sso?.enabled), label: 'Single sign-on with Keycloak', detail: d.settings.sso?.enabled ? 'On: Keycloak can add two-step sign-in.' : 'Off. Keycloak can add two-step sign-in, which ATLAS passwords do not have.', fix: '#/sso', optional: true },
      { id: 'stale', ok: staleStaff === 0, label: 'No unused staff accounts', detail: staleStaff ? `${staleStaff} active staff account${staleStaff === 1 ? ' has' : 's have'} not signed in for 90 days. Disable the ones nobody uses.` : 'Every active staff account has signed in within 90 days.', fix: '#/accounts?signin=stale' },
      { id: 'cookie', ok: process.env.COOKIE_SECURE === '1', label: 'Cookies only over HTTPS', detail: process.env.COOKIE_SECURE === '1' ? 'COOKIE_SECURE is on.' : 'COOKIE_SECURE is off (normal on a test computer; set it on the live server).', optional: process.env.NODE_ENV !== 'production' },
      { id: 'limits', ok: !limitsOff, label: 'Rate limits on', detail: limitsOff ? 'RATE_LIMITS=off: only for load tests.' : 'Requests and sign-in attempts are limited.' },
    ];
    return {
      accounts: {
        total: d.users.length, active: d.users.filter((u) => u.status === 'active').length, disabled: d.users.filter((u) => u.status === 'disabled').length,
        pending: d.users.filter((u) => u.status === 'pending').length, mustChange: d.users.filter((u) => u.status === 'active' && u.mustChangePassword).length,
        sso: d.users.filter((u) => u.ssoSubject).length,
        byRole: Object.keys(ROLES).map((r) => ({ role: r, label: roleLabel(r), count: byRole[r] || 0 })),
      },
      sessions: { total: sess.length, people: new Set(sess.map((s) => s.userId)).size, bySide: Object.keys(sides).map((side) => ({ side, label: sideLabel(side), count: sess.filter((s) => s.side === side).length })) },
      today: {
        signIns: recent.filter((e) => e.kind === 'signin' && e.outcome === 'ok').length,
        failedSignIns: recent.filter((e) => e.kind === 'signin' && e.outcome === 'failed').length,
        refused: recent.filter((e) => e.outcome === 'refused').length,
        changes: recent.filter((e) => e.kind === 'change' || e.kind === 'account' || e.kind === 'access').length,
      },
      locks: locks().length,
      checks,
      recent: everything().slice(0, 8),
      trailSize: trail().length,
    };
  });

  // ----- Accounts -----
  control('GET', '/api/control/users', ({ query }) => {
    const q = String(query.q || '').trim().toLowerCase();
    const now = Date.now();
    const sessions = new Map();
    for (const s of allSessions()) sessions.set(s.userId, (sessions.get(s.userId) || 0) + 1);
    const lockedNames = new Set(locks().map((l) => l.username));
    let list = data().users.filter((u) => (!query.role || (query.role === 'staff' ? STAFF_ROLES.includes(u.role) : u.role === query.role))
      && (!query.status || u.status === query.status)
      && (!query.campusId || u.role === 'admin' || (u.campusIds || []).includes(query.campusId))
      && (!q || `${u.name} ${u.username} ${u.email || ''} ${u.studentNo || ''}`.toLowerCase().includes(q))
      && (query.signin !== 'never' || !u.lastLoginAt)
      && (query.signin !== 'stale' || (u.status === 'active' && STAFF_ROLES.includes(u.role) && u.role !== 'admin' && (!u.lastLoginAt || now - Date.parse(u.lastLoginAt) > 90 * DAY)))
      && (query.signin !== 'online' || sessions.has(u.id))
      && (query.flag !== 'locked' || lockedNames.has(u.username))
      && (query.flag !== 'sso' || u.ssoSubject)
      && (query.flag !== 'must-change' || u.mustChangePassword)
      && (query.flag !== 'own-access' || u.access?.add?.length || u.access?.remove?.length));
    const sorts = {
      name: (a, b) => a.name.localeCompare(b.name),
      recent: (a, b) => String(b.lastLoginAt || '').localeCompare(String(a.lastLoginAt || '')),
      role: (a, b) => roleLabel(a.role).localeCompare(roleLabel(b.role)) || a.name.localeCompare(b.name),
      created: (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
    };
    list = list.sort(sorts[query.sort] || sorts.name);
    const size = 50;
    const pages = Math.max(1, Math.ceil(list.length / size));
    const page = Math.min(pages, Math.max(1, Number(query.page) || 1));
    return {
      total: list.length, page, pages,
      users: list.slice((page - 1) * size, page * size).map((u) => row(u, sessions, lockedNames)),
      roles: Object.keys(ROLES).map((r) => ({ id: r, label: roleLabel(r), staff: STAFF_ROLES.includes(r) })),
      campuses: data().campuses.map((c) => ({ id: c.id, name: c.name })),
    };
  });

  // One account's own access (after CORE's per-user grants): the permissions groups its account type
  // may be given, each permission with whether the type has it and whether this account has it now.
  const accessGroups = (u) => (u.role === 'admin' || !STAFF_ROLES.includes(u.role) ? [] : PERMISSION_GROUPS.filter((g) => g.roles.includes(u.role)).map((g) => ({
    id: g.id, label: g.label,
    permissions: g.permissions.map(([id, label]) => ({ id, label, byType: permissionsOf(u.role).includes(id), now: permissionsOfUser(u).includes(id), adminOnly: ADMIN_ONLY_PERMISSIONS.includes(id) })),
  })));
  const employeeName = (e) => e.name || [e.firstName, e.lastName].filter(Boolean).join(' ');
  // Employee records a staff account can be linked to: not linked to another account (as in CORE).
  const linkableEmployees = (u) => (data().employees || [])
    .filter((e) => !data().users.some((x) => x.employeeId === e.id && x.id !== u.id))
    .map((e) => ({ id: e.id, name: employeeName(e), no: e.employeeNo || '' }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const detail = (u) => {
    const sessions = new Map([[u.id, sessionsOf(u.id).length]]);
    const lockedNames = new Set(locks().map((l) => l.username));
    const emp = u.employeeId ? data().employees?.find((e) => e.id === u.employeeId) : null;
    return {
      ...row(u, sessions, lockedNames),
      campusIds: u.campusIds || [],
      allCampuses: data().campuses.map((c) => ({ id: c.id, name: c.name })),
      updatedAt: u.updatedAt || null,
      ssoName: u.ssoSubject ? u.ssoName || '' : '',
      ssoLinkedAt: u.ssoSubject ? u.ssoLinkedAt || null : null,
      employee: emp ? { id: emp.id, name: employeeName(emp), no: emp.employeeNo || '' } : null,
      permissions: permissionsOfUser(u),
      ownAccess: { add: u.access?.add || [], remove: u.access?.remove || [] },
      accessGroups: accessGroups(u),
      employees: STAFF_ROLES.includes(u.role) ? linkableEmployees(u) : [],
      systems: systemsFor(u.role),
      modules: MODULE_ROLES.includes(u.role) ? MODULES.filter((m) => moduleOn(data().modules, m.id, u.role)).map((m) => m.label) : null,
      sessionList: sessionsOf(u.id).sort((a, b) => b.lastSeen - a.lastSeen).map((s) => ({ ...s, sideLabel: sideLabel(s.side), createdAt: new Date(s.createdAt).toISOString(), lastSeen: new Date(s.lastSeen).toISOString() })),
      locks: locks().filter((l) => l.username === u.username),
      trail: filterTrail(everything(), { userId: u.id }).slice(0, 40),
      canChangeRole: STAFF_ROLES.includes(u.role),
      assignableRoles: STAFF_ROLES.includes(u.role) ? STAFF_ROLES.map((r) => ({ id: r, label: roleLabel(r) })) : [],
      links: {
        guardianLinks: data().guardianLinks.filter((l) => l.guardianId === u.id || l.studentId === u.id).length,
        sections: data().sections.filter((s) => s.teacherId === u.id && s.status !== 'cancelled').length,
      },
    };
  };
  control('GET', '/api/control/users/:id', ({ params }) => detail(found(params.id)));

  const campusList = (role, requested) => {
    if (role === 'admin') return [];
    const ids = [...new Set((Array.isArray(requested) ? requested : requested ? [requested] : []).filter(Boolean))];
    for (const id of ids) if (!data().campuses.some((c) => c.id === id)) fail('Campus not found.');
    if (!ids.length) fail('Pick at least one campus.');
    return ids;
  };

  // A staff account: any account type but student and parent.
  control('POST', '/api/control/users', (a) => {
    const { body } = a;
    if (!STAFF_ROLES.includes(body.role)) fail('Make students and parents in the Admin panel (Students, Parents & guardians).');
    const fields = validateUserFields(body, data());
    fields.campusIds = campusList(fields.role, body.campusIds);
    validatePassword(body.password, data().settings.security);
    const u = {
      id: randomUUID(), ...fields, status: 'active',
      mustChangePassword: Boolean(data().settings.security?.forcePasswordChange) || body.mustChangePassword !== false,
      passwordHash: hashPassword(body.password), createdAt: new Date().toISOString(),
    };
    data().users.push(u);
    log(a, { kind: 'account', action: `Made a ${roleLabel(u.role)} account`, target: u, changes: [['name', u.name], ['username', u.username], ['email', u.email], ['account type', roleLabel(u.role)], ['campuses', campusesOf(u).join(', ')]].filter(([, v]) => v).map(([field, to]) => ({ field, from: '', to })) });
    save();
    return publicUser(u);
  });

  control('PUT', '/api/control/users/:id', (a) => {
    const { body, user } = a;
    const u = found(a.params.id);
    // What changed, field by field, before and after (as CORE's audit log keeps it).
    const changes = [];
    const changed = (field, from, to) => changes.push({ field, from: String(from ?? ''), to: String(to ?? '') });
    // Name, username and email: the same checks as everywhere.
    if (['name', 'username', 'email'].some((k) => k in body)) {
      const f = validateUserFields({ name: u.name, username: u.username, email: u.email, ...u, ...Object.fromEntries(['name', 'username', 'email'].filter((k) => k in body).map((k) => [k, body[k]])) }, data(), u);
      for (const k of ['name', 'username', 'email']) if (f[k] !== (u[k] || '')) (changed(k, u[k], f[k]), (u[k] = f[k]));
    }
    let signOut = false;
    if ('role' in body && body.role !== u.role) {
      if (!STAFF_ROLES.includes(u.role) || !STAFF_ROLES.includes(body.role)) fail('Students and parents keep their account type. Make a new account instead.');
      if (u.id === user.id) fail('You cannot change your own account type.');
      if (u.role === 'admin' && u.status === 'active' && activeAdmins().length <= 1) fail('Keep at least one active administrator.');
      if (u.role === 'teacher' && data().sections.some((s) => s.teacherId === u.id && s.status !== 'cancelled')) fail('This teacher has sections. Give them to another teacher first (Admin panel → Sections).');
      changed('account type', roleLabel(u.role), roleLabel(body.role));
      if (body.role === 'admin') u.campusIds = [];
      else if (u.role === 'admin') u.campusIds = campusList(body.role, body.campusIds || data().campuses.slice(0, 1).map((c) => c.id));
      u.role = body.role;
      // Its own access belonged to the old account type.
      if (u.access) (changed('own access', describeAccess(u.access), 'none (follows the new account type)'), delete u.access);
      signOut = true; // the account now signs in to another side, with other permissions
    }
    if ('campusIds' in body && u.role !== 'admin' && STAFF_ROLES.includes(u.role)) {
      const ids = campusList(u.role, body.campusIds);
      if (ids.join() !== (u.campusIds || []).join()) (changed('campuses', campusesOf(u).join(', '), ids.map((id) => campusName(data(), id)).join(', ')), (u.campusIds = ids));
    }
    if ('employeeId' in body && STAFF_ROLES.includes(u.role) && (body.employeeId || null) !== (u.employeeId || null)) {
      const emp = body.employeeId ? (data().employees || []).find((e) => e.id === body.employeeId) || fail('Employee record not found.') : null;
      const other = emp && data().users.find((x) => x.employeeId === emp.id && x.id !== u.id);
      if (other) fail(`That employee is already linked to the account "${other.username}".`);
      const was = u.employeeId ? (data().employees || []).find((e) => e.id === u.employeeId) : null;
      changed('employee record', was ? employeeName(was) : '', emp ? employeeName(emp) : '');
      if (emp) u.employeeId = emp.id;
      else delete u.employeeId;
    }
    if ('status' in body && body.status !== u.status) {
      if (!['active', 'disabled'].includes(body.status) || ['pending', 'rejected'].includes(u.status)) fail('Applicants are admitted or turned down by the registrar.');
      if (u.id === user.id && body.status === 'disabled') fail('You cannot disable your own account.');
      if (u.role === 'admin' && body.status === 'disabled' && activeAdmins().length <= 1) fail('Keep at least one active administrator.');
      changed('status', u.status, body.status);
      u.status = body.status;
      if (u.status === 'disabled') signOut = true;
    }
    if (!changes.length) return detail(u);
    u.updatedAt = new Date().toISOString();
    if (signOut) ctx.signOutEverywhere(u.id);
    log(a, { kind: 'account', action: 'Changed an account', target: u, changes });
    save();
    return detail(u);
  });

  // ----- One account's own access -----
  // permissions: every permission the account should have now. What differs from its account type
  // is kept on the account ({ add, remove }); the rest follows the account type, even when it changes.
  control('PUT', '/api/control/users/:id/access', (a) => {
    const u = found(a.params.id);
    if (u.role === 'admin') fail('Administrators always have every permission.');
    if (!STAFF_ROLES.includes(u.role)) fail('Students and parents have no permissions: what they see is set by Learn modules and parent links.');
    if (u.id === a.user.id) fail('You cannot change your own access.');
    const wanted = new Set((Array.isArray(a.body.permissions) ? a.body.permissions : []).map(String));
    const offered = new Set(accessGroups(u).flatMap((g) => g.permissions.map((p) => p.id)));
    const type = new Set(permissionsOf(u.role));
    for (const p of wanted) {
      if (type.has(p)) continue;
      if (!offered.has(p) || !grantable(u.role, p)) fail(`${roleLabel(u.role)} accounts cannot be given "${p}".`);
    }
    const add = [...wanted].filter((p) => !type.has(p)).sort();
    const remove = [...type].filter((p) => offered.has(p) && !wanted.has(p)).sort();
    const before = permissionsOfUser(u);
    if (add.length || remove.length) u.access = { add, remove };
    else delete u.access;
    const after = permissionsOfUser(u);
    const label = Object.fromEntries(PERMISSION_GROUPS.flatMap((g) => g.permissions));
    const changes = [...new Set([...before, ...after])].filter((p) => before.includes(p) !== after.includes(p)).sort()
      .map((p) => ({ field: label[p] || p, from: before.includes(p) ? 'Yes' : 'No', to: after.includes(p) ? 'Yes' : 'No' }));
    if (!changes.length) return detail(u);
    u.updatedAt = new Date().toISOString();
    log(a, { kind: 'access', action: 'Changed an account\'s own access', target: u, changes, detail: u.access ? '' : 'Now follows the account type.' });
    save();
    return detail(u);
  });

  // Delete an account nobody has used for records (as in CORE's Users & Access); otherwise disable it,
  // so the records keep who made them.
  control('DELETE', '/api/control/users/:id', (a) => {
    const u = found(a.params.id);
    const d = data();
    if (u.id === a.user.id) fail('You cannot delete your own account.');
    if (u.role === 'admin' && u.status === 'active' && activeAdmins().length <= 1) fail('Keep at least one active administrator.');
    const used = [
      [d.enrollments.some((e) => e.studentId === u.id), 'enrollment records'],
      [d.academicRecords.some((r) => r.studentId === u.id), 'an academic record'],
      [d.sections.some((s) => s.teacherId === u.id), 'sections'],
      [d.finAudit.some((e) => e.byId === u.id), 'Finance records'],
      [d.auditLog.some((e) => e.byId === u.id), 'Academic records'],
      [trail().some((e) => e.actorId === u.id && ['change', 'account', 'access', 'session', 'data'].includes(e.kind)), 'changes in the audit trail'],
    ].filter(([yes]) => yes).map(([, what]) => what);
    if (used.length) fail(`This account has ${used.join(', ')}. Disable it instead, so the records keep who made them.`);
    d.users.splice(d.users.indexOf(u), 1);
    d.guardianLinks = d.guardianLinks.filter((l) => l.guardianId !== u.id && l.studentId !== u.id);
    d.studentProfiles = d.studentProfiles.filter((p) => p.studentId !== u.id);
    d.documentRequests = d.documentRequests.filter((r) => r.studentId !== u.id);
    ctx.signOutEverywhere(u.id);
    unlockUsername(u.username);
    log(a, { kind: 'account', action: 'Deleted an account', targetName: `${u.name} (${u.username}, ${roleLabel(u.role)})` });
    save();
    return { ok: true };
  });

  control('POST', '/api/control/users/:id/reset-password', (a) => {
    const u = found(a.params.id);
    if (u.id === a.user.id) fail('Change your own password from the menu under your name.');
    validatePassword(a.body.password, data().settings.security);
    u.passwordHash = hashPassword(a.body.password);
    u.mustChangePassword = true;
    ctx.signOutEverywhere(u.id);
    unlockUsername(u.username);
    log(a, { kind: 'password', action: 'Reset a password', target: u, detail: 'A new password to change at the next sign-in; their sessions were ended and the username unlocked.' });
    save();
    return { ok: true };
  });
  control('POST', '/api/control/users/:id/require-password-change', (a) => {
    const u = found(a.params.id);
    u.mustChangePassword = true;
    log(a, { kind: 'password', action: 'Asked for a new password at the next sign-in', target: u });
    save();
    return detail(u);
  });
  control('POST', '/api/control/users/:id/sign-out', (a) => {
    const u = found(a.params.id);
    const n = sessionsOf(u.id).length;
    ctx.signOutEverywhere(u.id);
    log(a, { kind: 'session', action: 'Ended every session of an account', target: u, detail: `${n} session${n === 1 ? '' : 's'}` });
    return { ok: true, ended: n };
  });
  control('POST', '/api/control/users/:id/unlock', (a) => {
    const u = found(a.params.id);
    const n = unlockUsername(u.username);
    log(a, { kind: 'access', action: 'Unlocked a username', target: u, detail: `${n} lock${n === 1 ? '' : 's'} cleared` });
    return { ok: true, cleared: n };
  });
  control('POST', '/api/control/users/:id/unlink-sso', (a) => {
    const u = found(a.params.id);
    if (!u.ssoSubject) fail('This account is not linked to Keycloak.');
    delete u.ssoSubject;
    delete u.ssoName;
    delete u.ssoLinkedAt;
    ctx.signOutEverywhere(u.id);
    log(a, { kind: 'access', action: 'Unlinked an account from Keycloak', target: u, detail: 'The next Keycloak sign-in links it again by its email or username.' });
    save();
    return detail(u);
  });

  // ----- Sessions -----
  control('GET', '/api/control/sessions', ({ adminToken }) => {
    const mine = sides.admin.idOf(adminToken);
    const users = new Map(data().users.map((u) => [u.id, u]));
    return allSessions()
      .map((s) => {
        const u = users.get(s.userId);
        return { ...s, name: u?.name || '(deleted account)', username: u?.username || '', role: u?.role || '', roleLabel: roleLabel(u?.role), sideLabel: sideLabel(s.side), mine: s.side === 'admin' && s.id === mine, createdAt: new Date(s.createdAt).toISOString(), lastSeen: new Date(s.lastSeen).toISOString(), expires: new Date(s.expires).toISOString() };
      })
      .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  });
  control('DELETE', '/api/control/sessions/:id', (a) => {
    const s = allSessions().find((x) => x.id === a.params.id) || fail('That session has already ended.', 404);
    if (s.side === 'admin' && s.id === sides.admin.idOf(a.adminToken)) fail('That is this session: sign out instead.');
    sides[s.side].destroyById(s.id);
    const u = data().users.find((x) => x.id === s.userId);
    log(a, { kind: 'session', action: 'Ended a session', target: u || null, detail: `${sideLabel(s.side)}${s.ip ? ` · from ${s.ip}` : ''}` });
    return { ok: true };
  });
  // Everyone else signs in again: after a suspected break-in, or before maintenance.
  control('POST', '/api/control/sessions/end-others', (a) => {
    const mine = sides.admin.idOf(a.adminToken);
    let n = 0;
    for (const s of allSessions()) if (!(s.side === 'admin' && s.id === mine)) (sides[s.side].destroyById(s.id), n++);
    log(a, { kind: 'session', action: 'Ended everyone else\'s sessions', detail: `${n} session${n === 1 ? '' : 's'}` });
    return { ok: true, ended: n };
  });

  // ----- Locked sign-ins -----
  control('GET', '/api/control/locks', () => locks().sort((a, b) => b.until.localeCompare(a.until)));
  control('POST', '/api/control/locks/clear', (a) => {
    const key = String(a.body.key || '');
    const l = locks().find((x) => x.key === key) || fail('That lock has already opened.', 404);
    throttle.reset(key);
    const u = data().users.find((x) => x.id === l.accountId);
    log(a, { kind: 'access', action: 'Unlocked a username', target: u || null, targetName: u ? '' : l.username, detail: l.ip ? `On ${l.ip}` : 'Everywhere' });
    return { ok: true };
  });

  // ----- Access map: account types × systems, Learn modules and permissions -----
  control('GET', '/api/control/access', () => {
    const counts = {};
    for (const u of data().users) if (u.status === 'active') counts[u.role] = (counts[u.role] || 0) + 1;
    const systems = SYSTEMS.map((s) => ({ id: s.id, name: s.name, product: s.product, builtIn: Boolean(s.builtIn), status: s.builtIn ? 'live' : data().settings.systems[s.id]?.status || 'soon' }));
    return {
      systems,
      modules: MODULES.map((m) => ({ id: m.id, label: m.label })),
      roles: Object.keys(ROLES).map((r) => ({
        id: r, label: roleLabel(r), description: ROLES[r].description, side: ROLES[r].side, sideLabel: sideLabel(ROLES[r].side), accounts: counts[r] || 0,
        systems: SYSTEMS.filter((s) => s.audience.includes(r)).map((s) => s.id),
        modules: MODULE_ROLES.includes(r) ? MODULES.filter((m) => moduleOn(data().modules, m.id, r)).map((m) => m.id) : null,
        permissions: ROLES[r].permissions.includes('*') ? null : permissionsOf(r).length,
        changed: Boolean(data().roleOverrides?.[r]),
        ownAccess: data().users.filter((u) => u.role === r && (u.access?.add?.length || u.access?.remove?.length)).length,
      })),
    };
  });

  // ----- Audit trail -----
  control('GET', '/api/control/audit', (a) => {
    const { query } = a;
    const f = { q: query.q, source: query.source, kind: query.kind, system: query.system, outcome: query.outcome, userId: query.userId, from: query.from, to: query.to };
    const list = filterTrail(everything(), f);
    if (query.format === 'csv') {
      log(a, { kind: 'data', action: 'Downloaded the audit trail', detail: `${list.length} entr${list.length === 1 ? 'y' : 'ies'}${Object.entries(f).filter(([, v]) => v).map(([k, v]) => `; ${k}: ${v}`).join('')}`.slice(0, 400) });
      return { raw: trailCsv(list), type: 'text/csv', headers: { 'Content-Disposition': `attachment; filename="atlas-audit-trail-${new Date().toISOString().slice(0, 10)}.csv"` } };
    }
    const size = 50;
    const pages = Math.max(1, Math.ceil(list.length / size));
    const page = Math.min(pages, Math.max(1, Number(query.page) || 1));
    const who = query.userId ? data().users.find((u) => u.id === query.userId) : null;
    return {
      total: list.length, page, pages, entries: list.slice((page - 1) * size, page * size),
      user: who ? { id: who.id, name: who.name } : null,
      labels: { systems: SYSTEM_LABELS, kinds: KIND_LABELS, sources: SOURCE_LABELS },
      kept: { trail: trail().length, oldest: trail()[0]?.at || null, file: Boolean(ctx.auditLog.file) },
      check: ctx.auditLog.verify(),
    };
  });

}
