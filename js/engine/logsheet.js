// v0.51.0 (Phase C1): the Log sheet, a record of every official document (letters, invoices, requests, reports
// and others), and the archive in Google Drive behind it. Each archived file is named and filed the same way:
// year / month / project, "YYYY-MM-DD CODE Type REF Title.pdf". Rows of a project live with the project
// (projects/<id>/logsheet), so whoever opens the project sees them; rows of no project (payroll, office letters)
// are the company's (company/main/logsheet) and the Admin's only. Pure functions; ui/logsheet.js draws the page.

export const DOC_TYPES = [
  ['letter', 'Letter'], ['invoice', 'Invoice'], ['quote', 'Quotation'], ['po', 'Purchase order'], ['report', 'Report'],
  ['request', 'Request'], ['payreport', 'Pay report'], ['contract', 'Contract'], ['other', 'Other'],
];
export const typeName = id => DOC_TYPES.find(([k]) => k === id)?.[1] || 'Other';

const clean = s => String(s ?? '').replace(/[\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

/** v0.79.0: the Drive folder of a document, Project / Category / Month: "MJO/Invoice/2026-11" ("Company/..." without a project). */
export const archiveFolder = (date, code, category = 'Other') => {
  const [y, m] = String(date || '').split('-');
  return [clean(code).replace(/[^\w \-]/g, '').trim() || 'Company', clean(category) || 'Other', `${y || '0000'}-${m || '00'}`].join('/');
};

/** The standard file name, without ".pdf": "2026-11-02 MJO Invoice INV-012 Steel works". At most 120 letters. */
export const archiveName = ({ date, code, type, reference, subject }) =>
  [String(date || '').slice(0, 10), clean(code) || 'Company', typeName(type), clean(reference), clean(subject)].filter(Boolean).join(' ').slice(0, 120);

/** The next No. of a sheet: one more than the highest of that year. */
export const nextNo = (rows, date) => {
  const year = String(date || '').slice(0, 4);
  return 1 + Math.max(0, ...(rows || []).filter(r => String(r.date || '').startsWith(year)).map(r => +r.no || 0));
};

/** A new row. A document archived again (same reference and type) becomes its next version. */
export function logRow(rows, { id, date, type = 'other', reference = '', subject = '', to = '', by = '', projectId = '', url = '', fileId = '', source = 'hand' }) {
  const same = reference ? (rows || []).filter(r => r.reference === reference && r.type === type) : [];
  return {
    id, no: nextNo(rows, date), date, type, reference: clean(reference), subject: clean(subject), to: clean(to), by: clean(by),
    projectId, url, fileId, source, version: 1 + Math.max(0, ...same.map(r => +r.version || 1)),
  };
}

/** The rows that match the filters, newest first. q looks in the reference, subject, to and by. */
export function findRows(rows, { q = '', type = '', from = '', to = '', by = '' } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  return (rows || []).filter(r => !r.removed
    && (!type || r.type === type) && (!from || r.date >= from) && (!to || r.date <= to)
    && (!by || String(r.by).toLowerCase().includes(by.toLowerCase()))
    && words.every(w => [r.reference, r.subject, r.to, r.by, typeName(r.type)].join(' ').toLowerCase().includes(w)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (+b.no || 0) - (+a.no || 0));
}

/** "LS-2026-007": the printed No. of a row. */
export const noText = r => `LS-${String(r.date || '').slice(0, 4)}-${String(r.no || 0).padStart(3, '0')}`;
