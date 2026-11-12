// System → Cloudflare: put ATLAS behind Cloudflare at a name on the school's own domain. "Set up for
// me" uses a Cloudflare API token, pasted once and not kept, to add the DNS record and set SSL/TLS in
// Cloudflare; the server's helper then switches the server over (Caddy, allowed addresses, the
// firewall), and this page shows its answer. Also: only accept visitors through Cloudflare, and
// switching Cloudflare off again (server/cloudflare.js).
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, toast, badge, formData, confirmDialog, fmtDateTime } from '../../ui.js';

const POLL_MS = 5000;
const POLL_FOR_MS = 5 * 60 * 1000;
let timer = null;
let pollingSince = 0;
const stop = () => {
  clearTimeout(timer);
  timer = null;
};

const STATE_BADGE = {
  none: ['Not set up', 'gray'],
  pending: ['Switching over', 'amber'],
  active: ['Active', 'green'],
  failed: ['Failed', 'red'],
  off: ['Off', 'gray'],
};
const fact = (label, yes, good, bad) => html`<div class="info"><dt>${label}</dt><dd>${yes ? html`${icon('checkCircle', 16)} ${good}` : bad}</dd></div>`;

function statusCard(v, waitedTooLong) {
  const { state, status, settings, request } = v;
  const name = settings.hostname || request?.hostname || status?.hostname || '';
  if (state === 'pending') {
    return html`<section class="card">
      <h2>${icon('clock')} Waiting for the server to switch over</h2>
      ${waitedTooLong
        ? html`<div class="notice bad">${icon('flag')}<p>The server has not answered for five minutes. ${v.helperInstalled ? 'Check again in a while, or look at the server\'s log.' : 'Its Cloudflare helper is not installed yet (see below).'}</p></div>
          <div class="actions"><button type="button" class="btn" id="check-again">${icon('clock', 16)} Check again</button></div>`
        : html`<p class="muted">${request?.hostname ? html`The server is setting up <strong>${request.hostname}</strong>: a certificate for it, and the addresses it answers to. This takes about a minute.` : 'The server is going back to its DuckDNS address only.'} This page checks every few seconds.</p>`}
      ${request?.hostname ? html`<p class="hint">For that minute, ${request.hostname} may show a Cloudflare error page (error 526) until the server has its certificate.</p>` : ''}
      ${request ? html`<p class="hint">Asked ${fmtDateTime(request.requestedAt)}${request.requestedBy ? ` by ${request.requestedBy}` : ''}.</p>` : ''}
    </section>`;
  }
  if (state === 'active') {
    return html`<section class="card">
      <h2>${icon('cloud')} ATLAS is behind Cloudflare</h2>
      <p>People reach ATLAS at <a href="https://${status.hostname}/" target="_blank" rel="noopener">https://${status.hostname}/</a>${v.duckdns ? html`; <code>${v.duckdns}</code> still works too` : ''}.</p>
      <dl class="info-grid">
        ${fact('HTTPS certificate', status.certificate, 'On the server', 'Not yet')}
        ${fact('Through Cloudflare', status.throughCloudflare, 'Yes', 'Not yet')}
        ${fact('Only through Cloudflare', status.originLocked, 'Yes: the server refuses visitors who go around it', 'No: the server\'s own address also works')}
      </dl>
      ${status.message ? html`<p class="hint">${status.message}</p>` : ''}
      ${status.appliedAt ? html`<p class="hint">Switched over ${fmtDateTime(status.appliedAt)}.</p>` : ''}
    </section>`;
  }
  if (state === 'failed') {
    return html`<section class="card">
      <h2>${icon('flag')} The server could not switch over</h2>
      <div class="notice bad">${icon('flag')}<p>${status.message || 'The server\'s helper did not say why.'}</p></div>
      <p class="muted">Fix what it says, then choose <strong>Set up again</strong>. ${name ? html`Until then, ATLAS still answers at ${v.duckdns ? html`<code>${v.duckdns}</code>` : 'its DuckDNS address'}.` : ''}</p>
    </section>`;
  }
  if (state === 'off') {
    return html`<section class="card">
      <h2>${icon('cloud')} Cloudflare is off</h2>
      <p class="muted">ATLAS answers at ${v.duckdns ? html`<code>${v.duckdns}</code>` : 'its DuckDNS address'} only.${status?.message ? ` ${status.message}` : ''}</p>
      ${settings.zoneName ? html`<p class="hint">The DNS record ATLAS made stays in Cloudflare (${settings.zoneName} → DNS); delete it there if you no longer need it.</p>` : ''}
    </section>`;
  }
  return html`<section class="card">
    <h2>${icon('cloud')} Not set up</h2>
    <p class="muted">ATLAS answers at ${v.duckdns ? html`<code>${v.duckdns}</code>` : 'its DuckDNS address'}. With Cloudflare in front, people reach it at a name on the school's own domain, like <code>atlas.school.edu.ph</code>, and Cloudflare absorbs floods of traffic and attacks before they reach the server.</p>
  </section>`;
}

