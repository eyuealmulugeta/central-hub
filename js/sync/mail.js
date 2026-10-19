// Emailing documents. Central Hub has no server of its own, so a document is
// sent through the same Apps Script web app that saves backups to Drive
// (apps-script/Code.gs, action 'email'): the script turns the document into a
// PDF and sends it from the Google account that owns the script.

import { driveConfig } from './drive.js';

/** True once the web app URL and shared secret are saved in this browser (Backup, Google Drive). */
export const mailReady = () => { const c = driveConfig.get(); return !!(c.endpoint && c.token); };

// The document on its own page. Fixed colours and table layout: the PDF is made by
// Google's converter, which handles tables far better than modern CSS layout.
export const PAPER_CSS = `
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.45; color: #1f2328; margin: 28px; }
  h2 { font-size: 18px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: .04em; }
  h3 { font-size: 13px; margin: 18px 0 6px; }
  p { margin: 6px 0; }
  .muted { color: #667085; }
  .pre { white-space: pre-line; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; font-size: 11px; color: #667085; border-bottom: 1px solid #98a2b3; padding: 5px 6px; }
  td { border-bottom: 1px solid #e4e7ec; padding: 5px 6px; vertical-align: top; }
  .r { text-align: right; }
  .nowrap { white-space: nowrap; }
  tr.group td { font-weight: bold; background: #f2f4f7; }
  .p-head { display: table; width: 100%; border-bottom: 2px solid #1f2328; padding-bottom: 12px; }
  .p-head > * { display: table-cell; vertical-align: top; }
  .p-title { text-align: right; }
  .p-block > * { display: block; }
  .p-block img { max-height: 56px; max-width: 200px; margin-bottom: 6px; }
  .p-company { font-size: 16px; font-weight: bold; }
  .p-to, .p-kpis, .p-sign { display: table; width: 100%; table-layout: fixed; margin: 14px 0; }
  .p-to > *, .p-kpis > *, .p-sign > * { display: table-cell; vertical-align: top; padding-right: 16px; }
  .p-kpis b { font-size: 16px; display: block; }
  .p-kpis span { display: block; }
  .p-sign { margin-top: 48px; }
  .p-sign > div { border-top: 1px solid #1f2328; padding-top: 6px; color: #667085; }
  dl { margin: 0; }
  dl.facts dt, dl.totals dt { float: left; clear: left; color: #667085; min-width: 150px; }
  dl.facts dd, dl.totals dd { margin: 0 0 3px 160px; }
  .p-title dl.facts dt { float: none; display: inline; min-width: 0; }
  .p-title dl.facts dd { display: inline; margin: 0 0 0 6px; }
  .p-title dl.facts dd:after { content: ''; display: block; }
  dl.totals { margin: 14px 0 0 45%; }
  dl.totals dd { text-align: right; margin-left: 0; }
  dl.totals .grand { font-weight: bold; font-size: 14px; border-top: 1px solid #1f2328; padding-top: 4px; }
  .p-notes { margin-top: 14px; }
  .p-internal { border: 1px solid #b42318; color: #b42318; font-weight: bold; padding: 5px 8px; text-align: center; }
  .chip { font-size: 11px; color: #667085; }
  .meter { display: none; }
  ul.plain { padding-left: 16px; margin: 4px 0; }
`;

const toDataUrl = async src => {
  const blob = await (await fetch(src)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

/**
 * A standalone HTML page of one printable document (a `.paper` element on screen).
 * Screen-only controls are dropped and images are embedded, so the page needs nothing else.
 */
export async function paperHtml(paper, title) {
  const copy = paper.cloneNode(true);
  copy.querySelectorAll('.no-print, .no-pdf, button, input, select, textarea').forEach(el => el.remove());   // .no-pdf: drawn on screen and paper, left out of the PDF
  // the bar chart is positioned in ways the PDF converter cannot draw; the task table above it says the same
  copy.querySelectorAll('.mg').forEach(el => {
    const heading = el.previousElementSibling;
    if (heading?.tagName === 'H3') heading.remove();
    el.remove();
  });
  for (const img of copy.querySelectorAll('img')) {
    if (img.src.startsWith('data:')) continue;
    try { img.src = await toDataUrl(img.src); } catch { img.remove(); }
  }
  const safeTitle = String(title || 'Document').replace(/[<>&]/g, '');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title><style>${PAPER_CSS}</style></head><body>${copy.innerHTML}</body></html>`;
}

/** A standalone page from HTML that is already complete (no screen controls, no linked images). */
export const pageHtml = (inner, title) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${String(title || 'Document').replace(/[<>&]/g, '')}</title><style>${PAPER_CSS}</style></head><body>${inner}</body></html>`;

/** Send through the web app. Resolves with what the script reports, or throws a message a person can act on. */
export async function sendMail({ to, cc = '', subject, message, html = '', filename = 'document', files = [] }) {
  const { endpoint, token } = driveConfig.get();
  if (!endpoint || !token) throw new Error('Email is not set up yet. Enter the web app URL and shared secret under Backup.');
  let text;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      // text/plain avoids a CORS preflight, which Apps Script cannot answer
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'email', token, to, cc, subject, message, html, filename, files }),
      redirect: 'follow',
    });
    text = await res.text();
  } catch {
    throw new Error('Could not reach the email script. Check the internet connection.');
  }
  let out;
  try { out = JSON.parse(text); } catch { throw new Error('The web app did not answer as expected. Check the URL under Backup.'); }
  if (!out.ok) {
    if (out.error === 'unauthorized') throw new Error('The shared secret under Backup does not match the script.');
    // a script without the email part saves the request as a file, or fails decoding it
    if (out.id || /base64|dataBase64|decode/i.test(out.error || '')) throw new Error('The script has no email part yet. Paste the new apps-script/Code.gs and deploy a new version.');
    throw new Error(String(out.error || 'The email was not sent.').replace(/^Error:\s*/, ''));
  }
  if (out.id && !out.to) throw new Error('The script has no email part yet. Paste the new apps-script/Code.gs and deploy a new version.');
  return out;
}

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;   // all added files together; must match apps-script/Code.gs

/** A file chosen on this computer, as the script expects it: { name, size, dataBase64 }. Rejects anything that is not a PDF. */
export async function readPdf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // every PDF file starts with the characters %PDF
  if (bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 4)) !== '%PDF') throw new Error(`${file.name} is not a PDF file.`);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return { name: file.name, size: bytes.length, dataBase64: btoa(binary) };
}

/** A link that opens the person's own email app with the text filled in (no attachment is possible this way). */
export const mailtoLink = ({ to, cc, subject, message }) =>
  `mailto:${encodeURIComponent(to || '')}?${cc ? `cc=${encodeURIComponent(cc)}&` : ''}subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(message || '')}`;
