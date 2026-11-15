// The company's branding (Admin panel → Settings & branding): a brand colour, a logo and the sign-in
// headline. As in Lancaster ATLAS (lms/shared/themes.js): a preset, or the company's own colour;
// every lighter and darker shade is mixed from --brand and --accent in CSS (color-mix), in light and
// dark mode. CORE's own colours stay the default: maroon #5D0013 with a gold accent.

export const THEMES = {
  core: { label: 'CORE Maroon', brand: '#5d0013', accent: '#c28618' },
  navy: { label: 'Navy', brand: '#1e3a5f', accent: '#d4a017' },
  blue: { label: 'Royal Blue', brand: '#1d4ed8', accent: '#f59e0b' },
  green: { label: 'Green', brand: '#166534', accent: '#ca8a04' },
  teal: { label: 'Teal', brand: '#0f766e', accent: '#f97316' },
  purple: { label: 'Purple', brand: '#6b21a8', accent: '#eab308' },
  charcoal: { label: 'Charcoal', brand: '#1f2937', accent: '#c28618' },
};

export const HEX_RE = /^#[0-9a-f]{6}$/i;
export const HEADLINE_MAX = 120;
export const DEFAULT_HEADLINE = 'Every part of the company, on one core.';
export const DEFAULT_BRANDING = { theme: 'core', color: '', logo: '', headline: DEFAULT_HEADLINE };

// The logo: PNG, JPEG or WebP (SVG is refused: it can carry scripts), at most 300 KB.
export const LOGO_TYPES = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP' };
export const LOGO_MAX_BYTES = 300 * 1024;

// WCAG relative luminance and contrast ratio of two #rrggbb colours.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}
// Buttons, the active menu item and badges put white text on the brand colour: it needs 4.5 : 1
// (WCAG AA for normal text). Dark mode lightens the brand colour for text, so that is covered too.
export const MIN_CONTRAST = 4.5;
export const readableOnBrand = (hex) => HEX_RE.test(hex || '') && contrast(hex, '#ffffff') >= MIN_CONTRAST;

// The two colours of a branding: a preset's, or the company's colour with CORE's gold accent.
export function themeColors(branding = {}) {
  if (branding.theme === 'custom' && HEX_RE.test(branding.color || '')) return { brand: branding.color.toLowerCase(), accent: THEMES.core.accent };
  return { brand: (THEMES[branding.theme] || THEMES.core).brand, accent: (THEMES[branding.theme] || THEMES.core).accent };
}
