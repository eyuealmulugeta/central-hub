import { BOOK_OPTIONS } from '../engine/currencies.js';
import { store } from '../core/store.js';
import { CATEGORIES } from '../engine/ledger.js';
import { statement, budgetLines } from '../engine/statement.js';
import { docRef } from '../engine/docref.js';
import { uid, money, fmtDate, fmtFull, toCSV, downloadText } from '../core/util.js';
import { paperHtml } from '../sync/mail.js';
import { html, options, meter, chip } from './dom.js';
import { docHead, docSec, docFoot, footText, signoff } from './print.js';
import { openMail } from './maildialog.js';

const LABEL = { labor: 'Labour', material: 'Material', equipment: 'Equipment', subcontract: 'Subcontract', transport: 'Transport', overhead: 'Overhead' };

let only = null;   // 'income' or 'expense' when the menu opened this screen as Income or Expenses
let view = 'entries';   // entries | statement | summary (v0.22.2: the two print-outs)
let from = '', to = '';  // the statement's period; '' = from the first entry / up to today
let notice = '';

/** Opened from the menu as Ledger (everything), Income or Expenses. */
export function preset(p = {}) { only = p.only || null; view = 'entries'; notice = ''; }

const SIDE = { income: 'Money received', expense: 'Expenses' };
const titleOf = () => (view === 'summary' ? 'Project finance summary' : only ? `${SIDE[only]} statement` : 'Ledger statement');
const refOf = c => docRef({ company: c.global.company, project: c.project, type: view === 'summary' ? 'FIN' : 'LED', key: to || c.today });

export function render(c) {
  const seg = html`<div class="seg" role="group" aria-label="View">${[['entries', 'Entries'], ['statement', 'Statement'], ['summary', 'Summary']].map(([k, l]) => html`<button class="${view === k ? 'on' : ''}" data-act="view" data-v="${k}">${l}</button>`)}</div>`;
  if (view === 'entries') return html`<div class="toolbar no-print">${seg}<span class="muted">${notice}</span></div>${entries(c)}`;
  return html`
    <div class="toolbar no-print">
      ${seg}
      ${view === 'statement' ? html`<label class="inline">From <input type="date" data-chg="from" data-fk="led-from" value="${from}" max="${c.today}"></label>
      <label class="inline">To <input type="date" data-chg="to" data-fk="led-to" value="${to || c.today}" max="${c.today}"></label>` : ''}
      <span class="muted">${notice}</span><span class="grow"></span>
      ${view === 'statement' ? html`<button class="btn" data-act="csv">Download CSV</button>` : ''}
      <button class="btn" data-act="email">Email as PDF</button>
      <button class="btn" data-share title="Send this document as a PDF file on WhatsApp or Telegram">WhatsApp / Telegram</button>
      <button class="btn primary" data-act="print">Print</button>
    </div>
    <section class="card sheet">${view === 'summary' ? summaryPaper(c) : statementPaper(c)}</section>`;
}

