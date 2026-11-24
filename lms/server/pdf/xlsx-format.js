// PDF Studio (0.65.1): an Excel cell's number as Excel shows it, from its number format code —
// "#,##0.00" → 1,234.50; "0%" → 12%; "\"₱\"#,##0.00" → ₱1,234.50; "dd/mm/yyyy" → 15/03/2026;
// "mmm d, yyyy" → Mar 15, 2026; "h:mm AM/PM" → 1:30 PM. The common parts of the format language:
// sections (positive;negative;zero;text), quoted and escaped text, [colours] and [$₱-3409] currency
// tags, digits (0 # ?), thousands separators, decimals, %, dates and times. Anything it does not know
// (fractions, scientific, conditions) returns null, and the caller shows the plain number.

// Built-in formats by id (what Excel shows for them in an English-language setup).
export const BUILTIN_CODES = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 14: 'm/d/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy',
  18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yyyy h:mm', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 45: 'mm:ss', 46: '[h]:mm:ss', 49: '@',
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// The sections of a code, split at ";" outside quotes.
function sections(code) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') quoted = !quoted;
    if (ch === '\\' && !quoted) {
      cur += ch + (code[i + 1] ?? '');
      i++;
      continue;
    }
    if (ch === ';' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// A serial date (1900 or 1904 system) as its parts.
function dateParts(serial, date1904) {
  let day = Math.floor(serial);
  const secs = Math.round((serial - day) * 86400);
  let ms;
  if (date1904) ms = Date.UTC(1904, 0, 1) + day * 86400000;
  else {
    if (day >= 61) day -= 1;
    ms = Date.UTC(1899, 11, 31) + day * 86400000;
  }
  const d = new Date(ms + Math.floor(secs / 86400) * 86400000);
  const s = secs % 86400;
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), h: Math.floor(s / 3600), mi: Math.floor(s / 60) % 60, s: s % 60, totalH: Math.floor(serial * 24) };
}

