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
    ? html`<span class="avatar ${size} pic ${cls}" ${title ? html`title="${title}"` : ''}><img src="${src}" alt="" loading="lazy" decoding="async" data-anim /></span>`
    : html`<span class="avatar ${size} ${cls}" ${title ? html`title="${title}"` : ''}>${initials(name)}</span>`;
}

// ----- Animated pictures -----
// A profile picture or a project's icon can be an animated GIF. For those who ask their device for
// less motion, each picture shows as its first frame instead (drawn once, kept for the page's life).
const lessMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const stills = new Map();
function holdStill(img) {
  const src = img.currentSrc || img.src;
  if (!src || /^(data|blob):/.test(src) || img.dataset.still) return;
  let still = stills.get(src);
  if (!still) {
    try {
      const side = Math.min(256, Math.max(img.naturalWidth, img.naturalHeight)) || 1;
      const k = side / Math.max(img.naturalWidth, img.naturalHeight, 1);
      const c = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(img.naturalWidth * k)), height: Math.max(1, Math.round(img.naturalHeight * k)) });
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      still = c.toDataURL('image/png');
    } catch {
      return;
    }
    stills.set(src, still);
  }
  img.dataset.still = src;
  img.src = still;
}
if (typeof document !== 'undefined') {
  document.addEventListener('load', (e) => {
    const img = e.target;
    if (lessMotion?.matches && img?.tagName === 'IMG' && img.dataset.anim != null && !img.dataset.still) holdStill(img);
  }, true);
}

// A GIF (by its first bytes, not its name): kept as it is, so it moves.
export const GIF_MAX = 1024 * 1024;
export async function isGif(file) {
  const head = new Uint8Array(await file.slice(0, 6).arrayBuffer());
  return /^GIF8[79]a$/.test(String.fromCharCode(...head));
}
export function gifCheck(file) {
  if (file.size > GIF_MAX) throw new Error(`This GIF is ${(file.size / 1048576).toFixed(1)} MB. The limit is 1 MB: use a shorter or smaller one.`);
}

// ----- Choosing your picture -----
const SIDE = 256; // pixels, square
const QUALITY = 0.86;

function readImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This picture could not be read. Choose a JPEG, PNG or WebP photo, or a GIF.'));
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
  let gif = null; // an animated GIF, sent as it is
  const frame = { zoom: 1, x: 0.5, y: 0.5 };
  const { form, close } = modal({
    title: 'Profile picture', submitLabel: 'Save picture', className: 'avatar-dialog',
    subtitle: 'Shown next to your name for everyone in CORE: menus, lists, comments and projects.',
    body: html`<div class="avatar-edit">
      <div class="avatar-stage"><canvas width="${SIDE}" height="${SIDE}" aria-label="Your picture as others will see it" role="img"></canvas>
        <span class="avatar lg avatar-gif" hidden><img alt="Your GIF as others will see it" /></span>
        <span class="avatar lg avatar-now">${has ? html`<img src="${avatarSrc(u.id)}" alt="" data-anim />` : initials(u.name)}</span></div>
      <div class="avatar-side">
        <label class="btn avatar-pick">Choose a photo or GIF…<input type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/gif,image/*" class="sr-only" /></label>
        <small class="hint">A JPEG, PNG or WebP photo: CORE keeps a small square of it (${SIDE} × ${SIDE}). Or an animated GIF, up to 1 MB: it is kept as it is, and shows its middle in the circle.</small>
        <div class="avatar-frame" hidden>
          <label class="field"><span>Zoom</span><input type="range" name="zoom" min="1" max="3" step="0.05" value="1" /></label>
          <label class="field"><span>Left – right</span><input type="range" name="x" min="0" max="1" step="0.01" value="0.5" /></label>
          <label class="field"><span>Up – down</span><input type="range" name="y" min="0" max="1" step="0.01" value="0.5" /></label>
        </div>
        ${has ? html`<button type="button" class="btn danger ghost" id="avatar-remove">Remove my picture</button>` : ''}
      </div>
    </div>`,
    onSubmit: async () => {
      if (!img && !gif) throw new Error('Choose a photo first.');
      let file;
      if (gif) file = { name: 'profile.gif', data: await toBase64(gif) };
      else {
        const canvas = crop(img, frame);
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', QUALITY));
        file = { name: 'profile.jpg', data: await toBase64(blob) };
      }
      const r = await api.put('/api/me/avatar', { file });
      ctx.avatars = r.avatars;
      toast('Your picture is saved.');
      after?.();
    },
  });
  const canvas = form.querySelector('.avatar-stage canvas');
  const now = form.querySelector('.avatar-now');
  const gifBox = form.querySelector('.avatar-gif');
  let gifUrl = null;
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
      if (await isGif(file)) {
        // Animated: no framing (that would stop it); the circle shows its middle.
        gifCheck(file);
        await readImage(file);
        gif = file;
        img = null;
        if (gifUrl) URL.revokeObjectURL(gifUrl);
        gifUrl = URL.createObjectURL(file);
        gifBox.querySelector('img').src = gifUrl;
        gifBox.hidden = false;
        canvas.hidden = true;
        now.hidden = true;
        form.querySelector('.avatar-frame').hidden = true;
        return;
      }
      img = await readImage(file);
      gif = null;
      gifBox.hidden = true;
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
