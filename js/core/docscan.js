// v1.15.0 (owner, 8 Nov): a picture of an ID card or passport page made into a clean scan, on the phone: the document's
// four corners are found, it is straightened (perspective), turned level, cropped at its edge, sized to its true shape
// and its colour and brightness evened out. Works the same for a camera picture and one from the gallery. Nothing is
// sent anywhere. The math (findQuad, homography, warp, levels) is pure, so the tests run it without a browser.

/** Width / height of the documents: an ID card (ID-1, 85.6 x 54 mm) and a passport's photo page (ID-3, 125 x 88 mm). */
export const SHAPE = { id: 85.6 / 54, fayda: 85.6 / 54, passport: 125 / 88 };
const WORK = 480;        // the side the corners are looked for at
const OUT = 1600;        // the longest side of the scan

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
/** The area of a polygon (always positive). */
export const areaOf = pts => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

/** Grey levels (0-255) of RGBA pixels. */
export function toGray(rgba, w, h) {
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  return g;
}

function blur(g, w, h) {
  const out = new Uint8ClampedArray(g.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += g[yy * w + xx]; n++; }
    }
    out[y * w + x] = s / n;
  }
  return out;
}

/** Edge pixels (1) of a grey picture: the strongest tenth of its brightness changes, thickened by one pixel. */
export function edges(gray, w, h) {
  const g = blur(blur(gray, w, h), w, h);
  const mag = new Float32Array(w * h);
  const hist = new Uint32Array(256);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1];
    const gy = g[i + w - 1] + 2 * g[i + w] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - w] - g[i - w + 1];
    const m = Math.min(255, Math.hypot(gx, gy) / 4);
    mag[i] = m; hist[m | 0]++;
  }
  let t = 255, seen = 0;
  const top = (w - 2) * (h - 2) * 0.1;
  while (t > 0 && seen + hist[t] < top) seen += hist[t--];
  t = Math.max(t, 12);
  const e = new Uint8Array(w * h);
  const m2 = 3;   // the picture's own border is never an edge of the document
  for (let y = m2; y < h - m2; y++) for (let x = m2; x < w - m2; x++) {
    const i = y * w + x;
    if (mag[i] >= t) { e[i] = 1; e[i - 1] = 1; e[i + 1] = 1; e[i - w] = 1; e[i + w] = 1; }
  }
  return e;
}

/** The convex hull of points (monotone chain), counter-clockwise on screen. */
export function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** The four-cornered shape of the largest area with its corners on the hull. */
export function biggestQuad(h) {
  let pts = h;
  if (pts.length > 48) { const k = Math.ceil(pts.length / 48); pts = pts.filter((_, i) => i % k === 0); }
  const n = pts.length;
  if (n < 4) return null;
  const tri = (a, b, c) => Math.abs(cross(pts[a], pts[b], pts[c])) / 2;
  let best = null, bestA = 0;
  for (let i = 0; i < n; i++) for (let k = i + 2; k < n; k++) {
    if (i === 0 && k === n - 1) continue;
    let a1 = 0, j1 = -1, a2 = 0, l1 = -1;
    for (let j = i + 1; j < k; j++) { const a = tri(i, j, k); if (a > a1) { a1 = a; j1 = j; } }
    for (let l = k + 1; l < n + i; l++) { const a = tri(k, l % n, i); if (a > a2) { a2 = a; l1 = l % n; } }
    if (j1 >= 0 && l1 >= 0 && a1 + a2 > bestA) { bestA = a1 + a2; best = [pts[i], pts[j1], pts[k], pts[l1]]; }
  }
  return best;
}

/** Corners as top-left, top-right, bottom-right, bottom-left (clockwise on screen). */
export function orderCorners(q) {
  const c = [q.reduce((s, p) => s + p[0], 0) / 4, q.reduce((s, p) => s + p[1], 0) / 4];
  const byAngle = [...q].sort((a, b) => Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0]));
  let start = 0;
  byAngle.forEach((p, i) => { if (p[0] + p[1] < byAngle[start][0] + byAngle[start][1]) start = i; });
  return [0, 1, 2, 3].map(i => byAngle[(start + i) % 4]);
}

