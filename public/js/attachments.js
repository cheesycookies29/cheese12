// Attaching and viewing files (medical certificates). Photos are shrunk in the browser
// before upload, so a phone picture of a certificate stays well under the size limit.
import { api } from './api.js';
import { html, modal } from './ui.js';
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from '/shared/leave.js';
import { PM_FILE_TYPES, PM_FILE_EXTS, MAX_PM_FILE_BYTES } from '/shared/files.js';

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

// A contract's document (0.43): PDF, a photo or scan (large photos shrink to JPEG), Word or Excel.
export const DOC_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.docx,.xlsx,application/pdf,image/*,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export async function prepareDocument(file, { types, maxBytes }) {
  let blob = file;
  let name = file.name;
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  if (file.type.startsWith('image/') && (file.size > 2 * 1024 * 1024 || !types[file.type])) ({ blob, name } = await shrink(file));
  else if (!types[file.type] && !['pdf', 'docx', 'xlsx'].includes(ext)) throw new Error(`${name}: add a PDF, a photo or scan, a Word document (.docx) or an Excel workbook (.xlsx).`);
  if (blob.size > maxBytes) throw new Error(`${name} is too large (${sizeLabel(blob.size)}). The limit is ${sizeLabel(maxBytes)}.`);
  return { name, data: await toBase64(blob) };
}

// A file for a project's task or milestone (0.56): the kinds in shared/files.js. Large photos shrink
// to a JPEG (as does a HEIC from an iPhone); a GIF stays as it is. The server checks the contents.
export const PM_ACCEPT = `${PM_FILE_EXTS.map((x) => `.${x}`).join(',')},${Object.keys(PM_FILE_TYPES).join(',')},image/*`;
export async function preparePmFile(file) {
  let blob = file;
  let name = file.name;
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  if (file.type.startsWith('image/') && file.type !== 'image/gif' && (file.size > 2 * 1024 * 1024 || !PM_FILE_TYPES[file.type])) ({ blob, name } = await shrink(file));
  else if (!PM_FILE_EXTS.includes(ext) && !PM_FILE_TYPES[file.type]) throw new Error('this kind of file is not taken (a PDF, photo, Word, Excel, PowerPoint, OpenDocument, text or CSV file is)');
  if (blob.size > MAX_PM_FILE_BYTES) throw new Error(`too large (${sizeLabel(blob.size)}); the limit is ${sizeLabel(MAX_PM_FILE_BYTES)}`);
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
