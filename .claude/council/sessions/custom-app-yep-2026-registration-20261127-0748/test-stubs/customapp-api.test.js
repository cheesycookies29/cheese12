// BDD stubs for `test/customapp-api.test.js`
// Session: custom-app-yep-2026-registration-20261127-0748. Contract: ../acceptance-contract.md.
// Each it() fails until the criterion is implemented and its real test replaces the stub.
import { describe, it } from 'node:test';

describe('US-002: Restore carve-out keeps live event data', () => {
  // AC-015 (unit-test) → test/customapp-api.test.js
  it('GIVEN an event whose window is open WHEN Admin panel Modules tries to switch CUSTOM APP off THEN it is refused unless the event Super Administrator confirms', () => {
    throw new Error('Not implemented — AC-015 pending');
  });
});

describe('US-003: Event rate-limit buckets and the staff sign-in allowance', () => {
  // AC-018 (unit-test) → test/customapp-api.test.js
  it('GIVEN an event window WHEN the Super Administrator turns on the event sign-in allowance THEN signInFailuresPerAddress and the auth bucket are raised only inside the window and the change is audited', () => {
    throw new Error('Not implemented — AC-018 pending');
  });
  // AC-019 (integration-test) → test/customapp-api.test.js
  it('GIVEN limits ON and the allowance active WHEN 30 staff sign in and poll boards at 2 s from one address THEN no request gets a 429', () => {
    throw new Error('Not implemented — AC-019 pending');
  });
});

describe('US-005: CUSTOM APP module shell and the Event staff account type', () => {
  // AC-025 (integration-test) → test/customapp-api.test.js
  it('GIVEN a signed-in user with customapp.use WHEN GET /api/customapp/apps is called THEN the registry lists exactly one app, events', () => {
    throw new Error('Not implemented — AC-025 pending');
  });
  // AC-027 (integration-test) → test/customapp-api.test.js
  it('GIVEN the module switched off WHEN /api/customapp/* or /api/public/event/* is called THEN both refuse', () => {
    throw new Error('Not implemented — AC-027 pending');
  });
});

describe('US-006: Event, table and industry setup', () => {
  // AC-029 (integration-test) → test/customapp-api.test.js
  it('GIVEN users with and without a role in an event WHEN they call GET/POST /api/customapp/events and PATCH /:id with an old rev THEN create needs customapp.manage, the list shows only their events and the stale PATCH gets 409 stale', () => {
    throw new Error('Not implemented — AC-029 pending');
  });
});

describe('US-007: commit() unit of work, claimsAt(), invariants and typed refusals', () => {
  // AC-035 (unit-test) → test/customapp-api.test.js
  it('GIVEN server/customapp/events/commit.js and engine.js WHEN their source is searched THEN neither contains await', () => {
    throw new Error('Not implemented — AC-035 pending');
  });
  // AC-036 (unit-test) → test/customapp-api.test.js
  it('GIVEN mutation() WHEN it is given an AsyncFunction at startup or a handler that returns a thenable at run time THEN it refuses both', () => {
    throw new Error('Not implemented — AC-036 pending');
  });
  // AC-040 (integration-test) → test/customapp-api.test.js
  it('GIVEN db.save() stubbed to throw WHEN a command is posted THEN the reply is 503 not_saved, the in-memory state is unchanged, nothing is audited and nothing is queued', () => {
    throw new Error('Not implemented — AC-040 pending');
  });
  // AC-041 (integration-test) → test/customapp-api.test.js
  it('GIVEN a successful command WHEN the audit log is read THEN there is exactly one entry, labelled with the guest ref and a masked name and never the mobile or email', () => {
    throw new Error('Not implemented — AC-041 pending');
  });
  // AC-043 (unit-test) → test/customapp-api.test.js
  it('GIVEN the frozen refusal catalogue WHEN the suite runs THEN every code in shared/customapp/refusals.js is produced by at least one test with its catalogue status', () => {
    throw new Error('Not implemented — AC-043 pending');
  });
  // AC-044 (unit-test) → test/customapp-api.test.js
  it('GIVEN HttpError(status, message, {code, fresh}) and an existing two-argument caller WHEN handle() serialises them THEN the reply is {error, code, fresh} and the old callers are unchanged', () => {
    throw new Error('Not implemented — AC-044 pending');
  });
  // AC-046 (integration-test) → test/customapp-api.test.js
  it('GIVEN a committed command with opId X WHEN it is replayed with the same body, with a different body, and after a restart THEN the same body returns the prior result without a write, a different body gets op_replay_mismatch, and the map is rebuilt from caChanges', () => {
    throw new Error('Not implemented — AC-046 pending');
  });
});

