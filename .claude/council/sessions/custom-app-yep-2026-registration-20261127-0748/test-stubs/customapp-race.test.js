// BDD stubs for `test/customapp-race.test.js`
// Session: custom-app-yep-2026-registration-20261127-0748. Contract: ../acceptance-contract.md.
// Each it() fails until the criterion is implemented and its real test replaces the stub.
import { describe, it } from 'node:test';

describe('US-013: Tier 0 proof suite: fuzz, race and the Tier 0 acceptance rows', () => {
  // AC-080 (integration-test) → test/customapp-race.test.js
  it('GIVEN one free seat and a real listening server WHEN 10 parallel requests claim it and two parallel check-ins target one guest THEN one 200 and nine 409 table_full, one check-in, and invariants []', () => {
    throw new Error('Not implemented — AC-080 pending');
  });
});

describe('US-029: Load test 2 with the kill -9 drill and the dress rehearsal', () => {
  // AC-196 (integration-test) → test/customapp-race.test.js
  it('GIVEN the freeze candidate WHEN the race test runs 5 times THEN every run gives one 200, nine 409s and invariants []', () => {
    throw new Error('Not implemented — AC-196 pending');
  });
});
