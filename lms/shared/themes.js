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

export function themeColors(branding = {}) {
  if (branding.theme === 'custom' && HEX_RE.test(branding.color || '')) return { brand: branding.color, accent: THEMES.maroon.accent };
  return THEMES[branding.theme] || THEMES.maroon;
}
