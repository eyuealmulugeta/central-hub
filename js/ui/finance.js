// Finance: the whole company on one screen, across every project. Other
// projects' data is read when the screen opens (and on Refresh), not kept live.

import { BOOK_OPTIONS } from '../engine/currencies.js';
import { store } from '../core/store.js';
import { companyFinance, invoiceExport, entryExport } from '../engine/finance.js';
import { dashPage, dashPaper, dashOf, seesProfit } from './tradedash.js';
import { dashSheets } from '../engine/tradedash.js';
import { xlsxBytes } from '../core/xlsxwrite.js';
import { money, fmtDate, fmtFull, toCSV, downloadText } from '../core/util.js';
import { paperHtml } from '../sync/mail.js';
import { companyCode } from '../engine/docref.js';
import { html, options, meter, chip } from './dom.js';
import { docHead, docSec, docFoot, footText, signoff } from './print.js';
import { openMail } from './maildialog.js';

let data = null;      // { workspaces, at }
let loading = false;
let failed = '';
let currency = '';    // '' = the base currency of the exchange-rate table
let part = 'construction';   // construction (Installation) | trading: the two are never on one page
let sheet = false;    // the one-page summary to print (v0.22.2) instead of the screen
let notice = '';
export const preset = o => { part = o.part === 'trading' ? 'trading' : 'construction'; sheet = false; notice = ''; };

const SHEET_TITLE = { construction: 'Company finance summary', trading: 'Trading dashboard' };
const sheetRef = c => `${companyCode(c.global.company)}-${part === 'trading' ? 'TRD' : 'FIN'}-${c.today}`;
/** The toolbar of the printable summary: back to the screen, then print and share. */
const sheetBar = () => html`<div class="toolbar no-print">
  <button class="btn small" data-act="sheet" data-on="">‹ Back</button><h2>${SHEET_TITLE[part]}</h2><span class="muted">${notice}</span><span class="grow"></span>
  <button class="btn" data-act="email">Email as PDF</button>
  <button class="btn" data-share title="Send this document as a PDF file on WhatsApp or Telegram">WhatsApp / Telegram</button>
  <button class="btn primary" data-act="print">Print</button>
</div>`;
const sheetBtn = html`<button class="btn" data-act="sheet" data-on="1" title="The figures on one page, to print or send">Summary to print</button>`;

