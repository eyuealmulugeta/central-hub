// Reading a picture of a document into text, in the browser: nothing is sent to a server. The reader (Tesseract) is
// loaded only when a document is chosen, from cdnjs at a fixed version and checked against its published hash. The
// first time it also downloads its English language data (about 10 MB), so that first read needs the internet.
// v0.33.0: apart from ocr.js so the crew form page (crew.html), which has no sign-in and no store, reads IDs too.

import { mrzLines } from '../engine/docread.js';

const LIB = {
  url: 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js',
  integrity: 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F',
};
let loading = null;

function loadReader() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LIB.url;
    s.integrity = LIB.integrity;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(globalThis.Tesseract);
    s.onerror = () => { loading = null; reject(new Error('The document reader could not be loaded. Check the internet connection and try again.')); };
    document.head.append(s);
  });
  return loading;
}

function pictureOf(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture this browser can read.')); };
    img.src = url;
  });
}

/** The bottom `part` of the picture, enlarged to `width`, in grey: where the machine-readable lines are. */
function crop(img, from, width) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const sy = Math.round(h * from), sh = h - sy;
  const k = Math.max(1, width / w);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k); canvas.height = Math.round(sh * k);
  const ctx = canvas.getContext('2d');
  ctx.filter = 'grayscale(1) contrast(1.4)';
  ctx.drawImage(img, 0, sy, w, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** The text of the picture in `file`. Passports and ID cards are read twice: the zone alone first, then the whole page. */
export async function readText(file, { mrz = true } = {}) {
  const [T, { img, url }] = await Promise.all([loadReader(), pictureOf(file)]);
  const worker = await T.createWorker('eng', 1);
  try {
    let text = '';
    if (mrz) await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<', tessedit_pageseg_mode: '6' });
    for (const from of mrz ? [0.6, 0.45] : []) {   // an ID card without the two machine lines (Fayda) is read whole at once
      text = (await worker.recognize(crop(img, from, 2200))).data.text;
      if (mrzLines(text).length >= 2) return text;
    }
    await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '3' });
    return `${text}\n${(await worker.recognize(file)).data.text}`;
  } finally {
    await worker.terminate();
    URL.revokeObjectURL(url);
  }
}


// ---- v1.16.0 (owner, 8 Nov): the crew form reads each document twice (grey and black-on-white copies) with one reader
// kept open between pictures, and keeps how sure the reader was of every word, so each field shows how sure it is.

let kept = null;
async function keptReader() {
  const T = await loadReader();
  kept ||= T.createWorker('eng', 1).catch(err => { kept = null; throw err; });
  return kept;
}
const wordsOf = d => (d.words?.length ? d.words : (d.blocks || []).flatMap(b => (b.paragraphs || []).flatMap(p => (p.lines || []).flatMap(l => l.words || []))))
  .map(w => ({ text: String(w.text || ''), conf: Math.round(w.confidence ?? 0) }));

/**
 * The text and words (with the reader's confidence, 0-100) of each picture (canvases or files), read in turn, joined.
 * `mrz`: the bottom of each picture is also read for the machine lines (letters, digits and <).
 * `sparse`: cards: text in scattered blocks (page mode 11), else a page (3).
 */
export async function readDoc(images, { mrz = false, sparse = true } = {}) {
  const w = await keptReader();
  let text = '', words = [];
  const add = d => { text += `\n${d.text}`; words = words.concat(wordsOf(d)); };
  for (const img of images) {
    await w.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: sparse ? '11' : '3', preserve_interword_spaces: '1' });
    add((await w.recognize(img, {}, { text: true, blocks: true })).data);
  }
  if (mrz && images[0] instanceof HTMLCanvasElement) {
    const c = images[0], from = Math.round(c.height * 0.55);
    const part = Object.assign(document.createElement('canvas'), { width: c.width, height: c.height - from });
    part.getContext('2d').drawImage(c, 0, from, c.width, c.height - from, 0, 0, c.width, c.height - from);
    await w.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<', tessedit_pageseg_mode: '6' });
    add((await w.recognize(part, {}, { text: true, blocks: true })).data);
  }
  return { text, words };
}
