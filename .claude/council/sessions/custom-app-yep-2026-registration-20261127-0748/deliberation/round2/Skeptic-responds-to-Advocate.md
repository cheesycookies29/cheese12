## Skeptic Response to Advocate

**Their position:** The guest flow should have as little friction as possible. That means surname plus last 4 of mobile, or the full email, with lenient Filipino-name normalisation. Re-verifying from any device should return the same status and table "with no scolding". Every failure should give a referral code (R-482) that pre-fills the desk search, never "not found".

**My response:** Modify

**Reasoning:** Most of what Advocate wants does not weaken the control. My Round 1 tied two things together that should be separate. Surname strictness is not a security control: the attacker in my threat model already knows the surname. The secret is the last 4 digits, and the control that matters is time (spec line 267: "registration activation"). So I accept lenient normalisation in full: NFKD, strip diacritics, lowercase, drop spaces, hyphens, periods and apostrophes, strip "Jr./Sr./III", and match stored aliases. This was already my own P0 edge case. I attach one condition: matching stays **exact on the normalised form**. No edit-distance or "did you mean" matching, because fuzzy matching is what would really increase multi-match and enumeration.

Advocate's claim that leniency creates many multi-match cases is weak. A collision needs both the same normalised surname and the same last 4. Among about 300 guests, that happens almost only on a shared corporate line. So we find these cases before the event: the import preflight lists every ambiguous pair and every guest with no mobile and no email. The Super Administrator then fixes the record (adds the full email, a direct mobile, or marks the guest "desk only"), and nothing is left to chance on the night.

I also accept the referral code. It fits with my uniform-reply rule as long as these conditions hold:
- **Every** guest-level failure (no match, ambiguous, capped, unlisted) returns byte-identical copy and status code, and a code drawn from one random pool. There is no per-reason prefix and no difference in timing.
- The server stores the reason next to the code, and only authenticated staff can see it.
- The code carries only what the guest typed, never master-list data.

I withdraw one part of my Round 1: "a second self-check-in does not re-show the seat". Look at who could be harmed. A spoofer who already knows the surname and last 4 learns only a table number. The real guest who re-verifies on a second phone is the common case and should simply see their status. So re-verify is idempotent, has no scolding copy, and shows title or first name, table and seat only. It creates no second check-in, and it flags the record "verified again from another device" for staff. Advocate proposed that flag, and it replaces my scolding branch.

I **maintain** the hashed random status token, and I don't see it as opposed to re-verification. Each successful verify mints a new per-device token: 32 bytes, stored as SHA-256, revocable by staff. The status page polls with that token. The alternative, re-deriving status on every poll, would mean resending surname and last 4 every few seconds. That puts credentials in a polling loop and logs, and every typo-free poll would count against the failure caps.

On lockouts, I agree with Advocate's concern and **modify** my position. A hard per-surname lockout lets one person block "Dela Cruz" at the door. It becomes a **soft cap**:
- 8 failed attempts per (event, normalised surname) in 15 minutes switch that surname to the uniform desk reply. The cap clears automatically after 15 minutes, and any staffer can clear it from the referral record.
- The cost in the worst case is one guest walking about 10 metres to a desk that exists anyway.
- An event-wide failure-rate alarm tells the Super Administrator about probing.

One more option is a rotating 4-digit desk code shown on the reception screen. It would be required only for a surname that is capped, or for any self-verify before doors-open. The real guest in the room passes straight through, and a remote spoofer cannot. This is P1 and only goes in if Strategist confirms there is time.

These conditions are non-negotiable for my Modify:
- The activation window is enforced server-side, from doors-open. Before that, an event-level "opens at 6:00 PM" page is shown, and it accepts no input.
- The preflight collision report is run and cleared before activation.
- Guest-level failures have identical replies.
- The status token is per device, and polling never sends surname or last 4.
- The public limiter is keyed per event and per surname, not per IP, so the venue NAT does not turn my own control into the outage Advocate and I both found.

The residual risk is a pre-arrival spoof by someone who knows a colleague's direct mobile. This stays accepted. It is bounded by the activation window, the usher's "show this screen" step and the re-verify flag.
