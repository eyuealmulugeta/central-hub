// Requests: material, manpower and equipment asked for by the site. A Site Engineer raises a
// request, the Project Engineer or Admin approves or refuses it, the office arranges it, and the
// site confirms it arrived. An approved request becomes a follow-up for the office. Each request
// prints on the letterhead and can be emailed as a PDF, for example to a supplier.

import { store } from '../core/store.js';
import { poFromRequest } from '../engine/purchases.js';   // v1.4.0 (R6)
import { makeDoc } from '../engine/billing.js';
import {
  sent, KINDS, PRIORITIES, DEFAULT_UNIT, kindLabel, statusLabel, isOpen, moves, editable, overdue, nextNumber, check, titleOf, followUp, summary,
} from '../engine/requests.js';
import { uid, fmtFull } from '../core/util.js';
import { paperHtml } from '../sync/mail.js';
import { html, options, chip } from './dom.js';
import { docHead, docSec, footText, signoff } from './print.js';
import { docRef } from '../engine/docref.js';
import { openMail, emailIn } from './maildialog.js';
import { levelOf, expenseWaiting, isWaiting, approvalLimits, LEVEL_SHORT } from '../engine/expenses.js';
import { isExpense, expenseMoves, expenseStatus, expenseStep, checkExpense, expenseTitle, costOf, isGM, limitOf, overLimit, EXPENSE_CATEGORIES, PAY_METHODS, RECEIPT } from '../engine/expenses.js';
import { pictureFor, tell } from '../core/image.js';
import { money } from '../core/util.js';

let selected = null;
let filter = null;          // waiting | open | done | all; chosen from the person's role until they pick one
let notice = '';
let problems = [];

/** The moment now on this device's clock, like 2026-10-19T08:15 (not UTC, so the date matches the person's day). */
const stamp = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const approver = () => store.role === 'owner' || store.role === 'office';
const me = () => ({ email: (store.user?.email || '').toLowerCase(), name: store.profile.name || store.user?.name || 'Admin' });
const find = ws => ws.requests.find(r => r.id === selected);
const STATUS_CLASS = { requested: 'warn', approved: 'info', arranging: 'info', fulfilled: 'ok', rejected: 'high', cancelled: '', gm: 'warn', paid: 'ok' };
// v0.61.0: an expense has its own steps and words (engine/expenses.js)
const gm = () => isGM({ role: store.role, ranks: store.ranks });
const level = () => levelOf({ role: store.role, ranks: store.ranks });
const movesOf = (r, c) => (isExpense(r) ? expenseMoves(r, { approver: approver(), level: level(), me: me().email, settings: c.global }) : moves(r.status, approver()));
const labelOf = r => (isExpense(r) ? (isWaiting(r) ? expenseWaiting(r, store.global) : expenseStatus(r.status)) : statusLabel(r.status));
const titleFor = r => (isExpense(r) ? expenseTitle(r) : titleOf(r));
let receipt = null;   // the receipt photo chosen for a new expense, made small

export function render(c) {
  const r = find(c.ws);
  return r ? detail(r, c) : list(c);
}

