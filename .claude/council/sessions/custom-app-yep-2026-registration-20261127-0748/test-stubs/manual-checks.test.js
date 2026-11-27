// BDD stubs for `manual: staging rollback drill (devlog)`, `manual: storage measurement (devlog, 28 Nov)`, `manual: storage gate decision (devlog, 30 Nov)`, `manual: Tier 0 release check (devlog, 1 Dec)`, `manual: staging header check (devlog)`, `manual: presence key enablement (devlog, 4 Dec)`, `manual: email go/no-go (devlog, 3 Dec)`, `manual: printed contingency pack review`, `manual: tier commit review`, `manual: operator guide review`, `manual: client acceptance demo (5 Dec)`, `manual: staging restore drill (devlog, 1–3 Dec)`, `manual: load test 2 drill sheet (6 Dec)`, `manual: dress rehearsal (6 Dec)`, `manual: freeze checklist (7–8 Dec)`, `manual: event-day T-3h checklist (9 Dec)`, `manual: close-out checklist (9–10 Dec)`
// Session: custom-app-yep-2026-registration-20261127-0748. Contract: ../acceptance-contract.md.
// Each it() fails until the criterion is implemented and its real test replaces the stub.
import { describe, it } from 'node:test';

describe('US-001: 28 Nov ops half-day: freeze guard, kept release, rollback and crash logger', () => {
  // AC-005 (manual-check) → manual: staging rollback drill (devlog)
  it('GIVEN a deploy on staging WHEN ltdc-erp-rollback is run THEN the previous release is back, data/ is untouched, ownership matches update.sh and the health loop passes', () => {
    throw new Error('Not implemented — AC-005 pending');
  });
});

describe('US-004: save() measurement and the 30 Nov storage gate', () => {
  // AC-020 (manual-check) → manual: storage measurement (devlog, 28 Nov)
  it('GIVEN SSM read-only access WHEN the measurement runs on a production copy THEN db.json size, p50 and p95 of 50 stringify-and-write runs, free -m, the instance type and the Elastic IP check are in the devlog', () => {
    throw new Error('Not implemented — AC-020 pending');
  });
  // AC-022 (manual-check) → manual: storage gate decision (devlog, 30 Nov)
  it('GIVEN the measured p95 WHEN the gate is held on 30 Nov THEN the chosen action is written in the devlog and, if the split is chosen, email is moved to display plus verbal to pay for it', () => {
    throw new Error('Not implemented — AC-022 pending');
  });
});

describe('US-005: CUSTOM APP module shell and the Event staff account type', () => {
  // AC-028 (manual-check) → manual: Tier 0 release check (devlog, 1 Dec)
  it('GIVEN the Tier 0 deploy on 1 Dec WHEN a non-admin signs in to production THEN CUSTOM APP is not visible (released dark)', () => {
    throw new Error('Not implemented — AC-028 pending');
  });
});

describe('US-015: Guest status page and status token', () => {
  // AC-105 (manual-check) → manual: staging header check (devlog)
  it('GIVEN staging behind Caddy WHEN curl -I is run on /event/<code> and the status endpoint and the Caddyfile is read THEN Referrer-Policy no-referrer survives and there is no log directive', () => {
    throw new Error('Not implemented — AC-105 pending');
  });
});

describe('US-016: Zero-typing QR presence key (Should)', () => {
  // AC-108 (manual-check) → manual: presence key enablement (devlog, 4 Dec)
  it('GIVEN load test 1 results WHEN the key is considered for production THEN it stays off unless load test 1 passed and the decision is recorded', () => {
    throw new Error('Not implemented — AC-108 pending');
  });
});

describe('US-023: Email outbox', () => {
  // AC-159 (manual-check) → manual: email go/no-go (devlog, 3 Dec)
  it('GIVEN the sender address, SMTP status and schedule on 3 Dec WHEN the go/no-go is held THEN the decision is recorded and emailPaused set accordingly', () => {
    throw new Error('Not implemented — AC-159 pending');
  });
});

describe('US-025: Offline pack and paper reconciliation', () => {
  // AC-171 (manual-check) → manual: printed contingency pack review
  it('GIVEN the guide\'s desk card and the easel card WHEN they are printed THEN the easel card reads "If this page doesn\'t open, please go to the registration desk." and the desk card has the standby URL and the re-login line', () => {
    throw new Error('Not implemented — AC-171 pending');
  });
});

describe('US-026: CORE guide "custom-app-events", whats-new and screenshots', () => {
  // AC-176 (manual-check) → manual: tier commit review
  it('GIVEN each tier commit (1, 3 and 5 Dec) WHEN it is reviewed THEN it carries the version bump, devlog entry, guide change, a whats-new line (newest first) and retaken screenshots', () => {
    throw new Error('Not implemented — AC-176 pending');
  });
  // AC-177 (manual-check) → manual: operator guide review
  it('GIVEN the guide\'s If the system is down section WHEN it is reviewed with the on-call developer THEN it holds the T-3h checklist, the doors step, the act-on thresholds, the degrade ladder, close and 10 Dec steps, and "Never run RESTORE.md §1 while an event is live"', () => {
    throw new Error('Not implemented — AC-177 pending');
  });
});