/** How much of a shape's outline lies on edge pixels (0-1). */
function support(q, e, w, h) {
  let on = 0, all = 0;
  for (let s = 0; s < 4; s++) {
    const a = q[s], b = q[(s + 1) % 4];
    for (let t = 0.05; t < 0.96; t += 0.03) {
      const x = Math.round(a[0] + (b[0] - a[0]) * t), y = Math.round(a[1] + (b[1] - a[1]) * t);
      all++;
      let hit = false;
      for (let dy = -2; dy <= 2 && !hit; dy++) for (let dx = -2; dx <= 2 && !hit; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && e[yy * w + xx]) hit = true;
      }
      if (hit) on++;
    }
  }
  return on / all;
}

/**
 * The document's corners in a grey picture (tl, tr, br, bl), or null when no clear document outline is found (the
 * picture is then used whole: it may already be cropped). Looks at the edge groups, largest first.
 */
export function findQuad(gray, w, h) {
  const e = edges(gray, w, h);
  const label = new Int32Array(w * h).fill(-1);
  const groups = [];
  const stack = [];
  for (let i = 0; i < e.length; i++) {
    if (!e[i] || label[i] >= 0) continue;
    const id = groups.length, pts = [];
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    label[i] = id; stack.push(i);
    while (stack.length) {
      const j = stack.pop(), x = j % w, y = (j - x) / w;
      pts.push([x, y]);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx;
        if (e[k] && label[k] < 0) { label[k] = id; stack.push(k); }
      }
    }
    groups.push({ pts, box: (x1 - x0) * (y1 - y0) });
  }
  let best = null, bestScore = 0;
  for (const g of groups.sort((a, b) => b.box - a.box).slice(0, 6)) {
    if (g.box < w * h * 0.12) break;
    const q = biggestQuad(hull(g.pts));
    if (!q) continue;
    const o = orderCorners(q), a = areaOf(o), s = support(o, e, w, h);
    if (a < w * h * 0.12 || s < 0.45) continue;
    if (a * s * s > bestScore) { bestScore = a * s * s; best = o; }
  }
  return best;
}

/** The 3x3 map (row-major, 9 numbers) taking a point of `from` to `to`, for four point pairs. */
export function homography(from, to) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = from[i], [x, y] = to[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  for (let c = 0; c < 8; c++) {   // Gaussian elimination with partial pivoting
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    if (Math.abs(A[c][c]) < 1e-12) return null;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return [...b.map((v, i) => v / A[i][i]), 1];
}
export const mapPoint = (H, [u, v]) => { const z = H[6] * u + H[7] * v + H[8]; return [(H[0] * u + H[1] * v + H[2]) / z, (H[3] * u + H[4] * v + H[5]) / z]; };

/** Corners turned a quarter clockwise `turns` times (the scan turns with them). */
export const turnCorners = (q, turns = 0) => { const t = ((turns % 4) + 4) % 4; return [0, 1, 2, 3].map(i => q[(i - t + 4) % 4]); };

/**
 * The size of the scan for corners (tl, tr, br, bl): as measured, lying down (wider than high: the corners are turned
 * a quarter when they stand up), the height fitted to the document's true shape when close to it, the longest side at most `max`.
 */
export function scanSize(q, kind = 'id', max = OUT) {
  let c = q;
  let w = Math.max(dist(c[0], c[1]), dist(c[3], c[2])), h = Math.max(dist(c[0], c[3]), dist(c[1], c[2]));
  if (h > w) { c = turnCorners(c, 1); [w, h] = [h, w]; }
  const shape = SHAPE[kind];
  if (shape && Math.abs(w / h - shape) / shape < 0.25) h = w / shape;
  const k = Math.min(1, max / w);
  return { corners: c, width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** RGBA pixels of the document between `corners` (tl, tr, br, bl) of the source, straightened into width x height. */
export function warp(src, sw, sh, corners, width, height) {
  const H = homography([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], corners);
  const out = new Uint8ClampedArray(width * height * 4);
  if (!H) return out;
  for (let v = 0; v < height; v++) for (let u = 0; u < width; u++) {
    const z = H[6] * u + H[7] * v + H[8];
    let x = (H[0] * u + H[1] * v + H[2]) / z, y = (H[3] * u + H[4] * v + H[5]) / z;
    x = Math.min(sw - 1.001, Math.max(0, x)); y = Math.min(sh - 1.001, Math.max(0, y));
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
    const i = (y0 * sw + x0) * 4, o = (v * width + u) * 4;
    for (let c = 0; c < 3; c++) {
      const top = src[i + c] * (1 - fx) + src[i + 4 + c] * fx;
      const bot = src[i + sw * 4 + c] * (1 - fx) + src[i + sw * 4 + 4 + c] * fx;
      out[o + c] = top * (1 - fy) + bot * fy;
    }
    out[o + 3] = 255;
  }
  return out;
}

/**
 * Colour and brightness evened out, in place: each colour stretched from its darkest to its lightest 1% (this also takes
 * out a yellow or blue cast from the light), then lifted a little in the middle tones when the picture is dark.
 */
export function levels(px) {
  const n = px.length / 4, lo = [], hi = [];
  for (let c = 0; c < 3; c++) {
    const hist = new Uint32Array(256);
    for (let i = c; i < px.length; i += 4) hist[px[i]]++;
    let s = 0, a = 0; while (a < 255 && (s += hist[a]) < n * 0.01) a++;
    s = 0; let b = 255; while (b > 0 && (s += hist[b]) < n * 0.01) b--;
    if (b - a < 40) { a = Math.max(0, a - 20); b = Math.min(255, b + 20); }
    lo.push(a); hi.push(b);
  }
  let mean = 0;
  for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) px[i + c] = (px[i + c] - lo[c]) * 255 / Math.max(1, hi[c] - lo[c]);
  for (let i = 0; i < px.length; i += 4) mean += px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
  mean /= n;
  const gamma = mean < 120 ? Math.max(0.6, mean / 140) : 1;
  if (gamma !== 1) { const lut = new Uint8ClampedArray(256).map((_, v) => 255 * (v / 255) ** gamma); for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) px[i + c] = lut[px[i + c]]; }
  return px;
}

// ---- in the browser

async function decode(file) {
  if (globalThis.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* the older way below */ } }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture this browser can read.')); };
    img.src = url;
  });
}
const canvasOf = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