function list(c) {
  const all = c.ws.requests.filter(sent).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.number.localeCompare(a.number));
  const s = summary(all, c.today);
  const on = filter || (approver() ? 'waiting' : 'open');
  const shown = all.filter(r => (on === 'waiting' ? ['requested', 'gm'].includes(r.status) : on === 'open' ? isOpen(r) : on === 'done' ? !isOpen(r) : on === 'expenses' ? isExpense(r) : true));
  const nEx = all.filter(r => isExpense(r) && isOpen(r)).length;
  const payCur = c.project.payCurrency === 'USD' ? 'USD' : 'ETB';
  const tasks = c.ws.tasks.filter(t => !t.milestone).map(t => [t.id, t.name]);
  const tab = (id, label, n) => html`<button type="button" class="btn small ${on === id ? 'primary' : ''}" data-act="filter" data-k="${id}">${label}${n != null ? ` (${n})` : ''}</button>`;
  return html`
    <section class="card">
      <div class="toolbar"><h2>New request</h2><span class="muted">${notice}</span></div>
      ${problems.length ? html`<ul class="plain bad">${problems.map(p => html`<li>${p}</li>`)}</ul>` : ''}
      <form data-form="newRequest">
        <div class="grid2">
          <label>What is it for <select name="kind">${options(KINDS, 'material')}</select></label>
          <label>Priority <select name="priority">${options(PRIORITIES, 'normal')}</select></label>
          <label>Needed by <input type="date" name="neededBy" required min="${c.today}"></label>
          <label>For which task <select name="taskId"><option value="">Not tied to a task</option>${options(tasks, null)}</select></label>
        </div>
        <div class="entry">
          <input name="description" class="wide" required placeholder="What is needed, e.g. Roof sheeting 0.5 mm, or Welder" aria-label="What is needed">
          <input name="qty" type="number" min="0" step="any" required placeholder="Quantity" aria-label="Quantity" class="amount">
          <input name="unit" placeholder="Unit (pcs, m², people…)" aria-label="Unit" class="amount">
        </div>
        <label>Why it is needed (optional) <textarea name="purpose" rows="2" placeholder="What work it is for and what happens if it is late"></textarea></label>
        <div class="actions left"><button class="btn primary">Send the request</button><span class="muted">You can add more lines to it after sending.</span></div>
      </form>
    </section>
    <section class="card">
      <div class="toolbar"><h2>New expense</h2><span class="muted">${(L => `The Site Engineer approves up to ${money(L.site_engineer.ETB, 'ETB')}, the Project Engineer up to ${money(L.project_manager.ETB, 'ETB')}; above that, and any USD amount, the GM.`)(approvalLimits(c.global))} Approved expenses go into the Ledger costs.</span></div>
      <form data-form="newExpense">
        <div class="grid2">
          <label>What it is for <input name="description" required placeholder="e.g. Diesel for the generator, 40 litres"></label>
          <label>Paid to (optional) <input name="vendor" placeholder="Shop or person"></label>
          <label>Amount <input name="amount" type="number" min="0" step="any" required class="amount"></label>
          <label>Currency <select name="currency">${options([['ETB', 'ETB'], ['USD', 'USD']], payCur)}</select></label>
          <label>Category <select name="category">${options(EXPENSE_CATEGORIES, 'material')}</select></label>
          <label>Receipt photo <input type="file" accept="image/*" data-chg="receipt"></label>
        </div>
        ${receipt ? html`<p class="muted">Receipt ready <img class="receipt-thumb" src="${receipt}" alt="Receipt"></p>` : ''}
        <label>Why it is needed (optional) <textarea name="purpose" rows="2"></textarea></label>
        <div class="actions left"><button class="btn primary">Send for approval</button></div>
      </form>
    </section>
    <section class="card">
      <div class="toolbar"><h2>Requests</h2>
        ${tab('waiting', 'Waiting for approval', all.filter(r => ['requested', 'gm'].includes(r.status)).length)}${tab('open', 'Open', s.open)}${tab('expenses', 'Expenses', nEx)}${tab('done', 'Closed')}${tab('all', 'All')}
        <span class="grow"></span><span class="muted">${s.overdue ? `${s.overdue} past the date needed` : ''}${s.urgent ? `${s.overdue ? ', ' : ''}${s.urgent} urgent` : ''}</span></div>
      ${shown.length ? html`<table class="table">
        <thead><tr><th>Number</th><th>What</th><th>Needed by</th><th>Priority</th><th>Status</th><th>Asked by</th></tr></thead>
        <tbody>${shown.map(r => html`<tr class="click" data-act="open" data-id="${r.id}">
          <td class="nowrap"><button class="link" type="button">${r.number}</button> <span class="muted note">${kindLabel(r.kind)}</span></td>
          <td>${titleFor(r)}</td>
          <td class="nowrap ${overdue(r, c.today) ? 'bad' : ''}">${r.neededBy ? fmtFull(r.neededBy) : ''}${overdue(r, c.today) ? ' (late)' : ''}</td>
          <td>${r.priority === 'urgent' ? chip('Urgent', 'high') : ''}</td>
          <td>${chip(labelOf(r), STATUS_CLASS[r.status])}</td>
          <td>${r.byName || r.by}</td></tr>`)}</tbody>
      </table>` : html`<p class="empty">${all.length ? 'Nothing in this list.' : 'No requests yet.'}</p>`}
    </section>`;
}

