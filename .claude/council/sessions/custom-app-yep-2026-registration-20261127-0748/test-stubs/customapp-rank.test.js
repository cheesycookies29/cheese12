// BDD stubs for `test/customapp-rank.test.js`
// Session: custom-app-yep-2026-registration-20261127-0748. Contract: ../acceptance-contract.md.
// Each it() fails until the criterion is implemented and its real test replaces the stub.
import { describe, it } from 'node:test';

describe('US-018: Recommendation engine', () => {
  // AC-120 (unit-test) → test/customapp-rank.test.js
  it('GIVEN preferred, regular, employee and unlisted guests, mixed tables on and off, a table with too few seats and an excluded tag WHEN eligible() is evaluated THEN only active tables of an allowed class with enough free seats and no exclusion are eligible', () => {
    throw new Error('Not implemented — AC-120 pending');
  });
  // AC-121 (unit-test) → test/customapp-rank.test.js
  it('GIVEN tables with same-industry, related-industry and other guests WHEN recommend() ranks them THEN same beats related beats other, and within a tier group fit, then more same-industry companions, then fewer seats left, then table number decide', () => {
    throw new Error('Not implemented — AC-121 pending');
  });
  // AC-122 (unit-test) → test/customapp-rank.test.js
  it('GIVEN a full table and an ineligible table WHEN recommend() runs THEN neither is ever listed', () => {
    throw new Error('Not implemented — AC-122 pending');
  });
  // AC-123 (integration-test) → test/customapp-rank.test.js
  it('GIVEN a staffer with some tables WHEN GET .../recommend?guestIds= is called, and when nothing fits THEN results split into mine and othersReadOnly with tier, free, reasons and selectable, and nothing-fits returns none true and refer super_admin', () => {
    throw new Error('Not implemented — AC-123 pending');
  });
});

describe('US-021: Group arrivals', () => {
  // AC-139 (unit-test) → test/customapp-rank.test.js
  it('GIVEN a group of 6 and no table with 6 free seats WHEN recommend() runs and assign is sent with and without allowSplit THEN only tables with at least 6 free are ranked, split suggestions give the largest partitions that fit, and the split needs allowSplit true', () => {
    throw new Error('Not implemented — AC-139 pending');
  });
});
