// v1.23.0 (owner, 8 Nov, G10 T5): the trading dashboard (Money > Trading summary). One view of the trading side:
// this month against last month (and in AED at the peg), 12 months of sales and profit, top customers and products,
// the lowest margins, the pipeline (win rate, lost reasons), what is owed both ways by age, and the shipments.
// Profit and margin are the Admin's and the GM's (the page leaves them out for everyone else). Pure functions.

import { stockAndSales, tradeSummary, supplierPaid, landed } from './trade.js';
import { dealSales, dealTotals, OPEN, STEPS } from './deals.js';
import { dueOf, partnerOf } from './partners.js';
import { convert } from './pricing.js';
import { sum } from '../core/util.js';
import { PEG } from './zoho.js';

const r2 = v => Math.round((+v || 0) * 100) / 100;
const pct = (a, b) => (b > 0 ? (a - b) / b * 100 : null);
const monthOf = d => String(d || '').slice(0, 7);
/** The 12 months up to `today`'s month, oldest first (YYYY-MM). */
export function lastMonths(today, n = 12) {
  const [y, m] = String(today).slice(0, 7).split('-').map(Number);
  return Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1)); return d.toISOString().slice(0, 7); });
}
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
export const AGES = [['current', 'Not due yet'], ['d30', '1–30 days late'], ['d60', '31–60 days late'], ['d90', '61–90 days late'], ['d90p', 'Over 90 days late']];
export const ageOf = late => (late <= 0 ? 'current' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : late <= 90 ? 'd90' : 'd90p');

/** Every sale, stock sales and invoiced deals, in `currency`, with the product lines of each for the product ranking. */
export function allSales(company, fx, currency) {
  const st = stockAndSales({ shipments: company.shipments || [], sales: company.sales || [] }, fx, currency);
  const conv = v => convert(+v || 0, 'USD', currency, fx);
  const stock = st.sales.map(x => ({ id: x.id, date: x.date, customer: x.customer || '', revenue: x.revenue, cost: x.cost, paid: !!x.paid, due: x.due, what: x.item,
    lines: [{ name: x.item, revenue: x.revenue, cost: x.cost }] }));
  const deals = dealSales(company.deals).map(x => {
    const d = (company.deals || []).find(k => k.id === x.id) || {};
    return { id: x.id, date: x.date, customer: x.customer || '', revenue: conv(x.revenue), cost: conv(x.cost), paid: x.paid, due: x.due, what: `Deal ${d.ref || ''}`.trim(),
      lines: dealTotals(d).lines.map(l => ({ name: l.description, revenue: conv(l.priceTotal), cost: conv(l.costTotal) })) };
  });
  return { st, rows: [...stock, ...deals].sort((a, b) => String(b.date).localeCompare(String(a.date))) };
}

function rank(rows, key, n = 5) {
  const m = new Map();
  for (const r of rows) { const k = key(r) || 'Not named'; const x = m.get(k) || { name: k, revenue: 0, cost: 0, count: 0 }; x.revenue += r.revenue; x.cost += r.cost; x.count++; m.set(k, x); }
  return [...m.values()].map(x => ({ ...x, profit: x.revenue - x.cost, margin: x.revenue > 0 ? (x.revenue - x.cost) / x.revenue * 100 : null }))
    .sort((a, b) => b.revenue - a.revenue).slice(0, n);
}

