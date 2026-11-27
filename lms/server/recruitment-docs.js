// Applicants' documents in ATLAS People's recruitment: the HRIS request PL-022, with PL-006 (file
// types) and PL-007 (a size cap, with error messages that say what to do) as settings. Registered from
// server/recruitment.js, which hands over its helpers.
//
//  - A requirements checklist per opening (o.requirements: name, short note, Required or Optional),
//    copied from the position category's default checklist (HR settings → Applicant documents) when
//    the opening is made, and edited on the opening. o.requireDocsBeforeApply (off by default): the
//    required documents must be uploaded before the applicant can apply.
//  - The applicant upload policy (settings.applicantDocs; shared/recruitment-docs.js): the file types
//    allowed (PDF, Word, Excel, pictures), the largest file (2 MB by default, 1 to 10) and the most
//    files per application (15). The type comes from the bytes (server/dms/types.js, as ATLAS
//    Documents), never the name; programs, scripts, web pages, Office files with macros and
//    password-protected Office files are always refused.
//  - Files arrive in pieces (as in ATLAS Documents), kept in memory until whole (never written to disk
//    unencrypted), then stored encrypted at rest with Documents' blob store (server/dms/blobs.js),
//    under a key of their own derived from the server key (server/secrets.js), outside db.json
//    (data/applicant-files). Records: data.jobDocuments.
//  - The applicant uploads against each item (several files per item), and may replace or remove
//    their files while the opening takes applications; after it closes, only an item HR marked "Needs
//    a new file". Each item shows Not yet uploaded, Uploaded, Accepted or Needs a new file (HR's note).
//  - HR (hris.recruitment, at the opening's campus) sees the files and marks each item Accepted or
//    Needs a new file, with a note to the applicant (the bell). The assessors named on the opening's
//    panel see them read-only. Downloads go through signed-in routes only, as attachments with
//    nosniff; there is no public link. HR's and assessors' downloads go to the audit log.
//  - Retention: the files go with the applicant account (the removal after it closes, or HR's
//    Remove); a Selected applicant's account, and so their files, is never removed automatically. When
//    someone leaves the pool of applicants, the files of their applications that ended (not selected,
//    not qualified, withdrawn) go: the pool keeps no files. Files uploaded for an opening someone never
//    applied to go once it stops taking applications.
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError, text } from './util.js';
import { t } from './validate.js';
import { createBlobStore, BlobError } from './dms/blobs.js';
import { checkFile, cleanName, extOf, contentDisposition, BLOCKED_EXTS, FAMILIES } from './dms/types.js';
import { openingAccepts, DECIDED } from '../shared/recruitment.js';
import {
  mergeApplicantDocs, DEFAULT_APPLICANT_DOCS, UPLOAD_TYPES, TYPE_OF_EXT, POLICY_LIMITS, MB, sizeMessage, countMessage, typeMessage, typesInWords,
  acceptAttr, policyLine, itemStatus, completeness, docStatusLabel, mergeItem, DEFAULT_CHECKLISTS,
} from '../shared/recruitment-docs.js';

export const ATTACH_CHUNK_BYTES = 1024 * 1024; // a piece of an upload: 1 MB (about 1.4 MB as base64)
export const MAX_ATTACH_PIECE_BODY = Math.ceil(ATTACH_CHUNK_BYTES / 3) * 4 + 16 * 1024; // what prepare() lets through for a piece
const UPLOAD_IDLE_MS = 5 * 60000;
const MAX_UPLOADS_EACH = 3; // files arriving at once per person
const MAX_IN_FLIGHT = 64 * MB; // all unfinished uploads together, in memory
const BLOCKED = new Set(BLOCKED_EXTS);
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
// The Documents families the policy's types are checked under (the policy then narrows to its exts).
const FAMILIES_FOR = { pdf: ['pdf'], word: ['word', 'legacy'], excel: ['excel', 'legacy'], image: ['image'] };

const atlas = (s) => String(s).replace(/\bCORE\b/g, 'ATLAS').replace(/ An administrator can allow them in Document control\./, '');

