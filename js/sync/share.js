// Sending a document as a PDF file on WhatsApp or Telegram.
//
// A web page cannot post into WhatsApp or Telegram on its own, but the browser can hand a real file to the
// device's share sheet, where the person picks WhatsApp or Telegram and the chat (Web Share API with files).
// That works on phones and in Chrome and Edge on Windows, and in Safari. Elsewhere the PDF is downloaded and
// the chat apps are opened, to attach it by hand.
//
// The PDF is made in the browser from the page's own printable sheet (the `.paper` element), so it needs no
// server and no Apps Script. The tools that do it are loaded once, on first use, from cdnjs, pinned to one
// version each and checked against their published integrity hashes.

import { PAPER_CSS } from './mail.js';
import { loadWatermark, stamp } from './watermark.js';

// Two small tools, each pinned to one version and checked against its published hash: html2canvas draws the sheet as a
// picture, jsPDF puts the pictures on A4 pages. (html2pdf, which joined the two, copied the sheet out of its frame into
// the app's own page, so the sheet lost its page styles and was drawn too wide and cut short. Drawing the sheet where it
// is laid out avoids that.)
const LIBS = {
  html2canvas: {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    integrity: 'sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H',
    ready: () => globalThis.html2canvas,
  },
  jspdf: {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    integrity: 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk',
    ready: () => globalThis.jspdf?.jsPDF,
  },
};
const loading = {};

function loadLib(key) {
  const lib = LIBS[key];
  if (lib.ready()) return Promise.resolve(lib.ready());
  loading[key] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = lib.url;
    s.integrity = lib.integrity;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(lib.ready());
    s.onerror = () => { loading[key] = null; reject(new Error('The PDF tool could not be loaded. Check the internet connection.')); };
    document.head.append(s);
  });
  return loading[key];
}

const clean = name => String(name || 'Document').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100);

/** The title, number and company of a printable sheet, for the file name and the message that goes with it. */
export function describePaper(paper) {
  const title = (paper.querySelector('h2')?.textContent || 'Document').trim();
  const pretty = title.charAt(0) + title.slice(1).toLowerCase();
  const fact = key => [...paper.querySelectorAll('dl.facts dt')].find(dt => dt.textContent.trim().toLowerCase() === key)?.nextElementSibling?.textContent.trim() || '';
  const number = fact('number') || fact('ref');
  const project = fact('project');
  const company = paper.querySelector('.p-company')?.textContent.trim() || '';
  const name = clean([pretty, number, !number && project ? project : ''].filter(Boolean).join(' '));
  const text = `${[pretty, number].filter(Boolean).join(' ')}${project && number ? `, ${project}` : ''}${company ? `, from ${company}` : ''}. The PDF is attached.`;
  return { name, text };
}

/**
 * The sheet drawn in a frame of its own, wide enough for the app's page layout (it is scaled to A4), with the app's own page styles, so the PDF looks like the
 * sheet on screen. A frame has its own width, so the result does not depend on the size of the screen
 * (a phone is far narrower than a page). Remove `host` when done; draw `element`.
 */
// The page styles of the emailed PDF (mail.js), with the letterhead and the signature blocks laid out side by side
// in a way the renderer draws reliably.
const SHEET_CSS = `${PAPER_CSS}
  html, body { background: #fff; }
  body { width: 794px; margin: 0; padding: 28px 28px 56px; box-sizing: border-box; }
  .p-head { display: flex; justify-content: space-between; align-items: flex-start; }
  .p-head > * { display: block; }
  .p-to, .p-kpis, .p-sign { display: flex; gap: 16px; }
  .p-to > *, .p-kpis > *, .p-sign > * { display: block; flex: 1; padding-right: 0; }
  .p-sign > div { padding-top: 6px; }
  .p-title dl.facts { margin-top: 6px; }
  .p-title dl.facts dt { display: inline; float: none; min-width: 0; }
`;

/**
 * The sheet drawn in a frame of its own, A4 wide. A frame has its own width, so the result does not depend on
 * the size of the screen (a phone is far narrower than a page). Remove `host` when done; draw `element`.
 */
