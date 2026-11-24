// Document Management: the files themselves, encrypted at rest (shared by CORE and ATLAS).
//
// Each file is encrypted with AES-256-GCM under its own random key; that key is stored with the file,
// itself encrypted (AES-256-GCM) with the "master" key the app derives from its server key. A copy of
// the documents folder without the server key cannot be read. On every read the GCM tag proves the
// file was not changed, and the SHA-256 of the content is compared with the one kept in the record.
//
// File layout: "CDM1" | wrapIv(12) | wrapTag(16) | wrappedKey(32) | iv(12) | tag(16) | ciphertext.
// Files live in <dir>/<first 2 hex of id>/<id>, written to a temporary name, flushed, then renamed.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHash } from 'node:crypto';

const MAGIC = Buffer.from('CDM1');
const HEAD = 4 + 12 + 16 + 32 + 12 + 16;
const ID_RE = /^[0-9a-f]{32}$/;

export class BlobError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export function createBlobStore(dir, masterKey) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) throw new Error('The documents key must be 32 bytes.');
  const fileOf = (id) => {
    if (!ID_RE.test(String(id || ''))) throw new BlobError('That file is not in the document store.', 'missing');
    return path.join(dir, id.slice(0, 2), id);
  };
  const seal = (key, data) => {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([c.update(data), c.final()]);
    return { iv, tag: c.getAuthTag(), enc };
  };
  const open = (key, iv, tag, enc) => {
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]);
  };
  return {
    // Stores `buffer`; returns { blobId, sha256, size }.
    put(buffer) {
      const id = randomUUID().replace(/-/g, '');
      const file = fileOf(id);
      const key = randomBytes(32);
      const wrapped = seal(masterKey, key);
      const body = seal(key, buffer);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.part`;
      const fd = fs.openSync(tmp, 'w', 0o600);
      try {
        fs.writeSync(fd, Buffer.concat([MAGIC, wrapped.iv, wrapped.tag, wrapped.enc, body.iv, body.tag]));
        fs.writeSync(fd, body.enc);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, file);
      return { blobId: id, sha256: createHash('sha256').update(buffer).digest('hex'), size: buffer.length };
    },
    // The content, checked: the GCM tags (not changed, right key) and, when given, the SHA-256.
    get(blobId, sha256 = null) {
      const file = fileOf(blobId);
      if (!fs.existsSync(file)) throw new BlobError('The file is missing from the document store. It may not have been included when data was restored.', 'missing');
      const raw = fs.readFileSync(file);
      if (raw.length < HEAD || !raw.subarray(0, 4).equals(MAGIC)) throw new BlobError('The stored file is damaged.', 'damaged');
      let data;
      try {
        const key = open(masterKey, raw.subarray(4, 16), raw.subarray(16, 32), raw.subarray(32, 64));
        data = open(key, raw.subarray(64, 76), raw.subarray(76, 92), raw.subarray(92));
      } catch {
        throw new BlobError('The stored file cannot be opened: it was changed, or it was encrypted with another server\'s key.', 'damaged');
      }
      if (sha256 && createHash('sha256').update(data).digest('hex') !== sha256) throw new BlobError('The stored file does not match its fingerprint (SHA-256): it was changed.', 'damaged');
      return data;
    },
    exists: (blobId) => {
      try {
        return fs.existsSync(fileOf(blobId));
      } catch {
        return false;
      }
    },
    remove(blobId) {
      try {
        fs.rmSync(fileOf(blobId), { force: true });
      } catch { /* not a blob id: nothing to remove */ }
    },
    // Bytes used on disk by every stored file (encrypted size).
    usage() {
      let bytes = 0;
      let files = 0;
      if (!fs.existsSync(dir)) return { bytes, files };
      for (const sub of fs.readdirSync(dir)) {
        if (!/^[0-9a-f]{2}$/.test(sub)) continue;
        for (const f of fs.readdirSync(path.join(dir, sub))) {
          if (!ID_RE.test(f)) continue;
          bytes += fs.statSync(path.join(dir, sub, f)).size;
          files++;
        }
      }
      return { bytes, files };
    },
    // Ids of stored files no record points to (left over from a restore, or a failed upload).
    orphans(known) {
      const out = [];
      if (!fs.existsSync(dir)) return out;
      for (const sub of fs.readdirSync(dir)) {
        if (!/^[0-9a-f]{2}$/.test(sub)) continue;
        for (const f of fs.readdirSync(path.join(dir, sub))) if (ID_RE.test(f) && !known.has(f)) out.push(f);
      }
      return out;
    },
  };
}
