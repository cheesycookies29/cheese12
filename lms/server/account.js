// Your own account, after CORE ERP's (docs/account-profile.md): the profile picture, My profile,
// the title administrators give (CORE's "role in the company"), where you are signed in, and the
// pages you pin to Quick access. Routes under /api/me/ are for whoever is signed in, in any ATLAS
// system; the /api/system/users/:id/… ones are for administrators.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError } from './util.js';
import { ROLES, roleLabel } from '../shared/roles.js';
import { campusName } from './campus.js';
import { guardianChildren } from './guardian.js';
import { t } from './validate.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};

// ----- Title (the position in the school) -----
export const TITLE_MAX = 80;
// A title as typed: plain text on one line, at most TITLE_MAX characters; empty means none.
export function cleanTitle(v) {
  if (v == null) return null;
  if (typeof v !== 'string') fail('The title must be text.');
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > TITLE_MAX) fail(`The title can be up to ${TITLE_MAX} characters.`);
  return s || null;
}

// ----- Pictures -----
export const AVATAR_MAX = 300 * 1024;
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// The type, from the first bytes (never from the name or what the browser says). SVG and HTML are
// never pictures here: they can carry scripts.
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// The picture files: data/avatars/<id> (readable by ATLAS only), or in memory without a data folder.
export function createAvatarStore(dir) {
  const folder = dir ? path.join(dir, 'avatars') : null;
  const memory = new Map();
  const fileOf = (id) => {
    if (!UUID.test(String(id))) return null;
    return path.join(folder, id);
  };
  return {
    folder,
    save(bytes) {
      const id = randomUUID();
      if (folder) {
        fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
        fs.writeFileSync(fileOf(id), bytes, { mode: 0o600 });
      } else memory.set(id, bytes);
      return id;
    },
    read(id) {
      if (!folder) return memory.get(id) || null;
      const f = fileOf(id);
      try {
        return f ? fs.readFileSync(f) : null;
      } catch {
        return null;
      }
    },
    remove(id) {
      if (!folder) return memory.delete(id);
      const f = fileOf(id);
      try {
        if (f) fs.unlinkSync(f);
      } catch {}
      return true;
    },
    ids() {
      if (!folder) return [...memory.keys()];
      try {
        return fs.readdirSync(folder).filter((f) => UUID.test(f));
      } catch {
        return [];
      }
    },
  };
}

// ----- Quick access -----
export const QUICK_MAX = 12;
// A page in ATLAS: the home page, or a page inside one of its systems (never another site or a script).
const QUICK_HREF = /^\/(?:(?:lms\/|admin|hris\/|academic\/|finance\/)#\/[A-Za-z0-9\-._~/?=&%:,+]*)?$/;
export function cleanQuickLinks(list) {
  if (!Array.isArray(list)) fail('Send the pinned pages as a list.');
  if (list.length > QUICK_MAX) fail(`You can pin up to ${QUICK_MAX} pages.`);
  const seen = new Set();
  const out = [];
  for (const x of list) {
    const href = typeof x?.href === 'string' ? x.href : '';
    if (!href || href.length > 300 || !QUICK_HREF.test(href)) fail('That page cannot be pinned: only pages in ATLAS can.');
    const label = typeof x.label === 'string' ? x.label.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
    if (!label || label.length > 80) fail('Each pinned page needs a name of up to 80 characters.');
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, label });
  }
  return out;
}

// A short name for a browser, from what it says it is.
export function deviceOf(agent = '') {
  const a = String(agent);
  const browser = /Edg\//.test(a) ? 'Edge' : /OPR\//.test(a) ? 'Opera' : /Firefox\//.test(a) ? 'Firefox' : /Chrome\//.test(a) ? 'Chrome' : /Safari\//.test(a) ? 'Safari' : '';
  const os = /Android/.test(a) ? 'Android' : /iPhone|iPad/.test(a) ? 'iPhone or iPad' : /Windows/.test(a) ? 'Windows' : /Mac OS X/.test(a) ? 'Mac' : /Linux/.test(a) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' on ') || 'Another device';
}

