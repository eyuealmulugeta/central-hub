// Cash flow of the open project: money really paid in and out, month by month, and the next months
// forecast from invoices still to be paid, the payroll of the people on this project, and the usual
// spending. One table and chart per currency; currencies are never added together.

import { store } from '../core/store.js';
import { cashflow, payrollByCurrency, csvRows, monthOf } from '../engine/cashflow.js';
import { monthlyPay } from '../engine/hr.js';
import { costsOf } from '../engine/ledger.js';
import { money, fmtFull, toCSV, downloadText } from '../core/util.js';
import { paperHtml } from '../sync/mail.js';
import { html, options } from './dom.js';
import { docRef } from '../engine/docref.js';
import { docHead, docSec, docFoot, footText, signoff } from './print.js';
import { openMail } from './maildialog.js';

let horizon = 3;
let usual = true;
let notice = '';

const label = key => new Date(`${key}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const m = (v, cur) => money(v, cur, 0);

function flowsOf(c) {
  // payroll comes from HR records, which only the Admin has
  const payroll = store.isAdmin ? payrollByCurrency(c.company.staff, c.project.id, monthlyPay, c.global.fx) : {};
  return cashflow({ ledger: costsOf(c.ws), docs: c.ws.docs, payroll, today: c.today, horizon, usual, fallback: c.project.currency });
}

/** Bars of money in (green) and out (red) for each month, and the balance as a line. Forecast months are paler. */
function chart(f) {
  const W = 680, H = 190, top = 10, bottom = 26, left = 6, right = 6;
  const n = f.months.length;
  const maxV = Math.max(1, ...f.months.flatMap(x => [x.in, x.out, x.balance]));
  const minV = Math.min(0, ...f.months.map(x => x.balance));
  const y = v => top + ((maxV - v) / (maxV - minV)) * (H - top - bottom);
  const slot = (W - left - right) / n, bar = Math.min(26, slot * 0.34);
  const cx = i => left + slot * i + slot / 2;
  const points = f.months.map((x, i) => `${cx(i).toFixed(1)},${y(x.balance).toFixed(1)}`).join(' ');
  const summary = `Cash flow in ${f.currency}: balance now ${m(f.balanceNow, f.currency)}.`;
  return html`<svg class="cf-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${summary}"><title>${summary}</title>
    <line x1="${left}" x2="${W - right}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="cf-axis"></line>
    ${f.months.map((x, i) => html`
      <rect class="cf-in ${x.forecast ? 'cf-fc' : ''}" x="${(cx(i) - bar - 1).toFixed(1)}" y="${y(x.in).toFixed(1)}" width="${bar.toFixed(1)}" height="${Math.max(0, y(0) - y(x.in)).toFixed(1)}"><title>${label(x.month)}: in ${m(x.in, f.currency)}</title></rect>
      <rect class="cf-out ${x.forecast ? 'cf-fc' : ''}" x="${(cx(i) + 1).toFixed(1)}" y="${y(x.out).toFixed(1)}" width="${bar.toFixed(1)}" height="${Math.max(0, y(0) - y(x.out)).toFixed(1)}"><title>${label(x.month)}: out ${m(x.out, f.currency)}</title></rect>
      <text class="cf-label" x="${cx(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${label(x.month)}</text>`)}
    <polyline class="cf-line" points="${points}" fill="none"></polyline>
    ${f.months.map((x, i) => html`<circle class="cf-dot ${x.forecast ? 'cf-fc' : ''}" cx="${cx(i).toFixed(1)}" cy="${y(x.balance).toFixed(1)}" r="3"><title>${label(x.month)}: balance ${m(x.balance, f.currency)}</title></circle>`)}
  </svg>`;
}

export function render(c) {
  const flows = flowsOf(c);
  const ref = docRef({ company: c.global.company, project: c.project, type: 'CF', key: c.today });
  const foot = footText(c, 'Cash flow', ref, { note: 'internal' });
  const staffHere = store.isAdmin ? c.company.staff.filter(p => p.projectId === c.project.id && p.status !== 'left').length : 0;
  return html`
    <div class="toolbar no-print">
      <h2>Cash flow</h2><span class="muted">${c.project.name}. ${notice}</span><span class="grow"></span>
      <label class="check"><input type="checkbox" data-chg="usual" ${usual ? 'checked' : ''}> Include the usual spending</label>
      <select data-chg="horizon" aria-label="Months ahead">${options([[3, 'Next 3 months'], [6, 'Next 6 months'], [12, 'Next 12 months']], horizon)}</select>
      <button class="btn" data-act="csv">Download CSV</button>
      <button class="btn" data-act="email">Email as PDF</button>
      <button class="btn" data-share title="Send this document as a PDF file on WhatsApp or Telegram">WhatsApp / Telegram</button>
      <button class="btn primary" data-act="print">Print</button>
    </div>
    <section class="card sheet"><div class="paper dsr doc-paper cf-paper" data-foot="${foot}">
      ${docHead(c, { title: 'Cash flow', sub: fmtFull(c.today), ref, facts: [['Project', c.project.name], ['As of', fmtFull(c.today)], ['Months ahead', String(horizon)], ['Usual spending', usual ? 'Included' : 'Left out']] })}
      ${flows.length ? flows.map((f, i) => html`
        <div class="dsr-kpis" style="grid-template-columns:repeat(4,1fr)">
          <div class="${f.balanceNow < 0 ? 'warn' : ''}"><b>${m(f.balanceNow, f.currency)}</b><span>Cash in hand now</span></div>
          <div><b>${m(f.expectedIn, f.currency)}</b><span>Expected in, next ${horizon} months</span></div>
          <div><b>${m(f.expectedOut, f.currency)}</b><span>Expected out, next ${horizon} months</span></div>
          <div class="${f.firstShortMonth ? 'warn' : ''}"><b>${f.firstShortMonth ? label(f.firstShortMonth) : 'None'}</b><span>First month short of cash</span></div>
        </div>
        ${docSec(i * 2 + 1, `Money in and out, ${f.currency}`, html`<div class="no-pdf">${chart(f)}<p class="muted cf-key"><span class="cf-k cf-in"></span> money in <span class="cf-k cf-out"></span> money out <span class="cf-k cf-ln"></span> balance. Paler = forecast.</p></div>`)}
        ${docSec(i * 2 + 2, `By month, ${f.currency}`, html`<table class="dsr-t cf-t">
          <thead><tr><th>Month</th><th></th><th class="r">Money in</th><th class="r">Money out</th><th class="r">Net</th><th class="r">Balance</th></tr></thead>
          <tbody>${f.months.map(x => html`<tr class="${x.month === monthOf(c.today) ? 'group' : ''}">
            <td class="nowrap">${label(x.month)}</td><td class="muted">${x.forecast ? 'forecast' : x.month === monthOf(c.today) ? 'so far' : ''}</td>
            <td class="r">${m(x.in, f.currency)}${x.forecast && x.parts.invoiceCount ? html`<br><span class="muted">${x.parts.invoiceCount} invoice${x.parts.invoiceCount === 1 ? '' : 's'}</span>` : ''}</td>
            <td class="r">${m(x.out, f.currency)}${x.forecast && (x.parts.payroll || x.parts.usual) ? html`<br><span class="muted">${x.parts.payroll ? `payroll ${m(x.parts.payroll, f.currency)}` : ''}${x.parts.payroll && x.parts.usual ? ', ' : ''}${x.parts.usual ? `usual ${m(x.parts.usual, f.currency)}` : ''}</span>` : ''}</td>
            <td class="r ${x.net < 0 ? 'bad' : ''}">${m(x.net, f.currency)}</td><td class="r ${x.balance < 0 ? 'bad' : ''}"><b>${m(x.balance, f.currency)}</b></td></tr>`)}</tbody>
        </table>`)}
        ${f.draft ? html`<p class="muted">Draft invoices of ${m(f.draft, f.currency)} are not counted until they are sent.</p>` : ''}`)
      : html`<p class="empty">Nothing recorded yet. Payments and receipts entered under Costs appear here.</p>`}
      <p class="muted p-notes">Only payments recorded under Costs are counted as paid. The labour worked out from daily reports is an estimate of cost, not cash. Forecast: invoices sent and not yet paid are expected by their due date (overdue ones in the first month ahead); ${store.isAdmin ? (staffHere ? `payroll is the monthly pay of the ${staffHere} ${staffHere === 1 ? 'person' : 'people'} HR lists on this project` : 'no payroll is counted, because HR lists nobody on this project') : 'payroll is not shown to you'}; ${usual ? 'the usual spending is the average of the last three full months' : 'the usual spending is left out'}. Retention held back is not counted.</p>
      ${signoff([{ label: 'Prepared by' }, { label: 'Checked by' }])}
      ${docFoot(foot)}
    </div></section>`;
}

export const changes = {
  horizon(el) { horizon = +el.value || 3; },
  usual(el) { usual = el.checked; },
};

export const actions = {
  print() { print(); },
  csv(el, c) { downloadText(`Cash flow, ${c.project.name}.csv`, toCSV(csvRows(flowsOf(c))), 'text/csv'); },
  email(el, c) {
    const name = `Cash flow, ${c.project.name}`.replace(/[\\/:*?"<>|]/g, '-');
    openMail({
      to: '',
      subject: `${name}, ${fmtFull(c.today)}`,
      message: `Dear Sir or Madam,\n\nPlease find attached the cash flow of ${c.project.name} as of ${fmtFull(c.today)}.\n\nKind regards,\n${store.signature}\n${c.global.company?.name || 'Amistad Prefab'}`,
      filename: name,
      getHtml: () => paperHtml(document.querySelector('.paper'), name),
      sheet: () => document.querySelector('.paper'),
      onSent({ to }) { notice = `Sent to ${to}.`; store.notify(); },
    });
  },
};
