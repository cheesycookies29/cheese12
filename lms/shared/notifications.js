// Notifications (the bell in the top bar), after CORE ERP's: the systems they come from, and the
// links they may carry. Shared by the server (server/notifications.js) and the browser
// (public/js/account/notifications.js).

// The systems a notification comes from (the ids of shared/systems.js), in the order the filter lists them.
export const NOTIFY_SYSTEMS = [
  { id: 'lms', label: 'Learn', icon: 'laptop' },
  { id: 'uis', label: 'Academic', icon: 'cap' },
  { id: 'hris', label: 'People', icon: 'users' },
  { id: 'fmis', label: 'Finance', icon: 'coins' },
];
export const NOTIFY_SYSTEM_IDS = NOTIFY_SYSTEMS.map((s) => s.id);

// A page in ATLAS: the home page, or a page inside one of its systems ("/lms/#/…", "/admin#/…",
// "/academic/#/…"), never another site or a script. The same rule as Quick access (server/account.js).
export const ATLAS_HREF = /^\/(?:(?:lms\/|admin|hris\/|academic\/|finance\/|tools\/)#\/[A-Za-z0-9\-._~/?=&%:,+]*)?$/;
export const LINK_MAX = 300;
export const isAtlasLink = (href) => typeof href === 'string' && href.length <= LINK_MAX && ATLAS_HREF.test(href);
