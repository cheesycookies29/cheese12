# Security monitor: design notes (0.34)

The **Admin panel → Security monitor** page shows four things: the software's status, the API's
security, the app's traffic and what people are doing. These notes record where the ideas came from,
how CORE captures the data, and how the monitoring grows with CORE. The user guide is
`docs/guides/admin.md`.

## 1. References

| Project | What it does | What CORE takes from it |
|---|---|---|
| [express-status-monitor](https://github.com/RafalWilinski/express-status-monitor) | One middleware, live charts of response time, requests per second, status codes, CPU, memory and event loop, kept in a few rolling windows | One hook per request; fixed-size rolling windows; a list of paths to ignore (the health check) |
| [Uptime Kuma](https://github.com/louislam/uptime-kuma) | Checks that run on a schedule and turn up, down or pending | A list of **checks**, each green, amber or red, with a plain reason and a link to the fix |
| [Netdata](https://github.com/netdata/netdata) | Per-second data, stored in tiers that keep less detail for longer | **Tiers**: minutes for an hour, hours for a week, days for 90 days, so the file never grows |
| [prom-client](https://github.com/siimon/prom-client) / [Prometheus](https://prometheus.io) | RED metrics (rate, errors, duration), default process metrics, event loop lag, the text format | The same metrics, in the same format, for a monitoring server to collect |
| [OpenTelemetry HTTP metrics](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/) | `http.server.request.duration` with fixed buckets, keyed by **route template**, method and status | The same 14 duration buckets; routes counted by their template (`/api/employees/:id`), never the raw path, so the number of series stays fixed |
| [CrowdSec](https://github.com/crowdsecurity/crowdsec) / [Fail2ban](https://github.com/fail2ban/fail2ban) | Read logs, recognise attack patterns (brute force, probing), count by address | **Signals** counted by network address; addresses over a threshold are listed to watch |
| [Wazuh](https://github.com/wazuh/wazuh) | SIEM dashboards: failed versus successful sign-ins, integrity checks | Sign-in failures beside sign-ins; the audit chain check as an integrity signal |
| [OWASP AppSensor](https://owasp.org/www-project-appsensor/) | Detection points inside the application, where it knows best what is abuse | Refusals are counted where CORE makes them (permission, rate limit, cross-site), not guessed from logs |
| [Umami](https://github.com/umami-software/umami) / [Plausible](https://github.com/plausible/analytics) | Privacy-friendly analytics: page views and active visitors, no tracking | Active people per day, week and month, counted on the server; no tracking script and no cookie added |

What CORE does **not** take: a separate time-series database, a log shipper or an agent on the
server. CORE runs as one Node process with no dependencies, often on one office PC. The monitor
has to work there too, with nothing to install.

## 2. Capturing the data

There are four sources. Nothing new is collected about anyone: the monitor counts what the server
already sees.

**1. Every request (`server.js`).** When a response finishes, the server reports one observation:
- method;
- the route **template** that answered it (`/api/pm/projects/:id`). Unknown API paths share one
  name, pages share one name, files share one name;
- status code and duration;
- size of the answer;
- whether it came over HTTPS;
- the signed-in account, if any;
- network address.

**2. Refusals (signals).** Each refusal is counted by kind, where CORE makes it:

| Signal | Status | OWASP API Top 10 (2023) |
|---|---|---|
| Not signed in | 401 | API2 |
| Not allowed (permission or record rule) | 403 | API1, API5 |
| Too many requests | 429 | API4 |
| Too large | 413 | API4 |
| Not JSON | 415 | API8 |
| Unknown API address | 404 | API9 |
| Another site (CSRF) | — | API8 |
| Wrong host name (DNS rebinding) | — | API8 |
| Scanner paths (`/.env`, `/wp-admin`, `.php`) | — | API8 |

The audit log adds failed sign-ins, lockouts, wrong 2-step codes and recovery codes used. The
audit log can tell the monitor about each new entry, so these need no second hook.

**3. The audit log.** Every entry is counted by area (hr, payroll, projects…). This gives the
changes per hour and what people work on. Sign-ins come from `auth.login`.

**4. The process, every minute.** Using Node's standard library:
- memory: resident and heap;
- CPU share;
- event loop delay, p99 (`perf_hooks.monitorEventLoopDelay`);
- free disk space (`fs.statfs`);
- sessions open.

**Software status** is a list of checks, worked out when the page is opened from what CORE
already knows:
- version and Node.js support dates;
- HTTPS;
- rate limits on;
- the audit chain;
- data file permissions;
- backup age;
- disk, memory and event loop;
- error rate;
- the 2-step policy and administrators without it;
- temporary passwords;
- accounts unused for 90 days;
- demo data on a live server.

**API security** combines three things:
- the **route inventory**: every route CORE has, by who may call it, with the public ones listed
  by name (OWASP API9);
- the **controls in force**;
- the refusals above.

### Storage

All of this is kept in memory, in three tiers of fixed size:

| Tier | Bucket | Kept | Used for |
|---|---|---|---|
| Minutes | 1 minute | 60 | Last hour |
| Hours | 1 hour | 168 | Last 24 hours, last 7 days |
| Days | 1 day | 90 | Last 30 days |

Each bucket holds:
- counts and a duration histogram;
- signals;
- audit areas;
- the accounts seen.

Hour and day buckets also hold route counts. Hour buckets hold addresses, capped at 300 per bucket;
the rest are counted as "others". Days keep no addresses, so addresses are gone after 7 days.

The state is saved every minute to `monitor.json` in the data folder. It is written atomically,
readable only by CORE, and is not part of backups: it describes this server, not the company's
data. A restart keeps the history.

Percentiles (p50, p95, p99) come from the histogram, interpolated within a bucket, as Prometheus
does. They are estimates within one bucket's width.

### Cost

One observation is a few counter increments in three buckets. The file stays bounded at about
1 MB at most, whatever the traffic, because:
- routes are templates (about 350);
- addresses are capped;
- the tiers are fixed in size.

## 3. Scaling it

1. **Checks and signals are registered, not hard-coded.**
   - `monitor.check(id, fn)` adds a check.
   - `monitor.signal(name, { label, owasp })` adds a signal.
   - A new module (Finance, Procurement) adds its own in its own file, and the page shows them
     with no change to the page. A check returns `{ state, label, detail, href }`.
2. **Standard export.** `GET /api/admin/monitor/metrics` answers in the Prometheus text format,
   with OpenTelemetry names (`http_server_request_duration_seconds` by route, method and status).
   - It is protected by a scrape token that an administrator creates on the page. The token is
     shown once and only its hash is kept.
   - When CORE runs on more than one server, a Prometheus or Grafana server collects every one;
     each CORE keeps its own page.
3. **Health check.** `GET /api/public/health` answers `{ "status": "ok" }` with nothing else, for
   Uptime Kuma, an AWS load balancer or a status page. It is left out of the traffic counts.
4. **Bounded by design.** Route templates, capped addresses and fixed tiers keep memory and the
   file the same size at 10 or 10,000 users. More detail means a new tier, not a bigger one.
5. **Next steps, when needed:**
   - notify administrators when a check turns red or an address passes a threshold, through the
     existing notifications and mail;
   - send the signals to a SIEM (Wazuh) as JSON lines;
   - block an address automatically, as CrowdSec does. For now CORE lists addresses to watch and
     leaves blocking to people, because an office shares one address.

## 4. Privacy

The panel is for the **Security monitor** permission (administrators by default). It shows
network addresses and who used CORE, as the audit log already does, for the same purpose:
- security;
- accountability (Data Privacy Act, legitimate interest of the company).

Since 0.39 (third security assessment) the parts about accounts are narrower still: the checks
about accounts and the device and address of each session need **Manage users** as well (so only
administrators see them), and the recent sign-ins need **Audit log**. Behind the HTTPS proxy CORE reads the visitor's address from
`X-Forwarded-For` only when it is set up for it (`TRUST_PROXY=1`, set on the AWS server); elsewhere
the connection's own address is used, so a program on the same computer cannot name another one.
The metrics address answers 401 whether or not a token was made.

It never shows:
- request bodies;
- query strings;
- record contents.

Addresses are kept 7 days.
