// Finance: the whole company on one screen, across every project. Other
// projects' data is read when the screen opens (and on Refresh), not kept live.

import { store } from '../core/store.js';
import { companyFinance, invoiceExport, entryExport } from '../engine/finance.js';
import { stockAndSales, tradeSummary } from '../engine/trade.js';
import { money, fmtDate, fmtFull, toCSV, downloadText } from '../core/util.js';
import { html, options, meter, chip } from './dom.js';

let data = null;      // { workspaces, at }
let loading = false;
let failed = '';
let currency = '';    // '' = the base currency of the exchange-rate table
let part = 'construction';   // construction (Installation) | trading: the two are never on one page
export const preset = o => { part = o.part === 'trading' ? 'trading' : 'construction'; };

async function load() {
  if (loading) return;
  loading = true;
  failed = '';
  store.notify();
  try {
    const { workspaces } = await store.exportAll();
    data = { workspaces, at: new Date() };
  } catch (err) {
    console.warn(err);
    failed = 'Could not read all projects. Check the connection and try Refresh.';
  }
  loading = false;
  store.notify();
}

/** Figures are read fresh each time the screen is opened. */
export function onEnter() { if (part === 'construction') load(); }

const figures = c => companyFinance(store.projects, data.workspaces, c.global, c.today, currency || c.global.fx.base);

