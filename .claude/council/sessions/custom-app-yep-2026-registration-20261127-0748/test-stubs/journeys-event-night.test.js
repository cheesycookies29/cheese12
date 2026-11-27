// BDD stubs for `scripts/journeys.mjs`
// Session: custom-app-yep-2026-registration-20261127-0748. Contract: ../acceptance-contract.md.
// Each it() fails until the criterion is implemented and its real test replaces the stub.
import { describe, it } from 'node:test';

describe('US-002: Restore carve-out keeps live event data', () => {
  // AC-012 (e2e-test) → scripts/journeys.mjs
  it('GIVEN an event is live WHEN an administrator opens the Admin restore screen THEN it shows "Event data is not part of a CORE restore"', () => {
    throw new Error('Not implemented — AC-012 pending');
  });
});

describe('US-008: Guest import with collision report', () => {
  // AC-053 (e2e-test) → scripts/journeys.mjs
  it('GIVEN an import with 3 unresolved issues WHEN the Super Administrator opens Setup then Import check THEN each problem shows a count with a fix action and Open registration is disabled with "3 issues to resolve" until cleared or acknowledged', () => {
    throw new Error('Not implemented — AC-053 pending');
  });
});

describe('US-010: Staff Find guest and seating screens', () => {
  // AC-064 (e2e-test) → scripts/journeys.mjs
  it('GIVEN a staff phone at 390 px WHEN the staffer taps a guest card and then a table THEN the first free seat is preselected and Confirm reads "Seat at Table 5"', () => {
    throw new Error('Not implemented — AC-064 pending');
  });
  // AC-065 (e2e-test) → scripts/journeys.mjs
  it('GIVEN a table with 6 confirmed and 2 reserved seats and a full table WHEN the seating sheet opens THEN the meter shows filled and ring dots with "6 seated · 2 reserved · 2 free" and the full table cannot be chosen', () => {
    throw new Error('Not implemented — AC-065 pending');
  });
  // AC-066 (e2e-test) → scripts/journeys.mjs
  it('GIVEN two staff phones on the last seat of Table 5 WHEN both confirm THEN one seats the guest and the other\'s sheet re-renders in place with the guest still selected and "Table 5 just filled. Updated options:"', () => {
    throw new Error('Not implemented — AC-066 pending');
  });
  // AC-067 (e2e-test) → scripts/journeys.mjs
  it('GIVEN the staff screens in both CORE themes WHEN checked at 390 px with the keyboard THEN nothing is wider than 390 px, inputs are at least 16 px, targets at least 48 px, badges and meters carry text and contrast meets WCAG AA', () => {
    throw new Error('Not implemented — AC-067 pending');
  });
});

describe('US-015: Guest status page and status token', () => {
  // AC-102 (e2e-test) → scripts/journeys.mjs
  it('GIVEN a guest phone WHEN the page is opened before the window, verified, left pending, seated, referred and taken offline THEN it shows the closed, verify, pending, seated, referred and offline states and never says not found, invalid, already checked in, a countdown, a lock screen or a 429', () => {
    throw new Error('Not implemented — AC-102 pending');
  });
  // AC-103 (e2e-test) → scripts/journeys.mjs
  it('GIVEN a verified guest page WHEN the page is reloaded THEN the status returns from the #s= fragment and the localStorage copy without verifying again', () => {
    throw new Error('Not implemented — AC-103 pending');
  });
  // AC-104 (e2e-test) → scripts/journeys.mjs
  it('GIVEN a pending guest page WHEN the seat is confirmed by staff THEN the aria-live polite region announces it, focus moves to the result heading and the status line reads Updated with the time', () => {
    throw new Error('Not implemented — AC-104 pending');
  });
});

describe('US-016: Zero-typing QR presence key (Should)', () => {
  // AC-107 (e2e-test) → scripts/journeys.mjs
  it('GIVEN the reception QR sheet printed with public/js/vendor/qrcode.js WHEN a guest phone opens its link THEN the page sends k with verify without the guest typing it', () => {
    throw new Error('Not implemented — AC-107 pending');
  });
});