function detail(r, c) {
  if (isExpense(r)) return expenseDetail(r, c);
  const can = approver();
  const edit = editable(r, can);
  const tasks = c.ws.tasks.filter(t => !t.milestone).map(t => [t.id, t.name]);
  const taskName = c.ws.tasks.find(t => t.id === r.taskId)?.name || '';
  const lines = (r.lines || []).filter(l => String(l.description || '').trim() || edit);
  const decided = [...(r.log || [])].reverse().find(x => x.status === 'approved');
  const showDays = r.kind === 'manpower' || lines.some(l => l.days);
  return html`
    <div class="toolbar no-print">
      <button class="btn ghost" data-act="back">← Requests</button>
      <span class="muted">${r.number}${r.emails?.length ? `. Emailed to ${r.emails.at(-1).to} on ${fmtFull(r.emails.at(-1).at)}` : ''}</span>
      <span class="grow"></span>
      ${moves(r.status, can).map(([to, label]) => html`<button class="btn ${to === 'approved' || to === 'fulfilled' ? 'primary' : ''}" data-act="move" data-to="${to}">${label}</button>`)}
      ${can && r.kind === 'material' && ['approved', 'arranging'].includes(r.status) ? (c.ws.docs || []).some(d => d.type === 'po' && d.reqId === r.id) ? html`<span class="muted">PO ${c.ws.docs.filter(d => d.type === 'po' && d.reqId === r.id).map(d => d.number).join(', ')}</span>` : html`<button class="btn primary" data-act="reqPo">Make purchase order</button>` : ''}
      <button class="btn" data-act="email">Email as PDF</button>
      <button class="btn" data-share title="Send this document as a PDF file on WhatsApp or Telegram">WhatsApp / Telegram</button>
      <button class="btn" data-act="print">Print</button>
      <button class="btn danger" data-act="removeRequest">Delete</button>
    </div>
    ${notice ? html`<p class="ok no-print">${notice}</p>` : ''}
    ${problems.length ? html`<ul class="plain bad no-print">${problems.map(p => html`<li>${p}</li>`)}</ul>` : ''}
    ${edit ? html`<section class="card no-print"><div class="grid2">
      <label>Needed by <input type="date" data-chg="set" data-f="neededBy" data-fk="rq-need" value="${r.neededBy || ''}"></label>
      <label>Priority <select data-chg="set" data-f="priority" data-fk="rq-pri">${options(PRIORITIES, r.priority)}</select></label>
      <label>For which task <select data-chg="set" data-f="taskId" data-fk="rq-task"><option value="">Not tied to a task</option>${options(tasks, r.taskId || null)}</select></label>
    </div>
    <label>Why it is needed <textarea data-chg="set" data-f="purpose" data-fk="rq-why" rows="2">${r.purpose || ''}</textarea></label>
    ${(r.lines || []).length ? html`<table class="table compact"><thead><tr><th>What</th><th class="r">Quantity</th><th>Unit</th>${showDays ? html`<th class="r">Days</th>` : ''}<th>Note</th><th></th></tr></thead>
      <tbody>${r.lines.map(l => html`<tr>
        <td><input data-chg="line" data-id="${l.id}" data-f="description" data-fk="rl-d-${l.id}" value="${l.description || ''}" aria-label="What"></td>
        <td class="r"><input class="price" type="number" min="0" step="any" data-chg="line" data-id="${l.id}" data-f="qty" data-fk="rl-q-${l.id}" value="${l.qty ?? ''}" aria-label="Quantity"></td>
        <td><input data-chg="line" data-id="${l.id}" data-f="unit" data-fk="rl-u-${l.id}" value="${l.unit || ''}" aria-label="Unit"></td>
        ${showDays ? html`<td class="r"><input class="price" type="number" min="0" step="any" data-chg="line" data-id="${l.id}" data-f="days" data-fk="rl-y-${l.id}" value="${l.days ?? ''}" aria-label="Days"></td>` : ''}
        <td><input data-chg="line" data-id="${l.id}" data-f="note" data-fk="rl-n-${l.id}" value="${l.note || ''}" aria-label="Note"></td>
        <td class="r"><button class="btn ghost small" data-act="cutLine" data-id="${l.id}">Take out</button></td></tr>`)}</tbody></table>` : ''}
    <form data-form="addLine" class="entry">
      <input name="description" class="wide" required placeholder="Another item or trade" aria-label="What">
      <input name="qty" type="number" min="0" step="any" required placeholder="Quantity" aria-label="Quantity" class="amount">
      <input name="unit" placeholder="Unit" value="${DEFAULT_UNIT[r.kind] || ''}" aria-label="Unit" class="amount">
      <button class="btn">Add line</button>
    </form></section>` : ''}
    ${(r.log || []).length ? html`<section class="card no-print"><h3>History</h3><ul class="plain">${r.log.map(x => html`<li>${fmtFull(x.at.slice(0, 10))}: <b>${statusLabel(x.status)}</b> by ${x.byName || x.by}${x.note ? html`. ${x.note}` : ''}</li>`)}</ul></section>` : ''}
    <section class="card sheet"><div class="paper dsr doc-paper" data-foot="${footText(c, `${kindLabel(r.kind)} request`, reqRef(c, r))}">
      ${docHead(c, { title: `${kindLabel(r.kind)} request`, sub: c.project.name, ref: reqRef(c, r), status: statusLabel(r.status), tone: r.status === 'rejected' ? 'bad' : decided ? 'ok' : 'warn',
        facts: [['Date', fmtFull(r.date)], ['Needed by', r.neededBy ? fmtFull(r.neededBy) : '—'], ['Priority', r.priority === 'urgent' ? 'URGENT' : 'Normal'], ['For the task', taskName]] })}
      ${docSec(1, 'Items', html`<table class="dsr-t"><thead><tr><th>#</th><th>Description</th><th class="r">Quantity</th><th>Unit</th>${showDays ? html`<th class="r">Days</th>` : ''}<th>Note</th></tr></thead>
        <tbody>${lines.map((l, i) => html`<tr><td>${i + 1}</td><td>${l.description || ''}</td><td class="r">${l.qty ?? ''}</td><td>${l.unit || ''}</td>${showDays ? html`<td class="r">${l.days ?? ''}</td>` : ''}<td>${l.note || ''}</td></tr>`)}</tbody></table>`, `${lines.length} line${lines.length === 1 ? '' : 's'}`)}
      ${r.purpose ? docSec(2, 'Why it is needed', html`<p class="pre">${r.purpose}</p>`) : ''}
      ${docSec(r.purpose ? 3 : 2, 'Approval', html`${(r.log || []).length ? html`<table class="dsr-t"><thead><tr><th>Date</th><th>Step</th><th>By</th><th>Note</th></tr></thead>
        <tbody>${r.log.map(x => html`<tr><td class="nowrap">${fmtFull(x.at.slice(0, 10))}</td><td>${statusLabel(x.status)}</td><td>${x.byName || x.by}</td><td>${x.note || ''}</td></tr>`)}</tbody></table>` : ''}
        ${signoff([{ label: 'Requested by', name: [r.byName || r.by, r.byTitle].filter(Boolean).join(', '), note: fmtFull(r.date) },
          { label: r.status === 'rejected' ? 'Refused by' : 'Approved by', name: decided ? decided.byName || decided.by : '', note: decided ? fmtFull(decided.at.slice(0, 10)) : 'Date' }])}`)}
    </div></section>`;
}