/** The whole company on one page: the figures, every project, and what is owed. Amounts in one currency. */
function companyPaper(c, f) {
  const t = f.totals;
  const m = v => money(v, f.currency);
  const pct = v => (v == null ? '—' : `${Math.round(v)} %`);
  const ref = sheetRef(c);
  const foot = footText(c, SHEET_TITLE.construction, ref, { project: false, note: 'internal' });
  return html`<section class="card sheet"><div class="paper dsr doc-paper fin-paper" data-foot="${foot}">
    ${docHead(c, { title: SHEET_TITLE.construction, sub: fmtFull(c.today), ref, facts: [['Projects', String(f.rows.length)], ['As of', fmtFull(c.today)], ['Currency', `${f.currency}, converted`]] })}
    <div class="dsr-kpis" style="grid-template-columns:repeat(6,1fr)">
      <div><b>${m(t.received)}</b><span>Received · of ${m(t.invoiced)} invoiced</span></div>
      <div><b>${m(t.spent)}</b><span>Spent, all projects</span></div>
      <div class="${t.cash < 0 ? 'warn' : ''}"><b>${m(t.cash)}</b><span>Cash position</span></div>
      <div><b>${m(t.owed)}</b><span>Owed to you · ${f.receivables.length} invoices</span></div>
      <div><b>${m(t.committed)}</b><span>Ordered, not delivered</span></div>
      <div><b>${m(t.payable)}</b><span>Owed to suppliers · ${f.payables.length} bills</span></div>
    </div>
    ${docSec(1, 'By project', html`<table class="dsr-t">
      <thead><tr><th>Project</th><th class="r">Contract</th><th class="r">Invoiced</th><th class="r">Received</th><th class="r">Spent</th><th class="r">Cash</th><th class="r">Margin</th><th class="r">Progress</th></tr></thead>
      <tbody>${f.rows.map(r => html`<tr><td>${r.name}</td><td class="r nowrap">${m(r.contract)}</td><td class="r nowrap">${m(r.invoiced)}</td><td class="r nowrap">${m(r.received)}</td><td class="r nowrap">${m(r.spent)}</td><td class="r nowrap ${r.cash < 0 ? 'bad' : ''}">${m(r.cash)}</td><td class="r">${pct(r.margin)}</td><td class="r">${pct(r.progress)}</td></tr>`)}</tbody>
      <tfoot><tr><td>Total</td><td class="r nowrap">${m(t.contract)}</td><td class="r nowrap">${m(t.invoiced)}</td><td class="r nowrap">${m(t.received)}</td><td class="r nowrap">${m(t.spent)}</td><td class="r nowrap">${m(t.cash)}</td><td class="r">${pct(t.margin)}</td><td></td></tr></tfoot>
    </table>`)}
    ${docSec(2, 'Owed to you', html`<div class="dsr-kpis" style="grid-template-columns:repeat(${f.aging.length},1fr)">${f.aging.map((a, i) => html`<div class="${i > 1 && a.amount > 0 ? 'warn' : ''}"><b>${m(a.amount)}</b><span>${a.label}</span></div>`)}</div>
      ${f.receivables.length ? html`<table class="dsr-t"><thead><tr><th>Invoice</th><th>Project</th><th>Client</th><th>Due</th><th class="r">Amount due</th></tr></thead>
        <tbody>${f.receivables.slice(0, 12).map(r => html`<tr><td>${r.number}</td><td>${r.project}</td><td>${r.client || '—'}</td><td class="nowrap">${fmtFull(r.due)}${r.overdue > 0 ? `, ${r.overdue} days overdue` : ''}</td><td class="r nowrap">${m(r.amount)}</td></tr>`)}</tbody></table>` : html`<p class="dsr-none">No invoice is waiting for payment.</p>`}`)}
    <p class="muted p-notes">A management view built from the projects, not statutory accounts. Invoiced is before VAT; owed to you is the amount due on the invoice. Amounts are converted with the exchange rates under Settings.</p>
    ${signoff([{ label: 'Prepared by' }, { label: 'Checked by' }, { label: 'Approved by' }])}
    ${docFoot(foot)}
  </div></section>`;
}

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
  const currencies = BOOK_OPTIONS;   // v0.25.0: USD only
  const toolbar = html`
    <div class="toolbar">
      <h2>All projects</h2>
      <span class="muted">${data ? `Figures read at ${data.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
      <span class="grow"></span>
      <label class="inline">Show in <select data-chg="currency" data-fk="fin-cur">${options(currencies, cur)}</select></label>
      <button class="btn" data-act="refresh" ${loading ? 'disabled' : ''}>${loading ? 'Reading…' : 'Refresh'}</button>
      <button class="btn" data-act="exportInvoices" ${data ? '' : 'disabled'} title="Every invoice of every project, as a spreadsheet file">Export invoices</button>
      <button class="btn" data-act="exportEntries" ${data ? '' : 'disabled'} title="Every cost and receipt of every project, as a spreadsheet file">Export costs and receipts</button>
      ${data ? sheetBtn : ''}
    </div>`;
  if (!data) return html`<div class="side">${toolbar}<p class="empty">${failed || 'Reading every project…'}</p></div>`;

  const f = figures(c);
  if (sheet) return html`${sheetBar()}${companyPaper(c, f)}`;
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
        ${kpi('Owed to suppliers', m(t.payable), `${f.payables.length} bill${f.payables.length === 1 ? '' : 's'} not paid${f.payables.some(x => x.overdue > 0) ? `, ${f.payables.filter(x => x.overdue > 0).length} overdue` : ''}`, f.payables.some(x => x.overdue > 0) ? 'bad' : '')}
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

/** v1.23.0 (G10 T5): the trading dashboard (ui/tradedash.js) replaces the old trading summary. */
function tradingPage(c) {
  const cur = currency || c.global.fx.base;
  const toolbar = html`
    <div class="toolbar">
      <h2>Trading dashboard</h2><span class="muted">How trading is doing</span><span class="grow"></span>
      <label class="inline">Show in <select data-chg="currency" data-fk="fin-cur">${options(BOOK_OPTIONS, cur)}</select></label>
      <button class="btn" data-act="dashExcel">Excel</button>
      ${sheetBtn}
    </div>`;
  if (sheet) return html`${sheetBar()}${dashPaper(c, cur, SHEET_TITLE.trading, sheetRef(c))}`;
  return dashPage(c, cur, toolbar);
}

const fileDate = () => new Date().toISOString().slice(0, 10);

export const actions = {
  refresh() { load(); },
  sheet(el) { sheet = !!el.dataset.on; notice = ''; },
  print() { print(); },
  email(el, c) {
    const name = `${SHEET_TITLE[part]}, ${fmtFull(c.today)}`;
    openMail({
      to: '',
      subject: `${name}, ${c.global.company?.name || 'Amistad Prefab'}`,
      message: `Dear Sir or Madam,\n\nPlease find attached the ${SHEET_TITLE[part].toLowerCase()} as of ${fmtFull(c.today)}.\n\nKind regards,\n${store.signature}\n${c.global.company?.name || 'Amistad Prefab'}`,
      filename: name,
      getHtml: () => paperHtml(document.querySelector('.paper'), name),
      sheet: () => document.querySelector('.paper'),
      onSent({ to }) { notice = `Sent to ${to}.`; store.notify(); },
    });
  },
  /** Jump to the Costs screen of one project. */
  open(el) { store.switchTo(el.dataset.id); location.hash = '#ledger'; },
  dashExcel(el, c) { const cur = currency || c.global.fx.base; downloadText(`Trading dashboard ${c.today}.xlsx`, xlsxBytes(dashSheets(dashOf(c, cur), seesProfit())), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); },   // v1.23.0
  exportInvoices(el, c) { if (data) downloadText(`central-hub-invoices-${fileDate()}.csv`, '﻿' + toCSV(invoiceExport(figures(c)))); },
  exportEntries(el, c) { if (data) downloadText(`central-hub-costs-and-receipts-${fileDate()}.csv`, '﻿' + toCSV(entryExport(figures(c)))); },
};

export const changes = {
  currency(el) { currency = el.value; },
};
