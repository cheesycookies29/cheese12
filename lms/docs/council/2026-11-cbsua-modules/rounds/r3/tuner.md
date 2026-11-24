# Tuner (amber), Round 3

**KEY INSIGHT:** I re-measured a 20k-student W1 on day one with no quizzes. A compact save still takes 485 ms. Most of it is enrollments (53 MB), users and profiles (23 MB). So moving only the Learn write path is not enough. Only Architect's full SQLite cut-over meets the 50 ms save budget.

**UNRESOLVED TENSION:** Strategist wants a university-wide January launch. Architect and I say the full cut-over must come first.

**MODULE VERDICTS:**
- ATLAS home: Go with conditions. Cache the figures and load them after the page.
- Learn+Admin: Go with conditions. Above 3k students, finish the cut-over and the indexes first.
- Academic: Not yet. Put academicRecords in a table before the UIS import.
- People: Not yet. Store DTR timeEntries as rows.
- Finance: Not yet. Commit writes after the handler, never across an `await`.
- System: Go with conditions. Persist sessions and pass an 11/s sign-in load test.
- Facilities: Not yet. Index (room, slot) overlaps in the row store.
- REX: Not yet. Store entitlements and signed URLs only, with no book bytes.

**RECOMMENDATION:** Launch a January pilot of 3k students or fewer. Scale up only after the cut-over passes a 20k-student test in `npm test`.

**QUESTION:** How many students will be in Learn in January, and how often will they take quizzes?
