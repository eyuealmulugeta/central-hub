// v1.23.0 (owner, 8 Nov, G10 T5): the trading dashboard, drawn inside Money > Trading summary (ui/finance.js).
// Admin and GM see profit and margin; everyone else with Trading sees the rest. Excel and a one-page print.

import { store } from '../core/store.js';
import { money, fmtFull } from '../core/util.js';
import { html, chip } from './dom.js';
import { docHead, docSec, docFoot, footText, signoff } from './print.js';
import { tradeDash } from '../engine/tradedash.js';
import { stageLabel } from '../engine/trade.js';

/** Profit and margin: the Admin and the GM only (owner). */
export const seesProfit = () => !!store.isAdmin || (store.ranks || []).includes('general_manager');
export const dashOf = (c, cur) => tradeDash(c.company, c.global.fx, cur, c.today);

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monLabel = m => `${MON[+m.slice(5, 7) - 1]} ${m.slice(2, 4)}`;
const change = v => (v == null ? 'no sales last month' : `${v >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(v))}% on last month`);
const pctTxt = v => (v == null ? '—' : `${Math.round(v)}%`);

/** 12 months of sales as bars, with profit as a darker inner bar for the Admin and GM. */
function chart(series, cur, profit) {
  const W = 720, H = 200, pad = 28, bw = (W - pad) / series.length;
  const max = Math.max(1, ...series.map(s => s.revenue));
  const y = v => H - 22 - Math.max(0, v) / max * (H - 40);
  return html`<svg class="td-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales by month, last 12 months">
    <line x1="${pad}" y1="${H - 22}" x2="${W}" y2="${H - 22}" stroke="var(--line)"/>
    ${series.map((s, i) => {
      const x = pad + i * bw + bw * 0.15, w = bw * 0.7;
      return html`<g><title>${monLabel(s.month)}: ${money(s.revenue, cur)}${profit ? `, profit ${money(s.profit, cur)}` : ''}</title>
        <rect x="${x}" y="${y(s.revenue)}" width="${w}" height="${H - 22 - y(s.revenue)}" rx="3" fill="var(--primary)" opacity=".35"/>
        ${profit && s.profit > 0 ? html`<rect x="${x + w * 0.25}" y="${y(s.profit)}" width="${w * 0.5}" height="${H - 22 - y(s.profit)}" rx="2" fill="var(--primary)"/>` : ''}
        <text x="${x + w / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--muted)">${monLabel(s.month)}</text></g>`;
    })}
  </svg>
  <p class="muted small">${profit ? 'Light bar: sales. Dark bar: profit.' : 'Sales by month.'} Hover a month for the amounts.</p>`;
}

const kpi = (label, value, sub, cls = '') => html`<div class="kpi"><span class="kpi-label">${label}</span><strong class="${cls}">${value}</strong><span class="muted">${sub}</span></div>`;

function ageTable(ages, cur) {
  return html`<div class="td-ages">${ages.map((a, i) => html`<div class="${i > 1 && a.amount > 0 ? 'warn' : ''}"><b>${money(a.amount, cur)}</b><span>${a.label}${a.count ? ` · ${a.count}` : ''}</span></div>`)}</div>`;
}

