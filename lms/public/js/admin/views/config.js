// Settings center: every module's settings in one searchable list, compared with their defaults;
// the change history (who changed what, from what to what) with undo; and export / import of the
// school's settings. Each setting is still changed on its own screen ("Open"); here an
// administrator finds it, sees what differs, and can restore a default.
import { api } from '../../api.js';
import { html, mount, toast, confirmDialog, downloadFile, today, timeAgo, fmtDateTime, badge, raw } from '../../ui.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { MODULES } from '/shared/settings-catalog.js';

const MODULE_LABEL = Object.fromEntries(MODULES);
const VIA = { screen: '', reset: 'Restored the default', 'reset-all': 'Restored the defaults', undo: 'Undone', import: 'Imported' };
const peso = (n) => `₱${Number(n).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;

// A setting's value, in words.
export function showValue(v, format, display) {
  if (v && typeof v === 'object' && v.omitted) return 'A picture (not kept in the history)';
  if (display) return display;
  if (v === null || v === undefined || v === '') return '—';
  switch (format) {
    case 'bool': return v ? 'On' : 'Off';
    case 'percent': return `${Math.round(Number(v) * 10000) / 100}%`;
    case 'money': return peso(v);
    case 'grade': return Number(v).toFixed(2);
    case 'picture': return v ? 'A picture' : 'None';
    case 'schedule': {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const w = [...(v.workDays || [])].sort();
      const run = w.length > 2 && w.every((d, i) => !i || d === w[i - 1] + 1) ? `${days[w[0]]}–${days[w.at(-1)]}` : w.map((d) => days[d]).join(', ');
      return `${v.shiftStart}–${v.shiftEnd}, ${v.breakMinutes}-minute break, ${run}`;
    }
    case 'scale': return `${v.length} bands: ${[...v].sort((a, b) => b.min - a.min).map((b) => `${b.min}%→${Number(b.grade).toFixed(2)}`).join(', ')}`;
    case 'types': return v.map((t) => `${t.name} ${t.weight}%${t.active === false ? ' (off)' : ''}`).join(', ');
    case 'modules': {
      const off = Object.entries(v).flatMap(([m, r]) => Object.entries(r).filter(([, on]) => !on).map(([who]) => `${m} for ${who}s`));
      return off.length ? `Off: ${off.join(', ')}` : 'All on';
    }
    default:
      if (Array.isArray(v)) {
        const names = v.map((x) => (typeof x === 'object' && x ? x.code || x.atc || x.name || x.id : x)).filter(Boolean);
        return v.length ? `${v.length}: ${names.slice(0, 8).join(', ')}${names.length > 8 ? '…' : ''}` : 'None';
      }
      if (typeof v === 'object') {
        const s = Object.entries(v).map(([k, x]) => `${k}: ${typeof x === 'object' ? JSON.stringify(x) : x}`).join('; ');
        return s.length > 140 ? `${s.slice(0, 140)}…` : s || '—';
      }
      if (typeof v === 'boolean') return v ? 'On' : 'Off';
      return String(v);
  }
}

export async function configView(el, params, q = {}) {
  const tab = ['history', 'transfer'].includes(q.tab) ? q.tab : 'settings';
  const cfg = await api.get('/api/admin/config');
  const head = html`${pageHead('Settings center', 'Every setting in ATLAS in one place: find one, see what differs from the defaults, restore a default, and see who changed what.')}
    <nav class="tabs" aria-label="Settings center">
      <a href="#/config" class="${tab === 'settings' ? 'active' : ''}">${icon('search', 16)} All settings <span class="count">${cfg.settings.length}</span></a>
      <a href="#/config?tab=history" class="${tab === 'history' ? 'active' : ''}">${icon('clock', 16)} Change history</a>
      <a href="#/config?tab=transfer" class="${tab === 'transfer' ? 'active' : ''}">${icon('download', 16)} Export & import</a>
    </nav>`;
  if (tab === 'history') return historyTab(el, head, cfg, q);
  if (tab === 'transfer') return transferTab(el, head, cfg);
  return settingsTab(el, head, cfg, q);
}

function settingsTab(el, head, cfg, q) {
  const state = { q: q.q || '', module: q.module || '', changed: q.changed === '1' };
  const areaOf = Object.fromEntries(cfg.areas.map((a) => [a.id, a]));
  const open = new Set(); // groups the administrator opened (kept while filtering redraws the list)
  mount(el, html`${head}
    <div class="toolbar config-toolbar">
      <input type="search" id="cfg-q" placeholder="Find a setting, e.g. password, PERA, waitlist" value="${state.q}" aria-label="Find a setting" />
      <div class="chips" role="group" aria-label="Module">${[['', 'All'], ...MODULES].map(([k, l]) => html`<button type="button" class="chip ${state.module === k ? 'on' : ''}" data-module="${k}" aria-pressed="${state.module === k}">${l}</button>`)}</div>
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
      const hay = `${s.label} ${s.help} ${a.label} ${MODULE_LABEL[a.module]} ${showValue(s.value, s.format, s.display)} ${s.path}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const changedCount = cfg.settings.filter((s) => s.changed).length;
    el.querySelector('#cfg-count').textContent = `${rows.length} of ${cfg.settings.length} settings · ${changedCount} changed from the default${words.length || state.changed || state.module ? '' : ' · open a group to see its settings'}`;
    const order = MODULES.map(([k]) => k);
    const groups = cfg.areas.map((a) => ({ a, rows: rows.filter((s) => s.area === a.id) })).filter((g) => g.rows.length)
      .sort((x, y) => order.indexOf(x.a.module) - order.indexOf(y.a.module)); // by module, keeping each module's order
    // Groups open when searching or filtering, or when something in them was changed; else just their heading.
    const filtering = Boolean(words.length || state.changed || state.module);
    mount(el.querySelector('#cfg-list'), groups.length ? html`${groups.map(({ a, rows: list }, i) => html`
      ${i === 0 || groups[i - 1].a.module !== a.module ? html`<h2 class="module-head">${MODULE_LABEL[a.module]}</h2>` : ''}
      <div class="config-area-wrap">
      <div class="area-actions">${a.resettable && list.some((s) => s.changed) ? html`<button type="button" class="btn sm ghost" data-reset-area="${a.id}">Restore defaults</button>` : ''}
        <a class="btn sm" href="${a.screen}" aria-label="Open ${a.label}">${icon('external', 14)} Open</a></div>
      <details class="card config-area" data-area="${a.id}" ${filtering || open.has(a.id) ? 'open' : ''}>
        <summary><h3>${a.label}</h3>
          <span class="area-meta">${list.length} setting${list.length === 1 ? '' : 's'}${list.some((s) => s.changed) ? html` · ${badge(`${list.filter((s) => s.changed).length} changed`, 'amber')}` : ''}</span></summary>
        <div class="table-scroll"><table class="table config-table">
          <thead><tr><th>Setting</th><th>Now</th><th>Default</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>${list.map((s) => html`<tr class="${s.changed ? 'is-changed' : ''}">
            <td data-label="Setting"><strong>${s.label}</strong>${s.changed ? html` ${badge('Changed', 'amber')}` : ''}${s.help ? html`<small class="muted block">${s.help}</small>` : ''}
              ${s.lastChange ? html`<small class="muted block">Last changed by ${s.lastChange.by}, ${timeAgo(s.lastChange.at)}</small>` : ''}</td>
            <td data-label="Now" class="config-value">${showValue(s.value, s.format, s.display)}</td>
            <td data-label="Default" class="config-value muted">${s.hasDefault ? showValue(s.default, s.format) : html`<span title="This is the school's own information">The school's own</span>`}</td>
            <td class="row-actions">${s.changed && s.resettable ? html`<button class="btn sm" data-reset="${s.area}" data-path="${s.path}" data-label="${s.label}">Restore default</button>` : ''}
              <a class="btn sm ghost" href="#/config?tab=history&area=${s.area}${s.path ? `&path=${encodeURIComponent(s.path)}` : ''}" aria-label="History of ${s.label}">${icon('clock', 14)}</a></td>
          </tr>`)}</tbody></table></div>
      </details></div>`)}` : html`<div class="card empty">${icon('search', 32)}<p>No setting matches. Try other words, or show every module.</p></div>`);
  };
  draw();

  const keepUrl = () => history.replaceState(null, '', `#/config?${new URLSearchParams({ ...(state.q ? { q: state.q } : {}), ...(state.module ? { module: state.module } : {}), ...(state.changed ? { changed: '1' } : {}) })}`);
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
      const fresh = await api.get('/api/admin/config');
      cfg.settings = fresh.settings;
      draw();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