/** The statement: every entry of the period, oldest first, with the running balance in the project's currency. */
function statementPaper(c) {
  const cur = c.project.currency;
  const st = statement(c.led.rows, { from, to: to || c.today, only });
  const ref = refOf(c);
  const foot = footText(c, titleOf(), ref, { note: 'internal' });
  const period = `${from ? fmtFull(from) : 'Start'} to ${fmtFull(to || c.today)}`;
  const otherCur = st.byCurrency.length > 1 || (st.byCurrency[0] && st.byCurrency[0].currency !== cur);
  return html`<div class="paper dsr doc-paper led-paper" data-foot="${foot}">
    ${docHead(c, { title: titleOf(), sub: period, ref, facts: [['Project', c.project.name], ['Period', period], ['Showing', only ? SIDE[only] : 'All entries'], ['Currency', `${cur}, others converted`]] })}
    <div class="dsr-kpis" style="grid-template-columns:repeat(4,1fr)">
      <div><b>${money(st.opening, cur)}</b><span>Opening balance</span></div>
      <div><b>${money(st.in, cur)}</b><span>Money in</span></div>
      <div><b>${money(st.out, cur)}</b><span>Money out</span></div>
      <div class="${st.closing < 0 ? 'warn' : ''}"><b>${money(st.closing, cur)}</b><span>Closing balance</span></div>
    </div>
    ${docSec(1, 'Entries', st.lines.length ? html`<table class="dsr-t led-t">
      <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Vendor or payer</th><th class="r">Amount</th><th class="r">In</th><th class="r">Out</th><th class="r">Balance</th></tr></thead>
      <tbody>${from ? html`<tr class="led-open"><td colspan="7">Opening balance</td><td class="r nowrap">${money(st.opening, cur)}</td></tr>` : ''}
      ${st.lines.map(r => html`<tr><td class="nowrap">${fmtDate(r.date)}</td><td>${r.type === 'income' ? 'Received' : LABEL[r.category] || r.category}</td><td>${r.description}</td><td>${r.vendor || ''}</td>
        <td class="r nowrap">${r.currency === cur ? '' : money(r.amount, r.currency)}</td><td class="r nowrap">${r.in ? money(r.in, cur) : ''}</td><td class="r nowrap">${r.out ? money(r.out, cur) : ''}</td><td class="r nowrap ${r.balance < 0 ? 'bad' : ''}">${money(r.balance, cur)}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="5">Total, ${st.lines.length} ${st.lines.length === 1 ? 'entry' : 'entries'}</td><td class="r nowrap">${money(st.in, cur)}</td><td class="r nowrap">${money(st.out, cur)}</td><td class="r nowrap">${money(st.closing, cur)}</td></tr></tfoot>
    </table>` : html`<p class="dsr-none">No entries in this period.</p>`)}
    ${otherCur ? docSec(2, 'Totals in each currency', html`<table class="dsr-t">
      <thead><tr><th>Currency</th><th class="r">Entries</th><th class="r">Money in</th><th class="r">Money out</th></tr></thead>
      <tbody>${st.byCurrency.map(t => html`<tr><td>${t.currency}</td><td class="r">${t.count}</td><td class="r">${money(t.in, t.currency)}</td><td class="r">${money(t.out, t.currency)}</td></tr>`)}</tbody></table>`, 'as entered, before conversion') : ''}
    <p class="muted p-notes">Money paid and received as recorded under Costs and Payments. Crew labour worked out from the daily reports is an estimate of cost and is not in this statement; the crew's pay is, once it is paid. Amounts in other currencies are converted with the exchange rates under Settings.</p>
    ${signoff([{ label: 'Prepared by' }, { label: 'Checked by' }])}
    ${docFoot(foot)}
  </div>`;
}

/** One page on the project's money: the figures, spend against the budget per line, and notes. */
function summaryPaper(c) {
  const { led, bill, project: p } = c;
  const cur = p.currency;
  const ref = refOf(c);
  const foot = footText(c, 'Project finance summary', ref, { note: 'internal' });
  const b = budgetLines(led, p, LABEL);
  const pct = v => (v == null ? '—' : `${Math.round(v)} %`);
  const fig = (v, l, warn) => html`<div class="${warn ? 'warn' : ''}"><b>${money(v, cur)}</b><span>${l}</span></div>`;
  const notes = [
    led.budget ? `${pct(led.spent / led.budget * 100)} of the budget is spent with the work ${pct(c.sched.progress)} done.` : 'No budget is set for this project (Settings, This project).',
    led.cpi != null ? `Cost index ${led.cpi.toFixed(2)}: ${led.cpi >= 1 ? 'the work done is worth at least what it cost' : 'the work done cost more than its share of the budget'}.` : '',
    bill.outstanding > 0 ? `${money(bill.outstanding, cur)} is invoiced and not yet received.` : '',
  ].filter(Boolean);
  return html`<div class="paper dsr doc-paper fin-paper" data-foot="${foot}">
    ${docHead(c, { title: 'Project finance summary', sub: fmtFull(c.today), ref, facts: [['Project', p.name], ['Client', p.client?.name || ''], ['As of', fmtFull(c.today)], ['Currency', cur]] })}
    <div class="dsr-kpis" style="grid-template-columns:repeat(3,1fr)">
      ${fig(p.contractValue || 0, 'Contract value')}
      ${fig(bill.invoiced || 0, `Invoiced · ${pct(p.contractValue ? bill.invoiced / p.contractValue * 100 : null)} of contract`)}
      ${fig(led.income, 'Received')}
      ${fig(led.spent, `Spent · ${pct(led.budget ? led.spent / led.budget * 100 : null)} of budget`, led.budget > 0 && led.spent > led.budget)}
      ${fig(led.remaining, 'Budget remaining', led.remaining < 0)}
      ${fig(led.cash, 'Cash position · received less spent', led.cash < 0)}
    </div>
    ${docSec(1, 'Budget against actual', html`<table class="dsr-t fin-t">
      <thead><tr><th>Line</th><th class="r">Budget</th><th class="r">Actual</th><th class="r">Used</th><th class="r">Share of spend</th><th></th></tr></thead>
      <tbody>${b.lines.map(l => html`<tr><td>${l.name}</td><td class="r">${l.budget ? money(l.budget, cur) : '—'}</td><td class="r">${money(l.actual, cur)}</td><td class="r ${l.used > 100 ? 'bad' : ''}">${pct(l.used)}</td><td class="r">${pct(l.share)}</td><td class="fin-bar"><i><b style="width:${Math.min(100, l.used ?? l.share).toFixed(1)}%"></b></i></td></tr>`)}</tbody>
      <tfoot><tr><td>Total</td><td class="r">${b.total.budget ? money(b.total.budget, cur) : '—'}</td><td class="r">${money(b.total.actual, cur)}</td><td class="r">${pct(b.total.used)}</td><td class="r">100 %</td><td></td></tr></tfoot>
    </table>`, 'only labour has its own budget line; the others show their share of the spend')}
    ${docSec(2, 'Notes', html`<ul class="brief-list">${notes.map(n => html`<li>${n}</li>`)}</ul>`)}
    ${signoff([{ label: 'Prepared by' }, { label: 'Checked by' }, { label: 'Approved by' }])}
    ${docFoot(foot)}
  </div>`;
}

function entries(c) {
  const { led, project: p, global } = c;
  const rows = led.rows.filter(r => !only || r.type === only);
  const cur = p.currency;
  const currencies = BOOK_OPTIONS;   // v0.25.0: USD only
  const top = Math.max(1, ...Object.values(led.byCategory));

  const kpi = (label, value, sub, cls = '') => html`
    <div class="kpi"><span class="kpi-label">${label}</span><strong class="${cls}">${value}</strong><span class="muted">${sub}</span></div>`;

  return html`
    <section class="kpis">
      ${kpi('Budget', money(led.budget, cur), `${money(led.remaining, cur)} remaining`, led.remaining < 0 ? 'bad' : '')}
      ${kpi('Spent', money(led.spent, cur), led.budget ? `${Math.round(led.spent / led.budget * 100)}% of budget` : 'No budget set')}
      ${kpi('Received', money(led.income, cur), `Contract ${money(p.contractValue, cur)}`)}
      ${kpi('Cash position', money(led.cash, cur), led.cpi == null ? 'Cost index not available yet' : `Cost index ${led.cpi.toFixed(2)} (1.00 = on budget)`, led.cash < 0 ? 'bad' : '')}
    </section>

    <section class="card">
      <form data-form="entry" class="entry">
        <input type="date" name="date" value="${c.today}" required aria-label="Date">
        <select name="type" aria-label="Type"><option value="expense" ${only === 'income' ? '' : 'selected'}>Expense</option><option value="income" ${only === 'income' ? 'selected' : ''}>Payment received</option></select>
        <select name="category" aria-label="Category">${options(CATEGORIES.map(k => [k, LABEL[k]]), 'material')}</select>
        <input name="description" placeholder="Description" required aria-label="Description" class="wide">
        <input name="vendor" placeholder="Vendor or payer" aria-label="Vendor or payer">
        <input type="number" name="amount" min="0" step="any" placeholder="Amount" required aria-label="Amount" class="amount">
        <select name="currency" aria-label="Currency">${options(currencies, cur)}</select>
        <button class="btn primary">Add</button>
      </form>
      <table class="table">
        <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Vendor</th><th class="r">Amount</th><th class="r">In ${cur}</th><th></th></tr></thead>
        <tbody>${rows.map(r => html`
          <tr>
            <td class="nowrap">${fmtDate(r.date)}</td>
            <td>${r.type === 'income' ? chip('Received', 'ok') : chip(LABEL[r.category] || r.category)}</td>
            <td>${r.description}${r.estimate ? html` ${chip('estimate, not counted: the crew is paid through Payments', 'warn')}` : r.auto ? html` ${chip('auto', 'info')}` : ''}${r.payId ? html` ${chip('Payments', 'info')}` : ''}</td>
            <td class="muted">${r.vendor || ''}</td>
            <td class="r nowrap">${money(r.amount, r.currency)}</td>
            <td class="r nowrap ${r.type === 'income' ? 'ok' : ''}">${r.type === 'income' ? '+' : '−'}${money(r.base, cur)}</td>
            <td class="r">${r.auto || r.payId ? '' : html`<button class="btn ghost small" data-act="remove" data-id="${r.id}">Delete</button>`}</td>
          </tr>`)}</tbody>
      </table>
      ${store.seesPay ? '' : html`<p class="muted">Crew pay is not shown to you. The Admin and office people with Costs or Payments see it here.</p>`}
      ${rows.length ? '' : html`<p class="empty">${led.rows.length ? `No ${only === 'income' ? 'payments received' : 'expenses'} yet.` : 'No entries yet.'}</p>`}
    </section>

    <section class="card">
      <h2>Spend by category</h2>
      <ul class="list">${CATEGORIES.map(k => html`
        <li class="stack">
          <span class="split"><b>${LABEL[k]}</b><span>${money(led.byCategory[k], cur)}</span></span>
          ${meter(led.byCategory[k] / top * 100)}
        </li>`)}</ul>
      <p class="muted">Labour is posted automatically from the manpower logged in daily reports, at the day rates set on the Settings screen.</p>
    </section>`;
}

export const submits = {
  entry(fd) {
    const amount = +fd.get('amount');
    if (!(amount > 0)) return false;
    store.update(ws => ws.ledger.push({
      id: uid('l'), date: fd.get('date'), type: fd.get('type'), category: fd.get('category'),
      description: fd.get('description').trim(), vendor: fd.get('vendor').trim(), amount, currency: fd.get('currency'),
    }));
  },
};

export const changes = {
  from(el) { from = el.value; },
  to(el) { to = el.value; },
};

export const actions = {
  view(el) { view = el.dataset.v; notice = ''; },
  print() { print(); },
  csv(el, c) {
    const st = statement(c.led.rows, { from, to: to || c.today, only });
    const cur = c.project.currency;
    downloadText(`${titleOf()}, ${c.project.name}.csv`, '﻿' + toCSV([
      ['Date', 'Type', 'Category', 'Description', 'Vendor or payer', 'Amount', 'Currency', `In (${cur})`, `Out (${cur})`, `Balance (${cur})`],
      ...st.lines.map(r => [r.date, r.type, r.category || '', r.description, r.vendor || '', r.amount, r.currency, r.in || '', r.out || '', Math.round(r.balance * 100) / 100]),
    ]));
  },
  email(el, c) {
    const name = `${titleOf()}, ${c.project.name}`.replace(/[\\/:*?"<>|]/g, '-');
    openMail({
      to: '',
      subject: `${name}, ${fmtFull(c.today)}`,
      message: `Dear Sir or Madam,\n\nPlease find attached the ${titleOf().toLowerCase()} of ${c.project.name} as of ${fmtFull(c.today)}.\n\nKind regards,\n${store.signature}\n${c.global.company?.name || 'Amistad Prefab'}`,
      filename: name,
      getHtml: () => paperHtml(document.querySelector('.paper'), name),
      sheet: () => document.querySelector('.paper'),
      onSent({ to: who }) { notice = `Sent to ${who}.`; store.notify(); },
    });
  },
  remove(el, c) {
    const r = c.ws.ledger.find(x => x.id === el.dataset.id);
    if (!r || !confirm(`Delete "${r.description}" (${money(r.amount, r.currency)}) from the costs?`)) return;
    store.update(ws => { ws.ledger = ws.ledger.filter(x => x.id !== r.id); });
  },
};
