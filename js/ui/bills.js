// v0.68.0 (owner, 3 Nov, Phase F1): Ledger, Supplier bills. Enter a bill with its picture or PDF, see what is due,
// mark it paid (it becomes a Ledger cost the bank import can match). See engine/bills.js.

import { store } from '../core/store.js';
import { uid, money, fmtDate } from '../core/util.js';
import { html, options, chip } from './dom.js';
import { pictureFor, tell } from '../core/image.js';
import { billStatus, BILL_WORD, checkBill, billCost, billTotals, BILL_FILE } from '../engine/bills.js';
import { EXPENSE_CATEGORIES, PAY_METHODS, levelOf, LEVEL_NAME, LEVEL_SHORT } from '../engine/expenses.js';
import { billFlags, payLevel, mayOkBill, payable } from '../engine/purchases.js';   // v1.4.0 (R6): three-way check, who approves paying

const myLevel = () => levelOf({ role: store.role, ranks: store.ranks });
const meNow = () => (store.user?.email || '').toLowerCase();
/** The flags of a bill and the level that approves paying it. */
const gate = (b, c) => { const flags = billFlags(b, { docs: c.ws.docs || [], moves: c.ws.storeMoves || [], bills: c.ws.bills || [] }); const need = payLevel(b, flags, c.global || store.global); return { flags, need, ok: payable(b, need) }; };

let show = 'unpaid';     // unpaid | due | overdue | paid | all
let adding = false;
let file = null;         // { name, dataUrl } of the bill being entered
let paying = null;       // id of the bill being marked paid
let opened = null;       // id of the bill whose picture is open

const TONE = { paid: 'ok', overdue: 'high', due: 'warn', open: '' };
const SHOWN = [['unpaid', 'Not paid'], ['due', 'Due soon'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['all', 'All']];

export function billsView(c) {
  const bills = c.ws.bills || [];
  const st = b => billStatus(b, c.today);
  const list = bills.filter(b => show === 'all' || (show === 'unpaid' ? st(b) !== 'paid' : st(b) === show))
    .sort((a, b) => (a.paid ? 1 : 0) - (b.paid ? 1 : 0) || String(a.due || '9').localeCompare(String(b.due || '9')));
  const t = billTotals(bills, c.today);
  const pos = (c.ws.docs || []).filter(d => d.type === 'po');
  return html`
    <section class="card">
      <div class="toolbar"><h2>Supplier bills</h2>
        <span class="muted">Owed to suppliers: ${Object.entries(t.owed).map(([cur, v]) => money(v, cur)).join(' + ') || 'nothing'}${t.overdue ? ` · ${t.overdue} overdue` : ''}${t.due ? ` · ${t.due} due within 7 days` : ''}</span>
        <span class="grow"></span><button class="btn primary" data-act="billNew">${adding ? 'Close' : 'New supplier bill'}</button></div>
      ${adding ? html`<form data-form="billAdd" class="grid2 bill-form">
        <label>Supplier <input name="supplier" required placeholder="As on the bill"></label>
        <label>Bill number <input name="number" placeholder="The supplier's number"></label>
        <label>Bill date <input type="date" name="date" value="${c.today}" required></label>
        <label>Due date <input type="date" name="due"></label>
        <label>Amount <input type="number" name="amount" min="0" step="any" required></label>
        <label>Currency <select name="currency">${options([['ETB', 'ETB'], ['USD', 'USD']], c.project.currency === 'USD' ? 'USD' : 'ETB')}</select></label>
        <label>Cost category <select name="category">${options(EXPENSE_CATEGORIES, 'material')}</select></label>
        <label>Purchase order <select name="po"><option value="">None</option>${options(pos.map(d => [d.id, `${d.number}, ${d.party?.name || ''}`]), null)}</select></label>
        <label>Picture or PDF of the bill <input type="file" accept="image/*,application/pdf" data-chg="billFile"></label>
        <span class="muted">${file ? `Attached: ${file.name}` : 'A photo is made smaller; a PDF up to 300 KB.'}</span>
        <div class="actions left"><button class="btn primary">Save bill</button></div>
      </form>` : ''}
      <div class="seg" role="group" aria-label="Show">${SHOWN.map(([k, l]) => html`<button class="${show === k ? 'on' : ''}" data-act="billShow" data-k="${k}">${l}</button>`)}</div>
      ${list.length ? html`<table class="table compact">
        <thead><tr><th>Supplier</th><th>Bill</th><th>Date</th><th>Due</th><th class="r">Amount</th><th>Status</th><th></th></tr></thead>
        <tbody>${list.map(b => html`<tr>
          <td><b>${b.supplier}</b>${b.po ? html` <span class="muted">${pos.find(d => d.id === b.po)?.number || ''}</span>` : ''}</td>
          <td>${b.number || '—'}</td><td class="nowrap">${fmtDate(b.date)}</td><td class="nowrap">${b.due ? fmtDate(b.due) : '—'}</td>
          <td class="r nowrap">${money(+b.amount, b.currency)}</td>
          <td>${chip(BILL_WORD[st(b)], TONE[st(b)])}${b.paid ? html` <span class="muted small">${fmtDate(b.paid.date)}${b.paid.ref ? `, ${b.paid.ref}` : ''}</span>` : (g => html`${g.flags.map(f => html` ${chip(f.text, 'bad')}`)} ${g.ok ? chip(`Approved by ${b.ok.byName || b.ok.by} (${LEVEL_SHORT[b.ok.level]})`, 'ok') : chip(`Needs the ${LEVEL_NAME[g.need]} to approve`, 'warn')}`)(gate(b, c))}</td>
          <td class="r nowrap">${b.file ? html`<button class="btn ghost small" data-act="billOpen" data-id="${b.id}">${opened === b.id ? 'Hide' : 'View'}</button>` : ''}
            ${b.paid ? '' : (g => g.ok ? html`<button class="btn small" data-act="billPay" data-id="${b.id}">Mark paid</button>` : mayOkBill(b, { level: myLevel(), me: meNow() }, g.need) ? html`<button class="btn small primary" data-act="billOk" data-id="${b.id}">Approve payment</button>` : '')(gate(b, c))}
            ${store.isAdmin ? html`<button class="btn ghost small" data-act="billDelete" data-id="${b.id}">Delete</button>` : ''}</td></tr>
          ${paying === b.id ? html`<tr><td colspan="7"><form data-form="billPaid" class="grid2">
            <label>Paid by <select name="method">${options(PAY_METHODS, 'bank')}</select></label>
            <label>Bank or receipt reference <input name="ref" placeholder="As on the bank statement"></label>
            <label>Paid on <input type="date" name="date" value="${c.today}" required></label>
            <div class="actions left"><button class="btn primary">Save payment</button><button type="button" class="btn ghost" data-act="billPay" data-id="">Cancel</button></div>
          </form></td></tr>` : ''}
          ${opened === b.id && b.file ? html`<tr><td colspan="7">${/^data:application\/pdf/.test(b.file) ? html`<a href="${b.file}" download="${b.fileName || 'bill.pdf'}">Download the PDF</a>` : html`<img class="receipt" src="${b.file}" alt="Bill">`}</td></tr>` : ''}`)}</tbody></table>`
        : html`<p class="empty">${bills.length ? 'No bill here.' : 'No supplier bill yet. Use "New supplier bill".'}</p>`}
    </section>`;
}

const readFile = f => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(f); });

