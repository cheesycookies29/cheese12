# Document Management (MOD-08): plan

The Document Management module of CORE, and the Documents app of ATLAS. Both are built on the same
engine (CORE `server/dms/`, ATLAS `lms/server/dms/`, the same files) with Node's standard library
only. This plan is the reference for both; the user guides say the same things in plain words.

## References studied (November 2026)

- **n8n** — binary data service (`packages/core/src/binary-data/`), file-access restrictions
  (`N8N_RESTRICT_FILE_ACCESS_TO`, `N8N_BLOCK_FILE_PATTERNS`), the binary-data controller (access from the
  parent record, 404 on denial, `view` only for passive types, CSP sandbox on every file, signed short-lived
  URLs). Taken: 404 on denial, passive-inline/active-download, sandbox on every response, path containment,
  name sanitising. Not taken: MIME from the extension before the content (a DMS must trust the bytes).
- **Paperless-ngx** — libmagic type check against what it can parse, SHA-256 duplicate detection, trash
  with a delay, sanity checker that re-hashes every file, per-object view/change grants.
- **Mayan EDMS** — documents vs uploaded files vs versions, check-out with expiry and forced check-in,
  ACL inheritance, encrypted storage wrapper, quotas, an event per view and download.
- **Seafile (seahub)** — share links with password, expiry, view-only, upload-only links, per-role link
  permissions, admin min/max/default expiry, forced passwords, anonymous throttle, "a link never grants
  more than the sharer holds", password unlock bound to the password hash.
- **Nextcloud** — permission bitmask, file-drop (create-only) links, re-checking every share on every
  access, brute-force protection on link passwords, access events, the admin Sharing page, blocked
  extensions, trash/version retention, per-file keys for server-side encryption.
- **Teedy** — per-file keys (encrypted at rest), html/js/xml always downloaded as octet-stream with
  `CSP: sandbox; default-src 'none'`.
- **Papermerge** — magic-byte allowlist with the extension as a second check, version checksums, a
  separate download scope, the richest audit record.

## Model (JSON store)

- `docFolders` `{ id, parentId, name, kind: 'shared'|'personal', ownerId, acl: [grant], inherit: true,
  createdAt, createdBy, trashedAt, trashedBy, legalHold }`
- `documents` `{ id, number: 'DOC-2026-0001', folderId, title, description, tags[], classification:
  'public'|'internal'|'confidential'|'restricted', status: 'draft'|'final'|'obsolete', ownerId,
  versions: [version], currentVersion (number), checkout: { userId, at, until } | null, acl: [grant],
  legalHold, retainUntil, source: 'upload'|'link-upload', reviewed: bool, createdAt, updatedAt,
  trashedAt, trashedBy }`
- version `{ no, blobId, name, ext, family, mime (sniffed), size, sha256, by, at, note }`
- grant `{ type: 'user'|'role'|'department'|'everyone', id, level: 'view'|'edit'|'manage',
  download: true, share: false, by, at, until }` — `everyone` means every signed-in account (internal).
- `docLinks` (external shares) `{ id, tokenHash (sha256 of the 32-byte token), hint (last 4),
  target: { kind: 'document'|'folder', id }, mode: 'view'|'download'|'upload', passwordHash (scrypt) |
  null, linkVersion, expiresAt, maxDownloads, downloads, views, uploads, note, createdBy, createdAt,
  revokedAt, revokedBy, lastAccessAt }`
- `docEvents` `{ at, docId|folderId|linkId, action, by (user id or 'link:<id>'), ip, note }` — the
  per-document activity, capped; the company audit log gets the same actions.
- `docSettings` — the control panel (below).
- Blobs: `data/documents/<2 hex>/<blob id>`, encrypted (below). Not in `db.json`.

## Access

Levels: **view** (read metadata, preview, download unless `download: false`), **edit** (+ new versions,
metadata, check-out), **manage** (+ grants, links, trash, legal hold where allowed). Effective level =
the highest of: owner (manage), document grants, folder grants up the chain while `inherit` is on,
`docs.manage` holders (manage everything; administrators have it). Personal folders belong to one person
and cannot be shared as a folder (documents in them can). A grant or link never gives more than the giver
holds. Denial answers **404** (as if it did not exist), like n8n and Nextcloud.

## Security layers (upload → storage → download)

1. **Request** — signed in (CSRF and host checks as for all CORE requests), uploads in pieces (4 MB, one
   request each, retried; as PDF Studio), rate limits per person and per address, size cap per file,
   storage quota per person.
