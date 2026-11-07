// v1.1.0 (owner, 7 Nov, Phase G4): the register of outgoing documents. Agreements, letters, invoices, quotations,
// purchase orders and client reports go out only after the General Manager or higher management (Owner, CEO, Board)
// approves them; the Project Engineer does not. One record per document (outgoing/<kind>_<id>): Waiting approval,
// Approved (with its own number, AP/LTR/2026/014), Sent, or Sent back with a reason. A document changed after its
// approval needs a new one (a new version; the fingerprint of its content tells). Documents that went out before the
// register are shown as "Sent before the register".

import { TOP_RANKS } from './signlog.js';

/** kind: [words, number code] */
export const KINDS = {
  agreement: ['Agreement', 'AGR'], letter: ['Letter', 'LTR'], invoice: ['Invoice', 'INV'], quote: ['Quotation', 'QUO'],
  po: ['Purchase order', 'PO'], report: ['Client report', 'RPT'],
};
export const kindWords = k => KINDS[k]?.[0] || k;
export const STATUS = { draft: 'Draft', waiting: 'Waiting approval', approved: 'Approved', changed: 'Changed after approval', returned: 'Sent back', sent: 'Sent', before: 'Sent before the register' };
export const TONE = { draft: 'warn', waiting: 'info', approved: 'ok', changed: 'bad', returned: 'bad', sent: 'ok', before: 'muted' };

/** Who approves: the Admin and Tier 1 (General Manager, Owner, CEO, Board). */
export const mayApprove = (role, ranks = []) => role === 'owner' || (ranks || []).some(r => TOP_RANKS.includes(r));
export const keyOf = (kind, id) => `${kind}_${String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60)}`;

// what changes without changing what the document says
const VOLATILE = new Set(['status', 'sentAt', 'sentTo', 'approvedAt', 'approvedBy', 'issuedAt', 'paidAt', 'payments', 'paid', 'updated', 'updatedAt',
  '_o', 'emails', 'reminders', 'remindedAt', 'history', 'log', 'seen', 'archived', 'archivedAt', 'driveId', 'signRequests', 'closedAt', 'closed', 'notes']);
