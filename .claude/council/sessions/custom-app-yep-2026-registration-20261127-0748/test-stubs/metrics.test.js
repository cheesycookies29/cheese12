// BDD stubs for `metric: deploy history (devlog)`, `metric: save() p95 on the production copy`, `metric: npm run test:event`, `metric: restore drill RTO`, `GET /api/customapp/events/:id/invariants (after the event)`
// Session: custom-app-yep-2026-registration-20261127-0748. Contract: ../acceptance-contract.md.
// Each it() fails until the criterion is implemented and its real test replaces the stub.
import { describe, it } from 'node:test';

describe('US-001: 28 Nov ops half-day: freeze guard, kept release, rollback and crash logger', () => {
  // AC-008 (metric) → metric: deploy history (devlog)
  it('GIVEN the guard and rollback are merged on 28 Nov WHEN production deploys happen before 7 Dec THEN at least 4 of them run through the guard and the kept release', () => {
    throw new Error('Not implemented — AC-008 pending');
  });
});

describe('US-004: save() measurement and the 30 Nov storage gate', () => {
  // AC-021 (metric) → metric: save() p95 on the production copy
  it('GIVEN the 28 Nov measurement WHEN p95 is compared with the A8 bands THEN under 50 ms needs nothing, 50 to 150 ms triggers the levers and over 150 ms on 30 Nov triggers the split', () => {
    throw new Error('Not implemented — AC-021 pending');
  });
});

describe('US-013: Tier 0 proof suite: fuzz, race and the Tier 0 acceptance rows', () => {
  // AC-078 (metric) → metric: npm run test:event
  it('GIVEN package.json has test:event = node --test test/customapp-*.test.js WHEN it runs alone with fuzz at 50 seeds THEN it finishes in under 5 s', () => {
    throw new Error('Not implemented — AC-078 pending');
  });
});

describe('US-028: Staging restore drill, warm standby and load test 1', () => {
  // AC-184 (metric) → metric: restore drill RTO
  it('GIVEN the timed drill WHEN primary lost to staff on the standby URL is measured THEN it is under 30 minutes', () => {
    throw new Error('Not implemented — AC-184 pending');
  });
});

describe('US-030: Freeze, event-day runbook and close-out', () => {
  // AC-202 (metric) → GET /api/customapp/events/:id/invariants (after the event)
  it('GIVEN the event has closed WHEN the invariant scan runs THEN there are zero overbooked tables, duplicate check-ins, double seats, holds and expiry releases and exactly one Super Administrator', () => {
    throw new Error('Not implemented — AC-202 pending');
  });
});
