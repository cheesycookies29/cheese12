// Help & guides (/help/): the user guides in docs/guides (written next to the code, so every
// update of ATLAS brings its guides), and administrators' edits of them.
//  - An edit is kept as the administrator's version of that guide, with a fingerprint of the
//    built-in guide it started from: when an update changes the built-in guide, ATLAS says so,
//    and the administrator can compare, keep theirs or go back to the built-in one.
//  - Administrators can also add the school's own guides (e.g. a campus's office hours).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { HttpError } from './util.js';
import { can, ROLES } from '../shared/roles.js';
import { parseGuide } from '../shared/markdown.js';
import { searchGuides } from './guide-search.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'guides');
const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
// Guides anyone may read without signing in: how to sign in, and what to do when it does not work
// (the sign-in pages link to Help). Every other guide needs a sign-in.
export const PUBLIC_GUIDES = ['getting-started'];

// The built-in guides, read from disk (re-read when a file changes, e.g. after an update).
let cache = { stamp: '', guides: new Map() };
export function builtInGuides(dir = DIR) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort() : [];
  const stamp = files.map((f) => `${f}:${fs.statSync(path.join(dir, f)).mtimeMs}`).join('|');
  if (stamp === cache.stamp && dir === DIR) return cache.guides;
  const guides = new Map();
  for (const f of files) {
    const markdown = fs.readFileSync(path.join(dir, f), 'utf8');
    const { meta } = parseGuide(markdown);
    const id = meta.id || f.replace(/\.md$/, '');
    guides.set(id, { id, markdown, hash: hash(markdown), meta: { ...meta, id } });
  }
  if (dir === DIR) cache = { stamp, guides };
  return guides;
}

export function registerGuideRoutes(route, { db, version = '' }) {
  const data = () => db.data;
  const edits = () => (data().guideEdits ||= []);
  const visitor = ({ portalUser, adminUser, hrisUser }) => portalUser || adminUser || hrisUser || null;
  const userOf = (args) => visitor(args) || fail('Please sign in to read the guides.', 401);
  const mayEdit = (user) => Boolean(user) && (can(user.role, 'guides.edit') || user.role === 'admin');

  // Every guide as this person sees it: the administrator's version where there is one.
  function all() {
    const built = builtInGuides();
    const out = new Map();
    for (const g of built.values()) out.set(g.id, { ...g, builtIn: g, edit: null });
    for (const e of edits()) {
      const { meta } = parseGuide(e.markdown);
      const b = built.get(e.id);
      out.set(e.id, { id: e.id, markdown: e.markdown, meta: { ...meta, id: e.id }, builtIn: b || null, edit: e });
    }
    return [...out.values()];
  }
  const forRole = (g, role) => Boolean(role) && g.meta.roles.includes(role);
  const summary = (g, user) => ({
    id: g.id, title: g.meta.title || g.id, summary: g.meta.summary, roles: g.meta.roles, apps: g.meta.apps, order: g.meta.order,
    forYou: forRole(g, user?.role), custom: !g.builtIn, edited: Boolean(g.edit && g.builtIn),
    builtInChanged: Boolean(g.edit && g.builtIn && g.edit.baseHash !== g.builtIn.hash),
  });

  // The list of guides, and a search of them (?q=). Signed out: only the public guides.
  route('GET', '/api/guides', 'public', (args) => {
    const user = visitor(args);
    const q = String(args.query.q || '').trim();
    const list = all().filter((g) => user || PUBLIC_GUIDES.includes(g.id)).sort((a, b) => a.meta.order - b.meta.order || a.meta.title.localeCompare(b.meta.title));
    const found = q.length >= 2 ? searchGuides(list.map((g) => ({ id: g.id, title: g.meta.title || g.id, markdown: g.markdown, forYou: forRole(g, user?.role), order: g.meta.order })), q) : null;
    return {
      signedIn: Boolean(user), role: user?.role || null, roleLabel: user ? ROLES[user.role]?.label || user.role : '', canEdit: mayEdit(user), version,
      guides: list.map((g) => summary(g, user)),
      results: found?.results ?? null, partial: found?.partial ?? false, terms: found?.terms ?? [],
    };
  });

  route('GET', '/api/guides/:id', 'public', (args) => {
    const user = visitor(args);
    if (!user && !PUBLIC_GUIDES.includes(args.params.id)) fail('Please sign in to read this guide.', 401);
    const g = all().find((x) => x.id === args.params.id) || fail('Guide not found.', 404);
    const editor = mayEdit(user);
    return {
      ...summary(g, user), markdown: g.markdown,
      editedBy: g.edit ? { name: g.edit.updatedBy, at: g.edit.updatedAt } : null,
      // Administrators can compare their version with the built-in one.
      builtInMarkdown: editor && g.edit && g.builtIn ? g.builtIn.markdown : undefined,
      canEdit: editor,
    };
  });

  // Save an administrator's version (or a new guide of the school's own).
  route('PUT', '/api/guides/:id', 'public', (args) => {
    const user = userOf(args);
    if (!mayEdit(user)) fail('Only administrators can edit the guides.', 403);
    const id = args.params.id;
    if (!ID_RE.test(id)) fail('A guide id is 2 to 41 lowercase letters, digits and dashes.');
    const markdown = String(args.body.markdown || '').replace(/\r\n/g, '\n');
    if (markdown.length > 200000) fail('That guide is too long (200,000 characters at most).');
    const { meta, body } = parseGuide(markdown);
    if (!meta.title) fail('The guide needs a title in its header (title: …).');
    if (meta.id && meta.id !== id) fail(`The header says id: ${meta.id}, but this guide is ${id}.`);
    if (!body.trim()) fail('The guide is empty.');
    const built = builtInGuides().get(id);
    if (built && built.markdown === markdown) {
      // Saving the built-in text unchanged is the same as having no edit.
      data().guideEdits = edits().filter((e) => e.id !== id);
    } else {
      const e = { id, markdown, baseHash: built?.hash || null, updatedAt: new Date().toISOString(), updatedBy: user.name };
      data().guideEdits = [...edits().filter((x) => x.id !== id), e];
    }
    db.save();
    return { ok: true };
  });

  // Back to the built-in guide (or delete a school's own guide).
  route('DELETE', '/api/guides/:id', 'public', (args) => {
    const user = userOf(args);
    if (!mayEdit(user)) fail('Only administrators can edit the guides.', 403);
    if (!edits().some((e) => e.id === args.params.id)) fail('This guide has not been edited.', 404);
    data().guideEdits = edits().filter((e) => e.id !== args.params.id);
    db.save();
    return { ok: true };
  });
}