export async function prepareSheet(paper) {
  const copy = paper.cloneNode(true);
  copy.querySelectorAll('.no-print, .no-pdf, button, input, select, textarea').forEach(el => el.remove());
  const host = document.createElement('iframe');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:0;top:0;width:794px;height:1123px;border:0;background:#fff;z-index:-1;pointer-events:none';
  document.body.append(host);
  const doc = host.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><base href="${document.baseURI}"><style>${SHEET_CSS}</style></head><body>${copy.innerHTML}</body></html>`);
  doc.close();
  // the renderer copies the page again before drawing it; inline styles are the layout that survives the copy
  const side = (selector, style) => doc.querySelectorAll(selector).forEach(el => { Object.assign(el.style, style); [...el.children].forEach(k => Object.assign(k.style, { display: 'block' })); });
  side('.p-head', { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' });
  side('.p-to, .p-kpis, .p-sign', { display: 'flex', gap: '16px', width: '100%' });
  doc.querySelectorAll('.p-to > *, .p-kpis > *, .p-sign > *').forEach(k => { k.style.flex = '1'; k.style.paddingRight = '0'; });
  doc.querySelectorAll('.p-title').forEach(el => { el.style.textAlign = 'right'; });
  // wait for the logo and any picture, then size the frame to the sheet
  await Promise.all([...doc.images].map(img => (img.complete ? null : new Promise(resolve => { img.onload = img.onerror = resolve; }))));
  await doc.fonts?.ready;
  host.style.height = `${doc.body.scrollHeight}px`;
  return { host, element: doc.body };
}

/** The sheet is laid out 794 px wide (A4 at 96 dpi), so one A4 page is 1123 px high. */
export const SHEET_WIDTH = 794;
export const PAGE_HEIGHT = 1123;

/**
 * Where to cut a sheet of `total` px into A4 pages: [[from, to], ...] in px. `spans` are the [top, bottom] of blocks
 * that must not be cut through (a table row, a signature block, a heading): a cut that would fall inside one moves up
 * to the block's top, unless that would leave the page less than 40% full. Pure.
 */
export function pageBreaks(total, spans = [], page = PAGE_HEIGHT) {
  const pages = [];
  let from = 0;
  while (total - from > page + 4) {      // a few px over one page is the rounding of the layout, not a second page
    let to = from + page;
    for (let moved = true; moved;) {
      moved = false;
      for (const [top, bottom] of spans) if (top > from && top < to && bottom > to) { to = top; moved = true; }
    }
    if (to - from < page * 0.4) to = from + page;
    pages.push([from, to]);
    from = to;
  }
  pages.push([from, total]);
  return pages;
}

/** The tops and bottoms of the blocks of a laid-out sheet that should stay in one piece. */
function unbreakable(element) {
  const base = element.getBoundingClientRect().top;
  return [...element.querySelectorAll('tr, .p-sign, .p-kpis, .p-to, h3, dl.facts')].map(el => {
    const r = el.getBoundingClientRect();
    return [Math.round(r.top - base), Math.round(r.bottom - base)];
  });
}

/** A real PDF file of the sheet, A4, as wide as the page, in as many pages as it needs. Screen-only controls and the chart are left out, as in the emailed PDF. */
export async function makePdf(paper, name) {
  const [html2canvas, JsPdf, mark] = await Promise.all([loadLib('html2canvas'), loadLib('jspdf'), loadWatermark()]);
  const { host, element } = await prepareSheet(paper);
  try {
    const total = Math.max(1, element.scrollHeight);
    const scale = 2;
    const canvas = await html2canvas(element, {
      scale, backgroundColor: '#ffffff', useCORS: true,
      windowWidth: SHEET_WIDTH, windowHeight: total, width: SHEET_WIDTH, height: total, x: 0, y: 0, scrollX: 0, scrollY: 0,
    });
    const pdf = new JsPdf({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    // the mark's top point is pulled up to the line under the letterhead of this sheet (the same place on every page)
    const head = element.querySelector('.p-head, .dsr-head');
    const line = head ? (head.getBoundingClientRect().bottom - element.getBoundingClientRect().top) * scale : null;
    const pieces = pageBreaks(total, unbreakable(element));
    const foot = paper.dataset?.foot || '';   // the house documents' footer (v0.22.1): on every page, with its number
    pieces.forEach(([from, to], i) => {
      // every page is a whole A4 page: the text of this piece of the sheet at the top, the watermark across the page, behind the text
      const page = document.createElement('canvas');
      page.width = SHEET_WIDTH * scale;
      page.height = PAGE_HEIGHT * scale;
      const ctx = page.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, page.width, page.height);
      const height = Math.max(1, Math.min(page.height, Math.round((to - from) * scale)));
      ctx.drawImage(canvas, 0, Math.round(from * scale), canvas.width, height, 0, 0, page.width, height);
      stamp(ctx, page.width, page.height, mark, undefined, line);
      if (i) pdf.addPage();
      pdf.addImage(page.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 210, 297);
      if (foot) {
        pdf.setFontSize(7);
        pdf.setTextColor(85, 85, 85);
        pdf.text(foot.length > 140 ? `${foot.slice(0, 139)}…` : foot, 12, 292);
        pdf.text(`Page ${i + 1} of ${pieces.length}`, 198, 292, { align: 'right' });
      }
    });
    return new File([pdf.output('blob')], `${clean(name)}.pdf`, { type: 'application/pdf' });
  } finally {
    host.remove();
  }
}

/** Can this device pass the file to its share sheet? */
export const canShareFile = file => typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && typeof navigator.share === 'function' && navigator.canShare({ files: [file] });

/** Open the share sheet with the PDF. Resolves 'shared' or 'cancelled'; throws on a real failure. */
export async function shareFile(file, text) {
  try {
    await navigator.share({ files: [file], title: file.name.replace(/\.pdf$/i, ''), text });
    return 'shared';
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled';
    throw err;
  }
}

/** For devices that cannot share a file: WhatsApp with the message ready (pick the chat), and Telegram on the web. */
export const whatsappUrl = text => `https://wa.me/?text=${encodeURIComponent(text)}`;
export const TELEGRAM_URL = 'https://web.telegram.org/';

export function downloadFile(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

export const sizeLabel = bytes => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
