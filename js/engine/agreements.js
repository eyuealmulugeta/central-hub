// Employment agreements: where each person's agreement stands, from the HR record. Pure functions;
// the screen is ui/employment.js. (Client and supplier agreements are Contracts, a different page.)

import { toDay } from '../core/util.js';

export const SOON_DAYS = 60;   // an agreement is flagged this long before it ends, like the papers in HR

/**
 * One person's agreement: { state, text, days } with state 'none' (nothing recorded), 'open' (no end date),
 * 'running', 'ending' (within 60 days), 'expired', or 'probation' (probation ends within 60 days).
 */
export function agreementState(person, today) {
  const a = person.agreement || {};
  if (!a.type && !a.pay && !a.start && !a.end) return { state: 'none', text: 'No agreement recorded', days: null };
  const T = toDay(today);
  if (a.end) {
    const left = toDay(a.end) - T;
    if (left < 0) return { state: 'expired', text: `Ended ${-left} day${left === -1 ? '' : 's'} ago`, days: left };
    if (left <= SOON_DAYS) return { state: 'ending', text: left === 0 ? 'Ends today' : `Ends in ${left} day${left === 1 ? '' : 's'}`, days: left };
  }
  if (a.probationEnd) {
    const left = toDay(a.probationEnd) - T;
    if (left >= 0 && left <= SOON_DAYS) return { state: 'probation', text: left === 0 ? 'Probation ends today' : `Probation ends in ${left} day${left === 1 ? '' : 's'}`, days: left };
  }
  return a.end ? { state: 'running', text: 'Running', days: toDay(a.end) - T } : { state: 'open', text: 'Open-ended', days: null };
}

const ORDER = { expired: 0, ending: 1, probation: 2, none: 3, running: 4, open: 5 };

/** The people with an agreement to look at, worst first: expired, ending soon, probation, then those with nothing recorded. */
export function agreementRows(staff, today, filter = 'all') {
  return staff
    .filter(p => p.status !== 'left')
    .map(p => ({ p, ...agreementState(p, today) }))
    .filter(r => filter === 'all' || (filter === 'attention' ? ['expired', 'ending', 'probation', 'none'].includes(r.state) : r.state === filter))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.days ?? 1e9) - (b.days ?? 1e9) || a.p.name.localeCompare(b.p.name));
}
