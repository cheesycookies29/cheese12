# ATLAS email art: security and technology, November 2026

A set in the same look as the November rollout (`../2026-11/`), about how ATLAS protects a school's data:
the layers of API security every request passes, the framework (none: plain JavaScript and Node.js's
standard library) and the backend technologies it runs on.

| Panel | |
| --- | --- |
| `s01` | Hero: *Security, in layers.* Nested layers around the school's data |
| `s02` | The path of every request: eight checks (HTTPS, address check, rate limits, same-site, session, role and permission, scope, business rules), then the records and their audit trail |
| `s03` | The rate limiter: sliding window, `429` with `Retry-After`, and the limits |
| `s04` | Passwords and sign-in: scrypt, then AES-256-GCM under a key kept apart; sessions and cookies; Keycloak single sign-on |
| `s05` | Access and duties: roles, campus/class/family scope, separation of duties on a voucher, audit trail (demo names) |
| `s06` | In the browser: the security headers, escaping, safe exports, sandboxed uploads |
| `s07` | The server on AWS: network, encrypted disk, IMDSv2, systemd sandbox, tested updates, backups |
| `s08` | The framework and the backend: browser, edge, server, data and platform tiers; the numbers |
| `s09` | Testing: automated tests, security reviews, the XSS crawl |
| `s10` | Close: for the school's IT office |

- `ATLAS_security_and_technology_November_2026.pdf`: all panels, one per page.
- `png/`: each panel at 2× (2500 px wide), for decks.
- `email/`: each panel as a 1250-px JPEG (40–170 KB), for email.
- `email.html`: an email body with the panels in order, each with alt text. Upload the `email/` images
  (or attach them inline) and change the `src` addresses before sending.
- `panels.html`: the source. Edit the text there and re-render: open it in Chromium and screenshot each
  `section.panel` at 2×, or print to PDF. Fonts come from `public/fonts/`, marks from `../assets/`.

## Facts behind the claims

Checked against the code on 10 November 2026. Recheck them before sending a later copy.

- **Headers** (`server.js`, `SECURITY_HEADERS`): CSP with `default-src 'self'`, script hashes and
  `frame-ancestors 'self'`; `nosniff`; `X-Frame-Options: SAMEORIGIN`; `Referrer-Policy: same-origin`;
  `Permissions-Policy`; COOP and CORP `same-origin`; `Cache-Control: no-store`. HSTS for a year comes from
  Caddy (`deploy/aws/Caddyfile`).
- **Address check and malformed requests** (`server.js`): `Host` must be localhost, an IP address or a
  name in `ALLOWED_HOSTS`; bad addresses get 400; header timeout 20 s; bodies at most 20 MB.
- **Same-site**: `POST`, `PUT` and `DELETE` need `Content-Type: application/json`; cookies are
  `HttpOnly; SameSite=Strict` and `Secure` in production (`server/auth.js`).
- **Sessions**: 256-bit random tokens; 8 idle hours by default (a setting).
- **Rate limits** (`server/api.js`, `limits`): 300 a minute per signed-in person (60–3,000), 4× per address
  signed out, sign-in 60 a minute, wrong passwords 30 in 15 minutes per address, password changes 10 in 15
  minutes, applications 10 an hour, setup 20 in 15 minutes, lookups 60 a minute. The per-username lock-out
  (5 by default) applies to that username from that address.
- **Passwords** (`server/auth.js`): scrypt with a random salt, then AES-256-GCM (`enc1$…`) under
  `PASSWORD_KEY` or `data/password.key`; `PASSWORD_KEY_OLD` for changing keys. Unknown usernames take the
  same time.
- **Keycloak** (`server/sso.js`): OpenID Connect with PKCE, state and nonce; signature (JWKS), issuer,
  audience and expiry checked; email matching needs `email_verified: true`.
- **Routes**: 400 `route(…)` declarations in `server/`, each with an access rule.
- **Separation of duties**: `server/finance-cash.js` (preparer or certifier cannot approve; paid to the
  account recorded at certification), `server/finance-supply.js` (own requisition), `server/hris*.js`
  (own pay, leave, attendance, loans). Finance audit with old and new values: `server/finance.js`.
- **Server** (`deploy/aws/lms-ec2.yaml`, `ltdc-lms.service`, `update.sh`, `server-setup.sh`): ports 80 and
  443 only; Session Manager; encrypted EBS; `HttpTokens: required`; Ubuntu 24.04 with unattended-upgrades;
  `NoNewPrivileges`, `ProtectSystem=strict`, `ReadWritePaths` the data folder; update tests run as `nobody`
  without network; nightly backups kept 30 days, 7 daily snapshots.
- **Numbers**: no dependencies in `package.json`; about 30,000 lines in `server/`, `shared/` and
  `public/js/`; 125 tests (`npm test`), 25 of them in `test/security.test.js`; seven web apps.
- **Reviews**: the in-house November 2026 reviews; the XSS crawl figures are from
  `docs/security/VAPT-2026-11.md`.

What the set deliberately does not say: that ATLAS has no vulnerabilities, that it was tested
independently, or that ATLAS itself has two-step sign-in (it comes only through the school's Keycloak).
