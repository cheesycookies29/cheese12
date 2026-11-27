// BDD stubs for `test/guides.test.js`
// Session: custom-app-yep-2026-registration-20261127-0748. Contract: ../acceptance-contract.md.
// Each it() fails until the criterion is implemented and its real test replaces the stub.
import { describe, it } from 'node:test';

describe('US-026: CORE guide "custom-app-events", whats-new and screenshots', () => {
  // AC-173 (unit-test) → test/guides.test.js
  it('GIVEN docs/guides/custom-app-events.md WHEN the guides test runs THEN its header is valid (roles include eventstaff, apps customapp) and it has Before you start, Walkthrough, How to, Screens at a glance and Questions', () => {
    throw new Error('Not implemented — AC-173 pending');
  });
  // AC-174 (unit-test) → test/guides.test.js
  it('GIVEN the CUSTOM APP sidebar WHEN the guides test runs THEN every item (My queue, Find guest, Event control, Setup) is covered by the guide', () => {
    throw new Error('Not implemented — AC-174 pending');
  });
  // AC-175 (unit-test) → test/guides.test.js
  it('GIVEN the guide\'s images WHEN the guides test runs THEN each exists, is listed in docs/guides/screenshots.json with a user and url, and was retaken with npm run guides:screenshots', () => {
    throw new Error('Not implemented — AC-175 pending');
  });
});