/** v0.61.0: one expense: its figures, receipt, steps, and paying it once approved. */
function expenseDetail(r, c) {
  const edit = r.status === 'requested';
  // v0.69.0: the approval steps as they happened, each with the approver's position
  const approvals = (r.log || []).filter(x => x.status === 'approved' || x.status === 'gm');
  const waitFor = isWaiting(r) ? expenseWaiting(r, c.global).replace('Waiting for the ', '') : '';
  return html`
    <div class="toolbar no-print">
      <button class="btn ghost" data-act="back">← Requests</button>
      <span class="muted">${r.number}</span><span class="grow"></span>
      ${movesOf(r, c).filter(([to]) => to !== 'paid').map(([to, label]) => html`<button class="btn ${['approved', 'gm'].includes(to) ? 'primary' : ''}" data-act="move" data-to="${to}">${label}</button>`)}
      <button class="btn" data-share title="Send this document as a PDF file on WhatsApp or Telegram">WhatsApp / Telegram</button>
      <button class="btn" data-act="print">Print</button>
      <button class="btn danger" data-act="removeRequest">Delete</button>
    </div>
    ${notice ? html`<p class="ok no-print">${notice}</p>` : ''}
    ${edit ? html`<section class="card no-print"><div class="grid2">
      <label>What it is for <input data-chg="exLine" data-fk="ex-d" value="${r.lines?.[0]?.description || ''}"></label>
      <label>Paid to <input data-chg="set" data-f="vendor" data-fk="ex-v" value="${r.vendor || ''}"></label>
      <label>Amount <input type="number" min="0" step="any" data-chg="exAmount" data-fk="ex-a" value="${r.amount ?? ''}"></label>
      <label>Currency <select data-chg="set" data-f="currency" data-fk="ex-c">${options([['ETB', 'ETB'], ['USD', 'USD']], r.currency)}</select></label>
      <label>Category <select data-chg="set" data-f="category" data-fk="ex-k">${options(EXPENSE_CATEGORIES, r.category)}</select></label>
    </div></section>` : ''}
    ${r.status === 'approved' && approver() ? html`<section class="card no-print"><h3>Pay it</h3>
      <form data-form="payExpense" class="grid2">
        <label>Paid by <select name="method">${options(PAY_METHODS, 'bank')}</select></label>
        <label>Bank or receipt reference <input name="ref" placeholder="As on the bank statement"></label>
        <label>Paid on <input type="date" name="date" value="${c.today}" required></label>
        <div class="actions left"><button class="btn primary">Mark as paid</button></div>
      </form></section>` : ''}
    <section class="card sheet"><div class="paper dsr doc-paper" data-foot="${footText(c, 'Expense', reqRef(c, r))}">
      ${docHead(c, { title: 'Expense', sub: c.project.name, ref: reqRef(c, r), status: expenseStatus(r.status), tone: r.status === 'rejected' ? 'bad' : ['approved', 'paid'].includes(r.status) ? 'ok' : 'warn',
        facts: [['Date', fmtFull(r.date)], ['Amount', money(+r.amount || 0, r.currency)], ['Category', EXPENSE_CATEGORIES.find(([k]) => k === r.category)?.[1] || ''], ['Paid to', r.vendor || '—']] })}
      ${docSec(1, 'What it is for', html`<p class="pre">${r.lines?.[0]?.description || ''}${r.purpose ? `\n\n${r.purpose}` : ''}</p>`)}
      ${r.receipt ? docSec(2, 'Receipt', html`<img class="receipt" src="${r.receipt}" alt="Receipt">`) : ''}
      ${docSec(r.receipt ? 3 : 2, 'Approval and payment', html`${(r.log || []).length ? html`<table class="dsr-t"><thead><tr><th>Date</th><th>Step</th><th>By</th><th>Note</th></tr></thead>
        <tbody>${r.log.map(x => html`<tr><td class="nowrap">${fmtFull(x.at.slice(0, 10))}</td><td>${expenseStep(x.status)}</td><td>${x.byName || x.by}</td><td>${x.note || ''}</td></tr>`)}</tbody></table>` : ''}
        ${r.paid ? html`<p>Paid on ${fmtFull(r.paid.date)} by ${PAY_METHODS.find(([k]) => k === r.paid.method)?.[1] || r.paid.method}${r.paid.ref ? `, reference ${r.paid.ref}` : ''}.</p>` : ''}
        ${signoff([{ label: 'Requested by', name: [r.byName || r.by, r.byTitle].filter(Boolean).join(', '), note: fmtFull(r.date) },
          ...approvals.map(x => ({ label: `Approved by (${x.level || 'PE'})`, name: x.byName || x.by, note: fmtFull(x.at.slice(0, 10)) })),
          ...(waitFor ? [{ label: `Approved by (${waitFor})`, name: '', note: 'Date' }] : [])])}`)}
    </div></section>`;
}

