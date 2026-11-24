// Dark or light before a public page paints (the same choice as in CORE, kept per browser). A file of
// its own, so public pages need no inline script (server/security.js pagePolicy).
try {
  var t = localStorage.getItem('core-theme');
  if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.dataset.theme = 'dark';
} catch (e) { /* storage blocked: light */ }
