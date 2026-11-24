// A file sent in pieces, as PDF Studio does (0.66): each piece is one request, sent again on its own if
// the line drops, and sized to the line (smaller on a slow one, so no request runs long). Used by
// Documents (signed in) and by the public share page (upload links), which only differ in their address.
//
// uploadInPieces(base, blob, name, onProgress(0…1)) → the upload's id, for `${base}/${id}/finish`.
import { api } from './api.js';

const readBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('The file could not be read.'));
  r.readAsDataURL(blob);
});
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export async function uploadInPieces(base, blob, name, onProgress = () => {}) {
  const { id, chunkBytes } = await api.post(base, { name, size: blob.size });
  let size = Math.min(chunkBytes, 1024 * 1024);
  let offset = 0;
  try {
    while (offset < blob.size) {
      const data = await readBase64(blob.slice(offset, Math.min(blob.size, offset + size)));
      const t0 = performance.now();
      let r = null;
      for (let attempt = 0; ; attempt++) {
        try {
          r = await api.put(`${base}/${id}`, { offset, data });
          break;
        } catch (err) {
          // The line dropped or the server was busy: wait and send the same piece again.
          if (attempt >= 4 || (err.status && err.status < 500 && err.status !== 408 && err.status !== 429)) throw err;
          await pause([1000, 3000, 6000, 12000][attempt]);
        }
      }
      offset = r.received;
      onProgress(offset / blob.size);
      const secs = (performance.now() - t0) / 1000;
      if (secs < 4 && size < chunkBytes) size = Math.min(chunkBytes, size * 2);
      else if (secs > 20 && size > 256 * 1024) size = Math.max(256 * 1024, Math.floor(size / 2));
    }
  } catch (err) {
    api.del(`${base}/${id}`).catch(() => {});
    throw err;
  }
  return id;
}

export const sizeText = (n) => (!n ? '0 KB' : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
