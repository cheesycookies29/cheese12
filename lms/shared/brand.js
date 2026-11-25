// Lancaster ATLAS: the platform's name, and the names of its systems.
// The mark is in public/img/brand (drawn by scripts/brand-mark.py); see docs/BRAND.md.
export const BRAND = {
  company: 'Lancaster',
  name: 'ATLAS',
  full: 'Lancaster ATLAS',
  byline: 'Education platform by Lancaster', // under the wordmark, like CORE's "ERP by Lancaster"
  tagline: 'Unified Education Management Platform',
  colors: { burgundy: '#5D0013', gold: '#C28618', charcoal: '#1E1E1E', lightGray: '#F5F5F5' },
};

export const product = (word) => `ATLAS ${word}`;

// ----- Whose brand leads (Settings → Branding → Brand) -----
// 'atlas' (the default): ATLAS's mark and name, with the school's name beside them.
// 'school': "<school>, powered by ATLAS": the school's seal and short name lead ("<short> Learn",
// "<short> home"…) and ATLAS shows only as a small "Powered by ATLAS" credit. The short name and
// the seal are typed and uploaded by the school's administrator; no school's name is in the code.
// Shared by the server (system names, messages) and the pages (public/js/brand.js).
export const BRAND_MODES = ['atlas', 'school'];
export const SHORT_NAME_MAX = 24;
export const isSchoolBrand = (b) => b?.mode === 'school' && Boolean(String(b.shortName || '').trim());
// The brand name: the school's short name in school mode, else ATLAS.
export const brandName = (b) => (isSchoolBrand(b) ? String(b.shortName).trim() : BRAND.name);
// A product under the brand: "ATLAS Learn", or "<short> Learn" in school mode.
export const productName = (b, word) => `${brandName(b)} ${word}`;
// A name written with ATLAS in front ("ATLAS Learn", "ATLAS home", "ATLAS · Sign in") with the
// brand in front instead. Anything else is left as it is.
export const branded = (b, name) => String(name ?? '').replace(/^ATLAS(?=$|[\s·])/, brandName(b));
// The products named anywhere in a text ("Keeps the books in ATLAS Finance") under the brand.
export const brandedProducts = (b, text) => String(text ?? '').replace(/\bATLAS (Learn|Academic|People|Finance|Documents|Tools)\b/g, (_, word) => productName(b, word));