export async function cloudflareView(el) {
  stop();
  const v = await api.get('/api/admin/cloudflare');
  if (v.state !== 'pending') pollingSince = 0;
  else if (!pollingSince) pollingSince = Date.now();
  const waitedTooLong = v.state === 'pending' && Date.now() - pollingSince > POLL_FOR_MS;
  const reload = () => cloudflareView(el);
  const s = v.settings;
  const setUp = Boolean(s.hostname);
  const [label, kind] = STATE_BADGE[v.state] || STATE_BADGE.none;
  const canLock = Boolean(setUp && v.status?.throughCloudflare && v.status.hostname === s.hostname);

  mount(el, html`
    ${pageHead(html`Cloudflare ${badge(label, kind)}`, 'Put ATLAS behind Cloudflare, at a name on the school\'s own domain. Cloudflare stands in front of the server: it keeps attacks and floods of traffic away and makes ATLAS faster to load.')}
    ${!v.helperInstalled ? html`<div class="notice info">${icon('settings')}<p><strong>The server's Cloudflare helper is not installed.</strong> Whoever looks after the server runs <code>sudo bash /opt/ltdc-lms/deploy/aws/upgrade-server.sh</code> once from a console (see the server guide). You can set up Cloudflare below first: the server switches over once the helper is installed.</p></div>` : ''}
    <div class="cols wide-left">
      <div class="stack">
        ${statusCard(v, waitedTooLong)}
        ${s.warnings.length ? html`<section class="card"><h2>${icon('flag')} Check in Cloudflare</h2><ul>${s.warnings.map((w) => html`<li>${w}</li>`)}</ul></section>` : ''}
        <form class="card" id="setup" autocomplete="off">
          <h2>${icon('sparkle')} ${setUp ? 'Set up again' : 'Set up for me'}</h2>
          <p class="muted">ATLAS uses the API token once: it adds the address to the school's domain in Cloudflare, pointing at this server through Cloudflare, sets SSL/TLS to Full (strict) and asks the server to switch over. The token is not saved.</p>
          <div class="grid two">
            <label class="field span-2"><span>New address for ATLAS</span><input name="hostname" value="${s.hostname || ''}" placeholder="atlas.school.edu.ph" spellcheck="false" autocapitalize="none" required /><span class="hint">A name on a domain the school has on Cloudflare. A duckdns.org address cannot be used.</span></label>
            <label class="field"><span>This server's address</span><input name="originIp" value="${s.originIp || v.suggestedIp || ''}" placeholder="54.169.10.20" spellcheck="false" inputmode="decimal" required /><span class="hint">${v.suggestedIp ? 'Filled in from AWS.' : 'Its public IPv4 address (EC2 → the instance → Public IPv4 address).'}</span></label>
            <label class="field"><span>Cloudflare API token</span><input name="token" type="password" autocomplete="off" spellcheck="false" required /><span class="hint">Used once, not saved.</span></label>
          </div>
          <div class="actions end"><button class="btn primary" type="submit">${icon('cloud', 16)} Set up in Cloudflare</button></div>
          <div id="setup-out" aria-live="polite"></div>
        </form>
        ${setUp ? html`<section class="card">
          <h2>${icon('lock')} Who may reach the server</h2>
          <label class="field check"><input type="checkbox" id="lock" ${s.lockOrigin ? 'checked' : ''} ${canLock || s.lockOrigin ? '' : 'disabled'} /> <span><strong>Only accept visitors through Cloudflare.</strong> The server then refuses web visitors who go to its address directly, around Cloudflare. ${canLock ? '' : 'You can turn this on once Cloudflare is active.'}</span></label>
        </section>` : ''}
        ${setUp || ['pending', 'active', 'failed'].includes(v.state) ? html`<section class="card">
          <h2>${icon('x')} Switch Cloudflare off</h2>
          <p class="muted">The server goes back to its DuckDNS address only. The DNS record stays in Cloudflare; delete it there if you no longer need it.</p>
          <div class="actions"><button type="button" class="btn danger" id="off">Switch Cloudflare off</button></div>
        </section>` : ''}
      </div>
      <div class="stack">
        <section class="card">
          <h2>${icon('key')} Make the API token</h2>
          <ol class="steps">
            <li>Sign in to Cloudflare and open <strong>My Profile → API Tokens</strong>.</li>
            <li>Choose <strong>Create Token</strong>, then <strong>Create Custom Token</strong> (Get started).</li>
            <li>Give it a name, like <em>ATLAS set-up</em>.</li>
            <li>Under <strong>Permissions</strong>, add three: <strong>Zone · Zone · Read</strong>, <strong>Zone · DNS · Edit</strong> and <strong>Zone · Zone Settings · Edit</strong>.</li>
            <li>Under <strong>Zone Resources</strong>: <strong>Include · Specific zone ·</strong> the school's domain.</li>
            <li>Choose <strong>Continue to summary</strong>, then <strong>Create Token</strong>, and copy the token into the form here.</li>
          </ol>
          <p class="hint">The domain must already be on Cloudflare and show as Active. You can delete the token in Cloudflare once ATLAS is set up.</p>
        </section>
        <section class="card">
          <h2>${icon('link')} Single sign-on</h2>
          <p class="muted">If single sign-on (Keycloak) is set up, its redirect address changes to the new name. After the switch, open ATLAS at the new address and run <strong>Single sign-on → Set up again</strong>.</p>
        </section>
      </div>
    </div>`);

  const form = el.querySelector('#setup');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(form);
    const out = el.querySelector('#setup-out');
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    mount(out, html`<p class="muted">Setting up Cloudflare…</p>`);
    try {
      const r = await api.post('/api/admin/cloudflare/setup', { token: f.token, hostname: f.hostname, originIp: f.originIp, lockOrigin: Boolean(s.lockOrigin) });
      form.token.value = '';
      toast('Cloudflare is set up. The server is switching over.');
      pollingSince = Date.now();
      await reload();
      mount(el.querySelector('#setup-out'), html`<div class="notice ok">${icon('checkCircle')}<p><strong>Done in Cloudflare.</strong> ${r.changes.length ? html`ATLAS ${r.changes.join('; ')}.` : 'Everything was already right there.'}</p></div>`);
    } catch (err) {
      form.token.value = '';
      button.disabled = false;
      mount(out, html`<div class="notice bad">${icon('flag')}<p>${err.message}</p></div>`);
    }
  });

  el.querySelector('#lock')?.addEventListener('change', async (e) => {
    try {
      await api.post('/api/admin/cloudflare/lock', { lockOrigin: e.target.checked });
      toast(e.target.checked ? 'The server will only accept visitors through Cloudflare.' : 'The server will accept visitors from anywhere again.');
      pollingSince = Date.now();
      reload();
    } catch (err) {
      e.target.checked = !e.target.checked;
      toast(err.message, 'error');
    }
  });

  el.querySelector('#off')?.addEventListener('click', async () => {
    if (!(await confirmDialog(html`Switch Cloudflare off? ATLAS goes back to ${v.duckdns ? html`<code>${v.duckdns}</code>` : 'its DuckDNS address'} only, and people using ${s.hostname || 'the Cloudflare address'} can no longer reach it. The DNS record stays in Cloudflare.`, { confirmLabel: 'Switch off', title: 'Switch Cloudflare off' }))) return;
    try {
      const r = await api.post('/api/admin/cloudflare/off');
      toast(r.note || 'Cloudflare is switched off.');
      pollingSince = Date.now();
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  el.querySelector('#check-again')?.addEventListener('click', () => {
    pollingSince = Date.now();
    reload();
  });

  // While the server switches over, look again every few seconds (for five minutes); a new state
  // redraws the page.
  if (v.state === 'pending' && !waitedTooLong) {
    const poll = async () => {
      try {
        const next = await api.get('/api/admin/cloudflare');
        if (!el.isConnected) return;
        if (next.state !== 'pending' || Date.now() - pollingSince > POLL_FOR_MS) return reload();
      } catch {
        // a moment without the server (it may be restarting): try again
      }
      timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);
  }
  return stop;
}
