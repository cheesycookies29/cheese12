// BDD stubs for `test/customapp-export.test.js`
// Session: custom-app-yep-2026-registration-20261127-0748. Contract: ../acceptance-contract.md.
// Each it() fails until the criterion is implemented and its real test replaces the stub.
import { describe, it } from 'node:test';

describe('US-012: Export JSON v1, CSV and printable plan', () => {
  // AC-074 (unit-test) → test/customapp-export.test.js
  it('GIVEN a fixture event WHEN GET .../export.json is produced THEN it equals the golden fixture with format customapp.event/1, exportedAt, eventId, seq, sha256, event, tables, guests, changes and outbox', () => {
    throw new Error('Not implemented — AC-074 pending');
  });
  // AC-075 (unit-test) → test/customapp-export.test.js
  it('GIVEN guests with reserved and confirmed seats and status tokens WHEN exported THEN every claim is present, sha256 verifies, token hashes are absent and no PII beyond the agreed fields appears', () => {
    throw new Error('Not implemented — AC-075 pending');
  });
  // AC-076 (integration-test) → test/customapp-export.test.js
  it('GIVEN an export WHEN .../export.csv?kind= and .../plan.pdf are requested THEN both are derived from the same export and the CSV is formula-safe', () => {
    throw new Error('Not implemented — AC-076 pending');
  });
  // AC-077 (integration-test) → test/customapp-export.test.js
  it('GIVEN a staffer and the Super Administrator WHEN each requests the exports THEN only the Super Administrator gets them', () => {
    throw new Error('Not implemented — AC-077 pending');
  });
});

describe('US-020: Safety nets: 5-minute export copies and the 60 s invariant self-check', () => {
  // AC-135 (unit-test) → test/customapp-export.test.js
  it('GIVEN a live event WHEN the 5-minute writer runs 30 times THEN it writes the export v1 with the same function into data/backups/events/ and keeps the last 24', () => {
    throw new Error('Not implemented — AC-135 pending');
  });
  // AC-136 (integration-test) → test/customapp-export.test.js
  it('GIVEN a clean event and one with a forced violation WHEN GET .../invariants is called THEN it returns [] and the violation respectively', () => {
    throw new Error('Not implemented — AC-136 pending');
  });
});

describe('US-025: Offline pack and paper reconciliation', () => {
  // AC-168 (integration-test) → test/customapp-export.test.js
  it('GIVEN an export v1 WHEN the print pack is generated THEN it has an A–Z list, per-table sheets and per-staffer sheets covering every claim, each page stamped as of HH:MM', () => {
    throw new Error('Not implemented — AC-168 pending');
  });
});