// After a restore or a removal: keep a picture reference only when its file is on this server and is
// that picture's type, and give each file to one account only (CORE 0.32.1); delete files no
// account names any more.
export function tidyAvatars(data, store) {
  const owned = new Set();
  for (const u of data.users) {
    const a = u.avatar;
    if (a) {
      const bytes = UUID.test(String(a.id)) && AVATAR_TYPES.includes(a.type) && !owned.has(a.id) ? store.read(a.id) : null;
      if (bytes && sniffImage(bytes) === a.type && typeof a.at === 'string' && a.at.length <= 40) {
        owned.add(a.id);
        u.avatar = { id: a.id, type: a.type, size: bytes.length, at: a.at };
      } else delete u.avatar;
    }
    if (u.quickLinks) {
      try {
        const links = cleanQuickLinks(u.quickLinks);
        if (links.length) u.quickLinks = links;
        else delete u.quickLinks;
      } catch {
        delete u.quickLinks;
      }
    }
    if ('title' in u) {
      try {
        const title = cleanTitle(u.title);
        if (title) u.title = title;
        else delete u.title;
      } catch {
        delete u.title;
      }
    }
  }
  for (const id of store.ids()) if (!owned.has(id)) store.remove(id);
}

// deps: { db, sides, avatars (the store), record (audit), systemsFor(user) => [{ id, name, url, status }] }
export function registerAccountRoutes(route, { db, sides, avatars, record, systemsFor }) {
  const data = () => db.data;
  const users = () => data().users;
  const only = (user) => {
    if (user?.role !== 'admin') fail('Only administrators can do this.', 403);
  };
  const found = (id) => users().find((u) => u.id === id) || fail('Account not found.', 404);
  const at = (u) => u.avatar?.at || null;

  // ----- The profile -----
  function profileOf(u, viewer) {
    const self = viewer.id === u.id;
    const role = ROLES[u.role] || {};
    const program = u.programId ? data().programs.find((p) => p.id === u.programId) : null;
    const emp = u.employeeId ? (data().employees || []).find((e) => e.id === u.employeeId) : null;
    const campuses = u.role === 'admin' ? ['Every campus'] : (u.campusIds || []).map((id) => campusName(data(), id)).filter(Boolean);
    return {
      id: u.id, self, name: u.name, title: u.title || null, avatar: at(u),
      username: u.username, email: u.email || '', phone: u.phone || '',
      accountType: u.role, accountTypeLabel: roleLabel(u.role), side: role.side || null,
      status: u.status, campuses, activeCampus: campusName(data(), u.activeCampusId) || campuses[0] || '',
      createdAt: u.createdAt || null, lastLoginAt: u.lastLoginAt || null,
      sso: u.ssoSubject ? { name: u.ssoName || '', linkedAt: u.ssoLinkedAt || null } : null,
      mustChangePassword: Boolean(u.mustChangePassword),
      student: u.role === 'student' ? { studentNo: u.studentNo || '', program: program ? `${program.code} · ${program.name}` : '', yearLevel: u.yearLevel || null } : null,
      teacher: u.role === 'teacher' ? { department: u.department || '', employeeNo: u.employeeNo || '' } : null,
      children: u.role === 'guardian' ? guardianChildren(data(), u.id).map(({ link, student }) => ({ name: student.name, relationship: link.relationship || '' })) : null,
      employee: emp ? { employeeNo: emp.employeeNo || '', position: emp.position || '', department: emp.department || '', status: emp.employmentStatus || '', hireDate: emp.hireDate || '', campus: campusName(data(), emp.campusId) } : null,
      systems: systemsFor(u),
      canEditTitle: viewer.role === 'admin',
    };
  }
  route('GET', '/api/me/profile', 'me', ({ user }) => profileOf(user, user), { audit: false });
  route('GET', '/api/system/users/:id/profile', 'admin', ({ user, params }) => {
    only(user);
    return profileOf(found(params.id), user);
  }, { audit: false });
  route('PUT', '/api/system/users/:id/title', 'admin', ({ user, params, body, ip, agent }) => {
    only(user);
    const u = found(params.id);
    const title = cleanTitle(body.title ?? '');
    if ((u.title || null) === title) return { title };
    record({ kind: 'account', system: 'system', action: 'Changed an account', actor: user, target: u, ip, agent, changes: [{ field: 'title', from: u.title || '', to: title || '' }] });
    if (title) u.title = title;
    else delete u.title;
    u.updatedAt = new Date().toISOString();
    db.save();
    return { title };
  }, { audit: false, body: { title: t.str(400) } });

  // ----- Pictures -----
  route('GET', '/api/avatars', 'me', () => Object.fromEntries(users().filter((u) => u.avatar).map((u) => [u.id, u.avatar.at])), { audit: false });
  route('GET', '/api/users/:id/avatar', 'me', ({ params }) => {
    const u = users().find((x) => x.id === params.id);
    const bytes = u?.avatar ? avatars.read(u.avatar.id) : null;
    if (!bytes) fail('No picture.', 404);
    return {
      raw: bytes, type: u.avatar.type,
      headers: { 'Content-Disposition': 'inline; filename="profile"', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, max-age=31536000, immutable' },
    };
  }, { audit: false });
  // Your own picture is not in the audit log (as in CORE): it is not a record, and an entry would
  // count as a change that keeps the account from being deleted. An administrator's removal is.
  route('PUT', '/api/me/avatar', 'me', ({ user, body }) => {
    const b64 = String(body.file?.data || '').replace(/^data:[^,]*,/, '');
    if (!b64) fail('Choose a picture.');
    if (b64.length > Math.ceil((AVATAR_MAX * 4) / 3) + 8) fail('The picture is too large: at most 300 KB.');
    const bytes = Buffer.from(b64, 'base64');
    if (!bytes.length) fail('Choose a picture.');
    if (bytes.length > AVATAR_MAX) fail('The picture is too large: at most 300 KB.');
    const type = sniffImage(bytes);
    if (!type) fail('Use a photo: JPEG, PNG or WebP.');
    const old = user.avatar?.id;
    user.avatar = { id: avatars.save(bytes), type, size: bytes.length, at: new Date().toISOString() };
    if (old) avatars.remove(old);
    db.save();
    return { avatar: user.avatar.at };
  }, { audit: false, body: { file: t.obj({ name: t.str(200), data: t.str(600000) }) } });
  route('DELETE', '/api/me/avatar', 'me', ({ user }) => {
    if (user.avatar) {
      avatars.remove(user.avatar.id);
      delete user.avatar;
      db.save();
    }
    return { avatar: null };
  }, { audit: false });
  route('DELETE', '/api/system/users/:id/avatar', 'admin', ({ user, params, ip, agent }) => {
    only(user);
    const u = found(params.id);
    if (!u.avatar) fail('This account has no picture.');
    avatars.remove(u.avatar.id);
    delete u.avatar;
    record({ kind: 'account', system: 'system', action: 'Removed an account\'s picture', actor: user, target: u, ip, agent });
    db.save();
    return { ok: true };
  }, { audit: false });

  // ----- Where you are signed in -----
  const mine = (user) => Object.entries(sides).flatMap(([side, s]) => s.list().filter((x) => x.userId === user.id).map((x) => ({ ...x, side })));
  const thisDevice = (tokens) => new Set(Object.entries(sides).map(([side, s]) => s.idOf(tokens?.[side])).filter(Boolean));
  const SIDE_LABELS = { portal: 'Learn', admin: 'Admin panel', hris: 'People' };
  route('GET', '/api/me/sessions', 'me', ({ user, tokens }) => {
    const here = thisDevice(tokens);
    return mine(user)
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((s) => ({ id: s.id, current: here.has(s.id), side: SIDE_LABELS[s.side] || s.side, device: deviceOf(s.agent), ip: s.ip || '', sso: s.sso, signedInAt: new Date(s.createdAt).toISOString(), lastSeenAt: new Date(s.lastSeen).toISOString() }));
  }, { audit: false });
  route('DELETE', '/api/me/sessions/:id', 'me', ({ user, params, tokens, ip, agent }) => {
    const s = mine(user).find((x) => x.id === params.id) || fail('That session has already ended.', 404);
    if (thisDevice(tokens).has(s.id)) fail('This is the device you are using. Use Sign out instead.');
    sides[s.side].destroyById(s.id);
    record({ kind: 'signout', system: 'home', action: 'Signed out one of their devices', actor: user, target: user, ip, agent, detail: `${deviceOf(s.agent)} · ${s.ip || 'unknown address'}` });
    return { ok: true };
  }, { audit: false });
  route('POST', '/api/me/sessions/sign-out-others', 'me', ({ user, tokens, ip, agent }) => {
    const here = thisDevice(tokens);
    const others = mine(user).filter((s) => !here.has(s.id));
    for (const s of others) sides[s.side].destroyById(s.id);
    if (others.length) record({ kind: 'signout', system: 'home', action: 'Signed out everywhere else', actor: user, target: user, ip, agent, detail: `${others.length} session${others.length === 1 ? '' : 's'}` });
    return { signedOut: others.length };
  }, { audit: false });

  // ----- Quick access: the pages you pinned (they follow you to any device) -----
  route('GET', '/api/me/quick-links', 'me', ({ user }) => ({ links: user.quickLinks || [] }), { audit: false });
  route('PUT', '/api/me/quick-links', 'me', ({ user, body }) => {
    const links = cleanQuickLinks(body.links);
    if (links.length) user.quickLinks = links;
    else delete user.quickLinks;
    db.save();
    return { links };
  }, { audit: false, body: { links: t.arr(t.obj({ href: t.str(400), label: t.str(400) }), 50) } });
}
