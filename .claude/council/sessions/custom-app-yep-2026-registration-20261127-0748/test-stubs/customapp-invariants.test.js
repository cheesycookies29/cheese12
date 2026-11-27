// BDD stubs for `test/customapp-invariants.test.js`
// Session: custom-app-yep-2026-registration-20261127-0748. Contract: ../acceptance-contract.md.
// Each it() fails until the criterion is implemented and its real test replaces the stub.
import { describe, it } from 'node:test';

describe('US-007: commit() unit of work, claimsAt(), invariants and typed refusals', () => {
  // AC-038 (unit-test) → test/customapp-invariants.test.js
  it('GIVEN SEAT_STATUSES WHEN a status is added without a classification or any file other than seating.js counts by seat.status THEN the test fails', () => {
    throw new Error('Not implemented — AC-038 pending');
  });
  // AC-039 (unit-test) → test/customapp-invariants.test.js
  it('GIVEN a valid event state WHEN each of I1 to I10 is broken by hand THEN checkInvariants returns that rule with the ids involved', () => {
    throw new Error('Not implemented — AC-039 pending');
  });
});

describe('US-020: Safety nets: 5-minute export copies and the 60 s invariant self-check', () => {
  // AC-137 (unit-test) → test/customapp-invariants.test.js
  it('GIVEN the 60 s self-check WHEN a violation is introduced THEN the next run records it to the monitor for the health strip banner', () => {
    throw new Error('Not implemented — AC-137 pending');
  });
});
