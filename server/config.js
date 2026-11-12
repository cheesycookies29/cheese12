// The Admin panel's server side (ported from Lancaster ATLAS: lms/server/config.js and admin.js):
//  - the Settings center: every module's settings in one catalog (shared/settings-catalog.js), each
//    compared with its default; a change history (who, when, the value before and after) for changes
//    made on any settings screen, with undo; restoring defaults; exporting the company's settings as
//    a file and importing one (with a preview, all or nothing);
//  - Roles & permissions: the company's changes to what each account type may do;
//  - Modules: which modules are on for the company;
//  - the Dashboard: a read-only overview of the system.
// Saving always goes through the module's own route (invoke), as the signed-in person, so the same
// checks and permissions apply as on its own screen, and no field is written that the screen would
// not write. No secret is read, kept in the history or exported: the service desk's mail passwords
// stay sealed on their screen.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './util.js';
import { DEFAULT_SETTINGS } from '../shared/calc.js';
import { DEFAULT_LOCATION_SETTINGS } from '../shared/geo.js';
import { DEFAULT_APPROVALS } from '../shared/leave.js';
import { DEFAULT_CRM } from '../shared/crm.js';
import { DEFAULT_STATUSES, DEFAULT_TYPES, DIGEST_DEFAULTS, DEFAULT_SIZE_NOTES } from '../shared/projects.js';
import { DEFAULT_BRANDING } from '../shared/brand.js';
import { SECURITY_DEFAULTS, securitySettings, twoFactorRequired } from './security.js';
import { approvalSettings } from './approvals.js';
import { emptyHelpdesk } from './helpdesk.js';
import { AREAS, SETTINGS, areaInfo, labelOf } from '../shared/settings-catalog.js';
import {
  ROLES, PERMISSION_LABELS, PERMISSION_GROUPS, ADMIN_ONLY_PERMISSIONS, setRoleOverrides, permissionsOf, userCan, usesAdminPanel, cleanOverrides,
} from '../shared/roles.js';
import { SWITCHABLE, cleanModuleConfig, defaultModuleConfig, moduleName } from '../shared/modules.js';
import { APP_VERSION } from '../shared/devlog.js';
import { buildInfo } from './build.js';
import { hasDemo } from './demo.js';
import { logoResponse } from './branding.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, clone(o?.[k])]));
const getPath = (o, p) => (p ? p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o) : o);
function setPath(o, p, v) {
  if (!p) return clone(v);
  const keys = p.split('.');
  let x = o;
  for (const k of keys.slice(0, -1)) x = x[k] ??= {};
  x[keys.at(-1)] = clone(v);
  return o;
}
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

const COMPANY_KEYS = ['companyName', 'companyAddress', 'companyTin'];
const PAYROLL_KEYS = ['payFrequency', 'workDaysPerYear', 'gracePeriodMinutes', 'minimumOvertimeMinutes', 'nightDiff', 'contributions', 'holidayPay'];
const HELPDESK_KEYS = ['categories', 'sla', 'autoCloseDays', 'autoAcknowledge', 'ackTemplate'];
// The mail settings without anything secret (no passwords, no sign-in names).
const MAILBOX_SAFE = ['enabled', 'address', 'displayName', 'host', 'port', 'security', 'folder', 'pollMinutes', 'allowedSenders', 'allowedDomains', 'defaultCategory', 'defaultPriority'];
const OUTGOING_SAFE = ['enabled', 'host', 'port', 'security', 'sameLogin'];
const CRM_KEYS = ['stages', 'sources', 'lostReasons', 'industries', 'bidChecklist', 'renewalNoticeDays'];
// A project status as compared and saved here: its look, not its id (ids are made when saved).
const statusOf = (s) => ({ name: s.name, category: s.category, color: s.color, ...(s.wipLimit ? { wipLimit: s.wipLimit } : {}) });

