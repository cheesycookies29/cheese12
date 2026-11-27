// BDD stubs for `test/customapp-sync.test.js`
// Session: custom-app-yep-2026-registration-20261127-0748. Contract: ../acceptance-contract.md.
// Each it() fails until the criterion is implemented and its real test replaces the stub.
import { describe, it } from 'node:test';

describe('US-019: Live sync by short poll', () => {
  // AC-127 (unit-test) → test/customapp-sync.test.js
  it('GIVEN a client at the current seq WHEN it calls changes?since=seq THEN the reply is seq, pollMs and unchanged true and no board is built', () => {
    throw new Error('Not implemented — AC-127 pending');
  });
  // AC-128 (integration-test) → test/customapp-sync.test.js
  it('GIVEN seq has moved WHEN an owner and a non-owner poll THEN each gets seq, pollMs and a board scoped by the access policy, with no contact fields for the non-owner', () => {
    throw new Error('Not implemented — AC-128 pending');
  });
  // AC-129 (unit-test) → test/customapp-sync.test.js
  it('GIVEN a poll with wait=25 WHEN it is answered THEN it returns at once as if wait were absent', () => {
    throw new Error('Not implemented — AC-129 pending');
  });
  // AC-130 (unit-test) → test/customapp-sync.test.js
  it('GIVEN a restored standby whose seq is behind the client\'s since WHEN the client polls THEN it receives a full board', () => {
    throw new Error('Not implemented — AC-130 pending');
  });
  // AC-131 (integration-test) → test/customapp-sync.test.js
  it('GIVEN default pacing WHEN staff and guests poll and the Super Administrator raises pollMs THEN staff get 2 s, pending guests 4 s and seated guests 10 s with jitter, and 8 s guests / 4 s staff apply on the next reply with no deploy', () => {
    throw new Error('Not implemented — AC-131 pending');
  });
  // AC-132 (integration-test) → test/customapp-sync.test.js
  it('GIVEN staffer A\'s guests reallocated to B WHEN A polls next THEN A\'s queue no longer contains them', () => {
    throw new Error('Not implemented — AC-132 pending');
  });
  // AC-134 (unit-test) → test/customapp-sync.test.js
  it('GIVEN CHANGE_TYPES in shared/customapp/statuses.js WHEN any change record is written THEN its type is in the closed set', () => {
    throw new Error('Not implemented — AC-134 pending');
  });
});
