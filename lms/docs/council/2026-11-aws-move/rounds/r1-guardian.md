# Guardian (silver), round 1: compliance, governance, privacy

**Core recommendation:** The technical approach is sound. The gaps are in governance:
- who owns the new account;
- a record of the move;
- real destruction in the old account;
- TOR verification kept under the university's control for the life of the documents.

ATLAS holds *sensitive* personal information (RA 10173 §3(l)): education records, government IDs and
medical certificates. CBSUA is the controller (PIC), LTDC the processor, and AWS (and Cloudflare, if
used) are sub-processors. The PIC stays accountable (§21).

## 1. The approach

- **Bundle via S3: keep it, with the keys carried apart.** G3 puts both keys in the bundle, so one
  leak plus the passphrase gives everything. Enter the keys from the school's password manager in
  Session Manager instead.
  - The bucket: new account, `ap-southeast-1`, Block Public Access, SSE-KMS with a customer-managed
    key, 7-day expiry, CloudTrail data events on.
- **Carry less.** Do not move `backups/` or the Caddy logs.
  - `ltdc-lms-backup.cron` mirrors `files/` and `documents/` with no `--delete`, so files deleted in
    ATLAS live on in `backups/`.
  - Caddy logs hold visitors' IP addresses.
- **The wipe misses copies.** DLM snapshots at 02:00 PHT (`lms-ec2.yaml` l.188) and the cron copies
  run at 02:15–02:25, so a rehearsal copy left overnight is copied twice.
  - Rehearse first on synthetic data.
  - Do the real-data rehearsal within one day, or with DLM paused.
  - Wipe `backups/` too, and any snapshot taken.
- **Order:** add **A0**, a written go-ahead from the DPO, the registrar and the IT head. In B4,
  record the audit chain's head hash and the counts.

## 2. What is missing

1. **Who owns the new account.**
   - I recommend **CBSUA** owns it: an institutional root mailbox, MFA and two custodians. LTDC gets
     IAM Identity Center roles, written into the outsourcing agreement (§14; IRR §§43–45).
   - An LTDC- or reseller-owned account is a new sub-processing arrangement. It needs CBSUA's written
     consent *before* data moves.
   - File the AWS Customer Agreement and the AWS Data Processing Addendum (from AWS Artifact).
   - Sign the addendum the last council asked for, naming AWS Singapore and Cloudflare.
2. **Transfer?** Not if the region, the purposes and the PIC-side ownership stay the same: the
   processor changes where it runs, so no data-sharing agreement is needed.
   - A lost bundle is a breach (NPC Circular 16-03, 72 hours).
   - Update the NPC registration of the processing system if it names the hosting.
3. **DuckDNS is outside university control.** `EC2.md` Step 1 says to use "the same account as for
   the ERP": a personal or vendor login on a free service, with no contract.
   - TORs are permanent records (RA 9470, the NAP schedule for SUCs), so their QR codes will point
     at that name for decades. If the login lapses, someone else could answer them.
   - Move it to an institutional login held by two custodians.
4. **Cloudflare breaks D2.** `EC2.md`: with "only through Cloudflare" on, the DuckDNS address "stops
   working… not even as a forward". Every QR code printed before the move would fail.
5. **No infrastructure audit trail.** `lms-ec2.yaml` creates no CloudTrail trail and no Session
   Manager logging.
   - Turn both on in the old account before the export, and in the new account from day one.
   - Keep a signed move log: approvals, operators, times, SHA-256 of the bundle, counts, chain head
     at export and at restore, and when the bundle was deleted.
6. **Destruction.** The AWS-managed `aws/ebs` key cannot be deleted, so the old copies cannot be
   cryptographically shredded. Account closure keeps content for 90 days.
   - Explicitly delete the instance, the volumes, the 7 snapshots, AMIs, logs and buckets.
   - Keep the exported CloudTrail as evidence.
   - Issue a certificate of destruction.
7. **Notice.**
   - No new consent: same purposes, same Singapore hosting.
   - Update the privacy notice if it names the address or the processors.
   - Tell COA's resident auditor if Finance records are live.

## 3. Decisions

- **D1:** a name under `cbsua.edu.ph`, with DNS run by the school, never a vendor.
- **D2:** keep the old name, indefinitely, in institutional custody.
- **D3:** stay in `ap-southeast-1`. Any change needs a PIA update and a new notice, as a separate
  decision.
- **D4:** keep the old server stopped ≤ 30 days, destroy (item 6), then close the account.
- **D7:** no Cloudflare-only mode while the old name depends on direct access.
- **D8:** outside enrollment and grading, with the DPO told of the date.
- **New D9:** the owner and custodians of the new account.

## 4. Gaps

**Needed:** G1, G2, G3 (with the keys apart, and an audit entry "restored from export <sha256>"),
G4, G6, G8, and G5 if Cloudflare is used.

**Nice to have:** G7.

**Add:**
- **G9:** QR and "Check at" built from `PUBLIC_URL`, not `location.origin` (`documents.js` l.158,
  l.172).
- **G10:** CloudTrail, Session Manager logging and a customer-managed KMS key in the template.
- **G11 (advisory):** backup-mirror retention (`--delete`, 35-day expiry).

**Earlier council:**
- `atlas.cbsua.edu.ph`: now.
- The protected release branch: at stack creation (`AutoUpdate` defaults to `Yes` on a working
  branch).
- Off-site backups: a bucket in the new account now; anything outside Singapore waits for the PIA.
- `node:sqlite`: **not in the same window**, so the chain and count checks stay meaningful.

## Verdict: Go with conditions

1. **D9 decided, the DPO signs off, and the addendum names AWS Singapore** (and Cloudflare, if used)
   before any data moves.
2. **The bundle holds data only:** the keys are carried apart, the bucket is locked down and expires
   the bundle, and the rehearsal wipe covers snapshots and `backups/`.
3. **A signed move log,** with CloudTrail and Session Manager logging in both accounts, and the chain
   head and counts matched.
4. **Verification continuity:** DuckDNS in institutional custody, no Cloudflare-only mode that drops
   it, and G9.
5. **Proven destruction** within 30 days, certified before the account closes.
