// Payments: the pay of the site crew of the open project, one pay period at a time (weekly, every two weeks or
// monthly, as set under Settings, This project, Calendar and rates). One compiled sheet per period: crew, trade,
// paid daily or monthly, wage, days, overtime, earned, paid and outstanding. Each payment is also a labour cost
// under Costs. Approving a period locks what was earned; what is still owed carries over to the next period.

import { store } from '../core/store.js';
import { periodFor, shiftPeriod } from '../engine/attendance.js';
import { payLines, newRun, lockLines, runStatus, STATUS_LABEL, METHODS, methodLabel, paymentFor, csvRows, runId } from '../engine/crewpay.js';
import { onSite } from '../sync/fieldreport.js';
import { uid, money, fmtFull, toCSV, downloadText } from '../core/util.js';
import { paperHtml } from '../sync/mail.js';
import { html, options, chip } from './dom.js';
import { letterhead } from './docs.js';
import { openMail } from './maildialog.js';
import { tell } from '../core/image.js';

let at = '';          // a day inside the period on screen; '' = today
let paying = null;    // the key of the line whose payment form is open
let payAll = false;   // the "Pay all outstanding" form is open
let notice = '';

const periodOf = c => periodFor(c.project, at || c.today);
const crewOf = c => c.ws.team.filter(m => m.active !== false && onSite(m, c.company.staff || []));
const ctxOf = c => ({ project: c.project, ws: c.ws, staff: c.company.staff || [], crew: crewOf(c) });
/** The Admin and the Office people with Payments ticked record payments; approving also needs the approver tick. */
const mayPay = () => !store.readOnly && (store.isAdmin || (store.role === 'office' && store.can('payments')));
const mayApprove = () => mayPay() && store.canApprove;
const FROM = { project: 'day rate on this project', agreement: 'HR agreement', trade: 'trade rate (no rate of their own)', '': 'no wage found' };
const STATUS_TONE = { draft: '', approved: 'info', paid: 'ok' };

/** Money per currency, as "ETB 12,000 + USD 300". */
function byCurrency(lines, f) {
  const sums = new Map();
  for (const l of lines) sums.set(l.currency, (sums.get(l.currency) || 0) + l[f]);
  return [...sums].filter(([, v]) => Math.abs(v) > 0.004).map(([cur, v]) => money(v, cur, 2)).join(' + ') || '0';
}

/** Make the run record of a period when anything is first done with it. */
function ensureRun(ws, period) {
  ws.payruns = ws.payruns || [];
  let run = ws.payruns.find(r => r.from === period.from);
  if (!run) { run = newRun(period, new Date().toISOString()); ws.payruns.push(run); }
  return run;
}

function payForm(l, c) {
  return html`<tr class="no-print pay-form-row"><td colspan="14">
    <form data-form="pay" data-k="${l.key}" class="entry pay-form">
      <b>Pay ${l.name}</b>
      <label>Amount <input type="number" name="amount" min="0.01" step="0.01" required value="${l.outstanding > 0 ? l.outstanding : ''}"> ${l.currency}</label>
      <label>Date <input type="date" name="date" required value="${c.today}" max="${c.today}"></label>
      <label>How <select name="method">${options(METHODS, 'cash')}</select></label>
      <input name="ref" placeholder="Reference (bank, receipt no.)" aria-label="Reference">
      <button class="btn primary">Save payment</button>
      <button type="button" class="btn ghost" data-act="closePay">Cancel</button>
    </form>
  </td></tr>`;
}

