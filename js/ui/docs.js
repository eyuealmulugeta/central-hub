// Documents: invoices, quotations, purchase orders and client progress reports
// (saved, numbered), plus live previews of the progress report, the client
// schedule and the internal performance report. Everything prints on the
// company letterhead through the Print button.

import { store } from '../core/store.js';
import { METHODS, invoiceLines, makeDoc, nextNumber, docTotals } from '../engine/billing.js';
import { reportSnapshot } from '../engine/report.js';
import { performanceReport } from '../engine/performance.js';
import { paySheet, delayRecord } from '../engine/site.js';
import { uid, money, num, fmtDate, fmtFull, fmtDay, toDay, fromDay, sum, clamp } from '../core/util.js';
import { html, options, field, chip, meter } from './dom.js';
import { paperHtml } from '../sync/mail.js';
import { openMail, emailIn } from './maildialog.js';

let tab = 'docs';
let mode = null;     // invoices | quotations | status: what the menu opened this screen as (null = everything)
let sel = null;       // { kind: 'doc', id } | { kind: 'report' } | { kind: 'schedule' } | { kind: 'performance' }
let notice = '';
let period = 'weekly';
let endDate = '';

/** Open a saved document from outside this screen (search, quick links). */
export const focusOn = id => { tab = 'docs'; sel = { kind: 'doc', id }; notice = ''; };

const TITLE = { invoice: 'Invoice', quote: 'Quotation', po: 'Purchase order', report: 'Progress report' };
const PARTY = { invoice: 'Bill to', quote: 'Prepared for', po: 'Supplier' };
const DUE = { invoice: 'Due', quote: 'Valid until', po: 'Deliver by' };
const NEXT = {
  invoice: { draft: ['sent', 'Mark as sent'], sent: ['paid', 'Mark as paid'] },
  quote: { draft: ['sent', 'Mark as sent'], sent: ['accepted', 'Mark as accepted'] },
  po: { draft: ['sent', 'Mark as sent'], sent: ['delivered', 'Mark as delivered'] },
  report: { draft: ['issued', 'Approve and issue'] },
};
const STATUS_CLS = { draft: '', sent: 'info', paid: 'ok', accepted: 'ok', delivered: 'ok', issued: 'ok' };
const STATUS_LABEL = { done: 'Done', late: 'Overdue', active: 'In progress', pending: 'Not started' };
const PERIODS = { daily: ['Daily', 1], weekly: ['Weekly', 7], monthly: ['Monthly', 30] };
const QUOTE_VALID_DAYS = 30;
const EMAIL_BUTTON = html`<button class="btn" data-act="email" title="Send this document by email, as a PDF">Email</button><button class="btn" data-share title="Send this document as a PDF file on WhatsApp or Telegram">WhatsApp / Telegram</button>`;
const emailed = doc => (doc.emails?.length
  ? html`<p class="muted no-print">Emailed to ${doc.emails.at(-1).to} on ${fmtFull(doc.emails.at(-1).at)}${doc.emails.length > 1 ? `, ${doc.emails.length} times in all` : ''}.</p>` : '');

/** Date range of the live previews: the chosen period ending on the chosen day. */
const liveRange = c => {
  const to = endDate || c.today;
  return [fromDay(toDay(to) - PERIODS[period][1] + 1), to];
};

// ---- printable pieces ----

export function letterhead(c, title, facts) {
  const co = c.global.company || {};
  return html`
    <header class="p-head">
      <div class="p-block">
        <img src="${co.logo || 'assets/logo.png'}" alt="">
        <b class="p-company">${co.name || 'Your company name'}</b>
        <span class="pre">${co.address || ''}</span>
        <span>${[co.phone, co.email].filter(Boolean).join(' · ')}</span>
        ${co.taxId ? html`<span>Tax ID ${co.taxId}</span>` : ''}
      </div>
      <div class="p-title">
        <h2>${title}</h2>
        <dl class="facts">${facts.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
      </div>
    </header>`;
}

function party(label, p) {
  return html`<div class="p-block">
    <span class="muted">${label}</span><b>${p.name || '—'}</b>
    <span class="pre">${p.address || ''}</span><span>${p.contact || ''}</span>
    ${p.taxId ? html`<span>Tax ID ${p.taxId}</span>` : ''}
  </div>`;
}

