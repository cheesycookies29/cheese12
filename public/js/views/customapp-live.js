// CUSTOM APP → Events: live updates for the staff screens (US-019), by short poll. The screen asks
// GET …/changes?since=<seq> and the server answers at once: "unchanged" (a few bytes), or the board.
// The server says how long to wait before asking again (pollMs, about 2 s for staff, more under
// load). The poll pauses while the tab is hidden and asks at once when it is shown again; offline,
// it waits longer each time. The sticky bar says how old the screen is ("Last updated 2 s ago")
// and, after 15 seconds without an answer, turns amber and says "Reconnecting…".
import { api } from '../api.js';

export const STALE_MS = 15000;

// url: the changes address without since; onBoard(board, reply): a new board; bar: the element
// whose text and class show the age. Returns { stop, now (ask at once), seq () }.
export function livePoll(url, { onBoard, bar = null, initialSeq = null }) {
  let seq = initialSeq;
  let timer = 0;
  let tick = 0;
  let stopped = false;
  let lastOk = Date.now();
  let wait = 2000;
  let failures = 0;
  const sep = url.includes('?') ? '&' : '?';
  const showAge = () => {
    if (!bar || !bar.isConnected) return;
    const age = Math.round((Date.now() - lastOk) / 1000);
    const stale = Date.now() - lastOk >= STALE_MS;
    bar.classList.toggle('stale', stale);
    const text = stale ? 'Reconnecting…' : `Last updated ${age < 1 ? 'just now' : `${age} s ago`}`;
    const el = bar.querySelector('[data-age]') || bar;
    if (el.textContent !== text) el.textContent = text;
  };
  const schedule = (ms) => {
    clearTimeout(timer);
    if (stopped || document.hidden) return;
    timer = setTimeout(ask, ms);
  };
  async function ask() {
    if (stopped || document.hidden) return;
    try {
      const r = await api.get(`${url}${seq != null ? `${sep}since=${seq}` : ''}`);
      if (stopped) return;
      lastOk = Date.now();
      failures = 0;
      wait = r.pollMs || 2000;
      if (!r.unchanged) {
        seq = r.seq;
        await onBoard(r.board, r);
      }
      showAge();
      schedule(wait);
    } catch (err) {
      if (stopped) return;
      // A refusal (the account was taken off the event) stops; a lost connection tries again, slower.
      if (err.status && err.status !== 503 && err.status < 500 && err.status !== 429) {
        stopped = true;
        return onBoard(null, { error: err });
      }
      failures += 1;
      showAge();
      schedule(Math.min(30000, wait * 2 ** Math.min(failures, 4)));
    }
  }
  const onVisible = () => {
    if (document.hidden) clearTimeout(timer);
    else ask();
  };
  const onOnline = () => ask();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  tick = setInterval(showAge, 1000);
  ask();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    },
    now: () => ask(),
    seq: () => seq,
    // After this screen's own change: the next answer is the board as it is now.
    reset() {
      seq = null;
      ask();
    },
  };
}
