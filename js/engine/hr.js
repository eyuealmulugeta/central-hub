// HR: who works for the company, on what agreement, and which of their
// papers are about to run out. Pure functions over the staff records.

import { toDay, sum } from '../core/util.js';
import { convert } from './pricing.js';

export const AGREEMENT_TYPES = [
  ['permanent', 'Permanent employment'], ['fixed', 'Fixed term'], ['probation', 'Probation'],
  ['daily', 'Daily labour'], ['consultant', 'Consultant or freelance'], ['intern', 'Internship'],
];
export const agreementLabel = id => AGREEMENT_TYPES.find(([k]) => k === id)?.[1] || 'No agreement recorded';
export const PAY_PERIODS = [['month', 'per month'], ['day', 'per day'], ['hour', 'per hour']];
export const DOCUMENT_KINDS = ['Passport', 'Visa or residence permit', 'Work permit', 'National ID', 'Driving licence', 'Medical certificate', 'Safety certificate', 'Other'];

const WARN_DAYS = 60;          // papers and agreements are flagged this long before they run out
const PROBATION_WARN_DAYS = 14;
const WORK_DAYS_PER_MONTH = 26;
const HOURS_PER_DAY = 8;

/** Everything about one person that needs attention, most urgent first. */
export function staffAlerts(person, today) {
  if (person.status === 'left') return [];
  const T = toDay(today);
  const out = [];
  const check = (what, date, warn = WARN_DAYS) => {
    if (!date) return;
    const days = toDay(date) - T;
    if (days < 0) out.push({ sev: 'high', days, text: `${what} ran out ${-days} day${days === -1 ? '' : 's'} ago` });
    else if (days <= warn) out.push({ sev: 'warn', days, text: `${what} runs out in ${days} day${days === 1 ? '' : 's'}` });
  };
  for (const d of person.documents || []) check(d.kind, d.expiry);
  const a = person.agreement || {};
  if (a.type) {
    check('Agreement', a.end);
    if (a.probationEnd) {
      const days = toDay(a.probationEnd) - T;
      if (days >= 0 && days <= PROBATION_WARN_DAYS) out.push({ sev: 'warn', days, text: `Probation ends in ${days} day${days === 1 ? '' : 's'}: confirm or end` });
    }
    if (!a.signedOn) out.push({ sev: 'warn', days: 0, text: 'Agreement is not signed yet' });
  } else {
    out.push({ sev: 'warn', days: 0, text: 'No agreement recorded' });
  }
  return out.sort((x, y) => x.days - y.days);
}

/** Pay brought to a month, so people on different terms can be added up. */
export function monthlyPay(person, fx, currency) {
  const a = person.agreement || {};
  const pay = +a.pay || 0;
  const perMonth = a.payPer === 'day' ? pay * WORK_DAYS_PER_MONTH : a.payPer === 'hour' ? pay * HOURS_PER_DAY * WORK_DAYS_PER_MONTH : pay;
  return convert(perMonth, a.currency || currency, currency, fx);
}

export function hrSummary(staff, fx, today, currency) {
  const rows = staff.map(p => ({ p, alerts: staffAlerts(p, today), monthly: monthlyPay(p, fx, currency) }))
    .sort((a, b) => (a.p.status === 'left' ? 1 : 0) - (b.p.status === 'left' ? 1 : 0) || a.p.name.localeCompare(b.p.name));
  const active = rows.filter(r => r.p.status !== 'left');
  return {
    rows,
    active: active.length,
    payroll: sum(active, r => r.monthly),
    alerts: sum(active, r => r.alerts.length),
    urgent: sum(active, r => r.alerts.filter(a => a.sev === 'high').length),
  };
}

/** For the number beside HR in the sidebar. */
export const alertCount = (staff, today) => sum(staff, p => staffAlerts(p, today).length);
