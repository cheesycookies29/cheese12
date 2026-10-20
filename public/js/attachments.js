// Attaching and viewing files (medical certificates). Photos are shrunk in the browser
// before upload, so a phone picture of a certificate stays well under the size limit.
import { api } from './api.js';
import { html, modal } from './ui.js';
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from '/shared/leave.js';

const MAX_SIDE = 2000;
export const ACCEPT = 'application/pdf,image/*';
export const sizeLabel = (bytes) => (bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`);

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This photo could not be read. Save it as JPEG or PNG (or take a screenshot of it) and try again.'));
    img.src = url;
  });
}

async function shrink(file) {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale) });
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  return { blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
}

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(new Error('The file could not be read. Please choose it again.'));
  r.readAsDataURL(blob);
});

// File from an <input type=file> -> { name, data } for the API, or throws a message for the form.
export async function prepareUpload(file) {
  let blob = file;
  let name = file.name;
  // Large photos, and formats the server doesn't take (e.g. HEIC from iPhones), become a JPEG.
  if (file.type.startsWith('image/') && (file.size > 1024 * 1024 || !ATTACHMENT_TYPES[file.type])) ({ blob, name } = await shrink(file));
  else if (!ATTACHMENT_TYPES[file.type]) throw new Error('Attach a PDF or a photo (JPEG, PNG or WebP).');
  if (blob.size > MAX_ATTACHMENT_BYTES) throw new Error(`The file is too large (${sizeLabel(blob.size)}). The limit is ${sizeLabel(MAX_ATTACHMENT_BYTES)}; scan it at a lower resolution.`);
  return { name, data: await toBase64(blob) };
}

// Fetches a stored file and shows it in a window with a Download button.
export async function viewAttachment(url, title = 'Medical certificate') {
  const file = await api.get(url);
  const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
  const src = URL.createObjectURL(new Blob([bytes], { type: file.type }));
  const { form } = modal({
    title,
    wide: true,
    submitLabel: 'Download',
    body: html`<p class="muted small">${file.name} · ${ATTACHMENT_TYPES[file.type] || file.type} · ${sizeLabel(file.size)}</p>
      ${file.type === 'application/pdf' ? html`<iframe class="att-preview" src="${src}" title="${file.name}"></iframe>` : html`<img class="att-preview" src="${src}" alt="${file.name}" />`}`,
    onSubmit: () => Object.assign(document.createElement('a'), { href: src, download: file.name }).click(),
  });
  form.querySelector('footer [data-close]').textContent = 'Close';
  new MutationObserver((_, obs) => {
    if (!document.body.contains(form)) obs.disconnect(), setTimeout(() => URL.revokeObjectURL(src), 1000);
  }).observe(document.body, { childList: true });
}
