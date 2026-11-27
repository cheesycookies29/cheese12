// BDD stubs for `test/customapp-scope.test.js`
// Session: custom-app-yep-2026-registration-20261127-0748. Contract: ../acceptance-contract.md.
// Each it() fails until the criterion is implemented and its real test replaces the stub.
import { describe, it } from 'node:test';

describe('US-005: CUSTOM APP module shell and the Event staff account type', () => {
  // AC-026 (integration-test) → test/customapp-scope.test.js
  it('GIVEN an eventstaff user WHEN they call other module APIs and open the app THEN they see only CUSTOM APP and other modules answer 403', () => {
    throw new Error('Not implemented — AC-026 pending');
  });
});

describe('US-011: Event Super Administrator and runtime flags', () => {
  // AC-068 (integration-test) → test/customapp-scope.test.js
  it('GIVEN a CORE admin with * who is not the event\'s superAdminUserId WHEN they post a seat command THEN it is refused with 403', () => {
    throw new Error('Not implemented — AC-068 pending');
  });
});

describe('US-017: Delegation, scope enforcement and My queue', () => {
  // AC-109 (unit-test) → test/customapp-scope.test.js
  it('GIVEN guests and tables WHEN the Super Administrator delegates them and a staffer tries to delegate THEN each has at most one active owner, only the Super Administrator can delegate and no seat changes', () => {
    throw new Error('Not implemented — AC-109 pending');
  });
  // AC-110 (unit-test) → test/customapp-scope.test.js
  it('GIVEN a transfer whose destination table belongs to another staffer WHEN the plan is checked THEN eventCan rejects the whole plan with out_of_scope or needs_super_admin', () => {
    throw new Error('Not implemented — AC-110 pending');
  });
  // AC-111 (integration-test) → test/customapp-scope.test.js
  it('GIVEN staffer A owns guests and tables WHEN the Super Administrator reallocates them to B THEN A\'s next write gets 403, B can write and confirmed claims stay intact', () => {
    throw new Error('Not implemented — AC-111 pending');
  });
  // AC-112 (unit-test) → test/customapp-scope.test.js
  it('GIVEN owned and unowned guests, an unlisted pending guest, a flagged guest and a released preferred guest who arrived WHEN queues are derived THEN owned guests are in their owner\'s queue and the rest in the Super Administrator\'s queue', () => {
    throw new Error('Not implemented — AC-112 pending');
  });
});

describe('US-021: Group arrivals', () => {
  // AC-140 (unit-test) → test/customapp-scope.test.js
  it('GIVEN a group whose members have different owners WHEN a staffer tries to seat it THEN it is refused with needs_super_admin and the Super Administrator can seat it', () => {
    throw new Error('Not implemented — AC-140 pending');
  });
});