export function render(c) {
  if (part === 'trading') return tradingPage(c);
  const cur = currency || c.global.fx.base;
  const currencies = Object.keys(c.global.fx.rates).map(k => [k, k]);
  const toolbar = html`
    <div class="toolbar">
      <h2>All projects</h2>
      <span class="muted">${data ? `Figures read at ${data.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
      <span class="grow"></span>
      <label class="inline">Show in <select data-chg="currency" data-fk="fin-cur">${options(currencies, cur)}</select></label>
      <button class="btn" data-act="refresh" ${loading ? 'disabled' : ''}>${loading ? 'Reading…' : 'Refresh'}</button>
      <button class="btn" data-act="exportInvoices" ${data ? '' : 'disabled'} title="Every invoice of every project, as a spreadsheet file">Export invoices</button>
      <button class="btn" data-act="exportEntries" ${data ? '' : 'disabled'} title="Every cost and receipt of every project, as a spreadsheet file">Export costs and receipts</button>
    </div>`;
  if (!data) return html`<div class="side">${toolbar}<p class="empty">${failed || 'Reading every project…'}</p></div>`;

  const f = figures(c);
  const t = f.totals;
  const m = v => money(v, f.currency);
  const kpi = (label, value, sub, cls = '') => html`
    <div class="kpi"><span class="kpi-label">${label}</span><strong class="${cls}">${value}</strong><span class="muted">${sub}</span></div>`;
  const pct = v => (v == null ? '—' : `${Math.round(v)}%`);
  const topMonth = Math.max(1, ...f.months.flatMap(x => [x.in, x.out]));
  const monthLabel = key => new Date(key + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

  return html`
    <div class="side">
      ${toolbar}
      ${failed ? html`<p class="bad">${failed}</p>` : ''}
      <section class="kpis">
        ${kpi('Received', m(t.received), `of ${m(t.invoiced)} invoiced`)}
        ${kpi('Spent', m(t.spent), 'Costs and labour, all projects')}
        ${kpi('Cash position', m(t.cash), 'Received less spent', t.cash < 0 ? 'bad' : '')}
        ${kpi('Owed to you', m(t.owed), `${f.receivables.length} invoice${f.receivables.length === 1 ? '' : 's'} awaiting payment`)}
        ${kpi('Ordered, not delivered', m(t.committed), `${f.commitments.length} purchase order${f.commitments.length === 1 ? '' : 's'} open`)}
      </section>

      <section class="card">
        <h2>By project</h2>
        <table class="table">
          <thead><tr><th>Project</th><th class="r">Contract</th><th class="r">Invoiced</th><th class="r">Received</th><th class="r">Owed to you</th><th class="r">Spent</th><th class="r">Cash</th><th class="r">Margin</th><th>Progress</th></tr></thead>
          <tbody>${f.rows.map(r => html`
            <tr>
              <td><button class="link" data-act="open" data-id="${r.id}" title="Open this project's costs">${r.name}</button><span class="muted note">kept in ${r.currency}</span></td>
              <td class="r nowrap">${m(r.contract)}</td>
              <td class="r nowrap">${m(r.invoiced)}</td>
              <td class="r nowrap">${m(r.received)}</td>
              <td class="r nowrap">${m(r.owed)}</td>
              <td class="r nowrap">${m(r.spent)}</td>
              <td class="r nowrap ${r.cash < 0 ? 'bad' : ''}">${m(r.cash)}</td>
              <td class="r ${r.margin != null && r.margin < 0 ? 'bad' : ''}">${pct(r.margin)}</td>
              <td class="nowrap">${Math.round(r.progress)}% ${meter(r.progress)}</td>
            </tr>`)}
            <tr class="group">
              <td>Total</td><td class="r nowrap">${m(t.contract)}</td><td class="r nowrap">${m(t.invoiced)}</td><td class="r nowrap">${m(t.received)}</td>
              <td class="r nowrap">${m(t.owed)}</td><td class="r nowrap">${m(t.spent)}</td><td class="r nowrap ${t.cash < 0 ? 'bad' : ''}">${m(t.cash)}</td><td class="r">${pct(t.margin)}</td><td></td>
            </tr></tbody>
        </table>
        <p class="muted">Margin is what has been invoiced less what has been spent, as a share of what has been invoiced. Invoiced is before VAT; owed to you is the amount due on the invoice. Amounts are converted with the exchange rates under Settings.</p>
      </section>

      <section class="card">
        <h2>Owed to you</h2>
        <div class="grid4">${f.aging.map((a, i) => html`
          <div class="kpi flat"><span class="kpi-label">${a.label}</span><strong class="${i > 1 && a.amount > 0 ? 'bad' : ''}">${m(a.amount)}</strong></div>`)}</div>
        ${f.receivables.length ? html`<table class="table compact">
          <thead><tr><th>Invoice</th><th>Project</th><th>Client</th><th>Due</th><th></th><th class="r">Amount due</th></tr></thead>
          <tbody>${f.receivables.map(r => html`
            <tr><td>${r.number}</td><td>${r.project}</td><td>${r.client || '—'}</td><td class="nowrap">${fmtFull(r.due)}</td>
              <td>${r.overdue > 0 ? chip(`${r.overdue} days overdue`, r.overdue > 30 ? 'high' : 'warn') : chip('Not due yet')}</td>
              <td class="r nowrap">${m(r.amount)}</td></tr>`)}</tbody>
        </table>` : html`<p class="empty">No invoice is waiting for payment.</p>`}
      </section>

      <section class="card">
        <h2>Ordered from suppliers, not delivered yet</h2>
        ${f.commitments.length ? html`<table class="table compact">
          <thead><tr><th>Purchase order</th><th>Project</th><th>Supplier</th><th>Deliver by</th><th class="r">Value</th></tr></thead>
          <tbody>${f.commitments.map(x => html`
            <tr><td>${x.number}</td><td>${x.project}</td><td>${x.supplier || '—'}</td><td class="nowrap">${fmtDate(x.due)}</td><td class="r nowrap">${m(x.amount)}</td></tr>`)}</tbody>
        </table>` : html`<p class="empty">No purchase order is open.</p>`}
        <p class="muted">These are purchase orders marked as sent. Supplier bills and what has been paid against them are not tracked here yet.</p>
      </section>

      <section class="card">
        <h2>Money in and out by month</h2>
        ${f.months.length ? html`<table class="table compact">
          <thead><tr><th>Month</th><th class="r">Received</th><th></th><th class="r">Spent</th><th></th><th class="r">Net</th></tr></thead>
          <tbody>${f.months.map(x => html`
            <tr><td class="nowrap">${monthLabel(x.month)}</td>
              <td class="r nowrap">${m(x.in)}</td><td class="bar">${meter(x.in / topMonth * 100)}</td>
              <td class="r nowrap">${m(x.out)}</td><td class="bar">${meter(x.out / topMonth * 100, 'bad')}</td>
              <td class="r nowrap ${x.net < 0 ? 'bad' : ''}">${m(x.net)}</td></tr>`)}</tbody>
        </table>` : html`<p class="empty">Nothing has been received or spent yet.</p>`}
      </section>

      <p class="muted">This is a management view built from the projects. It is not a set of statutory accounts: tax returns and financial statements belong in your accounting software, which the two export files are made for.</p>
    </div>`;
}

/** The trading side on its own: what is in stock, on the way, sold and still owed. Nothing from the projects is in it. */
function tradingPage(c) {
  const cur = currency || c.global.fx.base;
  const currencies = Object.keys(c.global.fx.rates).map(k => [k, k]);
  const m = v => money(v, cur);
  const st = stockAndSales(c.company, c.global.fx, cur);
  const ship = tradeSummary(c.company.shipments, c.global.fx, c.today, cur);
  const kpi = (label, value, sub, cls = '') => html`
    <div class="kpi"><span class="kpi-label">${label}</span><strong class="${cls}">${value}</strong><span class="muted">${sub}</span></div>`;
  const toolbar = html`
    <div class="toolbar">
      <h2>Trading</h2><span class="muted">Stock, sales and what is owed</span><span class="grow"></span>
      <label class="inline">Show in <select data-chg="currency" data-fk="fin-cur">${options(currencies, cur)}</select></label>
    </div>`;
  if (!st.items.length && !st.sales.length && !ship.rows.length) return html`<div class="side">${toolbar}<p class="empty">No trading yet. Add a shipment under Trading, Shipments; its goods become stock, and sales are recorded under Stock and sales.</p></div>`;
  const unpaid = st.sales.filter(x => !x.paid);
  return html`
    <div class="side">
      ${toolbar}
      <section class="kpis">
        ${kpi('Stock value', m(st.stockValue), 'Unsold goods at landed cost')}
        ${kpi('On the way', m(ship.onTheWay), `${ship.open} shipment${ship.open === 1 ? '' : 's'} not delivered`)}
        ${kpi('Sold', m(st.revenue), `${st.sales.length} sale${st.sales.length === 1 ? '' : 's'}`)}
        ${kpi('Trading profit', m(st.profit), st.margin == null ? 'No sale yet' : `${Math.round(st.margin)}% of sales`, st.profit < 0 ? 'bad' : '')}
        ${kpi('Owed to you', m(st.unpaid), `${unpaid.length} sale${unpaid.length === 1 ? '' : 's'} not paid yet`)}
      </section>
      <section class="card">
        <h2>In stock</h2>
        ${st.items.some(i => i.left > 0) ? html`<table class="table compact">
          <thead><tr><th>Goods</th><th>Shipment</th><th class="r">Left</th><th class="r">Landed per unit</th><th class="r">Value</th></tr></thead>
          <tbody>${st.items.filter(i => i.left > 0).map(i => html`<tr><td>${i.description}</td><td>${i.ref}${i.arrived ? '' : html` <span class="muted">on the way</span>`}</td><td class="r nowrap">${i.left} ${i.unit}</td><td class="r nowrap">${m(i.unitLanded)}</td><td class="r nowrap">${m(i.stockValue)}</td></tr>`)}</tbody>
        </table>` : html`<p class="empty">Nothing in stock.</p>`}
      </section>
      <section class="card">
        <h2>Sales</h2>
        ${st.sales.length ? html`<table class="table compact">
          <thead><tr><th>Date</th><th>Goods</th><th class="r">Sold for</th><th class="r">Profit</th><th></th></tr></thead>
          <tbody>${st.sales.slice(0, 40).map(x => html`<tr><td class="nowrap">${fmtFull(x.date)}</td><td>${x.item}${x.customer ? html` <span class="muted">${x.customer}</span>` : ''}</td><td class="r nowrap">${m(x.revenue)}</td><td class="r nowrap ${x.profit < 0 ? 'bad' : ''}">${m(x.profit)}</td><td>${x.paid ? chip('Paid', 'ok') : chip('Owed', 'warn')}</td></tr>`)}</tbody>
        </table>` : html`<p class="empty">No sale yet.</p>`}
      </section>
      <p class="muted">Trading figures hold only the trading records. The projects' costs, invoices and shipments for projects are under Installation. This is a management view, not statutory accounts.</p>
    </div>`;
}

const fileDate = () => new Date().toISOString().slice(0, 10);

export const actions = {
  refresh() { load(); },
  /** Jump to the Costs screen of one project. */
  open(el) { store.switchTo(el.dataset.id); location.hash = '#ledger'; },
  exportInvoices(el, c) { if (data) downloadText(`central-hub-invoices-${fileDate()}.csv`, '﻿' + toCSV(invoiceExport(figures(c)))); },
  exportEntries(el, c) { if (data) downloadText(`central-hub-costs-and-receipts-${fileDate()}.csv`, '﻿' + toCSV(entryExport(figures(c)))); },
};

export const changes = {
  currency(el) { currency = el.value; },
};
