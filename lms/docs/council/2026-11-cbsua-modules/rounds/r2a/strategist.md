# Strategist (gold): Round 2b answers

FROM: Advocate
A: Yes, all three become W1 gates, because a lost quiz or a mass sign-out in week one would undo the "new system" goodwill W1 is meant to earn. Persisted sessions plus the deploy freeze (no auto-update; deploys only in a declared window) are gates. So is the quiz `localStorage` mirror with retry and a visible offline/saving/saved state, which is client-side work measured in days. Self-service recovery is met by putting students on CBSUA's Keycloak, which was already the W1 SSO item; if student SSO is not live at go/no-go, W1 falls back to the pilot cohort below. Registrar bulk approve and the type-ahead selects move to W4, because W1 turns self-enrollment off (see Skeptic).
FOLLOW-UP: Does CBSUA's Keycloak already hold a working recovery email or mobile number for each student, or does W1 also need a one-time "confirm your email" campaign before January?

FROM: Guardian
A: The privacy notice on sign-in and registration is a W1 gate, and so is a W1-scoped PIA covering identity, coursework and sign-in metadata. A full PIA per module then gates each later wave before its sensitive PI arrives. The CBSUA-LTDC outsourcing agreement naming AWS and Cloudflare is a W1 gate: LTDC drafts it this week, and any live data, pilot included, needs it signed. Guardian consent stops being a W1 issue because W1 cuts scope: guardian/parent links and public self-registration are off on CBSUA's instance, and the consent flow ships with W3, when grades are the data being shared.
FOLLOW-UP: Will you accept a W1-scoped PIA, signed by CBSUA's DPO and covering home and Learn only, as sufficient for January, with the module PIAs scheduled as W2-W5 entry gates?

FROM: Operator
A: Yes to all four as W1 gates. Together they are a few days of work and about US$60-110 a month, which is cheap insurance. Hourly backups go to versioned S3 in a separate AWS account, in Singapore until the PIA clears a second region. Object Lock gets a finite retention (for example 35 days) so that expiry, not deletion, settles Guardian's erasure question. The other three: an external `/healthz` alert to one named LTDC person and one named CBSUA ICT person, a protected `release/cbsua` branch with tagged releases, and `atlas.cbsua.edu.ph`. I add two more: one timed restore rehearsal before go-live, and t3.medium Unlimited for the first two weeks of the semester.
FOLLOW-UP: Has CBSUA ICT named someone who will take an alert at 22:00, or does LTDC hold the pager alone for W1 and write it into the support terms?

FROM: Skeptic
A: Yes, W1 is gated on the index and pagination fix, and I am also cutting the exposure. CBSUA's W1 imports block sections, so Learn's self-enrollment catalog is switched off until W4. The indexes still matter for the admin pending list and the registrar home figures (17.4 s and 7.5 s). The annex will not claim separation of duties until two changes land: the admin role loses Finance transactional powers and the own-requisition exemption, and payroll finalize requires a second person. Until then it claims only what is true (DV self-approval block, grade-change approver, hash-chained audit). The payroll checker gates W2's payroll cutover, the admin/Finance split gates W5, and the grade approve/post different-person rule plus a second approver for credits gate W3.
FOLLOW-UP: For the annex wording before those fixes land, is "maker-checker on DVs and grade changes; full SoD matrix delivered per wave with acceptance tests" honest enough for you, or would you have it left out entirely?

FROM: Tuner
A: Yes, I concede: the indexes, pagination and the 60 s figures cache are a W1 entry gate. Moving the hot write paths off the whole-file save is also a W1 gate: quiz attempts, attendance, sessions and the sign-in audit tail go to `node:sqlite`, with compact JSON as the interim. Quiz windows and the first two weeks of the semester are a write peak, not "spread across the term", and I was wrong on that. The full migration (academicRecords, issuedDocuments, timeEntries, Finance transactions) stays sequenced as the entry gate for the UIS import (W3) and enlistment (W4), not for W1. It is still bounded by the CI performance budget, so W1 cannot quietly drift past 200 ms.
FOLLOW-UP: With attempts, attendance and sessions moved out, what save time do you measure for a realistic W1 dataset (about 20k students, one semester, Learn only, no UIS history), and does it stay under 50 ms?

REVISED W1 GATE (go/no-go meeting 2027-01-08; target date unchanged: 2nd-semester start, Jan 2027)
Scope cut first (removes risk, adds no work): W1 = ATLAS home + Learn (block-section import) + System only. Self-enrollment catalog, guardian/parent links, public self-registration, chat, question banks, certificates, and the Facilities and REX tiles are all off on CBSUA's instance.
Engineering (LTDC controls these, about 3 weeks):
1. In-memory indexes, admin-list pagination and a cached home-figures endpoint. The CI budget passes on a synthetic 20k-student school: catalog/pending < 200 ms, save < 50 ms.
2. Quiz attempts, attendance, sessions and the audit tail on `node:sqlite`. Sessions survive a restart. A failed save rolls back memory.
3. Quiz `localStorage` mirror, retry with backoff and a visible save state.
4. Keycloak SSO for students and staff, with self-service reset through Keycloak and MFA for admin accounts. A sign-in load test at 11/s passes with no 503s.
Operations (LTDC):
5. Auto-update off. Deploys come from a protected `release/cbsua` branch, in declared windows only, with a freeze calendar.
6. Hourly off-site backups (separate account, versioned, finite Object Lock), plus one timed restore rehearsal.
7. External uptime and disk alerts to named LTDC and CBSUA contacts, a one-page incident runbook, t3.medium Unlimited for the peak weeks, and `atlas.cbsua.edu.ph` live.
Governance (CBSUA controls these, so they must start now):
8. The CBSUA-LTDC outsourcing agreement naming AWS and Cloudflare is signed.
9. A W1-scoped PIA is signed by the DPO. The privacy notice is live on sign-in.
10. The success metric is agreed: share of the semester's classes active in Learn by week 4, with zero mass sign-outs.
Date: it holds only as a conditional go/no-go.
- If items 1-7 slip but 8-9 are signed: launch to a pilot cohort (one campus or college, 3k students or fewer) in January. lms2 stays up for everyone else, and Learn goes university-wide at the AY 2027-28 start, together with W4.
- If 8-9 are not signed: no go. lms2 continues and W1 moves to the midyear term. W2 People slips with it, because it needs the same agreement for more sensitive data.
