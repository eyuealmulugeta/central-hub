// Contracts register: agreements with clients, suppliers and subcontractors,
// and the dates in them that must not be missed. Pure functions.

import { toDay, sum } from '../core/util.js';
import { convert } from './pricing.js';

export const KINDS = [
  ['client', 'Client contract'], ['supplier', 'Supplier agreement'], ['subcontract', 'Subcontract'],
  ['lease', 'Lease or rental'], ['service', 'Service agreement'], ['other', 'Other'],
];
export const kindLabel = id => KINDS.find(([k]) => k === id)?.[1] || 'Other';
/** Money comes in on these; it goes out on the others. */
export const isIncome = kind => kind === 'client';

const END_WARN_DAYS = 60;   // a contract is flagged this long before it ends
const DATE_WARN_DAYS = 14;  // a key date is flagged this long before it falls

/** SHP-style running number: CON-001, CON-002, … */
export function nextRef(contracts) {
  const last = Math.max(0, ...contracts.map(c => +(String(c.ref || '').match(/(\d+)$/)?.[1] || 0)));
  return `CON-${String(last + 1).padStart(3, '0')}`;
}

/** draft (not signed) -> active -> ended; closed and terminated are set by hand. */
export function contractStatus(c, today) {
  if (c.closed === 'terminated') return 'terminated';
  if (c.closed === 'completed') return 'completed';
  if (!c.signedOn) return 'draft';
  if (c.end && c.end < today) return 'ended';
  return 'active';
}
export const STATUS_LABEL = { draft: 'Not signed', active: 'Active', ended: 'Past its end date', completed: 'Completed', terminated: 'Terminated' };

/** What needs attention on one contract, most urgent first. */
export function contractAlerts(c, today) {
  const status = contractStatus(c, today);
  if (status === 'completed' || status === 'terminated') return [];
  const T = toDay(today);
  const out = [];
  const due = (what, date, warn) => {
    if (!date) return;
    const days = toDay(date) - T;
    if (days < 0) out.push({ sev: 'high', days, text: `${what} was ${-days} day${days === -1 ? '' : 's'} ago` });
    else if (days <= warn) out.push({ sev: 'warn', days, text: `${what} in ${days} day${days === 1 ? '' : 's'}` });
  };
  if (status === 'draft') out.push({ sev: 'warn', days: 0, text: 'Not signed yet' });
  due('Contract ends', c.end, END_WARN_DAYS);
  // notice has to be given this many days before the end to stop a renewal or to leave
  if (c.end && c.noticeDays > 0) {
    const days = toDay(c.end) - c.noticeDays - T;
    if (days >= 0 && days <= DATE_WARN_DAYS) out.push({ sev: 'warn', days, text: `Last day to give notice in ${days} day${days === 1 ? '' : 's'}` });
  }
  due('Retention release', c.retentionRelease, DATE_WARN_DAYS);
  due('Defects liability ends', c.defectsEnd, DATE_WARN_DAYS);
  for (const d of c.dates || []) if (!d.done) due(d.what, d.date, DATE_WARN_DAYS);
  return out.sort((a, b) => a.days - b.days);
}

export function contractsSummary(contracts, fx, today, currency) {
  const rows = contracts.map(c => ({
    c, status: contractStatus(c, today), alerts: contractAlerts(c, today),
    value: convert(+c.value || 0, c.currency || currency, currency, fx),
  })).sort((a, b) => (a.c.end || '9').localeCompare(b.c.end || '9'));
  const live = rows.filter(r => r.status === 'active' || r.status === 'ended');
  return {
    rows,
    active: live.length,
    income: sum(live.filter(r => isIncome(r.c.kind)), r => r.value),
    committed: sum(live.filter(r => !isIncome(r.c.kind)), r => r.value),
    // retention the company is still waiting to get back from clients
    retentionHeld: sum(live.filter(r => isIncome(r.c.kind)), r => r.value * (+r.c.retentionPct || 0) / 100),
    alerts: sum(rows, r => r.alerts.length),
    urgent: sum(rows, r => r.alerts.filter(a => a.sev === 'high').length),
  };
}

/** For the number beside Contracts in the sidebar. */
export const alertCount = (contracts, today) => sum(contracts, c => contractAlerts(c, today).length);
