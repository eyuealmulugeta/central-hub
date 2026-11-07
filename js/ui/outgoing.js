// v1.1.0 (owner, 7 Nov, Phase G4): the outgoing register. The strip above every outgoing document (letters,
// invoices, quotations, purchase orders, client reports, agreements), the mark inside the document (DRAFT, not
// approved, or the approval line with its number and the company stamp), Approve and Send back for the General
// Manager and higher management, and the Register page (Dashboard > Outgoing register).

import { store } from '../core/store.js';
import { html, chip, options } from './dom.js';
import { toCSV, downloadText, fmtFull } from '../core/util.js';
import { KINDS, STATUS, TONE, stateOf, okToSend, askEntry, decide, sentEntry, mayApprove, keyOf, kindWords, filtered, csvRows, waiting } from '../engine/outgoing.js';
import { companyCode } from '../engine/docref.js';
import { stampPng } from './seal.js';
import { pushUrgent, fieldReady } from '../sync/fieldreport.js';
import { titleLabel } from '../engine/titles.js';

/** kind -> id -> { rec, no, title, to, project, projectName }: each document page says how to find its own. */
const finders = {};
export const register = (kinds, fn) => { for (const k of [].concat(kinds)) finders[k] = fn; };
const found = (kind, id) => { try { return finders[kind]?.(id) || null; } catch { return null; } };

export const iApprove = () => mayApprove(store.role, store.ranks);
export const entryOf = (kind, rec) => (store.outgoing || []).find(e => e.id === keyOf(kind, rec?.id)) || null;
export const stateFor = (kind, rec) => stateOf(entryOf(kind, rec), rec);
export const sendOk = (kind, rec) => okToSend(stateFor(kind, rec));
const myName = () => store.profile?.name || store.user?.name || store.user?.email || 'Admin';
const myTitle = () => (store.role === 'owner' ? 'Admin' : (store.ranks || []).map(r => titleLabel(r)).find(Boolean) || '');

/** The strip above an outgoing document: where it stands, and the one thing to do next. */
export function outBar(kind, rec) {
  if (!rec?.id) return '';
  const e = entryOf(kind, rec), st = stateOf(e, rec), boss = iApprove();
  const a = (act, words, cls = '') => html`<button type="button" class="btn small ${cls}" data-act="${act}" data-kind="${kind}" data-id="${rec.id}">${words}</button>`;
  const line = st === 'waiting' ? `Asked by ${e.byName || e.by} on ${fmtFull(e.at.slice(0, 10))}${e.version > 1 ? ` · version ${e.version}` : ''}. Only the GM, Owner, CEO or Board approves.`
    : st === 'approved' ? `${e.ref} · approved by ${e.decidedName} on ${fmtFull(e.decidedAt.slice(0, 10))}. It may be sent.`
    : st === 'sent' ? `${e.ref} · sent ${fmtFull(String(e.sentAt).slice(0, 10))}${e.channel ? ` (${e.channel})` : ''}.`
    : st === 'returned' ? `Sent back by ${e.decidedName}: ${e.reason}`
    : st === 'changed' ? `Changed after ${e.ref} was approved. Ask again before it goes out.`
    : st === 'before' ? 'Went out before the register started.'
    : 'Not approved: it cannot be shared, emailed or sent yet. A print or PDF says DRAFT.';
  const next = st === 'waiting' ? (boss ? html`${a('outApprove', 'Approve', 'primary')}${a('outReturn', 'Send back')}` : '')
    : ['draft', 'returned', 'changed'].includes(st) ? (boss ? a('outApprove', 'Approve', 'primary') : a('outAsk', 'Ask for approval', 'primary')) : '';
  return html`<div class="out-bar no-print tone-${TONE[st]}" data-out-kind="${kind}" data-out-id="${rec.id}" data-out-ok="${okToSend(st) ? '1' : '0'}">
    <b>Outgoing ${kindWords(kind).toLowerCase()}</b> ${chip(STATUS[st], TONE[st])} <span class="muted">${line}</span><span class="grow"></span>${next}</div>`;
}

/** Inside the document (it goes into the print and the PDF): DRAFT while not approved, the approval line once it is. */
export function outMark(kind, rec) {
  if (!rec?.id) return '';
  const e = entryOf(kind, rec), st = stateOf(e, rec);
  if (st === 'before') return '';
  if (st === 'approved' || st === 'sent') {
    const png = stampPng();
    return html`<div class="out-ok-mark" style="display:flex;align-items:center;gap:12px;margin-top:14px;padding-top:8px;border-top:1px solid #ccc;font-size:11px;color:#333">
      ${png ? html`<img src="${png}" alt="Company stamp" style="height:56px;width:auto;opacity:.85">` : ''}
      <span>Approved for issue · <b>${e.ref}</b><br>${e.decidedName}${e.decidedTitle ? `, ${e.decidedTitle}` : ''} · ${fmtFull(String(e.decidedAt).slice(0, 10))}</span></div>`;
  }
  return html`<div class="out-draft-mark" style="border:2px solid #c62828;color:#c62828;text-align:center;font-weight:700;letter-spacing:2px;padding:4px;margin:0 0 10px;font-size:13px">DRAFT · NOT APPROVED · NOT FOR SENDING</div>`;
}

