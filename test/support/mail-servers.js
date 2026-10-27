// Fake IMAP and SMTP servers for tests: plain TCP, just enough of each protocol for
// the helpdesk's mail client. The IMAP server serves `messages` and records \Seen flags.
import net from 'node:net';

export function fakeImap({ user = 'helpdesk@company.com', password = 'app-pass', messages = [] } = {}) {
  const box = { messages: messages.map((raw, i) => ({ uid: i + 1, raw: Buffer.from(raw), seen: false })), logins: 0 };
  const server = net.createServer((sock) => {
    let buf = '';
    let authed = false;
    sock.write('* OK fake IMAP ready\r\n');
    sock.on('data', (d) => {
      buf += d.toString('latin1');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const [tag, ...rest] = line.split(' ');
        const cmd = rest.join(' ');
        const ok = (t = 'done') => sock.write(`${tag} OK ${t}\r\n`);
        if (/^LOGIN /i.test(cmd)) {
          const m = cmd.match(/^LOGIN "((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)"$/i);
          box.logins += 1;
          if (m && m[1] === user && m[2] === password) (authed = true), ok('LOGIN completed');
          else sock.write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
        } else if (!authed && !/^LOGOUT/i.test(cmd)) sock.write(`${tag} BAD not authenticated\r\n`);
        else if (/^SELECT /i.test(cmd)) sock.write(`* ${box.messages.length} EXISTS\r\n`), ok('[READ-WRITE] SELECT completed');
        else if (/^UID SEARCH UNSEEN/i.test(cmd)) sock.write(`* SEARCH ${box.messages.filter((m) => !m.seen).map((m) => m.uid).join(' ')}\r\n`), ok();
        else if (/^UID FETCH (\d+)/i.test(cmd)) {
          const msg = box.messages.find((m) => m.uid === Number(cmd.match(/^UID FETCH (\d+)/i)[1]));
          if (msg) sock.write(Buffer.concat([Buffer.from(`* ${msg.uid} FETCH (UID ${msg.uid} BODY[] {${msg.raw.length}}\r\n`), msg.raw, Buffer.from(')\r\n')]));
          ok();
        } else if (/^UID STORE (\d+) \+FLAGS/i.test(cmd)) {
          const msg = box.messages.find((m) => m.uid === Number(cmd.match(/^UID STORE (\d+)/i)[1]));
          if (msg) msg.seen = true;
          ok();
        } else if (/^LOGOUT/i.test(cmd)) sock.write('* BYE\r\n'), ok(), sock.end();
        else sock.write(`${tag} BAD unknown command\r\n`);
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, box, add: (raw) => box.messages.push({ uid: box.messages.length + 1, raw: Buffer.from(raw), seen: false }) })));
}

export function fakeSmtp({ user = 'helpdesk@company.com', password = 'app-pass' } = {}) {
  const sent = [];
  const server = net.createServer((sock) => {
    let buf = '';
    let data = null;
    let env = { from: null, to: [] };
    sock.write('220 fake SMTP ready\r\n');
    sock.on('data', (d) => {
      buf += d.toString('latin1');
      for (;;) {
        if (data !== null) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          sent.push({ ...env, raw: buf.slice(0, end).replace(/^\.\./gm, '.') });
          buf = buf.slice(end + 5);
          data = null;
          env = { from: null, to: [] };
          sock.write('250 queued\r\n');
          continue;
        }
        const i = buf.indexOf('\r\n');
        if (i < 0) return;
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (/^EHLO/i.test(line)) sock.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (/^AUTH PLAIN /i.test(line)) {
          const [, u, p] = Buffer.from(line.slice(11), 'base64').toString().split('\u0000');
          sock.write(u === user && p === password ? '235 ok\r\n' : '535 bad credentials\r\n');
        } else if (/^MAIL FROM:<(.*)>/i.test(line)) (env.from = line.match(/<(.*)>/)[1]), sock.write('250 ok\r\n');
        else if (/^RCPT TO:<(.*)>/i.test(line)) env.to.push(line.match(/<(.*)>/)[1]), sock.write('250 ok\r\n');
        else if (/^DATA/i.test(line)) (data = ''), sock.write('354 go ahead\r\n');
        else if (/^QUIT/i.test(line)) sock.write('221 bye\r\n'), sock.end();
        else sock.write('500 unknown\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, sent })));
}

// A raw email, CRLF line endings.
export function rawEmail({ from, to = 'helpdesk@company.com', subject, body, messageId, inReplyTo, headers = [], attachments = [] }) {
  const head = [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, `Message-ID: ${messageId}`, ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []), 'MIME-Version: 1.0', ...headers];
  if (!attachments.length) return [...head, 'Content-Type: text/plain; charset=utf-8', '', body].join('\r\n');
  const b = 'BOUNDARY-42';
  const parts = [`--${b}`, 'Content-Type: text/plain; charset=utf-8', '', body];
  for (const a of attachments) parts.push(`--${b}`, `Content-Type: ${a.type}; name="${a.name}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${a.name}"`, '', a.data.toString('base64'));
  parts.push(`--${b}--`, '');
  return [...head, `Content-Type: multipart/mixed; boundary="${b}"`, '', ...parts].join('\r\n');
}
