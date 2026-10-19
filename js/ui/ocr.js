// Reading a picture of a document into text, in the browser: nothing is sent to a server. The reader (Tesseract) is
// loaded only when a document is chosen, from cdnjs at a fixed version and checked against its published hash. The
// first time it also downloads its English language data (about 10 MB), so that first read needs the internet.

import { mrzLines, readPaper } from '../engine/docread.js';
import { html } from './dom.js';
import { store } from '../core/store.js';
import { uid } from '../core/util.js';
import { fillPerson } from '../engine/docread.js';
import { tell } from '../core/image.js';

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
export async function readText(file) {
  const [T, { img, url }] = await Promise.all([loadReader(), pictureOf(file)]);
  const worker = await T.createWorker('eng', 1);
  try {
    await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<', tessedit_pageseg_mode: '6' });
    let text = '';
    for (const from of [0.6, 0.45]) {
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

/** What is said to the person after a document was read. */
function say(f, plan) {
  if (!plan.filled.length && !plan.differs.length) return 'The document could not be read. Try a straight, well-lit picture where the whole page and the two lines at the bottom show.';
  const proof = f.source === 'mrz' ? (f.proven ? ' The check digits on the page fit; still look the passport number over, because a 1 and an L can look alike.' : ' Some numbers on the page did not check out: please look them over.') : ' Please check what was read.';
  return `Read from the document: ${plan.filled.join(', ') || 'nothing new'}.${plan.differs.length ? ` Not changed, because something is already there: ${plan.differs.join('; ')}.` : ''}${proof}`;
}

/**
 * Read `file` and write what it says into the person's record: `findIn(company)` returns the record to change.
 * Only empty fields are filled (see engine/docread.js fillPerson). Tells the person what happened.
 */
export async function scanInto(file, findIn, options) {
  tell('Reading the document. The first time can take a minute.');
  try {
    const text = await readText(file);
    const facts = readPaper(text);
    let plan = { filled: [], differs: [] };
    store.updateCompany(co => {
      const person = findIn(co);
      if (!person) return;
      plan = fillPerson(person, facts, { ...options, newId: () => uid('dc') });
      Object.assign(person, plan.patch);
    });
    tell(say(facts, plan));
  } catch (err) { tell(err.message); }
}

/** The button that chooses a picture of a paper to read: shared by the employee and owner records. */
export const scanButton = (change, label = 'Read a document') => html`<label class="btn small" title="Choose a picture of a passport, ID card or other paper: its details are filled in for you">${label}<input type="file" accept="image/*" data-chg="${change}" hidden></label>`;
