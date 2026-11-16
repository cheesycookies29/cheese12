// Small charts for the Security monitor (0.34): one series each, columns for counts and a line for
// a measure, one axis, hairline grid, a crosshair and readout on hover and with the arrow keys, and
// the numbers as a table for anyone who would rather read them. Inline SVG, no library.
import { html } from './ui.js';

const W = 600;
const H = 150;
const num = new Intl.NumberFormat('en-PH');

// A round top for the axis: 1, 2 or 5 times a power of ten.
export function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((m) => m * p).find((x) => x >= v);
}
export const compact = (v) => (v >= 10000 ? `${num.format(Math.round(v / 1000))}K` : num.format(v));

// spec: { title, note, points: [{ label (full, for the readout), short (axis), v }], kind: 'col' | 'line',
// fmt: (v) => text, empty: text when every value is zero or missing }
export function chart({ title, note = '', points, kind = 'col', fmt = (v) => num.format(v), empty = 'Nothing in this period.' }) {
  const values = points.map((p) => p.v);
  const max = niceMax(Math.max(0, ...values.filter((v) => v != null)));
  const n = points.length || 1;
  const slot = W / n;
  const y = (v) => H - (v / max) * H;
  const has = values.some((v) => v);
  let marks = '';
  if (kind === 'col') {
    const bw = Math.max(1, Math.min(slot - 2, slot * 0.72));
    marks = html`${points.map((p, i) => (p.v ? html`<rect class="mc-bar" data-i="${i}" x="${(i * slot + (slot - bw) / 2).toFixed(2)}" y="${y(p.v).toFixed(2)}" width="${bw.toFixed(2)}" height="${(H - y(p.v)).toFixed(2)}"></rect>` : ''))}`;
  } else {
    // A gap where there is no value (the server was not running then).
    const runs = [];
    let run = [];
    points.forEach((p, i) => {
      if (p.v == null) {
        if (run.length) runs.push(run);
        run = [];
      } else run.push(`${((i + 0.5) * slot).toFixed(2)},${y(p.v).toFixed(2)}`);
    });
    if (run.length) runs.push(run);
    // A value alone (one hour of data) is drawn across its own period, so it can be seen.
    for (const r of runs) {
      if (r.length !== 1) continue;
      const [x, yy] = r[0].split(',').map(Number);
      r.splice(0, 1, `${(x - slot * 0.35).toFixed(2)},${yy}`, `${(x + slot * 0.35).toFixed(2)},${yy}`);
    }
    marks = html`${runs.map((r) => html`<polygon class="mc-wash" points="${`${r[0].split(',')[0]},${H} ${r.join(' ')} ${r.at(-1).split(',')[0]},${H}`}"></polygon><polyline class="mc-line" points="${r.join(' ')}" vector-effect="non-scaling-stroke"></polyline>`)}`;
  }
  const peak = Math.max(0, ...values.filter((v) => v != null));
  const total = values.reduce((a, v) => a + (v || 0), 0);
  const summary = kind === 'col' ? `${title}: ${fmt(total)} in all, at most ${fmt(peak)} in one period.` : `${title}: highest ${fmt(peak)}.`;
  const mid = Math.floor((n - 1) / 2);
  return html`<figure class="mchart">
    <figcaption><strong>${title}</strong>${note ? html`<span class="muted small">${note}</span>` : ''}</figcaption>
    <div class="mc-plot">
      <div class="mc-y" aria-hidden="true"><span>${compact(max)}</span><span>${compact(max / 2)}</span><span>0</span></div>
      <div class="mc-area" tabindex="0" role="img" aria-label="${summary} Use the arrow keys to read each period." data-points="${JSON.stringify(points.map((p) => [p.label, p.v == null ? 'No data' : fmt(p.v)]))}">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <line class="mc-grid" x1="0" x2="${W}" y1="0.5" y2="0.5" vector-effect="non-scaling-stroke"></line>
          <line class="mc-grid" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" vector-effect="non-scaling-stroke"></line>
          ${marks}
          <line class="mc-base" x1="0" x2="${W}" y1="${H - 0.5}" y2="${H - 0.5}" vector-effect="non-scaling-stroke"></line>
        </svg>
        <div class="mc-cross" hidden></div>
        <div class="mc-tip" hidden></div>
        ${has ? '' : html`<p class="mc-empty muted small">${empty}</p>`}
      </div>
    </div>
    <div class="mc-x" aria-hidden="true"><span>${points[0]?.short || ''}</span><span>${points[mid]?.short || ''}</span><span>${points.at(-1)?.short || ''}</span></div>
    <details class="mc-table"><summary>Show the numbers</summary>
      <div class="table-scroll"><table class="table"><thead><tr><th>Period</th><th class="num">${title}</th></tr></thead>
      <tbody>${[...points].reverse().map((p) => html`<tr><td>${p.label}</td><td class="num">${p.v == null ? '—' : fmt(p.v)}</td></tr>`)}</tbody></table></div>
    </details>
  </figure>`;
}

// The hover and keyboard readout. Values are put in with textContent.
export function wireCharts(root) {
  for (const area of root.querySelectorAll('.mc-area')) {
    let points = [];
    try {
      points = JSON.parse(area.dataset.points || '[]');
    } catch {}
    if (!points.length) continue;
    const tip = area.querySelector('.mc-tip');
    const cross = area.querySelector('.mc-cross');
    const bars = area.querySelectorAll('.mc-bar');
    let at = -1;
    const show = (i) => {
      at = Math.max(0, Math.min(points.length - 1, i));
      const [label, value] = points[at];
      tip.replaceChildren();
      const v = document.createElement('strong');
      v.textContent = value;
      const l = document.createElement('span');
      l.textContent = label;
      tip.append(v, l);
      const x = ((at + 0.5) / points.length) * 100;
      cross.style.left = `${x}%`;
      tip.style.left = `${x}%`;
      tip.classList.toggle('flip', x > 60);
      cross.hidden = false;
      tip.hidden = false;
      bars.forEach((b) => b.classList.toggle('on', Number(b.dataset.i) === at));
    };
    const hide = () => {
      cross.hidden = true;
      tip.hidden = true;
      bars.forEach((b) => b.classList.remove('on'));
    };
    area.addEventListener('pointermove', (e) => {
      const r = area.getBoundingClientRect();
      show(Math.floor(((e.clientX - r.left) / r.width) * points.length));
    });
    area.addEventListener('pointerleave', hide);
    area.addEventListener('blur', hide);
    area.addEventListener('focus', () => show(at < 0 ? points.length - 1 : at));
    area.addEventListener('keydown', (e) => {
      const step = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity }[e.key];
      if (step === undefined) return;
      e.preventDefault();
      show(Number.isFinite(step) ? at + step : step < 0 ? 0 : points.length - 1);
    });
  }
}

// A ranked bar beside a number in a table (one colour; the number carries the value).
export const rankBar = (v, max) => html`<span class="mc-rank" aria-hidden="true"><i style="width:${max ? Math.max(v ? 2 : 0, Math.round((v / max) * 100)) : 0}%"></i></span>`;