/** AP-CHB-MR-2026-004: the company, the project and the request's own number. */
const reqRef = (c, r) => docRef({ company: c.global.company, project: c.project, key: r.number });

export const actions = {
  /** v1.4.0 (R6): a draft PO from this approved material request (PE or office); the GM approves it before it goes out. */
  reqPo(el, c) {
    const r = find(c.ws);
    if (!r || r.kind !== 'material' || !approver()) return;
    const f = poFromRequest(r);
    const doc = { ...makeDoc({ type: 'po', project: c.project, docs: c.ws.docs, today: c.today, lines: f.lines, due: f.due || c.today, notes: f.notes }), reqId: r.id };
    const who = me();
    store.update(ws => {
      ws.docs.push(doc);
      const x = find(ws);
      if (x.status === 'approved') { x.status = 'arranging'; x.log = [...(x.log || []), { at: stamp(), by: who.email, byName: who.name, status: 'arranging', note: `Purchase order ${doc.number}` }]; }
    });
    store.logActivity?.({ action: 'save', channel: 'Purchases', doc: `${doc.number} from ${r.number}` });
    notice = `${doc.number} made as a draft (Money, Quotations and POs). Add the supplier and the prices, then ask the GM to approve it.`;
  },
  open(el) { selected = el.dataset.id; notice = ''; problems = []; },
  back() { selected = null; notice = ''; problems = []; },
  filter(el) { filter = el.dataset.k; },
  print() { print(); },
  /** Approve, refuse, move along, deliver, withdraw or reopen. What each person may do is in engine/requests.js and the database rules. */
  move(el, c) {
    const r = find(c.ws);
    const to = el.dataset.to;
    if (!r || !movesOf(r, c).some(([k]) => k === to)) return;
    let note = '';
    if (to === 'rejected' || to === 'cancelled') {
      note = prompt(to === 'rejected' ? (isExpense(r) ? 'Why is it sent back? The person who asked will see this.' : 'Why is it refused? The person who asked will see this.') : 'Why is it cancelled? (optional)') ;
      if (note === null) return;
    }
    const who = me();
    store.update(ws => {
      const x = find(ws);
      x.status = to;
      x.log = [...(x.log || []), { at: stamp(), by: who.email, byName: who.name, status: to, note: String(note).trim(), ...(isExpense(x) && to === 'approved' ? { level: LEVEL_SHORT[level()] } : {}) }];
      if (isExpense(x)) {   // v0.61.0: approved = a Ledger cost, linked; sent back, withdrawn or reopened = the cost taken out again
        // v0.69.0: a Site user (Site Engineer) cannot write the Ledger: the cost is added when the office marks it paid
        if ((to === 'approved' && store.role !== 'site') || to === 'paid') if (!ws.ledger.some(l => l.requestId === x.id)) { const cost = costOf(x, uid('l'), c.today); ws.ledger.push(cost); x.costId = cost.id; }
        if (['rejected', 'cancelled', 'requested'].includes(to)) { ws.ledger = ws.ledger.filter(l => l.requestId !== x.id); delete x.costId; }
        return;
      }
      const item = x.itemId && ws.items.find(i => i.id === x.itemId);
      if (to === 'approved' && !item) { const f = followUp(x, c.today, uid('i')); ws.items.push(f); x.itemId = f.id; }
      else if (item) item.status = ['fulfilled', 'rejected', 'cancelled'].includes(to) ? 'closed' : 'open';
    });
    notice = `${r.number}: ${labelOf({ ...r, status: to }).toLowerCase()}.`;
  },
  cutLine(el, c) {
    store.update(ws => { const r = find(ws); if (r && editable(r, approver())) r.lines = r.lines.filter(l => l.id !== el.dataset.id); });
  },
  email(el, c) {
    const r = find(c.ws);
    if (!r) return;
    const sender = c.global.company?.name || 'Amistad Prefab';
    const name = `${kindLabel(r.kind)} request ${r.number}, ${c.project.name}`.replace(/[\\/:*?"<>|]/g, '-');
    openMail({
      to: '',
      subject: `${kindLabel(r.kind)} request ${r.number}: ${c.project.name}`,
      message: `Dear Sir or Madam,\n\nPlease find attached ${kindLabel(r.kind).toLowerCase()} request ${r.number} for ${c.project.name}, needed by ${r.neededBy ? fmtFull(r.neededBy) : 'the earliest date'}.\n\nPlease confirm that you can supply it and when.\n\nKind regards,\n${store.signature}\n${sender}`,
      filename: name,
      getHtml: () => paperHtml(document.querySelector('.paper'), name),
      sheet: () => document.querySelector('.paper'),
      onSent({ to }) {
        notice = `Sent to ${to}.`;
        store.update(ws => { const x = find(ws); if (x) x.emails = [...(x.emails || []), { at: c.today, to }]; });
      },
    });
  },
  removeRequest(el, c) {
    const r = find(c.ws);
    if (!r || !confirm(`Delete request ${r.number}? To keep the record, use Cancel instead.`)) return;
    store.update(ws => { ws.requests = ws.requests.filter(x => x.id !== r.id); if (r.itemId) ws.items = ws.items.filter(i => i.id !== r.itemId); });
    selected = null;
  },
};

export const changes = {
  async receipt(el) {
    const file = el.files?.[0];
    if (!file) return;
    try { receipt = (await pictureFor(file, RECEIPT)).dataUrl; } catch (err) { tell(err.message); receipt = null; }
    store.notify();
  },
  exLine(el) { store.update(ws => { const r = find(ws); if (r && r.status === 'requested') r.lines = [{ ...(r.lines?.[0] || { id: uid('rl'), qty: 1, unit: '' }), description: el.value.trim() }]; }); },
  exAmount(el) { store.update(ws => { const r = find(ws); if (r && r.status === 'requested') r.amount = Math.max(0, +el.value || 0); }); },
  set(el) {
    const f = el.dataset.f;
    store.update(ws => { const r = find(ws); if (r && editable(r, approver())) r[f] = el.value.trim(); });
  },
  line(el) {
    const f = el.dataset.f;
    store.update(ws => {
      const r = find(ws);
      const l = r && editable(r, approver()) && r.lines.find(x => x.id === el.dataset.id);
      if (l) l[f] = ['qty', 'days'].includes(f) ? (el.value === '' ? '' : Math.max(0, +el.value)) : el.value.trim();
    });
  },
};

export const submits = {
  newExpense(fd, c) {
    const who = me();
    const rec = {
      id: uid('rq'), number: nextNumber(c.ws.requests), kind: 'expense', priority: 'normal', status: 'requested', date: c.today, byLevel: level(),
      lines: [{ id: uid('rl'), description: String(fd.get('description') || '').trim(), qty: 1, unit: '', note: '' }],
      amount: +fd.get('amount') || 0, currency: fd.get('currency') === 'USD' ? 'USD' : 'ETB', category: fd.get('category') || 'overhead',
      vendor: String(fd.get('vendor') || '').trim(), purpose: String(fd.get('purpose') || '').trim(), receipt: receipt || '',
      by: who.email, byName: who.name, byTitle: store.profile.title || '', projectId: c.project.id,
      log: [{ at: stamp(), by: who.email, byName: who.name, status: 'requested', note: '' }],
    };
    problems = checkExpense(rec);
    if (problems.length) return false;
    store.update(ws => ws.requests.push(rec));
    receipt = null;
    notice = `${rec.number} sent for approval.`;
    selected = rec.id;
  },
  payExpense(fd, c) {
    const r = find(c.ws);
    if (!r || r.status !== 'approved' || !approver()) return false;
    const who = me();
    const paid = { method: fd.get('method') || 'bank', ref: String(fd.get('ref') || '').trim(), date: fd.get('date') || c.today, by: who.email };
    store.update(ws => {
      const x = find(ws);
      x.status = 'paid'; x.paid = paid;
      x.log = [...(x.log || []), { at: stamp(), by: who.email, byName: who.name, status: 'paid', note: paid.ref ? `Reference ${paid.ref}` : '' }];
      let cost = ws.ledger.find(l => l.requestId === x.id);
      // v0.69.0: approved by a Site Engineer (who cannot write the Ledger): the cost is added now
      if (!cost) { cost = costOf(x, uid('l'), c.today); ws.ledger.push(cost); x.costId = cost.id; }
      Object.assign(cost, { method: paid.method, bankRef: paid.ref, paidOn: paid.date });
    });
    notice = `${r.number}: paid.`;
  },
  newRequest(fd, c) {
    const kind = fd.get('kind');
    const who = me();
    const lines = [{ id: uid('rl'), description: String(fd.get('description') || '').trim(), qty: +fd.get('qty'), unit: String(fd.get('unit') || '').trim() || DEFAULT_UNIT[kind] || '', note: '' }];
    const rec = {
      id: uid('rq'), number: nextNumber(c.ws.requests), kind, priority: fd.get('priority') || 'normal', status: 'requested', date: c.today,
      neededBy: fd.get('neededBy') || '', taskId: fd.get('taskId') || '', purpose: String(fd.get('purpose') || '').trim(), lines,
      by: who.email, byName: who.name, byTitle: store.profile.title || '', projectId: c.project.id,
      log: [{ at: stamp(), by: who.email, byName: who.name, status: 'requested', note: '' }],
    };
    problems = check(rec);
    if (problems.length) return false;
    store.update(ws => ws.requests.push(rec));
    notice = `${rec.number} sent.`;
    selected = rec.id;
  },
  addLine(fd, c) {
    const r = find(c.ws);
    if (!r) return false;
    store.update(ws => {
      const x = find(ws);
      if (x && editable(x, approver())) x.lines.push({ id: uid('rl'), description: String(fd.get('description') || '').trim(), qty: +fd.get('qty'), unit: String(fd.get('unit') || '').trim(), note: '' });
    });
  },
};
