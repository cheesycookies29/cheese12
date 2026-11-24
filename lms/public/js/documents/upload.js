// Sending a file in pieces (ATLAS Documents and the upload page of a link): the server is told the
// name and size, then gets the file 4 MB at a time (one request each, tried again if the network
// drops), then checks the whole file. Shared by the Documents app and /share/<token>.
//
// request(method, url, body) → Promise of the JSON answer (throws an Error with .status).
// base: '/api/docs/uploads' or '/api/public/share/<token>/uploads'.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function readPiece(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('This file could not be read from your device.'));
    r.readAsDataURL(blob);
  });
}

export async function sendInPieces(file, { request, base, finish = {}, onProgress = () => {} }) {
  const { id, chunkBytes } = await request('POST', base, { name: file.name, size: file.size });
  let at = 0;
  try {
    while (at < file.size) {
      const data = await readPiece(file.slice(at, at + chunkBytes));
      for (let attempt = 1; ; attempt++) {
        try {
          const r = await request('PUT', `${base}/${id}`, { offset: at, data });
          at = r.received;
          break;
        } catch (err) {
          // The network or a busy server: try the same piece again, a little later each time.
          const retry = !err.status || err.status >= 500 || err.status === 429;
          if (!retry || attempt >= 4) throw err;
          await wait(attempt * 1500);
        }
      }
      onProgress(at / file.size);
    }
    onProgress(1);
    return await request('POST', `${base}/${id}/finish`, finish);
  } catch (err) {
    request('DELETE', `${base}/${id}`).catch(() => {});
    throw err;
  }
}
