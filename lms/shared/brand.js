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
