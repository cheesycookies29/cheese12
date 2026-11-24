# Tuner Position — CBSUA deployment of ATLAS (Round 1)

## Measurement basis (read-only, scratch copy)

The bench uses the real `server/` code (createApi + memoryDb), with the demo school replicated R times (students, sections, enrollments, records). Script: `/tmp/claude-0/-home-user-cheese12/0435fd19-bdd9-5f73-ab09-e6d1a14862e0/scratchpad/council/cbsua-modules/tuner-bench/scale.mjs`. The machine is a 4-core dev box with Node 22.23. A t3.small has 2 vCPU on 1 physical core with a 20% CPU-credit baseline, so it will be the same speed or slower.

| Data | R=1 (demo) | R=25 | R=100 (~CBSUA, 1 year) |
|---|---|---|---|
| Students / sections / enrollments | 203 / 67 / 1.2k | 5.1k / 1.7k / 29k | 20.3k / 6.7k / 116k |
| db.json (pretty) | 4.4 MB | 35 MB | **129 MB** |
| `db.save()` = stringify + write | 30 ms | 250 ms | **~860 ms, blocks the event loop** |
| JSON.parse at start | 7 ms | 74 ms | 542 ms |
| GET /api/enrollment/catalog (1 student) | 8 ms | 2.0 s | **31.6 s** |
| GET /api/admin/enrollments?status=pending | 0.2 ms | 1.3 s | **17.4 s** |
| GET /api/hub/figures (registrar home) | – | 0.42 s | **7.5 s** |
| GET /api/academic/dashboard (registrar) | – | 0.24 s | **4.7 s** |
| Student /api/home, /enrollment/mine | <1 ms | 6–8 ms | 17 ms (fine) |

Other numbers:
- One scrypt hash at N=2^17 takes 328 ms. With HASH_SLOTS=2, the server checks about 6 passwords per second at most.
- A durable single-row write in `node:sqlite` (built into Node 22, no npm package needed) in WAL mode takes about 0.02 ms.

## 1. Opening perspective

As built, the architecture does not hold at CBSUA scale. The 1-core-equivalent box is not the main reason. Two algorithmic properties are.

- **Every write rewrites the whole university synchronously.** This costs O(total data) per click, about 0.86 s at 20k students in the first year, so the whole institution gets roughly one write per second.
- **Key read paths scan all enrollments for every section.** This is O(sections × enrollments). One student opening the enrollment catalog freezes the single event loop for about 30 s, for everyone on every campus.

Both are cheap at demo scale (4.4 MB) and fail non-linearly from about 5k students onward. The 25→100 step is 4x more data but 15.6x the catalog time. There is also a hard wall: V8's maximum string length is about 512M characters, so `JSON.stringify` in `db.save()` will throw once the data reaches that size. A full UIS history import alone would reach it.

The most important question from my lens: **what is the peak write rate in enrollment and grade-posting week, and does each write cost O(1) or O(university)?** Today it is O(university). Fix that and the indexes, and a modest single VM can serve CBSUA.

## 2. Module input

**ATLAS home.** `figuresFor()` in `server/api.js` runs on every home load. It fans out through `ctx.invoke` to full-scan routes such as `/api/admin/enrollments/summary` and `/api/academic/dashboard`, so a registrar's home page costs 7.5 s of blocked event loop at R=100. Student figures are cheap (14 ms). *Recommendation:* serve the cards from counters kept up to date on write, or from a per-user cache with a 60 s TTL. Load the figures after the page renders, so the home page never waits on Academic or Finance.

**Learn + Admin panel.** Two paths are quadratic.
- In `/api/enrollment/catalog` (`server/enrollment.js`), every section calls `sectionView` (seat count = `enrollments.filter`), `enrollments.find` and `evaluate()` (`hasPassed` for each prerequisite = more scans).
- In `/api/admin/enrollments`, `atCampus` runs `sectionCampus → findById(sections)` for each enrollment.

The write paths are also hot. The quiz autosave (`public/js/portal/views/quiz.js`, 900 ms debounce → `PUT /api/attempts/:id` → `db.save()`) means one 40-student quiz produces dozens of full rewrites per second. Attendance (`PUT /api/classes/:id/attendance/:date`) also rewrites everything. *Recommendation:* first, add in-memory indexes maintained on mutation: Maps by id, by sectionId (seat counts), by studentId, and by student+course passed. Also paginate the admin lists. This should bring the catalog from about 30 s to under 50 ms with no storage change. Then move attempts and attendance off the whole-file save.

**Academic.** `academicRecords` cost about 690 B each in the pretty JSON. A UIS import is planned (`docs/ACADEMIC-PLAN.md`). 20k current students × 40 subjects is about 550 MB of JSON. Alumni history for TOR issuance would add multiple GB. That cannot live in db.json, because the string limit and the 2 GB t3.small are both exceeded. Grade-posting week means about 4,000 grade-sheet posts, each a full save, plus the 4.7 s dashboard. *Recommendation:* make `academicRecords` (and `issuedDocuments`) the first collections moved to a real store, `node:sqlite`, which keeps the zero-dependency rule. Index them by (studentId, termId). The UIS import must target that store, never db.json.

