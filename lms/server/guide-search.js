// Search of the Help & guides pages. People search in their own words ("login", "salary",
// "marks"), so the search:
//  - looks in each section of each guide (a "## " or "### " heading and what follows), not in
//    whole guides, and answers with the sections that fit best;
//  - matches the start of words ("enrol" finds "enroll" and "enrollment"; "grades" finds "grade");
//  - knows everyday words for the guides' words (login → sign in, salary → payslip);
//  - ignores little words (how, do, I, my, the);
//  - puts the reader's own guides first, and how-to steps before overviews;
//  - when no section has every word, answers with the closest ones.
import { parseGuide, slug } from '../shared/markdown.js';

const STOP = new Set(('a about am an and any are as at be by can cannot cant could did do does doesnt dont for from get had has have how i if in into is it its '
  + 'me my need not of on or our out please should so some that the their them then there these this to up us want was we were what when where which who why will with would you your').split(' '));

// Phrases rewritten to the guides' words before the search is split into words.
const PHRASES = [
  [/\blog[\s-]?(?:in|on)\b|\blogg(?:ed|ing) in\b|\bsignin\b/g, 'sign in'],
  [/\blog[\s-]?(?:out|off)\b|\bsignout\b/g, 'sign out'],
  [/\bpay[\s-]slips?\b/g, 'payslip'],
  [/\be-mail\b/g, 'email'],
  [/\bpass[\s-]word\b/g, 'password'],
  [/\buser[\s-]name\b/g, 'username'],
  [/\btime[\s-]?table\b/g, 'schedule'],
  [/\bid number\b/g, 'student number'],
  [/\b2fa\b|\btwo[\s-]factor\b/g, 'keycloak'],
];
// Phrases kept whole (their words alone would match too much).
const KEEP = ['sign in', 'sign out', 'too many', 'dark mode', 'student number', 'grade sheet', 'cash advance', 'official receipt', 'purchase request', 'purchase order', 'final grade', 'running grade', 'class list'];
// An everyday word → the words the guides use (each may be a phrase).
const SYNONYMS = {
  salary: ['salary', 'payslip', 'pay'], wage: ['salary', 'payslip', 'pay'], sweldo: ['salary', 'payslip', 'pay'], payroll: ['payroll', 'payslip'],
  tuition: ['receipt', 'payment', 'fee'], fee: ['fee', 'receipt', 'payment'], payment: ['payment', 'receipt'], bill: ['receipt', 'payment'],
  mark: ['grade', 'score'], score: ['score', 'grade'], result: ['result', 'grade', 'score'], gwa: ['gwa', 'general weighted average'],
  subject: ['subject', 'class', 'course'], course: ['course', 'class', 'subject'], section: ['section', 'class'],
  exam: ['exam', 'quiz'], test: ['quiz', 'exam'], examination: ['exam', 'quiz'],
  homework: ['assignment', 'activity', 'task'], assignment: ['assignment', 'activity'], submit: ['submit', 'hand in'], upload: ['upload', 'hand in', 'attach'],
  locked: ['locked', 'lock', 'too many'], blocked: ['locked', 'too many', 'disabled'], lockout: ['locked', 'too many'],
  forgot: ['forgot', 'reset'], forgotten: ['forgot', 'reset'], reset: ['reset', 'forgot'], lost: ['lost', 'forgot'],
  absent: ['absent', 'attendance'], absence: ['absent', 'attendance'], late: ['late', 'tardiness', 'attendance'], dtr: ['dtr', 'daily time record', 'attendance'],
  vacation: ['vacation', 'leave'], sick: ['sick', 'leave'], holiday: ['holiday', 'no classes'],
  teacher: ['teacher', 'faculty'], professor: ['teacher', 'faculty'], instructor: ['teacher', 'faculty'], faculty: ['faculty', 'teacher'],
  parent: ['parent', 'guardian'], guardian: ['guardian', 'parent'], child: ['student', 'child'], kid: ['student', 'child'],
  transcript: ['transcript', 'tor'], tor: ['transcript', 'tor'], certificate: ['certificate', 'certification'], diploma: ['certificate', 'document'],
  delete: ['delete', 'remove'], remove: ['remove', 'delete'], erase: ['delete', 'remove'],
  add: ['add', 'new', 'create'], create: ['create', 'add', 'new'], edit: ['edit', 'change'], change: ['change', 'edit'], update: ['change', 'edit', 'update'],
  phone: ['phone', 'mobile'], mobile: ['phone', 'mobile'], cellphone: ['phone', 'mobile'],
  enrol: ['enroll', 'enrol'], register: ['enroll', 'register', 'registration'], registration: ['registration', 'enroll'], withdraw: ['withdraw', 'drop'],
  timetable: ['schedule'], calendar: ['calendar', 'schedule'], backup: ['backup', 'back up'], restore: ['restore', 'backup'],
  sso: ['keycloak', 'single sign-on'], keycloak: ['keycloak', 'single sign-on'], error: ['error', 'wrong', 'cannot'], slow: ['too many', 'wait'],
  ebook: ['e-reader', 'e-book'], book: ['book', 'e-reader'], logo: ['logo', 'branding'], colour: ['colour', 'color', 'theme'], color: ['color', 'colour', 'theme'],
  print: ['print', 'pdf'], download: ['download', 'export', 'csv'], export: ['export', 'download', 'csv'], excel: ['csv', 'export', 'download'],
  cheque: ['check'], voucher: ['voucher', 'dv'], dv: ['dv', 'voucher'], receipt: ['receipt', 'o.r.'], or: ['o.r.', 'official receipt'],
};