async function historyTab(el, head, cfg, q) {
  const qs = new URLSearchParams(Object.entries({ module: q.module, area: q.area, path: q.path, q: q.q }).filter(([, v]) => v));
  const h = await api.get(`/api/admin/config/history?${qs}`);
  const fmt = Object.fromEntries(cfg.settings.map((s) => [`${s.area}|${s.path}`, s.format]));
  const formatOf = (area, path) => fmt[`${area}|${path}`] ?? null;
  const areaLabel = q.area ? cfg.areas.find((a) => a.id === q.area)?.label : '';
  const settingLabel = q.path ? cfg.settings.find((s) => s.area === q.area && s.path === q.path)?.label : '';
  mount(el, html`${head}
    <form class="toolbar" id="h-filter">
      <select name="module" aria-label="Module">${[['', 'Every module'], ...MODULES].map(([k, l]) => html`<option value="${k}" ${q.module === k ? 'selected' : ''}>${l}</option>`)}</select>
      <input type="search" name="q" value="${q.q || ''}" placeholder="Who, or which setting" aria-label="Search the history" />
      <button class="btn">Filter</button>
      ${q.area ? html`<span class="badge brand">${settingLabel || areaLabel} <a href="#/config?tab=history" aria-label="Show every change">${icon('x', 12)}</a></span>` : ''}
    </form>
    ${h.entries.length ? html`<div class="stack">${h.entries.map((e) => html`<article class="card history-entry">
      <div class="history-head"><div><strong>${e.areaLabel}</strong> ${badge(MODULE_LABEL[e.module], 'gray')} ${VIA[e.via] ? badge(VIA[e.via], e.via === 'undo' ? 'amber' : 'blue') : ''}
        <small class="muted block">${e.by} · <time datetime="${e.at}" title="${fmtDateTime(e.at)}">${timeAgo(e.at)}</time></small></div>
        ${e.undoable ? html`<button class="btn sm" data-undo="${e.id}">Undo</button>` : ''}</div>
      <ul class="change-list">${e.changes.map((c) => html`<li><span class="change-label">${c.label}</span>
        <span class="change-from" title="Before">${showValue(c.from, formatOf(e.area, c.path))}</span> ${raw('<span aria-hidden="true">→</span><span class="sr-only">changed to</span>')}
        <span class="change-to" title="After">${showValue(c.to, formatOf(e.area, c.path))}</span></li>`)}</ul>
    </article>`)}</div>
    ${h.total > h.entries.length ? html`<p class="muted small">Showing the latest ${h.entries.length} of ${h.total} changes.</p>` : ''}`
    : html`<div class="card empty">${icon('clock', 32)}<p>No changes recorded${q.area || q.module || q.q ? ' that match' : ' yet'}. Every save on a settings screen in any module is recorded here, with the value before and after.</p></div>`}`);
  el.querySelector('#h-filter').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const v = new FormData(ev.target);
    location.hash = `#/config?${new URLSearchParams({ tab: 'history', ...(v.get('module') ? { module: v.get('module') } : {}), ...(v.get('q') ? { q: v.get('q') } : {}) })}`;
  });
  el.onclick = async (ev) => {
    const id = ev.target.closest('[data-undo]')?.dataset.undo;
    if (!id || !(await confirmDialog('Undo this change? The settings go back to the values before it.', { confirmLabel: 'Undo', danger: false, title: 'Undo a change' }))) return;
    try {
      await api.post(`/api/admin/config/history/${id}/undo`);
      toast('Change undone.');
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
        <p>Downloads the school's settings from every module as a file: rules, grading, payroll rates, Finance numbering and taxes, roles and permissions. No people, records or passwords are in it.</p>
        <p class="muted small">Use it to keep a copy before big changes, or to set up another ATLAS (a test server, another campus' server) the same way. The single sign-on settings, leave types and clock-in locations stay on their screens.</p>
        <div class="actions"><button class="btn primary" id="export">${icon('download', 16)} Export settings</button></div>
      </section>
      <section class="card"><h2>${icon('upload')} Import settings</h2>
        <p>Pick a settings file exported from ATLAS. You see every change first, choose which groups to import, and nothing is saved until you import. If one group fails its checks, nothing is imported.</p>
        <label class="btn">${icon('upload', 16)} Choose a settings file…<input type="file" id="import-file" accept="application/json,.json" hidden /></label>
      </section>
    </div>
    <div id="preview"></div>`);
  el.querySelector('#export').addEventListener('click', async () => {
    const file = await api.get('/api/admin/config/export');
    downloadFile(`atlas-settings-${today()}.json`, JSON.stringify(file, null, 2), 'application/json');
    toast('Settings exported.');
  });
  el.querySelector('#import-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    let file;
    try {
      file = JSON.parse(await f.text());
      const p = await api.post('/api/admin/config/import/preview', { file });
      const fmt = Object.fromEntries(cfg.settings.map((s) => [`${s.area}|${s.path}`, s.format]));
      const withChanges = p.areas.filter((a) => a.changes.length);
      mount(el.querySelector('#preview'), html`<section class="card" style="margin-top:16px">
        <div class="card-head"><h2>What importing would change</h2></div>
        <p class="muted small">From ${p.school || 'another ATLAS'}${p.exportedBy ? `, exported by ${p.exportedBy}` : ''}${p.exportedAt ? ` on ${fmtDateTime(p.exportedAt)}` : ''}. ${p.areas.length - withChanges.length ? `${p.areas.length - withChanges.length} group${p.areas.length - withChanges.length === 1 ? ' is' : 's are'} already the same here.` : ''}</p>
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
          location.hash = '#/config?tab=history';
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    } catch (err) {
      toast(err instanceof SyntaxError ? 'That file is not an ATLAS settings file.' : err.message, 'error');
    }
  });
}
