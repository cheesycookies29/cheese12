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

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'guides');
const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

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
  const userOf = ({ portalUser, adminUser, hrisUser }) => portalUser || adminUser || hrisUser || fail('Please sign in to read the guides.', 401);
  const mayEdit = (user) => can(user.role, 'guides.edit') || user.role === 'admin';

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
  const forRole = (g, role) => g.meta.roles.includes(role);
  const summary = (g, user) => ({
    id: g.id, title: g.meta.title || g.id, summary: g.meta.summary, roles: g.meta.roles, apps: g.meta.apps, order: g.meta.order,
    forYou: forRole(g, user.role), custom: !g.builtIn, edited: Boolean(g.edit && g.builtIn),
    builtInChanged: Boolean(g.edit && g.builtIn && g.edit.baseHash !== g.builtIn.hash),
  });

  route('GET', '/api/guides', 'public', (args) => {
    const user = userOf(args);
    const q = String(args.query.q || '').trim().toLowerCase();
    const list = all().sort((a, b) => a.meta.order - b.meta.order || a.meta.title.localeCompare(b.meta.title));
    // Search: guides whose text has every word, with the first matching line.
    // A Markdown line as plain text, cut at a word, for a search result.
    const plain = (l) => {
      const t = l.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\s*(?:[-*]|\d+[.)]|>|#+|\|)\s*/, '').replace(/[*`|]/g, '').replace(/\s+/g, ' ').trim();
      return t.length > 220 ? `${t.slice(0, 220).replace(/\s+\S*$/, '')}…` : t;
    };
    const results = q.length >= 2 ? list.map((g) => {
      const words = q.split(/\s+/).filter(Boolean);
      const text = g.markdown.toLowerCase();
      if (!words.every((w) => text.includes(w))) return null;
      const lines = g.markdown.split('\n').filter((l) => l.trim() && !l.startsWith('---') && !/^\w+:\s/.test(l));
      const hit = lines.find((l) => words.every((w) => l.toLowerCase().includes(w))) || lines.find((l) => l.toLowerCase().includes(words[0])) || '';
      let section = '';
      for (const l of g.markdown.split('\n')) {
        if (/^#{2,3}\s/.test(l)) section = l.replace(/^#+\s+/, '');
        if (l === hit) break;
      }
      return { id: g.id, title: g.meta.title, section, snippet: plain(hit) };
    }).filter(Boolean) : null;
    return {
      role: user.role, roleLabel: ROLES[user.role]?.label || user.role, canEdit: mayEdit(user), version,
      guides: list.map((g) => summary(g, user)), results,
    };
  });

  route('GET', '/api/guides/:id', 'public', (args) => {
    const user = userOf(args);
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
