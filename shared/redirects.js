// Old addresses of pages that moved into the Admin panel (0.16): guides, bookmarks and emails still
// use them, so the browser opens the page where it is now. Used by public/js/app.js.
const REDIRECTS = [
  [/^\/users$/, '/admin/users'],
  [/^\/settings$/, '/admin/settings'],
  [/^\/audit$/, '/admin/audit'],
  [/^\/devlog$/, '/admin/devlog'],
  [/^\/feedback\/inbox$/, '/admin/feedback'],
  [/^\/feedback\/inbox\/([^/]+)$/, '/admin/feedback/$1'],
  [/^\/admin\/?$/, '/admin/dashboard'],
];

// The new address of an old one (the path of a #/hash, without its ?query), or null.
export function redirectOf(path) {
  for (const [re, to] of REDIRECTS) if (re.test(path)) return path.replace(re, to);
  return null;
}
