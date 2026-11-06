// Single sign-on with Keycloak: the connection (issuer, client), how people are matched to
// ATLAS accounts, whether passwords stay on, a connection test, and the values to enter in
// Keycloak. The client secret is set on the server (OIDC_CLIENT_SECRET), never here.
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, toast, badge, formData } from '../../ui.js';

export async function ssoView(el) {
  const s = await api.get('/api/admin/sso');
  const reload = () => ssoView(el);
  const copy = (text) => html`<span class="copy-row"><code>${text}</code><button type="button" class="btn sm" data-copy="${text}">${icon('clipboard', 14)} Copy</button></span>`;
  mount(el, html`
    ${pageHead(html`Single sign-on ${s.enabled ? badge('On', 'green') : badge('Off', 'gray')}`, 'Let people sign in to ATLAS with the school\'s Keycloak account. Keycloak proves who they are; ATLAS still decides what each account may do.')}
    <div class="cols wide-left">
      <form class="card" id="sso">
        <h2>${icon('key')} Keycloak connection</h2>
        <div class="grid two">
          <label class="field span-2"><span>Issuer (realm address)</span><input name="issuer" value="${s.issuer}" placeholder="https://sso.school.edu/realms/school" spellcheck="false" /><span class="hint">Keycloak → your realm → Realm settings → OpenID Endpoint Configuration, without <code>/.well-known/…</code>.</span></label>
          <label class="field"><span>Client ID</span><input name="clientId" value="${s.clientId}" placeholder="atlas" spellcheck="false" /></label>
          <label class="field"><span>Button text</span><input name="label" value="${s.label}" /></label>
          <label class="field span-2"><span>Match Keycloak users to ATLAS accounts by</span>
            <select name="matchBy"><option value="email" ${s.matchBy === 'email' ? 'selected' : ''}>Email (verified in Keycloak)</option><option value="username" ${s.matchBy === 'username' ? 'selected' : ''}>Username</option></select>
            <span class="hint">The first sign-in links the two; after that the link is used, even if the email changes. Only people who already have an ATLAS account can sign in.</span></label>
          <label class="field check span-2"><input type="checkbox" name="allowPasswords" ${s.allowPasswords ? 'checked' : ''} /> <span><strong>Keep ATLAS passwords too.</strong> Off: everyone except administrators must use Keycloak (administrators keep a password, in case Keycloak is down).</span></label>
          <label class="field check span-2"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''} /> <span><strong>Show "${s.label}" on the sign-in pages.</strong> ATLAS checks that Keycloak answers before switching this on.</span></label>
        </div>
        <div class="actions end"><button type="button" class="btn" id="test">${icon('link', 16)} Test connection</button><button class="btn primary" type="submit">Save</button></div>
        <div id="test-out"></div>
      </form>
      <div class="stack">
        <section class="card">
          <h2>${icon('shield')} Status</h2>
          <dl class="info-grid">
            <div class="info"><dt>Client secret</dt><dd>${s.secretSet ? badge('Set on the server', 'green') : badge('Not set', 'amber')}</dd></div>
            <div class="info"><dt>Linked accounts</dt><dd>${s.linked}</dd></div>
          </dl>
          ${!s.secretSet ? html`<p class="hint" style="margin-top:12px">Without a secret, the Keycloak client must be public (Client authentication off); PKCE still protects the sign-in. For a confidential client, set <code>OIDC_CLIENT_SECRET</code> in the server's settings file and restart.</p>` : ''}
        </section>
        <section class="card">
          <h2>${icon('settings')} In Keycloak</h2>
          <ol class="steps">
            <li>Clients → <strong>Create client</strong>: OpenID Connect, Client ID <code>${s.clientId || 'atlas'}</code>.</li>
            <li><strong>Client authentication</strong> on; <strong>Standard flow</strong> on (nothing else needed).</li>
            <li><strong>Valid redirect URIs</strong>: ${copy(s.redirectUri)}</li>
            <li><strong>Valid post logout redirect URIs</strong>: ${copy(s.postLogoutUri)}</li>
            <li><strong>Web origins</strong>: <code>+</code></li>
            <li>Credentials tab: copy the <strong>Client secret</strong> into the server's <code>OIDC_CLIENT_SECRET</code> (never here).</li>
          </ol>
          <p class="hint">Behind Caddy on EC2 these addresses use your domain automatically. If they show the wrong address, set <code>PUBLIC_URL</code> on the server.</p>
        </section>
      </div>
    </div>`);

  const form = el.querySelector('#sso');
  const values = () => {
    const v = formData(form);
    return { issuer: v.issuer, clientId: v.clientId, label: v.label, matchBy: v.matchBy, allowPasswords: Boolean(v.allowPasswords), enabled: Boolean(v.enabled) };
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.put('/api/admin/sso', values());
      toast('Single sign-on saved.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  el.querySelector('#test').addEventListener('click', async () => {
    const out = el.querySelector('#test-out');
    mount(out, html`<p class="muted">Checking…</p>`);
    try {
      const t = await api.post('/api/admin/sso/test', { issuer: values().issuer });
      mount(out, html`<div class="notice ok">${icon('checkCircle')}<p><strong>Keycloak answered.</strong> Issuer ${t.issuer}; ${t.keys} signing key${t.keys === 1 ? '' : 's'}; ${t.logout ? 'sign-out supported' : 'no sign-out address'}.</p></div>`);
    } catch (err) {
      mount(out, html`<div class="notice bad">${icon('flag')}<p>${err.message}</p></div>`);
    }
  });
  el.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      toast('Copied.');
    } catch {
      toast('Select the address and copy it.', 'error');
    }
  }));
}
