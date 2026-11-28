// Scan QR (Corp Comm YEP tool, 0.75): event staff point their phone at the QR code in a guest's
// invitation, inside CORE, and the guest's sheet opens (check in, and seat as their scope allows).
// The guest's personal page never opens in the usher's browser, and no link stays in its history.
//
// The camera: getUserMedia with the back camera, shown in a square with a viewfinder; a torch button
// where the camera has one, a switch button where there are several cameras. About 10 frames a
// second, cropped to the square shown and made at most 480 pixels, are read by the browser's own
// BarcodeDetector (Android Chrome) or, elsewhere (iPhone Safari has none), by jsQR in a worker
// (customapp-scan-worker.js; on the page itself if a worker cannot start). The camera stops as soon
// as a code is read, the dialog closes, the page changes or is hidden.
//
// The text read goes to POST /api/customapp/events/:id/scan, which finds the guest by the link's
// token (only its hash is compared) or says plainly why not; nothing about the guest is decided here.
import { api } from '../api.js';
import { html, mount, modal } from '../ui.js';
import { icon } from '../icons.js';

const KEEP = 'core-ca-scan-keep';
const FRAME_MS = 100; // about 10 frames a second, less while a frame is being read
const SIDE = 480; // frames are read at most 480 x 480

const keepOn = () => {
  try {
    return localStorage.getItem(KEEP) === '1';
  } catch {
    return false;
  }
};
const setKeep = (on) => {
  try {
    localStorage.setItem(KEEP, on ? '1' : '0');
  } catch {}
};

// What to tell the person when the camera cannot start, in plain words: { kind, title, text }.
export function cameraProblem(err) {
  const name = err?.name || '';
  if (name === 'insecure') return { kind: 'insecure', title: 'The camera needs a secure address', text: html`<p>Phones only let a page use the camera when it is opened over <strong>https://</strong> (with the padlock). Open CORE at its https:// address, then try again.</p>` };
  if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(name)) {
    return {
      kind: 'denied', title: 'The camera is blocked for CORE',
      text: html`<p>Allow the camera for this site, then tap <strong>Try again</strong>:</p>
        <ul><li><strong>iPhone (Safari):</strong> tap <strong>aA</strong> in the address bar → <strong>Website Settings</strong> → <strong>Camera</strong> → <strong>Allow</strong>. If it stays blocked: <strong>Settings → Safari → Camera → Allow</strong>.</li>
        <li><strong>Android (Chrome):</strong> tap the icon left of the address → <strong>Permissions</strong> (or <strong>Site settings</strong>) → <strong>Camera</strong> → <strong>Allow</strong>.</li></ul>`,
    };
  }
  if (['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'].includes(name) || name === 'nocamera') return { kind: 'none', title: 'No camera found', text: html`<p>This device has no camera CORE can use. Scan with a phone instead.</p>` };
  if (['NotReadableError', 'TrackStartError', 'AbortError'].includes(name)) return { kind: 'busy', title: 'The camera is busy', text: html`<p>Another app or tab is using the camera (a video call, the camera app). Close it, then tap <strong>Try again</strong>.</p>` };
  return { kind: 'other', title: 'The camera did not start', text: html`<p>${err?.message || 'Something stopped it.'} Tap <strong>Try again</strong>.</p>` };
}

// The square of the frame that the screen shows (the video fills a square, cropped in the middle).
export const centreSquare = (w, h) => {
  const s = Math.min(w, h);
  return { sx: Math.floor((w - s) / 2), sy: Math.floor((h - s) / 2), s };
};

