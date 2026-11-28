# Council meeting context: open self-registration by QR for YEP 2026

**Topic.** Should we add to the requirements a QR code that people NOT on the guest list scan with their phone cameras to register themselves for the Legati Group Year-End Party (YEP 2026), both before the event and at the door, with the Super Administrator approving them?

**User's answers (light interview, 28 Nov 2026):** who scans = "People not on the list" (open sign-up: name, company, email, mobile; Super Administrator approves before they get a seat); when = "Both" (before the event and on the night).

**Dates.** Today 28 Nov 2026. Client decisions due 1-3 Dec; final guest list import 3 Dec; load test 1 on 4 Dec; client acceptance demo 5 Dec; load test 2 + kill drill + dress rehearsal 6 Dec; code freeze 7 Dec 18:00; deploy freeze 8 Dec 12:00; event 9 Dec (Shangri-La, Manila); close-out and personal-data purge clock 10 Dec.

**The client's spec** (.claude/council/sessions/custom-app-yep-2026-registration-20261127-0748/spec.txt):
- §4: "Display a common QR code at reception that opens a mobile-friendly registration page. Allow administrators to activate/deactivate registration. Verify the attendee against the master list using a suitable identifier; provide staff-assisted partial-name search for discrepancies. Do not expose the master guest list publicly."
- Risk table: "Privacy / early QR sharing: Use appropriate identity verification, limited public data, and registration activation controls."
- §20 deliverables: "Guest-facing registration webpage and QR code"; §22: "Common reception QR; agree on a secondary identifier or assisted verification and secure status retrieval."
- Capacity: 5 x 5 round tables x 10 chairs = 250 seats = the event maximum (decided 27 Nov). Guest list must be trimmed to 250 by 3 Dec.
- Walk-ins / unlisted guests and substitutes: referred to staff, never admitted automatically; the Super Administrator approves or rejects with a classification and industry.

**What CORE already has (Corp Comm YEP tool, module id customapp, live at https://ltdc-core.com, 0.75.0):**
- Reception QR sheet (Event control) that opens the guest page /event/<code>; listed guests verify with surname + last 4 of mobile or full email during a server-enforced check-in window (registrationOpen switch, opensAt/closesAt). Every failure gets one uniform "see the desk, code R-1234" reply; no guest list is ever exposed; event rate-limit buckets per IP/token/event; optional "presence key" (only phones that scanned the printed reception QR can check in).
- Walk-ins: staff record an unlisted guest (createUnlisted), referred to the Super Administrator's exceptions inbox, approved/rejected with classification + industry; approved walk-in is checked in; never auto-seated. Substitutes: an invitee's seat changes hands on approval.
- Personal email invitations with per-guest QR (token stored only as SHA-256), RSVP Yes/No, seat reserved at once on Yes ("Seat on Yes"), door check-in by the personal QR, and staff Scan QR (camera) in CORE.
- Email via Amazon SES from events@ltdc-core.com (production access pending). Email outbox, paused by default.
- commit() is the only writer, invariants (no table over 10, no double seat, exactly one Super Administrator), audit log, exports, load-test script, event-day runbook, deploy freeze.
- Philippine context: Data Privacy Act of 2012 (RA 10173) applies to personal data collected.

**The question for the council.** Is open QR self-registration (non-listed people, before and at the door) a good idea to add to the requirements now? What are the risks (gatecrashing, QR shared on social media, spam/fake sign-ups, capacity with a fixed 250, the client's "verify against the master list" and "do not expose" intent, data privacy/consent of people the client did not list, demo/freeze timing), what would a safe version look like (e.g. a separate pre-event "request an invitation" form with approval, a private/rotating link, caps, captcha-free anti-abuse, on-the-night walk-in requests that only create a referral), and what do you recommend?
