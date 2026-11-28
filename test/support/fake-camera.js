// A camera picture for Chromium's fake camera (Scan QR, 0.75): a QR code of `text`, black on white in
// the middle of a 640 x 480 frame, as a YUV4MPEG2 (.y4m) file. Chromium plays it as the camera when
// started with --use-fake-ui-for-media-stream --use-fake-device-for-media-stream
// --use-file-for-fake-video-capture=<file> (it loops the frames). Used by scripts/journeys.mjs and
// scripts/guide-screenshots.mjs; Node's standard library only.
import fs from 'node:fs';
import { qrMatrix, QR_QUIET } from '../../server/customapp/qr.js';

export const FAKE_CAMERA_FLAGS = (file) => ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${file}`];

// lead: frames (a tenth of a second each) before the code is in place, with the code mostly outside
// the square the scanner reads (a phone still being aimed), for a screenshot of the scanner at work.
export function qrY4m(text, file, { width = 640, height = 480, frames = 2, fill = 0.78, lead = 0 } = {}) {
  const q = qrMatrix(text, { ecl: 'M' });
  const n = q.size + QR_QUIET * 2;
  const scale = Math.max(2, Math.floor((Math.min(width, height) * fill) / n));
  const side = n * scale;
  const picture = (ox, oy) => {
    // Luma: a light grey room (so the white quiet zone stands out a little), the code black on white.
    const Y = Buffer.alloc(width * height, 170);
    const put = (x, y, w, v) => {
      const a = Math.max(0, x);
      const b = Math.min(width, x + w);
      if (y >= 0 && y < height && b > a) Y.fill(v, y * width + a, y * width + b);
    };
    for (let y = 0; y < side; y++) put(ox, oy + y, side, 235);
    q.modules.forEach((row, my) => row.forEach((dark, mx) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++) put(ox + (mx + QR_QUIET) * scale, oy + (my + QR_QUIET) * scale + dy, scale, 16);
    }));
    const chroma = Buffer.alloc((width / 2) * (height / 2) * 2, 128); // U and V: no colour
    return Buffer.concat([Buffer.from('FRAME\n'), Y, chroma]);
  };
  const out = [Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C420jpeg\n`)];
  if (lead) {
    // Its right half beyond the right edge of the square shown (two finder patterns of three: unreadable).
    const aiming = picture(((width + Math.min(width, height)) >> 1) - Math.round(side * 0.52), ((height - side) >> 1) + 20);
    for (let i = 0; i < lead; i++) out.push(aiming);
  }
  const centred = picture((width - side) >> 1, (height - side) >> 1);
  for (let i = 0; i < frames; i++) out.push(centred);
  fs.writeFileSync(file, Buffer.concat(out));
  return file;
}
