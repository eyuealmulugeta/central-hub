// v0.63.0 (owner, 2 Nov, Phase B3): the labour budget per trade. Settings, This project: a budget for each trade in
// man-days and money (project.tradeBudgets, in the project's pay currency). The actual comes from the approved daily
// reports (people on site per trade, overtime as part of a day) at the trade's day pay: the average directory day pay of
// the project's team in that trade, else the trade rate. A trade at 90 % of its budget is a warning, at 100 % over.
// Projects with no per-trade budget keep the one labour line. Pure functions.

import { billingOf } from './billing.js';
import { directoryPay } from './crewpay.js';

const key = t => String(t || '').trim().toLowerCase();

/** The day pay of a trade on this project: the average directory day pay of its team members, else the trade rate. */
export function tradeRate(trade, ws, staff = []) {
  const pays = (ws.team || []).filter(m => m.active !== false && key(m.role) === key(trade) && m.personId)
    .map(m => directoryPay((staff || []).find(p => p.id === m.personId)))
    .filter(d => d && d.per === 'day' && d.amount > 0).map(d => d.amount);
  if (pays.length) return Math.round(pays.reduce((a, b) => a + b, 0) / pays.length);
  const rates = ws.laborRates || {};
  return +(rates[trade] ?? rates[Object.keys(rates).find(k => key(k) === key(trade))]) || 0;
}

/** Man-days and cost per trade from the approved reports: { trade: { days, cost } }. */
export function tradeActuals(ws, project, staff = []) {
  const { hoursPerDay } = billingOf(project);
  const out = {};
  for (const r of ws.reports || []) {
    if (r.review === 'pending' || !r.manpower?.length) continue;
    for (const m of r.manpower) {
      const t = String(m.trade || '').trim();
      if (!t) continue;
      const days = (+m.count || 0) + (+m.ot || 0) / (hoursPerDay || 8);
      const k = Object.keys(out).find(x => key(x) === key(t)) || t;
      out[k] = out[k] || { days: 0, cost: 0 };
      out[k].days += days;
    }
  }
  for (const [t, a] of Object.entries(out)) { a.days = Math.round(a.days * 10) / 10; a.cost = Math.round(a.days * tradeRate(t, ws, staff)); }
  return out;
}

const level = pct => (pct == null ? '' : pct >= 100 ? 'over' : pct >= 90 ? 'warn' : 'ok');
const pctOf = (a, b) => (b > 0 ? Math.round(a / b * 100) : null);

/** One line per trade with a budget or work done: budget, actual, the share used and its level (ok, warn, over). */
export function tradeLines(project, actuals) {
  const budgets = project.tradeBudgets || {};
  const trades = [...new Set([...Object.keys(budgets), ...Object.keys(actuals || {})])];
  return trades.map(trade => {
    const b = budgets[trade] || {}, a = actuals[trade] || Object.entries(actuals).find(([k]) => key(k) === key(trade))?.[1] || { days: 0, cost: 0 };
    const pd = pctOf(a.days, +b.days), pc = pctOf(a.cost, +b.amount);
    const worst = Math.max(pd ?? -1, pc ?? -1);
    return { trade, budgetDays: +b.days || 0, budgetAmount: +b.amount || 0, days: a.days, cost: a.cost, pctDays: pd, pctCost: pc, level: level(worst < 0 ? null : worst) };
  }).filter(l => l.budgetDays || l.budgetAmount || l.days || l.trade in budgets)
    .sort((x, y) => (+!!(y.budgetDays || y.budgetAmount) - +!!(x.budgetDays || x.budgetAmount)) || y.cost - x.cost || x.trade.localeCompare(y.trade));
}

export const hasTradeBudgets = project => Object.values(project?.tradeBudgets || {}).some(b => +b.days > 0 || +b.amount > 0);

/** The trades at 90 % or more of their budget, for "Needs you" and the project card. */
export const tradeWarnings = lines => lines.filter(l => l.level === 'warn' || l.level === 'over');