// How each area is read, what its defaults are, and which route saves it.
//   get(data): its current value; defaults(): the built-in value (none: "the company's own");
//   save(value): [method, path, body] for invoke (none: changed only on its own screen);
//   watch: the routes whose changes are recorded in the history under this area.
const SETTINGS_PUT = [['PUT', /^\/api\/settings$/]];
function definitions(db) {
  return {
    company: { get: (d) => pick(d.settings, COMPANY_KEYS), save: (v) => ['PUT', '/api/settings', pick(v, COMPANY_KEYS)], watch: SETTINGS_PUT },
    schedule: { get: (d) => clone(d.settings.schedule), defaults: () => clone(DEFAULT_SETTINGS.schedule), save: (v) => ['PUT', '/api/settings', { schedule: v }], watch: SETTINGS_PUT },
    branding: { get: (d) => ({ ...DEFAULT_BRANDING, ...clone(d.settings.branding) }), defaults: () => clone(DEFAULT_BRANDING), save: (v) => ['PUT', '/api/settings', { branding: v }], watch: SETTINGS_PUT },
    security: { get: () => clone(securitySettings(db)), defaults: () => clone(SECURITY_DEFAULTS), save: (v) => ['PUT', '/api/security-settings', v], watch: [['PUT', /^\/api\/security-settings$/]] },
    modules: { get: (d) => cleanModuleConfig(d.modules), defaults: () => defaultModuleConfig(), save: (v) => ['PUT', '/api/admin/modules', { modules: v }], watch: [['PUT', /^\/api\/admin\/modules$/]] },
    roles: { get: (d) => cleanOverrides(d.roleOverrides), defaults: () => ({}), save: (v) => ['PUT', '/api/admin/roles', { overrides: v }], watch: [['PUT', /^\/api\/admin\/roles$/]] },
    location: { get: (d) => ({ ...DEFAULT_LOCATION_SETTINGS, ...clone(d.settings.location) }), defaults: () => clone(DEFAULT_LOCATION_SETTINGS), save: (v) => ['PUT', '/api/location-settings', v], watch: [['PUT', /^\/api\/location-settings$/]] },
    approvals: { get: () => pick(approvalSettings(db), ['flow', 'levels', 'attachmentsToApprovers']), defaults: () => clone(DEFAULT_APPROVALS), save: (v) => ['PUT', '/api/approval-flow', v], watch: [['PUT', /^\/api\/approval-flow$/]] },
    leaveTypes: {
      get: (d) => (d.leaveTypes || []).map((t) => ({ code: t.code, name: t.name, annualCredits: t.annualCredits ?? null, paid: t.paid, active: t.active !== false })),
      watch: [['POST', /^\/api\/leave-types$/], ['PUT', /^\/api\/leave-types\/[^/]+$/], ['DELETE', /^\/api\/leave-types\/[^/]+$/]],
    },
    payroll: { get: (d) => pick(d.settings, PAYROLL_KEYS), defaults: () => pick(DEFAULT_SETTINGS, PAYROLL_KEYS), watch: [['PUT', /^\/api\/payroll-config$/]] },
    helpdesk: { get: (d) => pick(d.helpdesk, HELPDESK_KEYS), defaults: () => pick(emptyHelpdesk(), HELPDESK_KEYS), save: (v) => ['PUT', '/api/helpdesk/settings/general', v], watch: [['PUT', /^\/api\/helpdesk\/settings\/general$/]] },
    helpdeskForm: { get: (d) => clone(d.helpdesk?.publicForm), defaults: () => emptyHelpdesk().publicForm, save: (v) => ['PUT', '/api/helpdesk/settings/public-form', v], watch: [['PUT', /^\/api\/helpdesk\/settings\/(public-form|general)$/]] },
    helpdeskMail: {
      get: (d) => ({ mailbox: pick(d.helpdesk?.mailbox, MAILBOX_SAFE), outgoing: pick(d.helpdesk?.outgoing, OUTGOING_SAFE) }),
      defaults: () => ({ mailbox: pick(emptyHelpdesk().mailbox, MAILBOX_SAFE), outgoing: pick(emptyHelpdesk().outgoing, OUTGOING_SAFE) }),
      watch: [['PUT', /^\/api\/helpdesk\/settings\/(mailbox|outgoing)$/]],
    },
    crm: { get: (d) => pick(d.crm, CRM_KEYS), defaults: () => pick(DEFAULT_CRM, CRM_KEYS), save: (v) => ['PUT', '/api/crm/settings', v], watch: [['PUT', /^\/api\/crm\/settings$/]] },
    projects: {
      get: (d) => ({ statuses: (d.pm?.statuses || []).map(statusOf), types: clone(d.pm?.types || []), sizes: { ...DEFAULT_SIZE_NOTES, ...clone(d.pm?.sizes || {}) } }),
      defaults: () => ({ statuses: DEFAULT_STATUSES.map(statusOf), types: [...DEFAULT_TYPES], sizes: { ...DEFAULT_SIZE_NOTES } }),
      save: (v) => ['PUT', '/api/pm/settings', v],
      watch: [['PUT', /^\/api\/pm\/settings$/]],
    },
    digest: { get: (d) => pick({ ...DIGEST_DEFAULTS, ...(d.pm?.digest || {}) }, ['enabled', 'time', 'workingDaysOnly']), defaults: () => clone(DIGEST_DEFAULTS), save: (v) => ['PUT', '/api/pm/settings/digest', v], watch: [['PUT', /^\/api\/pm\/settings\/digest$/]] },
  };
}
const AREA_IDS = AREAS.map(([id]) => id);
// The data each area lives in: put back together if an import or a restore fails partway.
const SNAPSHOT_KEYS = ['settings', 'roleOverrides', 'modules', 'helpdesk', 'crm', 'pm', 'leaveTypes'];
// A backup restored or all data erased: every area is compared before and after.
const DATA_ROUTES = [['POST', /^\/api\/admin\/import$/, 'restore'], ['POST', /^\/api\/admin\/reset$/, 'erase']];