// The decoders: each is { kind, read(canvas, ctx) → Promise<text | null>, close() }.
async function nativeDecoder() {
  if (typeof window.BarcodeDetector !== 'function') return null;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    if (!formats.includes('qr_code')) return null;
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    return { kind: 'native', read: async (canvas) => (await detector.detect(canvas))[0]?.rawValue || null, close() {} };
  } catch {
    return null;
  }
}
function workerDecoder() {
  let worker;
  try {
    worker = new Worker(new URL('./customapp-scan-worker.js', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  let n = 0;
  const waiting = new Map(); // id → resolve
  let broken = false;
  worker.onmessage = (e) => {
    waiting.get(e.data?.id)?.(e.data?.text || null);
    waiting.delete(e.data?.id);
  };
  worker.onerror = () => {
    broken = true;
    for (const r of waiting.values()) r(null);
    waiting.clear();
  };
  return {
    kind: 'worker',
    get broken() {
      return broken;
    },
    read: (canvas, ctx) => new Promise((resolve) => {
      if (broken) return resolve(null);
      const id = ++n;
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      waiting.set(id, resolve);
      // A worker that never answers (it failed to load) counts as broken after 4 seconds.
      setTimeout(() => {
        if (!waiting.has(id)) return;
        waiting.delete(id);
        broken = true;
        resolve(null);
      }, 4000);
      worker.postMessage({ id, width: img.width, height: img.height, data: img.data.buffer, invert: id % 2 === 0 }, [img.data.buffer]);
    }),
    close: () => worker.terminate(),
  };
}
async function pageDecoder() {
  const { readFrame } = await import('./customapp-scan-worker.js');
  let n = 0;
  return {
    kind: 'page',
    read: async (canvas, ctx) => {
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return readFrame({ width: img.width, height: img.height, data: img.data.buffer, invert: ++n % 2 === 0 });
    },
    close() {},
  };
}

// opts: { onFound({ guestId, guest, notice }, keep), onFind() } — onFind: the person chose to type
// the name instead (the scanner is closed first).
export function openScanner(eventId, { onFound, onFind } = {}) {
  let stream = null;
  let timer = 0;
  let running = false; // frames are being read
  let decoder = null;
  let deviceIds = [];
  let deviceAt = 0;
  let torchOn = false;
  let wantRunning = true; // false once a code was read or a problem shown (until Try again)
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const { form, close } = modal({
    title: 'Scan QR', subtitle: 'The QR code in the guest\'s invitation: on paper, or on their phone at full brightness.', submitLabel: null, className: 'ca-scan',
    body: html`<div class="ca-scan-body" data-decoder="">
      <div class="ca-scan-view" data-view>
        <video playsinline muted autoplay disablepictureinpicture aria-hidden="true"></video>
        <div class="ca-scan-frame" aria-hidden="true"></div>
      </div>
      <div class="ca-scan-msg" data-msg role="status" aria-live="polite"><p>Starting the camera…</p></div>
      <div class="ca-scan-tools">
        <button type="button" class="btn" data-torch hidden aria-pressed="false">${icon('flashlight', 16)} Light</button>
        <button type="button" class="btn" data-switch hidden>${icon('repeat', 16)} Switch camera</button>
        <button type="button" class="btn primary" data-again hidden>${icon('camera', 16)} Scan again</button>
      </div>
      <label class="field check ca-scan-keep"><input type="checkbox" data-keep ${keepOn() ? 'checked' : ''} /> <span>Keep scanning: after <strong>Check in</strong>, the scanner opens again (for the door)</span></label>
      <p class="muted small ca-scan-alt">No QR code, or it will not read? <button type="button" class="link-btn" data-find>Type the name in Find guest</button></p>
    </div>`,
    onClose: () => shutDown(),
  });
  const body = form.querySelector('.ca-scan-body');
  const video = form.querySelector('video');
  const msg = form.querySelector('[data-msg]');
  const btn = (k) => form.querySelector(`[data-${k}]`);
  const say = (content, alert = false) => {
    msg.setAttribute('role', alert ? 'alert' : 'status');
    mount(msg, content);
  };

  function stopCamera() {
    running = false;
    clearTimeout(timer);
    for (const t of stream?.getTracks() || []) t.stop();
    stream = null;
    video.srcObject = null;
    torchOn = false;
    btn('torch').hidden = true;
  }
  function shutDown() {
    wantRunning = false;
    stopCamera();
    decoder?.close();
    decoder = null;
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('hashchange', shutDown);
    window.removeEventListener('pagehide', stopCamera);
  }
  // Hidden (another app, the screen locked): the camera stops; back on the page, it starts again.
  function onVisible() {
    if (!form.isConnected) return shutDown();
    if (document.hidden) stopCamera();
    else if (wantRunning && !stream) start();
  }
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('hashchange', shutDown);
  window.addEventListener('pagehide', stopCamera);

  function problem(err) {
    stopCamera();
    wantRunning = false;
    const p = cameraProblem(err);
    body.dataset.problem = p.kind;
    say(html`<div class="ca-notice ca-scan-problem">${icon('alert', 16)}<div><p><strong>${p.title}</strong></p>${p.text}<p>Meanwhile, type the guest's name in <strong>Find guest</strong>.</p></div></div>`, true);
    btn('again').hidden = p.kind === 'insecure' || p.kind === 'none';
    mount(btn('again'), html`${icon('camera', 16)} Try again`);
    btn('again').focus();
  }

  // Each start has its number: a start or a frame loop that is no longer the latest stops by itself.
  let starts = 0;
  async function start() {
    if (!form.isConnected) return shutDown();
    const gen = ++starts;
    wantRunning = true;
    btn('again').hidden = true;
    delete body.dataset.problem;
    say(html`<p>Starting the camera…</p>`);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return problem({ name: 'insecure' });
    stopCamera();
    let mine;
    try {
      const pick = deviceIds.length ? { deviceId: { exact: deviceIds[deviceAt] } } : { facingMode: 'environment' };
      mine = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...pick, width: { ideal: 1280 }, height: { ideal: 720 } } });
    } catch (err) {
      if (gen === starts && form.isConnected) problem(err);
      return;
    }
    // Closed, hidden, a code read or started again while the camera was starting: let it go at once.
    const over = () => gen !== starts || !form.isConnected || !wantRunning || document.hidden;
    if (over()) {
      for (const t of mine.getTracks()) t.stop();
      if (!form.isConnected) shutDown();
      return;
    }
    stream = mine;
    video.srcObject = mine;
    try {
      await video.play();
    } catch {}
    if (over() || stream !== mine) return;
    const track = mine.getVideoTracks()[0];
    const caps = track?.getCapabilities?.() || {};
    btn('torch').hidden = !caps.torch;
    btn('torch').setAttribute('aria-pressed', 'false');
    // The cameras there are (their names are known once the camera is allowed).
    try {
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId);
      deviceIds = cams.map((d) => d.deviceId);
      const now = track?.getSettings?.().deviceId;
      if (now && deviceIds.includes(now)) deviceAt = deviceIds.indexOf(now);
      btn('switch').hidden = deviceIds.length < 2;
    } catch {}
    if (!decoder) decoder = (await nativeDecoder()) || workerDecoder() || (await pageDecoder());
    if (over() || stream !== mine) return;
    body.dataset.decoder = decoder.kind;
    say(html`<p>Hold the QR code inside the square.</p>`);
    running = true;
    tick(gen);
  }

  async function tick(gen) {
    if (!running || gen !== starts) return;
    if (!form.isConnected) return shutDown();
    if (video.readyState >= 2 && video.videoWidth) {
      const { sx, sy, s } = centreSquare(video.videoWidth, video.videoHeight);
      const side = Math.min(SIDE, s);
      if (canvas.width !== side) canvas.width = canvas.height = side;
      ctx.drawImage(video, sx, sy, s, s, 0, 0, side, side);
      let text = null;
      try {
        text = await decoder.read(canvas, ctx);
      } catch {
        text = null;
      }
      // The worker did not load (an older phone): read on the page instead.
      if (decoder?.broken) {
        decoder.close();
        decoder = await pageDecoder();
        body.dataset.decoder = decoder.kind;
      }
      if (!running || gen !== starts) return;
      if (text) return found(text);
    }
    timer = setTimeout(() => tick(gen), FRAME_MS);
  }

  async function found(text) {
    wantRunning = false;
    stopCamera();
    try {
      navigator.vibrate?.(60);
    } catch {}
    say(html`<p>Read. Looking for the guest…</p>`);
    try {
      const r = await api.post(`/api/customapp/events/${eventId}/scan`, { text });
      if (!form.isConnected) return;
      if (r.found) {
        close();
        return onFound?.(r, btn('keep').checked);
      }
      say(html`<div class="ca-notice">${icon('alert', 16)}<p>${r.message}</p></div>`, true);
    } catch (err) {
      if (!form.isConnected) return;
      say(html`<div class="ca-notice">${icon('alert', 16)}<p>${err.message}</p></div>`, true);
    }
    mount(btn('again'), html`${icon('camera', 16)} Scan again`);
    btn('again').hidden = false;
    btn('again').focus();
  }

  btn('again').addEventListener('click', () => start());
  btn('keep').addEventListener('change', (e) => setKeep(e.target.checked));
  btn('find').addEventListener('click', () => {
    close();
    onFind?.();
  });
  btn('switch').addEventListener('click', () => {
    if (deviceIds.length < 2) return;
    deviceAt = (deviceAt + 1) % deviceIds.length;
    start();
  });
  btn('torch').addEventListener('click', async () => {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      torchOn = !torchOn;
      btn('torch').setAttribute('aria-pressed', String(torchOn));
    } catch {
      btn('torch').hidden = true;
    }
  });
  start();
  return close;
}

// The Scan QR button, the same on Find guest and My queue; `fab` adds the round one for the thumb on
// a phone (bottom right, shown on narrow screens only).
export const scanButton = ({ fab = false } = {}) => html`<button type="button" class="btn ca-scan-btn" data-scan>${icon('camera', 18)} Scan QR</button>${fab ? html`<button type="button" class="ca-scan-fab" data-scan aria-label="Scan QR">${icon('camera', 24)}<span>Scan QR</span></button>` : ''}`;