describe('US-027: Tier 2 acceptance, reuse proof and the 5 Dec client demo', () => {
  // AC-181 (manual-check) → manual: client acceptance demo (5 Dec)
  it('GIVEN Legati and ICD with several devices WHEN the 12 scenarios are demonstrated with sample data THEN each is observed and the sign-off is recorded', () => {
    throw new Error('Not implemented — AC-181 pending');
  });
  // AC-182 (manual-check) → manual: client acceptance demo (5 Dec)
  it('GIVEN the demo WHEN registrationOpen, emailPaused, readOnly and pollMs are each changed THEN each takes effect with no deploy', () => {
    throw new Error('Not implemented — AC-182 pending');
  });
});

describe('US-028: Staging restore drill, warm standby and load test 1', () => {
  // AC-183 (manual-check) → manual: staging restore drill (devlog, 1–3 Dec)
  it('GIVEN the latest offsite copy WHEN staging is built with RESTORE.md §2 on the production instance type with its own hostname and certificate THEN emailPaused is true and SMTP points at a sink before the first start, and each step is timed', () => {
    throw new Error('Not implemented — AC-183 pending');
  });
});

describe('US-029: Load test 2 with the kill -9 drill and the dress rehearsal', () => {
  // AC-192 (manual-check) → manual: load test 2 drill sheet (6 Dec)
  it('GIVEN the event window is open WHEN a CORE Admin restore is attempted THEN the event data is untouched', () => {
    throw new Error('Not implemented — AC-192 pending');
  });
  // AC-193 (metric) → manual: load test 2 drill sheet (6 Dec)
  it('GIVEN the Super Administrator is unavailable WHEN a CORE admin transfers the role with setSuperAdmin THEN it takes under 2 minutes and exactly one Super Administrator remains', () => {
    throw new Error('Not implemented — AC-193 pending');
  });
  // AC-197 (metric) → manual: dress rehearsal (6 Dec)
  it('GIVEN real staff accounts with 2-step sign-in and the rehearsal guests WHEN arrivals are timed THEN QR scan to checked in has a median under 30 s and checked in to seated a p90 under 2 minutes', () => {
    throw new Error('Not implemented — AC-197 pending');
  });
});

describe('US-030: Freeze, event-day runbook and close-out', () => {
  // AC-198 (manual-check) → manual: freeze checklist (7–8 Dec)
  it('GIVEN the event build WHEN the code freeze starts on 7 Dec at 18:00 THEN the GitHub production reviewer gate is on, the build is tagged and any resize the gate asked for is done after checking the Elastic IP', () => {
    throw new Error('Not implemented — AC-198 pending');
  });
  // AC-199 (manual-check) → manual: freeze checklist (7–8 Dec)
  it('GIVEN DEPLOY_FREEZE touched on 8 Dec at 12:00 WHEN a deliberate push is made THEN CI runs and the deploy job fails with exit 3 and production does not restart', () => {
    throw new Error('Not implemented — AC-199 pending');
  });
  // AC-200 (manual-check) → manual: freeze checklist (7–8 Dec)
  it('GIVEN the last deploy is done WHEN the offsite timer drop-in OnCalendar=*:05/15 is added and a full backup taken THEN systemctl list-timers shows the 15-minute schedule', () => {
    throw new Error('Not implemented — AC-200 pending');
  });
  // AC-201 (manual-check) → manual: event-day T-3h checklist (9 Dec)
  it('GIVEN T-3h on 9 Dec WHEN the checklist is run THEN freeze and gate, timers, a manual offsite backup in the Security monitor, the standby top-up, the rehearsal-guest smoke test, an export under 5 minutes old on the laptop, the printed pack and staff devices on 4G are each confirmed', () => {
    throw new Error('Not implemented — AC-201 pending');
  });
  // AC-203 (manual-check) → manual: close-out checklist (9–10 Dec)
  it('GIVEN the event closes WHEN close-out runs THEN registrationOpen is off, the final CSV and JSON exports are taken, a manual offsite backup runs and the retention date is set', () => {
    throw new Error('Not implemented — AC-203 pending');
  });
  // AC-204 (manual-check) → manual: close-out checklist (9–10 Dec)
  it('GIVEN 10 Dec 09:00 WHEN the freeze is lifted THEN the freeze file and timer drop-in are removed, the instance is resized back, staging is snapshotted and decommissioned, the export archive is handed to the client and the PII purge clock starts', () => {
    throw new Error('Not implemented — AC-204 pending');
  });
});
