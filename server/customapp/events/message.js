// CUSTOM APP → events: the email a guest gets with their table and seat (US-023), rendered from the
// seat as it is when the message is queued (a snapshot: a later move queues a new message, never
// edits this one). Pure: no I/O, no clock. The outbox (outbox.js) sends it, outside commit().
//
// The message is from the event's own address (settings.emailFrom, with settings.replyTo), never
// from the IT Service Desk's mailbox: a guest's reply must not become a helpdesk ticket.
import { fmtManila } from '../../../shared/customapp/time.js';
import { seatsOnYes } from './model.js';

const KIND_SUBJECT = { assignment: 'your table', update: 'your table has changed', resend: 'your table' };
// Where the personal link goes in an invitation's text (filled in when it is sent: CORE keeps no
// copy of the token, so the stored text never holds a working link).
export const LINK_SLOT = '{{personal-link}}';
// The reply email's door line, with the personal QR code in it, or without (see textWithLink).
const QR_LINE = 'Show this QR code at the door to check in (or open your personal link):';
const NO_QR_LINE = 'Show the QR code in your invitation email at the door to check in.';

// The fields of a caOutbox record for this guest's seat now: { guestId, kind, to, subject, body, seat }.
export function seatMessage(ev, g, table, kind = 'assignment') {
  const name = g.name?.title ? `${g.name.title} ${g.name.last}` : g.name?.first || g.name?.display || '';
  const seat = { tableId: g.seat?.tableId || null, number: table?.number ?? null, seatNo: g.seat?.seatNo ?? null };
  const where = `Table ${seat.number ?? '?'}${seat.seatNo ? `, seat ${seat.seatNo}` : ''}`;
  const when = [ev.date ? fmtDate(ev.date) : '', ev.venue || ''].filter(Boolean).join(', ');
  const body = [
    `Dear ${name || 'guest'},`,
    '',
    kind === 'update' ? `Your seat at ${ev.name} has changed. Your new seat is:` : `Welcome to ${ev.name}. Your seat is:`,
    '',
    `    ${where}`,
    '',
    when ? `${when}.` : '',
    'Show this email (or the screen of the guest page) to the usher, who will take you to your table.',
    'If anything is unclear, please ask at the registration desk.',
    '',
    ev.name,
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  return { guestId: g.id, kind, to: g.email || '', subject: `${ev.name}: ${KIND_SUBJECT[kind] || 'your table'} (${where})`, body, seat };
}

const fmtDate = (d) => {
  try {
    return fmtManila(`${d}T04:00:00.000Z`).replace(/,?\s*\d{1,2}:\d{2}\s?[AP]M$/i, '');
  } catch {
    return d;
  }
};

// ----- Invitations (0.74) -----
const nameOf = (g) => (g.name?.title ? `${g.name.title} ${g.name.last}` : g.name?.display || `${g.name?.first || ''} ${g.name?.last || ''}`.trim());
const inviteOf = (ev) => ev.settings?.invitation || {};
// "Wednesday, 9 December 2026"
export function longDate(d) {
  try {
    return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${d}T04:00:00.000Z`));
  } catch {
    return d || '';
  }
}
// The details block of an invitation: when, where, dress code (each line only when set).
export function eventDetails(ev) {
  const inv = inviteOf(ev);
  return [
    ev.date ? `${longDate(ev.date)}${inv.time ? `, ${inv.time}` : ''}` : inv.time || '',
    ev.venue ? `Venue: ${ev.venue}` : '',
    inv.dressCode ? `Dress code: ${inv.dressCode}` : '',
  ].filter(Boolean);
}
// When replies close: the RSVP deadline, or when self check-in opens if that is earlier (or there
// is no deadline). null: no limit.
export function rsvpClosesAt(ev) {
  const d = inviteOf(ev).rsvpDeadline || null;
  const opens = ev.window?.opensAt || null;
  if (d && opens) return d < opens ? d : opens;
  return d || opens;
}

// The invitation, as stored in the outbox: { guestId, kind, to, subject, body, seat }. The body is
// plain text with LINK_SLOT where the personal link goes.
export function invitationMessage(ev, g) {
  const inv = inviteOf(ev);
  const closes = inviteOf(ev).rsvpDeadline;
  const intro = String(inv.intro || '').trim() || `You are invited to ${ev.name}.`;
  const body = [
    `Dear ${nameOf(g) || 'guest'},`,
    '',
    ...intro.split(/\n+/).flatMap((p) => [p, '']),
    ...eventDetails(ev).map((l) => `    ${l}`),
    '',
    closes ? `Please tell us whether you will attend by ${fmtManila(closes)}:` : 'Please tell us whether you will attend:',
    '',
    LINK_SLOT,
    '',
    `This link is yours alone: please do not forward it. When you say yes, ${seatsOnYes(ev) ? 'we reserve your seat at once and email you your table and seat' : 'we email you your table and seat'}.`,
    'On the night, show the QR code in this email at the door (or open the link) to check in.',
    '',
    ev.name,
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  return { guestId: g.id, kind: 'invitation', to: g.email || '', subject: cleanSubject(inv.subject) || `Invitation: ${ev.name}`, body, seat: null };
}

// The reply to a Yes (and a later change of that reserved seat): the table and seat, or that the
// table follows by email. withLink: the personal link (and its QR) is in the email.
export function rsvpMessage(ev, g, table, { update = false, withLink = false } = {}) {
  const seat = g.seat ? { tableId: g.seat.tableId, number: table?.number ?? null, seatNo: g.seat.seatNo ?? null } : null;
  const where = seat ? `Table ${seat.number ?? '?'}${seat.seatNo ? `, seat ${seat.seatNo}` : ''}` : '';
  const body = [
    `Dear ${nameOf(g) || 'guest'},`,
    '',
    update ? `Your seat at ${ev.name} has changed. Your seat is now:` : seat ? `Thank you for confirming that you will attend ${ev.name}. Your seat is:` : `Thank you for confirming that you will attend ${ev.name}. We will email you your table before the event.`,
    '',
    ...(seat ? [`    ${where}`, ''] : []),
    ...eventDetails(ev).map((l) => `    ${l}`),
    '',
    withLink ? QR_LINE : NO_QR_LINE,
    ...(withLink ? ['', LINK_SLOT] : []),
    '',
    'Your personal link also lets you change your answer before replies close.',
    '',
    ev.name,
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  const subject = seat ? `${ev.name}: ${update ? 'your table has changed' : 'your seat is reserved'} (${where})` : `${ev.name}: thank you for your reply`;
  return { guestId: g.id, kind: 'rsvp', to: g.email || '', subject, body, seat, update: Boolean(update) };
}
const cleanSubject = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);

// The text of a message as sent: the personal link in its place (or its line removed).
export function textWithLink(body, link) {
  return link ? body.split(LINK_SLOT).join(link) : withoutLink(body).split('\n').filter((l) => l.trim() !== LINK_SLOT).join('\n').replace(/\n{3,}/g, '\n\n');
}
// A reply email whose link cannot go (the guest's link changed before it was sent): the door line
// points to the invitation instead.
export const withoutLink = (body) => body.split(QR_LINE).join(NO_QR_LINE);

// The HTML version, made from the same text: paragraphs, the indented lines as a details box, the
// personal link as a button and as plain text, and the QR code as an inline picture (cid:).
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function messageHtml(ev, body, { link = '', qrCid = '', button = 'Reply to the invitation' } = {}) {
  const blocks = [];
  let box = [];
  const flush = () => {
    if (box.length) blocks.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;border-left:4px solid #c28618;background:#fbf6ec"><tr><td style="padding:10px 16px;font-size:16px;line-height:1.6;color:#111827">${box.map(escHtml).join('<br>')}</td></tr></table>`);
    box = [];
  };
  for (const raw of body.split('\n')) {
    if (/^ {4}\S/.test(raw)) {
      box.push(raw.trim());
      continue;
    }
    flush();
    const line = raw.trim();
    if (!line) continue;
    if (line === LINK_SLOT) {
      if (!link) continue;
      blocks.push(`<p style="margin:16px 0"><a href="${escHtml(link)}" style="display:inline-block;background:#5d0013;color:#ffffff;text-decoration:none;font-weight:bold;font-size:17px;padding:12px 22px;border-radius:8px">${escHtml(button)}</a></p>`);
      if (qrCid) blocks.push(`<p style="margin:8px 0"><img src="cid:${escHtml(qrCid)}" width="220" height="220" alt="Your personal QR code for ${escHtml(ev.name)}" style="display:block;width:220px;height:220px;border:0"></p>`);
      blocks.push(`<p style="margin:8px 0;font-size:13px;color:#4b5563;word-break:break-all">If the button does not work, copy this address into your browser:<br><a href="${escHtml(link)}" style="color:#5d0013">${escHtml(link)}</a></p>`);
      continue;
    }
    blocks.push(`<p style="margin:0 0 12px;font-size:16px;line-height:1.5;color:#111827">${escHtml(line)}</p>`);
  }
  flush();
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escHtml(ev.name)}</title></head><body style="margin:0;padding:0;background:#f5f6f8"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px"><tr><td style="padding:24px;font-family:Arial,Helvetica,sans-serif"><p style="margin:0 0 16px;font-size:20px;font-weight:bold;color:#5d0013">${escHtml(ev.name)}</p>${blocks.join('')}</td></tr></table></td></tr></table></body></html>`;
}