/**
 * The source of a scan: the picture (its longest side at most 2400) and its pixels, with the corners found in it
 * (`auto` false and the whole picture when none were found).
 */
export async function scanSource(file) {
  const img = await decode(file);
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih) throw new Error('That file is not a picture this browser can read.');
  const k = Math.min(1, 2400 / Math.max(iw, ih)), w = Math.round(iw * k), h = Math.round(ih * k);
  const big = canvasOf(w, h), bx = big.getContext('2d', { willReadFrequently: true });
  bx.drawImage(img, 0, 0, w, h);
  const s = Math.min(1, WORK / Math.max(w, h)), ww = Math.round(w * s), wh = Math.round(h * s);
  const small = canvasOf(ww, wh), sx = small.getContext('2d', { willReadFrequently: true });
  sx.drawImage(big, 0, 0, ww, wh);
  const q = findQuad(toGray(sx.getImageData(0, 0, ww, wh).data, ww, wh), ww, wh);
  const whole = [[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]];
  return { canvas: big, w, h, pixels: bx.getImageData(0, 0, w, h).data, quad: q ? q.map(([x, y]) => [x / s, y / s]) : whole, auto: !!q };
}

/** The scan of a source: straightened between `quad`, turned `turns` quarters, evened out. A canvas. */
export function scanOf(source, { quad = source.quad, turns = 0, kind = 'id' } = {}) {
  const { corners, width, height } = scanSize(orderCorners(quad), kind);
  const c = turnCorners(corners, turns);
  const [W, H] = turns % 2 ? [height, width] : [width, height];
  const px = levels(warp(source.pixels, source.w, source.h, c, W, H));
  const out = canvasOf(W, H);
  out.getContext('2d').putImageData(new ImageData(px, W, H), 0, 0);
  return out;
}

/** A canvas as a JPEG file (for the picture limits and the reader). */
export const fileOf = (canvas, name = 'scan.jpg') => new Promise((resolve, reject) =>
  canvas.toBlob(b => (b ? resolve(new File([b], name, { type: 'image/jpeg' })) : reject(new Error('The scan could not be made.'))), 'image/jpeg', 0.92));