export const billChanges = {
  async billFile(el) {
    const f = el.files?.[0];
    if (!f) return;
    try {
      if (f.type === 'application/pdf') {
        if (f.size > BILL_FILE.maxBytes) { tell('This PDF is over 300 KB. Take a photo of the bill instead.'); return; }
        file = { name: f.name, dataUrl: await readFile(f) };
      } else file = { name: f.name, dataUrl: (await pictureFor(f, BILL_FILE, 'photo')).dataUrl };
    } catch (err) { tell(err.message); return; }
    store.notify();
  },
};

export const billActions = {
  billNew() { adding = !adding; file = null; },
  billShow(el) { show = el.dataset.k; },
  billPay(el) { paying = el.dataset.id || null; },
  /** v1.4.0 (R6): approve paying a bill (SE up to 5,000, PE up to 20,000 ETB, the GM above, in USD, or when the check flags it). */
  billOk(el, c) {
    const b = (c.ws.bills || []).find(x => x.id === el.dataset.id);
    if (!b) return;
    const g = gate(b, c), level = myLevel();
    if (!mayOkBill(b, { level, me: meNow() }, g.need)) { tell(`Paying this bill needs the ${LEVEL_NAME[g.need]}.`); return; }
    if (g.flags.length && !confirm(`${g.flags.map(f => f.text).join('. ')}. Approve paying it anyway?`)) return;
    const ok = { by: meNow(), byName: store.profile?.name || store.user?.name || '', level, amount: +b.amount, at: new Date().toISOString(), flags: g.flags.map(f => f.key) };
    store.update(ws => { ws.bills.find(x => x.id === b.id).ok = ok; });
    store.logActivity?.({ action: 'approve', channel: 'Purchases', doc: `Pay ${b.supplier} ${b.number || ''} ${b.amount} ${b.currency}` });
  },
  billOpen(el) { opened = opened === el.dataset.id ? null : el.dataset.id; },
  billDelete(el, c) {
    const b = (c.ws.bills || []).find(x => x.id === el.dataset.id);
    if (!b || !confirm(`Delete the bill from ${b.supplier}?${b.paid ? ' Its Ledger cost stays.' : ''}`)) return;
    store.update(ws => { ws.bills = ws.bills.filter(x => x.id !== b.id); });
  },
};

export const billSubmits = {
  billAdd(fd) {
    const b = {
      id: uid('bill'), supplier: String(fd.get('supplier') || '').trim(), number: String(fd.get('number') || '').trim(),
      date: fd.get('date') || '', due: fd.get('due') || '', amount: +fd.get('amount') || 0, currency: fd.get('currency') || 'ETB',
      category: fd.get('category') || 'material', po: fd.get('po') || '', ...(file ? { file: file.dataUrl, fileName: file.name } : {}),
      by: store.user?.email || '', at: new Date().toISOString(),
    };
    const wrong = checkBill(b);
    if (wrong.length) { tell(wrong.join(' ')); return false; }
    store.update(ws => { (ws.bills ||= []).push(b); });
    adding = false; file = null;
  },
  billPaid(fd, c) {
    const b = (c.ws.bills || []).find(x => x.id === paying);
    if (!b || b.paid) return false;
    if (!gate(b, c).ok) { tell('This bill is not approved for payment yet.'); return false; }
    const paid = { method: fd.get('method') || 'bank', ref: String(fd.get('ref') || '').trim(), date: fd.get('date') || c.today, by: store.user?.email || '' };
    const costId = uid('l');
    store.update(ws => {
      const x = ws.bills.find(y => y.id === b.id);
      x.paid = paid; x.costId = costId;
      ws.ledger.push(billCost(x, costId));
    });
    paying = null;
  },
};
