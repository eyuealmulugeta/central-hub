// v0.68.0 (owner, 3 Nov, Phase F1): supplier bills and what is owed to suppliers. A bill (project section 'bills')
// has the supplier, its number and date, an optional purchase order, the amount in ETB or USD, a cost category, the due
// date and a picture or PDF of it. Marking it paid (method, bank reference, date) adds a Ledger cost carrying
// method, bankRef and paidOn, so the bank statement import can match it. Pure functions.

import { toDay } from '../core/util.js';

export const DUE_SOON_DAYS = 7;
export const BILL_FILE = { maxBytes: 300 * 1024, maxSide: 1600 };

/** paid, overdue (past its due date), due (within 7 days) or open. */
export function billStatus(b, today) {
  if (b.paid) return 'paid';
  if (!b.due) return 'open';
  const left = toDay(b.due) - toDay(today);
  return left < 0 ? 'overdue' : left <= DUE_SOON_DAYS ? 'due' : 'open';
}
export const BILL_WORD = { paid: 'Paid', overdue: 'Overdue', due: 'Due soon', open: 'Not due yet' };

/** What a bill needs before it is saved; empty when it is fine. */
export function checkBill(b) {
  const out = [];
  if (!String(b.supplier || '').trim()) out.push('Write the supplier.');
  if (!(+b.amount > 0)) out.push('Write the amount.');
  if (!b.date) out.push('Write the bill date.');
  if (b.due && b.date && b.due < b.date) out.push('The due date is before the bill date.');
  return out;
}

/** The Ledger cost of a paid bill. */
export const billCost = (b, id) => ({
  id, date: b.paid.date, type: 'expense', category: b.category || 'material',
  description: `Supplier bill ${b.number || ''}${b.number ? ', ' : ''}${b.supplier}`.trim(), vendor: b.supplier,
  amount: +b.amount, currency: b.currency, billId: b.id, method: b.paid.method, bankRef: b.paid.ref || '', paidOn: b.paid.date,
});

/** Unpaid bills per currency, and how many are due soon or overdue. */
export function billTotals(bills, today) {
  const owed = {};
  let due = 0, overdue = 0;
  for (const b of bills || []) {
    const s = billStatus(b, today);
    if (s === 'paid') continue;
    owed[b.currency] = (owed[b.currency] || 0) + (+b.amount || 0);
    if (s === 'due') due++;
    if (s === 'overdue') overdue++;
  }
  return { owed, due, overdue };
}