// What changed between two values of an area: [{ path, from, to }]. Objects are compared key by key;
// a list counts as one setting (its whole value before and after).
export function diffValues(a, b, p = '', out = []) {
  if (same(a, b) || out.length >= 80) return out;
  if (isPlain(a) && isPlain(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffValues(a[k], b[k], p ? `${p}.${k}` : k, out);
  } else out.push({ path: p, from: a, to: b });
  return out;
}

// Big values (a logo picture) are not kept in the history: it says what changed, without them.
const MAX_KEPT = 20000;
const keep = (v) => {
  const json = JSON.stringify(v ?? null);
  return json.length > MAX_KEPT ? { omitted: true, size: json.length } : v ?? null;
};

// Overrides from the permissions an account type should have: { add, remove } against the built-in
// ones. Administrators are never changed; admin-only permissions are never given to anyone else.
const KNOWN = new Set(PERMISSION_LABELS.map(([p]) => p));
function overridesFor(role, wanted) {
  if (!Array.isArray(wanted) || wanted.length > KNOWN.size) fail('Send a list of permissions.');
  const want = new Set(wanted.map(String));
  for (const p of want) {
    if (!KNOWN.has(p)) fail(`There is no permission "${p.slice(0, 40)}".`);
    if (ADMIN_ONLY_PERMISSIONS.includes(p) && !ROLES[role].permissions.includes(p)) fail(`"${PERMISSION_LABELS.find(([x]) => x === p)[1]}" stays with administrators.`);
  }
  const base = ROLES[role].permissions;
  const add = [...want].filter((p) => !base.includes(p)).sort();
  const remove = base.filter((p) => !want.has(p)).sort();
  return add.length || remove.length ? { add, remove } : null;
}
const permLabel = (p) => PERMISSION_LABELS.find(([x]) => x === p)?.[1] || p;

// invoke(user, method, path, body): runs one of CORE's routes as `user` (server/api.js).
// sessionCount(userId): how many sessions an account has now. audit: the audit log.
export function registerAdminRoutes(route, db, { invoke, audit, sessionCount }) {
  const data = () => db.data;
  const save = () => db.save();
  const DEFS = definitions(db);
  const def = (id) => (Object.hasOwn(DEFS, id) ? DEFS[id] : fail('Unknown group of settings.', 404));
  const mayArea = (user, id) => userCan(user, areaInfo(id).permission);
  setRoleOverrides(data().roleOverrides);

  // ----- Change history -----
  const snapshot = (ids) => Object.fromEntries(ids.map((id) => [id, DEFS[id].get(data())]));
  const record = (user, before, via) => {
    const entries = [];
    for (const [id, was] of Object.entries(before)) {
      const changes = diffValues(was, DEFS[id].get(data()));
      if (!changes.length) continue;
      const info = areaInfo(id);
      entries.push({
        id: randomUUID(), at: new Date().toISOString(), by: user?.name || 'CORE', byId: user?.id || null, via,
        area: id, module: info.module, areaLabel: info.label,
        changes: changes.map((c) => ({ path: c.path, label: labelOf(id, c.path), from: keep(c.from), to: keep(c.to) })),
      });
    }
    if (entries.length) {
      data().settingsLog.push(...entries);
      if (data().settingsLog.length > 5000) data().settingsLog.splice(0, data().settingsLog.length - 5000);
      save();
    }
    return entries;
  };
  // Called by the request handler around every request: a settings screen's save is recorded with
  // the value before and after. Returns a function to call once the request succeeded, or null.
  function settingsWatch(method, pathname) {
    if (method === 'GET') return null;
    const data = DATA_ROUTES.find(([m, re]) => m === method && re.test(pathname));
    const ids = data ? AREA_IDS : AREA_IDS.filter((id) => DEFS[id].watch?.some(([m, re]) => m === method && re.test(pathname)));
    if (!ids.length) return null;
    const before = snapshot(ids);
    return (user) => record(user, before, data ? data[2] : 'screen');
  }

  // Save an area through its own route, as `user` (their permissions apply), and record it.
  const apply = (user, id, value, via) => {
    const d = def(id);
    if (!d.save) fail(`${areaInfo(id).label}: changed on its own screen.`);
    const before = snapshot([id]);
    const [method, p, body] = d.save(value);
    invoke(user, method, p, body);
    return record(user, before, via);
  };
  // All or nothing: if one area fails, every area is put back.
  const atomic = (fn) => {
    const snap = Object.fromEntries(SNAPSHOT_KEYS.map((k) => [k, clone(data()[k])]));
    try {
      return fn();
    } catch (err) {
      Object.assign(data(), snap);
      setRoleOverrides(data().roleOverrides);
      save();
      throw err;
    }
  };
  const auditChanges = (entries, note) => {
    for (const e of entries) audit.record('settings.center', { entity: 'settings', entityId: e.area, label: e.areaLabel, note, changes: e.changes.slice(0, 40).map((c) => ({ field: c.label, from: shown(c.from), to: shown(c.to) })) });
  };
  const shown = (v) => (v && typeof v === 'object' && v.omitted ? '(a picture)' : typeof v === 'object' && v !== null ? JSON.stringify(v).slice(0, 300) : v);

  // ----- The catalog: every setting with its value and default -----
  const visibleAreas = (user) => AREA_IDS.filter((id) => mayArea(user, id));
  route('GET', '/api/admin/config', 'settings.center', ({ user }) => {
    const d = data();
    const ids = visibleAreas(user);
    const values = Object.fromEntries(ids.map((id) => [id, DEFS[id].get(d)]));
    const defaults = Object.fromEntries(ids.map((id) => [id, DEFS[id].defaults?.()]));
    const lastChange = {};
    for (const e of d.settingsLog) if (ids.includes(e.area)) for (const c of e.changes) lastChange[`${e.area}|${c.path}`] = { at: e.at, by: e.by };
    return {
      areas: AREAS.filter(([id]) => ids.includes(id)).map(([id, module, label, screen]) => ({ id, module, label, screen, resettable: Boolean(DEFS[id].defaults && DEFS[id].save), importable: Boolean(DEFS[id].save) })),
      settings: SETTINGS.filter(([area]) => ids.includes(area)).map(([area, p, label, help, format]) => {
        const value = getPath(values[area], p);
        const hasDefault = Boolean(DEFS[area].defaults);
        const dflt = hasDefault ? getPath(defaults[area], p) : undefined;
        const changedAt = Object.entries(lastChange).filter(([k]) => k === `${area}|${p}` || k.startsWith(`${area}|${p}${p ? '.' : ''}`)).map(([, v]) => v).sort((a, b) => b.at.localeCompare(a.at))[0];
        return {
          area, path: p, label, help, format: format || null,
          value: keep(value), default: hasDefault ? keep(dflt) : null, hasDefault,
          changed: hasDefault && !same(value, dflt),
          resettable: hasDefault && Boolean(DEFS[area].save),
          lastChange: changedAt || null,
        };
      }),
    };
  });

  // Restore defaults: a whole area, or one setting in it.
  route('POST', '/api/admin/config/reset', 'settings.center', ({ user, body }) => {
    const id = String(body.area || '');
    const d = def(id);
    if (!mayArea(user, id)) fail('Your account does not have access to this.', 403);
    if (!d.defaults || !d.save) fail(`${areaInfo(id).label} have no built-in defaults to go back to.`);
    const p = String(body.path || '');
    if (p && !SETTINGS.some(([a, q]) => a === id && q === p)) fail('Unknown setting.');
    const value = p ? setPath(d.get(data()), p, getPath(d.defaults(), p)) : d.defaults();
    const entries = atomic(() => apply(user, id, value, p ? 'reset' : 'reset-all'));
    auditChanges(entries, p ? 'Default restored in the Settings center' : 'Defaults restored in the Settings center');
    return { ok: true, changes: entries.reduce((n, e) => n + e.changes.length, 0) };
  });

  // ----- History -----
  const undoable = (e) => Boolean(DEFS[e.area]?.save) && ['screen', 'reset', 'reset-all', 'import'].includes(e.via) && e.changes.every((c) => !c.from?.omitted && !c.to?.omitted);
  route('GET', '/api/admin/config/history', 'settings.center', ({ user, query }) => {
    const q = String(query.q || '').trim().toLowerCase();
    const ids = visibleAreas(user);
    let list = data().settingsLog.filter((e) => ids.includes(e.area));
    if (query.module) list = list.filter((e) => e.module === query.module);
    if (query.area) list = list.filter((e) => e.area === query.area);
    if (query.path) list = list.filter((e) => e.changes.some((c) => c.path === query.path || c.path.startsWith(`${query.path}.`)));
    if (q) list = list.filter((e) => `${e.by} ${e.areaLabel} ${e.changes.map((c) => c.label).join(' ')}`.toLowerCase().includes(q));
    const out = list.slice(-500).reverse();
    return { entries: out.map((e) => ({ ...e, undoable: undoable(e) })), total: list.length };
  });
  // Undo a change: put back the values it replaced, if nothing has changed them since (so only the
  // last change of a setting can be undone).
  route('POST', '/api/admin/config/history/:id/undo', 'settings.center', ({ user, params }) => {
    const e = data().settingsLog.find((x) => x.id === params.id) || fail('Change not found.', 404);
    if (!mayArea(user, e.area)) fail('Your account does not have access to this.', 403);
    const d = def(e.area);
    if (!undoable(e)) fail(e.changes.some((c) => c.from?.omitted || c.to?.omitted) ? 'This change included a picture, which the history does not keep. Change it on its screen.' : 'This change cannot be undone here. Change it on its screen.');
    let value = d.get(data());
    for (const c of e.changes) {
      if (!same(getPath(value, c.path), c.to)) fail(`${c.label} has been changed again since. Undo the later change first, or change it on its screen.`);
      value = setPath(value, c.path, c.from);
    }
    const entries = atomic(() => apply(user, e.area, value, 'undo'));
    auditChanges(entries, 'Undone in the Settings center');
    return { ok: true, entries };
  });

  // ----- Export and import -----
  const exportable = (user) => visibleAreas(user).filter((id) => DEFS[id].save);
  route('GET', '/api/admin/config/export', 'settings.center', ({ user }) => {
    audit.record('settings.export', { entity: 'settings', label: 'Settings exported', note: exportable(user).map((id) => areaInfo(id).label).join(', ').slice(0, 500) });
    return {
      coreSettings: 1, version: APP_VERSION, exportedAt: new Date().toISOString(), exportedBy: user.name, company: data().settings.companyName,
      areas: Object.fromEntries(exportable(user).map((id) => [id, DEFS[id].get(data())])),
    };
  });
  // An imported group keeps what the file leaves out.
  const merge = (current, value) => (isPlain(value) && isPlain(current) ? { ...current, ...value } : value);
  const readFile = (user, file) => {
    if (!isPlain(file) || file.coreSettings !== 1 || !isPlain(file.areas)) fail('This is not a CORE settings file (Admin panel → Settings center → Export settings).');
    const list = Object.entries(file.areas).filter(([id]) => AREA_IDS.includes(id));
    for (const [id] of list) if (!exportable(user).includes(id)) fail(`${areaInfo(id).label}: your account cannot change these. Untick them, or ask an administrator.`);
    return list;
  };
  // What importing would change, area by area (nothing is saved).
  route('POST', '/api/admin/config/import/preview', 'settings.center', ({ user, body }) => {
    const list = Object.entries(isPlain(body.file?.areas) ? body.file.areas : {}).filter(([id]) => exportable(user).includes(id));
    readFile(user, { ...body.file, areas: Object.fromEntries(list) });
    const areas = list.map(([id, value]) => {
      const current = DEFS[id].get(data());
      const changes = diffValues(current, merge(current, value)).map((c) => ({ path: c.path, label: labelOf(id, c.path), from: keep(c.from), to: keep(c.to) }));
      return { id, ...areaInfo(id), changes };
    });
    const skipped = Object.keys(body.file.areas).filter((id) => !list.some(([x]) => x === id)).map((id) => areaInfo(id)?.label || id).slice(0, 20);
    return { company: String(body.file.company || '').slice(0, 200), exportedAt: body.file.exportedAt || null, exportedBy: String(body.file.exportedBy || '').slice(0, 200), version: String(body.file.version || '').slice(0, 40), areas, skipped };
  });
  // Every ticked group is saved through its own screen's checks; if one is refused, nothing is kept.
  route('POST', '/api/admin/config/import', 'settings.center', ({ user, body }) => {
    const wanted = new Set(Array.isArray(body.areas) ? body.areas.map(String) : []);
    const list = readFile(user, { ...body.file, areas: Object.fromEntries(Object.entries(isPlain(body.file?.areas) ? body.file.areas : {}).filter(([id]) => wanted.has(id))) });
    if (!list.length) fail('Pick at least one group of settings to import.');
    const entries = atomic(() => list.flatMap(([id, value]) => {
      try {
        return apply(user, id, merge(DEFS[id].get(data()), value), 'import');
      } catch (err) {
        throw new HttpError(err.status === 403 ? 403 : 400, `${areaInfo(id).label}: ${err.message} Nothing was imported.`);
      }
    }));
    auditChanges(entries, 'Imported from a settings file');
    return { ok: true, areas: list.length, changes: entries.reduce((n, e) => n + e.changes.length, 0) };
  });

  // ----- Roles and permissions (administrators only: roles.manage stays with them) -----
  const rolesView = () => ({
    roles: Object.entries(ROLES).map(([id, r]) => ({
      id, label: r.label, description: r.description, fixed: id === 'admin',
      builtIn: r.permissions, permissions: permissionsOf(id), changed: Boolean(cleanOverrides(data().roleOverrides)[id]),
      accounts: data().users.filter((u) => u.role === id && u.active).length,
    })),
    groups: PERMISSION_GROUPS.map((g) => ({ id: g.id, label: g.label, permissions: g.permissions.map((p) => ({ id: p, label: permLabel(p), adminOnly: ADMIN_ONLY_PERMISSIONS.includes(p) })) })),
  });
  route('GET', '/api/admin/roles', 'roles.manage', rolesView);
  // overrides: the whole map ({ role: { add, remove } }), or permissions: { role: [permission…] } for some roles.
  route('PUT', '/api/admin/roles', 'roles.manage', ({ body }) => {
    const current = cleanOverrides(data().roleOverrides);
    let wanted;
    if (isPlain(body.permissions)) wanted = body.permissions;
    else if (isPlain(body.overrides)) {
      for (const role of Object.keys(body.overrides)) {
        if (!Object.hasOwn(ROLES, role)) fail(`Unknown account type ${String(role).slice(0, 40)}.`);
        if (role === 'admin') fail('Administrators always have every permission.');
      }
      wanted = Object.fromEntries(Object.keys(ROLES).filter((r) => r !== 'admin').map((r) => {
        const o = isPlain(body.overrides[r]) ? body.overrides[r] : {};
        if ((o.add && !Array.isArray(o.add)) || (o.remove && !Array.isArray(o.remove))) fail('Send the permissions to add and remove as lists.');
        return [r, [...new Set([...ROLES[r].permissions.filter((p) => !(o.remove || []).includes(p)), ...(o.add || [])])]];
      }));
    } else fail('Send the permissions for each account type.');
    const next = { ...current };
    for (const [role, list] of Object.entries(wanted)) {
      if (!Object.hasOwn(ROLES, role)) fail(`Unknown account type ${String(role).slice(0, 40)}.`);
      if (role === 'admin') fail('Administrators always have every permission.');
      const o = overridesFor(role, list);
      if (o) next[role] = o;
      else delete next[role];
    }
    const before = Object.fromEntries(Object.keys(ROLES).map((r) => [r, permissionsOf(r)]));
    data().roleOverrides = setRoleOverrides(next);
    save();
    const changes = [];
    for (const r of Object.keys(ROLES)) {
      const after = permissionsOf(r);
      for (const p of after.filter((x) => !before[r].includes(x))) changes.push({ field: `${ROLES[r].label}: ${permLabel(p)}`, from: 'No', to: 'Yes' });
      for (const p of before[r].filter((x) => !after.includes(x))) changes.push({ field: `${ROLES[r].label}: ${permLabel(p)}`, from: 'Yes', to: 'No' });
    }
    if (changes.length) audit.record('settings.roles', { entity: 'settings', label: 'Roles and permissions', changes: changes.slice(0, 60) });
    return rolesView();
  });

  // ----- Modules on or off for the company -----
  const modulesView = () => ({ config: cleanModuleConfig(data().modules) });
  route('GET', '/api/admin/modules', 'modules.config', modulesView);
  route('PUT', '/api/admin/modules', 'modules.config', ({ body }) => {
    const input = isPlain(body.modules) ? body.modules : fail('Send which modules are on.');
    for (const [id, v] of Object.entries(input)) {
      if (!SWITCHABLE.includes(id)) fail(`There is no module "${String(id).slice(0, 40)}".`);
      if (typeof v !== 'boolean') fail(`Say whether ${moduleName(id)} is on or off.`);
    }
    const before = cleanModuleConfig(data().modules);
    const next = { ...before, ...input };
    data().modules = next;
    save();
    const changes = SWITCHABLE.filter((id) => before[id] !== next[id]).map((id) => ({ field: moduleName(id), from: before[id] ? 'On' : 'Off', to: next[id] ? 'On' : 'Off' }));
    if (changes.length) audit.record('settings.modules', { entity: 'settings', label: 'Modules', changes });
    return modulesView();
  });

  // ----- Dashboard: a read-only overview, each part for those who may open its page -----
  const sizeOf = (p) => {
    try {
      const st = fs.statSync(p);
      if (st.isFile()) return st.size;
      return fs.readdirSync(p).reduce((n, f) => n + sizeOf(path.join(p, f)), 0);
    } catch {
      return 0;
    }
  };
  const countFiles = (p) => {
    try {
      return fs.readdirSync(p, { withFileTypes: true }).reduce((n, f) => n + (f.isDirectory() ? countFiles(path.join(p, f.name)) : 1), 0);
    } catch {
      return 0;
    }
  };
  route('GET', '/api/admin/dashboard', 'auth', ({ user }) => {
    if (!usesAdminPanel(user)) fail('Your account does not have access to this.', 403);
    const d = data();
    const can = (p) => userCan(user, p);
    const out = { version: APP_VERSION, build: can('users.manage') ? { node: process.version, ...buildInfo() } : null };
    if (can('users.manage')) {
      const active = d.users.filter((u) => u.active);
      const sec = securitySettings(db);
      out.people = {
        byRole: Object.keys(ROLES).map((r) => ({ role: r, label: ROLES[r].label, count: active.filter((u) => u.role === r).length })).filter((x) => x.count),
        active: active.length, disabled: d.users.length - active.length,
        signedIn: active.filter((u) => sessionCount(u.id) > 0).length,
        twoFactor: {
          on: active.filter((u) => u.twoFactor?.enabledAt).length,
          required: active.filter((u) => !u.twoFactor?.enabledAt && twoFactorRequired(sec, u)).length,
          off: active.filter((u) => !u.twoFactor?.enabledAt && !twoFactorRequired(sec, u)).length,
          policy: sec.twoFactor,
        },
        tempPasswords: active.filter((u) => u.mustChangePassword).length,
      };
    }
    if (can('audit.view')) {
      const since = Date.now() - 24 * 3600000;
      const recent = audit.list({ from: new Date(since - 86400000).toISOString().slice(0, 10), limit: 5000 }).entries.filter((e) => Date.parse(e.at) >= since);
      out.security = {
        failedSignIns: recent.filter((e) => e.action === 'auth.login-failed').length,
        wrongCodes: recent.filter((e) => e.action === 'auth.2fa-failed').length,
        locks: recent.filter((e) => e.action === 'auth.locked').length,
        chain: audit.verify(),
      };
    }
    if (can('modules.config') || can('settings.center')) out.modules = cleanModuleConfig(d.modules);
    // Feedback still open with no reply written to its sender yet.
    if (can('feedback.view')) out.feedback = { awaiting: (d.feedback || []).filter((f) => !['resolved', 'closed'].includes(f.status) && !(f.updates || []).some((x) => x.note)).length, new: (d.feedback || []).filter((f) => f.status === 'new').length };
    if (can('settings.center')) out.settingsChanged = d.settingsLog.length ? d.settingsLog.at(-1).at : null;
    if (can('data.manage')) {
      out.data = {
        dbBytes: sizeOf(db.file),
        attachmentsBytes: sizeOf(path.join(db.dir, 'attachments')), attachments: countFiles(path.join(db.dir, 'attachments')),
        auditBytes: sizeOf(audit.file),
        lastBackupAt: d.adminState?.lastBackupAt || null, lastBackupBy: d.adminState?.lastBackupBy || null,
        demo: hasDemo(db),
      };
    }
    return out;
  });

  // ----- The logo, for every page including the sign-in page -----
  route('GET', '/api/public/brand/logo', 'public', () => logoResponse(data().settings));

  return { settingsWatch, diffValues };
}
