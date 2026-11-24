// Notifications (the bell in the top bar), after CORE ERP's: the systems they come from, and the
// links they may carry. Shared by the server (server/notifications.js) and the browser
// (public/js/account/notifications.js).

// The systems a notification comes from (the ids of shared/systems.js), in the order the filter lists them.
export const NOTIFY_SYSTEMS = [
  { id: 'lms', label: 'Learn', icon: 'laptop' },
  { id: 'uis', label: 'Academic', icon: 'cap' },
  { id: 'hris', label: 'People', icon: 'users' },
  { id: 'fmis', label: 'Finance', icon: 'coins' },
  { id: 'dms', label: 'Documents', icon: 'folder' },
  { id: 'account', label: 'Your account', icon: 'shield' }, // sign-in and security (e.g. 2-step verification reset)
];
export const NOTIFY_SYSTEM_IDS = NOTIFY_SYSTEMS.map((s) => s.id);

// A page in ATLAS: the home page, or a page inside one of its systems ("/lms/#/…", "/admin#/…",
// "/academic/#/…"), never another site or a script. The same rule as Quick access (server/account.js).
export const ATLAS_HREF = /^\/(?:(?:lms\/|admin|hris\/|academic\/|finance\/|tools\/|documents\/)#\/[A-Za-z0-9\-._~/?=&%:,+]*)?$/;
export const LINK_MAX = 300;
// Your own pages (My profile, My security) are in the system your account type signs in to.
const OWN_APP = { portal: '/lms/', admin: '/admin', hris: '/hris/' };
export const ownPageLink = (side, page) => `${OWN_APP[side] || OWN_APP.portal}#/${page}`;
export const isAtlasLink = (href) => typeof href === 'string' && href.length <= LINK_MAX && ATLAS_HREF.test(href);
