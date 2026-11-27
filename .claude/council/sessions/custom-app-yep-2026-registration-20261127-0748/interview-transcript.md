## Round 1

**Q (Strategist):** What is CUSTOM APP in CORE: a one-off YEP module or a reusable area for client apps?
**A:** Reusable area, YEP first. A CUSTOM APP module that can hold client apps; YEP registration is the first, built as a reusable event-registration engine (event, guests, tables) with YEP 2026 as its first event.

**Q (Architect/Guardian):** Staff sign-in: CORE accounts with event roles, or separate event-only logins?
**A:** CORE accounts + event roles. Personnel get CORE accounts (possibly a limited "Event staff" account type that only opens CUSTOM APP); the Super Administrator is one designated account per event. Reuse CORE sign-in, 2-step, sessions and audit.

**Q (Skeptic):** What does a guest type on the common QR page to identify themselves?
**A:** Name + last 4 digits of mobile (or email). One exact match checks them in; anything else goes to staff-assisted search. Nothing listed publicly.

**Q (Operator):** Where does the event run on 9 December?
**A:** The current CORE production server on EC2 (same domain, guest page e.g. /event/<code>); freeze deploys on event day; load-test beforehand.