2. **Name** — basename only, control characters and `\/:*?"<>|` removed, no leading dots, ≤ 200
   characters, extension lower-cased.
3. **Content** — the type comes from the bytes (magic numbers, ZIP and compound-file contents), never the
   name or the browser. It must be a type the control panel accepts, and agree with the extension's family
   (a `.pdf` that is not a PDF is refused). **Always refused, whatever the settings:** programs and scripts
   (Windows/Linux/Mac executables, installers, .bat/.cmd/.ps1/.vbs/.js/.jar/.sh/.hta/.lnk/.scr/.msi…),
   web pages and SVG (they can run code in a browser), Office files with macros, password-protected Office
   files, ZIP files that unpack to far more than they hold or contain a refused type.
4. **Integrity** — SHA-256 of the content kept with each version; checked on every download; the control
   panel's integrity check re-reads every file. Duplicates (same SHA-256 in the same folder) are flagged.
5. **At rest** — every file is encrypted with AES-256-GCM under its own random key; that key is stored
   wrapped (AES-256-GCM) with a key derived from the server key (`secret.key`). A copy of `data/documents`
   without the server key cannot be read.
6. **Download** — access checked first (404 otherwise), the stored sniffed type, `Content-Disposition`
   with an RFC 5987 file name, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src
   'none'; sandbox`, `Cache-Control: private, no-store`. Only PDF and pictures open in the browser; every
   other type downloads. Restricted documents cannot be downloaded through links at all.
7. **Sharing** — internal grants within the giver's own level; external links (below) under the control
   panel's policy, re-checked on every request.
8. **Retention** — trash with a retention period (then purged by a sweep), legal hold blocks trashing and
   purging, version count kept per document.
9. **Audit** — every upload, new version, download, view, share, link access, permission change, check-out,
   trash, restore, purge, hold and settings change in the company audit log and the document's activity.

## External links

Token: 32 random bytes, base64url, shown once; only its SHA-256 is stored. A link is
`/share/<token>` (a page outside the app). On every request: found by hash; not revoked, not expired, the
creator still active and still able to share it, links still allowed by the policy, the target not in
trash — otherwise the same "not available" page. Password: scrypt; after a correct password the browser
gets an HttpOnly cookie for that link holding HMAC(key, linkId | passwordHash | linkVersion), so changing
the password or revoking signs everyone out. Rate limits per address and per link; wrong passwords count
separately and slow down. Modes: **view** (preview PDF/pictures; others show their details only),
**download** (counts toward an optional limit), **upload** (a file drop into a folder: files go in as
"received, not yet reviewed", with the same content checks). Every access is logged; the creator is told
the first time a link is opened and when files arrive through an upload link.

## Control panel (Admin panel → Document control; permission `docs.manage`)

- **File types** — by family (PDF; pictures; Word, Excel, PowerPoint; older Office; OpenDocument; RTF;
  text and CSV; e-mail; archives (ZIP); audio; video; CAD/drawings), each a switch, with its extensions; the
  always-refused list shown locked; what happens on a name/content mismatch (refuse).
- **Uploads & storage** — max file size (MB, ≤ 100), quota per person (MB, 0 = none), versions kept per
  document, duplicate handling (warn / refuse).
- **Sharing** — internal sharing on/off, share with "everyone" allowed, external links on/off, upload
  links on/off, password required, minimum password length, default and maximum expiry (days),
  maximum downloads default, which classifications may be shared by link (never Restricted), who may make
  links (all users / document managers only).
- **Classification** — the four levels and their rules (Restricted: no links, no download by view-only
  grants; Confidential: links need a password).
- **Retention** — days in trash before purge, check-out maximum hours.
- **Activity** — storage used, documents, active links (with revoke and revoke all), refused uploads with
  the reason, the integrity check (run, last result).

## ATLAS

The same engine and rules as a separate app at `/documents/` for every signed-in employee, teacher and
student (parents and guardians do not use it). Students can keep their own files and open what is shared
with them; staff can create shared folders. The control panel is a page of the ATLAS admin panel.
Departments come from the HRIS employee records; account types replace CORE's roles.

## Later

Approval routes for documents, full-text search in ATLAS, PDF watermarking on link downloads, an optional
ClamAV (clamd) scan, e-mail-code guest access, folder ZIP download, S3 storage.
