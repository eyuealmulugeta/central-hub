// Pictures kept with a record (an employee's photo, the company logo) are made small automatically: whatever
// picture is chosen, it is scaled down and re-encoded until it fits, so nobody has to resize it first.
//
// A photo becomes a JPEG on a white background. A logo that can be transparent (PNG, WebP, GIF, SVG) stays a PNG
// so its transparency survives, and is made smaller by scaling. A picture that is already small enough is kept
// exactly as it is.

export const PHOTO = { maxBytes: 150 * 1024, maxSide: 640 };
export const LOGO = { maxBytes: 200 * 1024, maxSide: 480 };
/** A passport page has small print: kept larger than a photo so it stays readable. */
export const PASSPORT = { maxBytes: 300 * 1024, maxSide: 1600 };

/** The size that fits inside `side` on its longer edge, never larger than the picture itself. */
export function fitWithin(width, height, side) {
  const k = Math.min(1, side / Math.max(width, height));
  return [Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k))];
}

/** The size of the picture inside a data URL, in bytes. */
export const bytesOf = dataUrl => Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);

/**
 * Find the largest version that fits: try the qualities from best to worst at the full size allowed, then
 * make it 15% smaller and try again. `encode(width, height, quality)` returns a data URL. Throws if nothing fits.
 */
export async function squeeze({ width, height, maxSide, maxBytes, encode, lossy = true }) {
  let [w, h] = fitWithin(width, height, maxSide);
  const qualities = lossy ? [0.9, 0.8, 0.7, 0.6, 0.5, 0.4] : [1];
  for (let round = 0; round < 14; round++) {
    for (const quality of qualities) {
      const dataUrl = await encode(w, h, quality);
      if (bytesOf(dataUrl) <= maxBytes) return { dataUrl, width: w, height: h, quality };
    }
    if (w <= 16 && h <= 16) break;
    w = Math.max(16, Math.round(w * 0.85));
    h = Math.max(16, Math.round(h * 0.85));
  }
  throw new Error('This picture cannot be made small enough. Try a different one.');
}

const NOT_A_PICTURE = 'That file is not a picture this browser can read. Save it as a JPG or PNG and try again.';

async function decode(file) {
  if (globalThis.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* try an image element */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(NOT_A_PICTURE)); };
    img.src = url;
  });
}

const readAsDataUrl = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error(NOT_A_PICTURE));
  reader.readAsDataURL(file);
});

export const sizeText = bytes => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/**
 * The picture chosen in a file input, as a data URL that fits `limit` ({ maxBytes, maxSide }).
 * @returns { dataUrl, changed, before, after } and `changed` is false when the file was already small enough.
 */
export async function pictureFor(file, limit, kind = 'photo') {
  if (!file.type.startsWith('image/')) throw new Error(NOT_A_PICTURE);
  const img = await decode(file);
  const width = img.naturalWidth || img.width, height = img.naturalHeight || img.height;
  if (!width || !height) throw new Error(NOT_A_PICTURE);
  if (file.size <= limit.maxBytes && Math.max(width, height) <= limit.maxSide && /^image\/(jpeg|png)$/.test(file.type)) {
    const dataUrl = await readAsDataUrl(file);
    return { dataUrl, changed: false, before: file.size, after: bytesOf(dataUrl) };
  }
  const keepAlpha = kind === 'logo' && /^image\/(png|webp|gif|svg)/.test(file.type);
  const canvas = document.createElement('canvas');
  const out = await squeeze({
    width, height, ...limit, lossy: !keepAlpha,
    encode: (w, h, quality) => {
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!keepAlpha) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', quality);
    },
  });
  return { dataUrl: out.dataUrl, changed: true, before: file.size, after: bytesOf(out.dataUrl) };
}

/** A line for the person: "Photo made smaller: 3.2 MB to 96 KB." (nothing when the picture was kept as it was). */
export const sizeNote = (what, r) => (r.changed ? `${what} made smaller: ${sizeText(r.before)} to ${sizeText(r.after)}.` : '');

/** Show a short message on whatever page is open (main.js listens). */
export const tell = text => dispatchEvent(new CustomEvent('hub-toast', { detail: text }));
