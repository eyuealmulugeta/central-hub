// Reading a picture of a document into text, in the browser: nothing is sent to a server. The reader (Tesseract) is
// loaded only when a document is chosen, from cdnjs at a fixed version and checked against its published hash. The
// first time it also downloads its English language data (about 10 MB), so that first read needs the internet.

import { readPaper } from '../engine/docread.js';
import { readText } from '../core/textread.js';
export { readText };
import { html } from './dom.js';
import { store } from '../core/store.js';
import { uid } from '../core/util.js';
import { fillPerson } from '../engine/docread.js';
import { tell } from '../core/image.js';

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