/** Before it goes out by email from a document page: false (and a message) while it is not approved. */
export function guard(kind, rec, tell = msg => alert(msg)) {
  if (!rec?.id || sendOk(kind, rec)) return true;
  tell(`This ${kindWords(kind).toLowerCase()} is not approved yet. ${iApprove() ? 'Approve it first (the button above it).' : 'Ask for approval first: only the GM, Owner, CEO or Board approves.'}`);
  return false;
}

const approverEmails = () => (store.users || []).filter(u => mayApprove(u.role, u.ranks)).map(u => String(u.email).toLowerCase());
const phone = (id, title, text, emails) => { if (!fieldReady() || !emails.length) return; pushUrgent({ id, title, text, emails }).catch(() => {}); };

/** Ask for approval, approve, send back (from a document page or the Register). */
export const outActions = {
  outAsk(el) {
    const kind = el.dataset.kind, f = found(kind, el.dataset.id);
    if (!f?.rec) return;
    const prev = entryOf(kind, f.rec);
    const note = prompt(`Ask the GM or higher management to approve ${kindWords(kind).toLowerCase()} ${f.no || ''}?\n\nA note for the approver (optional):`, '');
    if (note === null) return;
    const e = askEntry({ kind, rec: f.rec, no: f.no, title: f.title, to: f.to, project: f.project, projectName: f.projectName, by: store.user?.email, byName: myName(), note }, prev);
    store.putOutgoing(e);
    phone(`out-${e.id}-${e.version}`, `Approval asked: ${kindWords(kind)} ${f.no || ''}`, `${myName()} asks you to approve ${kindWords(kind).toLowerCase()} ${f.no || ''}${f.to ? ` to ${f.to}` : ''}${f.projectName ? ` (${f.projectName})` : ''}. Open Central Hub, Outgoing register.`, approverEmails());
  },
  outApprove(el) {
    if (!iApprove()) { alert('Only the GM, Owner, CEO or Board approves outgoing documents.'); return; }
    const kind = el.dataset.kind, f = found(kind, el.dataset.id), prev = f?.rec ? entryOf(kind, f.rec) : (store.outgoing || []).find(x => x.kind === kind && x.docId === el.dataset.id);
    if (!f?.rec && !prev) return;
    if (!confirm(`Approve ${kindWords(kind).toLowerCase()} ${f?.no || prev?.no || ''} for issue? It gets its approval number and may then be shared, emailed and sent.`)) return;
    const base = prev && prev.status === 'waiting' && (!f?.rec || stateOf(prev, f.rec) === 'waiting') ? prev
      : askEntry({ kind, rec: f.rec, no: f.no, title: f.title, to: f.to, project: f.project, projectName: f.projectName, by: store.user?.email, byName: myName() }, prev);
    const e = decide(base, { ok: true, by: store.user?.email, byName: myName(), title: myTitle(), entries: store.outgoing, code: companyCode(store.global?.company) });
    store.putOutgoing(e);
    if (e.by !== String(store.user?.email || '').toLowerCase()) phone(`outok-${e.id}-${e.version}`, `Approved: ${kindWords(kind)} ${e.no}`, `${myName()} approved ${kindWords(kind).toLowerCase()} ${e.no} as ${e.ref}. It may be sent.`, [e.by]);
  },
  outReturn(el) {
    if (!iApprove()) return;
    const kind = el.dataset.kind, prev = (store.outgoing || []).find(x => x.kind === kind && x.docId === el.dataset.id);
    if (!prev) return;
    const reason = prompt(`Send ${kindWords(kind).toLowerCase()} ${prev.no} back to ${prev.byName || prev.by}. What must change?`, '');
    if (!reason || !reason.trim()) return;
    const e = decide(prev, { ok: false, by: store.user?.email, byName: myName(), title: myTitle(), reason });
    store.putOutgoing(e);
    phone(`outno-${e.id}-${e.version}`, `Sent back: ${kindWords(kind)} ${e.no}`, `${myName()}: ${e.reason}`, [e.by]);
  },
};

/** It went out from this page (share sheet, WhatsApp, Telegram, email): an approved document is marked Sent. */
export function markSent(bar, channel) {
  if (!bar || bar.dataset.outOk !== '1') return;
  const e = (store.outgoing || []).find(x => x.id === keyOf(bar.dataset.outKind, bar.dataset.outId));
  if (e && e.status === 'approved') store.putOutgoing(sentEntry(e, { by: myName(), channel }));
}

// ---- the Register page ----
let f = { kind: '', status: '', q: '' };