describe('US-017: Delegation, scope enforcement and My queue', () => {
  // AC-113 (e2e-test) → scripts/journeys.mjs
  it('GIVEN an Event staff account WHEN it signs in THEN it lands on My queue with the sticky bar, the three sections, oldest first, and cards with a text class badge and a wait timer amber at 4 minutes and red at 8', () => {
    throw new Error('Not implemented — AC-113 pending');
  });
  // AC-114 (e2e-test) → scripts/journeys.mjs
  it('GIVEN a guest in staffer A\'s queue WHEN the Super Administrator moves it to Maria THEN A sees it grey out with "Moved to Maria\'s queue by the Super Administrator" and the time before it leaves, and A\'s next write on it shows a recovery screen', () => {
    throw new Error('Not implemented — AC-114 pending');
  });
  // AC-115 (e2e-test) → scripts/journeys.mjs
  it('GIVEN a staffer with tables 5, 6 and 7 and no one waiting WHEN My queue renders THEN it reads "No one is waiting for you. Your tables: 5, 6, 7 (14 seats left)."', () => {
    throw new Error('Not implemented — AC-115 pending');
  });
  // AC-116 (e2e-test) → scripts/journeys.mjs
  it('GIVEN a guest with a capped surname and referral code R-482 WHEN staff type R-482 in Find guest THEN the real reason and what the guest typed appear and Clear cap and check in works in one tap', () => {
    throw new Error('Not implemented — AC-116 pending');
  });
  // AC-117 (e2e-test) → scripts/journeys.mjs
  it('GIVEN a guest phone, two staff phones and the Super Administrator\'s desk on one server WHEN npm run journeys runs THEN the Event night, four devices journey is green', () => {
    throw new Error('Not implemented — AC-117 pending');
  });
});

describe('US-018: Recommendation engine', () => {
  // AC-125 (e2e-test) → scripts/journeys.mjs
  it('GIVEN a regular guest WHEN the bottom sheet opens THEN up to 3 recommendations show reason lines, Other eligible tables is collapsed below and a read-only Not yours list follows', () => {
    throw new Error('Not implemented — AC-125 pending');
  });
});

describe('US-019: Live sync by short poll', () => {
  // AC-133 (e2e-test) → scripts/journeys.mjs
  it('GIVEN a staff board WHEN the tab is hidden, then the network drops for 15 s THEN polling pauses while hidden, backs off while offline and the sticky bar turns amber with Reconnecting…', () => {
    throw new Error('Not implemented — AC-133 pending');
  });
});

describe('US-021: Group arrivals', () => {
  // AC-141 (e2e-test) → scripts/journeys.mjs
  it('GIVEN three selected guests WHEN the staffer taps Seat together (3) and later tries a split THEN only fitting tables are ranked, the split needs an explicit Split group confirm, and a mixed-owner group shows Send group to Super Administrator', () => {
    throw new Error('Not implemented — AC-141 pending');
  });
});

describe('US-022: Unlisted guests and substitutes', () => {
  // AC-147 (e2e-test) → scripts/journeys.mjs
  it('GIVEN Find guest WHEN a staffer uses Add walk-in and Record substitute THEN both reach the Super Administrator\'s inbox and the substitute shows as "Seat 3-4: Juan Reyes replaces Pedro Reyes"', () => {
    throw new Error('Not implemented — AC-147 pending');
  });
});

describe('US-023: Email outbox', () => {
  // AC-158 (e2e-test) → scripts/journeys.mjs
  it('GIVEN email is cut WHEN a seated guest\'s page renders THEN the email sent line is replaced by Screenshot this screen and staff email surfaces are hidden', () => {
    throw new Error('Not implemented — AC-158 pending');
  });
});

describe('US-024: Event control dashboard', () => {
  // AC-162 (e2e-test) → scripts/journeys.mjs
  it('GIVEN the Super Administrator\'s desk WHEN Event control opens THEN every table has a tile with number, class label, meter with a text count and owner, and a full table is dimmed and labelled Full', () => {
    throw new Error('Not implemented — AC-162 pending');
  });
  // AC-164 (e2e-test) → scripts/journeys.mjs
  it('GIVEN two staffers with waiting guests WHEN the workload table is used to Move a guest and a table THEN it shows staffer, waiting, longest wait and last active and the move is applied through commit()', () => {
    throw new Error('Not implemented — AC-164 pending');
  });
  // AC-166 (e2e-test) → scripts/journeys.mjs
  it('GIVEN Event control WHEN the Super Administrator turns off registrationOpen, releases a reservation and tries to remove a table with guests THEN each confirm names its effect, the release confirm names guest, table and seat, and removal is disabled with Move guests…', () => {
    throw new Error('Not implemented — AC-166 pending');
  });
  // AC-167 (e2e-test) → scripts/journeys.mjs
  it('GIVEN seated guests WHEN the Super Administrator transfers, swaps and releases from Event control THEN each goes through commit() and every device shows the new counts on its next poll', () => {
    throw new Error('Not implemented — AC-167 pending');
  });
});
