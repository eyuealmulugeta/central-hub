// v0.26.0: a signature, drawn full screen (Clear, Apply) or chosen as a PNG. Each person's own signature is kept for
// them on every device (prefs/<email>), so the Project Engineer or General Manager signs "Checked by" once and it is
// used on every report they approve. The overlay is plain DOM above the page, so a redraw of the page does not wipe it.
import { prefs } from '../core/prefs.js';

const KEY = 'sf:mysig';
const MAX_W = 600, MAX_H = 220;

/** The signed-in person's saved signature (a PNG data URL), or ''. */
export const mySignature = () => { const v = prefs.get(KEY); return typeof v === 'string' && v.startsWith('data:image/png') ? v : ''; };
export const saveSignature = png => prefs.set(KEY, png);

/** The ink, cut to its edges and scaled to fit MAX_W x MAX_H. '' when nothing was drawn. */
function trimmed(canvas) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const px = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return '';
  const pad = 8, sw = x1 - x0 + 1 + pad * 2, sh = y1 - y0 + 1 + pad * 2, k = Math.min(1, MAX_W / sw, MAX_H / sh);
  const out = document.createElement('canvas');
  out.width = Math.round(sw * k); out.height = Math.round(sh * k);
  out.getContext('2d').drawImage(canvas, x0 - pad, y0 - pad, sw, sh, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

/** A PNG file the person chose, scaled to fit. */
const fromFile = file => new Promise((resolve, reject) => {
  if (!/^image\/png$/.test(file.type)) { reject(new Error('Choose a PNG file.')); return; }
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, MAX_W / img.width, MAX_H / img.height), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    resolve(c.toDataURL('image/png'));
  };
  img.onerror = () => reject(new Error('That file could not be read.'));
  img.src = URL.createObjectURL(file);
});

/** Full-screen signing. Resolves the PNG data URL, or '' when cancelled. Applying also saves it as the person's signature. */
export function openPad(title = 'Your signature') {
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.className = 'sigpad-overlay';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', title);
    box.innerHTML = `<div class="sigpad-top"><b></b><span class="muted">Sign with your finger or the mouse</span></div>
      <canvas class="sigpad-canvas"></canvas>
      <div class="sigpad-bar"><button type="button" class="btn ghost" data-k="cancel">Cancel</button>
        <label class="btn ghost">Choose a PNG<input type="file" accept="image/png" hidden></label>
        <button type="button" class="btn" data-k="clear">Clear</button><button type="button" class="btn primary" data-k="apply">Apply</button></div>`;
    box.querySelector('b').textContent = title;
    document.body.append(box);
    const canvas = box.querySelector('canvas'), ctx = canvas.getContext('2d');
    const fit = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.round(r.width * devicePixelRatio); canvas.height = Math.round(r.height * devicePixelRatio);
      ctx.lineWidth = 2.6 * devicePixelRatio; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1f4a';
    };
    fit();
    let down = false;
    const at = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * devicePixelRatio, (e.clientY - r.top) * devicePixelRatio]; };
    canvas.addEventListener('pointerdown', e => { down = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...at(e)); ctx.lineTo(...at(e)); ctx.stroke(); });
    canvas.addEventListener('pointermove', e => { if (down) { ctx.lineTo(...at(e)); ctx.stroke(); } });
    canvas.addEventListener('pointerup', () => { down = false; });
    const close = png => { box.remove(); if (png) saveSignature(png); resolve(png); };
    box.addEventListener('click', e => {
      const k = e.target.closest('[data-k]')?.dataset.k;
      if (k === 'cancel') close('');
      if (k === 'clear') ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (k === 'apply') { const png = trimmed(canvas); if (png) close(png); else alert('Sign first, or press Cancel.'); }
    });
    box.querySelector('input').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      try { close(await fromFile(f)); } catch (err) { alert(err.message); }
    });
  });
}
