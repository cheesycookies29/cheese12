// Scan QR (Corp Comm YEP tool, 0.75): reads a QR code in one camera frame with jsQR, off the page's
// own thread, so the screen stays smooth while the camera runs. A module worker of CORE's own (the
// Content-Security-Policy's 'self'). The page (customapp-scan.js) sends a downscaled square frame:
//   { id, width, height, data: ArrayBuffer (RGBA), invert: false | true }
// and gets back { id, text } (text null when no code was found). Every other frame is read inverted
// (light on dark: a phone in dark mode), inverted here: jsQR 1.4.0's own inversionAttempts
// 'onlyInvert' throws, and 'attemptBoth' reads every frame twice.
import jsQR from '../vendor/jsQR.js';

export function readFrame({ width, height, data, invert }) {
  const px = new Uint8ClampedArray(data);
  if (invert) for (let i = 0; i < px.length; i += 4) {
    px[i] = 255 - px[i];
    px[i + 1] = 255 - px[i + 1];
    px[i + 2] = 255 - px[i + 2];
  }
  try {
    const r = jsQR(px, width, height, { inversionAttempts: 'dontInvert' });
    return r && typeof r.data === 'string' && r.data ? r.data : null;
  } catch {
    return null;
  }
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = (e) => self.postMessage({ id: e.data?.id, text: readFrame(e.data || {}) });
}
