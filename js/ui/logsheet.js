// v0.51.0 (Phase C1): the Log sheet. Every official document of the open project (and, for the Admin, of the
// company: payroll, office letters) with No., Date, Reference, Subject, Submitted to, Prepared by, Version and
// the archived file. Rows are written when Central Hub sends or issues a document (ui/archive.js) or added here by
// hand, with a file from this computer or a Drive link. Who sees a row follows its project, not the Drive folder.

import { store } from '../core/store.js';
import { fmtFull } from '../core/util.js';
import { html, options, chip } from './dom.js';
import { DOC_TYPES, typeName, findRows, noText, archiveFolder, archiveName } from '../engine/logsheet.js';
import { projectCode } from '../engine/docref.js';
import { saveBase64 } from '../sync/drive.js';
import { mailReady } from '../sync/mail.js';
import { addRow, setFile, me } from './archive.js';
import { tell } from '../core/image.js';

let scope = 'project';   // project | company (the Admin's)
let filter = { q: '', type: '', from: '', to: '', by: '' };
let notice = '';

const rowsOf = c => (scope === 'company' && store.isAdmin ? c.company.logsheet : c.ws.logsheet) || [];
const link = url => /^https:\/\/(drive|docs)\.google\.com\//.test(url || '') ? url : '';

export function render(c) {
  const company = scope === 'company' && store.isAdmin;
  const rows = findRows(rowsOf(c), filter);
  const code = company ? 'Company' : projectCode(c.project);
  return html`
    <section class="card">
      <div class="toolbar"><h2>Log sheet · ${company ? 'Company documents' : c.project.name}</h2><span class="grow"></span>
        ${store.isAdmin ? html`<select data-chg="scope" aria-label="Which log sheet">${options([['project', 'This project'], ['company', 'Company (no project)']], scope)}</select>` : ''}
      </div>
      <div class="entry">
        <input type="search" data-chg="filter" data-k="q" data-fk="ls-q" value="${filter.q}" placeholder="Search reference, subject, to, by" aria-label="Search">
        <select data-chg="filter" data-k="type" aria-label="Type"><option value="">Every type</option>${options(DOC_TYPES, filter.type)}</select>
        <label>From <input type="date" data-chg="filter" data-k="from" value="${filter.from}"></label>
        <label>To <input type="date" data-chg="filter" data-k="to" value="${filter.to}"></label>
        <input data-chg="filter" data-k="by" data-fk="ls-by" value="${filter.by}" placeholder="Prepared by" aria-label="Prepared by">
      </div>
      ${rows.length ? html`<table class="table">
        <thead><tr><th>No.</th><th>Date</th><th>Reference</th><th>Subject</th><th>Type</th><th>Submitted to</th><th>Prepared by</th><th>Version</th><th>File</th>${store.isAdmin ? html`<th></th>` : ''}</tr></thead>
        <tbody>${rows.map(r => html`<tr>
          <td class="nowrap">${noText(r)}</td><td class="nowrap">${fmtFull(r.date)}</td><td class="nowrap">${r.reference}</td>
          <td>${r.subject}${r.source === 'auto' ? html` ${chip('Made here', 'ok')}` : ''}</td><td>${typeName(r.type)}</td><td>${r.to}</td><td>${r.by}</td>
          <td>${r.version > 1 ? `v${r.version}` : 'v1'}</td>
          <td>${link(r.url) ? html`<a href="${r.url}" target="_blank" rel="noopener">Open file</a>` : html`<span class="muted">No file</span>`}</td>
          ${store.isAdmin ? html`<td><button class="btn ghost small" data-act="removeRow" data-id="${r.id}" title="Takes the row off the sheet. The Drive file stays">Remove</button></td>` : ''}
        </tr>`)}</tbody>
      </table>` : html`<p class="empty">${rowsOf(c).length ? 'Nothing matches the filters.' : 'No documents logged yet. Invoices, quotations and reports are logged when they are emailed; letters when they are issued.'}</p>`}
    </section>
    ${store.readOnly ? '' : html`<section class="card">
      <div class="toolbar"><h2>Add a document</h2><span class="muted">${notice}</span></div>
      <form data-form="addDoc" class="entry">
        <input type="date" name="date" value="${c.today}" required aria-label="Date">
        <select name="type" aria-label="Type">${options(DOC_TYPES, 'letter')}</select>
        <input name="reference" placeholder="Reference (e.g. AP-MJO-LTR-014)" aria-label="Reference">
        <input name="subject" class="wide" placeholder="Subject" required aria-label="Subject">
        <input name="to" placeholder="Submitted to" aria-label="Submitted to">
        <input name="by" value="${me()}" placeholder="Prepared by" aria-label="Prepared by">
        <input type="file" name="file" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx" aria-label="File from this computer">
        <input name="url" placeholder="or a Google Drive link" aria-label="Google Drive link">
        <button class="btn primary">Add to the log sheet</button>
      </form>
      <p class="muted">A file from this computer is saved to Google Drive in ${archiveFolder(c.today, code)} with the standard name.${mailReady() ? '' : ' Google Drive is not set up on this computer (Backup), so only a Drive link can be added here.'}</p>
    </section>`}`;
}

export const changes = {
  scope(el) { scope = el.value; notice = ''; },
  filter(el) { filter = { ...filter, [el.dataset.k]: el.value }; },
};

export const actions = {
  removeRow(el, c) {
    const company = scope === 'company';
    const r = rowsOf(c).find(x => x.id === el.dataset.id);
    if (!r || !confirm(`Take ${noText(r)} "${r.subject}" off the log sheet? The file in Google Drive is kept.`)) return;
    const off = list => { const x = (list || []).find(y => y.id === r.id); if (x) x.removed = true; };
    if (company) store.updateCompany(co => off(co.logsheet)); else store.update(ws => off(ws.logsheet));
  },
};

const readBase64 = file => new Promise((ok, fail) => {
  const fr = new FileReader();
  fr.onload = () => ok(String(fr.result).split(',')[1] || '');
  fr.onerror = () => fail(fr.error);
  fr.readAsDataURL(file);
});

export const submits = {
  addDoc(fd, c) {
    const company = scope === 'company' && store.isAdmin;
    const file = fd.get('file');
    const url = String(fd.get('url') || '').trim();
    if (url && !link(url)) { notice = 'The link must be a Google Drive address (https://drive.google.com/...).'; return false; }
    const fields = {
      date: fd.get('date') || c.today, type: fd.get('type') || 'other', reference: fd.get('reference'), subject: fd.get('subject'),
      to: fd.get('to'), by: String(fd.get('by') || '').trim() || me(), projectId: company ? '' : c.project.id, url,
    };
    const row = addRow(fields, company);
    notice = `Logged as ${row ? noText(row) : ''}.`;
    if (file && file.size && row && !url) {
      if (!mailReady()) { notice += ' The file was not saved: Google Drive is not set up on this computer.'; return; }
      const code = company ? 'Company' : projectCode(c.project);
      const ext = (String(file.name).match(/\.[a-z0-9]{1,5}$/i) || [''])[0];
      readBase64(file)
        .then(data => saveBase64(archiveName({ ...fields, code }) + ext, data, file.type || 'application/octet-stream', { folder: archiveFolder(fields.date, code) }))
        .then(out => { setFile(row.id, out, company); tell(`✓ ${noText(row)} saved to Google Drive.`); })
        .catch(err => tell(`${noText(row)} is logged, but the file was not saved: ${err?.message || err}`));
    }
  },
};
