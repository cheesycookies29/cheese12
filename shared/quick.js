// Quick access (0.35): the lightning button in the top bar. Each person pins the pages they use
// most (kept on the server, with their account: GET/PUT /api/me/quick-links), and the browser
// remembers the pages they opened last (localStorage, per account). The rules here are shared by
// the server (what a pinned page may be) and the browser (the Recent list and the page's name).

export const QUICK_MAX = 12; // pinned pages per person
export const QUICK_LABEL_MAX = 80;
export const QUICK_HREF_MAX = 300;
export const RECENT_KEEP = 12; // kept in the browser
export const RECENT_SHOW = 6; // shown under Recent
export const SUGGESTED_MODULES = 5;

// A link is a route inside CORE: "#/" and a path, with no spaces, quotes or angle brackets (the
// same rule as a notification's link).
const LINK_RE = /^#\/[A-Za-z0-9\-._~/?=&%:,+]*$/;
export const validQuickHref = (href) => typeof href === 'string' && href.length <= QUICK_HREF_MAX && LINK_RE.test(href);

// The name of a page as Quick access shows it: one line of text, control characters as spaces.
export const quickLabelText = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

const refuse = (message) => Object.assign(new Error(message), { status: 400 });

// The pinned pages as stored: [{ href, label }], at most QUICK_MAX, each href once (the first is
// kept). Anything else is refused with a message that says what is wrong.
export function cleanQuickLinks(list) {
  if (!Array.isArray(list)) throw refuse('Send the pinned pages as a list.');
  if (list.length > QUICK_MAX) throw refuse(`You can pin up to ${QUICK_MAX} pages.`);
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw refuse('Each pinned page needs an address and a name.');
    if (!validQuickHref(item.href)) throw refuse('A pinned page must be a page of CORE (an address that starts with #/).');
    if (typeof item.label !== 'string') throw refuse('Each pinned page needs a name.');
    const label = quickLabelText(item.label);
    if (!label || label.length > QUICK_LABEL_MAX) throw refuse(`The name of a pinned page must be 1 to ${QUICK_LABEL_MAX} characters.`);
    if (!out.some((x) => x.href === item.href)) out.push({ href: item.href, label });
  }
  return out;
}

// Short module names for a page's name, e.g. "HR · Leave & Requests".
export const QUICK_MODULE_NAMES = { hr: 'HR', assets: 'IT Assets', helpdesk: 'Service Desk', crm: 'Sales & CRM', projects: 'Projects', system: 'Admin panel' };

// The name of the page that is open: its sidebar item (when the page is that item's own), prefixed
// with the module; otherwise its heading (a record's page: the employee, the deal, the task).
// Cut to QUICK_LABEL_MAX characters.
export function pageLabel({ module = null, navLabel = '', exact = true, heading = '' } = {}) {
  const nav = quickLabelText(navLabel);
  const h1 = quickLabelText(heading);
  const name = (exact && nav) || h1 || nav;
  if (!name) return '';
  const prefix = QUICK_MODULE_NAMES[module];
  const full = prefix && name !== prefix ? `${prefix} · ${name}` : name;
  return full.length > QUICK_LABEL_MAX ? `${full.slice(0, QUICK_LABEL_MAX - 1).trimEnd()}…` : full;
}

// The browser's list of recent pages, read back: only well-formed entries.
export function readRecent(value) {
  let list;
  try {
    list = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const x of list) {
    if (x && validQuickHref(x.href) && typeof x.label === 'string' && quickLabelText(x.label) && !out.some((y) => y.href === x.href)) out.push({ href: x.href, label: quickLabelText(x.label).slice(0, QUICK_LABEL_MAX) });
  }
  return out.slice(0, RECENT_KEEP);
}

// After a visit: the page first, each page once, at most RECENT_KEEP.
export function addRecent(list, page) {
  const now = readRecent(list);
  if (!page || !validQuickHref(page.href) || !quickLabelText(page.label)) return now;
  return [{ href: page.href, label: quickLabelText(page.label).slice(0, QUICK_LABEL_MAX) }, ...now.filter((x) => x.href !== page.href)].slice(0, RECENT_KEEP);
}

// What Recent shows: the latest RECENT_SHOW, without the pinned pages and the page that is open.
export function recentToShow(list, { pinned = [], current = '' } = {}) {
  const skip = new Set([...pinned.map((p) => p.href), current]);
  return readRecent(list).filter((x) => !skip.has(x.href)).slice(0, RECENT_SHOW);
}

// The pages a person who has pinned nothing is offered: the homes of the modules they can open
// (moduleAccess in shared/profile.js), then My profile and My security.
export function suggestedLinks(access = []) {
  return [
    ...access.filter((m) => m.home).slice(0, SUGGESTED_MODULES).map((m) => ({ href: `#${m.home}`, label: m.name, glyph: m.glyph })),
    { href: '#/profile', label: 'My profile', glyph: 'user' },
    { href: '#/account/security', label: 'My security', glyph: 'shield' },
  ];
}

// The footer button: Pin this page, or Unpin this page; why it is off when it is.
export function pinButton({ page = null, pinned = [] } = {}) {
  if (!page || page.launcher) return { action: 'pin', text: 'Pin this page', disabled: true, why: 'The CORE home is always one click away (the CORE logo): open a page to pin it.' };
  if (pinned.some((p) => p.href === page.href)) return { action: 'unpin', text: 'Unpin this page', disabled: false, why: '' };
  if (!validQuickHref(page.href) || !page.label) return { action: 'pin', text: 'Pin this page', disabled: true, why: 'This page cannot be pinned.' };
  if (pinned.length >= QUICK_MAX) return { action: 'pin', text: 'Pin this page', disabled: true, why: `You can pin up to ${QUICK_MAX} pages. Unpin one first.` };
  return { action: 'pin', text: 'Pin this page', disabled: false, why: '' };
}
