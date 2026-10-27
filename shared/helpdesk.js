// IT Service Desk: tickets from the portal, from email and from agents. Shared by the
// server and the browser.

export const TICKET_STATUS = {
  new: 'New',
  open: 'Open',
  pending: 'Waiting on requester',
  on_hold: 'On hold',
  resolved: 'Resolved',
  closed: 'Closed',
};
// Statuses that still need an agent; the SLA clock runs in these.
export const ACTIVE_TICKET = ['new', 'open', 'on_hold'];
export const UNRESOLVED_TICKET = ['new', 'open', 'pending', 'on_hold'];

export const TICKET_PRIORITY = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };

export const TICKET_CHANNEL = { portal: 'Portal', email: 'Email', agent: 'Agent' };

export const DEFAULT_CATEGORIES = [
  'Hardware',
  'Software and applications',
  'Account and access',
  'Network and internet',
  'Email',
  'Printer and peripherals',
  'Other',
];

// Targets in business-agnostic hours: first response and resolution, per priority.
export const DEFAULT_SLA = {
  urgent: { firstResponse: 1, resolution: 8 },
  high: { firstResponse: 4, resolution: 24 },
  normal: { firstResponse: 8, resolution: 72 },
  low: { firstResponse: 24, resolution: 120 },
};

// Ticket reference used in email subjects: [HD-000123].
export const ticketRef = (number) => `HD-${String(number).padStart(6, '0')}`;
export const REF_RE = /\[?\bHD-(\d{1,9})\b\]?/i;

// Due times for a ticket, from its creation time and priority.
export function slaDue(createdAt, priority, sla = DEFAULT_SLA) {
  const t = sla[priority] || DEFAULT_SLA.normal;
  const base = new Date(createdAt).getTime();
  return {
    firstResponseDue: new Date(base + t.firstResponse * 3600000).toISOString(),
    resolutionDue: new Date(base + t.resolution * 3600000).toISOString(),
  };
}

// 'breached' | 'due_soon' (within 25% of the target) | 'ok' | null (target met or not applicable).
export function slaState(ticket, now = Date.now()) {
  if (!UNRESOLVED_TICKET.includes(ticket.status) || ticket.status === 'pending') return null;
  const due = !ticket.firstResponseAt ? ticket.firstResponseDue : ticket.resolutionDue;
  if (!due) return null;
  const left = new Date(due).getTime() - now;
  const span = new Date(due).getTime() - new Date(ticket.createdAt).getTime();
  return left < 0 ? 'breached' : left < span * 0.25 ? 'due_soon' : 'ok';
}
