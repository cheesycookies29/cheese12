// Document Management: the control panel's settings (shared by CORE and ATLAS). Defaults live here;
// what an administrator changes is kept in the data (`docSettings`) and cleaned on every save and read,
// so a hand-edited data file can never loosen the always-on rules.
import { FAMILIES, DEFAULT_FAMILIES } from './types.js';

export const CLASSIFICATIONS = [
  { id: 'public', label: 'Public', help: 'Can be given to anyone.' },
  { id: 'internal', label: 'Internal', help: 'For people in the school.' },
  { id: 'confidential', label: 'Confidential', help: 'For the people it is shared with; links need a password.' },
  { id: 'restricted', label: 'Restricted', help: 'For named people only: never shared by link, and only managers download it.' },
];
export const CLASS_IDS = CLASSIFICATIONS.map((c) => c.id);
export const LEVELS = ['view', 'edit', 'manage'];
export const LINK_MODES = ['view', 'download', 'upload'];

export const MAX_UPLOAD_MB = 100; // the most the control panel can allow (uploads arrive in pieces)

export const DEFAULT_SETTINGS = {
  families: DEFAULT_FAMILIES,
  maxUploadMB: 50,
  quotaMB: 2048, // per person; 0 = no quota
  versionsKept: 20,
  duplicates: 'warn', // 'warn' | 'refuse' (same content in the same folder)
  internalSharing: true,
  shareWithEveryone: true,
  links: true,
  uploadLinks: true,
  linkCreators: 'all', // 'all' | 'managers' (docs.manage holders only)
  linkPasswordRequired: false,
  linkPasswordMin: 8,
  linkDefaultDays: 14,
  linkMaxDays: 90,
  linkMaxDownloads: 0, // default limit on new download links; 0 = none
  linkClassifications: ['public', 'internal', 'confidential'],
  trashDays: 30,
  checkoutHours: 72,
};

const int = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d;
};
const bool = (v, d) => (typeof v === 'boolean' ? v : d);

export function cleanSettings(input = {}) {
  const v = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const d = DEFAULT_SETTINGS;
  const familyIds = FAMILIES.map((f) => f.id);
  const out = {
    families: Array.isArray(v.families) ? [...new Set(v.families.filter((f) => familyIds.includes(f)))] : d.families,
    maxUploadMB: int(v.maxUploadMB, 1, MAX_UPLOAD_MB, d.maxUploadMB),
    quotaMB: int(v.quotaMB, 0, 1024 * 1024, d.quotaMB),
    versionsKept: int(v.versionsKept, 1, 500, d.versionsKept),
    duplicates: ['warn', 'refuse'].includes(v.duplicates) ? v.duplicates : d.duplicates,
    internalSharing: bool(v.internalSharing, d.internalSharing),
    shareWithEveryone: bool(v.shareWithEveryone, d.shareWithEveryone),
    links: bool(v.links, d.links),
    uploadLinks: bool(v.uploadLinks, d.uploadLinks),
    linkCreators: ['all', 'managers'].includes(v.linkCreators) ? v.linkCreators : d.linkCreators,
    linkPasswordRequired: bool(v.linkPasswordRequired, d.linkPasswordRequired),
    linkPasswordMin: int(v.linkPasswordMin, 6, 64, d.linkPasswordMin),
    linkDefaultDays: int(v.linkDefaultDays, 1, 3650, d.linkDefaultDays),
    linkMaxDays: int(v.linkMaxDays, 1, 3650, d.linkMaxDays),
    linkMaxDownloads: int(v.linkMaxDownloads, 0, 100000, d.linkMaxDownloads),
    // Restricted documents are never shared by link, whatever was saved.
    linkClassifications: Array.isArray(v.linkClassifications) ? CLASS_IDS.filter((c) => c !== 'restricted' && v.linkClassifications.includes(c)) : d.linkClassifications,
    trashDays: int(v.trashDays, 1, 3650, d.trashDays),
    checkoutHours: int(v.checkoutHours, 1, 24 * 90, d.checkoutHours),
  };
  if (out.linkDefaultDays > out.linkMaxDays) out.linkDefaultDays = out.linkMaxDays;
  return out;
}
