TO: Strategist
Q: You call System "ready" with "separation of duties enforced" and plan to sell it as a compliance annex, yet Administrator gets every Finance power (and is exempt from the own-requisition rule) and one `hris:payroll.edit` holder can edit and finalize a payroll run; which of those gaps would you close before the bid annex claims SoD? And since W1 (Jan 2027) ships Learn, which contains the enrollment catalog that Tuner measured at 31.6 s at CBSUA scale, is W1 gated on the index fix or not?

TO: Architect
Q: Your SQLite plan keeps the in-memory arrays as the read model and persists per record through an explicit `db.touch(collection, record)` at the ~249 existing `save()` sites; what makes a missed or wrong `touch` fail loudly instead of silently diverging memory from disk (the same failure mode as today's throwing `save()`), and how do you prove the cut-over lost nothing, given that `node:sqlite` is still marked experimental on Node 22?
