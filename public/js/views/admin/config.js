// Admin panel → Settings center: every module's settings in one searchable list, compared with
// their defaults; the change history (who changed what, from what to what) with undo; and export /
// import of the company's settings. Each setting is still changed on its own screen ("Open"); here
// an administrator finds it, sees what differs, and can restore a default.
// Ported from Lancaster ATLAS (lms/public/js/admin/views/config.js).
import { api } from '../../api.js';
import { ctx } from '../../state.js';
import { html, mount, toast, confirmDialog, downloadFile, today, badge, raw } from '../../ui.js';
import { icon } from '../../icons.js';
import { MODULES } from '/shared/settings-catalog.js';
import { ROLES } from '/shared/roles.js';
import { pageHead, fmtDateTime, timeAgo } from './common.js';

const MODULE_LABEL = Object.fromEntries(MODULES);
const VIA = { screen: '', reset: 'Restored the default', 'reset-all': 'Restored the defaults', undo: 'Undone', import: 'Imported', restore: 'Backup restored', erase: 'All data erased' };
const APPROVER = { supervisor: 'immediate supervisor', manager: "supervisor's supervisor", hr: 'HR', users: 'specific people' };

// A setting's value, in words.
export function showValue(v, format) {
  if (v && typeof v === 'object' && v.omitted) return 'A picture (not kept in the history)';
  if (v === null || v === undefined || v === '') return '—';
  switch (format) {
    case 'bool': return v ? 'On' : 'Off';
    case 'percent': return `${Math.round(Number(v) * 10000) / 100}%`;
    case 'minutes': return `${v} minutes${v >= 120 ? ` (${Math.round((v / 60) * 10) / 10} hours)` : ''}`;
    case 'picture': return v ? 'A picture' : 'None';
    case 'schedule': {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const w = [...(v.workDays || [])].sort();
      const run = w.length > 2 && w.every((d, i) => !i || d === w[i - 1] + 1) ? `${days[w[0]]}–${days[w.at(-1)]}` : w.map((d) => days[d]).join(', ');
      return `${v.shiftStart}–${v.shiftEnd}, ${v.breakMinutes}-minute break, ${run}`;
    }
    case 'levels': return Array.isArray(v) ? v.map((l, i) => `${i + 1}. ${APPROVER[l.type] || l.type}${l.userIds ? ` (${l.userIds.length})` : ''}`).join(', ') : String(v);
    case 'stages': return Array.isArray(v) ? v.map((st) => `${st.name} ${st.probability}%`).join(', ') : String(v);
    case 'roles': {
      const entries = Object.entries(v || {});
      return entries.length ? entries.map(([r, o]) => `${ROLES[r]?.label || r}: ${[...(o.add || []).map((p) => `+${p}`), ...(o.remove || []).map((p) => `−${p}`)].join(' ')}`).join('; ') : 'None: every account type as built in';
    }
    default:
      if (Array.isArray(v)) {
        const names = v.map((x) => (typeof x === 'object' && x ? x.name || x.code || x.id : x)).filter(Boolean);
        return v.length ? `${v.length}: ${names.slice(0, 8).join(', ')}${names.length > 8 ? '…' : ''}` : 'None';
      }
      if (typeof v === 'object') {
        const s = Object.entries(v).map(([k, x]) => `${k}: ${typeof x === 'object' ? JSON.stringify(x) : typeof x === 'boolean' ? (x ? 'on' : 'off') : x}`).join('; ');
        return s.length > 140 ? `${s.slice(0, 140)}…` : s || '—';
      }
      if (typeof v === 'boolean') return v ? 'On' : 'Off';
      return String(v);
  }
}

