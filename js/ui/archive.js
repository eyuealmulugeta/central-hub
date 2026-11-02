// v0.51.0 (Phase C1): a document Central Hub makes is saved to Google Drive as a PDF, filed by year / month /
// project with the standard name (engine/logsheet.js), and gets its Log sheet row. Without Drive on this computer
// (Backup) the row is still written, without a file, and the person is told.

import { store } from '../core/store.js';
import { uid } from '../core/util.js';
import { saveToDrive } from '../sync/drive.js';
import { mailReady } from '../sync/mail.js';
import { projectCode } from '../engine/docref.js';
import { logRow, archiveFolder, archiveName } from '../engine/logsheet.js';
import { tell } from '../core/image.js';

export const me = () => store.profile?.name || store.user?.name || store.user?.email || '';

/** Adds a Log sheet row: to the open project's sheet, or the company's (`company: true`, the Admin's). Returns it. */
export function addRow(fields, company = false) {
  let row = null;
  const add = list => { row = logRow(list, { id: uid('ls'), by: me(), ...fields }); list.push(row); };
  if (company) store.updateCompany(co => add(co.logsheet ||= []));
  else store.update(ws => add(ws.logsheet ||= []));
  return row;
}

/** Puts the Drive file on a row once it is saved. */
export function setFile(rowId, { url, id }, company = false) {
  const put = list => { const r = (list || []).find(x => x.id === rowId); if (r) Object.assign(r, { url: url || '', fileId: id || '' }); };
  if (company) store.updateCompany(co => put(co.logsheet));
  else store.update(ws => put(ws.logsheet));
}

/**
 * Archive one document: { type, reference, subject, to, date, getHtml: async () => the page }. Project documents go
 * under the open project's code, `company: true` ones under "Company". Never throws: the document has already gone out.
 */
export async function archiveDoc({ c, company = false, type, reference = '', subject = '', to = '', date = c.today, getHtml }) {
  if (store.readOnly) return null;
  const code = company ? 'Company' : projectCode(c.project);
  const row = addRow({ date, type, reference, subject, to, projectId: company ? '' : c.project?.id || '', source: 'auto' }, company);
  if (!row) return null;
  if (!mailReady()) { tell('Logged in the Log sheet. The PDF was not archived: Google Drive is not set up on this computer (Backup).'); return row; }
  try {
    const name = archiveName({ date, code, type, reference, subject });
    const out = await saveToDrive(`${name}.html`, await getHtml(), 'text/html', { folder: archiveFolder(date, code), pdf: true });
    setFile(row.id, out, company);
  } catch (err) { tell(`Logged in the Log sheet, but the PDF was not archived: ${err?.message || err}`); }
  return row;
}
