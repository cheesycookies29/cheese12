# Skeptic (red) — Round 3

**KEY INSIGHT:** I was wrong about timing, and about my own fix. Tuner showed db.json breaks inside W1: around week 4 at 20k students, JSON.stringify throws and every write fails after that. The finSnap bug shows that "roll back memory on failure" is unsafe across an `await`. Rollback must be a synchronous unit of work.

**UNRESOLVED TENSION:** Architect wants one offline cut-over with a 5-minute reconciler. Tuner wants a hybrid, moved cluster by cluster. Strategist moves only Learn writes for W1. I accept the reconciler for Learn, but not for grades, payroll or ORs, where the request itself must fail.

**MODULE VERDICTS:**
- ATLAS home: Go with conditions. MFA for all staff accounts.
- Learn+Admin: Go with conditions. Learn writes on node:sqlite.
- Academic: Not yet. A different person must approve and post grades.
- People: Not yet. A second person finalizes payroll.
- Finance: Not yet. Admin loses transactional powers.
- System: Go with conditions. Ship the audit log off the box.
- Facilities: Not yet. Must not own a property register.
- REX: Not yet. Data-sharing agreement and PIA first.

**RECOMMENDATION:** No-go on 2027-01-08 if the store move is missing. Claim separation of duties only where code enforces it.

**QUESTION:** Do CBSUA's smaller campuses have two separate people for every maker-checker step, or must checkers sit at another campus?
