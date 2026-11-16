# Security monitor: design notes

**System → Security monitor** (administrators, in every system's sidebar) shows four things: the
software's status, the API's security, the traffic and what people are doing. It is a port of
CORE ERP's (`docs/security-monitor.md` at the repository root, which lists the references it came
from: express-status-monitor, Uptime Kuma, Netdata, prom-client / Prometheus, OpenTelemetry HTTP
metrics, CrowdSec / Fail2ban, Wazuh, OWASP AppSensor, Umami / Plausible). The user guide is
`docs/guides/admin.md` (*Watch the server with the Security monitor*).

## Capturing the data

Nothing new is collected about anyone: the monitor counts what the server already sees.

1. **Every request** (`server.js`, when the answer is sent): method, the route **template** that
   answered (`/api/hris/employees/:id`, from `server/api.js`; unknown API addresses share one name,
   pages one, files one), status, duration, size, HTTPS or not, the signed-in account and the
   network address. `/healthz` is left out.
2. **Refusals**, named where ATLAS makes them (OWASP AppSensor's "detection points"):

   | Signal | Where | OWASP API Top 10 (2023) |
   |---|---|---|
   | Not signed in | 401 | API2 |
   | Not allowed | 403 | API1, API5 |
   | Too many requests | 429 (not the sign-in pages: the audit has those) | API4 |
   | Too large / not JSON | 413 / 415 | API4 / API8 |
   | Malformed body | bad JSON, prototype keys, too deep (`server/validate.js`) | API8, API3 |
   | From another website | the CSRF backstop in `server/api.js` | API8 |
   | Wrong host name | the host check in `server.js` | API8 |
   | Call to a private address | Keycloak calls (`server/sso.js`) | API7 |
   | Unknown API address | no route | API9 |
   | Scanner paths | `/.env`, `/wp-admin`, `.php`… | API8 |

3. **The audit trail** (`createAudit`'s `onRecord`): sign-ins, failed sign-ins, locked usernames,
   paused addresses, wrong current passwords.
4. **Changes**: an API request by someone signed in that is not a read and succeeded, counted by
   system (Learn, People, Finance…). Finance, Academic and the Settings center keep their own logs,
   so changes are counted from requests rather than from the audit trail.
5. **The process, each minute**: memory, CPU, event loop delay (p99), sessions open.

## Storage

In memory, three tiers of fixed size (minutes ×60, hours ×168, days ×90), saved each minute and on
stop to `monitor.json` beside the data (written atomically, mode 600, not in backups: it describes
this server, not the school's data). Addresses are capped at 300 per bucket and kept only in the
minute and hour tiers, so for 7 days at most. Percentiles come from 15-bucket histograms
(OpenTelemetry's boundaries), interpolated as Prometheus does.

## Growing it

- `monitor.check(id, fn)` adds a check and `monitor.signal(name, { label, owasp })` a signal; a
  system adds its own in its own file and the page shows them unchanged.
- `GET /api/system/monitor/metrics`: Prometheus text format with OpenTelemetry names, behind a
  bearer token an administrator makes on the page (shown once; only its SHA-256 is kept; each change
  is in the Audit log). With more than one ATLAS server, one Prometheus collects them all.
- `GET /healthz` answers `{ "ok": true }` for an uptime checker or a load balancer.
- Next, when needed: tell administrators when a check turns red (notifications, mail); send signals
  to a SIEM as JSON lines; block an address automatically. For now ATLAS lists addresses to watch and
  leaves blocking to people, because a campus shares one address.

## Privacy

Administrators only, as the Audit log. Network addresses and who used ATLAS are shown for security
and accountability (Data Privacy Act); request bodies, queries and record contents never are.
Addresses are kept 7 days.