const norm = (s) => String(s).toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
// The start of a word that its other forms share: grades → grade, classes → class, enrolling → enrol.
function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) {
    const s = w.slice(0, -3);
    return s.length >= 5 && s.at(-1) === s.at(-2) ? s.slice(0, -1) : s;
  }
  if (w.length > 4 && w.endsWith('zzes')) return w.slice(0, -3);
  if (w.length > 4 && /(ss|sh|ch|x)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A word matches where a word of the text starts with it; a phrase where its words follow each other.
const matcher = (alt) => new RegExp(`(?<![a-z0-9])${alt.split(' ').map((w, i, all) => reEsc(i === all.length - 1 ? stem(w) : w)).join('[\\s-]+')}`, 'g');

// The search as groups of alternatives: "forgot my password" → [[forgot, reset], [password]].
export function parseQuery(q) {
  let s = norm(q).replace(/[^a-z0-9\s.'&-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  const groups = [];
  for (const p of KEEP) {
    if (new RegExp(`(?<![a-z0-9])${reEsc(p)}`).test(s)) {
      groups.push([p]);
      s = s.replace(new RegExp(`(?<![a-z0-9])${reEsc(p)}[a-z]*`, 'g'), ' ');
    }
  }
  const words = s.split(/[\s]+/).map((w) => w.replace(/^[.'&-]+|[.'&-]+$/g, '')).filter((w) => w.length > 1 || /\d/.test(w));
  const kept = words.filter((w) => !STOP.has(w));
  for (const w of (kept.length || groups.length ? kept : words)) {
    const alts = SYNONYMS[w] || SYNONYMS[stem(w)] || [w];
    if (!groups.some((g) => g[0] === alts[0])) groups.push(alts);
  }
  return groups.slice(0, 8);
}

// A Markdown line as plain text.
const plain = (l) => l.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\s*(?:[-*]|\d+[.)]|>|#+)\s*/, '').replace(/^\|/, '').replace(/\s*\|\s*/g, ' · ').replace(/[*`]/g, '').replace(/\s+/g, ' ').replace(/ · $/, '').trim();
const cut = (t, n = 220) => (t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '')}…` : t);

// The sections of a guide: { heading, parent, anchor, lines }. Under "Questions", each question
// (a paragraph that starts in bold) is a section of its own, so it can be found by its words.
export function sectionsOf(markdown) {
  const { body } = parseGuide(markdown);
  const out = [];
  let h2 = '';
  let cur = { heading: '', parent: '', anchor: '', lines: [] };
  for (const l of String(body).split('\n')) {
    const h = l.match(/^(#{2,3})\s+(.+)$/);
    const question = !h && /^questions/i.test(h2) && l.match(/^\*\*(.+?)\*\*\s*(.*)$/);
    if (h) {
      if (cur.heading || cur.lines.length) out.push(cur);
      const text = h[2].trim();
      if (h[1].length === 2) h2 = text;
      cur = { heading: text.replace(/[*`]/g, ''), parent: h[1].length === 3 ? h2.replace(/[*`]/g, '') : '', anchor: slug(text), lines: [] };
    } else if (question) {
      if (cur.heading || cur.lines.length) out.push(cur);
      cur = { heading: plain(question[1]).replace(/[.:]$/, ''), parent: h2, anchor: slug(h2), lines: question[2].trim() ? [plain(question[2])] : [] };
    } else if (l.trim() && !/^\|\s*:?-{2,}/.test(l.trim()) && !/^```/.test(l)) cur.lines.push(plain(l));
  }
  if (cur.heading || cur.lines.length) out.push(cur);
  return out.map((s) => ({ ...s, lines: s.lines.filter(Boolean) }));
}

