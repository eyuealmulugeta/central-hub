// Cash flow of one project, month by month, one table per currency (currencies are never added together).
//
// Actual months: money really paid in and out, from the entries under Costs. The labour worked out from
// daily reports is a cost estimate, not cash, so it is not counted here.
// Forecast months (the next few): money expected in from invoices sent and not yet paid, by their due date,
// and money going out for the payroll of the people HR lists on this project and the usual spending
// (the average of the last three full months, leaving out labour when payroll is counted).
// Pure functions; the screen is ui/cashflow.js.

import { sum } from '../core/util.js';

export const monthOf = date => String(date).slice(0, 7);
export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
const monthsBetween = (a, b) => { const out = []; for (let k = a; k <= b; k = addMonths(k, 1)) out.push(k); return out; };
const r2 = n => Math.round(n * 100) / 100;

/**
 * @param ledger    recorded entries { date, type: 'income'|'expense', category, amount, currency }
 * @param docs      invoices and other documents { type, status, due, amountDue, number }
 * @param payroll   { [currency]: monthly pay } for the people on this project (empty when unknown)
 * @param today     YYYY-MM-DD
 * @param horizon   how many months ahead to forecast
 * @param usual     include the usual spending in the forecast
 * @param fallback  the currency of lines that carry none
 */
export function cashflow({ ledger = [], docs = [], payroll = {}, today, horizon = 3, usual = true, fallback = '' }) {
  const now = monthOf(today);
  const cur = e => e.currency || fallback;
  const currencies = [...new Set([...ledger.map(cur), ...docs.filter(d => d.type === 'invoice').map(() => fallback), ...Object.keys(payroll)])].filter(Boolean).sort();
  const unpaid = docs.filter(d => d.type === 'invoice' && d.status === 'sent' && +d.amountDue > 0);
  const drafts = docs.filter(d => d.type === 'invoice' && d.status === 'draft');

  return currencies.map(currency => {
    const rows = ledger.filter(e => cur(e) === currency && e.date);
    const first = rows.length ? rows.map(e => monthOf(e.date)).sort()[0] : now;
    const actual = monthsBetween(first < now ? first : now, now).map(month => {
      const inMonth = rows.filter(e => monthOf(e.date) === month);
      const money = type => r2(sum(inMonth.filter(e => e.type === type), e => +e.amount || 0));
      return { month, forecast: false, in: money('income'), out: money('expense'), parts: {} };
    });

    // the usual spending: the last three full months before this one, without labour when payroll is counted
    const usualPool = actual.filter(m => m.month < now).slice(-3);
    const payrollMonthly = r2(payroll[currency] || 0);
    const usualMonthly = usual && usualPool.length
      ? r2(sum(usualPool, m => sum(rows.filter(e => e.type === 'expense' && monthOf(e.date) === m.month && !(payrollMonthly && e.category === 'labor')), e => +e.amount || 0)) / usualPool.length)
      : 0;

    // invoices are in the project's currency
    const invoices = currency === fallback ? unpaid : [];
    const ahead = Array.from({ length: horizon }, (_, i) => addMonths(now, i + 1)).map((month, i) => {
      // what is due now or overdue is expected in the first month ahead; later invoices in the month they fall due
      const due = invoices.filter(d => { const m = monthOf(d.due || today); return i === 0 ? m <= month : m === month; });
      const inv = r2(sum(due, d => +d.amountDue || 0));
      return { month, forecast: true, in: inv, out: r2(payrollMonthly + usualMonthly), parts: { invoices: inv, payroll: payrollMonthly, usual: usualMonthly, invoiceCount: due.length } };
    });

    let balance = 0;
    const months = [...actual, ...ahead].map(m => { balance = r2(balance + m.in - m.out); return { ...m, net: r2(m.in - m.out), balance }; });
    const balanceNow = months.find(m => m.month === now)?.balance ?? 0;
    const short = months.find(m => m.forecast && m.balance < 0) || null;
    return {
      currency, months, balanceNow,
      expectedIn: r2(sum(ahead, m => m.in)), expectedOut: r2(sum(ahead, m => m.out)),
      overdue: r2(sum(invoices.filter(d => d.due && d.due < today), d => +d.amountDue || 0)),
      draft: currency === fallback ? r2(sum(drafts, d => +d.amountDue || +d.total || 0)) : 0,
      firstShortMonth: short?.month || '',
      payrollMonthly, usualMonthly,
    };
  });
}

/** Monthly pay of the active people on a project, per currency, in the currency of each agreement. */
export function payrollByCurrency(staff, projectId, monthlyPay, fx) {
  const out = {};
  for (const p of staff) {
    if (p.projectId !== projectId || p.status === 'left') continue;
    const c = p.agreement?.currency;
    if (!c) continue;
    out[c] = (out[c] || 0) + monthlyPay(p, fx, c);
  }
  return out;
}

/** Rows for the accountant (CSV): one per currency and month. */
export function csvRows(flows) {
  const rows = [['Currency', 'Month', 'Actual or forecast', 'Money in', 'Money out', 'Net', 'Balance']];
  for (const f of flows) for (const m of f.months) rows.push([f.currency, m.month, m.forecast ? 'Forecast' : 'Actual', m.in, m.out, m.net, m.balance]);
  return rows;
}
