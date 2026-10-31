// Payments: the pay of the site crew of the open project, one pay period at a time (weekly, every two weeks or
// monthly, as set under Settings, This project, Calendar and rates). One compiled sheet per period: crew, trade,
// paid daily or monthly, wage, days, overtime, earned, paid and outstanding. Each payment is also a labour cost
// under Costs. Approving a period locks what was earned; what is still owed carries over to the next period.

import { usdOf, PAY_OPTIONS } from '../engine/currencies.js';
import { PAY_PERIODS, payPeriodOf, weekStartOf } from '../engine/attendance.js';
import { dayRateOf, setDayRate } from '../engine/people.js';
import { store } from '../core/store.js';
import { periodFor, shiftPeriod, waitingNote } from '../engine/attendance.js';
import { payLines, monthlyRolesOf, newRun, lockLines, runStatus, STATUS_LABEL, METHODS, methodLabel, paymentFor, csvRows, runId, personSummary } from '../engine/crewpay.js';
import { onSite } from '../sync/fieldreport.js';
import { uid, money, fmtFull, toCSV, downloadText } from '../core/util.js';
import { paperHtml } from '../sync/mail.js';
import { html, options, chip, drawer } from './dom.js';
import { docHead, footText, signoff } from './print.js';
import { payRef } from './paysheets.js';
import { openMail } from './maildialog.js';
import { tell } from '../core/image.js';
import { crewSheet, staffSheet, byCurrency } from './paysheets.js';

let at = '';          // a day inside the period on screen; '' = today
let paying = null;    // the key of the line whose payment form is open
let payAll = false;   // the "Pay all outstanding" form is open
let notice = '';
let person = null;    // the key of the person open in the detail panel (v0.22.0)
let view = '';        // '' the working sheet, 'crew' the site pay sheet, 'staff' the monthly staff and labour cost (v0.21.2)

const periodOf = c => periodFor(c.project, at || c.today);
const crewOf = c => c.ws.team.filter(m => m.active !== false && onSite(m, c.company.staff || []));
const ctxOf = c => ({ project: c.project, ws: c.ws, staff: c.company.staff || [], crew: crewOf(c), monthlyRoles: monthlyRolesOf(store.global) });
/** The Admin and the Office people with Payments ticked record payments; approving also needs the approver tick. */
const mayPay = () => !store.readOnly && (store.isAdmin || (store.role === 'office' && store.can('payments')));
const mayApprove = () => mayPay() && store.canApprove;
const FROM = { project: 'day rate on this project', agreement: 'HR agreement', trade: 'trade rate (no rate of their own)', missing: 'position paid monthly, but no monthly wage in the HR agreement', '': 'no wage found' };
const STATUS_TONE = { draft: '', approved: 'info', paid: 'ok' };

const VIEWS = [['', 'Payments'], ['crew', 'Site pay sheet'], ['staff', 'Monthly staff and labour cost'], ['rates', 'Day rates and pay period']];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const num = el => Math.max(0, +el.value || 0);

/**
 * v0.25.0 (moved from Settings, This project): how often the crew is paid, the day rate of each trade, and each
 * person's wage, from their place on this project or their HR agreement in the Manpower Directory.
 */
