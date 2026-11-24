// The server key: one random secret, kept outside the data file, from which ATLAS derives a separate
// key for each purpose (derive(label), an HMAC of the label), so the key itself is never used
// directly. ATLAS Documents encrypts every stored file with keys derived from it
// (server/documents.js), so a copy of data/documents, or a backup, cannot be read without it.
//
// The key: SERVER_KEY (64 hexadecimal characters), or the file server.key beside the data file,
// made on first start and readable by this app only (as password.key in server/auth.js). Keep a
// copy somewhere safe: without it, stored documents cannot be opened. Tests (no data folder) get a
// key that lives only in memory.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHmac } from 'node:crypto';

export function createSecrets(dir, env = process.env) {
  let key = null;
  const load = () => {
    if (key) return key;
    const hex = String(env.SERVER_KEY || '').trim();
    if (hex) {
      if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('SERVER_KEY must be 64 hexadecimal characters (32 bytes), e.g. from: openssl rand -hex 32');
      key = Buffer.from(hex, 'hex');
      return key;
    }
    if (!dir) {
      key = randomBytes(32);
      return key;
    }
    const file = path.join(dir, 'server.key');
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      try {
        fs.writeFileSync(file, `${randomBytes(32).toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
        console.log(`  A new server key was made: ${file}. Keep a copy somewhere safe; without it, stored documents cannot be opened.`);
      } catch (err) {
        if (err.code !== 'EEXIST') throw err; // another process made it first
      }
    }
    const text = fs.readFileSync(file, 'utf8').trim();
    if (!/^[0-9a-f]{64}$/i.test(text)) throw new Error(`${file} must hold 64 hexadecimal characters (32 bytes).`);
    key = Buffer.from(text, 'hex');
    return key;
  };
  return {
    // A 32-byte key for one purpose, e.g. derive('documents.master-key').
    derive: (label) => createHmac('sha256', load()).update(String(label)).digest(),
  };
}
