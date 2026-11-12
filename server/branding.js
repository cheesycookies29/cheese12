// Branding (Admin panel → Settings & branding): checks a branding before it is saved, and serves
// the logo. The logo is kept in the settings as a data: URL of at most 300 KB, and is only accepted
// when its bytes are a PNG, JPEG or WebP picture of the type it claims (content-sniffed, so a
// script or an SVG renamed .png is refused). It is served from CORE's own address with headers that
// keep a browser from running anything in it.
import { createHash } from 'node:crypto';
import { HttpError } from './util.js';
import { THEMES, HEX_RE, DEFAULT_BRANDING, HEADLINE_MAX, LOGO_TYPES, LOGO_MAX_BYTES, readableOnBrand, contrast, themeColors } from '../shared/brand.js';

const fail = (msg) => {
  throw new HttpError(400, msg);
};

// The type a picture's first bytes say it is, or null.
export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// A logo as sent by the browser: '' (none) or data:image/png|jpeg|webp;base64,… Returns the logo
// as stored (re-encoded from its bytes), or refuses it.
export function checkLogo(value) {
  if (value === '' || value === null) return '';
  if (typeof value !== 'string') fail('The logo must be a PNG, JPEG or WebP picture.');
  if (value.length > Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 64) fail('The logo is too large: use a picture under 300 KB.');
  const m = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!m) fail('The logo must be a PNG, JPEG or WebP picture.');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > LOGO_MAX_BYTES) fail('The logo is too large: use a picture under 300 KB.');
  const type = sniffImage(bytes);
  if (!type) fail('That file is not a PNG, JPEG or WebP picture.');
  if (type !== m[1]) fail(`That picture is a ${LOGO_TYPES[type]}, not the ${LOGO_TYPES[m[1]]} it says it is.`);
  return `data:${type};base64,${bytes.toString('base64')}`;
}

// A branding from the browser, on top of the current one: only these four fields, each checked.
export function validateBranding(input, current = DEFAULT_BRANDING) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Send the branding as an object.');
  const out = { ...DEFAULT_BRANDING, ...current };
  if ('theme' in input) {
    if (input.theme !== 'custom' && !Object.hasOwn(THEMES, input.theme)) fail('Choose one of the colours, or the company\'s own.');
    out.theme = input.theme;
  }
  if ('color' in input) {
    const color = String(input.color ?? '').trim().toLowerCase();
    if (color && !HEX_RE.test(color)) fail('The company colour must look like #5d0013.');
    out.color = color;
  }
  if (out.theme === 'custom') {
    if (!out.color) fail('Pick the company colour.');
    if (!readableOnBrand(out.color)) fail(`White text on ${out.color} is hard to read (contrast ${contrast(out.color, '#ffffff')} : 1; at least 4.5 : 1 is needed). Choose a darker colour.`);
  } else out.color = '';
  if ('headline' in input) {
    const h = String(input.headline ?? '').replace(/\s+/g, ' ').trim();
    if (h.length > HEADLINE_MAX) fail(`Keep the sign-in headline under ${HEADLINE_MAX} characters.`);
    out.headline = h;
  }
  if ('logo' in input) out.logo = checkLogo(input.logo);
  return { theme: out.theme, color: out.color, logo: out.logo, headline: out.headline };
}

const logoTag = (logo) => (logo ? createHash('sha256').update(logo).digest('hex').slice(0, 12) : '');

// What every page may know of the branding, before sign-in too: colours, headline, the company
// name and where the logo is (never the picture itself, which can be large).
export function publicBrand(settings) {
  const b = { ...DEFAULT_BRANDING, ...(settings.branding || {}) };
  return {
    ...themeColors(b), theme: b.theme, headline: b.headline || DEFAULT_BRANDING.headline, companyName: settings.companyName || '',
    logo: b.logo ? `/api/public/brand/logo?v=${logoTag(b.logo)}` : null,
  };
}
// The settings as the browser gets them: the logo is replaced by its address.
export const settingsForBrowser = (settings) => ({ ...settings, branding: { ...DEFAULT_BRANDING, ...(settings.branding || {}), logo: publicBrand(settings).logo || '' } });

// GET /api/public/brand/logo: the picture, as an image that cannot run anything.
export function logoResponse(settings) {
  const logo = settings.branding?.logo || '';
  const m = logo.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!m) throw new HttpError(404, 'No logo.');
  const bytes = Buffer.from(m[2], 'base64');
  if (sniffImage(bytes) !== m[1]) throw new HttpError(404, 'No logo.');
  return {
    data: bytes,
    headers: {
      'Content-Type': m[1],
      'Content-Disposition': `inline; filename="logo.${m[1].split('/')[1]}"`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'no-cache',
    },
  };
}