function ratesView(c) {
  const { project: p, ws } = c;
  const can = mayPay();
  const cur = p.payCurrency || p.currency;
  const staff = c.company.staff || [];
  const dis = can ? '' : 'disabled';
  return html`<div class="set-cols" id="panel-rates">
    <section class="card set-box"><h3>Pay period of the crew</h3>
      <p class="muted">How often the site crew of this project is paid. The Attendance sheet shows the same period.</p>
      <div class="grid2">
        <label>Paid <select data-chg="payPeriod" data-fk="pp-kind" ${dis}>${options(PAY_PERIODS, payPeriodOf(p))}</select></label>
        ${payPeriodOf(p) === 'monthly' ? '' : html`<label>A pay week starts on <select data-chg="payWeekStart" data-fk="pp-start" ${dis}>${options(WEEKDAYS.map((d, i) => [String(i), d]), String(weekStartOf(p)))}</select></label>`}
        <label title="The currency of the day rates below. Each person's HR agreement can say otherwise.">Day rates are in <select data-chg="payCurrency" data-fk="pp-cur" ${dis}>${options(PAY_OPTIONS, cur)}</select></label>
      </div>
    </section>
    <section class="card set-box"><h3>Labour day rates <span class="muted">${cur}</span></h3>
      <div class="grid2">${Object.entries(ws.laborRates || {}).map(([trade, rate], i) => html`
        <label>${trade} <input type="number" min="0" step="any" data-chg="labor" data-t="${trade}" data-fk="lb-${i}" value="${rate}" ${dis}></label>`)}</div>
      ${can ? html`<form data-form="trade" class="entry">
        <input name="trade" placeholder="New trade" required aria-label="Trade" class="wide">
        <input type="number" name="rate" min="0" step="any" placeholder="Day rate" required aria-label="Day rate" class="amount">
        <button class="btn">Add</button>
      </form>` : ''}
    </section>
    <section class="card set-box"><h3>Wage of each person</h3>
      ${ws.team.length ? html`<table class="table compact"><thead><tr><th>Person</th><th>Role</th><th class="r">Day rate here (${cur})</th><th>HR agreement (Manpower Directory)</th></tr></thead>
        <tbody>${ws.team.map(m => { const a = staff.find(x => x.id === m.personId)?.agreement || {}; return html`<tr>
          <td>${m.name}</td><td>${m.role || ''}</td>
          <td class="r"><input class="price" type="number" min="0" step="any" data-chg="memberRate" data-id="${m.id}" data-fk="mr-${m.id}" value="${dayRateOf(ws, m.id) || ''}" placeholder="—" aria-label="Day rate of ${m.name}" ${dis}></td>
          <td>${+a.pay > 0 ? `${money(+a.pay, a.currency || cur, 0)} ${a.payPer === 'day' ? 'per day' : a.payPer === 'hour' ? 'per hour' : 'per month'}` : html`<span class="muted">none</span>`}</td></tr>`; })}</tbody></table>
        <p class="muted">A day rate here wins over the trade rate. A monthly wage comes from the person's HR agreement (Crew, Employee data).</p>` : html`<p class="muted">Nobody is on this project yet (Settings, This project, Team).</p>`}
    </section>
  </div>`;
}
const TITLE = { '': 'Crew payments', crew: 'Site pay sheet', staff: 'Monthly staff and labour cost' };
/** What the project has paid its crew and staff so far, in the project's currency (for the labour budget). */
const paidToDate = c => (c.ws.payments || []).reduce((s, x) => s + usdOf(x.amount, x.currency, x.usdRate), 0);   // v0.25.0: in USD, each ETB pay at its own rate
/** v0.25.0: the ETB-to-USD rate typed with an ETB pay (the table's rate is only a suggestion). */
const rateField = (cur, c) => (cur && cur !== 'USD' ? html`<label>${cur} per 1 USD, today <input type="number" name="usdRate" min="0.0001" step="any" required value="${c.global.fx.rates[cur] || ''}" title="The rate of this pay. It is kept with it; the cost is booked in USD at this rate."></label>` : '');
const rateOf = fd => +fd.get('usdRate') || 0;

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
      ${rateField(l.currency, c)}
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
      <h2>Payments</h2><span class="muted">${c.project.name}. ${notice}</span>
      <div class="seg" role="tablist">${VIEWS.map(([k, label]) => html`<button class="${view === k ? 'on' : ''}" data-act="payView" data-v="${k}" role="tab" aria-selected="${view === k}">${label}</button>`)}</div>
      <span class="grow"></span>
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
    ${waitingNote(c.ws.reports, p) ? html`<p class="callout warn no-print"><b>!</b> <span>${waitingNote(c.ws.reports, p)}</span></p>` : ''}
    ${missing.length ? html`<p class="bad no-print">No wage for ${missing.map(l => l.name).join(', ')}: set the day rate on their place on this project (Crew, Employee data, Projects) or their HR agreement.</p>` : ''}
    ${payAll ? html`<form data-form="payAll" class="card entry pay-form no-print">
      <b>Pay everyone what is outstanding (${owing.length} people, ${byCurrency(owing, 'outstanding')})</b>
      <label>Date <input type="date" name="date" required value="${c.today}" max="${c.today}"></label>
      ${[...new Set(owing.map(l => l.currency))].filter(k => k && k !== 'USD').map(k => rateField(k, c))}
      <label>How <select name="method">${options(METHODS, 'cash')}</select></label>
      <input name="ref" placeholder="Reference" aria-label="Reference">
      <button class="btn primary">Save ${owing.length} payments</button>
      <button type="button" class="btn ghost" data-act="closePay">Cancel</button>
    </form>` : ''}
    ${view === 'rates' ? ratesView(c) : view ? html`<section class="card sheet pay-sheet pay-doc">${view === 'crew' ? crewSheet(c, p, lines, status) : staffSheet(c, p, lines, status, paidToDate(c))}</section>` : html`<section class="card sheet pay-sheet"><div class="paper dsr land doc-paper" data-foot="${footText(c, 'Crew payments', payRef(c, p, 'ALL'), { note: 'confidential' })}">
      ${docHead(c, { title: 'Crew payments', sub: p.label, ref: payRef(c, p, 'ALL'), status: STATUS_LABEL[status], tone: status === 'draft' ? 'warn' : 'ok', facts: [['Project', c.project.name], ['Period', p.label], ['People', String(lines.length)], ['Due', byCurrency(lines, 'due')]] })}
      ${lines.length ? html`<div class="att-scroll"><table class="pay-grid">
        <thead><tr>
          <th>Name</th><th>Trade / position</th><th>Paid</th><th class="r">Wage</th><th class="r">Days</th><th class="r">OT h</th>
          <th class="r">Earned</th><th class="r">Adjust</th><th class="r">Brought forward</th><th class="r">Due</th><th class="r">Paid</th><th class="r">Total paid to date</th><th class="r">Outstanding</th><th class="no-print"></th>
        </tr></thead>
        <tbody>${lines.map(l => html`<tr>
          <td><button type="button" class="linkish" data-act="openPerson" data-k="${l.key}" title="Details and payments of ${l.name}"><b>${l.name}</b></button>${l.review ? html` <span class="chip warn no-print" title="The site typed ${l.review.wage} a day; the trade's daily wage is ${l.review.tradeWage}">Wage to review</span>${store.isAdmin ? html` <button type="button" class="btn ghost small no-print" data-act="wageOk" data-id="${l.id}">Wage OK</button>` : ''}` : ''}</td><td>${l.role || ''}</td>
          <td>${l.per === 'month' ? 'Monthly' : 'Daily'}</td>
          <td class="r nowrap" title="From the ${FROM[l.from] || l.from}">${l.from === 'missing' ? html`<span class="bad">Monthly wage missing</span>` : money(l.wage, l.currency, 2)}<span class="muted">/${l.per === 'month' ? 'month' : 'day'}</span>${l.from === 'trade' ? html` <span class="muted no-print">*</span>` : ''}</td>
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
      <p class="muted p-notes">Earned: days present x day rate plus overtime at ${c.project.billing?.otMultiplier || 1.5} times, from the Attendance sheet; monthly-paid people earn the period's share of the month's wage. Brought forward is what earlier periods still owe. Adjust is an advance or deduction (minus) or a bonus.${lines.some(l => l.from === 'trade') ? ' * Wage from the trade rates: this person has no rate of their own.' : ''}${lines.some(l => l.from === 'missing') ? ' Monthly wage missing: the position is paid monthly (Settings, Company); add the monthly wage to the HR agreement.' : ''}</p>`
      : html`<p class="empty">Nobody on this project's site team, and nothing owed or paid for ${p.label}.</p>`}
    </div></section>`}
    ${person && lines.find(l => l.key === person) ? personPanel(lines.find(l => l.key === person), c, can) : ''}
    ${payments.length ? html`<section class="card no-print">
      <h3>Payments for this period <span class="muted">each is also a labour cost under Costs</span></h3>
      <table class="table compact"><thead><tr><th>Date</th><th>Person</th><th class="r">Amount</th><th>How</th><th>Reference</th><th>By</th><th></th></tr></thead>
        <tbody>${payments.map(x => html`<tr>
          <td class="nowrap">${fmtFull(x.date)}</td><td>${x.name}</td><td class="r nowrap">${money(x.amount, x.currency, 2)}</td>
          <td>${methodLabel(x.method)}</td><td>${x.ref || ''}</td><td class="muted">${x.by || ''}</td>
          <td><button class="btn ghost small" data-act="openPerson" data-k="${x.key}">Details</button></td></tr>`)}</tbody></table>
    </section>` : ''}`;
}

/** One person's pay in the detail panel: how they are paid, this period, and every payment on this project. */
function personPanel(l, c, can) {
  const sum = personSummary(c.ws, l.key);
  const row = (k, v) => html`<dt>${k}</dt><dd>${v}</dd>`;
  return drawer(l.name, `${l.role || 'No trade'} · paid ${l.per === 'month' ? 'monthly' : 'daily'}`, html`
    <dl class="facts">
      ${row('Wage', l.wage > 0 ? `${money(l.wage, l.currency, 2)} a ${l.per === 'month' ? 'month' : 'day'}` : 'none')}
      ${row('From', FROM[l.from] || l.from || '')}
      ${row('Days present', String(l.present || 0))}${row('Overtime', `${l.ot || 0} h`)}
      ${row('Earned this period', money(l.earned, l.currency, 2))}${row('Due', money(l.due, l.currency, 2))}
      ${row('Outstanding', html`<b class="${l.outstanding > 0.004 ? 'bad' : 'ok'}">${money(l.outstanding, l.currency, 2)}</b>`)}
      ${row('On this project', `earned ${money(sum.earned, l.currency, 2)}, paid ${money(sum.paid, l.currency, 2)}`)}
    </dl>
    ${can && l.outstanding > 0.004 ? html`<div class="actions left"><button class="btn primary" data-act="openPay" data-k="${l.key}">Pay ${money(l.outstanding, l.currency, 2)}</button></div>` : ''}
    <h3>Payments</h3>
    ${sum.payments.length ? html`<ul class="plain">${sum.payments.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map(x => html`
      <li class="split"><span>${fmtFull(x.date)} · ${methodLabel(x.method)}${x.ref ? ` · ${x.ref}` : ''}</span>
        <span class="nowrap">${money(x.amount, x.currency, 2)}${store.isAdmin && !store.readOnly ? html` <button class="btn ghost small" data-act="removePayment" data-id="${x.id}">Delete</button>` : ''}</span></li>`)}</ul>`
      : html`<p class="muted">No payments yet.</p>`}`, 'closePerson');
}

/** Save one payment and its labour cost. */
function record(c, l, { amount, date, method, ref, usdRate = 0 }) {
  const p = periodOf(c);
  const { pay, cost } = paymentFor(l, { amount, date, method, ref, usdRate, period: p, by: store.user?.email || 'this computer', at: new Date().toISOString(), id: uid('pay') });
  store.update(ws => {
    ensureRun(ws, p);
    (ws.payments ||= []).push(pay);
    (ws.paycosts ||= []).push(cost);
  });
}

export const changes = {
  payPeriod(el) { if (mayPay()) store.updateProject(p => { p.payPeriod = el.value; }); },
  payWeekStart(el) { if (mayPay()) store.updateProject(p => { p.payWeekStart = +el.value; }); },
  payCurrency(el) { if (mayPay() && PAY_OPTIONS.some(([k]) => k === el.value)) store.updateProject(p => { p.payCurrency = el.value; }); },
  labor(el) { if (mayPay()) store.update(ws => { ws.laborRates[el.dataset.t] = num(el); }); },
  memberRate(el) { if (mayPay()) store.update(ws => { if (ws.team.some(x => x.id === el.dataset.id)) setDayRate(ws, el.dataset.id, num(el)); }); },
  adjust(el, c) {
    const p = periodOf(c);
    const v = Math.round((+el.value || 0) * 100) / 100;
    store.update(ws => { const run = ensureRun(ws, p); run.lines = { ...(run.lines || {}), [el.dataset.k]: { ...(run.lines?.[el.dataset.k] || {}), adjust: v } }; });
  },
};

export const actions = {
  /** v0.28.0: the Admin checked a wage the site typed that is not the trade's daily wage. */
  wageOk(el) { if (store.isAdmin) store.update(ws => { const m = ws.team.find(x => x.id === el.dataset.id); if (m) delete m.wageReview; }); },
  print() { print(); },
  payView(el) { view = el.dataset.v || ''; paying = null; payAll = false; },
  shift(el, c) { at = shiftPeriod(c.project, periodOf(c), +el.dataset.n).from; paying = null; payAll = false; notice = ''; },
  today() { at = ''; paying = null; payAll = false; },
  openPay(el) { paying = el.dataset.k; payAll = false; },
  openPerson(el) { person = el.dataset.k; },
  closePerson() { person = null; },
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
    store.update(ws => { ws.payments = (ws.payments || []).filter(x => x.id !== el.dataset.id); ws.paycosts = (ws.paycosts || []).filter(x => x.payId !== el.dataset.id); });
  },
  csv(el, c) {
    const p = periodOf(c);
    downloadText(`Crew payments ${c.project.name} ${p.from} to ${p.to}.csv`.replace(/[\\/:*?"<>|]/g, '-'), toCSV(csvRows(payLines(ctxOf(c), p).lines, p)), 'text/csv');
  },
  email(el, c) {
    const p = periodOf(c);
    const name = `${TITLE[view]} ${p.label}, ${c.project.name}`.replace(/[\\/:*?"<>|]/g, '-');
    openMail({
      to: '',
      subject: name,
      message: `Dear Sir or Madam,\n\nPlease find attached the ${TITLE[view].toLowerCase()} of ${c.project.name} for ${p.label}.\n\nKind regards,\n${store.signature}\n${c.global.company?.name || 'Amistad Prefab'}`,
      filename: name,
      getHtml: () => paperHtml(document.querySelector('.paper'), name),
      sheet: () => document.querySelector('.paper'),
      onSent({ to }) { notice = `Sent to ${to}.`; store.notify(); },
    });
  },
};

export const submits = {
  trade(fd) {
    const trade = String(fd.get('trade') || '').trim();
    if (trade && mayPay()) store.update(ws => { ws.laborRates[trade] = Math.max(0, +fd.get('rate') || 0); });
  },
  pay(fd, c, form) {
    const key = form?.dataset?.k || paying;
    const l = payLines(ctxOf(c), periodOf(c)).lines.find(x => x.key === key);
    const amount = +fd.get('amount');
    if (!l || !(amount > 0)) return false;
    record(c, l, { amount, date: fd.get('date'), method: fd.get('method'), ref: String(fd.get('ref') || '').trim(), usdRate: rateOf(fd) });
    tell(`✓ ${money(amount, l.currency, 2)} paid to ${l.name}.`);
    paying = null;
  },
  payAll(fd, c) {
    const owing = payLines(ctxOf(c), periodOf(c)).lines.filter(l => l.outstanding > 0.004);
    for (const l of owing) record(c, l, { amount: l.outstanding, date: fd.get('date'), method: fd.get('method'), ref: String(fd.get('ref') || '').trim(), usdRate: rateOf(fd) });
    tell(`✓ ${owing.length} payments saved.`);
    payAll = false;
  },
};
