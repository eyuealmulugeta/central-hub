// Material, manpower and equipment requests from site to the office. A Site Engineer asks, the
// Project Manager or Admin approves or refuses, the office arranges it, the site confirms it
// arrived. Pure functions; the screen is ui/requests.js and firestore.rules enforces the same
// lines (a Site user may only create a request, or cancel one nobody has answered yet).

import { toDay } from '../core/util.js';

export const KINDS = [['material', 'Material'], ['manpower', 'Manpower'], ['equipment', 'Equipment']];
export const kindLabel = id => (id === 'expense' ? 'Expense' : KINDS.find(([k]) => k === id)?.[1] || 'Material');   // v0.61.0: expenses
/** What a quantity is counted in until the person says otherwise. */
export const DEFAULT_UNIT = { material: 'pcs', manpower: 'people', equipment: 'units' };

export const PRIORITIES = [['normal', 'Normal'], ['urgent', 'Urgent']];

export const STATUSES = [
  ['requested', 'Waiting for approval'], ['approved', 'Approved'], ['arranging', 'Being arranged'],
  ['fulfilled', 'Delivered or on site'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled'],
  // v0.38.0: written on a Field Report phone, not sent yet (or deleted there); Central Hub does not list them
  ['draft', 'Draft on site'], ['deleted', 'Deleted on site'],
  // v0.61.0: expenses (engine/expenses.js): above the limit the GM approves too; an approved expense is then paid
  ['gm', 'Waiting for the GM'], ['paid', 'Paid'],
];
export const statusLabel = id => STATUSES.find(([k]) => k === id)?.[1] || id;
export const isOpen = r => !['fulfilled', 'rejected', 'cancelled', 'draft', 'deleted', 'paid'].includes(r.status);
/** v0.38.0: a request the office sees (a site draft is not sent yet). */
export const sent = r => !['draft', 'deleted'].includes(r.status);

/**
 * What a person may do to a request now, as [newStatus, button label] pairs.
 * The person who asked can only withdraw a request nobody has answered yet; an approver (Admin or
 * Office) decides, moves it along, and may reopen a refused or cancelled one.
 */
export function moves(status, approver) {
  if (!approver) return status === 'requested' ? [['cancelled', 'Withdraw this request']] : [];
  switch (status) {
    case 'requested': return [['approved', 'Approve'], ['rejected', 'Reject'], ['cancelled', 'Cancel']];
    case 'approved': return [['arranging', 'Mark as being arranged'], ['fulfilled', 'Mark as delivered'], ['cancelled', 'Cancel']];
    case 'arranging': return [['fulfilled', 'Mark as delivered'], ['cancelled', 'Cancel']];
    case 'rejected': case 'cancelled': return [['requested', 'Reopen']];
    default: return [];
  }
}

/** Lines may be changed while the request is waiting; once answered only an approver changes them. */
export const editable = (r, approver) => r.status === 'requested' || (approver && ['approved', 'arranging'].includes(r.status));

/** Past the date it was needed and still not delivered or closed. */
export const overdue = (r, today) => isOpen(r) && !!r.neededBy && toDay(r.neededBy) < toDay(today);

/** REQ-001, REQ-002, ... within one project. */
export function nextNumber(requests) {
  const last = Math.max(0, ...requests.map(r => +String(r.number || '').match(/^REQ-(\d+)$/)?.[1] || 0));   // v0.38.0: site numbers (SITE-…) do not count
  return `REQ-${String(last + 1).padStart(3, '0')}`;
}

/** Problems that stop a request from being sent, in plain words (none = fine). */
export function check(r) {
  const problems = [];
  const lines = (r.lines || []).filter(l => String(l.description || '').trim());
  if (!lines.length) problems.push('Describe what is needed.');
  if (lines.some(l => !(+l.qty > 0))) problems.push('Give a quantity above zero for every line.');
  return problems;
}

/** A short title for lists: the first line, and how many more. */
export function titleOf(r) {
  const lines = (r.lines || []).filter(l => String(l.description || '').trim());
  if (!lines.length) return '(nothing described yet)';
  const first = `${lines[0].description}${lines[0].qty ? `, ${lines[0].qty} ${lines[0].unit || ''}`.trimEnd() : ''}`;
  return lines.length > 1 ? `${first} and ${lines.length - 1} more` : first;
}

/** The follow-up the office gets when a request is approved, so it is not forgotten. */
export function followUp(r, today, id) {
  return {
    id, type: r.kind === 'manpower' ? 'other' : 'material', requestId: r.id,
    title: `${r.number}: ${kindLabel(r.kind).toLowerCase()} requested, ${titleOf(r)}`,
    owner: 'Office', created: today, due: r.neededBy || '', status: 'open', remindEvery: r.priority === 'urgent' ? 1 : 3,
  };
}

/** Counts for the badge and the top of the page. */
export function summary(requests, today) {
  return {
    waiting: requests.filter(r => r.status === 'requested').length,
    open: requests.filter(isOpen).length,
    overdue: requests.filter(r => overdue(r, today)).length,
    urgent: requests.filter(r => isOpen(r) && r.priority === 'urgent').length,
  };
}