/** The screen. */
export function dashPage(c, cur, toolbar) {
  const d = dashOf(c, cur), P = seesProfit(), m = v => money(v, cur);
  const empty = !d.series.some(s => s.count) && !d.pipeline.open && !d.ship.open && !d.owe.total;
  if (empty) return html`<div class="side">${toolbar}<p class="empty">No trading yet. Deals, sales and shipments under Trading fill this dashboard.</p></div>`;
  const rankT = (rows, label) => rows.length ? html`<table class="table compact"><thead><tr><th>${label}</th><th class="r">Sales</th>${P ? html`<th class="r">Profit</th><th class="r">Margin</th>` : ''}</tr></thead>
    <tbody>${rows.map(x => html`<tr><td>${x.name}</td><td class="r nowrap">${m(x.revenue)}</td>${P ? html`<td class="r nowrap ${x.profit < 0 ? 'bad' : ''}">${m(x.profit)}</td><td class="r">${pctTxt(x.margin)}</td>` : ''}</tr>`)}</tbody></table>` : html`<p class="empty">No sale in the last 12 months.</p>`;
  return html`
    <div class="side trade-dash">
      ${toolbar}
      <section class="kpis">
        ${kpi(`Sales, ${monLabel(d.months.cur)}`, m(d.month.revenue), change(d.month.change))}
        ${d.month.aed != null ? kpi('Sales in AED', money(d.month.aed, 'AED'), 'At the peg 3.6725') : ''}
        ${P ? kpi('Profit this month', m(d.month.profit), d.month.margin == null ? 'No sale yet' : `${pctTxt(d.month.margin)} margin · ${change(d.month.profitChange)}`, d.month.profit < 0 ? 'bad' : '') : ''}
        ${kpi('Deals won', String(d.month.won), `${d.month.wonBefore} last month`)}
        ${kpi('Pipeline', m(d.pipeline.value), `${d.pipeline.open} open deal${d.pipeline.open === 1 ? '' : 's'}`)}
        ${kpi('Owed to us', m(d.owed.total), `${d.owed.list.filter(x => x.late > 0).length} late`, d.owed.list.some(x => x.late > 30) ? 'bad' : '')}
        ${kpi('We owe suppliers', m(d.owe.total), `${d.owe.list.length} shipment${d.owe.list.length === 1 ? '' : 's'}`)}
        ${kpi('Stock value', m(d.stockValue), 'Unsold goods at landed cost')}
      </section>
      <section class="card"><h2>Last 12 months</h2>${chart(d.series, cur, P)}</section>
      <div class="grid2">
        <section class="card"><h2>Top customers <span class="muted small">12 months</span></h2>${rankT(d.topCustomers, 'Customer')}</section>
        <section class="card"><h2>Top products <span class="muted small">12 months</span></h2>${rankT(d.topProducts, 'Product')}</section>
      </div>
      ${P ? html`<section class="card"><h2>Lowest margins <span class="muted small">12 months</span></h2>
        ${d.lowest.length ? html`<table class="table compact"><thead><tr><th>Date</th><th>Sale</th><th>Customer</th><th class="r">Sales</th><th class="r">Margin</th></tr></thead>
          <tbody>${d.lowest.map(x => html`<tr><td class="nowrap">${fmtFull(x.date)}</td><td>${x.what}</td><td>${x.customer}</td><td class="r nowrap">${m(x.revenue)}</td><td class="r ${x.margin < 10 ? 'bad' : ''}">${pctTxt(x.margin)}</td></tr>`)}</tbody></table>` : html`<p class="empty">No sale yet.</p>`}</section>` : ''}
      <section class="card"><h2>Pipeline</h2>
        <div class="td-ages">${d.pipeline.steps.map(s => html`<div><b>${s.count}</b><span>${s.label} · ${m(s.value)}</span></div>`)}</div>
        <p>Win rate (12 months): <b>${pctTxt(d.pipeline.winRate)}</b> · ${d.pipeline.won} won, ${d.pipeline.lost} lost</p>
        ${d.pipeline.reasons.length ? html`<p class="muted small">Why deals were lost: ${d.pipeline.reasons.map(r => `${r.reason} (${r.count})`).join(', ')}</p>` : ''}
        <a class="btn small" href="#deals">Open Deals</a></section>
      <div class="grid2">
        <section class="card"><h2>Owed to us</h2>${ageTable(d.owed.ages, cur)}
          ${d.owed.list.length ? html`<table class="table compact"><thead><tr><th>Customer</th><th>Sale</th><th>Due</th><th class="r">Amount</th></tr></thead>
            <tbody>${d.owed.list.slice(0, 10).map(x => html`<tr><td>${x.customer || '—'}</td><td>${x.what}</td><td class="nowrap">${x.due ? fmtFull(x.due) : '—'}${x.late ? html` ${chip(`${x.late} days late`, x.late > 30 ? 'bad' : 'warn')}` : ''}</td><td class="r nowrap">${m(x.revenue)}</td></tr>`)}</tbody></table>` : html`<p class="empty">Nothing owed.</p>`}</section>
        <section class="card"><h2>We owe suppliers</h2>${ageTable(d.owe.ages, cur)}
          ${d.owe.list.length ? html`<table class="table compact"><thead><tr><th>Supplier</th><th>Shipment</th><th>Ordered</th><th class="r">Left to pay</th></tr></thead>
            <tbody>${d.owe.list.slice(0, 10).map(x => html`<tr><td>${x.supplier || '—'}</td><td>${x.ref || ''}</td><td class="nowrap">${x.since ? fmtFull(x.since) : '—'}</td><td class="r nowrap">${m(x.amount)}</td></tr>`)}</tbody></table>` : html`<p class="empty">Nothing owed.</p>`}</section>
      </div>
      <section class="card"><h2>Shipments on the way</h2>
        <p>${d.ship.open} open · ${m(d.ship.onTheWay)} landed${d.ship.late ? html` · ${chip(`${d.ship.late} late`, 'bad')}` : ''}</p>
        ${d.ship.rows.length ? html`<table class="table compact"><thead><tr><th>Shipment</th><th>Supplier</th><th>Status</th><th>ETA</th><th class="r">Landed</th></tr></thead>
          <tbody>${d.ship.rows.slice(0, 10).map(r => html`<tr><td>${r.s.ref}</td><td>${r.s.supplier || ''}</td><td>${stageLabel(r.s.status)}</td><td class="nowrap">${r.s.eta ? fmtFull(r.s.eta) : '—'}${r.state.late ? html` ${chip(`${r.state.daysLate} days late`, 'bad')}` : ''}</td><td class="r nowrap">${m(r.cost.total)}</td></tr>`)}</tbody></table>` : ''}
        <a class="btn small" href="#trade">Open Shipments</a></section>
      <p class="muted">Trading records only; the projects are under Installation. A management view, not statutory accounts.${P ? '' : ' Profit and margin are shown to the Admin and the GM.'}</p>
    </div>`;
}

