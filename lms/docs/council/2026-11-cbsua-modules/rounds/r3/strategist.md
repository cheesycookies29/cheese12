# Strategist (gold): Round 3

**KEY INSIGHT:** I was wrong that storage could wait for W4. At 20k students, Tuner measured JSON.stringify failing by about week 4 of W1. The `finSnap` race shows the same storage layer is unsafe for money.

**UNRESOLVED TENSION:** Architect wants one offline move to SQLite. Tuner wants a step-by-step hybrid. Safer against sooner decides whether January holds.

**MODULE VERDICTS:**
- ATLAS home: Go with conditions. Keycloak SSO, on atlas.cbsua.edu.ph.
- Learn+Admin: Go with conditions. A January pilot of 2k students or fewer, unless Learn passes the 20k CI budget on SQLite.
- Academic: Not yet. The UIS import (into SQLite, with checksums) comes first.
- People: Go with conditions (W2). Payroll waits for two reconciled parallel runs.
- Finance: Not yet. Replace `finSnap` first. Fund 05 pilot, live Jan 2028.
- System: Go with conditions. The annex claims only controls that exist today.
- Facilities: Not yet. Cut from 2027; rooms go in Academic.
- REX: Not yet. Hidden; optional add-on.

**RECOMMENDATION:** Sign a phased contract with gates per wave. Spend December on storage, and freeze Finance features until the race is fixed.

**QUESTION:** Will CBSUA accept a one-campus January pilot, with lms2 still serving everyone else?