/** Home: what waits for this approver, and what came back to the person who asked. */
export function homeBox() {
  const all = store.outgoing || [];
  if (iApprove()) {
    const w = waiting(all);
    if (!w.length) return '';
    return html`<section class="card xact"><h3>Waiting for your approval · ${w.length} <a class="xlink2" href="#outgoing">Register</a></h3><ul class="xlist">${w.slice(0, 6).map(e => html`<li><span class="tag">${kindWords(e.kind)}</span><span class="xt"><b>${e.no} ${e.title}</b><br><small>${[e.byName, e.projectName, e.to].filter(Boolean).join(' · ')}</small></span>
      <button type="button" class="btn small primary" data-act="outApprove" data-kind="${e.kind}" data-id="${e.docId}">Approve</button></li>`)}</ul></section>`;
  }
  const mine = all.filter(e => e.by === String(store.user?.email || '').toLowerCase() && ['returned', 'approved'].includes(e.status)).slice(0, 5);
  return mine.length ? html`<section class="card xact"><h3>Your outgoing documents <a class="xlink2" href="#outgoing">Register</a></h3><ul class="xlist">${mine.map(e => html`<li><span class="tag">${STATUS[e.status]}</span><span class="xt"><b>${kindWords(e.kind)} ${e.no}</b><br><small>${e.status === 'returned' ? e.reason : e.ref}</small></span></li>`)}</ul></section>` : '';
}

export function render(c) {
  const all = store.outgoing || [], list = filtered(all, f), boss = iApprove();
  return html`<section class="card wide">
    <div class="toolbar"><h2>Outgoing register</h2><span class="muted">Agreements, letters, invoices, quotations, purchase orders and client reports. They go out only after the GM, Owner, CEO or Board approves.</span><span class="grow"></span>
      <button type="button" class="btn" data-act="outCsv" ${list.length ? '' : 'disabled'}>Excel</button></div>
    <div class="actions left">
      <select data-chg="outF" data-k="kind" aria-label="Type"><option value="">All types</option>${options(Object.keys(KINDS).map(k => [k, kindWords(k)]), f.kind)}</select>
      <select data-chg="outF" data-k="status" aria-label="Status"><option value="">All statuses</option>${options(['waiting', 'approved', 'sent', 'returned'].map(k => [k, STATUS[k]]), f.status)}</select>
      <input data-chg="outF" data-k="q" value="${f.q}" placeholder="Number, title, to, who" aria-label="Find">
      <span class="muted">${list.length} of ${all.length}${boss ? ` · ${waiting(all).length} waiting for approval` : ''}</span>
    </div>
    ${list.length ? html`<div class="table-wrap"><table class="table compact">
      <thead><tr><th>Number</th><th>Approval no.</th><th>Type</th><th>Title</th><th>To</th><th>Project</th><th>Prepared by</th><th>Asked</th><th>Status</th><th>Decided</th><th></th></tr></thead>
      <tbody>${list.map(e => html`<tr>
        <td class="nowrap">${e.no}</td><td class="nowrap">${e.ref || ''}</td><td>${kindWords(e.kind)}</td><td>${e.title}${e.note ? html`<br><small class="muted">${e.note}</small>` : ''}</td><td>${e.to}</td><td>${e.projectName}</td>
        <td>${e.byName || e.by}</td><td class="nowrap">${fmtFull(String(e.at).slice(0, 10))}</td>
        <td>${chip(STATUS[e.status] || e.status, TONE[e.status])}${e.version > 1 ? html` <small class="muted">v${e.version}</small>` : ''}${e.status === 'returned' ? html`<br><small>${e.reason}</small>` : ''}${e.status === 'sent' && e.channel ? html`<br><small class="muted">${e.channel}</small>` : ''}</td>
        <td>${e.decidedName ? html`${e.decidedName}<br><small class="muted">${fmtFull(String(e.decidedAt).slice(0, 10))}</small>` : ''}</td>
        <td class="nowrap">${boss && e.status === 'waiting' ? html`<button type="button" class="btn small primary" data-act="outApprove" data-kind="${e.kind}" data-id="${e.docId}">Approve</button><button type="button" class="btn small" data-act="outReturn" data-kind="${e.kind}" data-id="${e.docId}">Send back</button>` : ''}</td>
      </tr>`)}</tbody></table></div>` : html`<p class="empty">Nothing in the register yet. Use "Ask for approval" on a letter, invoice, quotation, purchase order, client report or contract.</p>`}
    <p class="muted">Who shared or emailed each document: Dashboard, Activity record. Documents that went out before the register show "Sent before the register" on their own page.</p>
  </section>`;
}
export const actions = {
  ...outActions,
  outCsv() { downloadText(`Outgoing register ${new Date().toISOString().slice(0, 10)}.csv`, toCSV(csvRows(filtered(store.outgoing || [], f)))); },
};
export const changes = { outF(el) { f = { ...f, [el.dataset.k]: el.value }; } };
