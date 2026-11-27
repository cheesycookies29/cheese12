// BDD stubs for `test/customapp-flags.test.js`
// Session: custom-app-yep-2026-registration-20261127-0748. Contract: ../acceptance-contract.md.
// Each it() fails until the criterion is implemented and its real test replaces the stub.
import { describe, it } from 'node:test';

describe('US-011: Event Super Administrator and runtime flags', () => {
  // AC-070 (unit-test) → test/customapp-flags.test.js
  it('GIVEN a staffer and the Super Administrator WHEN each sends setFlag for registrationOpen, emailPaused, readOnly and pollMs THEN only the Super Administrator succeeds and each change is audited', () => {
    throw new Error('Not implemented — AC-070 pending');
  });
  // AC-071 (unit-test) → test/customapp-flags.test.js
  it('GIVEN each of the four flags WHEN its effect is traced THEN it is checked inside commit() or returned in the poll reply', () => {
    throw new Error('Not implemented — AC-071 pending');
  });
  // AC-072 (unit-test) → test/customapp-flags.test.js
  it('GIVEN readOnly is on WHEN staff post any command, the Super Administrator posts a reconcile command and anyone reads THEN commands get 409 read_only, the reconcile command is accepted and reads are served', () => {
    throw new Error('Not implemented — AC-072 pending');
  });
  // AC-073 (integration-test) → test/customapp-flags.test.js
  it('GIVEN a running server WHEN a flag is changed THEN the next request reflects it with no restart or deploy', () => {
    throw new Error('Not implemented — AC-073 pending');
  });
});