/** One page to print or send. */
export function dashPaper(c, cur, title, ref) {
  const d = dashOf(c, cur), P = seesProfit(), m = v => money(v, cur);
  const foot = footText(c, title, ref, { project: false, note: 'internal' });
  return html`<section class="card sheet"><div class="paper dsr doc-paper fin-paper" data-foot="${foot}">
    ${docHead(c, { title, sub: fmtFull(c.today), ref, facts: [['As of', fmtFull(c.today)], ['Currency', `${cur}, converted`], ['Month', monLabel(d.months.cur)]] })}
    <div class="dsr-kpis" style="grid-template-columns:repeat(${P ? 5 : 4},1fr)">
      <div><b>${m(d.month.revenue)}</b><span>Sales this month · ${change(d.month.change)}</span></div>
      ${P ? html`<div class="${d.month.profit < 0 ? 'warn' : ''}"><b>${m(d.month.profit)}</b><span>Profit · ${pctTxt(d.month.margin)} margin</span></div>` : ''}
      <div><b>${m(d.pipeline.value)}</b><span>Pipeline · ${d.pipeline.open} deals · win rate ${pctTxt(d.pipeline.winRate)}</span></div>
      <div><b>${m(d.owed.total)}</b><span>Owed to us</span></div>
      <div><b>${m(d.owe.total)}</b><span>We owe suppliers</span></div>
    </div>
    ${docSec(1, 'Last 12 months', html`<table class="dsr-t"><thead><tr><th>Month</th><th class="r">Sales</th>${P ? html`<th class="r">Profit</th><th class="r">Margin</th>` : ''}</tr></thead>
      <tbody>${d.series.map(s => html`<tr><td>${monLabel(s.month)}</td><td class="r nowrap">${m(s.revenue)}</td>${P ? html`<td class="r nowrap">${m(s.profit)}</td><td class="r">${pctTxt(s.margin)}</td>` : ''}</tr>`)}</tbody></table>`)}
    ${docSec(2, 'Top customers and products', html`<table class="dsr-t"><thead><tr><th>Customer</th><th class="r">Sales</th><th>Product</th><th class="r">Sales</th></tr></thead>
      <tbody>${Array.from({ length: Math.max(d.topCustomers.length, d.topProducts.length) }, (_, i) => html`<tr><td>${d.topCustomers[i]?.name || ''}</td><td class="r nowrap">${d.topCustomers[i] ? m(d.topCustomers[i].revenue) : ''}</td><td>${d.topProducts[i]?.name || ''}</td><td class="r nowrap">${d.topProducts[i] ? m(d.topProducts[i].revenue) : ''}</td></tr>`)}</tbody></table>`)}
    ${docSec(3, 'Owed both ways, by age', html`<table class="dsr-t"><thead><tr><th>Owed to us</th><th class="r">Amount</th><th>We owe</th><th class="r">Amount</th></tr></thead>
      <tbody>${d.owed.ages.map((a, i) => html`<tr><td>${a.label}</td><td class="r nowrap">${m(a.amount)}</td><td>${d.owe.ages[i].label}</td><td class="r nowrap">${m(d.owe.ages[i].amount)}</td></tr>`)}</tbody></table>`)}
    ${docSec(4, 'Shipments on the way', d.ship.rows.length ? html`<table class="dsr-t"><thead><tr><th>Shipment</th><th>Supplier</th><th>ETA</th><th class="r">Landed</th></tr></thead>
      <tbody>${d.ship.rows.slice(0, 10).map(r => html`<tr><td>${r.s.ref}</td><td>${r.s.supplier || ''}</td><td class="nowrap">${r.s.eta ? fmtFull(r.s.eta) : '—'}${r.state.late ? `, ${r.state.daysLate} days late` : ''}</td><td class="r nowrap">${m(r.cost.total)}</td></tr>`)}</tbody></table>` : html`<p class="dsr-none">No shipment on the way.</p>`)}
    <p class="muted p-notes">Trading records only. A management view, not statutory accounts.</p>
    ${signoff([{ label: 'Prepared by' }, { label: 'Checked by' }])}
    ${docFoot(foot)}
  </div></section>`;
}
