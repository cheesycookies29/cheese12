// BDD stubs for `test/customapp-process.test.js`
// Session: custom-app-yep-2026-registration-20261127-0748. Contract: ../acceptance-contract.md.
// Each it() fails until the criterion is implemented and its real test replaces the stub.
import { describe, it } from 'node:test';

describe('US-001: 28 Nov ops half-day: freeze guard, kept release, rollback and crash logger', () => {
  // AC-006 (integration-test) → test/customapp-process.test.js
  it('GIVEN a spawned CORE child process WHEN a promise rejection goes unhandled THEN it is logged and recorded to the monitor and the server keeps answering requests', () => {
    throw new Error('Not implemented — AC-006 pending');
  });
  // AC-007 (integration-test) → test/customapp-process.test.js
  it('GIVEN a spawned CORE child process WHEN an uncaughtException is thrown THEN it is logged and recorded and the process exits with code 1', () => {
    throw new Error('Not implemented — AC-007 pending');
  });
});