// Tokens of a section: literal text, or format letters.
function tokens(sec) {
  const out = [];
  for (let i = 0; i < sec.length; ) {
    const ch = sec[i];
    if (ch === '"') {
      const end = sec.indexOf('"', i + 1);
      out.push({ lit: sec.slice(i + 1, end < 0 ? sec.length : end) });
      i = end < 0 ? sec.length : end + 1;
    } else if (ch === '\\') {
      out.push({ lit: sec[i + 1] ?? '' });
      i += 2;
    } else if (ch === '[') {
      const end = sec.indexOf(']', i);
      const inner = sec.slice(i + 1, end < 0 ? sec.length : end);
      // [$₱-3409]: a currency symbol; [h], [mm]: elapsed time; [Red], [>100]: colours and conditions.
      if (inner.startsWith('$')) out.push({ lit: inner.slice(1).split('-')[0] });
      else if (/^h+$/i.test(inner)) out.push({ tok: 'H' });
      else if (/^[<>=]/.test(inner)) return null;
      i = end < 0 ? sec.length : end + 1;
    } else if (ch === '_') {
      out.push({ lit: ' ' }); // the width of the next character: a space is close enough
      i += 2;
    } else if (ch === '*') i += 2; // fill with the next character: nothing on a PDF page
    else if (/[ymdhs]/i.test(ch)) {
      let j = i;
      while (j < sec.length && sec[j].toLowerCase() === ch.toLowerCase()) j++;
      out.push({ tok: sec.slice(i, j).toLowerCase() });
      i = j;
    } else if (/^(AM\/PM|A\/P)/i.test(sec.slice(i))) {
      const m = /^(AM\/PM|A\/P)/i.exec(sec.slice(i))[0];
      out.push({ ampm: m });
      i += m.length;
    } else if (/[0#?.,%Ee/]/.test(ch)) {
      let j = i;
      while (j < sec.length && /[0#?.,%Ee+\-/]/.test(sec[j]) && !(sec[j] === '-' && !/[Ee]/.test(sec[j - 1]))) j++;
      out.push({ num: sec.slice(i, j) });
      i = j;
    } else {
      out.push({ lit: ch });
      i++;
    }
  }
  return out;
}

function dateText(toks, n, date1904) {
  if (!Number.isFinite(n) || n < 0 || n > 2958466) return null;
  const p = dateParts(n, date1904);
  const twelve = toks.some((t) => t.ampm);
  const out = [];
  toks.forEach((t, i) => {
    if (t.lit !== undefined) return out.push(t.lit);
    if (t.num !== undefined) return out.push(t.num.replace(/[0#?]/g, '').replace(/\./, '.'));
    if (t.ampm) return out.push(t.ampm.length > 3 ? (p.h < 12 ? 'AM' : 'PM') : p.h < 12 ? 'A' : 'P');
    const k = t.tok;
    // "m" is minutes after an hour or before a second, else the month.
    const near = (dir) => {
      for (let j = i + dir; j >= 0 && j < toks.length; j += dir) if (toks[j].tok) return toks[j].tok[0].toLowerCase();
      return null;
    };
    if (k === 'H') return out.push(String(p.totalH));
    if (k[0] === 'y') return out.push(k.length <= 2 ? String(p.y % 100).padStart(2, '0') : String(p.y));
    if (k[0] === 'd') return out.push(k.length === 1 ? String(p.d) : k.length === 2 ? String(p.d).padStart(2, '0') : k.length === 3 ? DAYS[p.wd].slice(0, 3) : DAYS[p.wd]);
    if (k[0] === 'h') {
      const h = twelve ? p.h % 12 || 12 : p.h;
      return out.push(k.length >= 2 ? String(h).padStart(2, '0') : String(h));
    }
    if (k[0] === 's') return out.push(k.length >= 2 ? String(p.s).padStart(2, '0') : String(p.s));
    if (k[0] === 'm') {
      if ((near(-1) === 'h' || near(1) === 's') && k.length <= 2) return out.push(k.length === 2 ? String(p.mi).padStart(2, '0') : String(p.mi));
      return out.push(k.length === 1 ? String(p.mo + 1) : k.length === 2 ? String(p.mo + 1).padStart(2, '0') : k.length === 3 ? MONTHS[p.mo].slice(0, 3) : k.length === 5 ? MONTHS[p.mo][0] : MONTHS[p.mo]);
    }
    return null;
  });
  return out.join('');
}

function numberText(toks, n) {
  const pattern = toks.filter((t) => t.num !== undefined).map((t) => t.num).join('');
  if (/[Ee/]/.test(pattern)) return null; // scientific, fractions
  let v = Math.abs(n);
  if (pattern.includes('%')) v *= 100 ** (pattern.match(/%/g).length);
  // Commas after the last digit scale by thousands ("#,##0," shows thousands).
  const scaleBy = (pattern.replace(/%/g, '').match(/,+$/) || [''])[0].length;
  v /= 1000 ** scaleBy;
  const [intPart, decPart = ''] = pattern.replace(/%/g, '').replace(/,+$/, '').split('.');
  const decimals = (decPart.match(/[0#?]/g) || []).length;
  const minDecimals = (decPart.match(/0/g) || []).length;
  const grouped = intPart.includes(',');
  const minInt = (intPart.match(/0/g) || []).length;
  let [i, d = ''] = v.toFixed(decimals).split('.');
  d = d.replace(/0+$/, '');
  while (d.length < minDecimals) d += '0';
  if (i === '0' && minInt === 0 && pattern.length) i = '';
  i = i.padStart(minInt, '0');
  if (grouped) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const numText = `${i}${d ? `.${d}` : decimals && minDecimals ? '.' : ''}`;
  let placed = false;
  const out = toks.map((t) => {
    if (t.lit !== undefined) return t.lit;
    if (t.num !== undefined) {
      if (placed) return t.num.includes('%') ? '%' : '';
      placed = true;
      return `${numText}${t.num.includes('%') ? '%' : ''}`;
    }
    return '';
  }).join('');
  return out;
}

// n as the format `code` shows it; null when the code is not understood. date1904: the workbook's
// date system.
export function formatExcel(n, code, date1904 = false) {
  if (code == null || /^general$/i.test(code.trim()) || code === '@') return null;
  const secs = sections(code);
  let sec = secs[0];
  let value = n;
  let sign = n < 0 ? '-' : '';
  if (n < 0 && secs.length > 1 && secs[1] !== '') {
    sec = secs[1];
    sign = '';
    value = Math.abs(n);
  } else if (n === 0 && secs.length > 2 && secs[2] !== '') sec = secs[2];
  const toks = tokens(sec);
  if (!toks) return null;
  const isDate = toks.some((t) => t.tok || t.ampm);
  const text = isDate ? dateText(toks, value, date1904) : numberText(toks, value);
  if (text === null) return null;
  return isDate ? text : `${sign && value !== 0 ? '-' : ''}${text}`;
}