/** Gantt chart sized in percentages so it fits any page width. */
function miniGantt(s, asOf) {
  if (!s.rows.length) return '';
  const T = toDay(asOf);
  const start = Math.min(s.start, s.planStart);
  const span = Math.max(s.end, s.planEnd) - start + 1;
  const at = d => ((d - start) / span * 100).toFixed(2);
  const wide = (a, b) => ((b - a + 1) / span * 100).toFixed(2);
  const months = [];
  for (let d = start; d < start + span; d++) {
    const key = fromDay(d).slice(0, 7);
    if (months.at(-1)?.key !== key) months.push({ key, from: d });
  }
  const label = key => new Date(key + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  const today = T >= start && T < start + span ? html`<u style="left:${at(T)}%"></u>` : '';

  return html`
    <div class="mg">
      <div class="mg-row mg-head"><span></span><div class="mg-track">${months.map(m => html`<em style="left:${at(m.from)}%">${label(m.key)}</em>`)}</div></div>
      ${s.rows.map(r => html`
        <div class="mg-row">
          <span>${r.name}</span>
          <div class="mg-track">
            <i class="mg-plan" style="left:${at(r.planEs)}%;width:${wide(r.planEs, r.planEf)}%"></i>
            ${r.milestone
              ? html`<b class="mg-ms ${r.status}" style="left:${at(r.es)}%"></b>`
              : html`<b class="mg-bar ${r.status}" style="left:${at(r.es)}%;width:${wide(r.es, r.ef)}%"><i style="width:${r.progress}%"></i></b>`}
            ${today}
          </div>
        </div>`)}
      <p class="muted mg-key">Thick bar: forecast with progress. Thin line: original plan. Red line: today.</p>
    </div>`;
}

function taskTable(rows) {
  return html`
    <table class="table compact">
      <thead><tr><th>Task</th><th>Planned</th><th>Forecast</th><th class="r">Done</th><th>Status</th></tr></thead>
      <tbody>${rows.map(r => html`
        <tr>
          <td>${r.name}</td>
          <td class="nowrap">${r.milestone ? fmtDay(r.planEf) : `${fmtDay(r.planEs)} to ${fmtDay(r.planEf)}`}</td>
          <td class="nowrap">${r.milestone ? fmtDay(r.ef) : `${fmtDay(r.es)} to ${fmtDay(r.ef)}`}</td>
          <td class="r">${r.progress}%</td>
          <td>${STATUS_LABEL[r.status]}${r.slip > 0 && r.progress < 100 ? `, ${r.slip} d behind` : ''}</td>
        </tr>`)}</tbody>
    </table>`;
}

function docPaper(d, c) {
  const cur = c.project.currency;
  const co = c.global.company || {};
  let group = null;
  return html`
    <article class="paper">
      ${letterhead(c, TITLE[d.type], [['Number', d.number], ['Date', fmtFull(d.date)], [DUE[d.type], fmtFull(d.due)]])}
      <section class="p-to">
        ${party(PARTY[d.type], d.party)}
        <div class="p-block">
          <span class="muted">Project</span><b>${c.project.name}</b>
          ${d.period ? html`<span>Period ${fmtFull(d.period.from)} to ${fmtFull(d.period.to)}</span>` : ''}
        </div>
      </section>
      <table class="table compact">
        <thead><tr><th>#</th><th>Description</th><th class="r">Qty</th><th>Unit</th><th class="r">Rate</th><th class="r">Amount (${cur})</th></tr></thead>
        <tbody>${d.lines.filter(l => String(l.description || '').trim() || l.amount).map((l, i) => {
          const head = l.group && l.group !== group ? html`<tr class="group"><td colspan="6">${l.group}</td></tr>` : '';
          group = l.group || group;
          return html`${head}<tr>
            <td>${i + 1}</td><td>${l.description}</td>
            <td class="r">${num(l.qty)}</td><td>${l.unit}</td>
            <td class="r">${num(l.rate)}</td><td class="r">${num(l.amount)}</td>
          </tr>`;
        })}</tbody>
      </table>
      <dl class="totals">
        <dt>Subtotal</dt><dd>${money(d.subtotal, cur, 2)}</dd>
        ${d.vatPct ? html`<dt>VAT ${d.vatPct}%</dt><dd>${money(d.vat, cur, 2)}</dd>` : ''}
        <dt class="grand">Total</dt><dd class="grand">${money(d.total, cur, 2)}</dd>
        ${d.retention ? html`
          <dt>Less retention ${d.retentionPct}%</dt><dd>−${money(d.retention, cur, 2)}</dd>
          <dt class="grand">Amount due</dt><dd class="grand">${money(d.amountDue, cur, 2)}</dd>` : ''}
      </dl>
      ${d.notes ? html`<p class="pre p-notes">${d.notes}</p>` : ''}
      ${d.type === 'invoice' && co.bank ? html`<div class="p-block p-notes"><span class="muted">Payment details</span><span class="pre">${co.bank}</span></div>` : ''}
      <footer class="p-sign"><div>Prepared by</div><div>${d.type === 'invoice' ? 'Received by' : 'Approved by'}</div></footer>
    </article>`;
}

/**
 * Progress report drawn from a snapshot (reportSnapshot). `doc` is the saved
 * client report, if any; while it is a draft its lines can be left out.
 */
function reportPaper(c, kind, d, doc) {
  const range = d.from === d.to ? fmtFull(d.to) : `${fmtFull(d.from)} to ${fmtFull(d.to)}`;
  const outlook = d.slip > 0 ? `${d.slip} working days behind plan` : d.slip < 0 ? `${-d.slip} working days ahead of plan` : 'on plan';
  const editable = doc?.status === 'draft';
  const dropHead = editable ? html`<th class="no-print"></th>` : '';
  const drop = (k, i) => (editable
    ? html`<td class="r no-print"><button class="btn ghost small" data-act="omitLine" data-k="${k}" data-i="${i}" title="Leave this line out of the client report">Remove</button></td>` : '');
  const facts = doc
    ? [['Number', doc.number], ['Period', range], ['Issued', doc.status === 'issued' ? fmtFull(doc.approvedAt) : 'Draft, not issued']]
    : [['Period', range], ['As of', fmtFull(d.asOf)]];

  return html`
    <article class="paper">
      ${letterhead(c, `${PERIODS[kind][0]} progress report`, facts)}
      <section class="p-to">
        ${party('Client', doc?.party || c.project.client || {})}
        <div class="p-block"><span class="muted">Project</span><b>${c.project.name}</b></div>
      </section>

      <div class="p-kpis">
        <div><span class="muted">Completed</span><b>${Math.round(d.progress)}%</b>${meter(d.progress)}</div>
        <div><span class="muted">Planned to date</span><b>${Math.round(d.plannedProgress)}%</b>${meter(d.plannedProgress)}</div>
        <div><span class="muted">Forecast completion</span><b>${d.rows.length ? fmtFull(fromDay(d.end)) : '—'}</b><span>${outlook}</span></div>
      </div>

      ${doc?.remarks ? html`<h3>Remarks</h3><p class="pre">${doc.remarks}</p>` : ''}

      <h3>Work in this period</h3>
      ${d.work.length ? html`<table class="table compact">
        <thead><tr><th>Date</th><th>Task</th><th class="r">Done</th><th>Remarks</th>${dropHead}</tr></thead>
        <tbody>${d.work.map((e, i) => html`<tr><td class="nowrap">${fmtDate(e.date)}</td><td>${e.task}</td><td class="r nowrap">${e.qty > 0 ? `${num(e.qty)} ${e.unit}` : e.progress != null ? e.progress + '%' : ''}</td><td>${e.note}</td>${drop('work', i)}</tr>`)}</tbody>
      </table>` : (d.summary || []).length ? '' : html`<p class="muted">No progress was reported in this period.</p>`}
      ${(d.summary || []).length ? html`<table class="table compact">
        <thead><tr><th>Date</th><th>Site progress notes</th>${dropHead}</tr></thead>
        <tbody>${d.summary.map((e, i) => html`<tr><td class="nowrap">${fmtDate(e.date)}</td><td>${e.text}</td>${drop('summary', i)}</tr>`)}</tbody>
      </table>` : ''}

      ${d.delays.length ? html`
        <h3>Delays</h3>
        <table class="table compact">
          <thead><tr><th>Date</th><th>Task</th><th class="r">Days lost</th><th>Reason</th>${dropHead}</tr></thead>
          <tbody>${d.delays.map((e, i) => html`<tr><td class="nowrap">${fmtDate(e.date)}</td><td>${e.task}</td><td class="r">${e.delayDays}</td><td>${e.note}</td>${drop('delays', i)}</tr>`)}</tbody>
        </table>` : ''}

      ${d.manpower.length ? html`
        <h3>Manpower</h3>
        <p>${d.manpower.map(m => `${m.trade}: ${num(m.days)} man-days${m.ot ? ` and ${num(m.ot)} overtime hours` : ''}`).join('; ')}.
          Reported on ${d.reportDays} day${d.reportDays === 1 ? '' : 's'}${d.weather.length ? `. Weather: ${d.weather.join(', ').toLowerCase()}` : ''}.</p>` : ''}

      <h3>Coming up</h3>
      ${d.lookahead.length ? taskTable(d.lookahead) : html`<p class="muted">No work is scheduled in the next period.</p>`}

      ${d.issues.length ? html`
        <h3>Open items</h3>
        <table class="table compact"><tbody>${d.issues.map((x, i) => html`<tr><td>${x.title}${x.due ? ` (due ${fmtDate(x.due)})` : ''}</td>${drop('issues', i)}</tr>`)}</tbody></table>` : ''}

      <h3>Schedule</h3>
      ${miniGantt(d, d.asOf)}
      ${doc?.status === 'issued' ? html`<p class="muted p-notes">Approved by ${doc.approvedBy} on ${fmtFull(doc.approvedAt)}.</p>` : ''}
    </article>`;
}

/** Internal weekly or monthly performance: output against plan, by engineer, with manpower and reporting discipline. */
/** Pay sheet for the period, from the attendance the site engineer took in the daily reports. */
function payPaper(c) {
  const [from, to] = liveRange(c);
  const s = paySheet(c, from, to);
  const cur = c.project.currency;
  return html`
    <article class="paper">
      ${letterhead(c, 'Site pay sheet', [['Period', `${fmtFull(from)} to ${fmtFull(to)}`], ['Project', c.project.name]])}
      <p class="p-internal">Internal. Check against the site register before paying.</p>
      ${s.rows.length ? html`
        <table class="table compact">
          <thead><tr><th>#</th><th>Name</th><th>Role</th><th class="r">Days present</th><th class="r">Sick</th><th class="r">Leave</th><th class="r">Absent</th><th class="r">Overtime h</th><th class="r">Day rate</th><th class="r">Basic</th><th class="r">Overtime</th><th class="r">Pay (${cur})</th><th>Signature</th></tr></thead>
          <tbody>${s.rows.map((r, i) => html`<tr>
            <td>${i + 1}</td><td>${r.name}</td><td>${r.role}</td><td class="r">${r.present}</td><td class="r">${r.sick || ''}</td><td class="r">${r.leave || ''}</td><td class="r">${r.absent || ''}</td>
            <td class="r">${r.ot ? num(r.ot, 1) : ''}</td><td class="r">${r.rate ? num(r.rate) : html`<span class="bad">not set</span>`}</td>
            <td class="r">${num(r.basic)}</td><td class="r">${r.overtime ? num(r.overtime) : ''}</td><td class="r"><b>${num(r.pay)}</b></td><td></td></tr>`)}
            <tr class="group"><td colspan="3">Total, ${s.rows.length} people</td><td class="r">${s.present}</td><td colspan="3"></td><td class="r">${num(s.ot, 1)}</td><td colspan="3"></td><td class="r">${money(s.total, cur)}</td><td></td></tr>
          </tbody>
        </table>
        <p class="muted">Attendance was reported on ${s.days} day${s.days === 1 ? '' : 's'} in this period. Pay is days present at the day rate, plus overtime at day rate ÷ ${s.hoursPerDay} h × ${s.otMultiplier}. Sick and absent days are shown but not paid here.</p>
        ${s.unrated.length ? html`<p class="bad no-print">No day rate is set for ${s.unrated.join(', ')}. Set it under Settings, This project, Team.</p>` : ''}
        <footer class="p-sign"><div>Prepared by</div><div>Approved by</div></footer>`
      : html`<p class="muted">No attendance by name was reported in this period. It comes from the Attendance section of Field Report, version 1.13 or later.</p>`}
    </article>`;
}

/** Record of delays for the period: every item, and the time lost by who was responsible. */
function claimPaper(c) {
  const [from, to] = liveRange(c);
  const d = delayRecord(c, from, to);
  const days = v => `${num(v, 1)} day${Math.abs(v - 1) < 0.05 ? '' : 's'}`;
  return html`
    <article class="paper">
      ${letterhead(c, 'Record of delays', [['Period', `${fmtFull(from)} to ${fmtFull(to)}`], ['Prepared', fmtFull(c.today)]])}
      <section class="p-to">
        ${party('Client', c.project.client || {})}
        <div class="p-block"><span class="muted">Project</span><b>${c.project.name}</b></div>
      </section>
      ${d.items.length ? html`
        <div class="p-kpis">
          <div><span class="muted">Time lost in the period</span><b>${days(d.days)}</b><span>${num(d.hours, 1)} working hours</span></div>
          <div><span class="muted">Attributed to the Client</span><b>${days(d.clientDays)}</b><span>${num(d.clientHours, 1)} working hours</span></div>
          <div><span class="muted">Labour standing idle</span><b>${num(d.idleManHours, 0)} man-hours</b><span>People idle × hours lost</span></div>
        </div>
        <h3>By responsible party</h3>
        <table class="table compact">
          <thead><tr><th>Party</th><th class="r">Events</th><th class="r">Hours</th><th class="r">Working days</th></tr></thead>
          <tbody>${d.byParty.map(g => html`<tr><td>${g.name}</td><td class="r">${g.count}</td><td class="r">${num(g.hours, 1)}</td><td class="r">${num(g.days, 1)}</td></tr>`)}</tbody>
        </table>
        <h3>By cause</h3>
        <table class="table compact">
          <thead><tr><th>Cause</th><th class="r">Events</th><th class="r">Hours</th><th class="r">Working days</th></tr></thead>
          <tbody>${d.byCause.map(g => html`<tr><td>${g.name}</td><td class="r">${g.count}</td><td class="r">${num(g.hours, 1)}</td><td class="r">${num(g.days, 1)}</td></tr>`)}</tbody>
        </table>
        <h3>Every delay, as reported from site on the day</h3>
        <table class="table compact">
          <thead><tr><th>Date</th><th>Cause</th><th>Responsible</th><th>Work affected</th><th class="r">Hours</th><th class="r">People idle</th><th>Details</th><th>Reported by</th></tr></thead>
          <tbody>${d.items.map(x => html`<tr><td class="nowrap">${fmtDate(x.date)}</td><td>${x.cause}</td><td>${x.party}</td><td>${x.task}</td><td class="r">${num(x.hours, 1)}</td><td class="r">${x.idlePeople || ''}</td><td>${[x.note, x.idleEquipment && `Equipment idle: ${x.idleEquipment}`].filter(Boolean).join('. ')}</td><td>${x.by}</td></tr>`)}</tbody>
        </table>
        <p class="muted p-notes">A working day is ${d.hoursPerDay} hours. This is a record of what the site reported; it is not itself a notice under the contract.</p>`
      : html`<p class="muted">No itemised delays were reported in this period. They come from the Delays section of Field Report, version 1.13 or later.</p>`}
    </article>`;
}

function performancePaper(c) {
  const [from, to] = liveRange(c);
  const r = performanceReport(c, from, to);
  const cur = c.project.currency;
  const pts = v => `${v >= 0 ? '+' : ''}${num(v, 1)} pts`;

  return html`
    <article class="paper">
      ${letterhead(c, `${PERIODS[period][0]} performance report`, [['Period', `${fmtFull(from)} to ${fmtFull(to)}`], ['Project', c.project.name]])}
      <p class="p-internal">Internal. Not for the client.</p>

      <div class="p-kpis">
        <div><span class="muted">Progress gained</span><b>${pts(r.gain)}</b><span>Planned ${pts(r.plannedGain)}, now ${Math.round(r.progress)}% complete</span></div>
        <div><span class="muted">Performance index</span><b>${r.index == null ? '—' : num(r.index, 2)}</b><span>${r.index == null ? 'No progress was planned in this period' : '1.00 means exactly the planned progress'}</span></div>
        <div><span class="muted">Schedule</span><b>${r.slip > 0 ? `${r.slip} d behind` : r.slip < 0 ? `${-r.slip} d ahead` : 'On plan'}</b><span>${r.slipChange > 0 ? `${r.slipChange} d worse than at the start of the period` : r.slipChange < 0 ? `${-r.slipChange} d better than at the start of the period` : 'Unchanged in the period'}</span></div>
      </div>

      <h3>By engineer</h3>
      <table class="table compact">
        <thead><tr><th>Engineer</th><th class="r">Tasks</th><th class="r">Progress gained</th><th class="r">Finished</th><th class="r">Finished late</th><th class="r">Overdue now</th><th class="r">Slipping</th></tr></thead>
        <tbody>${r.engineers.map(e => html`<tr><td>${e.name}</td><td class="r">${e.tasks}</td><td class="r">${pts(e.gain)}</td><td class="r">${e.finished}</td><td class="r">${e.finishedLate}</td><td class="r">${e.overdue}</td><td class="r">${e.slipping}</td></tr>`)}</tbody>
      </table>
      <p class="muted">Progress gained is the average across each person's tasks, weighted by task duration. Read it with the delays below: lost days are often outside the engineer's control.</p>

      <h3>Work output</h3>
      ${r.tasks.length ? html`<table class="table compact">
        <thead><tr><th>Task</th><th>Engineer</th><th class="r">Installed</th><th class="r">Gained</th><th class="r">Now</th><th>Status</th></tr></thead>
        <tbody>${r.tasks.map(t => html`<tr><td>${t.name}</td><td>${t.engineer}</td><td class="r nowrap">${t.qty > 0 ? `${num(t.qty)} ${t.unit}` : ''}</td><td class="r">${pts(t.gain)}</td><td class="r">${num(t.progress, 1)}%</td><td>${STATUS_LABEL[t.status]}${t.slip > 0 && t.progress < 100 ? `, ${t.slip} d behind` : ''}</td></tr>`)}</tbody>
      </table>` : html`<p class="muted">No task was active in this period.</p>`}

      <h3>Reporting</h3>
      <p>Reports were filed on ${r.reportedDays} of ${r.workDays} working days${r.missing.length ? `. Missing: ${r.missing.map(fmtDate).join(', ')}` : ''}.</p>
      ${r.reporters.length ? html`<table class="table compact">
        <thead><tr><th>Reported by</th><th class="r">Reports</th><th class="r">Waiting for confirmation</th></tr></thead>
        <tbody>${r.reporters.map(p => html`<tr><td>${p.name}</td><td class="r">${p.reports}</td><td class="r">${p.unconfirmed}</td></tr>`)}</tbody>
      </table>` : ''}

      <h3>Manpower and cost</h3>
      <dl class="facts narrow">
        <dt>Man-days</dt><dd>${num(r.manDays)}</dd>
        <dt>Overtime hours</dt><dd>${num(r.otHours)}</dd>
        <dt>Man-hours</dt><dd>${num(r.manHours)} <span class="muted">(${num(r.manDays)} man-days x ${num(r.hoursPerDay)} h + overtime)</span></dd>
        <dt>Labour cost</dt><dd>${money(r.labourCost, cur)}</dd>
        <dt>Progress per 100 man-days</dt><dd>${r.productivity == null ? '—' : pts(r.productivity)}</dd>
        <dt>Spent in the period</dt><dd>${money(r.spent, cur)}</dd>
        <dt>Received in the period</dt><dd>${money(r.received, cur)}</dd>
      </dl>

      ${r.delays.length ? html`
        <h3>Delays, ${num(r.daysLost)} days lost</h3>
        <table class="table compact">
          <thead><tr><th>Date</th><th>Task</th><th class="r">Days</th><th>Reason</th></tr></thead>
          <tbody>${r.delays.map(e => html`<tr><td class="nowrap">${fmtDate(e.date)}</td><td>${e.task}</td><td class="r">${e.days}</td><td>${e.note}</td></tr>`)}</tbody>
        </table>` : ''}

      <h3>Follow-ups</h3>
      <p>${r.itemsOpened} opened and ${r.itemsClosed} closed in the period. ${r.itemsOverdue} open and past due at the end of it.</p>
    </article>`;
}

function schedulePaper(c) {
  const s = c.sched;
  return html`
    <article class="paper">
      ${letterhead(c, 'Project schedule', [['Issued', fmtFull(c.today)], ['Completion', s.rows.length ? fmtFull(fromDay(s.end)) : '—']])}
      <section class="p-to">
        ${party('Client', c.project.client || {})}
        <div class="p-block"><span class="muted">Project</span><b>${c.project.name}</b><span>${Math.round(s.progress)}% complete</span></div>
      </section>
      ${taskTable(s.rows)}
      ${miniGantt(s, c.today)}
    </article>`;
}

// ---- billing terms ----

function terms(c) {
  const { project: p, bill: b, ws, sched } = c;
  const cl = p.client || {};
  const cur = p.currency;
  const milestone = b.method.startsWith('milestone');
  const pct = b.method === 'milestone_pct';
  const stageTotal = sum(b.stages, s => s.amount);
  const trades = [...new Set([...Object.keys(ws.laborRates), ...Object.keys(ws.billRates)])];
  const earned = p.contractValue * sched.progress / 100;

  let detail;
  if (milestone) {
    detail = html`
      <h2>Payment stages</h2>
      <table class="table compact">
        <thead><tr><th>Stage</th><th>Invoice when</th><th class="r">${pct ? '% of contract' : `Amount (${cur})`}</th><th class="r">Amount</th><th>Status</th><th></th></tr></thead>
        <tbody>${b.stages.map(s => html`
          <tr>
            <td><input data-chg="stage" data-id="${s.id}" data-f="name" data-fk="sn-${s.id}" value="${s.name}" aria-label="Stage name"></td>
            <td><select class="task-pick" data-chg="stage" data-id="${s.id}" data-f="taskId" data-fk="st-${s.id}" aria-label="Task that triggers ${s.name}">
              <option value="">Contract start</option>${options(ws.tasks.map(t => [t.id, `${t.name} done`]), s.taskId || null)}
              ${s.taskId && !ws.tasks.some(t => t.id === s.taskId) ? html`<option value="${s.taskId}" selected>Deleted task: choose again</option>` : ''}</select></td>
            <td class="r"><input class="price" type="number" min="0" step="any" data-chg="stage" data-id="${s.id}" data-f="value" data-fk="sv-${s.id}" value="${s.value}" aria-label="Value of ${s.name}"></td>
            <td class="r nowrap">${money(s.amount, cur)}</td>
            <td>${s.state === 'invoiced' ? chip(s.doc.number, 'ok') : s.state === 'ready' ? chip('Ready to invoice', 'warn') : chip('Not reached')}</td>
            <td class="r"><button class="btn ghost small" data-act="removeStage" data-id="${s.id}">Remove</button></td>
          </tr>`)}</tbody>
      </table>
      <p class="${Math.abs(stageTotal - p.contractValue) > 1 ? 'bad' : 'muted'}">Stages total ${money(stageTotal, cur)} against a contract value of ${money(p.contractValue, cur)}.</p>
      <form data-form="stage" class="entry">
        <input name="name" placeholder="New stage, e.g. Roof complete" required aria-label="Stage name" class="wide">
        <input type="number" name="value" min="0" step="any" placeholder="${pct ? '%' : 'Amount'}" required aria-label="Value" class="amount">
        <button class="btn">Add stage</button>
      </form>`;
  } else if (b.method === 'measured') {
    detail = html`
      <div class="toolbar"><h2>Measured items</h2></div>
      <table class="table compact">
        <thead><tr><th>Item</th><th>Unit</th><th class="r">Contract qty</th><th class="r">Rate (${cur})</th><th class="r">Measured to date</th><th class="r">Invoiced</th><th></th></tr></thead>
        <tbody>${ws.measure.map(m => html`
          <tr>
            <td>${m.description}</td><td>${m.unit}</td>
            <td class="r">${num(m.contractQty)}</td>
            <td class="r"><input class="price" type="number" min="0" step="any" data-chg="measure" data-id="${m.id}" data-f="rate" data-fk="mr-${m.id}" value="${m.rate}" aria-label="Rate, ${m.description}"></td>
            <td class="r"><input class="price" type="number" min="0" step="any" data-chg="measure" data-id="${m.id}" data-f="doneQty" data-fk="md-${m.id}" value="${m.doneQty}" aria-label="Measured to date, ${m.description}"></td>
            <td class="r">${num(b.measuredBilled[m.id] || 0)}</td>
            <td class="r"><button class="btn ghost small" data-act="removeMeasure" data-id="${m.id}">Remove</button></td>
          </tr>`)}</tbody>
      </table>
      ${ws.measure.length ? '' : html`<p class="empty">No items yet. Copy them from the estimate or add them below.</p>`}
      <form data-form="measure" class="entry">
        <input name="description" placeholder="Item description" required aria-label="Description" class="wide">
        <input name="unit" placeholder="Unit" required aria-label="Unit" class="amount">
        <input type="number" name="contractQty" min="0" step="any" placeholder="Contract qty" required aria-label="Contract quantity" class="amount">
        <input type="number" name="rate" min="0" step="any" placeholder="Rate" required aria-label="Rate" class="amount">
        <button class="btn">Add item</button>
      </form>`;
  } else if (b.method === 'daily') {
    detail = html`
      <h2>Client day rates</h2>
      <p class="muted">What the client pays per person per day. Overtime hours from daily reports are charged at day rate ÷ ${b.hoursPerDay} h × ${b.otMultiplier}.</p>
      <table class="table compact">
        <thead><tr><th>Trade</th><th class="r">Day rate (${cur})</th><th class="r">Overtime per hour</th></tr></thead>
        <tbody>${trades.map((t, i) => html`
          <tr>
            <td>${t}</td>
            <td class="r"><input class="price" type="number" min="0" step="any" data-chg="billRate" data-t="${t}" data-fk="br-${i}" value="${ws.billRates[t] ?? ''}" aria-label="Client day rate, ${t}"></td>
            <td class="r">${num((ws.billRates[t] || 0) / b.hoursPerDay * b.otMultiplier)}</td>
          </tr>`)}</tbody>
      </table>
      ${trades.length ? '' : html`<p class="empty">Add trades under Settings, Labour day rates.</p>`}`;
  } else {
    detail = html`
      <h2>${METHODS.find(([k]) => k === b.method)[1]}</h2>
      <p class="muted">${b.method === 'advance'
        ? 'One invoice for the whole contract value, issued before work starts.'
        : 'Each invoice claims the contract value multiplied by overall progress, less everything invoiced before. Progress comes from daily reports.'}</p>
      <dl class="facts narrow">
        <dt>Contract value</dt><dd>${money(p.contractValue, cur)}</dd>
        ${b.method === 'progress' ? html`<dt>Earned at ${sched.progress.toFixed(1)}%</dt><dd>${money(earned, cur)}</dd>` : ''}
        <dt>Invoiced</dt><dd>${money(b.invoiced, cur)}</dd>
        <dt>Not yet invoiced</dt><dd>${money((b.method === 'progress' ? earned : p.contractValue) - b.invoiced, cur)}</dd>
      </dl>`;
  }

  return html`
    <section class="card">
      <h2>Client</h2>
      <div class="form">
        <label>Name <input data-chg="client" data-f="name" data-fk="cl-name" value="${cl.name || ''}"></label>
        <label>Address <textarea data-chg="client" data-f="address" data-fk="cl-addr" rows="2">${cl.address || ''}</textarea></label>
        <label>Contact (email or phone) <input data-chg="client" data-f="contact" data-fk="cl-contact" value="${cl.contact || ''}"></label>
        <label>Tax ID <input data-chg="client" data-f="taxId" data-fk="cl-tax" value="${cl.taxId || ''}"></label>
        <h3>Billing</h3>
        <label>How this project is billed <select data-chg="billing" data-f="method" data-fk="b-method">${options(METHODS, b.method)}</select></label>
        <div class="grid2">
          <label>Contract value <input type="number" min="0" step="any" data-chg="contract" data-fk="b-contract" value="${p.contractValue}"></label>
          <label>Payment due, days <input type="number" min="0" data-chg="billing" data-f="paymentDays" data-fk="b-days" value="${b.paymentDays}"></label>
          <label>Retention % <input type="number" min="0" max="100" step="any" data-chg="billing" data-f="retention" data-fk="b-ret" value="${b.retention}"></label>
          <label>VAT % <input type="number" min="0" step="any" data-chg="vat" data-fk="b-vat" value="${p.markups.vat}"></label>
          ${b.method === 'daily' ? html`
            <label>Overtime multiplier <input type="number" min="1" step="any" data-chg="billing" data-f="otMultiplier" data-fk="b-ot" value="${b.otMultiplier}"></label>
            <label>Hours per day <input type="number" min="1" step="any" data-chg="billing" data-f="hoursPerDay" data-fk="b-hours" value="${b.hoursPerDay}"></label>` : ''}
        </div>
      </div>
    </section>
    <section class="card">${detail}</section>`;
}

// ---- screen ----

/** Opened from the menu as Invoices, Quotations or Status report. */
export function preset(p = {}) {
  mode = p.mode || null;
  tab = 'docs';
  notice = '';
  sel = mode === 'status' ? { kind: 'performance' } : null;
  if (mode === 'status' && period === 'daily') period = 'weekly';
}
const KINDS = { invoices: ['invoice'], quotations: ['quote', 'po'], status: ['report'] };
const SHOW = { invoices: ['terms', 'invoice'], quotations: ['quote'], status: ['tools'] };
const shows = k => !mode || SHOW[mode].includes(k);

export function render(c) {
  const { ws, project: p, bill } = c;
  const docs = [...ws.docs].filter(d => !mode || KINDS[mode].includes(d.type)).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  const doc = sel?.kind === 'doc' ? ws.docs.find(d => d.id === sel.id) : null;
  const next = doc && NEXT[doc.type][doc.status];

  const toolbar = html`
    <div class="toolbar no-print">
      ${shows('terms') ? html`<div class="seg">
        <button class="${tab === 'docs' ? 'on' : ''}" data-act="tab" data-t="docs">Documents</button>
        <button class="${tab === 'terms' ? 'on' : ''}" data-act="tab" data-t="terms">Billing terms</button>
      </div>` : ''}
      <span class="muted">${notice}</span>
      <span class="grow"></span>
      ${shows('tools') ? html`<button class="btn" data-act="paySheet" title="Pay sheet from the attendance taken on site">Pay sheet</button>
      <button class="btn" data-act="claim" title="Delays reported from site, by cause and responsible party">Delays</button>
      <button class="btn" data-act="performance" title="Internal weekly or monthly performance">Performance</button>
      <button class="btn" data-act="report">Progress report</button>
      <button class="btn" data-act="schedule">Client schedule</button>` : ''}
      ${shows('quote') ? html`<button class="btn" data-act="newQuote">New quotation</button>` : ''}
      ${shows('invoice') ? html`<button class="btn primary" data-act="newInvoice">New invoice</button>` : ''}
    </div>`;
  if (tab === 'terms' && shows('terms')) return html`${toolbar}${terms(c)}`;

  let preview = html`<p class="empty">Choose a document on the left, or create one with the buttons above.<br>Purchase orders are created from Estimate, Procurement.</p>`;
  if (doc?.type === 'report') {
    const draft = doc.status === 'draft';
    preview = html`
      <div class="toolbar no-print">
        ${chip(doc.status, STATUS_CLS[doc.status])}
        <span class="muted">${!draft ? `Approved by ${doc.approvedBy}. This report can no longer change.`
          : store.canApprove ? 'Check the content, then approve. Approving freezes the report.'
          : 'Waiting for the Admin or an assigned approver.'}</span>
        <span class="grow"></span>
        ${draft ? html`<button class="btn" data-act="refreshReport" title="Rebuild the figures from the latest data, keeping your remarks">Refresh figures</button>` : EMAIL_BUTTON}
        ${draft && store.canApprove ? html`<button class="btn primary" data-act="advance">Approve and issue</button>` : ''}
        ${draft || store.canApprove ? html`<button class="btn danger" data-act="remove">Delete</button>` : ''}
      </div>
      ${emailed(doc)}
      ${draft ? html`<label class="no-print">Remarks to the client
        <textarea data-chg="docField" data-f="remarks" data-fk="d-remarks" rows="3" placeholder="Summary, explanations, decisions needed from the client">${doc.remarks || ''}</textarea></label>` : ''}
      ${reportPaper(c, doc.kind, doc.data, doc)}`;
  } else if (doc) {
    preview = html`
      <div class="toolbar no-print">
        ${chip(doc.status, STATUS_CLS[doc.status])}
        <label class="inline">${DUE[doc.type]} <input type="date" data-chg="docField" data-f="due" data-fk="d-due" value="${doc.due}"></label>
        <span class="grow"></span>
        ${EMAIL_BUTTON}
        ${doc.type === 'invoice' && doc.status === 'sent' ? html`<button class="btn" data-act="remindInvoice" title="Opens a ready-written reminder in your email app, or copies it">${doc.due < c.today ? 'Send payment reminder' : 'Remind before due date'}</button>` : ''}
        ${next ? html`<button class="btn primary" data-act="advance">${next[1]}</button>` : ''}
        <button class="btn danger" data-act="remove">Delete</button>
      </div>
      ${doc.type === 'invoice' && doc.status === 'sent' ? html`<p class="muted no-print">${doc.due < c.today ? `Overdue by ${toDay(c.today) - toDay(doc.due)} days.` : `Due ${fmtFull(doc.due)}.`}
        ${doc.reminders?.length ? `Reminded ${doc.reminders.length} time${doc.reminders.length > 1 ? 's' : ''}, last on ${fmtFull(doc.reminders.at(-1))}.` : 'No reminder sent yet.'}</p>` : ''}
      ${emailed(doc)}
      <label class="no-print">Notes shown on the document
        <textarea data-chg="docField" data-f="notes" data-fk="d-notes" rows="2" placeholder="Payment terms, delivery address, scope notes">${doc.notes}</textarea></label>
      ${doc.type === 'quote' && doc.status === 'draft' ? html`<div class="card no-print"><h3>Lines</h3>
        <table class="table compact">
          <thead><tr><th>Description</th><th class="r">Qty</th><th>Unit</th><th class="r">Rate</th><th class="r">Amount</th><th></th></tr></thead>
          <tbody>${doc.lines.map((l, i) => html`<tr>
            <td><input data-chg="qLine" data-i="${i}" data-f="description" data-fk="ql-d-${i}" value="${l.description}" placeholder="What is quoted" aria-label="Description"></td>
            <td class="r"><input type="number" step="any" data-chg="qLine" data-i="${i}" data-f="qty" data-fk="ql-q-${i}" value="${l.qty}" style="width:80px" aria-label="Quantity"></td>
            <td><input data-chg="qLine" data-i="${i}" data-f="unit" data-fk="ql-u-${i}" value="${l.unit}" placeholder="pcs" style="width:70px" aria-label="Unit"></td>
            <td class="r"><input type="number" step="any" data-chg="qLine" data-i="${i}" data-f="rate" data-fk="ql-r-${i}" value="${l.rate}" style="width:110px" aria-label="Rate"></td>
            <td class="r">${num(l.amount)}</td>
            <td><button class="btn ghost small" data-act="dropQLine" data-i="${i}" aria-label="Remove line">×</button></td>
          </tr>`)}</tbody>
        </table>
        <button class="btn" data-act="addQLine">+ Add line</button></div>` : ''}
      ${docPaper(doc, c)}`;
  } else if (sel?.kind === 'report') {
    preview = html`
      <div class="toolbar no-print">
        <div class="seg">${Object.entries(PERIODS).map(([k, [label]]) => html`<button class="${period === k ? 'on' : ''}" data-act="period" data-k="${k}">${label}</button>`)}</div>
        <label class="inline">Up to <input type="date" data-chg="endDate" data-fk="r-end" value="${endDate || c.today}" max="${c.today}"></label>
        <span class="muted">Live preview</span>
        <span class="grow"></span>
        <button class="btn primary" data-act="createReport">Create client report</button>
      </div>
      ${reportPaper(c, period, reportSnapshot(c, ...liveRange(c)))}`;
  } else if (sel?.kind === 'pay' || sel?.kind === 'claim') {
    preview = html`
      <div class="toolbar no-print">
        <div class="seg">${['weekly', 'monthly'].map(k => html`<button class="${period === k ? 'on' : ''}" data-act="period" data-k="${k}">${PERIODS[k][0]}</button>`)}</div>
        <label class="inline">Up to <input type="date" data-chg="endDate" data-fk="r-end" value="${endDate || c.today}" max="${c.today}"></label>
        <span class="grow"></span>
        ${EMAIL_BUTTON}
      </div>
      ${sel.kind === 'pay' ? payPaper(c) : claimPaper(c)}`;
  } else if (sel?.kind === 'performance') {
    preview = html`
      <div class="toolbar no-print">
        <div class="seg">${['weekly', 'monthly'].map(k => html`<button class="${period === k ? 'on' : ''}" data-act="period" data-k="${k}">${PERIODS[k][0]}</button>`)}</div>
        <label class="inline">Up to <input type="date" data-chg="endDate" data-fk="r-end" value="${endDate || c.today}" max="${c.today}"></label>
        <span class="grow"></span>
        ${EMAIL_BUTTON}
      </div>
      ${performancePaper(c)}`;
  } else if (sel?.kind === 'schedule') {
    preview = html`<div class="toolbar no-print"><span class="muted">Schedule as it stands today</span><span class="grow"></span>${EMAIL_BUTTON}</div>${schedulePaper(c)}`;
  }

  return html`
    ${toolbar}
    <section class="card no-print">
      <dl class="facts narrow">
        <dt>Contract value</dt><dd>${money(p.contractValue, p.currency)}</dd>
        <dt>Invoiced</dt><dd>${money(bill.invoiced, p.currency)}</dd>
        <dt>Awaiting payment</dt><dd>${money(bill.outstanding, p.currency)}</dd>
        <dt>Received</dt><dd>${money(bill.received, p.currency)}</dd>
      </dl>
      ${docs.length ? html`<ul class="list">${docs.map(d => html`
        <li><button class="row pick ${doc === d ? 'sel' : ''}" data-act="open" data-id="${d.id}">
          <span class="row-main"><b>${d.number}</b><span class="muted">${TITLE[d.type]}, ${d.party.name || 'no name'}, ${fmtDate(d.date)}</span></span>
          <span class="row-end"><span>${d.type === 'report' ? PERIODS[d.kind][0] : money(d.amountDue, p.currency)}</span>${chip(d.status, STATUS_CLS[d.status])}</span>
        </button></li>`)}</ul>` : html`<p class="empty">No documents yet.</p>`}
    </section>
    <section class="card sheet" data-scroll="sheet">${preview}</section>`;
}

const current = ws => ws.docs.find(d => d.id === sel?.id);

export const actions = {
  tab(el) { tab = el.dataset.t; notice = ''; },
  open(el) { sel = { kind: 'doc', id: el.dataset.id }; notice = ''; },
  report() { tab = 'docs'; sel = { kind: 'report' }; notice = ''; },
  schedule() { tab = 'docs'; sel = { kind: 'schedule' }; notice = ''; },
  paySheet() { tab = 'docs'; sel = { kind: 'pay' }; if (period === 'daily') period = 'weekly'; notice = ''; },
  claim() { tab = 'docs'; sel = { kind: 'claim' }; if (period === 'daily') period = 'monthly'; notice = ''; },
  performance() { tab = 'docs'; sel = { kind: 'performance' }; if (period === 'daily') period = 'weekly'; notice = ''; },

  /** Saves the previewed progress report as a draft client report: a frozen copy waiting for approval. */
  createReport(el, c) {
    const [from, to] = liveRange(c);
    const doc = {
      id: uid('d'), type: 'report', kind: period, number: nextNumber(c.ws.docs, 'report', c.project), date: c.today, due: '',
      status: 'draft', party: { name: '', address: '', contact: '', taxId: '', ...c.project.client },
      period: { from, to }, remarks: '', data: reportSnapshot(c, from, to), lines: [], subtotal: 0, amountDue: 0,
    };
    store.update(ws => ws.docs.push(doc));
    sel = { kind: 'doc', id: doc.id };
    notice = `${doc.number} saved as a draft for approval.`;
  },
  refreshReport(el, c) {
    if (current(c.ws)?.status !== 'draft') return;
    store.update(ws => { const doc = current(ws); doc.data = reportSnapshot(c, doc.period.from, doc.period.to); });
    notice = 'Figures refreshed from the latest data.';
  },
  omitLine(el) {
    store.update(ws => { const doc = current(ws); if (doc?.status === 'draft') doc.data[el.dataset.k].splice(+el.dataset.i, 1); });
  },
  period(el) { period = el.dataset.k; },

  newInvoice(el, c) {
    const { lines, period: span, why } = invoiceLines(c);
    if (!lines.length) { notice = why; return; }
    const doc = makeDoc({
      type: 'invoice', project: c.project, docs: c.ws.docs, today: c.today, lines, period: span,
      party: c.project.client, retentionPct: c.bill.retention, due: fromDay(toDay(c.today) + c.bill.paymentDays),
    });
    store.update(ws => ws.docs.push(doc));
    tab = 'docs'; sel = { kind: 'doc', id: doc.id }; notice = `${doc.number} created as a draft.`;
  },
  newQuote(el, c) {
    const doc = makeDoc({
      type: 'quote', project: c.project, docs: c.ws.docs, today: c.today, lines: [{ description: '', qty: 1, unit: '', rate: 0, amount: 0 }],
      party: c.project.client, due: fromDay(toDay(c.today) + QUOTE_VALID_DAYS),
    });
    store.update(ws => ws.docs.push(doc));
    tab = 'docs'; sel = { kind: 'doc', id: doc.id }; notice = `${doc.number} created as a draft.`;
  },

  /** Moves a document to its next status. A paid invoice is posted to Costs as money received. */
  advance(el, c) {
    const d = current(c.ws);
    const next = d && NEXT[d.type][d.status]?.[0];
    if (!next) return;
    if (d.type === 'report' && !store.canApprove) { notice = 'Only the Admin or an assigned approver can issue a client report.'; return; }
    store.update(ws => {
      const doc = current(ws);
      doc.status = next;
      if (doc.type === 'report') Object.assign(doc, { approvedBy: store.signature, approvedAt: c.today });
      if (doc.type === 'invoice' && next === 'paid') {
        doc.ledgerId = uid('l');
        ws.ledger.push({
          id: doc.ledgerId, date: c.today, type: 'income', category: 'overhead', vendor: doc.party.name,
          description: `Payment received, ${doc.number}`, amount: Math.round(doc.amountDue * 100) / 100, currency: c.project.currency,
        });
      }
      if (doc.type === 'po' && next === 'delivered') {
        for (const l of doc.lines) if (l.materialId) ws.procurement[l.materialId] = { ...ws.procurement[l.materialId], status: 'delivered' };
      }
    });
  },
  /** Email the document on screen: the dialog opens with the client's address and a covering note, both editable. */
  email(el, c) {
    const paper = document.querySelector('#view .paper');
    if (!paper) return;
    const d = current(c.ws);
    const p = c.project;
    const sender = c.global.company?.name || 'Amistad Prefab';
    const kind = d ? TITLE[d.type] : { schedule: 'Project schedule', pay: 'Site pay sheet', claim: 'Record of delays' }[sel?.kind] || 'Performance report';
    const name = d ? `${kind} ${d.number}` : `${kind}, ${p.name}`;
    const who = d?.party?.name || p.client?.name || '';
    const line = !d ? `Please find attached the ${kind.toLowerCase()} for ${p.name} as of ${fmtFull(c.today)}.`
      : d.type === 'invoice' ? `Please find attached invoice ${d.number} for ${money(d.amountDue, p.currency, 2)}, due on ${fmtFull(d.due)}.`
      : d.type === 'quote' ? `Please find attached our quotation ${d.number} for ${p.name}, valid until ${fmtFull(d.due)}.`
      : d.type === 'po' ? `Please find attached purchase order ${d.number} for ${p.name}. Kindly confirm receipt and the delivery date.`
      : `Please find attached progress report ${d.number} for ${p.name}, covering ${fmtFull(d.period.from)} to ${fmtFull(d.period.to)}.`;
    openMail({
      // an internal report goes to nobody by default
      to: ['performance', 'pay'].includes(sel?.kind) ? '' : emailIn(d?.party?.contact) || emailIn(p.client?.contact),
      subject: `${name}, ${p.name}`,
      message: `Dear ${who || 'Sir or Madam'},\n\n${line}\n\nPlease let us know if you have any questions.\n\nKind regards,\n${store.signature}\n${sender}`,
      filename: name.replace(/[\\/:*?"<>|]/g, '-'),
      getHtml: () => paperHtml(paper, name),
      sheet: () => paper,
      onSent({ to }) {
        notice = `Sent to ${to}.`;
        // the record of who it went to is kept on saved documents (an issued report can only be changed by an approver)
        if (d && (d.type !== 'report' || d.status !== 'issued' || store.canApprove)) {
          store.update(ws => { const doc = ws.docs.find(x => x.id === d.id); if (doc) doc.emails = [...(doc.emails || []), { at: c.today, to }]; });
        } else {
          store.notify();
        }
      },
    });
  },

  /** A ready-written payment reminder: an email draft when the client's contact is an address, otherwise copied text. Each one is logged on the invoice. */
  remindInvoice(el, c) {
    const d = current(c.ws);
    if (d?.type !== 'invoice' || d.status !== 'sent') return;
    const late = toDay(c.today) - toDay(d.due);
    const amount = money(d.amountDue, c.project.currency, 2);
    const subject = `${late > 0 ? 'Payment overdue' : 'Payment reminder'}: invoice ${d.number}, ${c.project.name}`;
    const body = `Dear ${d.party.name || 'Sir or Madam'},

`
      + (late > 0 ? `Our invoice ${d.number} of ${fmtFull(d.date)} for ${amount} was due on ${fmtFull(d.due)} and is now ${late} day${late === 1 ? '' : 's'} overdue.`
        : `This is a reminder that our invoice ${d.number} of ${fmtFull(d.date)} for ${amount} is due on ${fmtFull(d.due)}.`)
      + `

Project: ${c.project.name}

Please let us know when we can expect payment. If it has already been made, please ignore this message.

Thank you.
${store.signature}`;
    const to = (d.party.contact || '').includes('@') ? d.party.contact : '';
    if (to) {
      location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      notice = 'Reminder drafted in your email app.';
    } else {
      navigator.clipboard?.writeText(`${subject}

${body}`).catch(() => {});
      notice = 'Reminder text copied. The client has no email address on this invoice.';
    }
    store.update(ws => { const doc = current(ws); doc.reminders = [...(doc.reminders || []), c.today]; });
  },
  remove(el, c) {
    const d = current(c.ws);
    if (!d) return;
    if (d.type === 'report' && d.status === 'issued' && !store.canApprove) { notice = 'An issued report can only be deleted by the Admin or an assigned approver.'; return; }
    const question = d.type === 'po' ? `Delete ${d.number}? Materials on it that have not been delivered go back to "Not ordered".`
      : d.type !== 'invoice' ? `Delete ${d.number}?`
      : d.status === 'paid' ? `Delete ${d.number}? It is marked as paid: the payment received is also taken out of Costs.`
      : `Delete ${d.number}? Anything it invoiced becomes available to invoice again.`;
    if (!confirm(question)) return;
    store.update(ws => {
      ws.docs = ws.docs.filter(x => x.id !== d.id);
      // what the document caused elsewhere goes with it
      if (d.ledgerId) ws.ledger = ws.ledger.filter(l => l.id !== d.ledgerId);
      if (d.type === 'po') {
        for (const [id, line] of Object.entries(ws.procurement)) {
          if (line.poId !== d.id) continue;
          const { poId, ...rest } = line;
          ws.procurement[id] = rest.status === 'ordered' ? { ...rest, status: 'not_ordered' } : rest;
        }
      }
    });
    sel = null;
  },

  removeStage(el) { store.update(ws => { ws.payStages = ws.payStages.filter(s => s.id !== el.dataset.id); }); },
  removeMeasure(el) { store.update(ws => { ws.measure = ws.measure.filter(m => m.id !== el.dataset.id); }); },
  /** A draft quotation is typed line by line. */
  addQLine() { store.update(ws => { const d = current(ws); if (d && d.type === 'quote' && d.status === 'draft') d.lines.push({ description: '', qty: 1, unit: '', rate: 0, amount: 0 }); }); },
  dropQLine(el) { store.update(ws => { const d = current(ws); if (!d || d.status !== 'draft') return; d.lines.splice(+el.dataset.i, 1); Object.assign(d, docTotals(d.lines, d.vatPct, d.retentionPct)); }); },
};

export const changes = {
  endDate(el) { endDate = el.value; },
  qLine(el) {
    store.update(ws => {
      const d = current(ws), l = d?.lines[+el.dataset.i];
      if (!l || d.type !== 'quote' || d.status !== 'draft') return;
      const f = el.dataset.f;
      l[f] = f === 'qty' || f === 'rate' ? (+el.value || 0) : el.value;
      l.amount = Math.round((l.qty || 0) * (l.rate || 0) * 100) / 100;
      Object.assign(d, docTotals(d.lines, d.vatPct, d.retentionPct));
    });
  },
  docField(el) { store.update(ws => { const d = current(ws); if (d && (el.dataset.f !== 'due' || el.value)) d[el.dataset.f] = el.value; }); },
  client(el) { store.updateProject(p => { p.client = { ...p.client, [el.dataset.f]: el.value.trim() }; }); },
  billing(el) {
    const f = el.dataset.f;
    let v = field(el);
    if (f === 'retention') v = clamp(v, 0, 100);
    else if (f === 'paymentDays') v = Math.max(0, Math.round(v));
    else if (f === 'otMultiplier') v = Math.max(1, v);
    else if (f === 'hoursPerDay') v = clamp(v || 8, 1, 24);
    store.updateProject(p => { p.billing = { ...p.billing, [f]: v }; });
  },
  contract(el) { store.updateProject(p => { p.contractValue = Math.max(0, field(el)); }); },
  vat(el) { store.updateProject(p => { p.markups.vat = Math.max(0, field(el)); }); },
  stage(el) {
    const f = el.dataset.f;
    const v = field(el);
    store.update(ws => {
      const s = ws.payStages.find(x => x.id === el.dataset.id);
      s[f] = f === 'value' ? Math.max(0, v) : f === 'name' ? v.trim() || s.name : v;
    });
  },
  measure(el) { store.update(ws => { ws.measure.find(m => m.id === el.dataset.id)[el.dataset.f] = Math.max(0, field(el)); }); },
  billRate(el) { store.update(ws => { ws.billRates[el.dataset.t] = Math.max(0, field(el)); }); },
};

export const submits = {
  stage(fd) {
    store.update(ws => ws.payStages.push({ id: uid('s'), name: fd.get('name').trim(), taskId: '', value: Math.max(0, +fd.get('value') || 0) }));
  },
  measure(fd) {
    store.update(ws => ws.measure.push({
      id: uid('q'), description: fd.get('description').trim(), unit: fd.get('unit').trim(),
      contractQty: Math.max(0, +fd.get('contractQty') || 0), rate: Math.max(0, +fd.get('rate') || 0), doneQty: 0,
    }));
  },
};
