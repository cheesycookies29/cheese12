// BDD stubs for `test/customapp-public.test.js`
// Session: custom-app-yep-2026-registration-20261127-0748. Contract: ../acceptance-contract.md.
// Each it() fails until the criterion is implemented and its real test replaces the stub.
import { describe, it } from 'node:test';

describe('US-003: Event rate-limit buckets and the staff sign-in allowance', () => {
  // AC-016 (integration-test) → test/customapp-public.test.js
  it('GIVEN rate limits ON and TRUST_PROXY=1 WHEN 200 requests hit /api/public/event/* from one x-forwarded-for THEN none is counted in api-anon or public-write', () => {
    throw new Error('Not implemented — AC-016 pending');
  });
  // AC-017 (unit-test) → test/customapp-public.test.js
  it('GIVEN the event limiter WHEN its buckets are exercised THEN it enforces a per-event global ceiling (600/min), a per-surname failure bucket, a per-token poll bucket and a high per-IP ceiling', () => {
    throw new Error('Not implemented — AC-017 pending');
  });
});

describe('US-014: Public verify with a uniform referral reply', () => {
  // AC-086 (integration-test) → test/customapp-public.test.js
  it('GIVEN a live event and an unknown code WHEN GET /api/public/event/:code is called THEN the live event returns only name, date, state and opensAt and nothing else', () => {
    throw new Error('Not implemented — AC-086 pending');
  });
  // AC-087 (integration-test) → test/customapp-public.test.js
  it('GIVEN an open window and a guest on the list WHEN POST .../verify sends the exact normalised surname and last 4 THEN commit(selfCheckIn) runs with via self and the reply is token, state, firstName and table and seat if seated', () => {
    throw new Error('Not implemented — AC-087 pending');
  });
  // AC-088 (integration-test) → test/customapp-public.test.js
  it('GIVEN no match, an ambiguous pair, a capped surname, a malformed body, an unlisted name, a window closed mid-request, registrationOpen false and readOnly WHEN each verifies THEN every reply has the same status and a byte-identical body apart from the R-xxx code', () => {
    throw new Error('Not implemented — AC-088 pending');
  });
  // AC-090 (unit-test) → test/customapp-public.test.js
  it('GIVEN a spy on db.save() WHEN 1,000 failed verifies are sent THEN save is called 0 times and the in-memory maps stay within TTL 3 h and 5,000 entries', () => {
    throw new Error('Not implemented — AC-090 pending');
  });
  // AC-091 (unit-test) → test/customapp-public.test.js
  it('GIVEN one surname WHEN 8 distinct wrong last-4 values arrive in 15 minutes, a wrong value is repeated, 15 minutes pass, and staff clear the cap THEN the cap trips at 8 distinct values, a repeat counts once, it clears after 15 minutes or with one tap, and nobody else is locked', () => {
    throw new Error('Not implemented — AC-091 pending');
  });
  // AC-092 (unit-test) → test/customapp-public.test.js
  it('GIVEN 31 failures within 5 minutes WHEN the next genuine guest verifies THEN an alarm is raised to the Super Administrator and the genuine guest still succeeds', () => {
    throw new Error('Not implemented — AC-092 pending');
  });
  // AC-093 (unit-test) → test/customapp-public.test.js
  it('GIVEN window.opensAt WHEN verify arrives one second before and one second after THEN the first gets the uniform referral reply and the second proceeds', () => {
    throw new Error('Not implemented — AC-093 pending');
  });
  // AC-094 (unit-test) → test/customapp-public.test.js
  it('GIVEN a form-encoded body, a 2 KB body, an 81-character surname, last4 abc1, a partial email, a filled trap field and a denylisted user agent WHEN each verifies THEN each gets the uniform reply, no field is echoed and the order is limiter, window, match', () => {
    throw new Error('Not implemented — AC-094 pending');
  });
  // AC-095 (integration-test) → test/customapp-public.test.js
  it('GIVEN limits ON and TRUST_PROXY=1 WHEN 300 verifies plus status polling arrive from one x-forwarded-for THEN there are zero 429s and the soft cap still trips for a brute-forced surname', () => {
    throw new Error('Not implemented — AC-095 pending');
  });
  // AC-096 (integration-test) → test/customapp-public.test.js
  it('GIVEN a referral code R-482 from a failed verify WHEN staff call GET .../referral/R-482 THEN they see the real reason and what the guest typed, masked', () => {
    throw new Error('Not implemented — AC-096 pending');
  });
});

describe('US-015: Guest status page and status token', () => {
  // AC-097 (unit-test) → test/customapp-public.test.js
  it('GIVEN a successful verify WHEN the token is issued, a sixth device verifies, staff revoke one and the server restarts THEN the token is 32 random bytes stored as SHA-256, at most 5 are kept, the revoked one fails and the rest survive the restart', () => {
    throw new Error('Not implemented — AC-097 pending');
  });
  // AC-098 (integration-test) → test/customapp-public.test.js
  it('GIVEN a valid token WHEN GET .../status is called with the token in X-Event-Token, in the query string and with ?since=seq THEN only the header works and the reply holds only this guest\'s seq, pollMs, state, title, firstName, table and seat, or unchanged', () => {
    throw new Error('Not implemented — AC-098 pending');
  });
  // AC-099 (integration-test) → test/customapp-public.test.js
  it('GIVEN a verify and 20 status polls WHEN monitor, audit and devlog output are scanned THEN the token never appears and every reply carries Cache-Control no-store and Referrer-Policy no-referrer', () => {
    throw new Error('Not implemented — AC-099 pending');
  });
  // AC-100 (unit-test) → test/customapp-public.test.js
  it('GIVEN a guest already checked in on one phone WHEN they verify again from a second phone THEN there is no second check-in, the same status is returned and a reverified_other_device flag is added for staff', () => {
    throw new Error('Not implemented — AC-100 pending');
  });
  // AC-101 (integration-test) → test/customapp-public.test.js
  it('GIVEN a live event WHEN /event/<code> is requested THEN public/event.html is served under 40 KB with its CSP hash in pagePolicy, noindex and no-store and no web fonts', () => {
    throw new Error('Not implemented — AC-101 pending');
  });
});

describe('US-016: Zero-typing QR presence key (Should)', () => {
  // AC-106 (unit-test) → test/customapp-public.test.js
  it('GIVEN an event with qrKeyHash set WHEN verify is sent with the correct k, a wrong k and no k THEN the correct key proceeds and the others get the uniform referral reply, and the key is stored only as a hash', () => {
    throw new Error('Not implemented — AC-106 pending');
  });
});
