// The Settings center (Admin panel → Settings center): every module's settings in one place.
//  - one catalog of settings (shared/settings-catalog.js), each compared with its default;
//  - a change history with who, when, and the value before and after (settingsLog), for changes
//    made on any settings screen, plus undo;
//  - restore defaults, for a whole group or one setting;
//  - export the school's settings as a file, and import them (with a preview) into another ATLAS;
//  - roles and permissions: what each account type may do.
// Saving always goes through the module's own route (ctx.invoke), so its checks and permissions
// apply exactly as on its own screen. Patterns from Discourse (site settings, staff action log),
// Moodle (config_log, admin search), Canvas (feature flags) and Frappe (Single DocTypes, versions).
import { randomUUID } from 'node:crypto';
import { HttpError } from './util.js';
import { DEFAULT_SETTINGS, DEFAULT_ACTIVITY_TYPES } from './db.js';
import { defaultModuleConfig } from '../shared/modules.js';
import { defaultSystemSettings } from '../shared/systems.js';
import { DEFAULT_ACADEMIC_SETTINGS } from '../shared/academic.js';
import { mergeHrSettings } from './hris.js';
import { DEFAULT_FINANCE_SETTINGS } from './finance.js';
import { AREAS, SETTINGS, areaInfo, labelOf } from '../shared/settings-catalog.js';
import {
  ROLES, PERMISSION_LABELS, HRIS_PERMISSION_LABELS, FINANCE_PERMISSION_LABELS, ADMIN_ONLY_PERMISSIONS, setRoleOverrides, permissionsOf,
} from '../shared/roles.js';
import { ACADEMIC_PERMISSION_LABELS } from '../shared/academic.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, clone(o?.[k])]));
const getPath = (o, path) => (path ? path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o) : o);
function setPath(o, path, v) {
  if (!path) return clone(v);
  const keys = path.split('.');
  let x = o;
  for (const k of keys.slice(0, -1)) x = x[k] ??= {};
  x[keys.at(-1)] = clone(v);
  return o;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const ENROLLMENT_KEYS = ['passingGrade', 'enrollment', 'registration'];
const ACADEMIC_KEYS = ['passingGrade', 'scale', 'incDays', 'honors', 'registrar', 'fees', 'requirements'];
const HR_KEYS = ['employerAddress', 'employerTin', 'schedule'];
const PAYROLL_KEYS = ['payrollSystem', 'payFrequency', 'workDaysPerYear', 'gracePeriodMinutes', 'minimumOvertimeMinutes', 'overtimeMultiplier', 'restDayMultiplier', 'contributions', 'rates', 'gov'];
const FINANCE_KEYS = ['entity', 'fiscalYear', 'funds', 'offices', 'paps', 'bankAccounts', 'revenueItems', 'signatories'];
const FIN_RULE_KEYS = ['numbering', 'taxes', 'capitalization', 'semiHighValue', 'residualRate', 'svpLimit', 'directAcquisitionLimit', 'depositDays', 'liquidationDays'];

// How each area is read, what its defaults are, and which route saves it.
//   get(data): its current value; defaults(): the built-in value (none: no "restore defaults");
//   save(value): [method, path, body] for ctx.invoke (none: changed only on its own screen);
//   portable(value): what an export carries (default: all of it);
//   watch: the routes whose changes are recorded in the history under this area.
const settingsPut = (key) => ({
  get: (d) => clone(d.settings[key]),
  defaults: () => clone(DEFAULT_SETTINGS[key]),
  save: (v) => ['PUT', '/api/admin/settings', { [key]: v }],
  watch: [['PUT', /^\/api\/admin\/settings$/]],
});
const DEFS = {
  school: {
    get: (d) => ({ schoolName: d.settings.schoolName, currentTermId: d.settings.currentTermId }),
    save: (v) => ['PUT', '/api/admin/settings', { schoolName: v.schoolName, ...(v.currentTermId !== undefined ? { currentTermId: v.currentTermId } : {}) }],
    portable: (v) => ({ schoolName: v.schoolName }), // terms are this school's own records
    watch: [['PUT', /^\/api\/admin\/settings$/]],
  },
  branding: settingsPut('branding'),
  enrollment: {
    get: (d) => pick(d.settings, ENROLLMENT_KEYS),
    defaults: () => pick(DEFAULT_SETTINGS, ENROLLMENT_KEYS),
    save: (v) => ['PUT', '/api/admin/settings', v],
    watch: [['PUT', /^\/api\/admin\/settings$/]],
  },
  security: settingsPut('security'),
  learn: settingsPut('learn'),
  numbering: settingsPut('numbering'),
  activityTypes: {
    get: (d) => d.activityTypes.map((t) => pick(t, ['id', 'name', 'weight', 'active'])),
    defaults: () => clone(DEFAULT_ACTIVITY_TYPES),
    save: (v) => ['PUT', '/api/admin/activity-types', { types: v }],
    watch: [['PUT', /^\/api\/admin\/activity-types$/]],
  },
  modules: {
    get: (d) => clone(d.modules),
    defaults: () => defaultModuleConfig(),
    save: (v) => ['PUT', '/api/admin/modules', { config: v }],
    watch: [['PUT', /^\/api\/admin\/modules$/]],
  },
  systems: {
    get: (d) => clone(d.settings.systems),
    defaults: () => defaultSystemSettings(),
    save: (v) => ['PUT', '/api/admin/systems', { settings: v }],
    watch: [['PUT', /^\/api\/admin\/systems$/]],
  },
  sso: { get: (d) => clone(d.settings.sso), watch: [['PUT', /^\/api\/admin\/sso$/]] }, // switching it on checks Keycloak: only on its screen
  roles: {
    get: (d) => clone(d.roleOverrides || {}),
    defaults: () => ({}),
    save: (v) => ['PUT', '/api/admin/roles', { overrides: v }],
    watch: [['PUT', /^\/api\/admin\/roles$/]],
  },
  academic: {
    get: (d) => pick(d.academicSettings, ACADEMIC_KEYS),
    defaults: () => pick(DEFAULT_ACADEMIC_SETTINGS, ACADEMIC_KEYS),
    save: (v) => ['PUT', '/api/academic/settings', v],
    watch: [['PUT', /^\/api\/academic\/settings$/]],
  },
  hr: {
    get: (d) => pick(d.hrSettings, HR_KEYS),
    defaults: () => pick(mergeHrSettings({}), HR_KEYS),
    save: (v) => ['PUT', '/api/hris/settings', v],
    watch: [['PUT', /^\/api\/hris\/settings$/]],
  },
  payroll: {
    get: (d) => pick(d.hrSettings, PAYROLL_KEYS),
    defaults: () => pick(mergeHrSettings({}), PAYROLL_KEYS),
    save: (v) => ['PUT', '/api/hris/payroll-config', v],
    watch: [['PUT', /^\/api\/hris\/payroll-config$/]],
  },
  leaveTypes: { get: (d) => clone(d.leaveTypes), watch: [['POST', /^\/api\/hris\/leave-types$/], ['PUT', /^\/api\/hris\/leave-types\/[^/]+$/], ['DELETE', /^\/api\/hris\/leave-types\/[^/]+$/]] },
  locations: { get: (d) => clone(d.hrSettings.locations || {}), watch: [['PUT', /^\/api\/hris\/location-settings$/]] },
  finance: {
    get: (d) => pick(d.finSettings, FINANCE_KEYS),
    save: (v) => ['PUT', '/api/finance/settings', { ...v, fiscalYear: v.fiscalYear ?? undefined }],
    watch: [['PUT', /^\/api\/finance\/settings$/]],
  },
  financeRules: {
    get: (d) => pick(d.finSettings, FIN_RULE_KEYS),
    defaults: () => pick(DEFAULT_FINANCE_SETTINGS, FIN_RULE_KEYS),
    save: (v) => ['PUT', '/api/finance/settings', v],
    watch: [['PUT', /^\/api\/finance\/settings$/]],
  },
};
const AREA_IDS = AREAS.map(([id]) => id);
const def = (id) => DEFS[id] || fail('Unknown group of settings.', 404);

// The data each settings area lives in (restored together if an import fails partway).
const SNAPSHOT_KEYS = ['settings', 'activityTypes', 'modules', 'roleOverrides', 'academicSettings', 'hrSettings', 'leaveTypes', 'finSettings'];

// What changed between two values of an area: [{ path, from, to }]. Objects are compared key by key;
// a list counts as one setting (its whole value before and after).
export function diffValues(a, b, path = '', out = []) {
  if (same(a, b) || out.length >= 80) return out;
  const plain = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (plain(a) && plain(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffValues(a[k], b[k], path ? `${path}.${k}` : k, out);
  } else {
    out.push({ path, from: a, to: b });
  }
  return out;
}

// Big values (a logo picture) are not kept in the history: it says what changed, without them.
const MAX_KEPT = 20000;
const keep = (v) => {
  const json = JSON.stringify(v ?? null);
  return json.length > MAX_KEPT ? { omitted: true, size: json.length } : v ?? null;
};

// Who may give each permission to which account types: Admin-panel permissions only to accounts
// that use the Admin panel; Academic's to its staff and teachers; People's and Finance's to any
// employee account. Students and parents get none.
const EMPLOYEE_ROLES = Object.keys(ROLES).filter((r) => r !== 'admin' && !['student', 'guardian'].includes(r));
export const PERMISSION_GROUPS = [
  { id: 'admin', label: 'Admin panel', permissions: PERMISSION_LABELS, roles: Object.keys(ROLES).filter((r) => r !== 'admin' && ROLES[r].side === 'admin') },
  { id: 'academic', label: 'ATLAS Academic', permissions: ACADEMIC_PERMISSION_LABELS, roles: ['registrar', 'dean', 'teacher'] },
  { id: 'people', label: 'ATLAS People', permissions: HRIS_PERMISSION_LABELS, roles: EMPLOYEE_ROLES },
  { id: 'finance', label: 'ATLAS Finance', permissions: FINANCE_PERMISSION_LABELS, roles: EMPLOYEE_ROLES },
];
const grantable = (role, permission) => !ADMIN_ONLY_PERMISSIONS.includes(permission) && PERMISSION_GROUPS.some((g) => g.roles.includes(role) && g.permissions.some(([p]) => p === permission));

// Overrides from the permissions an account type should have: { add, remove } against the built-in ones.
function overridesFor(role, wanted) {
  const base = ROLES[role].permissions;
  const want = new Set(wanted);
  for (const p of want) if (!base.includes(p) && !grantable(role, p)) fail(`${ROLES[role].label} accounts cannot be given "${p}".`);
  const add = [...want].filter((p) => !base.includes(p)).sort();
  const remove = base.filter((p) => !want.has(p)).sort();
  return add.length || remove.length ? { add, remove } : null;
}

export function registerConfigRoutes(route, ctx) {
  const { db } = ctx;
  const data = () => db.data;
  const save = () => db.save();
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
        id: randomUUID(), at: new Date().toISOString(), by: user?.name || 'System', byId: user?.id || null, via,
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
  // The request handler calls this around every request: settings routes are recorded.
  ctx.settingsWatch = (method, pathname) => {
    if (method === 'GET') return null;
    const ids = AREA_IDS.filter((id) => DEFS[id].watch?.some(([m, re]) => m === method && re.test(pathname)));
    if (!ids.length) return null;
    const before = snapshot(ids);
    return (user) => record(user, before, 'screen');
  };

  // Save an area through its own route, as `user` (their permissions apply), and record it.
  const apply = (user, id, value, via) => {
    const d = def(id);
    if (!d.save) fail(`${areaInfo(id).label} are changed on their own screen.`);
    const before = snapshot([id]);
    const [method, path, body] = d.save(value);
    ctx.invoke(user, method, path, body);
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

  // ----- The catalog: every setting with its value and default -----
  route('GET', '/api/admin/config', 'admin:settings.edit', () => {
    const d = data();
    const values = Object.fromEntries(AREA_IDS.map((id) => [id, DEFS[id].get(d)]));
    const defaults = Object.fromEntries(AREA_IDS.map((id) => [id, DEFS[id].defaults?.()]));
    const lastChange = {};
    for (const e of d.settingsLog) for (const c of e.changes) lastChange[`${e.area}|${c.path}`] = { at: e.at, by: e.by };
    const terms = Object.fromEntries(d.terms.map((t) => [t.id, t.name]));
    return {
      areas: AREAS.map(([id, module, label, screen]) => ({ id, module, label, screen, resettable: Boolean(DEFS[id].defaults && DEFS[id].save), importable: Boolean(DEFS[id].save) })),
      settings: SETTINGS.map(([area, path, label, help, format]) => {
        const value = getPath(values[area], path);
        const hasDefault = Boolean(DEFS[area].defaults);
        const dflt = hasDefault ? getPath(defaults[area], path) : undefined;
        const changedAt = Object.entries(lastChange).filter(([k]) => k.startsWith(`${area}|`) && (k === `${area}|${path}` || k.startsWith(`${area}|${path}${path ? '.' : ''}`))).map(([, v]) => v).sort((a, b) => b.at.localeCompare(a.at))[0];
        return {
          area, path, label, help, format: format || null,
          value: keep(value), default: hasDefault ? keep(dflt) : null, hasDefault,
          changed: hasDefault && !same(value ?? null, dflt ?? null),
          resettable: hasDefault && Boolean(DEFS[area].save),
          lastChange: changedAt || null,
          display: format === 'term' ? terms[value] || '' : undefined,
        };
      }),
    };
  });

  // Restore defaults: a whole area, or one setting in it.
  route('POST', '/api/admin/config/reset', 'admin:settings.edit', ({ user, body }) => {
    const id = String(body.area || '');
    const d = def(id);
    if (!d.defaults || !d.save) fail(`${areaInfo(id).label} have no built-in defaults to go back to.`);
    const path = String(body.path || '');
    const value = path ? setPath(d.get(data()), path, getPath(d.defaults(), path)) : d.defaults();
    const entries = atomic(() => apply(user, id, value, path ? 'reset' : 'reset-all'));
    return { ok: true, changes: entries.reduce((n, e) => n + e.changes.length, 0) };
  });

  // ----- History -----
  route('GET', '/api/admin/config/history', 'admin:settings.edit', ({ query }) => {
    const q = String(query.q || '').trim().toLowerCase();
    let list = data().settingsLog;
    if (query.module) list = list.filter((e) => e.module === query.module);
    if (query.area) list = list.filter((e) => e.area === query.area);
    if (query.path) list = list.filter((e) => e.changes.some((c) => c.path === query.path || c.path.startsWith(`${query.path}.`)));
    if (q) list = list.filter((e) => `${e.by} ${e.areaLabel} ${e.changes.map((c) => c.label).join(' ')}`.toLowerCase().includes(q));
    const out = list.slice(-500).reverse();
    return { entries: out.map((e) => ({ ...e, undoable: Boolean(DEFS[e.area]?.save) && e.via !== 'undo' && e.changes.every((c) => !c.from?.omitted && !c.to?.omitted) })), total: list.length };
  });
  // Undo a change: put back the values it replaced (if nothing has changed them since).
  route('POST', '/api/admin/config/history/:id/undo', 'admin:settings.edit', ({ user, params }) => {
    const e = data().settingsLog.find((x) => x.id === params.id) || fail('Change not found.', 404);
    const d = def(e.area);
    if (!d.save) fail(`${e.areaLabel} are changed on their own screen.`);
    if (e.changes.some((c) => c.from?.omitted || c.to?.omitted)) fail('This change included a picture, which the history does not keep. Change it on its screen.');
    let value = d.get(data());
    for (const c of e.changes) {
      if (!same(getPath(value, c.path) ?? null, c.to ?? null)) fail(`${c.label} has been changed again since. Change it on its screen, or undo the later change first.`);
      value = setPath(value, c.path, c.from);
    }
    const entries = atomic(() => apply(user, e.area, value, 'undo'));
    return { ok: true, entries };
  });

  // ----- Export and import -----
  const exportable = () => AREA_IDS.filter((id) => DEFS[id].save);
  route('GET', '/api/admin/config/export', 'admin:settings.edit', ({ user }) => ({
    atlasSettings: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: user.name,
    school: data().settings.schoolName,
    areas: Object.fromEntries(exportable().map((id) => [id, (DEFS[id].portable || ((v) => v))(DEFS[id].get(data()))])),
  }));
  // An imported group keeps what the file leaves out (e.g. this school's current term).
  const merge = (current, value) => (value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object' && !Array.isArray(current) ? { ...current, ...value } : value);
  const readFile = (file) => {
    if (!file || file.atlasSettings !== 1 || typeof file.areas !== 'object') fail('This is not an ATLAS settings file (Settings center → Export settings).');
    return Object.entries(file.areas).filter(([id]) => exportable().includes(id));
  };
  // What importing would change, area by area (nothing is saved).
  route('POST', '/api/admin/config/import/preview', 'admin:settings.edit', ({ body }) => {
    const areas = readFile(body.file).map(([id, value]) => {
      const current = DEFS[id].get(data());
      const changes = diffValues(current, merge(current, value)).map((c) => ({ path: c.path, label: labelOf(id, c.path), from: keep(c.from), to: keep(c.to) }));
      return { id, ...areaInfo(id), changes };
    });
    return { school: body.file.school || '', exportedAt: body.file.exportedAt || null, exportedBy: body.file.exportedBy || '', areas };
  });
  route('POST', '/api/admin/config/import', 'admin:settings.edit', ({ user, body }) => {
    const wanted = new Set(Array.isArray(body.areas) ? body.areas : []);
    const list = readFile(body.file).filter(([id]) => wanted.has(id));
    if (!list.length) fail('Pick at least one group of settings to import.');
    const entries = atomic(() => list.flatMap(([id, value]) => {
      try {
        return apply(user, id, merge(DEFS[id].get(data()), value), 'import');
      } catch (err) {
        throw new HttpError(err.status || 400, `${areaInfo(id).label}: ${err.message} Nothing was imported.`);
      }
    }));
    return { ok: true, areas: list.length, changes: entries.reduce((n, e) => n + e.changes.length, 0) };
  });

  // ----- Roles and permissions -----
  const rolesView = () => ({
    roles: Object.entries(ROLES).map(([id, r]) => ({
      id, label: r.label, side: r.side, description: r.description, fixed: id === 'admin',
      builtIn: r.permissions, permissions: permissionsOf(id), changed: Boolean(data().roleOverrides?.[id]),
      accounts: data().users.filter((u) => u.role === id && u.status === 'active').length,
    })),
    groups: PERMISSION_GROUPS.map((g) => ({ id: g.id, label: g.label, roles: g.roles, permissions: g.permissions.map(([p, l]) => ({ id: p, label: l, adminOnly: ADMIN_ONLY_PERMISSIONS.includes(p) })) })),
  });
  // Only administrators: what account types may do is theirs to decide.
  const onlyAdmin = (user) => user.role === 'admin' || fail('Only administrators change roles and permissions.', 403);
  route('GET', '/api/admin/roles', 'admin', ({ user }) => {
    onlyAdmin(user);
    return rolesView();
  });
  // overrides: the whole map ({ role: { add, remove } }), or permissions: { role: [permission…] } for some roles.
  route('PUT', '/api/admin/roles', 'admin', ({ user, body }) => {
    onlyAdmin(user);
    const next = { ...(data().roleOverrides || {}) };
    const wanted = body.permissions && typeof body.permissions === 'object' ? body.permissions
      : body.overrides && typeof body.overrides === 'object'
        ? Object.fromEntries(Object.keys(ROLES).filter((r) => r !== 'admin').map((r) => {
          const o = body.overrides[r] || {};
          return [r, [...new Set([...ROLES[r].permissions.filter((p) => !(o.remove || []).includes(p)), ...(o.add || [])])]];
        }))
        : fail('Send the permissions for each account type.');
    for (const [role, list] of Object.entries(wanted)) {
      if (!ROLES[role]) fail(`Unknown account type ${role}.`);
      if (role === 'admin') fail('Administrators always have every permission.');
      if (!Array.isArray(list)) fail('Send a list of permissions.');
      const o = overridesFor(role, list.map(String));
      if (o) next[role] = o;
      else delete next[role];
    }
    data().roleOverrides = next;
    setRoleOverrides(next);
    save();
    return rolesView();
  });

  return { diffValues };
}
