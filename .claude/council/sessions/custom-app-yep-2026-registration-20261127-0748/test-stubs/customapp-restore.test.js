// BDD stubs for `test/customapp-restore.test.js`
// Session: custom-app-yep-2026-registration-20261127-0748. Contract: ../acceptance-contract.md.
// Each it() fails until the criterion is implemented and its real test replaces the stub.
import { describe, it } from 'node:test';

describe('US-002: Restore carve-out keeps live event data', () => {
  // AC-009 (unit-test) → test/customapp-restore.test.js
  it('GIVEN live data with an event at seq 120 WHEN a backup taken at seq 50 is restored through replaceData() THEN caEvents, caTables, caGuests, caChanges, caOutbox and seq are unchanged', () => {
    throw new Error('Not implemented — AC-009 pending');
  });
  // AC-010 (unit-test) → test/customapp-restore.test.js
  it('GIVEN a live event WHEN an admin runs Erase all data or loads demo data THEN the live ca* collections and seq are untouched', () => {
    throw new Error('Not implemented — AC-010 pending');
  });
  // AC-011 (unit-test) → test/customapp-restore.test.js
  it('GIVEN live data with no events (the standby) WHEN a backup that holds an event is restored THEN the backup\'s ca* collections are taken', () => {
    throw new Error('Not implemented — AC-011 pending');
  });
  // AC-013 (unit-test) → test/customapp-restore.test.js
  it('GIVEN deploy/aws/RESTORE.md WHEN section 1 is read THEN it carries the boxed warning that it is forbidden while an event is live', () => {
    throw new Error('Not implemented — AC-013 pending');
  });
  // AC-014 (integration-test) → test/customapp-restore.test.js
  it('GIVEN a live event WHEN /api/admin/export is downloaded with and without include events THEN event PII is left out by default and ticking include events adds it and writes an audit entry', () => {
    throw new Error('Not implemented — AC-014 pending');
  });
});
