# Architect R3

**KEY INSIGHT:** Tuner's W1 bench moved storage from a W4 gate to a W1 gate: at 20k students, Learn alone makes stringify throw by week 4. I accept Tuner's legacy-blob-in-SQLite bridge. The finSnap-across-await bug shows that commits must be synchronous and come after the handler.

**UNRESOLVED TENSION:** Strategist wants a 3-week W1 (hot paths only). Tuner and I want the full store moved before real volume. Skeptic wants a missed write to fail the request, while I offered a reconciler that loses at most 5 minutes.

**MODULE VERDICTS:**
- ATLAS home: Go with conditions. Use cached figures, not scans.
- Learn+Admin: Go with conditions. Learn writes and sessions go to SQLite first.
- Academic: Not yet. Agree an ownership map, then import into indexed tables.
- People: Go with conditions. Find payee cards by id, not by name.
- Finance: Not yet. A unit of work replaces finSnap.
- System: Go with conditions. Persist sessions, and keep only ids in the audit log.
- Facilities: Not yet. Create one `rooms` entity in Academic.
- REX: Not yet. Share entitlements only, never book files.

**RECOMMENDATION:** The SQLite store is LTDC's first W1 task, done before any CBSUA data is imported.

**QUESTION:** Is W1 for all 20k students or a pilot of 3k or fewer?
