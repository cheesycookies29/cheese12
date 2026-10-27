// Encryption of stored credentials (mailbox passwords). The key is a random file next to
// the data file, readable only by the app's account, so passwords are not readable in
// db.json or in downloaded backups. A backup restored elsewhere needs the passwords re-entered.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export function createSecrets(dir) {
  const file = path.join(dir, 'secret.key');
  let key = null;
  const getKey = () => {
    if (key) return key;
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
    }
    key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    return key;
  };
  return {
    seal(plain) {
      if (!plain) return null;
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', getKey(), iv);
      const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
      return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
    },
    // null when missing or sealed with another key (e.g. a backup from another server).
    open(sealed) {
      const m = String(sealed || '').match(/^v1:([^:]+):([^:]+):(.*)$/);
      if (!m) return null;
      try {
        const d = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(m[1], 'base64'));
        d.setAuthTag(Buffer.from(m[2], 'base64'));
        return Buffer.concat([d.update(Buffer.from(m[3], 'base64')), d.final()]).toString('utf8');
      } catch {
        return null;
      }
    },
  };
}
