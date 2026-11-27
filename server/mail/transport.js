// CORE's one outgoing mail transport: the SMTP server set up under IT Service Desk → Settings →
// Outgoing email. The helpdesk (replies, acknowledgements, the Projects digest through it) and
// CUSTOM APP's event outbox (server/customapp/events/outbox.js) use this same object, so there is
// one place that knows the host, the port, the security and the sealed login.
//
// It is only the connection: each sender chooses its own From. The helpdesk sends from its mailbox
// address; an event sends from its own address (never the helpdesk mailbox, so guests' replies do
// not become tickets).
//   canSend()        outgoing email is turned on and has a host
//   options()        what server/mail/smtp.js sendMail() takes: { host, port, secure, starttls, user, password, tlsOptions }
//   mailboxAddress() the helpdesk's own address (which other senders must not use as From)
export function mailTransport(db, { secrets, tls = () => undefined } = {}) {
  const hd = () => db.data.helpdesk || {};
  const open = (sealed) => (sealed && secrets ? secrets.open(sealed) : '');
  const login = () => {
    const o = hd().outgoing || {};
    if (o.sameLogin) return { user: hd().mailbox?.user || '', password: open(hd().mailbox?.passwordSealed) };
    return { user: o.user || '', password: open(o.passwordSealed) };
  };
  return {
    canSend: () => Boolean(hd().outgoing?.enabled && hd().outgoing?.host),
    options() {
      const o = hd().outgoing || {};
      return { host: o.host, port: o.port, secure: o.security === 'tls', starttls: o.security === 'starttls', ...login(), tlsOptions: tls() };
    },
    mailboxAddress: () => String(hd().mailbox?.address || '').toLowerCase(),
  };
}
