// Two numbers for event-day load tests (0.74.3, US-028: AC-187 and AC-188), read by
// scripts/event-load.mjs from GET /api/admin/perf (Security monitor permission, never audited):
//  - how long each db.save() takes (JSON.stringify, write, rename): the last 4,096, with when, in two
//    fixed arrays (a save writes two numbers: no measurable cost);
//  - the event loop's delay, from Node's own monitorEventLoopDelay (one 20 ms timer in libuv for the
//    whole process, shared by every CORE in it), summed every 10 seconds into a window and reset, the
//    last hour of windows kept.
// The Security monitor's per-minute "Responsiveness" check has its own histogram (server/monitor.js),
// so neither resets the other.
import { monitorEventLoopDelay } from 'node:perf_hooks';

export const PERF = Object.freeze({ saves: 4096, windowMs: 10000, windows: 360, resolutionMs: 20 });

// ----- The event loop: one histogram and one ring of 10-second windows per process -----
let loop = null;
function loopState(now) {
  if (loop) return loop;
  const h = monitorEventLoopDelay({ resolution: PERF.resolutionMs });
  h.enable();
  loop = { h, windows: [], start: now() };
  const timer = setInterval(() => rotate(now()), PERF.windowMs);
  timer.unref?.();
  return loop;
}
// A recorded value is the time between two of the timer's turns, so an idle loop records about the
// resolution: the delay is what is over it (as Node's own documentation describes the histogram).
const delayMs = (ns) => Math.max(0, ns / 1e6 - PERF.resolutionMs);
// The percentiles kept of each window, to merge windows into one distribution later: every 1% up
// to 98, then finer in the tail where p99 is read.
const GRID = [0.001, ...Array.from({ length: 98 }, (_, i) => i + 1), 98.5, 99, 99.1, 99.2, 99.3, 99.4, 99.5, 99.6, 99.7, 99.8, 99.9, 99.99, 100];
function windowOf(h, start, end) {
  if (!h.count) return { t: start, end, count: 0, p50: 0, p99: 0, max: 0, cdf: [] };
  const cdf = GRID.map((p) => [p, round(delayMs(h.percentile(p)))]);
  return { t: start, end, count: h.count, p50: round(delayMs(h.percentile(50))), p99: round(delayMs(h.percentile(99))), max: round(delayMs(h.max)), cdf };
}
function rotate(t) {
  const s = loop;
  s.windows.push(windowOf(s.h, s.start, t));
  if (s.windows.length > PERF.windows) s.windows.splice(0, s.windows.length - PERF.windows);
  s.h.reset();
  s.start = t;
}
const round = (x) => Math.round(x * 10) / 10;

// A percentile of several windows taken together: the smallest delay at or under which p% of all
// their samples fall (each window's distribution read from its percentile points; at worst one grid
// step high, never low).
export function mergedPercentile(windows, p) {
  const list = windows.filter((w) => w.count > 0 && w.cdf?.length);
  const total = list.reduce((n, w) => n + w.count, 0);
  if (!total) return 0;
  const below = (w, v) => {
    let f = 0;
    for (const [pct, ms] of w.cdf) if (ms <= v) f = Math.max(f, pct / 100);
    return f;
  };
  const values = [...new Set(list.flatMap((w) => w.cdf.map(([, ms]) => ms)))].sort((a, b) => a - b);
  for (const v of values) if (list.reduce((n, w) => n + w.count * below(w, v), 0) >= (p / 100) * total - 1e-9) return v;
  return values.at(-1);
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

// One per CORE (createApi): its own saves; the loop is the process's.
export function createPerf({ now = () => Date.now() } = {}) {
  const at = new Float64Array(PERF.saves);
  const ms = new Float64Array(PERF.saves);
  let n = 0;
  const startedAt = now();
  loopState(now);
  return {
    // db.onSaved: one save took `took` milliseconds.
    recordSave(took) {
      const i = n % PERF.saves;
      at[i] = now();
      ms[i] = took;
      n += 1;
    },
    // What happened since `since` (ms since 1970; default: everything kept).
    snapshot({ since = 0 } = {}) {
      const t = now();
      const kept = Math.min(n, PERF.saves);
      const xs = [];
      for (let k = 0; k < kept; k++) {
        const i = (n - 1 - k) % PERF.saves;
        if (at[i] >= since) xs.push(ms[i]);
      }
      xs.sort((a, b) => a - b);
      const s = loopState(now);
      const windows = [...s.windows.filter((w) => w.end > since), { ...windowOf(s.h, s.start, t), current: true }];
      const mem = process.memoryUsage();
      return {
        now: t, startedAt, since,
        save: { total: n, count: xs.length, p50: round(pct(xs, 50)), p95: round(pct(xs, 95)), p99: round(pct(xs, 99)), max: round(xs.at(-1) || 0), mean: round(xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0), keptFrom: kept ? at[(n - kept) % PERF.saves] : null },
        loop: {
          resolutionMs: PERF.resolutionMs, windowMs: PERF.windowMs, count: windows.reduce((c, w) => c + w.count, 0),
          p50: mergedPercentile(windows, 50), p99: mergedPercentile(windows, 99), max: Math.max(0, ...windows.map((w) => w.max)),
          worstWindowP99: Math.max(0, ...windows.map((w) => w.p99)),
          windows: windows.map(({ cdf, ...w }) => w),
        },
        memory: { rss: mem.rss, heapUsed: mem.heapUsed },
      };
    },
  };
}
