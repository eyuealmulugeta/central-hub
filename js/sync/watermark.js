// The watermark behind the text of every printed page and PDF: the company mark, large, very faint, running off the
// right edge of the page, like a letterhead. One picture (assets/watermark.webp, with a see-through background) and one
// placement, used by the PDF made in the browser (share.js, which sends it by WhatsApp, Telegram and email) and mirrored
// in css/app.css for printing from the browser (.paper::before: keep the numbers there in step with PLACEMENT, a test checks it).

export const WATERMARK_URL = 'assets/watermark.webp';

/**
 * Where the mark sits on a page. Its centre is on the right edge of the page (x = 1 - width / 2) and it is `width` of the page wide.
 * It is stretched up and down between two lines: its top point (the peak in the middle of the top) is pulled up to the line under
 * the letterhead, and its lowest sharp tip is held `tipGapCm` above the bottom edge. `topCm` is where that line is when a page
 * does not say (the printed page; a PDF measures the real line of its own letterhead). `opacity` is how faint it is.
 */
export const PLACEMENT = { x: 0.25, width: 1.5, topCm: 4.7, tipGapCm: 2, opacity: 0.11 };

/** The highest and lowest points of the picture's shape, as shares of the picture's height (a little clear space is above and below). */
export const TOP = 0.0569;
export const TIP = 0.9431;
/** A4, in cm. */
export const PAGE_CM = { width: 21, height: 29.7 };

/** The box of the mark on a page of `pageW` x `pageH`; `lineY` is where the top line of this page is, when known. Pure. */
export function placement(pageW, pageH, p = PLACEMENT, lineY = null) {
  const topAt = lineY ?? pageH * p.topCm / PAGE_CM.height;
  const tipAt = pageH * (1 - p.tipGapCm / PAGE_CM.height);
  const h = (tipAt - topAt) / (TIP - TOP);
  return { x: pageW * p.x, y: topAt - TOP * h, w: pageW * p.width, h };
}

/** The same box as shares of the page, for the printed page (css/app.css, .paper::before), where the line is taken at `topCm`. */
export function cssBox(p = PLACEMENT) {
  const box = placement(1, 1, p);
  return { top: box.y, height: box.h };
}

let loaded = null;

/** The watermark picture, loaded once. Resolves null (no watermark) if it cannot be loaded: a missing picture must not stop a PDF. */
export function loadWatermark(base = document.baseURI) {
  loaded ||= new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = new URL(WATERMARK_URL, base).href;
  });
  return loaded;
}

/**
 * Draw the mark onto a finished page. It is multiplied into what is already there, so it shows through the white of the page
 * and is darkened by nothing: text and lines stay as black as they were, which is what "behind the text" looks like.
 */
export function stamp(ctx, pageW, pageH, img, p = PLACEMENT, lineY = null) {
  if (!img) return;
  const box = placement(pageW, pageH, p, lineY);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = p.opacity;
  ctx.drawImage(img, box.x, box.y, box.w, box.h);
  ctx.restore();
}
