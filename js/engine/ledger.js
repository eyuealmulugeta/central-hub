// Ledger engine: manual entries + labour cost derived from daily manpower logs.

import { convert } from './pricing.js';
import { billingOf } from './billing.js';
import { sum } from '../core/util.js';

export const CATEGORIES = ['labor', 'material', 'equipment', 'subcontract', 'transport', 'overhead'];

/**
 * One labour expense per daily report: headcount by trade x that trade's day rate, plus overtime hours at the overtime multiplier.
 * Once the project pays its crew through Payments (whose payments are real labour costs), these are only an estimate:
 * marked `estimate` and not counted as spent, so labour is never counted twice.
 */
export function laborRows(ws, project) {
  const { hoursPerDay, otMultiplier } = billingOf(project);
  const estimate = (ws.payments || []).length > 0;
  const cost = m => {
    const rate = ws.laborRates[m.trade] || 0;
    return m.count * rate + (m.ot || 0) * rate / hoursPerDay * otMultiplier;
  };
  return ws.reports
    .filter(r => r.manpower?.length)
    .map(r => ({
      id: 'auto-' + r.id, date: r.date, type: 'expense', category: 'labor', auto: true, ...(estimate ? { estimate: true } : {}),
      description: `Site labour, ${sum(r.manpower, m => m.count)} on site (from daily report)`,
      amount: sum(r.manpower, cost),
      currency: project.currency,
    }))
    .filter(r => r.amount > 0);
}

export function summarize(ws, project, global, sched) {
  const rows = [...ws.ledger, ...laborRows(ws, project)]
    .map(r => ({ ...r, base: convert(r.amount, r.currency, project.currency, global.fx) }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const expenses = rows.filter(r => r.type === 'expense' && !r.estimate);
  const spent = sum(expenses, r => r.base);
  const income = sum(rows.filter(r => r.type === 'income'), r => r.base);
  const byCategory = Object.fromEntries(CATEGORIES.map(c => [c, sum(expenses.filter(r => r.category === c), r => r.base)]));

  // earned value: budget x physical progress, compared with actual cost
  const budget = project.budget || 0;
  const earned = budget * sched.progress / 100;
  return {
    rows, spent, income, byCategory, budget, earned,
    remaining: budget - spent,
    cash: income - spent,
    cpi: spent > 0 && budget > 0 ? earned / spent : null,
  };
}
