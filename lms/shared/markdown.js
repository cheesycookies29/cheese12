// The guides' Markdown (docs/guides/README.md lists what is supported), shared by the server
// (reading guides) and the Help page (showing them). Everything is escaped first: an edited
// guide can format text, link and show the screenshots, but never add HTML or scripts.

// "---\nkey: value\n---\nbody" -> { meta, body }
export function parseGuide(text) {
  const src = String(text || '').replace(/\r\n/g, '\n');
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*?)\s*(#.*)?$/);
      if (kv) meta[kv[1]] = kv[2];
    }
  }
  const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
  return {
    meta: { id: meta.id || '', title: meta.title || '', summary: meta.summary || '', roles: list(meta.roles), apps: list(meta.apps), order: Number(meta.order) || 100 },
    body: m ? src.slice(m[0].length) : src,
  };
}

export const slug = (s) => String(s).toLowerCase().replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A link target: web and mail links, another guide ("registrar", "registrar#posting-grades") or a section ("#walkthrough").
function href(url, opts) {
  const u = String(url).trim();
  if (/^(https?:|mailto:)/i.test(u)) return { url: u, external: true };
  if (u.startsWith('#')) return { url: `#/${opts.guideId || ''}${u}` };
  if (/^[a-z0-9-]+(#[a-z0-9-]+)?$/i.test(u)) return { url: `#/${u}` };
  if (u.startsWith('/')) return { url: u }; // a page of ATLAS, e.g. /admin#/terms
  return null;
}

function inline(text, opts) {
  const codes = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label, url) => {
    const h = href(url.replace(/&amp;/g, '&'), opts);
    if (!h) return label;
    return `<a href="${esc(h.url)}"${h.external ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

const CALLOUT = { tip: 'ok', note: 'info', important: 'bad' };

// Markdown -> HTML. opts: { imageBase: '/help/img/', guideId }
export function renderMarkdown(body, opts = {}) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const imageBase = opts.imageBase || '/help/img/';
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    // Code block
    if (line.startsWith('```')) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    // Headings (## and ###; a stray # is shown as ##)
    const h = line.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      const level = Math.min(4, Math.max(2, h[1].length));
      const text = h[2].trim();
      out.push(`<h${level} id="${slug(text)}">${inline(text, opts)}</h${level}>`);
      i++;
      continue;
    }
    // A screenshot on its own line
    const img = line.trim().match(/^!\[([^\]]*)\]\(([\w.-]+\.(?:jpg|jpeg|png|webp))\)$/i);
    if (img) {
      out.push(`<figure class="guide-shot"><img src="${esc(imageBase + img[2])}" alt="${esc(img[1])}" loading="lazy" />${img[1] ? `<figcaption>${inline(img[1], opts)}</figcaption>` : ''}</figure>`);
      i++;
      continue;
    }
    // Callout or quote
    if (line.startsWith('>')) {
      const quote = [];
      while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''));
      const text = quote.join(' ');
      const kind = text.match(/^\*\*(Tip|Note|Important):\*\*/i)?.[1]?.toLowerCase();
      out.push(kind ? `<div class="notice ${CALLOUT[kind]} guide-callout"><p>${inline(text, opts)}</p></div>` : `<blockquote><p>${inline(text, opts)}</p></blockquote>`);
      continue;
    }
    // Table
    if (line.trim().startsWith('|') && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      out.push(`<div class="table-scroll" tabindex="0" role="region" aria-label="Table"><table class="table guide-table"><thead><tr>${head.map((c) => `<th>${inline(c, opts)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, k) => `<td>${inline(r[k] || '', opts)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    // Lists
    const bullet = /^\s*[-*]\s+/;
    const number = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || number.test(line)) {
      const ordered = number.test(line);
      const re = ordered ? number : bullet;
      // A numbered list that goes on after a screenshot keeps its numbers ("5." starts at 5).
      const start = ordered ? Number(line.match(/\d+/)[0]) : 1;
      const items = [];
      while (i < lines.length && (re.test(lines[i]) || (lines[i].startsWith('  ') && lines[i].trim() && items.length))) {
        if (re.test(lines[i])) items.push(lines[i].replace(re, ''));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i++;
      }
      out.push(`<${ordered ? `ol${start > 1 ? ` start="${start}"` : ''}` : 'ul'}>${items.map((t) => `<li>${inline(t, opts)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    // Paragraph
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|>|```|\s*[-*]\s|\s*\d+[.)]\s|\|)/.test(lines[i]) && !/^!\[/.test(lines[i].trim())) para.push(lines[i++].trim());
    if (!para.length) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '), opts)}</p>`);
  }
  return out.join('\n');
}

// The ## and ### headings, for the guide's contents list.
export function headingsOf(body) {
  return String(body || '').split('\n').map((l) => l.match(/^(#{2,3})\s+(.+)$/)).filter(Boolean).map((m) => ({ level: m[1].length, text: m[2].trim(), id: slug(m[2].trim()) }));
}

// Images a guide shows.
export const imagesOf = (body) => [...String(body || '').matchAll(/^\s*!\[[^\]]*\]\(([\w.-]+\.(?:jpg|jpeg|png|webp))\)\s*$/gim)].map((m) => m[1]);