/** The whole dashboard. */
export function tradeDash(company, fx, currency, today) {
  const { st, rows } = allSales(company, fx, currency);
  const months = lastMonths(today);
  const cur = months[11], prev = months[10];
  const inM = m => rows.filter(r => monthOf(r.date) === m);
  const fig = list => { const revenue = sum(list, r => r.revenue), cost = sum(list, r => r.cost); return { revenue, cost, profit: revenue - cost, margin: revenue > 0 ? (revenue - cost) / revenue * 100 : null, count: list.length }; };
  const now = fig(inM(cur)), before = fig(inM(prev));
  const deals = company.deals || [];
  const wonIn = m => deals.filter(d => (d.status === 'invoiced' || d.status === 'paid') && monthOf(d.invoiceDate) === m).length;
  const lostAt = d => monthOf(d.lost?.at || d.updated || d.created);
  const year = rows.filter(r => monthOf(r.date) >= months[0]);
  const yearLines = year.flatMap(r => r.lines.map(l => ({ ...l, revenue: l.revenue, cost: l.cost })));

  // pipeline
  const open = deals.filter(d => OPEN.includes(d.status));
  const won12 = deals.filter(d => (d.status === 'invoiced' || d.status === 'paid') && monthOf(d.invoiceDate) >= months[0]);
  const lost12 = deals.filter(d => d.status === 'lost' && lostAt(d) >= months[0]);
  const reasons = new Map();
  for (const d of lost12) { const k = String(d.lost?.reason || 'No reason given').trim() || 'No reason given'; reasons.set(k, (reasons.get(k) || 0) + 1); }

  // owed to us: unpaid sales by how late they are (due from the partner's terms)
  const owed = rows.filter(r => !r.paid).map(r => {
    const due = r.due || dueOf(r, partnerOf(company.partners, r.customer));
    const late = due ? days(due, today) : 0;
    return { ...r, due, late: Math.max(0, late), age: ageOf(late) };
  }).sort((a, b) => b.late - a.late);
  // we owe: goods of each supplier shipment less what was paid, aged from the order date
  const owe = (company.shipments || []).filter(s => !s.projectId).map(s => {
    const goods = landed(s, fx, currency).goods, paid = supplierPaid(s, fx, currency, goods), left = goods - paid;
    const from = s.ordered || s.created || today;
    return { id: s.id, ref: s.ref, supplier: s.supplier || '', amount: left, since: from, age: days(from, today) };
  }).filter(x => x.amount > 0.005).sort((a, b) => b.age - a.age);
  const bucket = (list, amt) => AGES.map(([k, label]) => ({ key: k, label, amount: sum(list.filter(x => x.age === k), amt), count: list.filter(x => x.age === k).length }));
  const oweAge = d => (d <= 30 ? 'current' : d <= 60 ? 'd30' : d <= 90 ? 'd60' : d <= 120 ? 'd90' : 'd90p');
  const OWE_AGES = [['current', 'Up to 30 days'], ['d30', '31–60 days'], ['d60', '61–90 days'], ['d90', '91–120 days'], ['d90p', 'Over 120 days']];

  const ship = tradeSummary((company.shipments || []).filter(s => !s.projectId), fx, today, currency);
  return {
    currency, months: { cur, prev },
    month: { ...now, change: pct(now.revenue, before.revenue), profitChange: pct(now.profit, before.profit), won: wonIn(cur), wonBefore: wonIn(prev), aed: currency === 'USD' ? now.revenue * PEG : null },
    before,
    series: months.map(m => ({ month: m, ...fig(inM(m)) })),
    topCustomers: rank(year, r => r.customer),
    topProducts: rank(yearLines, l => l.name),
    lowest: year.filter(r => r.revenue > 0).map(r => ({ ...r, margin: (r.revenue - r.cost) / r.revenue * 100 })).sort((a, b) => a.margin - b.margin).slice(0, 5),
    pipeline: {
      open: open.length, value: sum(open, d => convert(dealTotals(d).price, 'USD', currency, fx)),
      steps: STEPS.filter(([k]) => OPEN.includes(k)).map(([k, label]) => ({ key: k, label, count: open.filter(d => d.status === k).length, value: sum(open.filter(d => d.status === k), d => convert(dealTotals(d).price, 'USD', currency, fx)) })),
      won: won12.length, lost: lost12.length, winRate: won12.length + lost12.length ? won12.length / (won12.length + lost12.length) * 100 : null,
      reasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    },
    owed: { list: owed, total: sum(owed, x => x.revenue), ages: bucket(owed, x => x.revenue) },
    owe: { list: owe.map(x => ({ ...x, age: oweAge(x.age), days: x.age })), total: sum(owe, x => x.amount), ages: OWE_AGES.map(([k, label]) => ({ key: k, label, amount: sum(owe.filter(x => oweAge(x.age) === k), x => x.amount), count: owe.filter(x => oweAge(x.age) === k).length })) },
    ship: { open: ship.open, onTheWay: ship.onTheWay, late: ship.late, landedThisYear: ship.landedThisYear, rows: ship.rows.filter(r => !r.state.done).sort((a, b) => String(a.s.eta || '9').localeCompare(String(b.s.eta || '9'))) },
    stockValue: st.stockValue,
  };
}

/** Excel: one sheet per part; profit and margin only when `profit` (Admin, GM). */
export function dashSheets(d, profit) {
  const c = d.currency;
  const P = (...x) => (profit ? x : []);
  return [
    { name: 'Months', rows: [['Month', `Sales (${c})`, ...P(`Profit (${c})`, 'Margin %'), 'Sales'], ...d.series.map(s => [s.month, r2(s.revenue), ...P(r2(s.profit), s.margin == null ? '' : Math.round(s.margin)), s.count])] },
    { name: 'Top customers', rows: [['Customer', `Sales (${c})`, ...P(`Profit (${c})`, 'Margin %'), 'Sales'], ...d.topCustomers.map(x => [x.name, r2(x.revenue), ...P(r2(x.profit), x.margin == null ? '' : Math.round(x.margin)), x.count])] },
    { name: 'Top products', rows: [['Product', `Sales (${c})`, ...P(`Profit (${c})`, 'Margin %')], ...d.topProducts.map(x => [x.name, r2(x.revenue), ...P(r2(x.profit), x.margin == null ? '' : Math.round(x.margin))])] },
    { name: 'Pipeline', rows: [['Step', 'Deals', `Value (${c})`], ...d.pipeline.steps.map(s => [s.label, s.count, r2(s.value)]), [], ['Won (12 months)', d.pipeline.won], ['Lost (12 months)', d.pipeline.lost], ['Win rate %', d.pipeline.winRate == null ? '' : Math.round(d.pipeline.winRate)], [], ['Lost reason', 'Deals'], ...d.pipeline.reasons.map(r => [r.reason, r.count])] },
    { name: 'Owed to us', rows: [['Customer', 'Sale', 'Date', 'Due', 'Days late', `Amount (${c})`], ...d.owed.list.map(x => [x.customer, x.what, x.date || '', x.due || '', x.late, r2(x.revenue)])] },
    { name: 'We owe', rows: [['Supplier', 'Shipment', 'Ordered', 'Days', `Amount (${c})`], ...d.owe.list.map(x => [x.supplier, x.ref || '', x.since || '', x.days, r2(x.amount)])] },
    { name: 'Shipments', rows: [['Shipment', 'Supplier', 'Status', 'ETA', 'Late days', `Landed (${c})`], ...d.ship.rows.map(r => [r.s.ref || '', r.s.supplier || '', r.s.status || '', r.s.eta || '', r.state.daysLate || 0, r2(r.cost.total)])] },
  ];
}
