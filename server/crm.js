// Sales & CRM routes. Accounts, contacts, leads, deals (pipeline), bids, contracts and
// activities, each with an owner and a history. Everyone with CRM access sees every record
// (owners and "mine" filters organize the work); deleting records and the sales setup need
// crm.manage. Data lives in db.data.crm* collections; the sales setup in db.data.crm.
import { randomUUID } from 'node:crypto';
import { HttpError, localDate } from './util.js';
import { can, userCan } from '../shared/roles.js';
import {
  ACCOUNT_TYPES, SECTORS, LEAD_STATUS, OPEN_LEAD, BID_STATUS, OPEN_BID, BID_MODES, CONTRACT_STATUS, ACTIVITY_TYPES,
  DEFAULT_CRM, stageList, stageName, isOpenDeal, dealProbability, weightedValue, daysBetween, personName,
} from '../shared/crm.js';

export const CRM_COLLECTIONS = ['crmAccounts', 'crmContacts', 'crmLeads', 'crmDeals', 'crmBids', 'crmContracts', 'crmActivities'];
const RELATED = { account: 'crmAccounts', contact: 'crmContacts', lead: 'crmLeads', deal: 'crmDeals', bid: 'crmBids', contract: 'crmContracts' };

export const emptyCrm = () => ({ ...structuredClone(DEFAULT_CRM), seq: { lead: 0, deal: 0, bid: 0, contract: 0 } });

// The sales setup survives demo data and "erase all data"; the records are company data.
// `customized` marks a setup someone saved; an empty template (demo data, erase) has none, so
// the current setup is kept, with the code counters of the incoming data.
export function keepCrmConfig(current, next) {
  if (next?.customized) return { ...emptyCrm(), ...next };
  return { ...emptyCrm(), ...(current || {}), seq: { ...emptyCrm().seq, ...(next?.seq || {}) } };
}

