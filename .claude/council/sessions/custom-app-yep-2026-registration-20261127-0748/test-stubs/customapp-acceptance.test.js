// BDD stubs for `test/customapp-acceptance.test.js`
// Session: custom-app-yep-2026-registration-20261127-0748. Contract: ../acceptance-contract.md.
// Each it() fails until the criterion is implemented and its real test replaces the stub.
import { describe, it } from 'node:test';

describe('US-013: Tier 0 proof suite: fuzz, race and the Tier 0 acceptance rows', () => {
  // AC-081 (integration-test) → test/customapp-acceptance.test.js
  it('GIVEN a preferred guest with a reservation WHEN they arrive, when they do not arrive, and when they arrive after a manual release THEN the reservation is retrieved, stays blocked until released, and the late arrival is referred', () => {
    throw new Error('Not implemented — AC-081 pending');
  });
  // AC-082 (integration-test) → test/customapp-acceptance.test.js
  it('GIVEN a staffer choosing a non-recommended eligible table and an event with every eligible table full WHEN they assign THEN the alternative succeeds within authority and capacity and the full case allocates nothing and refers to the Super Administrator', () => {
    throw new Error('Not implemented — AC-082 pending');
  });
  // AC-083 (integration-test) → test/customapp-acceptance.test.js
  it('GIVEN one guest WHEN two devices check them in and seat them at the same time THEN there is one registration and one allocation', () => {
    throw new Error('Not implemented — AC-083 pending');
  });
  // AC-084 (integration-test) → test/customapp-acceptance.test.js
  it('GIVEN one seat left WHEN two staff assign different guests at once THEN one succeeds and the other gets 409 table_full with fresh options', () => {
    throw new Error('Not implemented — AC-084 pending');
  });
  // AC-085 (integration-test) → test/customapp-acceptance.test.js
  it('GIVEN seated and reserved guests WHEN transfer, swap and release run THEN every affected count is right, nothing is overbooked and no assignment is lost', () => {
    throw new Error('Not implemented — AC-085 pending');
  });
});

describe('US-017: Delegation, scope enforcement and My queue', () => {
  // AC-118 (integration-test) → test/customapp-acceptance.test.js
  it('GIVEN a staffer acting on a guest and a table outside their scope WHEN they assign THEN it is rejected, the Super Administrator can act or delegate, and no guest or table ever has two owners', () => {
    throw new Error('Not implemented — AC-118 pending');
  });
  // AC-119 (integration-test) → test/customapp-acceptance.test.js
  it('GIVEN staffer A is absent with pending guests and confirmed seats WHEN the Super Administrator reallocates A\'s scope to B THEN B receives the pending queue, A loses write access and confirmed assignments are intact', () => {
    throw new Error('Not implemented — AC-119 pending');
  });
});

describe('US-018: Recommendation engine', () => {
  // AC-126 (integration-test) → test/customapp-acceptance.test.js
  it('GIVEN a regular guest from Banking with and without Banking guests seated WHEN recommendations are requested THEN several eligible industry-ranked tables are offered, and other eligible tables when nothing matches', () => {
    throw new Error('Not implemented — AC-126 pending');
  });
});

describe('US-021: Group arrivals', () => {
  // AC-143 (integration-test) → test/customapp-acceptance.test.js
  it('GIVEN employees and a group arriving together WHEN they are recommended and seated THEN employees get eligible employee tables, the group gets group-fit tables, and alternatives appear when it cannot fit', () => {
    throw new Error('Not implemented — AC-143 pending');
  });
});

describe('US-022: Unlisted guests and substitutes', () => {
  // AC-149 (integration-test) → test/customapp-acceptance.test.js
  it('GIVEN an unlisted guest and a substitute for a reserved invitee WHEN they are approved and seated THEN approval, classification and audit are recorded and the original reservation is handled without a double allocation', () => {
    throw new Error('Not implemented — AC-149 pending');
  });
});

describe('US-023: Email outbox', () => {
  // AC-160 (integration-test) → test/customapp-acceptance.test.js
  it('GIVEN a confirmed seat WHEN the email fails and when the guest has no email THEN the assignment stays valid, the display works and a retry is available', () => {
    throw new Error('Not implemented — AC-160 pending');
  });
});

describe('US-025: Offline pack and paper reconciliation', () => {
  // AC-172 (integration-test) → test/customapp-acceptance.test.js
  it('GIVEN an export and paper changes made while offline WHEN they are reconciled THEN the printed pack covers every claim and re-entry by opId creates no duplicate allocation', () => {
    throw new Error('Not implemented — AC-172 pending');
  });
});

describe('US-027: Tier 2 acceptance, reuse proof and the 5 Dec client demo', () => {
  // AC-180 (integration-test) → test/customapp-acceptance.test.js
  it('GIVEN the 12 named spec scenarios WHEN customapp-acceptance runs THEN all 12 are green', () => {
    throw new Error('Not implemented — AC-180 pending');
  });
});