**People.** The DTR/time clock is a predictable daily spike: an assumed 1,500 employees clocking in between 7:30 and 8:00 is about 1.7 writes/s. That is above the ~1.1 writes/s the whole-file save allows, so the clock-in queue starves Learn every morning. `timeEntries` (305 B each) add about 120 MB/year. `payrollRuns` embed every payslip (about 880 B per employee per run): about 32 MB/year at 1,500 employees, all rewritten on every unrelated click. *Recommendation:* move timeEntries and payroll payslips to append/row storage. Run the payroll computation in batches so it does not hold the event loop for seconds.

**Finance.** Every non-GET `/api/finance/*` call does `structuredClone` of every `fin*` collection before running (`finSnap` in `api.js` handle()). That is about 4 ms per MB, every time, on top of the full save. Cashiering student receipts (ORs) during enrollment will be the busiest Finance path, and it will get slower each month as the books grow. *Recommendation:* replace the snapshot rollback with real transactions (`BEGIN`/`ROLLBACK` in SQLite). Until then, clone only the collections the route touches. Decide where cashiering lives (Academic or Finance) with peak throughput in mind: receipt issuance must be O(1).

**System.**
- The audit trail (`server/audit.js`) keeps every entry in memory forever and appends one on every successful sign-in (`api.js:241`). With 20k sign-ins a day, the heap grows by megabytes per day until OOM, and the whole file is parsed at start.
- Sessions live only in memory (`createSessions`). The 10-minute GitHub auto-update restarts the server, which signs everyone out. That triggers a re-login storm into 2 scrypt slots (about 6/s, then 503 "busy" past 100 queued).
- `POST /api/admin/restore` takes the backup as a JSON body capped at `MAX_BODY_SIGNED_IN` = 20 MB. That is already smaller than the R=25 database (35 MB), so in-app restore stops working at CBSUA scale.

*Recommendation:*
- Persist sessions in SQLite.
- Add a change freeze that blocks auto-update during enrollment and grade weeks.
- Rotate the audit log by month, keeping only the tail in memory.
- Do restore with a server-side file or snapshot, not an HTTP body.

**Facilities (planned).** The volume is low (bookings and maintenance tickets), but correctness under contention matters: double-booking a room. *Recommendation:* build it on the new row store from day one, with a uniqueness or overlap check indexed on (roomId, date). It should never add another array to db.json.

**REX e-Reader (planned).** The risk is the bytes. A t3.small has about 128 Mbps of baseline network. One class of 1,000 students each pulling a 30 MB e-book is 30 GB: about 30+ minutes at full saturation, plus about US$3–4 of Singapore egress per download wave. Book files also must not go through the base64-in-JSON upload path (20 MB body limit, parsed on the main thread). *Recommendation:* ATLAS stores only entitlements (who may read which title) and issues short-lived signed URLs. REX or a CDN (Cloudflare/CloudFront) serves the content, so ATLAS carries 0 bytes of book traffic.

## 3. Top 3 concerns (ranked)

1. **Whole-file synchronous save on every write (`server/db.js` save()).**
   - At 20k students and 1 year of data: 129 MB, about 0.86 s per write, with the event loop blocked. That is roughly 1 write/s for the whole university, across enrollment, quiz autosave, attendance, DTR and cashiering.
   - Cost grows linearly with history, forever.
   - Hard failures: the V8 string limit (about 512 MB, which a UIS history import reaches), memory on 2 GB (heap ≈ 1x the JSON, plus a stringify copy, plus 2×128 MB scrypt), and in-app restore (20 MB body cap).
   - A save that throws after the in-memory change is applied leaves memory and disk out of sync.
   - *Fix:* migrate collection by collection to `node:sqlite` (no npm dependency; about 0.02 ms per durable row write, roughly 40,000x cheaper). Start with enrollments, academicRecords, attempts, attendance, timeEntries, sessions and audit. Interim: write compact JSON instead of pretty (−25% size).
2. **Quadratic read paths on a single event loop.**
   - Catalog 31.6 s, admin pending list 17.4 s, registrar home 7.5 s, academic dashboard 4.7 s at R=100.
   - Each one freezes every user on every campus while it runs.
   - In enrollment week, 50 students browsing the catalog at once means minutes of total outage.
   - *Fix (do first, days of work, highest ROI):* id, sectionId and studentId indexes plus pagination. Add a CI performance budget: a test that loads a synthetic 20k-student school and fails if catalog > 200 ms or save > 50 ms.
3. **Sign-in peak capacity and restarts.**
   - About 6 sign-ins/s (2 scrypt slots × 328 ms; slower on a t3.small, and much slower when CPU credits are exhausted: the baseline is 20% of 2 vCPUs).
   - An enrollment-morning surge of 10k students in 15 minutes (about 11/s) fills the 100-deep queue and returns 503s.
   - Auto-update restarts and in-memory sessions turn every deploy into a mass re-login.
   - *Fix:* persistent sessions, a deploy freeze during peaks, Keycloak SSO for students (which moves hashing off this box), and a right-sized instance with T3 Unlimited or a non-burstable c7i/m7i.large for peak weeks.
   - Load-test the sign-in path before go-live.
