// CUSTOM APP → events: the email a guest gets with their table and seat (US-023), rendered from the
// seat as it is when the message is queued (a snapshot: a later move queues a new message, never
// edits this one). Pure: no I/O, no clock. The outbox (outbox.js) sends it, outside commit().
//
// The message is from the event's own address (settings.emailFrom, with settings.replyTo), never
// from the IT Service Desk's mailbox: a guest's reply must not become a helpdesk ticket.
import { fmtManila } from '../../../shared/customapp/time.js';

const KIND_SUBJECT = { assignment: 'your table', update: 'your table has changed', resend: 'your table' };

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
