// Downloads of stored files (Document circulation, ATLAS Documents): each file is decrypted whole
// (AES-GCM over the whole file, server/dms/blobs.js) and held in memory until the visitor has received
// it, so how many run at once is capped: per person signed in, per network address otherwise (more on
// a school network), and in all, by count and by bytes. Past a cap the answer is 429 with Retry-After.
// A download's place is given back when its answer is finished or the connection closes (server.js),
// and after `holdMs` at the latest, so a place can never be lost for good.
import { HttpError } from './util.js';
import { limitKey } from './ratelimit.js';

const MB = 1024 * 1024;

// options: perKey (downloads at once per person or address), scaleFor(ip) (a multiplier for an
// address, e.g. a school network's), maxCount and maxBytes (in all), holdMs, now () => ms.
export function createDownloadGate({ perKey = 4, scaleFor = () => 1, maxCount = 32, maxBytes = 256 * MB, holdMs = 15 * 60000, retryAfter = 10, now = () => Date.now() } = {}) {
  const open = new Map(); // id → { key, bytes, at }
  let seq = 0;
  const busy = (message) => Object.assign(new HttpError(429, message), { headers: { 'Retry-After': String(retryAfter) } });
  const expire = () => {
    const t = now();
    for (const [id, d] of open) if (t - d.at > holdMs) open.delete(id);
  };
  return {
    // Takes a place for a download of `bytes` by `user` (or from `ip` when signed out); returns the
    // function that gives it back. Throws 429 when there is none.
    enter({ user = null, ip = '' } = {}, bytes = 0) {
      expire();
      const key = user ? `user:${user.id}` : `ip:${limitKey(ip || 'unknown')}`;
      const mine = [...open.values()].filter((d) => d.key === key).length;
      const allowed = user ? perKey : perKey * Math.max(1, Number(scaleFor(ip)) || 1);
      if (mine >= allowed) throw busy(`You are downloading ${mine} files already. Wait for them to finish, then try again.`);
      const inUse = [...open.values()].reduce((n, d) => n + d.bytes, 0);
      // One download always goes through, however large; more wait while the memory is in use.
      if (open.size && (open.size >= maxCount || inUse + bytes > maxBytes)) throw busy('Many files are being downloaded right now. Try again in a few seconds.');
      const id = ++seq;
      open.set(id, { key, bytes: Math.max(0, Number(bytes) || 0), at: now() });
      let given = false;
      return () => {
        if (given) return;
        given = true;
        open.delete(id);
      };
    },
    get active() {
      expire();
      return { count: open.size, bytes: [...open.values()].reduce((n, d) => n + d.bytes, 0) };
    },
  };
}
