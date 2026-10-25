// The ledger statement and the project finance summary (v0.22.2): money in and out over a period with the running
// balance, totals in each currency as entered, and spend against the budget per line. Pure: the rows come from
// summarize in js/engine/ledger.js (each with `base`, the amount in the project's currency).

import { sum } from '../core/util.js';

/**
 * Entries from `from` to `to` (inclusive, '' = open), oldest first, with the balance after each one. The balance
 * starts from everything before `from`. Estimates (crew labour paid through Payments) are left out: they are not cash.
 * `only` = 'income' | 'expense' keeps one side (the opening balance still counts both).
 */
export function statement(rows, { from = '', to = '', only = null } = {}) {
  const cash = rows.filter(r => !r.estimate).sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  const signed = r => (r.type === 'income' ? r.base : -r.base);
  const opening = sum(cash.filter(r => from && r.date < from), signed);
  let balance = opening;
  const lines = [];
  for (const r of cash.filter(r => (!from || r.date >= from) && (!to || r.date <= to))) {
    balance += signed(r);
    if (!only || r.type === only) lines.push({ ...r, in: r.type === 'income' ? r.base : 0, out: r.type === 'income' ? 0 : r.base, balance });
  }
  const byCurrency = {};
  for (const r of lines) {
    const t = byCurrency[r.currency] ||= { currency: r.currency, in: 0, out: 0, count: 0 };
    t[r.type === 'income' ? 'in' : 'out'] += r.amount;
    t.count++;
  }
  return {
    opening, closing: balance, lines,
    in: sum(lines, r => r.in), out: sum(lines, r => r.out),
    byCurrency: Object.values(byCurrency).sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}

/**
 * Budget against actual per line for the one-page summary. The project has one budget and, since v0.21.2, a labour
 * line; the other categories have no budget of their own, so they show their share of the spend.
 */
export function budgetLines(led, project, labels) {
  const labour = +project.labourBudget || 0;
  const lines = Object.entries(led.byCategory).map(([k, actual]) => ({
    key: k, name: labels[k] || k, actual,
    budget: k === 'labor' && labour ? labour : null,
    share: led.spent ? actual / led.spent * 100 : 0,
  }));
  for (const l of lines) l.used = l.budget ? l.actual / l.budget * 100 : null;
  const total = { name: 'Total', actual: led.spent, budget: led.budget || null, used: led.budget ? led.spent / led.budget * 100 : null, share: 100 };
  return { lines: lines.filter(l => l.actual || l.budget), total };
}
