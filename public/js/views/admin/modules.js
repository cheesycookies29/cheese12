// Admin panel → Modules: turn each live module on or off for the company, as ATLAS does per audience.
// A module that is off disappears from the CORE home, the module switcher and the menus, and the
// server refuses its API, for everyone but administrators (who see it marked Off). Nothing is deleted.
// Coming soon (0.63): show or hide each module on the roadmap, each integration and each coming-soon
// page inside a module; hidden ones are gone for everyone, administrators too, until shown again.
import { api } from '../../api.js';
import { ctx, can } from '../../state.js';
import { html, mount, toast, confirmDialog } from '../../ui.js';
import { icon } from '../../icons.js';
import { MODULES, TOOLS, SWITCHABLE, MODULE_PARTS, ROADMAP, ROADMAP_KINDS } from '/shared/modules.js';
import { pageHead } from './common.js';

export async function modulesView(el) {
  const { config } = await api.get('/api/admin/modules');
  const editable = can('modules.config');
  // The live modules, then the tools (0.64), each on or off for the company.
  const live = [...MODULES.filter((m) => SWITCHABLE.includes(m.id)), ...TOOLS];
  mount(el, html`
    ${pageHead('Modules', 'Choose which modules the company uses. A module that is off disappears from the CORE home, the module switcher and the menus, and CORE refuses it, for everyone except administrators.')}
    <div class="card scroll-x"><table class="table">
      <thead><tr><th>Module</th><th>For the company</th><th>What turning it off takes away</th></tr></thead>
      <tbody>${live.map((m) => html`<tr class="module-row">
        <td><span class="mod-name"><span class="mod-ic">${icon(m.glyph, 18)}</span><span><strong>${m.name}</strong><small class="muted block">${m.code}</small></span></span></td>
        <td><label class="switch"><input type="checkbox" data-module="${m.id}" ${config[m.id] !== false ? 'checked' : ''} ${editable ? '' : 'disabled'} aria-label="${m.name}" /> <span class="state">${config[m.id] !== false ? 'On' : 'Off'}</span></label></td>
        <td><div class="desc">${MODULE_PARTS[m.id]}</div></td>
      </tr>`)}</tbody>
    </table></div>
    <p class="muted small page-note">Turning a module off never deletes anything: its records, settings and files stay, and turning it back on shows everything again. While it is off, administrators still see it (marked <strong>Off</strong>) and can open its settings; its background work (reading the service desk mailbox, the Projects daily digest) waits. Changes apply the next time someone opens a page.</p>
    <p class="muted small page-note">Self-service belongs to the module it is part of: with <strong>Human Resource Management</strong> off, employees no longer clock in or out, file leave or see payslips in CORE; My Assets and My tickets stay with their modules. The holiday calendar stays visible, because Projects counts working days by it.</p>

    <section class="card scroll-x roadmap-card" id="roadmap">
      <div class="card-head"><h2>${icon('lock')} Coming soon</h2>
        ${editable ? html`<span class="actions"><button type="button" class="btn small-btn" data-all="true">Show all</button><button type="button" class="btn small-btn" data-all="false">Hide all</button></span>` : ''}</div>
      <p class="muted small pad">What is on the roadmap shows greyed out, marked <strong>Coming soon</strong>, so people know it is planned. Hide what you would rather not show yet: it is gone from the CORE home, the modules menu and the side menu for everyone, administrators too, until you show it again. Nothing can be opened or set up in them either way.</p>
      <table class="table">
        <thead><tr><th>Coming soon</th><th>Shown</th><th>Where it shows</th></tr></thead>
        ${Object.entries(ROADMAP_KINDS).map(([kind, label]) => html`<tbody>
          <tr class="roadmap-group"><th colspan="3" scope="colgroup">${label}</th></tr>
          ${ROADMAP.filter((x) => x.kind === kind).map((x) => html`<tr class="module-row" data-roadmap-row="${x.id}">
            <td><span class="mod-name"><span class="mod-ic${x.accent ? ` accent-${x.accent}` : ''}">${icon(x.glyph, 18)}</span><span><strong>${x.name}</strong><small class="muted block">${x.code}</small></span></span></td>
            <td><label class="switch"><input type="checkbox" data-roadmap="${x.id}" ${config[x.id] !== false ? 'checked' : ''} ${editable ? '' : 'disabled'} aria-label="Show ${x.name}" /> <span class="state">${config[x.id] !== false ? 'Shown' : 'Hidden'}</span></label></td>
            <td><div class="desc">${x.where}</div></td>
          </tr>`)}
        </tbody>`)}
      </table>
      <p class="muted small pad roadmap-count" aria-live="polite">${count(config)}</p>
    </section>`);

  // Coming soon: shown or hidden, one at a time or all at once.
  async function setShown(changes, message) {
    const saved = await api.put('/api/admin/modules', { modules: changes });
    Object.assign(config, saved.config);
    ctx.modules = saved.config;
    for (const input of el.querySelectorAll('input[data-roadmap]')) {
      input.checked = config[input.dataset.roadmap] !== false;
      input.closest('label').querySelector('.state').textContent = input.checked ? 'Shown' : 'Hidden';
    }
    el.querySelector('.roadmap-count').textContent = count(config);
    window.dispatchEvent(new Event('modules:changed'));
    toast(message);
  }
  el.querySelectorAll('input[data-roadmap]').forEach((input) => input.addEventListener('change', async () => {
    const x = ROADMAP.find((r) => r.id === input.dataset.roadmap);
    try {
      await setShown({ [x.id]: input.checked }, `${x.name} is now ${input.checked ? 'shown, as coming soon' : 'hidden from everyone'}.`);
    } catch (err) {
      input.checked = !input.checked;
      toast(err.message, 'error');
    }
  }));
  el.querySelectorAll('[data-all]').forEach((b) => b.addEventListener('click', async () => {
    const on = b.dataset.all === 'true';
    try {
      await setShown(Object.fromEntries(ROADMAP.map((x) => [x.id, on])), on ? 'Everything coming soon is shown.' : 'Everything coming soon is hidden.');
    } catch (err) {
      toast(err.message, 'error');
    }
  }));

  el.querySelectorAll('input[data-module]').forEach((input) => input.addEventListener('change', async () => {
    const m = live.find((x) => x.id === input.dataset.module);
    if (!input.checked && !(await confirmDialog(`Turn ${m.name} off for the company? Nobody but administrators can open it until it is turned on again. Nothing is deleted.`, { confirmLabel: `Turn ${m.name} off`, title: 'Turn a module off' }))) {
      input.checked = true;
      return;
    }
    try {
      let saved;
      try {
        saved = await api.put('/api/admin/modules', { modules: { [m.id]: input.checked } });
      } catch (err) {
        // CUSTOM APP while an event's doors are open (0.71): only its Super Administrator, confirming.
        if (err.code !== 'event_window_open' || !(await confirmDialog(`${err.message} If you are that Super Administrator, confirm to switch it off now: the desk stops until it is turned on again.`, { confirmLabel: 'Switch off during the event', title: 'An event is open' }))) throw err;
        saved = await api.put('/api/admin/modules', { modules: { [m.id]: input.checked }, confirmEventOff: true });
      }
      Object.assign(config, saved.config);
      ctx.modules = saved.config;
      input.closest('label').querySelector('.state').textContent = input.checked ? 'On' : 'Off';
      window.dispatchEvent(new Event('modules:changed'));
      toast(`${m.name} is now ${input.checked ? 'on' : 'off'} for the company.`);
    } catch (err) {
      input.checked = !input.checked;
      toast(err.message, 'error');
    }
  }));
}

// "5 of 8 shown" under the Coming soon table.
function count(config) {
  const n = ROADMAP.filter((x) => config[x.id] !== false).length;
  return n === ROADMAP.length ? `All ${n} shown.` : n === 0 ? `All ${ROADMAP.length} hidden.` : `${n} of ${ROADMAP.length} shown; ${ROADMAP.length - n} hidden.`;
}
