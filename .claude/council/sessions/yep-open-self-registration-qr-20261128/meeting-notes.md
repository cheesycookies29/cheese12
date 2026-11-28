# Council Meeting: open QR self-registration for YEP 2026
**Date:** 2026-11-28
**Panel:** Strategist, Skeptic, Guardian, Advocate, Architect
**Format:** discussion only. Orchestration: sequential (no agent teams). The panel converged in the opening round, and each member's cross-questions were answered by another member's opening position, so no further rounds were run.

## Topic
Add to the YEP 2026 requirements a QR code that people **not on the guest list** scan to register themselves, **before the event and at the door**, with the Super Administrator approving them.

## Opening Perspectives
- **Strategist:** Not now. The room is 250 seats and the list is trimmed to 250 by 3 Dec, so every approved self-registrant either displaces an invitee or breaks capacity. The spec ("verify against the master list", "do not expose") describes a closed event. At most: before 3 Dec only, a private link the client shares by hand that creates a referral and nothing else. Open public sign-up: Won't-have for YEP 2026.
- **Skeptic:** It contradicts spec §4. A photographed reception QR shared in a Viber group brings hundreds of believable requests the Super Administrator cannot vet mid-event; there is no captcha; people who "registered" will expect entry when seats are full; and it collects personal data from strangers. Door version: Critical risk. Public pre-event form: High. Safe alternative: the existing staff walk-in flow; if anything before the event, a "request an invitation" link with an automatic cap, where approval issues a normal invitation.
- **Guardian:** Legati Group/ICD is the controller and LTDC/CORE the processor (RA 10173 s.14). Collecting data on people the client never listed needs the client's written instruction, its lawful basis, and a notice at collection (controller, purpose, retention to 10 Dec, DPO contact). Minimal form (name, company, one contact), rejected requests deleted at once, the 10 Dec purge covering exports, outbox, audit and backups. Without written client authority: do not build it.
- **Advocate:** Most "unlisted" people are invitees whose names were mistyped; they need matching (the desk code and partial-name search), not a stranger's sign-up that creates duplicates. A phone saying "pending" with no time leaves someone stuck in the lobby while the Super Administrator faces 30+ faceless requests. Never two QR codes at reception (listed guests would scan the wrong one), and a "Not on the list? Request a seat" button would reveal who is on the list. If anything: a private pre-event request link for hosts, closing 3 Dec.
- **Architect:** About 60% exists (createUnlisted → pending → approve/reject). What is new is a trust boundary: a signed-out form that writes to the data file (new actor, change type, a requestsOpen switch, a cap on pending requests), a capacity check on approval, and, for the pre-event mode, a way for an approved requester to get in (today unlisted guests cannot be invited and are desk-only). Door-only request: about 1 day plus guides and tests. Both modes: 4-5 days. Neither fits before the 5 Dec demo safely.

## Cross-Examination Highlights
1. **Everyone asked the same question: did the client ask for this?** Strategist, Skeptic, Guardian, Advocate and Architect each raised it. The spec asks for a closed list verified at a common reception QR; open sign-up is new scope proposed by us, not the client.
2. **Strategist → Architect (can it reuse the walk-in path?):** Yes for the core (approval kind "request"), but a signed-out form that writes data is a new trust boundary, and an approved advance requester has no credential to enter with unless invitations are extended to unlisted guests (Architect).
3. **Strategist/Advocate → Guardian (consent and purge for rejected requesters):** The client's lawful basis and notice are required; rejected requests deleted immediately; the 10 Dec purge must reach every copy (Guardian).
4. **Skeptic → Architect (before the 5 Dec demo without touching invariants?):** Door-only ~1 day; both modes 4-5 days and touches approve, invite, the outbox and SES (Architect). Not before the demo.

## Key Insights
- **Strategist:** With 250 seats and a 250-name list, open registration has no seats to give; the real question is how many seats the client wants to hold back.
- **Skeptic:** A public QR cannot be kept private; once photographed it is an open door.
- **Guardian:** This is the client's data decision, not ours; build nothing without their written instruction.
- **Advocate:** The people it would help are mostly listed guests with misspelled names, already served by the desk.
- **Architect:** The approval core exists; the costly parts are a new public write path and getting approved requesters through the door.

## Unresolved Tensions
- Whether a small, private, pre-event "request an invitation" link (for hosts, closing 3 Dec, approval sends a normal personal invitation) is worth 1-3 days in the last week before the demo, or should wait for the next event.
- Who tells a person in the lobby "no", how, and how fast, if requests are allowed at the door.

## Questions for You
1. **Did Legati Group/ICD ask for open self-registration?** If not, should it be raised with them as an option rather than added?
2. **How many of the 250 seats should be held back for people not on the list?** If zero, there is nothing to register for.
3. If the client wants it: **will ICD authorise in writing** collecting data from people it did not list, and provide the privacy notice text?

## Recommended Next Steps
1. **Do not add open QR self-registration to the YEP 2026 requirements.** Keep the spec's single reception QR for listed guests and the existing staff walk-in flow (createUnlisted → Super Administrator approves) on the night. Unanimous.
2. **Raise it with the client as an option** in the 1-3 Dec decisions: "Do you want people not on the list to be able to request a seat before 3 Dec? If yes: how many seats to hold back, and your written instruction and privacy notice." Only with a yes, build the small version: a private request link (not a public QR) for hosts, closing 3 Dec, capped, approval sends a normal personal invitation; never at the door.
3. **Instead, before the demo, invest in what the panel saw as the real need:** making sure misspelled invitees are found fast at the desk (partial-name search, the desk code) and that walk-ins are handled smoothly by staff.