export function migrateCrm(db) {
  let changed = false;
  for (const k of CRM_COLLECTIONS) if (!Array.isArray(db.data[k])) (db.data[k] = []), (changed = true);
  if (!db.data.crm) (db.data.crm = emptyCrm()), (changed = true);
  else for (const [k, v] of Object.entries(emptyCrm())) if (!(k in db.data.crm)) (db.data.crm[k] = v), (changed = true);
  return changed;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const now = () => new Date().toISOString();
const optDate = (v, label) => {
  if (!v) return null;
  if (!DATE_RE.test(v)) throw new HttpError(400, `${label} must be a date.`);
  return v;
};
const money = (v, label) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[,₱\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${label} must be an amount of zero or more.`);
  return Math.round(n * 100) / 100;
};
const optEmail = (v) => {
  const e = str(v, 160).toLowerCase();
  if (e && !EMAIL_RE.test(e)) throw new HttpError(400, `"${e}" is not a valid email address.`);
  return e || null;
};
const pick = (v, options, fallback) => (Object.hasOwn(options, v) ? v : fallback);
const tags = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(',')).map((t) => str(t, 40)).filter(Boolean))].slice(0, 12);

export function registerCrmRoutes(route, db) {
  const d = () => db.data;
  const crm = () => db.data.crm;
  const user = (id) => d().users.find((u) => u.id === id);
  const team = () => d().users.filter((u) => u.active && userCan(u, 'crm.view'));
  const userName = (id) => user(id)?.name || null;

  function owner(v, fallback) {
    if (!v) return fallback;
    if (!team().some((u) => u.id === v)) throw new HttpError(400, 'The owner must be an account with CRM access.');
    return v;
  }
  function find(kind, id) {
    const rec = d()[RELATED[kind]].find((x) => x.id === id);
    if (!rec) throw new HttpError(404, `${kind[0].toUpperCase() + kind.slice(1)} not found.`);
    return rec;
  }
  const optRef = (kind, id) => (id ? find(kind, id).id : null);
  const nextCode = (kind, prefix) => `${prefix}-${String(++crm().seq[kind]).padStart(4, '0')}`;
  const stamp = (rec, u, isNew) => {
    rec.updatedAt = now();
    if (isNew) Object.assign(rec, { id: randomUUID(), createdAt: rec.updatedAt, createdBy: u.id });
    return rec;
  };
  // Automatic history: shown in the record's timeline with the people's own activities.
  const history = (kind, rec, u, text) =>
    d().crmActivities.push({ id: randomUUID(), type: 'event', subject: text, body: '', related: { type: kind, id: rec.id }, ownerId: u?.id || null, createdBy: u?.id || null, createdAt: now(), done: true });

  // ----- Shapes sent to the browser: records with the names they point to -----
  const accountName = (id) => d().crmAccounts.find((a) => a.id === id)?.name || null;
  const contactName = (id) => personName(d().crmContacts.find((c) => c.id === id)) || null;
  const out = {
    account: (a) => ({ ...a, ownerName: userName(a.ownerId), contacts: d().crmContacts.filter((c) => c.accountId === a.id).length, openDeals: d().crmDeals.filter((x) => x.accountId === a.id && isOpenDeal(x)).length }),
    contact: (c) => ({ ...c, name: personName(c), accountName: accountName(c.accountId), ownerName: userName(c.ownerId) }),
    lead: (l) => ({ ...l, ownerName: userName(l.ownerId) }),
    deal: (x) => ({ ...x, accountName: accountName(x.accountId), contactName: contactName(x.contactId), ownerName: userName(x.ownerId), stageName: stageName(crm(), x.stage), probability: dealProbability(x, crm()), weighted: weightedValue(x, crm()) }),
    bid: (b) => ({ ...b, accountName: accountName(b.accountId), ownerName: userName(b.ownerId), daysLeft: b.status === 'preparing' ? daysBetween(localDate(), b.deadline?.slice(0, 10)) : null, checklistDone: b.checklist.filter((i) => i.done).length }),
    contract: (c) => ({ ...c, accountName: accountName(c.accountId), ownerName: userName(c.ownerId), daysLeft: c.status === 'active' ? daysBetween(localDate(), c.endDate) : null }),
    activity: (a) => ({ ...a, ownerName: userName(a.ownerId), createdByName: userName(a.createdBy), relatedName: relatedName(a.related) }),
  };
  function relatedName(rel) {
    if (!rel) return null;
    const rec = d()[RELATED[rel.type]]?.find((x) => x.id === rel.id);
    if (!rec) return null;
    return rel.type === 'contact' ? personName(rec) : rel.type === 'lead' ? rec.name : rec.title || rec.name;
  }

  // ===== Meta: the sales setup and the team =====
  route('GET', '/api/crm/meta', 'crm.view', () => ({
    setup: { stages: crm().stages, sources: crm().sources, lostReasons: crm().lostReasons, industries: crm().industries, bidChecklist: crm().bidChecklist, renewalNoticeDays: crm().renewalNoticeDays },
    team: team().map((u) => ({ id: u.id, name: u.name })),
  }));

  // ===== Overview =====
  route('GET', '/api/crm/overview', 'crm.view', ({ user: u }) => {
    const today = localDate();
    const deals = d().crmDeals;
    const open = deals.filter(isOpenDeal);
    const since = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const monthStart = today.slice(0, 8) + '01';
    const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1;
    const quarterStart = `${today.slice(0, 4)}-${String(q).padStart(2, '0')}-01`;
    const won = (from) => deals.filter((x) => x.stage === 'won' && (x.closedAt || '').slice(0, 10) >= from);
    const closed90 = deals.filter((x) => !isOpenDeal(x) && (x.closedAt || '').slice(0, 10) >= since(90));
    const sum = (list, f = (x) => Number(x.value) || 0) => list.reduce((s, x) => s + f(x), 0);
    const months = [0, 1, 2].map((i) => {
      const dt = new Date(`${monthStart}T00:00:00Z`);
      dt.setUTCMonth(dt.getUTCMonth() + i);
      return dt.toISOString().slice(0, 7);
    });
    const tasks = d().crmActivities.filter((a) => a.type !== 'event' && !a.done && a.dueDate && a.ownerId === u.id);
    return {
      openValue: sum(open),
      weightedValue: sum(open, (x) => weightedValue(x, crm())),
      openCount: open.length,
      wonMonth: { count: won(monthStart).length, value: sum(won(monthStart)) },
      wonQuarter: { count: won(quarterStart).length, value: sum(won(quarterStart)) },
      winRate: closed90.length ? Math.round((closed90.filter((x) => x.stage === 'won').length / closed90.length) * 100) : null,
      closed90: closed90.length,
      byStage: crm().stages.map((s) => {
        const list = open.filter((x) => x.stage === s.id);
        return { id: s.id, name: s.name, probability: s.probability, count: list.length, value: sum(list) };
      }),
      forecast: months.map((m) => ({ month: m, value: sum(open.filter((x) => (x.expectedClose || '').startsWith(m)), (x) => weightedValue(x, crm())) })),
      overdueClose: open.filter((x) => x.expectedClose && x.expectedClose < today).length,
      newLeads: d().crmLeads.filter((l) => l.status === 'new').length,
      openLeads: d().crmLeads.filter((l) => OPEN_LEAD.includes(l.status)).length,
      bids: d().crmBids.filter((b) => b.status === 'preparing').map(out.bid).sort((a, b) => (a.deadline || '').localeCompare(b.deadline || '')).slice(0, 6),
      contracts: d().crmContracts.filter((c) => c.status === 'active' && c.endDate && daysBetween(today, c.endDate) <= crm().renewalNoticeDays).map(out.contract).sort((a, b) => a.endDate.localeCompare(b.endDate)).slice(0, 6),
      myTasks: tasks.filter((a) => a.dueDate <= today).map(out.activity).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 8),
      myUpcoming: tasks.filter((a) => a.dueDate > today).length,
      closingSoon: open.filter((x) => x.expectedClose && x.expectedClose >= today && daysBetween(today, x.expectedClose) <= 30).map(out.deal).sort((a, b) => a.expectedClose.localeCompare(b.expectedClose)).slice(0, 6),
    };
  });

  // ===== Search across the CRM =====
  route('GET', '/api/crm/search', 'crm.view', ({ query }) => {
    const q = str(query.q, 80).toLowerCase();
    if (q.length < 2) return [];
    const hit = (...fields) => fields.some((f) => String(f || '').toLowerCase().includes(q));
    return [
      ...d().crmAccounts.filter((a) => hit(a.name, a.tin, a.email, a.website)).map((a) => ({ type: 'account', id: a.id, title: a.name, sub: ACCOUNT_TYPES[a.type] })),
      ...d().crmContacts.filter((c) => hit(personName(c), c.email, c.phone, c.mobile)).map((c) => ({ type: 'contact', id: c.id, title: personName(c), sub: [c.title, accountName(c.accountId)].filter(Boolean).join(' · ') })),
      ...d().crmLeads.filter((l) => hit(l.name, l.company, l.email, l.code)).map((l) => ({ type: 'lead', id: l.id, title: l.name, sub: [l.code, l.company].filter(Boolean).join(' · ') })),
      ...d().crmDeals.filter((x) => hit(x.title, x.code, accountName(x.accountId))).map((x) => ({ type: 'deal', id: x.id, title: x.title, sub: [x.code, accountName(x.accountId)].filter(Boolean).join(' · ') })),
      ...d().crmBids.filter((b) => hit(b.title, b.code, b.reference, accountName(b.accountId))).map((b) => ({ type: 'bid', id: b.id, title: b.title, sub: [b.code, b.reference].filter(Boolean).join(' · ') })),
      ...d().crmContracts.filter((c) => hit(c.title, c.code, c.number, accountName(c.accountId))).map((c) => ({ type: 'contract', id: c.id, title: c.title, sub: [c.code, accountName(c.accountId)].filter(Boolean).join(' · ') })),
    ].slice(0, 25);
  });

  // ===== Accounts =====
  function validAccount(b, u, rec = {}) {
    const name = str(b.name, 160);
    if (!name) throw new HttpError(400, 'Enter the organization name.');
    if (d().crmAccounts.some((a) => a.id !== rec.id && a.name.toLowerCase() === name.toLowerCase())) throw new HttpError(400, `An account named "${name}" already exists.`);
    return {
      name, type: pick(b.type, ACCOUNT_TYPES, 'prospect'), sector: pick(b.sector, SECTORS, 'private'), industry: str(b.industry, 80),
      tin: str(b.tin, 30), website: str(b.website, 200), email: optEmail(b.email), phone: str(b.phone, 40),
      address: str(b.address, 300), tags: tags(b.tags), notes: str(b.notes, 4000), ownerId: owner(b.ownerId, rec.ownerId || u.id),
    };
  }
  route('GET', '/api/crm/accounts', 'crm.view', () => d().crmAccounts.map(out.account).sort((a, b) => a.name.localeCompare(b.name)));
  route('POST', '/api/crm/accounts', 'crm.edit', ({ body, user: u }) => {
    const a = stamp(validAccount(body, u), u, true);
    d().crmAccounts.push(a);
    history('account', a, u, 'Account created');
    db.save();
    return out.account(a);
  });
  route('GET', '/api/crm/accounts/:id', 'crm.view', ({ params }) => {
    const a = find('account', params.id);
    return {
      ...out.account(a),
      contactList: d().crmContacts.filter((c) => c.accountId === a.id).map(out.contact),
      deals: d().crmDeals.filter((x) => x.accountId === a.id).map(out.deal),
      bids: d().crmBids.filter((x) => x.accountId === a.id).map(out.bid),
      contracts: d().crmContracts.filter((x) => x.accountId === a.id).map(out.contract),
      wonValue: d().crmDeals.filter((x) => x.accountId === a.id && x.stage === 'won').reduce((s, x) => s + (Number(x.value) || 0), 0),
    };
  });
  route('PUT', '/api/crm/accounts/:id', 'crm.edit', ({ params, body, user: u }) => {
    const a = find('account', params.id);
    Object.assign(a, validAccount(body, u, a));
    stamp(a, u);
    db.save();
    return out.account(a);
  });
  route('DELETE', '/api/crm/accounts/:id', 'crm.manage', ({ params }) => {
    const a = find('account', params.id);
    const used = ['crmDeals', 'crmBids', 'crmContracts'].reduce((n, k) => n + d()[k].filter((x) => x.accountId === a.id).length, 0);
    if (used) throw new HttpError(400, `This account has ${used} deal${used === 1 ? '' : 's'}, bid${used === 1 ? '' : 's'} or contract${used === 1 ? '' : 's'}. Delete or move those first.`);
    for (const c of d().crmContacts) if (c.accountId === a.id) c.accountId = null;
    removeWithActivities('account', a.id);
    db.save();
    return { ok: true };
  });

  // ===== Contacts =====
  function validContact(b, u, rec = {}) {
    const firstName = str(b.firstName, 80);
    const lastName = str(b.lastName, 80);
    if (!firstName && !lastName) throw new HttpError(400, "Enter the contact's name.");
    return {
      firstName, lastName, title: str(b.title, 120), accountId: optRef('account', b.accountId), email: optEmail(b.email),
      phone: str(b.phone, 40), mobile: str(b.mobile, 40), notes: str(b.notes, 4000), tags: tags(b.tags), ownerId: owner(b.ownerId, rec.ownerId || u.id),
    };
  }
  route('GET', '/api/crm/contacts', 'crm.view', () => d().crmContacts.map(out.contact).sort((a, b) => a.name.localeCompare(b.name)));
  route('POST', '/api/crm/contacts', 'crm.edit', ({ body, user: u }) => {
    const c = stamp(validContact(body, u), u, true);
    d().crmContacts.push(c);
    history('contact', c, u, 'Contact created');
    db.save();
    return out.contact(c);
  });
  route('GET', '/api/crm/contacts/:id', 'crm.view', ({ params }) => {
    const c = find('contact', params.id);
    return { ...out.contact(c), deals: d().crmDeals.filter((x) => x.contactId === c.id).map(out.deal) };
  });
  route('PUT', '/api/crm/contacts/:id', 'crm.edit', ({ params, body, user: u }) => {
    const c = find('contact', params.id);
    Object.assign(c, validContact(body, u, c));
    stamp(c, u);
    db.save();
    return out.contact(c);
  });
  route('DELETE', '/api/crm/contacts/:id', 'crm.manage', ({ params }) => {
    const c = find('contact', params.id);
    for (const x of d().crmDeals) if (x.contactId === c.id) x.contactId = null;
    removeWithActivities('contact', c.id);
    db.save();
    return { ok: true };
  });

  // ===== Leads =====
  function validLead(b, u, rec = {}) {
    const name = str(b.name, 120);
    if (!name) throw new HttpError(400, "Enter the lead's name.");
    const status = pick(b.status, LEAD_STATUS, rec.status || 'new');
    if (status === 'converted' && rec.status !== 'converted') throw new HttpError(400, 'Use Convert to turn a lead into an account and a deal.');
    return {
      name, company: str(b.company, 160), title: str(b.title, 120), email: optEmail(b.email), phone: str(b.phone, 40),
      source: str(b.source, 60) || rec.source || 'Other', status, estimatedValue: money(b.estimatedValue, 'Estimated value'),
      interest: str(b.interest, 2000), disqualifiedReason: status === 'disqualified' ? str(b.disqualifiedReason, 200) : '',
      ownerId: owner(b.ownerId, rec.ownerId || u.id),
    };
  }
  route('GET', '/api/crm/leads', 'crm.view', () => d().crmLeads.map(out.lead).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  route('POST', '/api/crm/leads', 'crm.edit', ({ body, user: u }) => {
    const fields = validLead(body, u);
    const l = stamp({ code: nextCode('lead', 'LD'), ...fields }, u, true);
    d().crmLeads.push(l);
    history('lead', l, u, `Lead created (source: ${l.source})`);
    db.save();
    return out.lead(l);
  });
  route('GET', '/api/crm/leads/:id', 'crm.view', ({ params }) => out.lead(find('lead', params.id)));
  route('PUT', '/api/crm/leads/:id', 'crm.edit', ({ params, body, user: u }) => {
    const l = find('lead', params.id);
    if (l.status === 'converted') throw new HttpError(400, 'This lead was converted. Edit its account, contact or deal instead.');
    const before = l.status;
    Object.assign(l, validLead(body, u, l));
    stamp(l, u);
    if (before !== l.status) history('lead', l, u, `Status: ${LEAD_STATUS[before]} → ${LEAD_STATUS[l.status]}${l.disqualifiedReason ? ` (${l.disqualifiedReason})` : ''}`);
    db.save();
    return out.lead(l);
  });
  route('DELETE', '/api/crm/leads/:id', 'crm.manage', ({ params }) => {
    find('lead', params.id);
    removeWithActivities('lead', params.id);
    db.save();
    return { ok: true };
  });
  // Convert: the lead becomes an account (new or existing), a contact and, optionally, a deal.
  route('POST', '/api/crm/leads/:id/convert', 'crm.edit', ({ params, body, user: u }) => {
    const l = find('lead', params.id);
    if (l.status === 'converted') throw new HttpError(400, 'This lead is already converted.');
    let account = body.accountId ? find('account', body.accountId) : null;
    if (!account) {
      const name = str(body.accountName || l.company || l.name, 160);
      account = d().crmAccounts.find((a) => a.name.toLowerCase() === name.toLowerCase());
      if (!account) {
        account = stamp(validAccount({ name, type: 'prospect', email: null, ownerId: l.ownerId }, u), u, true);
        d().crmAccounts.push(account);
        history('account', account, u, `Account created from lead ${l.code}`);
      }
    }
    const [firstName, ...rest] = l.name.split(/\s+/);
    const contact = stamp(validContact({ firstName, lastName: rest.join(' '), title: l.title, email: l.email, phone: l.phone, accountId: account.id, ownerId: l.ownerId }, u), u, true);
    d().crmContacts.push(contact);
    history('contact', contact, u, `Contact created from lead ${l.code}`);
    let deal = null;
    if (body.createDeal !== false) {
      const fields = validDeal({ title: str(body.dealTitle, 160) || `${account.name}: ${l.interest ? l.interest.slice(0, 60) : 'new opportunity'}`, accountId: account.id, contactId: contact.id, value: body.dealValue ?? l.estimatedValue, stage: crm().stages[0]?.id, source: l.source, expectedClose: body.expectedClose, ownerId: l.ownerId }, u);
      deal = stamp({ code: nextCode('deal', 'DL'), ...fields }, u, true);
      deal.leadId = l.id;
      d().crmDeals.push(deal);
      history('deal', deal, u, `Deal created from lead ${l.code}`);
    }
    Object.assign(l, { status: 'converted', convertedAt: now(), accountId: account.id, contactId: contact.id, dealId: deal?.id || null });
    stamp(l, u);
    history('lead', l, u, `Converted to ${account.name}${deal ? ` and deal ${deal.code}` : ''}`);
    // The lead's own notes and tasks follow it to the new contact.
    for (const a of d().crmActivities) if (a.related?.type === 'lead' && a.related.id === l.id && a.type !== 'event') a.related = { type: deal ? 'deal' : 'contact', id: deal ? deal.id : contact.id };
    db.save();
    return { lead: out.lead(l), account: out.account(account), contact: out.contact(contact), deal: deal && out.deal(deal) };
  });
  // A service desk ticket (e.g. from the public form) that is really a sales enquiry.
  route('POST', '/api/crm/leads/from-ticket/:ticketId', 'crm.edit', ({ params, user: u }) => {
    const t = d().tickets.find((x) => x.id === params.ticketId);
    if (!t) throw new HttpError(404, 'Ticket not found.');
    const existing = d().crmLeads.find((l) => l.ticketId === t.id);
    if (existing) return out.lead(existing);
    const first = t.messages.find((m) => m.kind !== 'event');
    const fields = validLead({ name: t.requester?.name || t.requester?.email || 'Unknown', company: t.requester?.organization || '', email: t.requester?.email, phone: t.requester?.phone || '', source: t.channel === 'web' ? 'Public form' : 'Service desk', interest: `${t.subject}\n\n${first?.body || ''}`.trim() }, u);
    const l = stamp({ code: nextCode('lead', 'LD'), ...fields }, u, true);
    l.ticketId = t.id;
    d().crmLeads.push(l);
    history('lead', l, u, `Lead created from service desk ticket ${t.number}`);
    t.messages.push({ id: randomUUID(), kind: 'event', public: false, author: { userId: u.id, name: u.name, role: 'agent' }, body: `Sent to Sales & CRM as lead ${l.code}`, at: now(), attachments: [] });
    db.save();
    return out.lead(l);
  });

  // ===== Deals =====
  function validDeal(b, u, rec = {}) {
    const title = str(b.title, 160);
    if (!title) throw new HttpError(400, 'Enter a name for the deal.');
    const stage = b.stage ?? rec.stage ?? crm().stages[0]?.id;
    if (!stageList(crm()).some((s) => s.id === stage)) throw new HttpError(400, 'Pick a valid stage.');
    const accountId = optRef('account', b.accountId);
    if (!accountId) throw new HttpError(400, 'Pick the account (organization) for this deal.');
    const contactId = optRef('contact', b.contactId);
    return {
      title, accountId, contactId, stage, value: money(b.value, 'Value') ?? 0, expectedClose: optDate(b.expectedClose, 'Expected close date'),
      source: str(b.source, 60) || rec.source || '', description: str(b.description, 4000), nextStep: str(b.nextStep, 200), ownerId: owner(b.ownerId, rec.ownerId || u.id),
      lostReason: stage === 'lost' ? str(b.lostReason, 120) || rec.lostReason || '' : '',
    };
  }
  function moveStage(x, stage, u, lostReason) {
    if (x.stage === stage) return;
    const from = x.stage;
    x.stage = stage;
    if (stage === 'won' || stage === 'lost') x.closedAt = now();
    else delete x.closedAt;
    x.lostReason = stage === 'lost' ? lostReason || x.lostReason || '' : '';
    history('deal', x, u, stage === 'won' ? `Won · ${stageName(crm(), from)} → Won` : stage === 'lost' ? `Lost${x.lostReason ? ` (${x.lostReason})` : ''} · from ${stageName(crm(), from)}` : `Stage: ${stageName(crm(), from)} → ${stageName(crm(), stage)}`);
    // Winning a prospect's deal makes it a client.
    const account = d().crmAccounts.find((a) => a.id === x.accountId);
    if (stage === 'won' && account?.type === 'prospect') {
      account.type = 'client';
      history('account', account, u, `Now a client (won ${x.code})`);
    }
  }
  route('GET', '/api/crm/deals', 'crm.view', () => d().crmDeals.map(out.deal).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  route('POST', '/api/crm/deals', 'crm.edit', ({ body, user: u }) => {
    const fields = validDeal(body, u);
    const x = stamp({ code: nextCode('deal', 'DL'), ...fields }, u, true);
    if (x.stage === 'won' || x.stage === 'lost') x.closedAt = now();
    d().crmDeals.push(x);
    history('deal', x, u, `Deal created in ${stageName(crm(), x.stage)}`);
    db.save();
    return out.deal(x);
  });
  route('GET', '/api/crm/deals/:id', 'crm.view', ({ params }) => {
    const x = find('deal', params.id);
    return { ...out.deal(x), bids: d().crmBids.filter((b) => b.dealId === x.id).map(out.bid), contracts: d().crmContracts.filter((c) => c.dealId === x.id).map(out.contract) };
  });
  route('PUT', '/api/crm/deals/:id', 'crm.edit', ({ params, body, user: u }) => {
    const x = find('deal', params.id);
    const next = validDeal(body, u, x);
    const stage = next.stage;
    Object.assign(x, { ...next, stage: x.stage });
    moveStage(x, stage, u, next.lostReason);
    stamp(x, u);
    db.save();
    return out.deal(x);
  });
  // Drag on the pipeline board, or the stage bar on a deal.
  route('PUT', '/api/crm/deals/:id/stage', 'crm.edit', ({ params, body, user: u }) => {
    const x = find('deal', params.id);
    if (!stageList(crm()).some((s) => s.id === body.stage)) throw new HttpError(400, 'Pick a valid stage.');
    if (body.stage === 'lost' && !str(body.lostReason)) throw new HttpError(400, 'Say why the deal was lost.');
    moveStage(x, body.stage, u, str(body.lostReason, 120));
    stamp(x, u);
    db.save();
    return out.deal(x);
  });
  route('DELETE', '/api/crm/deals/:id', 'crm.manage', ({ params }) => {
    const x = find('deal', params.id);
    for (const k of ['crmBids', 'crmContracts']) for (const r of d()[k]) if (r.dealId === x.id) r.dealId = null;
    removeWithActivities('deal', x.id);
    db.save();
    return { ok: true };
  });

  // ===== Bids (tenders and RFPs) =====
  function validBid(b, u, rec = {}) {
    const title = str(b.title, 200);
    if (!title) throw new HttpError(400, 'Enter the project or tender title.');
    const accountId = optRef('account', b.accountId);
    if (!accountId) throw new HttpError(400, 'Pick the procuring entity or client.');
    const deadline = str(b.deadline, 16);
    if (deadline && !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(deadline)) throw new HttpError(400, 'Submission deadline must be a date and time.');
    return {
      title, accountId, dealId: optRef('deal', b.dealId), reference: str(b.reference, 80), mode: pick(b.mode, BID_MODES, 'public'),
      status: pick(b.status, BID_STATUS, rec.status || 'preparing'), budget: money(b.budget, 'Approved budget (ABC)'), bidAmount: money(b.bidAmount, 'Bid amount'),
      deadline: deadline || null, openingDate: optDate(b.openingDate, 'Bid opening date'), preBidDate: optDate(b.preBidDate, 'Pre-bid conference date'),
      notes: str(b.notes, 4000), ownerId: owner(b.ownerId, rec.ownerId || u.id),
    };
  }
  route('GET', '/api/crm/bids', 'crm.view', () => d().crmBids.map(out.bid).sort((a, b) => (b.deadline || '').localeCompare(a.deadline || '')));
  route('POST', '/api/crm/bids', 'crm.edit', ({ body, user: u }) => {
    const fields = validBid(body, u);
    if (fields.mode === 'public' && fields.bidAmount && fields.budget && fields.bidAmount > fields.budget) throw new HttpError(400, 'The bid amount is above the approved budget (ABC); public bids above the ABC are rejected.');
    const b = stamp({ code: nextCode('bid', 'BID'), ...fields, checklist: crm().bidChecklist.map((label) => ({ id: randomUUID(), label, done: false })) }, u, true);
    d().crmBids.push(b);
    history('bid', b, u, 'Bid created');
    db.save();
    return out.bid(b);
  });
  route('GET', '/api/crm/bids/:id', 'crm.view', ({ params }) => out.bid(find('bid', params.id)));
  route('PUT', '/api/crm/bids/:id', 'crm.edit', ({ params, body, user: u }) => {
    const b = find('bid', params.id);
    const before = b.status;
    const next = validBid(body, u, b);
    if (next.mode === 'public' && next.bidAmount && next.budget && next.bidAmount > next.budget) throw new HttpError(400, 'The bid amount is above the approved budget (ABC); public bids above the ABC are rejected.');
    if (next.status === 'submitted' && before === 'preparing') {
      const missing = b.checklist.filter((i) => !i.done).length;
      if (missing && !body.submitAnyway) throw new HttpError(409, `${missing} document${missing === 1 ? ' is' : 's are'} not ticked on the checklist.`);
    }
    Object.assign(b, next);
    stamp(b, u);
    if (before !== b.status) {
      if (b.status === 'submitted') b.submittedAt = now();
      history('bid', b, u, `Status: ${BID_STATUS[before]} → ${BID_STATUS[b.status]}`);
      // An award closes the linked deal as won; a loss closes it as lost.
      const deal = d().crmDeals.find((x) => x.id === b.dealId);
      if (deal && isOpenDeal(deal) && (b.status === 'awarded' || b.status === 'lost')) moveStage(deal, b.status === 'awarded' ? 'won' : 'lost', u, b.status === 'lost' ? 'Bid not awarded' : '');
    }
    db.save();
    return out.bid(b);
  });
  route('PUT', '/api/crm/bids/:id/checklist', 'crm.edit', ({ params, body, user: u }) => {
    const b = find('bid', params.id);
    if (body.add) {
      const label = str(body.add, 200);
      if (!label) throw new HttpError(400, 'Name the document.');
      b.checklist.push({ id: randomUUID(), label, done: false });
    } else if (body.remove) {
      b.checklist = b.checklist.filter((i) => i.id !== body.remove);
    } else {
      const item = b.checklist.find((i) => i.id === body.itemId);
      if (!item) throw new HttpError(404, 'Checklist item not found.');
      item.done = Boolean(body.done);
      item.doneBy = item.done ? u.name : null;
      item.doneAt = item.done ? now() : null;
    }
    stamp(b, u);
    db.save();
    return out.bid(b);
  });
  route('DELETE', '/api/crm/bids/:id', 'crm.manage', ({ params }) => {
    const b = find('bid', params.id);
    for (const c of d().crmContracts) if (c.bidId === b.id) c.bidId = null;
    removeWithActivities('bid', b.id);
    db.save();
    return { ok: true };
  });

  // ===== Contracts =====
  function validContract(b, u, rec = {}) {
    const title = str(b.title, 200);
    if (!title) throw new HttpError(400, 'Enter the contract title.');
    const accountId = optRef('account', b.accountId);
    if (!accountId) throw new HttpError(400, 'Pick the client.');
    const startDate = optDate(b.startDate, 'Start date');
    const endDate = optDate(b.endDate, 'End date');
    if (startDate && endDate && endDate < startDate) throw new HttpError(400, 'The end date is before the start date.');
    return {
      title, accountId, dealId: optRef('deal', b.dealId), bidId: optRef('bid', b.bidId), number: str(b.number, 80), value: money(b.value, 'Contract value') ?? 0,
      startDate, endDate, status: pick(b.status, CONTRACT_STATUS, rec.status || 'active'), autoRenew: Boolean(b.autoRenew),
      billing: str(b.billing, 120), terms: str(b.terms, 4000), ownerId: owner(b.ownerId, rec.ownerId || u.id),
    };
  }
  route('GET', '/api/crm/contracts', 'crm.view', () => d().crmContracts.map(out.contract).sort((a, b) => (a.endDate || '9').localeCompare(b.endDate || '9')));
  route('POST', '/api/crm/contracts', 'crm.edit', ({ body, user: u }) => {
    const fields = validContract(body, u);
    const c = stamp({ code: nextCode('contract', 'CT'), ...fields }, u, true);
    d().crmContracts.push(c);
    history('contract', c, u, 'Contract recorded');
    db.save();
    return out.contract(c);
  });
  route('GET', '/api/crm/contracts/:id', 'crm.view', ({ params }) => out.contract(find('contract', params.id)));
  route('PUT', '/api/crm/contracts/:id', 'crm.edit', ({ params, body, user: u }) => {
    const c = find('contract', params.id);
    const before = c.status;
    Object.assign(c, validContract(body, u, c));
    stamp(c, u);
    if (before !== c.status) history('contract', c, u, `Status: ${CONTRACT_STATUS[before]} → ${CONTRACT_STATUS[c.status]}`);
    db.save();
    return out.contract(c);
  });
  route('DELETE', '/api/crm/contracts/:id', 'crm.manage', ({ params }) => {
    find('contract', params.id);
    removeWithActivities('contract', params.id);
    db.save();
    return { ok: true };
  });

  // ===== Activities: calls, meetings, emails, tasks, notes and automatic history =====
  function relatedTo(rel) {
    if (!rel || !RELATED[rel.type]) throw new HttpError(400, 'Say which record this is about.');
    return { type: rel.type, id: find(rel.type, rel.id).id };
  }
  // Everything about a record; for an account also its contacts', deals', bids' and contracts'.
  function timelineFor(type, id) {
    const keys = new Set([`${type}:${id}`]);
    if (type === 'account') {
      for (const [k, kind] of [['crmContacts', 'contact'], ['crmDeals', 'deal'], ['crmBids', 'bid'], ['crmContracts', 'contract']]) for (const r of d()[k]) if (r.accountId === id) keys.add(`${kind}:${r.id}`);
    }
    if (type === 'contact') for (const r of d().crmDeals) if (r.contactId === id) keys.add(`deal:${r.id}`);
    return d().crmActivities.filter((a) => keys.has(`${a.related?.type}:${a.related?.id}`));
  }
  route('GET', '/api/crm/activities', 'crm.view', ({ query, user: u }) => {
    let list = query.type && query.id ? timelineFor(query.type, query.id) : d().crmActivities.filter((a) => a.type !== 'event');
    if (query.mine) list = list.filter((a) => a.ownerId === u.id);
    if (query.open) list = list.filter((a) => !a.done && a.type !== 'event');
    return list.map(out.activity).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  });
  function validActivity(b, u, rec = {}) {
    const type = pick(b.type, ACTIVITY_TYPES, rec.type || 'note');
    const subject = str(b.subject, 200);
    const body = str(b.body, 8000);
    if (!subject && !body) throw new HttpError(400, 'Write what happened or what needs doing.');
    const dueDate = optDate(b.dueDate, 'Due date');
    if (type === 'task' && !dueDate) throw new HttpError(400, 'Give the task a due date.');
    return {
      type, subject: subject || body.split('\n')[0].slice(0, 120), body, dueDate, dueTime: /^\d{2}:\d{2}$/.test(b.dueTime || '') ? b.dueTime : null,
      outcome: str(b.outcome, 200), related: rec.related || relatedTo(b.related), ownerId: owner(b.ownerId, rec.ownerId || u.id),
      // Notes and logged calls/meetings/emails are done when written; tasks and anything scheduled wait.
      done: typeof b.done === 'boolean' ? b.done : rec.done ?? (type === 'note' || !dueDate),
    };
  }
  route('POST', '/api/crm/activities', 'crm.edit', ({ body, user: u }) => {
    const a = { id: randomUUID(), ...validActivity(body, u), createdBy: u.id, createdAt: now() };
    if (a.done) a.doneAt = a.createdAt;
    d().crmActivities.push(a);
    db.save();
    return out.activity(a);
  });
  route('PUT', '/api/crm/activities/:id', 'crm.edit', ({ params, body, user: u }) => {
    const a = d().crmActivities.find((x) => x.id === params.id);
    if (!a || a.type === 'event') throw new HttpError(404, 'Activity not found.');
    const wasDone = a.done;
    Object.assign(a, Object.keys(body).length === 1 && 'done' in body ? { done: Boolean(body.done) } : validActivity({ ...a, ...body }, u, a));
    if (a.done && !wasDone) a.doneAt = now();
    if (!a.done) a.doneAt = null;
    a.updatedAt = now();
    db.save();
    return out.activity(a);
  });
  route('DELETE', '/api/crm/activities/:id', 'crm.edit', ({ params, user: u }) => {
    const a = d().crmActivities.find((x) => x.id === params.id);
    if (!a || a.type === 'event') throw new HttpError(404, 'Activity not found.');
    if (a.createdBy !== u.id && !userCan(u, 'crm.manage')) throw new HttpError(403, 'Only the person who wrote it or a CRM manager can delete it.');
    d().crmActivities = d().crmActivities.filter((x) => x.id !== a.id);
    db.save();
    return { ok: true };
  });

  function removeWithActivities(kind, id) {
    d()[RELATED[kind]] = d()[RELATED[kind]].filter((x) => x.id !== id);
    d().crmActivities = d().crmActivities.filter((a) => !(a.related?.type === kind && a.related.id === id));
  }

  // ===== Sales setup (CRM managers) =====
  route('PUT', '/api/crm/settings', 'crm.manage', ({ body }) => {
    const list = (v, label, max = 30) => {
      const items = [...new Set((Array.isArray(v) ? v : []).map((x) => str(x, 120)).filter(Boolean))].slice(0, max);
      if (!items.length) throw new HttpError(400, `Keep at least one ${label}.`);
      return items;
    };
    const stages = (Array.isArray(body.stages) ? body.stages : []).map((s, i) => ({
      id: /^[a-z0-9-]{2,24}$/.test(s.id || '') && !['won', 'lost'].includes(s.id) ? s.id : `stage-${Date.now().toString(36)}-${i}`,
      name: str(s.name, 40),
      probability: Math.max(0, Math.min(99, Math.round(Number(s.probability) || 0))),
    })).filter((s) => s.name);
    if (stages.length < 2 || stages.length > 10) throw new HttpError(400, 'The pipeline needs 2 to 10 open stages.');
    if (new Set(stages.map((s) => s.id)).size !== stages.length) throw new HttpError(400, 'Two stages have the same id.');
    const removed = crm().stages.filter((s) => !stages.some((x) => x.id === s.id));
    for (const s of removed) {
      const n = d().crmDeals.filter((x) => x.stage === s.id).length;
      if (n) throw new HttpError(400, `${n} deal${n === 1 ? ' is' : 's are'} in "${s.name}". Move ${n === 1 ? 'it' : 'them'} to another stage before removing it.`);
    }
    const days = Math.round(Number(body.renewalNoticeDays));
    if (!(days >= 7 && days <= 365)) throw new HttpError(400, 'Renewal notice must be 7 to 365 days.');
    Object.assign(crm(), {
      customized: true,
      stages, sources: list(body.sources, 'lead source'), lostReasons: list(body.lostReasons, 'lost reason'),
      industries: list(body.industries, 'industry', 40), bidChecklist: list(body.bidChecklist, 'checklist document', 40), renewalNoticeDays: days,
    });
    db.save();
    return { ok: true };
  });

  // ===== CRM access per account (administrators), like helpdesk agent access =====
  const access = () => d().users.filter((u) => u.active).map((u) => ({
    id: u.id, name: u.name, username: u.username, role: u.role, byRole: can(u.role, 'crm.view'),
    override: typeof u.crmAccess === 'boolean' ? u.crmAccess : null, hasAccess: userCan(u, 'crm.view'),
  }));
  route('GET', '/api/crm/access', 'users.manage', access);
  route('PUT', '/api/crm/access/:userId', 'users.manage', ({ params, body }) => {
    const u = d().users.find((x) => x.id === params.userId && x.active);
    if (!u) throw new HttpError(404, 'User not found.');
    if (u.role === 'admin') throw new HttpError(400, 'Administrators always have CRM access.');
    if (body.access === true || body.access === false) {
      if (body.access === can(u.role, 'crm.view')) delete u.crmAccess;
      else u.crmAccess = body.access;
    } else if (body.access === null) delete u.crmAccess;
    else throw new HttpError(400, 'Choose whether this account can use the CRM.');
    db.save();
    return access();
  });
}
