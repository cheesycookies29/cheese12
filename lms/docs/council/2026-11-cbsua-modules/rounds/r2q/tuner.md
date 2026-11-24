TO: Strategist
Q: You ship Learn + Admin panel in W1 because "Learn traffic is spread across the term" and only gate the scale work at W4. But W1 already includes the Learn enrollment catalog (measured 31.6 s at 20k students) and the admin pending list (17.4 s), and quiz autosave and attendance each trigger a whole-file save. Shouldn't the in-memory indexes and the save fix (days of work) be an entry gate for W1, given what quiz windows and the first two weeks of the 2nd semester look like?

TO: Architect
Q: Your hybrid keeps every collection in memory as the read model and persists each record to node:sqlite through db.touch at the ~249 save() sites. With a UIS history import estimated at 550 MB or more of academicRecords JSON on a 2 GB t3.small, which collections would you take out of the heap entirely and query on demand? And what catches a save() site that mutates a record but forgets to call db.touch, which would be silent data loss instead of today's slow but complete save?
