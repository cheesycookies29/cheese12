// Minimal IMAP4rev1 client: just what the helpdesk needs to read a mailbox.
// Connects over TLS (port 993) or upgrades with STARTTLS (port 143), logs in,
// selects a folder, lists unread messages, downloads them and marks them read.
import net from 'node:net';
import tls from 'node:tls';

const TIMEOUT_MS = 20000;
const quote = (s) => `"${String(s).replace(/[\\"]/g, (c) => `\\${c}`)}"`;

class ImapClient {
  constructor(socket) {
    this.tag = 0;
    this.buf = Buffer.alloc(0);
    this.waiters = [];
    this.attach(socket);
  }

  attach(socket) {
    this.socket = socket;
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('The mail server did not respond in time.')));
    socket.on('data', (chunk) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this.pump();
    });
    socket.on('error', (err) => this.fail(err));
    socket.on('close', () => this.fail(new Error('The mail server closed the connection.')));
  }

  fail(err) {
    const waiters = this.waiters.splice(0);
    for (const w of waiters) w.reject(err);
    this.failed ||= err;
  }

  // Splits the stream into responses; a line ending in {n} carries n bytes of literal data.
  nextResponse() {
    let text = '';
    const literals = [];
    let pos = 0;
    for (;;) {
      const eol = this.buf.indexOf('\r\n', pos);
      if (eol < 0) return null;
      const line = this.buf.subarray(pos, eol).toString('latin1');
      const lit = line.match(/\{(\d+)\}$/);
      if (!lit) {
        text += line;
        this.buf = this.buf.subarray(eol + 2);
        return { text, literals };
      }
      const n = Number(lit[1]);
      if (this.buf.length < eol + 2 + n) return null;
      literals.push(this.buf.subarray(eol + 2, eol + 2 + n));
      text += `${line.slice(0, -lit[0].length)}\u0000LIT${literals.length - 1}\u0000`;
      pos = eol + 2 + n;
    }
  }

  pump() {
    let r;
    while (this.waiters.length && (r = this.nextResponse())) {
      const w = this.waiters[0];
      if (w.greeting) {
        this.waiters.shift();
        w.resolve(r);
        continue;
      }
      if (r.text.startsWith('+') && w.onContinue) {
        w.onContinue();
        continue;
      }
      if (r.text.startsWith(`${w.tag} `)) {
        this.waiters.shift();
        const [, status, rest] = r.text.match(/^\S+ (\S+) ?(.*)$/) || [];
        if (status === 'OK') w.resolve({ untagged: w.untagged, text: rest });
        else w.reject(Object.assign(new Error(rest || `IMAP ${status}`), { imapStatus: status }));
      } else w.untagged.push(r);
    }
  }

  greeting() {
    return new Promise((resolve, reject) => {
      if (this.failed) return reject(this.failed);
      this.waiters.push({ greeting: true, resolve, reject });
      this.pump();
    });
  }

  // parts: strings, or Buffers sent as literals. Each literal goes out after the server's "+" go-ahead.
  command(...parts) {
    return new Promise((resolve, reject) => {
      if (this.failed) return reject(this.failed);
      const tag = `A${String(++this.tag).padStart(4, '0')}`;
      const chunks = [];
      let cur = [Buffer.from(`${tag} `)];
      for (const p of parts) {
        if (Buffer.isBuffer(p)) {
          cur.push(Buffer.from(`{${p.length}}\r\n`));
          chunks.push(Buffer.concat(cur));
          cur = [p];
        } else cur.push(Buffer.from(p, 'latin1'));
      }
      cur.push(Buffer.from('\r\n'));
      chunks.push(Buffer.concat(cur));
      this.waiters.push({ tag, untagged: [], resolve, reject, onContinue: () => chunks.length && this.socket.write(chunks.shift()) });
      this.socket.write(chunks.shift());
    });
  }

  async login(user, pass) {
    const safe = (s) => /^[\x20-\x7e]*$/.test(s);
    if (safe(user) && safe(pass)) return this.command(`LOGIN ${quote(user)} ${quote(pass)}`);
    return this.command('LOGIN ', Buffer.from(user, 'utf8'), ' ', Buffer.from(pass, 'utf8'));
  }

  select(folder) {
    return this.command(`SELECT ${quote(folder || 'INBOX')}`);
  }

  async searchUnseen() {
    const res = await this.command('UID SEARCH UNSEEN');
    const line = res.untagged.find((u) => /^\* SEARCH\b/i.test(u.text));
    return line ? line.text.replace(/^\* SEARCH\s*/i, '').split(/\s+/).filter(Boolean).map(Number) : [];
  }

  // Whole message, without setting \Seen (that happens after it is stored).
  async fetch(uid) {
    const res = await this.command(`UID FETCH ${uid} (BODY.PEEK[])`);
    const hit = res.untagged.find((u) => /FETCH/i.test(u.text) && u.literals.length);
    return hit ? hit.literals[0] : null;
  }

  markSeen(uid) {
    return this.command(`UID STORE ${uid} +FLAGS.SILENT (\\Seen)`);
  }

  async starttls(host) {
    await this.command('STARTTLS');
    const raw = this.socket;
    raw.removeAllListeners('data');
    raw.removeAllListeners('error');
    raw.removeAllListeners('close');
    const secure = tls.connect({ socket: raw, servername: host });
    await new Promise((resolve, reject) => secure.once('secureConnect', resolve).once('error', reject));
    this.attach(secure);
  }

  async logout() {
    try {
      await this.command('LOGOUT');
    } catch {}
    this.socket.end();
  }
}

// Opens a session, runs fn(client), always logs out. opts: { host, port, secure, starttls, user, password, folder, tlsOptions }.
export async function withImap(opts, fn) {
  const port = Number(opts.port) || (opts.secure ? 993 : 143);
  const socket = opts.secure
    ? tls.connect({ host: opts.host, port, servername: opts.host, ...(opts.tlsOptions || {}) })
    : net.connect({ host: opts.host, port });
  const client = new ImapClient(socket);
  try {
    await client.greeting();
    if (!opts.secure && opts.starttls) await client.starttls(opts.host);
    try {
      await client.login(opts.user, opts.password);
    } catch (err) {
      throw Object.assign(new Error(`Sign-in to the mailbox failed: ${err.message}`), { auth: true });
    }
    await client.select(opts.folder);
    return await fn(client);
  } finally {
    await client.logout();
  }
}
