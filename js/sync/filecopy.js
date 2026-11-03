// v0.79.0 (owner, 3 Nov): every document printed, saved as PDF, shared or emailed from a page also gets a copy in Google
// Drive under Project / Category / Month ("CHB/Invoice/2026-11"). Nothing when Drive is not set up; once per document text.
import { store } from '../core/store.js';
import { mailReady, paperHtml, readPdf } from './mail.js';
import { saveBase64, saveToDrive } from './drive.js';
import { describePaper } from './share.js';
import { archiveFolder } from '../engine/logsheet.js';
import { projectCode } from '../engine/docref.js';

/** The category of a sheet: its heading, "INVOICE" -> "Invoice". */
export const docCategory = paper => {
  const t = (paper?.querySelector?.('h2')?.textContent || 'Document').trim();
  return t.charAt(0) + t.slice(1).toLowerCase();
};

/** A short key of a document's name and text, so the same sheet is copied once. */
export const copyKey = (name, text) => {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `${name}#${h}`;
};

const done = new Set();

/** Copy the sheet on screen to Drive: `pdf` is a PDF File or { name, dataBase64 } already made, else the page is converted. */
export async function fileCopy(paper, pdf = null) {
  if (!paper || store.readOnly || !store.cloud || !mailReady()) return false;
  const name = describePaper(paper).name;
  const key = copyKey(name, paper.textContent);
  if (done.has(key)) return false;
  done.add(key);
  const date = new Date().toISOString().slice(0, 10);
  const folder = archiveFolder(date, store.project ? projectCode(store.project) : '', docCategory(paper));
  try {
    const made = pdf && typeof Blob !== 'undefined' && pdf instanceof Blob ? await readPdf(pdf) : pdf;
    if (made?.dataBase64) await saveBase64(made.name || `${name}.pdf`, made.dataBase64, 'application/pdf', { folder });
    else await saveToDrive(`${name}.html`, await paperHtml(paper, name), 'text/html', { folder, pdf: true });
    return true;
  } catch { done.delete(key); return false; }
}