const stable = v => (Array.isArray(v) ? v.map(stable) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).filter(k => !VOLATILE.has(k)).sort().map(k => [k, stable(v[k])])) : v);
/** A short fingerprint of what the document says (FNV-1a of its stable fields). */
export function fp(rec) {
  const s = JSON.stringify(stable(rec || {}));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
/** Went the document out before the register? Its own status says so. */
const WENT = new Set(['sent', 'issued', 'paid', 'accepted', 'delivered', 'signed', 'active', 'completed', 'terminated']);
/** The day the register started: a document dated before it that already went out (or an old record with no status) is not asked about. */
export const START = '2026-11-08';
export const wentBefore = (rec, start = START) => { const d = String(rec?.date || rec?.signedOn || rec?.signed || rec?.start || ''); return (WENT.has(rec?.status) || !rec?.status) && (!d || d < start); };

/** Where a document stands: draft, waiting, approved, changed, returned, sent, before. */
export function stateOf(entry, rec, start = START) {
  if (!entry) return rec && wentBefore(rec, start) ? 'before' : 'draft';
  if (entry.status === 'waiting') return entry.fp && rec && fp(rec) !== entry.fp ? 'draft' : 'waiting';
  if (entry.status === 'approved' || entry.status === 'sent') return rec && entry.fp !== fp(rec) ? 'changed' : entry.status;
  return entry.status === 'returned' ? 'returned' : 'draft';
}
/** May it be shared, emailed or sent? Approved (and unchanged), sent, or sent before the register. */
export const okToSend = state => state === 'approved' || state === 'sent' || state === 'before';

const s = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
/** Ask for approval: a new record, or the next version of one sent back or changed. */
export function askEntry({ kind, rec, no = '', title = '', to = '', project = '', projectName = '', by, byName = '', note = '' }, prev = null, at = new Date().toISOString()) {
  return {
    id: keyOf(kind, rec.id), kind, docId: s(rec.id, 60), no: s(no, 40), title: s(title, 120), to: s(to, 160), project: s(project, 60), projectName: s(projectName, 80),
    by: s(by, 120).toLowerCase(), byName: s(byName, 80), at, status: 'waiting', fp: fp(rec), version: (prev?.version || 0) + 1, note: s(note, 300),
    ref: prev?.ref || '', decidedBy: '', decidedName: '', decidedAt: '', reason: '', sentAt: '', sentBy: '', channel: '',
    log: [...(prev?.log || []), { at, by: s(byName || by, 80), what: prev ? `asked again (version ${(prev.version || 0) + 1})` : 'asked for approval' }].slice(-30),
  };
}
/** The next number of a kind in a year: AP/LTR/2026/014. */
export function nextRef(entries, kind, year, code = 'AP') {
  const head = `${code}/${KINDS[kind]?.[1] || 'DOC'}/${year}/`;
  const n = Math.max(0, ...(entries || []).map(e => String(e.ref || '')).filter(r => r.startsWith(head)).map(r => +r.slice(head.length) || 0));
  return `${head}${String(n + 1).padStart(3, '0')}`;
}
/** Approve or send back. Returns the changed record; approving keeps the number of an earlier version. */
export function decide(entry, { ok, by, byName, title = '', reason = '', entries = [], code = 'AP', at = new Date().toISOString() }) {
  const e = { ...entry, decidedBy: s(by, 120).toLowerCase(), decidedName: s(byName, 80), decidedTitle: s(title, 60), decidedAt: at };
  if (ok) { e.status = 'approved'; e.reason = ''; e.ref = entry.ref || nextRef(entries, entry.kind, at.slice(0, 4), code); }
  else { e.status = 'returned'; e.reason = s(reason, 300); }
  e.log = [...(entry.log || []), { at, by: s(byName || by, 80), what: ok ? `approved as ${e.ref}` : `sent back: ${e.reason}` }].slice(-30);
  return e;
}
/** It went out (shared, emailed, WhatsApp or Telegram). */
export const sentEntry = (entry, { by, channel, at = new Date().toISOString() }) => ({
  ...entry, status: 'sent', sentAt: entry.sentAt || at, sentBy: s(by, 80), channel: s(channel, 40),
  log: [...(entry.log || []), { at, by: s(by, 80), what: `sent (${s(channel, 40)})` }].slice(-30),
});

/** The register: filtered, newest first. f: { kind, status, project, q } */
export function filtered(entries, f = {}) {
  const q = String(f.q || '').toLowerCase();
  return [...(entries || [])].filter(e => (!f.kind || e.kind === f.kind) && (!f.status || e.status === f.status) && (!f.project || e.project === f.project)
    && (!q || `${e.no} ${e.ref} ${e.title} ${e.to} ${e.byName}`.toLowerCase().includes(q))).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
/** Waiting for an approver. */
export const waiting = entries => (entries || []).filter(e => e.status === 'waiting');
/** The rows of the Excel (CSV) export. */
export function csvRows(entries) {
  return [['Number', 'Approval ref', 'Type', 'Title', 'To', 'Project', 'Prepared by', 'Asked', 'Status', 'Decided by', 'Decided', 'Reason', 'Sent', 'Channel', 'Version'],
    ...entries.map(e => [e.no, e.ref, kindWords(e.kind), e.title, e.to, e.projectName, e.byName || e.by, String(e.at).slice(0, 16).replace('T', ' '), STATUS[e.status] || e.status,
      e.decidedName, String(e.decidedAt || '').slice(0, 16).replace('T', ' '), e.reason, String(e.sentAt || '').slice(0, 16).replace('T', ' '), e.channel, e.version])];
}
