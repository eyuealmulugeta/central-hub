// v0.61.0 (owner, 2 Nov, Phase B1): expenses with approval. An expense is a request of the kind "expense" (same list,
// same database rules, same Field Report sending as material, manpower and equipment requests), with an amount in ETB or
// USD, a Ledger category, what it is for and a receipt photo. The Project Manager (an approver) approves or sends it back
// with a note; above the company's limit the General Manager approves too. Once approved it is a cost in the Ledger,
// linked to the request; whoever pays marks it paid with the method and the bank reference. Pure functions.

import { money } from '../core/util.js';

/** Above these the General Manager approves too, unless the company has its own (Settings: company.expenseLimits). */
export const EXPENSE_LIMITS = { ETB: 50000, USD: 1000 };
export const EXPENSE_CATEGORIES = [['material', 'Material'], ['labor', 'Labour'], ['equipment', 'Equipment'], ['subcontract', 'Subcontract'], ['transport', 'Transport'], ['overhead', 'Overhead']];
export const PAY_METHODS = [['cash', 'Cash'], ['bank', 'Bank transfer'], ['mobile', 'Mobile money'], ['cheque', 'Cheque']];
/** A receipt photo: small enough for the request record, large enough to read the figures. */
export const RECEIPT = { maxBytes: 250 * 1024, maxSide: 1400 };

export const isExpense = r => r?.kind === 'expense';
export const limitOf = (company, currency) => +(company?.expenseLimits || {})[currency] || EXPENSE_LIMITS[currency] || EXPENSE_LIMITS.ETB;
export const overLimit = (r, company) => +r.amount > limitOf(company, r.currency);
/** The Admin, or a person whose ranks include General Manager. */
export const isGM = ({ role, ranks } = {}) => role === 'owner' || (ranks || []).includes('general_manager');

/** What a person may do to an expense now, as [newStatus, button label] pairs. */
export function expenseMoves(r, { approver = false, gm = false, company } = {}) {
  if (!approver) return r.status === 'requested' ? [['cancelled', 'Withdraw this expense']] : [];
  const back = ['rejected', 'Send back'];
  switch (r.status) {
    case 'requested': return overLimit(r, company) && !gm ? [['gm', 'Approve, then to the GM'], back] : [['approved', 'Approve'], back];
    case 'gm': return gm ? [['approved', 'Approve'], back] : [];
    case 'approved': return [['paid', 'Mark as paid']];
    case 'rejected': case 'cancelled': return [['requested', 'Reopen']];
    default: return [];
  }
}

/** The words for an expense's status ("Sent back" for a refused one). */
export const expenseStatus = s => ({ requested: 'Waiting for the PM', gm: 'Waiting for the GM', approved: 'Approved, to pay', paid: 'Paid', rejected: 'Sent back', cancelled: 'Withdrawn', draft: 'Draft on site' }[s] || s);

/** Problems that stop an expense from being sent (none = fine). */
export function checkExpense(r) {
  const p = [];
  if (!String(r.lines?.[0]?.description || '').trim()) p.push('Say what the expense is for.');
  if (!(+r.amount > 0)) p.push('Give the amount.');
  if (!['ETB', 'USD'].includes(r.currency)) p.push('Choose ETB or USD.');
  return p;
}

export const expenseTitle = r => `${String(r.lines?.[0]?.description || '').trim() || '(not described)'}, ${money(+r.amount || 0, r.currency || 'ETB')}`;

/** The Ledger cost an approved expense becomes. */
export const costOf = (r, id, date) => ({
  id, date, type: 'expense', category: r.category || 'overhead', description: `${r.number}: ${String(r.lines?.[0]?.description || '').trim()}`,
  vendor: r.vendor || '', amount: +r.amount, currency: r.currency, requestId: r.id,
});

/** Counts for the list and "Needs you". */
export function expenseSummary(requests, { gm = false } = {}) {
  const ex = requests.filter(isExpense);
  return {
    pm: ex.filter(r => r.status === 'requested').length,
    gm: ex.filter(r => r.status === 'gm').length,
    toPay: ex.filter(r => r.status === 'approved').length,
    mine: gm ? ex.filter(r => ['requested', 'gm'].includes(r.status)).length : ex.filter(r => r.status === 'requested').length,
  };
}

/** The words for a step in an expense's history. */
export const expenseStep = s => ({ requested: 'Asked', gm: 'Approved by the PM, to the GM', approved: 'Approved', paid: 'Paid', rejected: 'Sent back', cancelled: 'Withdrawn' }[s] || s);
