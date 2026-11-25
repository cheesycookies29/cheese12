// Brand colour presets for Settings → Branding. `brand` is the main colour;
// lighter and darker shades are mixed from it in CSS (color-mix), so a custom colour works too.
export const THEMES = {
  maroon: { label: 'ATLAS Burgundy', brand: '#5d0013', accent: '#c28618' },
  green: { label: 'Agriculture Green', brand: '#166534', accent: '#ca8a04' },
  forest: { label: 'Forest', brand: '#14532d', accent: '#65a30d' },
  blue: { label: 'Royal Blue', brand: '#1d4ed8', accent: '#f59e0b' },
  navy: { label: 'Navy', brand: '#1e3a5f', accent: '#d4a017' },
  teal: { label: 'Teal', brand: '#0f766e', accent: '#f97316' },
  purple: { label: 'Purple', brand: '#6b21a8', accent: '#eab308' },
};

export const HEX_RE = /^#[0-9a-f]{6}$/i;

// The school's own theme: its colour, and its accent when one is chosen (else ATLAS's gold).
export function themeColors(branding = {}) {
  if (branding.theme === 'custom' && HEX_RE.test(branding.color || '')) {
    return { brand: branding.color, accent: HEX_RE.test(branding.accent || '') ? branding.accent : THEMES.maroon.accent };
  }
  return THEMES[branding.theme] || THEMES.maroon;
}

// ----- Contrast (WCAG 2.x), so any colour a school picks stays readable -----
const channel = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (parts) => `#${parts.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
export const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
// The text colour on a background of this colour: near-black or white, whichever reads better
// (a yellow accent gets dark text, a deep one white).
export const DARK_INK = '#1c1300';
export const inkOn = (hex) => (HEX_RE.test(hex || '') && contrast(hex, DARK_INK) >= contrast(hex, '#ffffff') ? DARK_INK : '#ffffff');
// The colour mixed towards black (towards white with toWhite) just enough to reach `ratio` against
// `bg`: the accent as text on a light page (4.5:1, WCAG AA), for example.
export function readableOn(hex, bg = '#ffffff', ratio = 4.5, toWhite = false) {
  if (!HEX_RE.test(hex || '')) return hex;
  const from = rgb(hex);
  const to = toWhite ? [255, 255, 255] : [0, 0, 0];
  for (let i = 0; i <= 20; i++) {
    const c = toHex(from.map((v, k) => v + ((to[k] - v) * i) / 20));
    if (contrast(c, bg) >= ratio) return c;
  }
  return toWhite ? '#ffffff' : '#000000';
}
