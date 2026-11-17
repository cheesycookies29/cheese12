// Profile pictures, after CORE ERP's (public/js/avatars.js at the repository root): a photo framed in
// the browser (zoom and position) to a 256 × 256 JPEG, sent to the server, which checks it by its
// content. Pictures replace initials wherever a person shows: the top bar, My profile, Users & Access.
import { api } from '../api.js';
import { html, modal, toast, initials } from '../ui.js';
import { icon } from '../icons.js';

export const AVATAR_MAX = 300 * 1024;
const SIDE = 256;

// Who has a picture, and when it changed ({ userId: at }), loaded once per page.
const state = { map: null, loading: null };
export async function loadAvatars(force = false) {
  if (state.map && !force) return state.map;
  if (!state.loading || force) state.loading = api.get('/api/avatars').then((m) => (state.map = m || {})).catch(() => (state.map = {}));
  return state.loading;
}
export const avatarAt = (userId) => state.map?.[userId] || null;
export function setAvatarAt(userId, at) {
  state.map = { ...(state.map || {}), [userId]: at };
  if (!at) delete state.map[userId];
  window.dispatchEvent(new CustomEvent('avatar:changed', { detail: { userId, at } }));
}
// The picture's address; the date makes the browser fetch it again when it changes.
export const avatarSrc = (userId, at) => `/api/users/${encodeURIComponent(userId)}/avatar?v=${encodeURIComponent(at)}`;
// A person's picture, or their initials. size: '' | 'sm' | 'lg' | 'xl'. at: given, or from the cache.
export function avatar(userId, name, { size = '', at = undefined } = {}) {
  const when = at === undefined ? avatarAt(userId) : at;
  return when
    ? html`<span class="avatar pic ${size}"><img src="${avatarSrc(userId, when)}" alt="" loading="lazy" /></span>`
    : html`<span class="avatar ${size}" aria-hidden="true">${initials(name || '?')}</span>`;
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not a picture this browser can open. Use a JPEG, PNG or WebP photo.'));
    };
    img.src = url;
  });
}
// The square part of the photo chosen with zoom (1–3) and position (0–1 across and down).
function draw(canvas, img, { zoom, x, y }) {
  const side = Math.min(img.naturalWidth, img.naturalHeight) / zoom;
  const sx = (img.naturalWidth - side) * x;
  const sy = (img.naturalHeight - side) * y;
  const c = canvas.getContext('2d');
  c.fillStyle = '#fff';
  c.fillRect(0, 0, SIDE, SIDE);
  c.drawImage(img, sx, sy, side, side, 0, 0, SIDE, SIDE);
}
// A JPEG under the limit (the quality is lowered until it fits).
function toJpeg(canvas) {
  for (const q of [0.86, 0.78, 0.7, 0.6, 0.5]) {
    const data = canvas.toDataURL('image/jpeg', q).split(',')[1];
    if (data.length * 0.75 <= AVATAR_MAX) return data;
  }
  return canvas.toDataURL('image/jpeg', 0.4).split(',')[1];
}

// The dialog: choose a photo, frame it, save; or remove the one you have.
// user: { id, name }; after(at): called with the new date (null when removed).
export function editMyAvatar(user, after = () => {}) {
  const has = Boolean(avatarAt(user.id));
  let img = null;
  const { form, close } = modal({
    title: has ? 'Change my picture' : 'Add my picture',
    subtitle: 'A photo of your face helps people know who they are working with. Everyone signed in to ATLAS can see it.',
    submitLabel: 'Save picture',
    className: 'avatar-dialog',
    body: html`<div class="avatar-edit">
      <div class="avatar-stage">
        <canvas width="${SIDE}" height="${SIDE}" class="avatar-frame" hidden aria-label="The framed picture"></canvas>
        <div class="avatar-now">${avatar(user.id, user.name, { size: 'xl' })}</div>
      </div>
      <div class="avatar-side">
        <label class="btn avatar-pick">${icon('image', 16)} Choose a photo<input type="file" accept="image/jpeg,image/png,image/webp" hidden /></label>
        <small class="muted">JPEG, PNG or WebP. It is cut to a square and made small (at most 300 KB) before it is sent.</small>
        <div class="avatar-sliders" hidden>
          <label class="field"><span>Zoom</span><input type="range" name="zoom" min="1" max="3" step="0.05" value="1" /></label>
          <label class="field"><span>Left and right</span><input type="range" name="x" min="0" max="1" step="0.01" value="0.5" /></label>
          <label class="field"><span>Up and down</span><input type="range" name="y" min="0" max="1" step="0.01" value="0.5" /></label>
        </div>
        ${has ? html`<button type="button" class="btn danger ghost" id="avatar-remove">${icon('trash', 16)} Remove my picture</button>` : ''}
      </div>
    </div>`,
    async onSubmit() {
      if (!img) throw new Error('Choose a photo first.');
      const { avatar: at } = await api.put('/api/me/avatar', { file: { name: 'profile.jpg', data: toJpeg(canvas) } });
      setAvatarAt(user.id, at);
      toast('Picture saved.');
      after(at);
    },
  });
  const canvas = form.querySelector('canvas');
  const sliders = form.querySelector('.avatar-sliders');
  const redraw = () => img && draw(canvas, img, { zoom: Number(form.zoom.value), x: Number(form.x.value), y: Number(form.y.value) });
  form.querySelector('input[type=file]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      img = await readImage(file);
    } catch (err) {
      return toast(err.message, 'error');
    }
    canvas.hidden = false;
    sliders.hidden = false;
    form.querySelector('.avatar-now').hidden = true;
    redraw();
  });
  sliders.addEventListener('input', redraw);
  form.querySelector('#avatar-remove')?.addEventListener('click', async () => {
    try {
      await api.del('/api/me/avatar');
      setAvatarAt(user.id, null);
      toast('Picture removed.');
      close();
      after(null);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
