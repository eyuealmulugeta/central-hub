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

/**
 * v0.69.0 (owner, 3 Nov, Phase F2): who approves depends on the amount and the approver's position. The GM has no
 * limit; a Site Engineer approves up to 5,000 ETB and a Project Engineer up to 20,000 ETB; above, and any USD amount,
 * goes to the GM. The Admin changes the limits (global.approvalLimits; the database rules read the Site Engineer's).
 * Nobody below the GM approves their own expense: it goes one step up.
 */
export const APPROVAL_LIMITS = { site_engineer: { ETB: 5000, USD: 0 }, project_manager: { ETB: 20000, USD: 0 } };
export const LEVEL_NAME = ['', 'Site Engineer', 'Project Engineer', 'GM'];
export const LEVEL_SHORT = ['', 'SE', 'PE', 'GM'];
export const approvalLimits = settings => Object.fromEntries(Object.entries(APPROVAL_LIMITS).map(([k, v]) => [k, { ...v, ...(settings?.approvalLimits?.[k] || {}) }]));
/** 3 = GM (or the Admin), 2 = Project Engineer, 1 = Site Engineer, 0 = nobody who approves expenses. */
export const levelOf = ({ role, ranks } = {}) => (isGM({ role, ranks }) ? 3 : (ranks || []).includes('project_manager') ? 2 : (ranks || []).includes('site_engineer') ? 1 : 0);
const low = s => String(s || '').trim().toLowerCase();

/** The level that must approve this expense: by the amount, and above whoever asked for it. */
export function neededLevel(r, settings) {
  if (r.status === 'gm') return 3;   // waiting for the GM before v0.69.0
  const L = approvalLimits(settings), a = +r.amount || 0, cur = r.currency || 'ETB';
  const byAmount = a <= (+L.site_engineer[cur] || 0) ? 1 : a <= (+L.project_manager[cur] || 0) ? 2 : 3;
  return Math.max(byAmount, Math.min(3, (+r.byLevel || 0) + 1));
}
export const isWaiting = r => r.status === 'requested' || r.status === 'gm';
/** May this person approve it now? */
export const mayApprove = (r, { level = 0, me = '' } = {}, settings) => isWaiting(r) && level > 0 && level >= neededLevel(r, settings) && (level === 3 || low(r.by) !== low(me));

/** What a person may do to an expense now, as [newStatus, button label] pairs. */
export function expenseMoves(r, { approver = false, level = 0, me = '', settings } = {}) {
  const mine = !!me && low(r.by) === low(me);
  const back = ['rejected', 'Send back'];
  switch (r.status) {
    case 'requested': case 'gm':
      return [...(mayApprove(r, { level, me }, settings) ? [['approved', 'Approve'], back] : []), ...(mine && r.status === 'requested' ? [['cancelled', 'Withdraw this expense']] : [])];
    case 'approved': return approver ? [['paid', 'Mark as paid']] : [];
    case 'rejected': case 'cancelled': return approver || mine ? [['requested', 'Reopen']] : [];
    default: return [];
  }
}
/** "Waiting for the Project Engineer", from the amount. */
export const expenseWaiting = (r, settings) => `Waiting for the ${LEVEL_NAME[neededLevel(r, settings)]}`;

/** The words for an expense's status ("Sent back" for a refused one). */
export const expenseStatus = s => ({ requested: 'Waiting for approval', gm: 'Waiting for the GM', approved: 'Approved, to pay', paid: 'Paid', rejected: 'Sent back', cancelled: 'Withdrawn', draft: 'Draft on site' }[s] || s);

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