const WEIGHT = [[/^how to/i, 1.25], [/^questions/i, 1.15], [/^walkthrough/i, 1], [/^before you start/i, 0.7], [/^screens at a glance/i, 0.75]];
const weightOf = (s) => WEIGHT.find(([re]) => re.test(s.parent || s.heading))?.[1] ?? 1;

// guides: [{ id, title, markdown, forYou, order }]. Returns { results, partial, terms }.
export function searchGuides(guides, q, { limit = 12, perGuide = 3 } = {}) {
  const groups = parseQuery(q);
  if (!groups.length) return { results: [], partial: false, terms: [] };
  const res = groups.map((alts) => alts.map(matcher));
  const count = (text, g) => res[g].reduce((n, re) => n + (text.match(re)?.length || 0), 0);
  // The word as typed counts in full; another word for it a little less.
  const headWeight = (text, g) => res[g].reduce((best, re, k) => (text.match(re) ? Math.max(best, k === 0 ? 1 : 0.7) : best), 0);
  const hits = [];
  for (const g of guides) {
    for (const s of sectionsOf(g.markdown)) {
      const head = norm(s.heading);
      const lines = s.lines.map(norm);
      const body = lines.join('\n');
      let matched = 0;
      let score = 0;
      groups.forEach((_, i) => {
        const inHead = headWeight(head, i);
        const inBody = count(body, i);
        if (inHead || inBody) matched++;
        score += inHead * 8 + Math.min(inBody, 3);
      });
      if (!matched) continue;
      // The line that says most: the one with the most of the words.
      let best = -1;
      let bestN = 0;
      lines.forEach((l, k) => {
        const n = groups.filter((_, i) => count(l, i)).length;
        if (n > bestN) [best, bestN] = [k, n];
      });
      if (bestN === groups.length && groups.length > 1) score += 4;
      score *= weightOf(s) * (g.forYou ? 1.6 : 1) * (g.id === 'whats-new' ? 0.6 : 1);
      hits.push({ id: g.id, title: g.title, section: s.heading, anchor: s.anchor, snippet: cut(s.lines[best >= 0 ? best : 0] || s.heading), matched, score, order: g.order ?? 0 });
    }
  }
  const full = hits.filter((h) => h.matched === groups.length);
  const partial = !full.length && groups.length > 1;
  const pool = (partial ? hits.map((h) => ({ ...h, score: h.score + h.matched * 20 })) : full).sort((a, b) => b.score - a.score || a.order - b.order);
  const per = {};
  const results = [];
  for (const h of pool) {
    if ((per[h.id] = (per[h.id] || 0) + 1) > perGuide) continue;
    results.push({ id: h.id, title: h.title, section: h.section, anchor: h.anchor, snippet: h.snippet });
    if (results.length >= limit) break;
  }
  // What to highlight in the results: the starts of words that matched.
  const terms = [...new Set(groups.flat().map((alt) => alt.split(' ').map((w, i, all) => (i === all.length - 1 ? stem(w) : w)).join(' ')))];
  return { results, partial, terms };
}