describe('US-010: Staff Find guest and seating screens', () => {
  // AC-062 (integration-test) → test/customapp-api.test.js
  it('GIVEN an owner and a non-owner staffer WHEN they search GET .../guests?q=&class=&status=&table= by partial name or company THEN the owner sees masked contact fields and the non-owner sees name, company, industry and table only', () => {
    throw new Error('Not implemented — AC-062 pending');
  });
  // AC-063 (integration-test) → test/customapp-api.test.js
  it('GIVEN a staffer who does not own the guest WHEN they check the guest in and then try to seat them THEN check-in succeeds and seating is refused with out_of_scope', () => {
    throw new Error('Not implemented — AC-063 pending');
  });
});

describe('US-011: Event Super Administrator and runtime flags', () => {
  // AC-069 (integration-test) → test/customapp-api.test.js
  it('GIVEN a CORE admin WHEN POST .../super-admin is called without customapp.manage, without password re-entry, without a reason, and then with all three THEN only the last succeeds, the old holder is revoked in the same commit, it is audited and exactly one Super Administrator remains', () => {
    throw new Error('Not implemented — AC-069 pending');
  });
});

describe('US-022: Unlisted guests and substitutes', () => {
  // AC-148 (integration-test) → test/customapp-api.test.js
  it('GIVEN an approval and a substitution WHEN the guest\'s history is read THEN it lists each approval and change with actor and time from caChanges', () => {
    throw new Error('Not implemented — AC-148 pending');
  });
});

describe('US-024: Event control dashboard', () => {
  // AC-161 (integration-test) → test/customapp-api.test.js
  it('GIVEN a fixture event WHEN the dashboard data is requested THEN Invited, Checked in, Not yet arrived, Waiting for table, Needs approval and Seats left match a recount from the source', () => {
    throw new Error('Not implemented — AC-161 pending');
  });
  // AC-163 (integration-test) → test/customapp-api.test.js
  it('GIVEN a walk-in, a substitute, a No seat in scope referral, a released reservation whose guest arrived, a capped surname and a failure-rate alarm WHEN the exceptions inbox is read THEN each appears', () => {
    throw new Error('Not implemented — AC-163 pending');
  });
  // AC-165 (integration-test) → test/customapp-api.test.js
  it('GIVEN a running event WHEN the health strip is read THEN it shows seq, save p95, outbox depth, the age of the newest export, the 429 count and the self-check result, and a violation raises the banner', () => {
    throw new Error('Not implemented — AC-165 pending');
  });
});

describe('US-025: Offline pack and paper reconciliation', () => {
  // AC-169 (integration-test) → test/customapp-api.test.js
  it('GIVEN paper entries including one that would overbook a table WHEN Reconcile paper seating replays them THEN each goes through commit() with via reconcile, occurredAt and an opId, and the overbooking is refused and listed as a recovery card', () => {
    throw new Error('Not implemented — AC-169 pending');
  });
  // AC-170 (unit-test) → test/customapp-api.test.js
  it('GIVEN a paper sheet already reconciled WHEN it is entered again THEN no duplicate check-in or seat is created', () => {
    throw new Error('Not implemented — AC-170 pending');
  });
});
