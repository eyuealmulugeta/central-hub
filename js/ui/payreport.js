// v0.48.1 (B4b): after a pay run is approved, its report is saved to Google Drive and emailed to the report list
// (Payroll, Rates: the Admin alone at first). Named "year-month project ..." so they sort by year, month and project.

import { store } from '../core/store.js';
import { saveToDrive } from '../sync/drive.js';
import { mailReady, sendMail, pageHtml } from '../sync/mail.js';
import { reportList } from '../engine/paysteps.js';
import { tell } from '../core/image.js';
import { archiveFolder } from '../engine/logsheet.js';
import { addRow, setFile } from './archive.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const tableOf = csv => `<table>${csv.split('\n').map(line => `<tr>${(line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).slice(0, -1).map(x => `<td>${esc(x.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'))}</td>`).join('')}</tr>`).join('')}</table>`;

export async function sendPayReport({ name, csv, subject }) {
  if (store.readOnly || !store.cloud) return;
  if (!mailReady()) { tell('Approved. The pay report was not saved or sent: Google Drive is not set up on this computer (Backup).'); return; }
  const to = reportList(store.global, store.isAdmin ? store.user?.email || '' : '');
  try {
    // v0.51.0: filed under year / month / Company and logged in the company's Log sheet
    const date = new Date().toISOString().slice(0, 10);
    const out = await saveToDrive(`${name}.csv`, csv, 'text/csv', { folder: archiveFolder(date, 'Company') });
    const row = addRow({ date, type: 'payreport', subject: subject || name, projectId: '', source: 'auto' }, true);
    if (row) setFile(row.id, out, true);
    if (to.length) await sendMail({ to: to.join(','), subject, message: `${subject}\n\nThe report is attached and saved to Google Drive as "${name}.csv".`, html: pageHtml(tableOf(csv), subject), filename: name });
    tell(`✓ Approved. The report is saved to Google Drive${to.length ? ` and emailed to ${to.join(', ')}` : ''}.`);
  } catch (err) { tell(`Approved, but the report was not sent: ${err?.message || err}`); }
}
