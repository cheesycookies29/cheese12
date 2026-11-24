## Guardian (silver), Round 3

**KEY INSIGHT:** Erasure and immutable backups can coexist: 35-day Object Lock expiry plus an erasure ledger replayed on restore. What changed: the audit log is not opaque. Hashed entries hold names, IPs and field values in clear (`server/audit.js`, `system.js:206`). And finSnap can silently drop issued ORs/JEVs, breaking COA's gap-free records.

**UNRESOLVED TENSION:** Architect and Skeptic want a never-rewritten audit chain. I need its personal data erasable and disposable after 5 years. Moving PII to a side table without breaking `verify()` is unproven.

**MODULE VERDICTS:**
- ATLAS home: Go with conditions. Privacy notice on sign-in.
- Learn+Admin: Go with conditions. Self-registration and guardian links off until links start as pending student consent.
- Academic: Not yet. Module PIA; religion dropped.
- People: Not yet. Government IDs and bank numbers masked.
- Finance: Not yet. Synchronous commit replaces finSnap; COA/NAP retention matrix.
- System: Go with conditions. Backup downloads audited; web restore needs two people.
- Facilities: Not yet. Bookings store account IDs only.
- REX: Not yet. Signed DSA banning marketing and resale.

**RECOMMENDATION:** This week, send CBSUA's DPO a pre-filled W1 privacy pack (notice, processing addendum naming AWS Singapore and Cloudflare, scoped PIA). Make signing it a CBSUA-owned W1 acceptance criterion.

**QUESTION:** Is CBSUA's DPO NPC-registered, and will CBSUA accept Singapore residency?