export function registerApplicantDocs(route, ctx, h) {
  const { fail, data, save, iso, nowMs, today, openings, applications, userById, nameOf, openingForHr, seeker, visibleTo, toHr } = h;
  const db = ctx.db;
  const dir = ctx.applicantFilesDir || (db.dir ? path.join(db.dir, 'applicant-files') : path.join(os.tmpdir(), `atlas-applicant-files-${randomUUID()}`));
  const blobs = createBlobStore(dir, ctx.secrets.derive('recruitment.applicant-files'));
  const docs = () => (data().jobDocuments ||= []);
  const policy = () => mergeApplicantDocs(data().settings.applicantDocs);
  const policyOut = (p = policy()) => ({ types: p.types, typesText: typesInWords(p), accept: acceptAttr(p), maxMb: p.maxMb, maxFiles: p.maxFiles, help: p.help, line: policyLine(p), chunkBytes: ATTACH_CHUNK_BYTES });
  const requirementsOf = (o) => (Array.isArray(o?.requirements) ? o.requirements : []);
  const filesFor = (openingId, userId) => docs().filter((d) => d.openingId === openingId && d.userId === userId);
  const applicationOf = (o, userId) => applications().find((a) => a.openingId === o.id && a.userId === userId) || null;
  const reviewOf = (a, reqId) => a?.docReview?.[reqId] || null;
  const fileOut = (d) => ({ id: d.id, name: d.name, ext: d.ext, size: d.size, at: d.at });

  // ----- The checklist of an opening (its form) -----
  // From the opening form: the list as HR edited it; a new opening without one gets its category's.
  function checklistFor(categoryId) {
    return structuredClone(policy().checklists[categoryId] || []);
  }
  function cleanRequirements(input, existing, categoryId) {
    const out = {};
    const has = Array.isArray(input.requirements);
    const before = requirementsOf(existing);
    let list;
    if (has) list = input.requirements;
    else if (existing) list = before;
    else list = checklistFor(categoryId);
    if (list.length > POLICY_LIMITS.items) fail(`A checklist has at most ${POLICY_LIMITS.items} documents.`);
    const ids = new Set();
    const names = new Set();
    out.requirements = list.map((x) => {
      const name = text(x?.name, 400);
      if (!name) fail('Every document in the checklist needs a name.');
      if (name.length > POLICY_LIMITS.name) fail(`${name.slice(0, 30)}…: a document's name has at most ${POLICY_LIMITS.name} characters.`);
      if (names.has(name.toLowerCase())) fail(`The checklist has ${name} twice.`);
      names.add(name.toLowerCase());
      const note = text(x?.note, 1000);
      if (note.length > POLICY_LIMITS.note) fail(`${name}: the note has at most ${POLICY_LIMITS.note} characters.`);
      let id = text(x?.id, 60);
      if (id && (!ID_RE.test(id) || ids.has(id))) id = '';
      if (!id) {
        const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'document';
        id = base;
        for (let n = 2; ids.has(id) || before.some((b) => b.id === id && b.name !== name); n++) id = `${base}-${n}`;
      }
      ids.add(id);
      return { id, name, note, required: x?.required === true || x?.required === 'true' };
    });
    // A document someone has uploaded files for stays on the list (rename it instead).
    if (existing) {
      for (const b of before) {
        if (ids.has(b.id)) continue;
        const n = docs().filter((d) => d.openingId === existing.id && d.reqId === b.id).length;
        if (n) fail(`${b.name} has ${n} file${n === 1 ? '' : 's'} uploaded by applicants: keep it on the checklist (you can rename it or make it optional).`);
      }
    }
    out.requireDocsBeforeApply = typeof input.requireDocsBeforeApply === 'boolean' ? input.requireDocsBeforeApply : Boolean(existing?.requireDocsBeforeApply);
    return out;
  }

  // ----- Statuses and completeness -----
  function itemsOf(o, userId, a, { forHr = false } = {}) {
    const files = filesFor(o.id, userId);
    return requirementsOf(o).map((r) => {
      const mine = files.filter((d) => d.reqId === r.id).sort((x, y) => x.at.localeCompare(y.at));
      const rev = reviewOf(a, r.id);
      const status = itemStatus(mine, rev);
      return {
        id: r.id, name: r.name, note: r.note, required: r.required, status, statusLabel: docStatusLabel(status),
        review: rev ? { status: rev.status, note: rev.note || '', at: rev.at, ...(forHr ? { by: rev.by || '' } : { from: 'HR office' }) } : null,
        files: mine.map(fileOut),
      };
    });
  }
  function summary(a, o) {
    if (!a || a.removed) return null;
    const reqs = requirementsOf(o);
    if (!reqs.length) return null;
    const files = filesFor(o.id, a.userId);
    const c = completeness(reqs, (id) => files.filter((d) => d.reqId === id), (id) => reviewOf(a, id));
    const statuses = reqs.map((r) => itemStatus(files.filter((d) => d.reqId === r.id), reviewOf(a, r.id)));
    return { ...c, items: reqs.length, files: files.length, toCheck: statuses.filter((s) => s === 'uploaded').length, accepted: statuses.filter((s) => s === 'accepted').length, needsNew: statuses.filter((s) => s === 'needs-new').length };
  }

  // ----- What the applicant may still change -----
  // Open: anything. Closed: only an item HR asked a new file for. Decided: nothing.
  function changeRule(o, user, reqId = null) {
    const a = applicationOf(o, user.id);
    if (a && DECIDED.includes(a.status)) return { ok: false, why: 'HR has decided on your application, so its documents can no longer change. Contact HR if something is wrong.' };
    if (openingAccepts(o, today())) return { ok: true, a };
    if (reqId && a && a.status !== 'withdrawn' && reviewOf(a, reqId)?.status === 'needs-new') return { ok: true, a, late: true };
    return { ok: false, why: 'This opening has closed, so its documents can no longer change. Contact HR if something is wrong.' };
  }
  const mayChange = (o, user, reqId) => {
    const r = changeRule(o, user, reqId);
    if (!r.ok) fail(r.why, 403);
    return r;
  };
  // The opening as an applicant may reach it: one they can see, or one they applied to.
  function openingForSeeker(user, id) {
    const me = seeker(user);
    const o = openings().find((x) => x.id === id);
    if (!o || (!visibleTo(me, o) && !applicationOf(o, user.id) && !filesFor(o.id, user.id).length)) fail('Job opening not found.', 404);
    return o;
  }
  function myView(o, user) {
    const a = applicationOf(o, user.id);
    const items = itemsOf(o, user.id, a).map((it) => ({ ...it, canUpload: changeRule(o, user, it.id).ok }));
    const files = filesFor(o.id, user.id);
    const c = completeness(requirementsOf(o), (id) => files.filter((d) => d.reqId === id), (id) => reviewOf(a, id));
    const rule = changeRule(o, user);
    return {
      openingId: o.id, title: o.title, requirements: items, policy: policyOut(), count: files.length, completeness: c,
      requireBeforeApply: Boolean(o.requireDocsBeforeApply), open: openingAccepts(o, today()), applied: Boolean(a && a.status !== 'withdrawn'), applicationId: a?.id || null,
      canChange: rule.ok, closedWhy: rule.ok ? '' : rule.why,
    };
  }

  // ----- Uploads in pieces (as ATLAS Documents), in memory until whole -----
  const uploads = new Map();
  const inFlight = () => [...uploads.values()].reduce((n, x) => n + x.size, 0);
  const dropIdle = () => {
    for (const x of [...uploads.values()]) if (nowMs() - x.usedAt > UPLOAD_IDLE_MS) uploads.delete(x.id);
  };
  // Refusals are told in words that say what to do (PL-007).
  function quickCheck(p, name, size) {
    const ext = extOf(cleanName(name));
    if (BLOCKED.has(ext)) fail(`.${ext} files are never accepted: programs, scripts, web pages and Office files with macros. ${typeMessage(p)}`);
    if (ext && !TYPE_OF_EXT[ext]) fail(`${name}: ${typeMessage(p)}`);
    if (ext && !p.types.includes(TYPE_OF_EXT[ext])) fail(`${name}: ${typeMessage(p)}`);
    if (!Number.isInteger(size) || size <= 0) fail(`${name} is empty.`);
    if (size > p.maxMb * MB) fail(sizeMessage(size, p.maxMb));
  }
  route('POST', '/api/hris/jobs/:id/documents/uploads', 'hris', ({ params, body, user }) => {
    const o = openingForSeeker(user, params.id);
    const reqId = text(body.reqId, 60);
    if (!requirementsOf(o).some((r) => r.id === reqId)) fail('Pick a document from the checklist.');
    mayChange(o, user, reqId);
    const p = policy();
    const name = cleanName(text(body.name, 200) || 'file');
    quickCheck(p, name, Number(body.size));
    const replace = body.replace ? text(body.replace, 100) : null;
    if (replace && !filesFor(o.id, user.id).some((d) => d.id === replace)) fail('That file is no longer there. Upload the new one again.', 404);
    if (!replace && filesFor(o.id, user.id).length >= p.maxFiles) fail(countMessage(p.maxFiles));
    dropIdle();
    if ([...uploads.values()].filter((x) => x.owner === user.id).length >= MAX_UPLOADS_EACH) fail('Wait for the files being uploaded to finish, then add more.');
    if (inFlight() + Number(body.size) > MAX_IN_FLIGHT) fail('Many files are being uploaded right now. Try again in a minute.', 503);
    const x = { id: randomUUID(), owner: user.id, openingId: o.id, reqId, replace, name, size: Number(body.size), chunks: [], received: 0, usedAt: nowMs() };
    uploads.set(x.id, x);
    return { id: x.id, chunkBytes: ATTACH_CHUNK_BYTES };
  }, { applicants: true, audit: false, body: { reqId: t.str(100), name: t.str(400), size: t.num(), replace: t.str(100) } });
  const uploadOf = (user, o, id) => {
    const x = uploads.get(String(id || ''));
    if (!x || x.owner !== user.id || x.openingId !== o.id) fail('That upload is no longer on the server. Add the file again.', 404);
    return x;
  };
  route('PUT', '/api/hris/jobs/:id/documents/uploads/:uploadId', 'hris', ({ params, body, user }) => {
    const o = openingForSeeker(user, params.id);
    const x = uploadOf(user, o, params.uploadId);
    x.usedAt = nowMs();
    const offset = Number(body.offset);
    if (typeof body.data !== 'string' || !Number.isInteger(offset) || offset < 0) fail('Send a piece of the file.');
    const piece = Buffer.from(body.data, 'base64');
    if (!piece.length || piece.length > ATTACH_CHUNK_BYTES) fail('Send the file in pieces of up to 1 MB.');
    if (offset + piece.length <= x.received) return { received: x.received }; // a piece sent again
    if (offset !== x.received) fail(`The upload of ${x.name} lost its place. Add the file again.`, 409);
    if (x.received + piece.length > x.size) {
      uploads.delete(x.id);
      fail(`${x.name} is larger than it said it was. Add it again.`);
    }
    x.chunks.push(piece);
    x.received += piece.length;
    return { received: x.received };
  }, { applicants: true, audit: false, body: { offset: t.num(), data: t.str(MAX_ATTACH_PIECE_BODY) } });
  route('DELETE', '/api/hris/jobs/:id/documents/uploads/:uploadId', 'hris', ({ params, user }) => {
    const x = uploads.get(String(params.uploadId || ''));
    if (x && x.owner === user.id) uploads.delete(x.id);
    return { ok: true };
  }, { applicants: true, audit: false });
  route('POST', '/api/hris/jobs/:id/documents/uploads/:uploadId/finish', 'hris', ({ params, user, ip, agent }) => {
    const o = openingForSeeker(user, params.id);
    const x = uploadOf(user, o, params.uploadId);
    uploads.delete(x.id);
    if (x.received !== x.size) fail(`${x.name} did not arrive whole. Add it again.`);
    const rule = mayChange(o, user, x.reqId);
    const buf = Buffer.concat(x.chunks);
    const p = policy();
    if (buf.length > p.maxMb * MB) fail(sizeMessage(buf.length, p.maxMb));
    // What the file really is, from its bytes; then the policy's types.
    const families = [...new Set(p.types.flatMap((k) => FAMILIES_FOR[k] || []))];
    const c = checkFile(buf, x.name, families.length ? families : FAMILIES.map((f) => f.id));
    if (!c.ok) fail(c.code === 'type' ? `${x.name}: ${typeMessage(p)}` : /program|web page|could not tell/.test(c.reason) ? `${atlas(c.reason)} ${typeMessage(p)}` : atlas(c.reason));
    if (!p.types.includes(TYPE_OF_EXT[c.ext])) fail(`${x.name}: ${typeMessage(p)}`);
    const old = x.replace ? filesFor(o.id, user.id).find((d) => d.id === x.replace) : null;
    if (x.replace && !old) fail('That file is no longer there. Upload the new one again.', 404);
    if (old && old.reqId !== x.reqId) fail('Replace a file with one for the same document.');
    if (!old && filesFor(o.id, user.id).length >= p.maxFiles) fail(countMessage(p.maxFiles));
    const stored = blobs.put(buf);
    const rec = { id: randomUUID(), openingId: o.id, userId: user.id, reqId: x.reqId, blobId: stored.blobId, sha256: stored.sha256, name: c.name, ext: c.ext, mime: c.mime, size: stored.size, at: iso() };
    if (old) {
      blobs.remove(old.blobId);
      data().jobDocuments = docs().filter((d) => d.id !== old.id);
    }
    docs().push(rec);
    // A new file undoes HR's review of the item: it is Uploaded again, for HR to check.
    const a = rule.a || applicationOf(o, user.id);
    const req = requirementsOf(o).find((r) => r.id === x.reqId);
    const before = reviewOf(a, x.reqId);
    if (a && before) {
      a.docReview = { ...a.docReview };
      delete a.docReview[x.reqId];
    }
    if (a && a.status !== 'withdrawn') {
      if (before?.status === 'needs-new') toHr(o, { kind: 'job.document', title: `${nameOf(a)} uploaded a new file for ${req.name}`, body: `${o.title} · you asked for a new file`, link: `/hris/#/recruitment/${o.id}/documents/${a.id}` }, user.id);
      ctx.audit({ kind: 'document', system: 'people', action: old ? 'Replaced a document of a job application' : 'Uploaded a document to a job application', actor: user, target: { id: a.id, name: `${nameOf(a)} · ${o.title}` }, ip, agent, detail: `${req.name}: ${rec.name} (${Math.max(1, Math.round(rec.size / 1024))} KB)${rule.late ? ' · after the closing date, as HR asked' : ''}` });
    }
    save();
    return myView(o, user);
  }, { applicants: true, audit: false });
  route('DELETE', '/api/hris/jobs/:id/documents/files/:fileId', 'hris', ({ params, user, ip, agent }) => {
    const o = openingForSeeker(user, params.id);
    const d = filesFor(o.id, user.id).find((x) => x.id === params.fileId) || fail('File not found.', 404);
    const r = changeRule(o, user, d.reqId);
    if (!r.ok || r.late) fail(r.ok ? 'The opening has closed: upload the new file HR asked for, and keep this one.' : r.why, 403);
    blobs.remove(d.blobId);
    data().jobDocuments = docs().filter((x) => x.id !== d.id);
    const a = applicationOf(o, user.id);
    if (a?.docReview?.[d.reqId] && !filesFor(o.id, user.id).some((x) => x.reqId === d.reqId)) {
      a.docReview = { ...a.docReview };
      delete a.docReview[d.reqId];
    }
    if (a && a.status !== 'withdrawn') ctx.audit({ kind: 'document', system: 'people', action: 'Removed a document from a job application', actor: user, target: { id: a.id, name: `${nameOf(a)} · ${o.title}` }, ip, agent, detail: d.name });
    save();
    return myView(o, user);
  }, { applicants: true, audit: false });
  route('GET', '/api/hris/jobs/:id/documents', 'hris', ({ params, user }) => myView(openingForSeeker(user, params.id), user), { applicants: true, audit: false });

  // ----- Downloads: signed in, as an attachment, never inline -----
  // Each download holds a place among the downloads that run at once (server/download-gate.js),
  // given back when the answer has been sent.
  function fileReply(d, who) {
    const release = ctx.downloads ? ctx.downloads.enter(who, d.size || 0) : () => {};
    let buf;
    try {
      buf = blobs.get(d.blobId, d.sha256);
    } catch (err) {
      release();
      if (err instanceof BlobError) fail(err.code === 'missing' ? 'The file is missing from the store. It may not have been included when data was restored.' : 'The stored file is damaged and cannot be opened.', 410);
      throw err;
    }
    return {
      raw: buf, type: d.mime, release,
      headers: {
        'Content-Disposition': contentDisposition('attachment', d.name), 'X-Content-Type-Options': 'nosniff', 'X-Download-Options': 'noopen',
        'Content-Security-Policy': "sandbox; default-src 'none'", 'Cache-Control': 'private, no-store', 'Cross-Origin-Resource-Policy': 'same-origin',
      },
    };
  }
  route('GET', '/api/hris/jobs/:id/documents/files/:fileId', 'hris', ({ params, user, ip }) => {
    const o = openingForSeeker(user, params.id);
    return fileReply(filesFor(o.id, user.id).find((x) => x.id === params.fileId) || fail('File not found.', 404), { user, ip });
  }, { applicants: true, audit: false });
  // HR and the opening's assessors: only files of someone who has applied.
  function forReader(user, d) {
    const o = openings().find((x) => x.id === d.openingId);
    const a = o ? applicationOf(o, d.userId) : null;
    if (!o || !a || a.removed) fail('File not found.', 404);
    const access = h.assess().openingForRater(user, o.id);
    return { o, a, hr: access.hr };
  }
  route('GET', '/api/hris/recruitment/documents/:fileId', 'hris', ({ params, user, ip, agent }) => {
    const d = docs().find((x) => x.id === params.fileId) || fail('File not found.', 404);
    const { o, a, hr } = forReader(user, d);
    const req = requirementsOf(o).find((r) => r.id === d.reqId);
    ctx.audit({ kind: 'document', system: 'people', action: hr ? 'Downloaded a document of a job application' : 'Downloaded a document of a job application (assessor)', actor: user, target: { id: a.id, name: `${nameOf(a)} · ${o.title}` }, ip, agent, detail: `${req?.name || 'Document'}: ${d.name}` });
    return fileReply(d, { user, ip });
  }, { audit: false });

  // ----- HR and assessors: an application's documents; HR's review -----
  function readerView(a, o, hr) {
    return {
      application: { id: a.id, name: nameOf(a), internal: a.internal, userId: a.removed ? null : a.userId, stageLabel: h.stageLabel(a.stage), status: a.status },
      opening: { id: o.id, title: o.title, closingDate: o.closingDate, open: openingAccepts(o, today()), requireBeforeApply: Boolean(o.requireDocsBeforeApply) },
      requirements: a.removed ? [] : itemsOf(o, a.userId, a, { forHr: hr }),
      summary: summary(a, o), readOnly: !hr, policy: policyOut(),
    };
  }
  route('GET', '/api/hris/recruitment/applications/:id/documents', 'hris', ({ params, user }) => {
    const a = applications().find((x) => x.id === params.id) || fail('Application not found.', 404);
    const access = h.assess().openingForRater(user, a.openingId);
    if (a.userId === user.id && !access.hr) fail('Application not found.', 404);
    return readerView(a, access.o, access.hr);
  }, { audit: false });
  route('PUT', '/api/hris/recruitment/applications/:id/documents/:reqId', 'hris:hris.recruitment', ({ params, body, user, ip, agent }) => {
    const a = applications().find((x) => x.id === params.id) || fail('Application not found.', 404);
    const o = openingForHr(user, a.openingId);
    if (a.userId === user.id) fail('You cannot review the documents of your own application. Another HR person does.', 403);
    if (a.removed) fail('This applicant was removed.');
    const req = requirementsOf(o).find((r) => r.id === params.reqId) || fail('That document is not on this opening\'s checklist.', 404);
    const status = String(body.status || '');
    if (!['accepted', 'needs-new', ''].includes(status)) fail('Mark it Accepted or Needs a new file.');
    const note = text(body.note, 2000);
    if (note.length > POLICY_LIMITS.reviewNote) fail(`The note has at most ${POLICY_LIMITS.reviewNote} characters.`);
    const files = filesFor(o.id, a.userId).filter((d) => d.reqId === req.id);
    if (status === 'accepted' && !files.length) fail(`${req.name} has no file yet: it cannot be accepted.`);
    if (status === 'needs-new' && !note) fail('Write a note to the applicant: what is wrong, and what to upload instead.');
    const before = reviewOf(a, req.id);
    a.docReview = { ...(a.docReview || {}) };
    if (status) a.docReview[req.id] = { status, note, by: user.name, byId: user.id, at: iso() };
    else delete a.docReview[req.id];
    ctx.audit({
      kind: 'document', system: 'people', action: status === 'accepted' ? 'Accepted a document of a job application' : status === 'needs-new' ? 'Asked for a new file for a job application' : 'Cleared the review of a document of a job application',
      actor: user, target: { id: a.id, name: `${nameOf(a)} · ${o.title}` }, ip, agent, detail: req.name,
      changes: [{ field: req.name, from: before ? docStatusLabel(before.status) : docStatusLabel(itemStatus(files, null)), to: docStatusLabel(itemStatus(files, a.docReview[req.id])) }, ...(note ? [{ field: 'Note to the applicant', from: '', to: note }] : [])],
    });
    if (status) {
      ctx.notify([a.userId], {
        system: 'hris', kind: status === 'accepted' ? 'job.document.accepted' : 'job.document.needs-new',
        title: status === 'accepted' ? `${req.name} was accepted` : `HR asks for a new file: ${req.name}`,
        body: `${o.title}${note ? ` · Note from HR: ${note}` : ''}${status === 'needs-new' ? ' Upload it under My applications.' : ''}`,
        link: `/hris/#/jobs/mine/${a.id}`,
      }); // no actor: the applicant is told "HR office", never a name
    }
    save();
    return readerView(a, o, true);
  }, { audit: false, body: { status: t.str(20), note: t.str(4000) } });

  // ----- Settings: the upload policy and the default checklists (HR settings → Applicant documents) -----
  const settingsView = () => ({ ...policy(), uploadTypes: UPLOAD_TYPES, limits: POLICY_LIMITS, categories: (h.categories() || []).map((c) => ({ id: c.id, label: c.label })) });
  function cleanSettings(body) {
    const now = policy();
    const out = { ...now };
    if (body.types !== undefined) {
      if (!Array.isArray(body.types)) fail('Pick the file types applicants may upload.');
      const bad = body.types.find((k) => !UPLOAD_TYPES.some((x) => x.id === k));
      if (bad) fail(`${String(bad).slice(0, 30)} is not a file type ATLAS offers here.`);
      out.types = UPLOAD_TYPES.map((x) => x.id).filter((k) => body.types.includes(k));
      if (!out.types.length) fail('Allow at least one file type.');
    }
    const num = (k, label, unit) => {
      if (body[k] === undefined) return;
      const n = Number(body[k]);
      const [lo, hi] = POLICY_LIMITS[k];
      if (body[k] === '' || body[k] === null || !Number.isInteger(n) || n < lo || n > hi) fail(`${label}: ${lo} to ${hi} ${unit}.`);
      out[k] = n;
    };
    num('maxMb', 'Largest file', 'MB');
    num('maxFiles', 'Most files per application', 'files');
    if (body.help !== undefined) {
      const help = typeof body.help === 'string' ? body.help.replace(/\r\n?/g, '\n').trim() : '';
      if (help.length > POLICY_LIMITS.help) fail(`The help text has at most ${POLICY_LIMITS.help} characters.`);
      out.help = help;
    }
    if (body.checklists !== undefined) {
      if (!body.checklists || typeof body.checklists !== 'object' || Array.isArray(body.checklists)) fail('Send a checklist for each position category.');
      const cats = new Set((h.categories() || []).map((c) => c.id));
      const next = {};
      for (const [k, list] of Object.entries(body.checklists)) {
        if (!cats.has(k)) continue; // a category since removed
        next[k] = cleanRequirements({ requirements: Array.isArray(list) ? list : [] }, null, k).requirements;
      }
      out.examples = now.examples.filter((k) => JSON.stringify(next[k]) === JSON.stringify(DEFAULT_CHECKLISTS[k]));
      out.checklists = next;
    }
    return out;
  }
  route('GET', '/api/hris/recruitment/documents-settings', 'hris', ({ user }) => {
    if (!h.userCan(user, 'hris.recruitment') && !h.userCan(user, 'hris.settings')) fail('You do not have access to this.', 403);
    return { ...settingsView(), defaults: DEFAULT_APPLICANT_DOCS };
  }, { audit: false });
  route('PUT', '/api/hris/recruitment/documents-settings', 'hris:hris.settings', ({ body }) => {
    data().settings.applicantDocs = cleanSettings(body);
    save();
    return settingsView();
  }, { body: { types: t.arr(t.str(40), 20), maxMb: t.any(), maxFiles: t.any(), help: t.str(4000), checklists: t.any(), examples: t.any() } });

  // ----- Hooks for server/recruitment.js -----
  function removeFiles(list) {
    if (!list.length) return 0;
    const gone = new Set(list.map((d) => d.id));
    for (const d of list) blobs.remove(d.blobId);
    data().jobDocuments = docs().filter((d) => !gone.has(d.id));
    return list.length;
  }
  // The applicant account is removed: every file of theirs goes.
  const onRemoveUser = (userId) => removeFiles(docs().filter((d) => d.userId === userId));
  // An opening deleted (it had no applications): files uploaded for it go.
  const onRemoveOpening = (openingId) => removeFiles(docs().filter((d) => d.openingId === openingId));
  // Someone left the pool of applicants: the files of their applications that ended go.
  function onLeftPool(userId, why) {
    if (why === 'removed') return 0;
    const ended = new Set(applications().filter((a) => a.userId === userId && ['not-selected', 'withdrawn'].includes(a.status)).map((a) => a.openingId));
    return removeFiles(docs().filter((d) => d.userId === userId && ended.has(d.openingId)));
  }
  // The daily sweep: files for an opening someone never applied to, once it stops taking applications.
  function sweep() {
    const stale = docs().filter((d) => {
      const o = openings().find((x) => x.id === d.openingId);
      return !o || (!openingAccepts(o, today()) && !applicationOf(o, d.userId));
    });
    return removeFiles(stale) > 0;
  }
  // Before applying: the required documents, when the opening asks for them first.
  function checkBeforeApply(o, user) {
    if (!o.requireDocsBeforeApply) return;
    const files = filesFor(o.id, user.id);
    const c = completeness(requirementsOf(o), (id) => files.filter((d) => d.reqId === id));
    if (!c.complete) fail(`Upload these required documents before applying: ${c.missingNames.join(', ')}.`, 409);
  }
  // The applicant profile (PL-019): the documents of one application.
  function profileDocuments(a, o) {
    if (!o || !a || a.removed) return [];
    return itemsOf(o, a.userId, a, { forHr: true }).filter((it) => it.files.length || it.required).map(({ id, name, required, status, statusLabel, files, review }) => ({ id, name, required, status, statusLabel, files, note: review?.note || '' }));
  }

  // ----- Demo data: a few small generated PDFs (no real documents), marked demo -----
  // files: [[opening, user, reqId, name, lines]]; reviews: [[application, reqId, status, note, by]].
  function addDemo({ pdf, files = [], reviews = [] } = {}) {
    if (docs().some((d) => d.demo)) return;
    for (const [o, u, reqId, name, lines, daysAgo = 3] of files) {
      if (!o || !u || !requirementsOf(o).some((r) => r.id === reqId)) continue;
      const buf = pdf(`DEMO · ${name.replace(/\.pdf$/, '')}`, ['This is a generated demo file, not a real document.', ...lines]);
      const stored = blobs.put(buf);
      docs().push({ id: randomUUID(), demo: true, openingId: o.id, userId: u.id, reqId, blobId: stored.blobId, sha256: stored.sha256, name, ext: 'pdf', mime: 'application/pdf', size: stored.size, at: new Date(nowMs() - daysAgo * 86400000).toISOString() });
    }
    for (const [a, reqId, status, note, by] of reviews) {
      if (!a) continue;
      a.docReview = { ...(a.docReview || {}), [reqId]: { status, note, by, byId: null, at: new Date(nowMs() - 86400000).toISOString() } };
    }
  }
  function removeDemo() {
    const demoUsers = new Set(data().users.filter((u) => u.demo).map((u) => u.id));
    const demoOpenings = new Set(openings().filter((o) => o.demo).map((o) => o.id));
    removeFiles(docs().filter((d) => d.demo || demoUsers.has(d.userId) || demoOpenings.has(d.openingId)));
  }

  return {
    blobs, dir, cleanRequirements, checklistFor, summary, documentsOf: (a, o) => (requirementsOf(o).length && !a.removed ? itemsOf(o, a.userId, a).map(({ id, name, required, status, statusLabel, files }) => ({ id, name, required, status, statusLabel, files })) : []),
    profileDocuments, onRemoveUser, onRemoveOpening, onLeftPool, sweep, checkBeforeApply, addDemo, removeDemo, policy, uploads,
  };
}