export function render(c) {
  const p = periodOf(c);
  const { run, lines } = payLines(ctxOf(c), p);
  const status = runStatus(run, lines);
  const draft = status === 'draft';
  const can = mayPay();
  const owing = lines.filter(l => l.outstanding > 0.004);
  const missing = lines.filter(l => !(l.wage > 0) && (l.present || l.ot));
  const payments = (c.ws.payments || []).filter(x => x.periodFrom === p.from).sort((a, b) => (a.date < b.date ? -1 : 1));
  return html`
    <div class="toolbar no-print">
      <h2>Payments</h2><span class="muted">${c.project.name}. ${notice}</span><span class="grow"></span>
      <button class="btn small" data-act="shift" data-n="-1" aria-label="Previous period">‹</button>
      <b class="att-period">${p.label}</b>
      <button class="btn small" data-act="shift" data-n="1" aria-label="Next period" ${p.to >= c.today ? 'disabled' : ''}>›</button>
      ${at ? html`<button class="btn small ghost" data-act="today">This period</button>` : ''}
      ${chip(STATUS_LABEL[status], STATUS_TONE[status])}
      ${can && draft && mayApprove() ? html`<button class="btn" data-act="approve" title="Locks what each person earned in this period">Approve</button>` : ''}
      ${store.isAdmin && !draft ? html`<button class="btn ghost" data-act="reopen" title="Back to draft: what was earned is worked out from the sheet again">Reopen</button>` : ''}
      ${can && owing.length ? html`<button class="btn primary" data-act="openPayAll">Pay all outstanding</button>` : ''}
      <button class="btn" data-act="csv">CSV</button>
      <button class="btn" data-act="email">Email as PDF</button>
      <button class="btn" data-share title="Send this sheet as a PDF file on WhatsApp or Telegram">WhatsApp / Telegram</button>
      <button class="btn" data-act="print">Print</button>
    </div>
    ${missing.length ? html`<p class="bad no-print">No wage for ${missing.map(l => l.name).join(', ')}: set the day rate on their place on this project (Crew, Employee data, Projects) or their HR agreement.</p>` : ''}
    ${payAll ? html`<form data-form="payAll" class="card entry pay-form no-print">
      <b>Pay everyone what is outstanding (${owing.length} people, ${byCurrency(owing, 'outstanding')})</b>
      <label>Date <input type="date" name="date" required value="${c.today}" max="${c.today}"></label>
      <label>How <select name="method">${options(METHODS, 'cash')}</select></label>
      <input name="ref" placeholder="Reference" aria-label="Reference">
      <button class="btn primary">Save ${owing.length} payments</button>
      <button type="button" class="btn ghost" data-act="closePay">Cancel</button>
    </form>` : ''}
    <section class="card sheet pay-sheet"><div class="paper">
      ${letterhead(c, 'Crew payments', [['Project', c.project.name], ['Period', p.label], ['Status', STATUS_LABEL[status]]])}
      ${lines.length ? html`<div class="att-scroll"><table class="pay-grid">
        <thead><tr>
          <th>Name</th><th>Trade / position</th><th>Paid</th><th class="r">Wage</th><th class="r">Days</th><th class="r">OT h</th>
          <th class="r">Earned</th><th class="r">Adjust</th><th class="r">Brought forward</th><th class="r">Due</th><th class="r">Paid</th><th class="r">Total paid to date</th><th class="r">Outstanding</th><th class="no-print"></th>
        </tr></thead>
        <tbody>${lines.map(l => html`<tr>
          <td><b>${l.name}</b></td><td>${l.role || ''}</td>
          <td>${l.per === 'month' ? 'Monthly' : 'Daily'}</td>
          <td class="r nowrap" title="From the ${FROM[l.from] || l.from}">${money(l.wage, l.currency, 2)}<span class="muted">/${l.per === 'month' ? 'month' : 'day'}</span>${l.from === 'trade' ? html` <span class="muted no-print">*</span>` : ''}</td>
          <td class="r">${l.present || ''}</td><td class="r">${l.ot || ''}</td>
          <td class="r nowrap">${money(l.earned, l.currency, 2)}</td>
          <td class="r nowrap">${can && draft ? html`<input class="pay-adj no-print" type="number" step="0.01" data-chg="adjust" data-k="${l.key}" data-fk="adj-${l.key}" value="${l.adjust || ''}" placeholder="0" title="Advance or deduction (minus), or a bonus" aria-label="Adjustment for ${l.name}"><span class="print-only">${l.adjust ? money(l.adjust, l.currency, 2) : ''}</span>` : l.adjust ? money(l.adjust, l.currency, 2) : ''}</td>
          <td class="r nowrap">${l.brought ? money(l.brought, l.currency, 2) : ''}</td>
          <td class="r nowrap"><b>${money(l.due, l.currency, 2)}</b></td>
          <td class="r nowrap">${l.paid ? money(l.paid, l.currency, 2) : ''}</td>
          <td class="r nowrap">${money(l.paidToDate, l.currency, 2)}</td>
          <td class="r nowrap ${l.outstanding > 0.004 ? 'bad' : 'ok'}"><b>${money(l.outstanding, l.currency, 2)}</b></td>
          <td class="no-print">${can && l.outstanding > 0.004 ? html`<button class="btn small" data-act="openPay" data-k="${l.key}">Pay</button>` : ''}</td>
        </tr>${paying === l.key ? payForm(l, c) : ''}`)}</tbody>
        <tfoot><tr><td colspan="6"><b>Total</b></td><td class="r nowrap">${byCurrency(lines, 'earned')}</td><td class="r nowrap">${byCurrency(lines, 'adjust')}</td><td class="r nowrap">${byCurrency(lines, 'brought')}</td>
          <td class="r nowrap"><b>${byCurrency(lines, 'due')}</b></td><td class="r nowrap">${byCurrency(lines, 'paid')}</td><td class="r nowrap">${byCurrency(lines, 'paidToDate')}</td><td class="r nowrap"><b>${byCurrency(lines, 'outstanding')}</b></td><td class="no-print"></td></tr></tfoot>
      </table></div>
      <p class="muted p-notes">Earned: days present x day rate plus overtime at ${c.project.billing?.otMultiplier || 1.5} times, from the Attendance sheet; monthly-paid people earn the period's share of the month's wage. Brought forward is what earlier periods still owe. Adjust is an advance or deduction (minus) or a bonus.${lines.some(l => l.from === 'trade') ? ' * Wage from the trade rates: this person has no rate of their own.' : ''}</p>`
      : html`<p class="empty">Nobody on this project's site team, and nothing owed or paid for ${p.label}.</p>`}
    </div></section>
    ${payments.length ? html`<section class="card no-print">
      <h3>Payments for this period <span class="muted">each is also a labour cost under Costs</span></h3>
      <table class="table compact"><thead><tr><th>Date</th><th>Person</th><th class="r">Amount</th><th>How</th><th>Reference</th><th>By</th><th></th></tr></thead>
        <tbody>${payments.map(x => html`<tr>
          <td class="nowrap">${fmtFull(x.date)}</td><td>${x.name}</td><td class="r nowrap">${money(x.amount, x.currency, 2)}</td>
          <td>${methodLabel(x.method)}</td><td>${x.ref || ''}</td><td class="muted">${x.by || ''}</td>
          <td>${store.isAdmin && !store.readOnly ? html`<button class="btn ghost small" data-act="removePayment" data-id="${x.id}">Delete</button>` : ''}</td></tr>`)}</tbody></table>
    </section>` : ''}`;
}

/** Save one payment and its labour cost. */
function record(c, l, { amount, date, method, ref }) {
  const p = periodOf(c);
  const { pay, cost } = paymentFor(l, { amount, date, method, ref, period: p, by: store.user?.email || 'this computer', at: new Date().toISOString(), id: uid('pay') });
  store.update(ws => {
    ensureRun(ws, p);
    (ws.payments ||= []).push(pay);
    ws.ledger.push(cost);
  });
}

export const changes = {
  adjust(el, c) {
    const p = periodOf(c);
    const v = Math.round((+el.value || 0) * 100) / 100;
    store.update(ws => { const run = ensureRun(ws, p); run.lines = { ...(run.lines || {}), [el.dataset.k]: { ...(run.lines?.[el.dataset.k] || {}), adjust: v } }; });
  },
};

export const actions = {
  print() { print(); },
  shift(el, c) { at = shiftPeriod(c.project, periodOf(c), +el.dataset.n).from; paying = null; payAll = false; notice = ''; },
  today() { at = ''; paying = null; payAll = false; },
  openPay(el) { paying = el.dataset.k; payAll = false; },
  openPayAll() { payAll = true; paying = null; },
  closePay() { paying = null; payAll = false; },
  approve(el, c) {
    const p = periodOf(c);
    const { lines } = payLines(ctxOf(c), p);
    if (!confirm(`Approve ${p.label}? What each person earned is locked; payments can still be recorded.`)) return;
    store.update(ws => { const run = ensureRun(ws, p); run.lines = lockLines(run, lines); run.status = 'approved'; run.approvedBy = store.user?.email || ''; run.approvedAt = new Date().toISOString(); });
    notice = `${p.label} approved.`;
  },
  reopen(el, c) {
    const p = periodOf(c);
    if (!confirm('Back to draft? What was earned will be worked out from the Attendance sheet again.')) return;
    store.update(ws => { const run = (ws.payruns || []).find(r => r.id === runId(p.from)); if (run) run.status = 'draft'; });
  },
  /** Admin only (it deletes): the payment goes, and its labour cost under Costs with it. */
  removePayment(el) {
    if (!confirm('Delete this payment? Its labour cost under Costs is deleted too.')) return;
    store.update(ws => { ws.payments = (ws.payments || []).filter(x => x.id !== el.dataset.id); ws.ledger = ws.ledger.filter(x => x.payId !== el.dataset.id); });
  },
  csv(el, c) {
    const p = periodOf(c);
    downloadText(`Crew payments ${c.project.name} ${p.from} to ${p.to}.csv`.replace(/[\\/:*?"<>|]/g, '-'), toCSV(csvRows(payLines(ctxOf(c), p).lines, p)), 'text/csv');
  },
  email(el, c) {
    const p = periodOf(c);
    const name = `Crew payments ${p.label}, ${c.project.name}`.replace(/[\\/:*?"<>|]/g, '-');
    openMail({
      to: '',
      subject: name,
      message: `Dear Sir or Madam,\n\nPlease find attached the crew payments of ${c.project.name} for ${p.label}.\n\nKind regards,\n${store.signature}\n${c.global.company?.name || 'Amistad Prefab'}`,
      filename: name,
      getHtml: () => paperHtml(document.querySelector('.paper'), name),
      sheet: () => document.querySelector('.paper'),
      onSent({ to }) { notice = `Sent to ${to}.`; store.notify(); },
    });
  },
};

export const submits = {
  pay(fd, c, form) {
    const key = form?.dataset?.k || paying;
    const l = payLines(ctxOf(c), periodOf(c)).lines.find(x => x.key === key);
    const amount = +fd.get('amount');
    if (!l || !(amount > 0)) return false;
    record(c, l, { amount, date: fd.get('date'), method: fd.get('method'), ref: String(fd.get('ref') || '').trim() });
    tell(`✓ ${money(amount, l.currency, 2)} paid to ${l.name}.`);
    paying = null;
  },
  payAll(fd, c) {
    const owing = payLines(ctxOf(c), periodOf(c)).lines.filter(l => l.outstanding > 0.004);
    for (const l of owing) record(c, l, { amount: l.outstanding, date: fd.get('date'), method: fd.get('method'), ref: String(fd.get('ref') || '').trim() });
    tell(`✓ ${owing.length} payments saved.`);
    payAll = false;
  },
};
