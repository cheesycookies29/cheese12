// Profile pictures: everyone's small picture, shown instead of their initials wherever a person is.
// The list of who has one (and since when) is loaded once after sign-in and after a change; a
// picture's address carries its date, so the browser keeps it and fetches a new one only when it
// changes.
import { api } from './api.js';
import { ctx } from './state.js';
import { html, modal, toast } from './ui.js';

export const initials = (name) => String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';

export async function loadAvatars() {
  ctx.avatars = await api.get('/api/avatars').catch(() => ({}));
}
export const avatarSrc = (userId) => (userId && ctx.avatars?.[userId] ? `/api/users/${encodeURIComponent(userId)}/avatar?v=${encodeURIComponent(ctx.avatars[userId])}` : null);

// A person's avatar: their picture, or their initials. size: '' | 'xs' | 'lg'; title: shown on hover.
export function avatar(userId, name, { size = '', title = '', cls = '' } = {}) {
  const src = avatarSrc(userId);
  return src
    ? html`<span class="avatar ${size} pic ${cls}" ${title ? html`title="${title}"` : ''}><img src="${src}" alt="" loading="lazy" decoding="async" /></span>`
    : html`<span class="avatar ${size} ${cls}" ${title ? html`title="${title}"` : ''}>${initials(name)}</span>`;
}

// ----- Choosing your picture -----
const SIDE = 256; // pixels, square
const QUALITY = 0.86;

function readImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This picture could not be read. Choose a JPEG, PNG or WebP photo.'));
    img.src = url;
  });
}
// The middle square of the photo (or the part chosen with zoom and the sliders), 256 × 256.
function crop(img, { zoom = 1, x = 0.5, y = 0.5 } = {}) {
  const side = Math.min(img.naturalWidth, img.naturalHeight) / zoom;
  const sx = (img.naturalWidth - side) * x;
  const sy = (img.naturalHeight - side) * y;
  const c = Object.assign(document.createElement('canvas'), { width: SIDE, height: SIDE });
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, SIDE, SIDE);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, sx, sy, side, side, 0, 0, SIDE, SIDE);
  return c;
}
const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(new Error('The picture could not be read.'));
  r.readAsDataURL(blob);
});

// The dialog: choose a photo, frame it, save; or remove the current one. after(): the page updates.
export function editMyAvatar(after) {
  const u = ctx.user;
  const has = Boolean(ctx.avatars?.[u.id]);
  let img = null;
  const frame = { zoom: 1, x: 0.5, y: 0.5 };
  const { form, close } = modal({
    title: 'Profile picture', submitLabel: 'Save picture', className: 'avatar-dialog',
    subtitle: 'Shown next to your name for everyone in CORE: menus, lists, comments and projects.',
    body: html`<div class="avatar-edit">
      <div class="avatar-stage"><canvas width="${SIDE}" height="${SIDE}" aria-label="Your picture as others will see it" role="img"></canvas>
        <span class="avatar lg avatar-now">${has ? html`<img src="${avatarSrc(u.id)}" alt="" />` : initials(u.name)}</span></div>
      <div class="avatar-side">
        <label class="btn avatar-pick">Choose a photo…<input type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/*" class="sr-only" /></label>
        <small class="hint">A JPEG, PNG or WebP photo. CORE keeps a small square of it (${SIDE} × ${SIDE}).</small>
        <div class="avatar-frame" hidden>
          <label class="field"><span>Zoom</span><input type="range" name="zoom" min="1" max="3" step="0.05" value="1" /></label>
          <label class="field"><span>Left – right</span><input type="range" name="x" min="0" max="1" step="0.01" value="0.5" /></label>
          <label class="field"><span>Up – down</span><input type="range" name="y" min="0" max="1" step="0.01" value="0.5" /></label>
        </div>
        ${has ? html`<button type="button" class="btn danger ghost" id="avatar-remove">Remove my picture</button>` : ''}
      </div>
    </div>`,
    onSubmit: async () => {
      if (!img) throw new Error('Choose a photo first.');
      const canvas = crop(img, frame);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', QUALITY));
      const r = await api.put('/api/me/avatar', { file: { name: 'profile.jpg', data: await toBase64(blob) } });
      ctx.avatars = r.avatars;
      toast('Your picture is saved.');
      after?.();
    },
  });
  const canvas = form.querySelector('.avatar-stage canvas');
  const now = form.querySelector('.avatar-now');
  canvas.hidden = true;
  const draw = () => {
    if (!img) return;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, SIDE, SIDE);
    g.drawImage(crop(img, frame), 0, 0);
  };
  form.elements.photo.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      img = await readImage(file);
      Object.assign(frame, { zoom: 1, x: 0.5, y: 0.5 });
      ['zoom', 'x', 'y'].forEach((k) => (form.elements[k].value = frame[k]));
      canvas.hidden = false;
      now.hidden = true;
      form.querySelector('.avatar-frame').hidden = false;
      draw();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  for (const k of ['zoom', 'x', 'y']) form.elements[k].addEventListener('input', (e) => {
    frame[k] = Number(e.target.value);
    draw();
  });
  form.querySelector('#avatar-remove')?.addEventListener('click', async () => {
    try {
      const r = await api.del('/api/me/avatar');
      ctx.avatars = r.avatars;
      toast('Your picture is removed; your initials show instead.');
      close();
      after?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
