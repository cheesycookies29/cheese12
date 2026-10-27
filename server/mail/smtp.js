// Minimal SMTP client for the helpdesk's outgoing mail: implicit TLS (465) or
// STARTTLS (587), AUTH PLAIN or LOGIN, then one message to its recipients.
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';

const TIMEOUT_MS = 20000;

function reader(socket) {
  let buf = '';
  let waiting = null;
  let failure = null;
  const tryResolve = () => {
    if (!waiting) return;
    if (failure) return waiting.reject(failure), (waiting = null);
    // A reply ends with a line "NNN text" (no dash after the code).
    const lines = buf.split('\r\n');
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\d{3}(?: |$)/.test(lines[i])) {
        const reply = lines.slice(0, i + 1);
        buf = lines.slice(i + 1).join('\r\n');
        const w = waiting;
        waiting = null;
        return w.resolve({ code: Number(reply.at(-1).slice(0, 3)), lines: reply.map((l) => l.slice(4)) });
      }
    }
  };
  const onData = (d) => ((buf += d.toString('latin1')), tryResolve());
  const onError = (e) => ((failure = e), tryResolve());
  const bind = (s) => {
    s.setTimeout(TIMEOUT_MS, () => s.destroy(new Error('The mail server did not respond in time.')));
    s.on('data', onData).on('error', onError).on('close', () => onError(new Error('The mail server closed the connection.')));
  };
  bind(socket);
  return {
    next: () => new Promise((resolve, reject) => ((waiting = { resolve, reject }), tryResolve())),
    rebind: (s) => {
      socket.removeListener('data', onData).removeListener('error', onError).removeAllListeners('close');
      bind(s);
    },
  };
}

const dotStuff = (msg) => msg.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');

// opts: { host, port, secure, starttls, user, password, tlsOptions }; mail: { from, to: [emails], raw }
export async function sendMail(opts, mail) {
  const port = Number(opts.port) || (opts.secure ? 465 : 587);
  let socket = opts.secure
    ? tls.connect({ host: opts.host, port, servername: opts.host, ...(opts.tlsOptions || {}) })
    : net.connect({ host: opts.host, port });
  const r = reader(socket);
  const expect = async (codes, what) => {
    const res = await r.next();
    if (!codes.includes(res.code)) throw new Error(`${what} failed: ${res.code} ${res.lines.join(' ')}`);
    return res;
  };
  const say = (line, codes, what) => (socket.write(`${line}\r\n`), expect(codes, what));
  try {
    await expect([220], 'Connecting');
    const name = os.hostname().replace(/[^a-z0-9.-]/gi, '') || 'localhost';
    let ehlo = await say(`EHLO ${name}`, [250], 'EHLO');
    if (!opts.secure && opts.starttls !== false && ehlo.lines.some((l) => /^STARTTLS/i.test(l))) {
      await say('STARTTLS', [220], 'STARTTLS');
      const secure = tls.connect({ socket, servername: opts.host, ...(opts.tlsOptions || {}) });
      await new Promise((resolve, reject) => secure.once('secureConnect', resolve).once('error', reject));
      r.rebind(secure);
      socket = secure;
      ehlo = await say(`EHLO ${name}`, [250], 'EHLO');
    } else if (!opts.secure && opts.starttls === true) throw new Error('The server does not offer STARTTLS.');
    if (opts.user) {
      const auth = ehlo.lines.find((l) => /^AUTH\b/i.test(l)) || '';
      try {
        if (/\bPLAIN\b/i.test(auth) || !/\bLOGIN\b/i.test(auth)) {
          await say(`AUTH PLAIN ${Buffer.from(`\u0000${opts.user}\u0000${opts.password}`).toString('base64')}`, [235], 'Sign-in');
        } else {
          await say('AUTH LOGIN', [334], 'Sign-in');
          await say(Buffer.from(opts.user).toString('base64'), [334], 'Sign-in');
          await say(Buffer.from(opts.password).toString('base64'), [235], 'Sign-in');
        }
      } catch (err) {
        throw Object.assign(err, { auth: true });
      }
    }
    await say(`MAIL FROM:<${mail.from}>`, [250], 'Sender');
    for (const to of mail.to) await say(`RCPT TO:<${to}>`, [250, 251], `Recipient ${to}`);
    await say('DATA', [354], 'DATA');
    socket.write(dotStuff(mail.raw));
    await say('\r\n.', [250], 'Sending');
    socket.write('QUIT\r\n');
  } finally {
    socket.end();
  }
}
