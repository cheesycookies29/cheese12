// Sales & CRM: record types, statuses and the default sales setup. Shared by the server
// (validation) and the browser (labels, badges, forecasts).
//
// Records: accounts (organizations), contacts (people at them), leads (unqualified interest),
// deals (qualified opportunities moving through pipeline stages), bids (public tenders and
// RFPs, with a document checklist), contracts (what was won, with renewal dates) and
// activities (calls, meetings, emails, tasks and notes, plus automatic history).

export const ACCOUNT_TYPES = { prospect: 'Prospect', client: 'Client', partner: 'Partner', supplier: 'Supplier', other: 'Other' };
export const SECTORS = { private: 'Private', government: 'Government', education: 'Education', ngo: 'Non-profit / NGO' };
export const LEAD_STATUS = { new: 'New', contacted: 'Contacted', qualified: 'Qualified', disqualified: 'Disqualified', converted: 'Converted' };
export const OPEN_LEAD = ['new', 'contacted', 'qualified'];
export const BID_STATUS = { preparing: 'Preparing', submitted: 'Submitted', evaluation: 'Under evaluation', awarded: 'Awarded', lost: 'Not awarded', cancelled: 'Cancelled or failed' };
export const OPEN_BID = ['preparing', 'submitted', 'evaluation'];
export const BID_MODES = {
  public: 'Competitive (public) bidding',
  negotiated: 'Negotiated procurement',
  svp: 'Small value procurement',
  rfq: 'Request for quotation',
  private: 'Private sector RFP',
};
export const CONTRACT_STATUS = { draft: 'Draft', active: 'Active', expired: 'Ended', terminated: 'Terminated' };
export const ACTIVITY_TYPES = { call: 'Call', meeting: 'Meeting', email: 'Email', task: 'Task', note: 'Note' };
// Won and lost close a deal; every other stage is an open stage from the sales setup.
export const CLOSED_STAGES = { won: 'Won', lost: 'Lost' };

export const DEFAULT_CRM = {
  stages: [
    { id: 'qualify', name: 'Qualification', probability: 10 },
    { id: 'needs', name: 'Needs analysis', probability: 25 },
    { id: 'proposal', name: 'Proposal', probability: 50 },
    { id: 'negotiation', name: 'Negotiation', probability: 75 },
  ],
  sources: ['Website', 'Referral', 'Public form', 'Service desk', 'PhilGEPS', 'Event', 'Cold outreach', 'Existing client', 'Other'],
  lostReasons: ['Price', 'Lost to a competitor', 'No budget', 'No decision', 'Requirements not met', 'Timing', 'Other'],
  industries: ['Government', 'Education', 'Healthcare', 'Banking and finance', 'Manufacturing', 'Retail', 'Telecommunications', 'Construction', 'Logistics', 'Other'],
  // Documents usually asked for in Philippine public bidding. Edit them in CRM settings to match
  // each procuring entity's bidding documents (rules change with the procurement law's IRR).
  bidChecklist: [
    'PhilGEPS registration certificate (Platinum) with Annex A',
    "Mayor's or business permit",
    'Tax clearance',
    'Audited financial statements',
    'NFCC computation or committed line of credit',
    'Statement of ongoing and completed contracts',
    'Bid security',
    'Omnibus sworn statement',
    'Technical proposal and compliance with specifications',
    'Financial proposal: bid form and price schedule',
  ],
  renewalNoticeDays: 60,
};

export const stageList = (crm) => [...(crm?.stages || DEFAULT_CRM.stages), { id: 'won', name: 'Won', probability: 100 }, { id: 'lost', name: 'Lost', probability: 0 }];
export const stageName = (crm, id) => stageList(crm).find((s) => s.id === id)?.name || id;
export const isOpenDeal = (deal) => deal.stage !== 'won' && deal.stage !== 'lost';
export function dealProbability(deal, crm) {
  if (deal.stage === 'won') return 100;
  if (deal.stage === 'lost') return 0;
  return stageList(crm).find((s) => s.id === deal.stage)?.probability ?? 0;
}
export const weightedValue = (deal, crm) => Math.round(((Number(deal.value) || 0) * dealProbability(deal, crm)) / 100);

// Days from `from` (YYYY-MM-DD) to `to`; negative when `to` has passed.
export function daysBetween(from, to) {
  if (!from || !to) return null;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

export const personName = (c) => [c?.firstName, c?.lastName].filter(Boolean).join(' ');
