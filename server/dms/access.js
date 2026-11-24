// Document Management: who may do what with a folder or a document (shared by CORE and ATLAS).
//
// Levels: view < edit < manage. A person's level on a document is the highest of: owning it (manage),
// the document's own grants, and the grants of each folder above it while the folder below inherits
// (the default). Holders of the "manage documents" permission manage everything. A grant names a person
// (user), an account type (role), a department, or everyone signed in. Grants can end (`until`) and
// can withhold downloading (`download: false`) and re-sharing (`share: false`).
//
// The app supplies `who` for each request: { id, role, department, manager (bool) }.
export const RANK = { none: 0, view: 1, edit: 2, manage: 3 };
const byRank = Object.fromEntries(Object.entries(RANK).map(([k, v]) => [v, k]));

export function grantMatches(g, who, now = Date.now()) {
  if (!g || (g.until && Date.parse(g.until) < now)) return false;
  if (g.type === 'everyone') return true;
  if (g.type === 'user') return g.id === who.id;
  if (g.type === 'role') return g.id === who.role;
  if (g.type === 'department') return Boolean(who.department) && g.id === who.department;
  return false;
}

// The folders from `folderId` up to the root (nearest first). `folders`: Map id → folder.
export function chain(folders, folderId) {
  const out = [];
  const seen = new Set();
  let f = folders.get(folderId);
  while (f && !seen.has(f.id) && out.length < 64) {
    seen.add(f.id);
    out.push(f);
    f = f.parentId ? folders.get(f.parentId) : null;
  }
  return out;
}

// { level, download, share } for `who` on a folder or document.
export function accessTo(who, item, { folders, kind = 'document', now = Date.now() }) {
  if (who.manager) return { level: 'manage', download: true, share: true, why: 'manager' };
  let best = 0;
  let download = false;
  let share = false;
  const take = (rank, g) => {
    if (rank > best) best = rank;
    if (rank >= RANK.view && g?.download !== false) download = true;
    if (rank >= RANK.manage || g?.share) share = true;
  };
  if (item.ownerId && item.ownerId === who.id) take(RANK.manage, null);
  for (const g of item.acl || []) if (grantMatches(g, who, now)) take(RANK[g.level] || 0, g);
  // Grants of the folders above, while each level inherits.
  let inherit = kind === 'document' ? true : item.inherit !== false;
  const start = kind === 'document' ? item.folderId : item.parentId;
  if (inherit) {
    for (const f of chain(folders, start)) {
      if (f.ownerId && f.ownerId === who.id) take(RANK.manage, null);
      for (const g of f.acl || []) if (grantMatches(g, who, now)) take(RANK[g.level] || 0, g);
      if (f.inherit === false) break;
    }
  }
  if (best >= RANK.edit) download = true;
  return { level: byRank[best], download: best > 0 && download, share: best > 0 && share };
}
export const atLeast = (level, want) => (RANK[level] || 0) >= (RANK[want] || 0);