export async function configView(el, params, q = {}) {
  const tab = ['history', 'transfer'].includes(q.tab) ? q.tab : 'settings';
  const cfg = await api.get('/api/admin/config');
  const head = html`${pageHead('Settings center', 'Every setting in CORE in one place: find one, see what differs from the default, restore a default, see who changed what and undo it, and copy the settings to another CORE.')}
    <nav class="tabs" aria-label="Settings center">
      <a href="#/admin/config" class="${tab === 'settings' ? 'active' : ''}" ${tab === 'settings' ? 'aria-current="page"' : ''}>${icon('search', 16)} All settings <span class="count">${cfg.settings.length}</span></a>
      <a href="#/admin/config?tab=history" class="${tab === 'history' ? 'active' : ''}" ${tab === 'history' ? 'aria-current="page"' : ''}>${icon('clock', 16)} Change history</a>
      <a href="#/admin/config?tab=transfer" class="${tab === 'transfer' ? 'active' : ''}" ${tab === 'transfer' ? 'aria-current="page"' : ''}>${icon('download', 16)} Export & import</a>
    </nav>`;
  if (tab === 'history') return historyTab(el, head, cfg, q);
  if (tab === 'transfer') return transferTab(el, head, cfg);
  return settingsTab(el, head, cfg, q);
}

function settingsTab(el, head, cfg, q) {
  const state = { q: q.q || '', module: q.module || '', changed: q.changed === '1' };
  const areaOf = Object.fromEntries(cfg.areas.map((a) => [a.id, a]));
  const modules = MODULES.filter(([k]) => cfg.areas.some((a) => a.module === k));
  const open = new Set(); // groups opened (kept while filtering redraws the list)
  mount(el, html`${head}
    <div class="toolbar config-toolbar">
      <input type="search" id="cfg-q" placeholder="Find a setting, e.g. password, radius, SLA" value="${state.q}" aria-label="Find a setting" />
      <div class="chips" role="group" aria-label="Module">${[['', 'All'], ...modules].map(([k, l]) => html`<button type="button" class="chip ${state.module === k ? 'on' : ''}" data-module="${k}" aria-pressed="${state.module === k}">${l}</button>`)}</div>
      <label class="check-inline"><input type="checkbox" id="cfg-changed" ${state.changed ? 'checked' : ''} /> Only changed from the default</label>
    </div>
    <p class="muted small" id="cfg-count" aria-live="polite"></p>
    <div id="cfg-list" class="stack"></div>`);

  const draw = () => {
    const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = cfg.settings.filter((s) => {
      const a = areaOf[s.area];
      if (state.module && a.module !== state.module) return false;
      if (state.changed && !s.changed) return false;
      const hay = `${s.label} ${s.help} ${a.label} ${MODULE_LABEL[a.module]} ${showValue(s.value, s.format)} ${s.path}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const changedCount = cfg.settings.filter((s) => s.changed).length;
    el.querySelector('#cfg-count').textContent = `${rows.length} of ${cfg.settings.length} settings · ${changedCount} changed from the default${words.length || state.changed || state.module ? '' : ' · open a group to see its settings'}`;
    const order = MODULES.map(([k]) => k);
    const groups = cfg.areas.map((a) => ({ a, rows: rows.filter((s) => s.area === a.id) })).filter((g) => g.rows.length)
      .sort((x, y) => order.indexOf(x.a.module) - order.indexOf(y.a.module));
    const filtering = Boolean(words.length || state.changed || state.module);
    mount(el.querySelector('#cfg-list'), groups.length ? html`${groups.map(({ a, rows: list }, i) => html`
      ${i === 0 || groups[i - 1].a.module !== a.module ? html`<h2 class="module-head">${MODULE_LABEL[a.module]}</h2>` : ''}
      <div class="config-area-wrap">
      <div class="area-actions">${a.resettable && list.some((s) => s.changed) ? html`<button type="button" class="btn sm ghost" data-reset-area="${a.id}">Restore defaults</button>` : ''}
        <a class="btn sm" href="${a.screen}" aria-label="Open ${a.label}">${icon('external', 14)} Open</a></div>
      <details class="card config-area" data-area="${a.id}" ${filtering || open.has(a.id) ? 'open' : ''}>
        <summary><h3>${a.label}</h3>
          <span class="area-meta">${list.length} setting${list.length === 1 ? '' : 's'}${list.some((s) => s.changed) ? html` · ${badge(`${list.filter((s) => s.changed).length} changed`, 'amber')}` : ''}${a.importable ? '' : ' · changed on its screen only'}</span></summary>
        <div class="table-scroll"><table class="table config-table">
          <thead><tr><th>Setting</th><th>Now</th><th>Default</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>${list.map((s) => html`<tr class="${s.changed ? 'is-changed' : ''}">
            <td><strong>${s.label}</strong>${s.changed ? html` ${badge('Differs from default', 'amber')}` : ''}${s.help ? html`<small class="muted block">${s.help}</small>` : ''}
              ${s.lastChange ? html`<small class="muted block">Last changed by ${s.lastChange.by}, ${timeAgo(s.lastChange.at)}</small>` : ''}</td>
            <td class="config-value">${showValue(s.value, s.format)}</td>
            <td class="config-value muted">${s.hasDefault ? showValue(s.default, s.format) : html`<span title="This is the company's own information">The company's own</span>`}</td>
            <td class="row-actions">${s.changed && s.resettable ? html`<button type="button" class="btn sm" data-reset="${s.area}" data-path="${s.path}" data-label="${s.label}">Restore default</button>` : ''}
              <a class="btn sm ghost" href="#/admin/config?tab=history&area=${s.area}${s.path ? `&path=${encodeURIComponent(s.path)}` : ''}" aria-label="History of ${s.label}" title="History">${icon('clock', 14)}</a></td>
          </tr>`)}</tbody></table></div>
      </details></div>`)}` : html`<div class="card empty">${icon('search', 32)}<p>No setting matches. Try other words, or show every module.</p></div>`);
  };
  draw();

  const keepUrl = () => history.replaceState(null, '', `#/admin/config?${new URLSearchParams({ ...(state.q ? { q: state.q } : {}), ...(state.module ? { module: state.module } : {}), ...(state.changed ? { changed: '1' } : {}) })}`);
  el.querySelector('#cfg-q').addEventListener('input', (e) => {
    state.q = e.target.value;
    keepUrl();
    draw();
  });
  el.querySelector('#cfg-list').addEventListener('toggle', (e) => {
    const id = e.target.dataset?.area;
    if (id) open[e.target.open ? 'add' : 'delete'](id);
  }, true);
  el.querySelector('#cfg-changed').addEventListener('change', (e) => {
    state.changed = e.target.checked;
    keepUrl();
    draw();
  });
  el.onclick = async (e) => {
    const chip = e.target.closest('[data-module]');
    if (chip) {
      state.module = chip.dataset.module;
      el.querySelectorAll('[data-module]').forEach((c) => {
        c.classList.toggle('on', c === chip);
        c.setAttribute('aria-pressed', String(c === chip));
      });
      keepUrl();
      return draw();
    }
    const one = e.target.closest('[data-reset]');
    const all = e.target.closest('[data-reset-area]');
    if (!one && !all) return;
    const area = one ? one.dataset.reset : all.dataset.resetArea;
    const label = one ? one.dataset.label : cfg.areas.find((a) => a.id === area).label;
    if (!(await confirmDialog(`${one ? `Put "${label}" back to its default?` : `Put every setting in "${label}" back to its default?`} The change is recorded in the history, where it can be undone.`, { confirmLabel: 'Restore', danger: false, title: 'Restore default' }))) return;
    try {
      await api.post('/api/admin/config/reset', { area, path: one ? one.dataset.path : '' });
      toast(one ? `${label}: default restored.` : `${label}: defaults restored.`);
      await afterChange(area);
      const fresh = await api.get('/api/admin/config');
      cfg.settings = fresh.settings;
      draw();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

// A change made here may change what this browser shows (branding, modules, roles).
async function afterChange(area) {
  if (['branding', 'company', 'modules', 'roles'].includes(area) || !area) {
    await Promise.all([ctx.refreshStatus(), ctx.refreshSettings()]).catch(() => {});
    window.dispatchEvent(new Event('modules:changed'));
  }
}

async function historyTab(el, head, cfg, q) {
  const qs = new URLSearchParams(Object.entries({ module: q.module, area: q.area, path: q.path, q: q.q }).filter(([, v]) => v));
  const h = await api.get(`/api/admin/config/history?${qs}`);
  const fmt = Object.fromEntries(cfg.settings.map((s) => [`${s.area}|${s.path}`, s.format]));
  const formatOf = (area, path) => fmt[`${area}|${path}`] ?? null;
  const areaLabel = q.area ? cfg.areas.find((a) => a.id === q.area)?.label : '';
  const settingLabel = q.path ? cfg.settings.find((s) => s.area === q.area && s.path === q.path)?.label : '';
  const modules = MODULES.filter(([k]) => cfg.areas.some((a) => a.module === k));
  mount(el, html`${head}
    <form class="toolbar" id="h-filter">
      <select name="module" aria-label="Module">${[['', 'Every module'], ...modules].map(([k, l]) => html`<option value="${k}" ${q.module === k ? 'selected' : ''}>${l}</option>`)}</select>
      <input type="search" name="q" value="${q.q || ''}" placeholder="Who, or which setting" aria-label="Search the history" />
      <button class="btn">Filter</button>
      ${q.area ? html`<span class="badge brand">${settingLabel || areaLabel} <a href="#/admin/config?tab=history" aria-label="Show every change">${icon('x', 12)}</a></span>` : ''}
    </form>
    ${h.entries.length ? html`<div class="stack">${h.entries.map((e) => html`<article class="card history-entry">
      <div class="history-head"><div><strong>${e.areaLabel}</strong> ${badge(MODULE_LABEL[e.module], 'gray')} ${VIA[e.via] ? badge(VIA[e.via], e.via === 'undo' ? 'amber' : 'blue') : ''}
        <small class="muted block">${e.by} · <time datetime="${e.at}" title="${fmtDateTime(e.at)}">${timeAgo(e.at)}</time></small></div>
        ${e.undoable ? html`<button type="button" class="btn sm" data-undo="${e.id}" data-area="${e.area}">Undo</button>` : ''}</div>
      <ul class="change-list">${e.changes.map((c) => html`<li><span class="change-label">${c.label}</span>
        <span class="change-from" title="Before">${showValue(c.from, formatOf(e.area, c.path))}</span> ${raw('<span aria-hidden="true">→</span><span class="sr-only">changed to</span>')}
        <span class="change-to" title="After">${showValue(c.to, formatOf(e.area, c.path))}</span></li>`)}</ul>
    </article>`)}</div>
    ${h.total > h.entries.length ? html`<p class="muted small">Showing the latest ${h.entries.length} of ${h.total} changes.</p>` : ''}`
    : html`<div class="card empty">${icon('clock', 32)}<p>No changes recorded${q.area || q.module || q.q ? ' that match' : ' yet'}. Every save on a settings screen in any module is recorded here, with the value before and after.</p></div>`}`);
  el.querySelector('#h-filter').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const v = new FormData(ev.target);
    location.hash = `#/admin/config?${new URLSearchParams({ tab: 'history', ...(v.get('module') ? { module: v.get('module') } : {}), ...(v.get('q') ? { q: v.get('q') } : {}) })}`;
  });
  el.onclick = async (ev) => {
    const b = ev.target.closest('[data-undo]');
    if (!b || !(await confirmDialog('Undo this change? The settings go back to the values before it.', { confirmLabel: 'Undo', danger: false, title: 'Undo a change' }))) return;
    try {
      await api.post(`/api/admin/config/history/${b.dataset.undo}/undo`);
      toast('Change undone.');
      await afterChange(b.dataset.area);
      configView(el, {}, q);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

function transferTab(el, head, cfg) {
  mount(el, html`${head}
    <div class="cols">
      <section class="card"><h2>${icon('download')} Export settings</h2>
        <p>Downloads the company's settings as a file: company details, the default schedule, branding, sign-in & security, modules, roles and permissions, clock-in locations, approvals, the service desk's ticket settings and public form, the sales setup and the Projects setup. No people, records, passwords or mail server sign-ins are in it.</p>
        <p class="muted small">Keep a copy before big changes, or set up another CORE (a test server) the same way. Leave types, Payroll Setup and the service desk's email settings stay on their screens. You export only the groups your account may change.</p>
        <div class="actions"><button type="button" class="btn primary" id="export">${icon('download', 16)} Export settings</button></div>
      </section>
      <section class="card"><h2>${icon('upload')} Import settings</h2>
        <p>Pick a settings file exported from CORE. You see every change first, choose which groups to import, and nothing is saved until you import. Each group is checked by its own screen's rules; if one group is refused, nothing is imported.</p>
        <label class="btn">${icon('upload', 16)} Choose a settings file…<input type="file" id="import-file" accept="application/json,.json" hidden /></label>
      </section>
    </div>
    <div id="preview"></div>`);
  el.querySelector('#export').addEventListener('click', async () => {
    const file = await api.get('/api/admin/config/export');
    downloadFile(`core-settings-${today()}.json`, JSON.stringify(file, null, 2), 'application/json');
    toast('Settings exported.');
  });
  el.querySelector('#import-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    let file;
    try {
      if (f.size > 2 * 1024 * 1024) throw new Error('That file is too large to be a CORE settings file.');
      file = JSON.parse(await f.text());
      const p = await api.post('/api/admin/config/import/preview', { file });
      const fmt = Object.fromEntries(cfg.settings.map((s) => [`${s.area}|${s.path}`, s.format]));
      const withChanges = p.areas.filter((a) => a.changes.length);
      mount(el.querySelector('#preview'), html`<section class="card" style="margin-top:16px">
        <div class="card-head"><h2>What importing would change</h2></div>
        <p class="muted small">From ${p.company || 'another CORE'}${p.exportedBy ? `, exported by ${p.exportedBy}` : ''}${p.exportedAt ? ` on ${fmtDateTime(p.exportedAt)}` : ''}${p.version ? ` (CORE ${p.version})` : ''}. ${p.areas.length - withChanges.length ? `${p.areas.length - withChanges.length} group${p.areas.length - withChanges.length === 1 ? ' is' : 's are'} already the same here.` : ''}${p.skipped?.length ? ` Left out (your account cannot change them, or this CORE does not have them): ${p.skipped.join(', ')}.` : ''}</p>
        ${withChanges.length ? html`<form id="import-form" class="stack">${withChanges.map((a) => html`<fieldset class="import-area"><legend><label class="check-inline"><input type="checkbox" name="area" value="${a.id}" checked /> <strong>${a.label}</strong> ${badge(MODULE_LABEL[a.module], 'gray')} <span class="muted">${a.changes.length} change${a.changes.length === 1 ? '' : 's'}</span></label></legend>
            <ul class="change-list">${a.changes.slice(0, 12).map((c) => html`<li><span class="change-label">${c.label}</span> <span class="change-from">${showValue(c.from, fmt[`${a.id}|${c.path}`])}</span> → <span class="change-to">${showValue(c.to, fmt[`${a.id}|${c.path}`])}</span></li>`)}${a.changes.length > 12 ? html`<li class="muted">and ${a.changes.length - 12} more</li>` : ''}</ul></fieldset>`)}
          <div class="actions end"><button type="button" class="btn ghost" id="cancel-import">Cancel</button><button class="btn primary">Import the ticked groups</button></div></form>`
          : html`<p>Everything in this file is already the same here. Nothing to import.</p>`}
      </section>`);
      el.querySelector('#cancel-import')?.addEventListener('click', () => mount(el.querySelector('#preview'), ''));
      el.querySelector('#import-form')?.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const areas = new FormData(ev.target).getAll('area');
        if (!areas.length) return toast('Tick at least one group.', 'error');
        try {
          const r = await api.post('/api/admin/config/import', { file, areas });
          toast(`Imported ${r.changes} change${r.changes === 1 ? '' : 's'} in ${r.areas} group${r.areas === 1 ? '' : 's'}.`);
          await afterChange();
          location.hash = '#/admin/config?tab=history';
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    } catch (err) {
      toast(err instanceof SyntaxError ? 'That file is not a CORE settings file.' : err.message, 'error');
    }
  });
}
