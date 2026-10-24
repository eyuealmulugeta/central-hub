// Payroll: one run a month, one line per employee, worked out from the HR agreement and the attendance
// taken on site. Draft, then approved (locked), then paid. Prints as a payroll sheet, each person gets
// a payslip to print or email, and a CSV goes to the accountant. Admin only: it is built from HR pay.

import { store } from '../core/store.js';
import {
  DEFAULT_SETTINGS, statusLabel, monthLabel, newLines, newLine, attendanceFor, compute, totals, warnings, csvRows,
} from '../engine/payroll.js';
import { uid, money, fmtFull, toCSV, downloadText } from '../core/util.js';
import { paperHtml } from '../sync/mail.js';
import { html, options, chip } from './dom.js';
import { stamp } from '../core/division.js';
import { letterhead } from './docs.js';
import { withFixes } from '../engine/attendance.js';
import { paidOnSite } from '../engine/crewpay.js';
import { SITE_DEPARTMENTS, normDepartment } from '../engine/positions.js';
import { openMail, emailIn } from './maildialog.js';
// the attendance as the office corrected it on the Attendance sheet
const sheetReports = c => withFixes(c.ws.reports, c.ws.attendance);
// site crew of a project that pays through Payments is paid there, not here
const onSitePay = p => paidOnSite(p, store.projects, d => SITE_DEPARTMENTS.includes(normDepartment(d)));

let selected = null;      // run id
let slip = null;          // line id of the payslip being shown
let notice = '';

const find = company => company.payroll.find(r => r.id === selected);
/** Open one run from outside this screen (search). */
export const focusOn = id => { selected = id; };
const m = (v, cur) => (cur ? money(v, cur, 2) : Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const PER = { month: 'per month', day: 'per day', hour: 'per hour' };
const todayMonth = today => String(today).slice(0, 7);

export function render(c) {
  const run = find(c.company);
  if (!run) return list(c);
  const line = slip && run.lines.find(l => l.id === slip);
  return line ? payslip(run, line, c) : detail(run, c);
}

function list(c) {
  const runs = [...c.company.payroll].sort((a, b) => b.month.localeCompare(a.month));
  const last = runs[0]?.settings || {};
  const set = { ...DEFAULT_SETTINGS, hoursPerDay: c.bill.hoursPerDay || DEFAULT_SETTINGS.hoursPerDay, otMultiplier: c.bill.otMultiplier || DEFAULT_SETTINGS.otMultiplier, ...last };
  const n = c.company.staff.filter(p => p.status !== 'left').length;
  return html`
    <section class="card">
      <div class="toolbar"><h2>New payroll run</h2><span class="muted">${notice}</span></div>
      <form data-form="newRun">
        <div class="grid2">
          <label>Month <input type="month" name="month" value="${todayMonth(c.today)}" required></label>
          <label>Hours in a working day <input type="number" name="hoursPerDay" min="1" step="any" value="${set.hoursPerDay}"></label>
          <label>Overtime pays x <input type="number" name="otMultiplier" min="1" step="any" value="${set.otMultiplier}"></label>
          <label>Days in a month, for monthly wages <input type="number" name="monthDays" min="1" step="any" value="${set.monthDays}"></label>
          <label>Pension, employee share % of basic <input type="number" name="pensionEmployee" min="0" step="any" value="${set.pensionEmployee}"></label>
          <label>Pension, employer share % of basic <input type="number" name="pensionEmployer" min="0" step="any" value="${set.pensionEmployer}"></label>
        </div>
        <div class="actions left"><button class="btn primary">Start the run</button>
          <span class="muted">${n} ${n === 1 ? 'person' : 'people'} on the staff list. Days and overtime are filled from the daily reports of <b>${c.project.name}</b> (the open project); for people on other projects, type them in.</span></div>
      </form>
      <p class="muted">Income tax is typed per person on the run, from your accountant's table. It is never guessed. Leave the pension at 0 until you have the rates.</p>
    </section>
    <section class="card">
      <h2>Payroll runs</h2>
      ${runs.length ? html`<table class="table">
        <thead><tr><th>Month</th><th class="r">People</th><th class="r">Net pay</th><th>Status</th></tr></thead>
        <tbody>${runs.map(r => html`<tr class="click" data-act="open" data-id="${r.id}">
          <td><button class="link" type="button">${monthLabel(r.month)}</button></td><td class="r">${r.lines.length}</td>
          <td class="r nowrap">${totals(r.lines, r.settings).map(t => m(t.net, t.currency)).join(' · ') || '—'}</td>
          <td>${chip(statusLabel(r.status), r.status === 'paid' ? 'ok' : r.status === 'approved' ? 'info' : 'warn')}</td></tr>`)}</tbody>
      </table>` : html`<p class="empty">No payroll runs yet.</p>`}
    </section>
    <p class="muted">Only you, the Admin, can open this page.</p>`;
}

function detail(run, c) {
  const draft = run.status === 'draft';
  const s = run.settings;
  const tot = totals(run.lines, s);
  const warn = draft ? warnings(run.lines, s) : [];
  const inRun = new Set(run.lines.map(l => l.staffId));
  const addable = c.company.staff.filter(p => !inRun.has(p.id) && p.status !== 'left');
  const num = (l, f, extra = '') => draft
    ? html`<input class="price" type="number" min="0" step="any" data-chg="line" data-id="${l.id}" data-f="${f}" data-fk="pr-${f}-${l.id}" value="${l[f] ?? 0}" ${extra} aria-label="${f} of ${l.name}">`
    : html`${l[f] || 0}`;
  return html`
    <div class="toolbar no-print">
      <button class="btn ghost" data-act="back">← Payroll</button>
      <b>${monthLabel(run.month)}</b> ${chip(statusLabel(run.status), run.status === 'paid' ? 'ok' : run.status === 'approved' ? 'info' : 'warn')}
      <span class="muted">${run.approvedBy ? `Approved by ${run.approvedBy}, ${fmtFull(run.approvedOn)}. ` : ''}${run.paidOn ? `Paid on ${fmtFull(run.paidOn)}.` : ''} ${notice}</span>
      <span class="grow"></span>
      ${draft ? html`<button class="btn" data-act="refill" title="Reads days and overtime again from the daily reports of the open project">Refill attendance</button><button class="btn primary" data-act="approve">Approve</button>` : ''}
      ${run.status === 'approved' ? html`<button class="btn" data-act="reopen">Reopen</button><button class="btn primary" data-act="markPaid">Mark as paid</button>` : ''}
      <button class="btn" data-act="csv">Download CSV</button>
      <button class="btn" data-act="print">Print</button>
      <button class="btn danger" data-act="removeRun">Delete</button>
    </div>
    ${warn.length ? html`<ul class="plain bad no-print">${warn.map(w => html`<li>${w}</li>`)}</ul>` : ''}
    <section class="card no-print">
      <div class="grid4">
        ${[['hoursPerDay', 'Hours in a day'], ['otMultiplier', 'Overtime x'], ['monthDays', 'Days in a month'], ['pensionEmployee', 'Pension, employee %'], ['pensionEmployer', 'Pension, employer %']].map(([k, label]) => html`
          <label>${label} ${draft ? html`<input type="number" min="0" step="any" data-chg="setting" data-f="${k}" data-fk="ps-${k}" value="${s[k]}">` : html`<b>${s[k]}</b>`}</label>`)}
      </div>
      <div style="overflow-x:auto"><table class="table compact">
        <thead><tr><th>Employee</th><th>Pay</th><th class="r">Days worked</th><th class="r">Overtime h</th><th class="r">Unpaid days</th><th class="r">Allowances</th><th class="r">Income tax</th><th class="r">Other deductions</th><th class="r">Net pay</th><th></th></tr></thead>
        <tbody>${run.lines.map(l => {
          const r = compute(l, s);
          return html`<tr>
            <td><b>${l.name}</b><br><span class="muted">${l.title || ''}</span>${l.fromAttendance ? html` ${chip('attendance', 'ok')}` : ''}</td>
            <td class="nowrap">${m(l.rate, l.currency)}<br><span class="muted">${PER[l.payPer] || ''}</span></td>
            <td class="r">${num(l, 'days')}</td><td class="r">${num(l, 'ot')}</td>
            <td class="r">${l.payPer === 'month' ? num(l, 'unpaidDays') : html`<span class="muted">—</span>`}</td>
            <td class="r">${num(l, 'allowances')}</td><td class="r">${num(l, 'tax')}</td><td class="r">${num(l, 'other')}</td>
            <td class="r nowrap"><b>${m(r.net, l.currency)}</b></td>
            <td class="r nowrap"><button class="btn small" data-act="slip" data-id="${l.id}">Payslip</button>${draft ? html` <button class="btn ghost small" data-act="cutLine" data-id="${l.id}">Take out</button>` : ''}</td></tr>`;
        })}</tbody>
      </table></div>
      ${draft && addable.length ? html`<form data-form="addPerson" class="entry">
        <select name="staffId" aria-label="Add a person">${options(addable.map(p => [p.id, p.title ? `${p.name}, ${p.title}` : p.name]), null)}</select>
        <button class="btn">Add to this run</button></form>` : ''}
    </section>
    <section class="card sheet"><div class="paper">
      ${letterhead(c, 'Payroll', [['Month', monthLabel(run.month)], ['Status', statusLabel(run.status)], ['People', String(run.lines.length)]])}
      <table style="margin-top:12px"><thead><tr><th>Employee</th><th class="r">Basic</th><th class="r">Overtime</th><th class="r">Allow.</th><th class="r">Gross</th><th class="r">Pension</th><th class="r">Tax</th><th class="r">Other</th><th class="r">Net pay</th></tr></thead>
        <tbody>${run.lines.map(l => { const r = compute(l, s); return html`<tr><td>${l.name}<br><span class="muted">${l.title || ''} · ${l.currency}</span></td>
          <td class="r">${m(r.basic)}</td><td class="r">${m(r.overtime)}</td><td class="r">${m(r.allowances)}</td><td class="r">${m(r.gross)}</td>
          <td class="r">${m(r.pensionEmployee)}</td><td class="r">${m(r.tax)}</td><td class="r">${m(r.other)}</td><td class="r"><b>${m(r.net)}</b></td></tr>`; })}</tbody></table>
      <h3>Totals, by currency</h3>
      <table><thead><tr><th>Currency</th><th class="r">People</th><th class="r">Gross</th><th class="r">Deductions</th><th class="r">Net pay</th><th class="r">Employer pension</th><th class="r">Cost to company</th></tr></thead>
        <tbody>${tot.map(t => html`<tr><td>${t.currency || '—'}</td><td class="r">${t.people}</td><td class="r">${m(t.gross)}</td><td class="r">${m(t.gross - t.net)}</td><td class="r"><b>${m(t.net)}</b></td><td class="r">${m(t.pensionEmployer)}</td><td class="r">${m(t.cost)}</td></tr>`)}</tbody></table>
      <p class="muted p-notes">Overtime is paid at ${s.otMultiplier} x the hourly rate, with a working day of ${s.hoursPerDay} hours${s.pensionEmployee || s.pensionEmployer ? `. Pension: ${s.pensionEmployee}% employee, ${s.pensionEmployer}% employer, on basic pay` : ''}.</p>
      <div class="p-sign"><div>Prepared by</div><div>Approved by${run.approvedBy ? `: ${run.approvedBy}` : ''}</div></div>
    </div></section>`;
}

function payslip(run, l, c) {
  const r = compute(l, run.settings);
  const row = (k, v) => (v ? html`<tr><td>${k}</td><td class="r">${m(v, l.currency)}</td></tr>` : '');
  return html`
    <div class="toolbar no-print">
      <button class="btn ghost" data-act="slipBack">← ${monthLabel(run.month)}</button>
      <span class="muted">${notice}</span><span class="grow"></span>
      <button class="btn" data-act="emailSlip">Email as PDF</button>
      <button class="btn" data-share title="Send this document as a PDF file on WhatsApp or Telegram">WhatsApp / Telegram</button>
      <button class="btn primary" data-act="print">Print</button>
    </div>
    <section class="card sheet"><div class="paper">
      ${letterhead(c, 'Payslip', [['Employee', l.name], ['Job title', l.title || '—'], ['Month', monthLabel(run.month)], ['Status', statusLabel(run.status)]])}
      <h3>Earnings</h3>
      <table><tbody>
        <tr><td>${l.payPer === 'month' ? 'Monthly wage' : l.payPer === 'day' ? `${l.days} days at ${m(l.rate, l.currency)}` : `${l.days} days of ${run.settings.hoursPerDay} hours at ${m(l.rate, l.currency)} per hour`}${l.unpaidDays ? ` (${l.unpaidDays} unpaid days taken off)` : ''}</td><td class="r">${m(r.basic, l.currency)}</td></tr>
        ${row(`Overtime, ${l.ot} hours`, r.overtime)}${row('Allowances', r.allowances)}
        <tr class="group"><td>Gross pay</td><td class="r">${m(r.gross, l.currency)}</td></tr>
      </tbody></table>
      <h3>Deductions</h3>
      <table><tbody>
        ${row(`Pension, ${run.settings.pensionEmployee}%`, r.pensionEmployee)}${row('Income tax', r.tax)}${row('Other deductions', r.other)}
        ${r.deductions ? '' : html`<tr><td class="muted">None</td><td></td></tr>`}
      </tbody></table>
      <dl class="totals"><dt>Net pay</dt><dd class="grand">${m(r.net, l.currency)}</dd></dl>
      ${l.notes ? html`<p class="muted p-notes">${l.notes}</p>` : ''}
      <div class="p-sign"><div>Prepared by</div><div>Received by ${l.name}</div></div>
    </div></section>`;
}

export const actions = {
  open(el) { selected = el.dataset.id; slip = null; notice = ''; },
  back() { selected = null; slip = null; notice = ''; },
  slip(el) { slip = el.dataset.id; notice = ''; },
  slipBack() { slip = null; notice = ''; },
  print() { print(); },
  refill(el, c) {
    store.updateCompany(co => {
      const run = find(co);
      if (!run || run.status !== 'draft') return;
      for (const l of run.lines) {
        const staff = co.staff.find(p => p.id === l.staffId);
        if (!staff) continue;
        const a = attendanceFor(sheetReports(c), run.month, staff);
        if (a.found) { l.days = a.days; l.ot = a.ot; l.fromAttendance = true; }
      }
    });
    notice = `Days and overtime read again from the daily reports of ${c.project.name}.`;
  },
  approve(el, c) {
    const run = find(c.company);
    if (!run) return;
    const warn = warnings(run.lines, run.settings);
    if (warn.length && !confirm(`${warn.length} thing${warn.length === 1 ? '' : 's'} to check:\n\n${warn.slice(0, 5).join('\n')}\n\nApprove anyway?`)) return;
    if (!confirm(`Approve the payroll of ${monthLabel(run.month)}? The figures are locked until you reopen it.`)) return;
    store.updateCompany(co => { const r = find(co); r.status = 'approved'; r.approvedBy = store.profile.name || store.user?.name || 'Admin'; r.approvedOn = c.today; });
  },
  reopen() { store.updateCompany(co => { const r = find(co); if (r?.status === 'approved') { r.status = 'draft'; r.approvedBy = ''; r.approvedOn = ''; } }); },
  markPaid(el, c) {
    if (!confirm('Mark this payroll as paid? It can no longer be reopened.')) return;
    store.updateCompany(co => { const r = find(co); if (r?.status === 'approved') { r.status = 'paid'; r.paidOn = c.today; } });
  },
  csv(el, c) {
    const run = find(c.company);
    if (run) downloadText(`Payroll ${run.month}.csv`, toCSV(csvRows(run)), 'text/csv');
  },
  cutLine(el) { store.updateCompany(co => { const r = find(co); if (r?.status === 'draft') r.lines = r.lines.filter(l => l.id !== el.dataset.id); }); },
  emailSlip(el, c) {
    const run = find(c.company);
    const l = run?.lines.find(x => x.id === slip);
    if (!l) return;
    const staff = c.company.staff.find(p => p.id === l.staffId);
    const name = `Payslip ${monthLabel(run.month)}, ${l.name}`.replace(/[\\/:*?"<>|]/g, '-');
    openMail({
      to: emailIn(staff?.privateEmail) || emailIn(staff?.email),
      subject: `Payslip for ${monthLabel(run.month)}`,
      message: `Dear ${l.name},\n\nPlease find attached your payslip for ${monthLabel(run.month)}.\n\nKind regards,\n${store.signature}\n${c.global.company?.name || 'Amistad Prefab'}`,
      filename: name,
      getHtml: () => paperHtml(document.querySelector('.paper'), name),
      sheet: () => document.querySelector('.paper'),
      onSent({ to }) { notice = `Sent to ${to}.`; store.notify(); },
    });
  },
  removeRun(el, c) {
    const run = find(c.company);
    if (!run || !confirm(`Delete the payroll run of ${monthLabel(run.month)}? A paid run should be kept as a record.`)) return;
    store.updateCompany(co => { co.payroll = co.payroll.filter(r => r.id !== run.id); });
    selected = null; slip = null;
  },
};

export const changes = {
  setting(el) {
    const f = el.dataset.f;
    store.updateCompany(co => { const r = find(co); if (r?.status === 'draft') r.settings[f] = Math.max(0, +el.value || 0); });
  },
  line(el) {
    const f = el.dataset.f;
    store.updateCompany(co => { const l = find(co)?.status === 'draft' && find(co).lines.find(x => x.id === el.dataset.id); if (l) { l[f] = Math.max(0, +el.value || 0); if (f === 'days' || f === 'ot') l.fromAttendance = false; } });
  },
};

export const submits = {
  newRun(fd, c) {
    const month = String(fd.get('month') || '');
    if (!/^\d{4}-\d{2}$/.test(month)) { notice = 'Choose the month.'; return false; }
    const existing = c.company.payroll.find(r => r.month === month);
    if (existing) { notice = `There is already a payroll run for ${monthLabel(month)}. Open it, or delete it first.`; return false; }
    const settings = {};
    for (const k of Object.keys(DEFAULT_SETTINGS)) settings[k] = Math.max(0, +fd.get(k) || 0) || (k.startsWith('pension') ? 0 : DEFAULT_SETTINGS[k]);
    const run = {
      id: uid('pr'), month, ...stamp(), status: 'draft', settings, createdOn: c.today, approvedBy: '', approvedOn: '', paidOn: '',
      lines: newLines(c.company.staff.filter(p => !onSitePay(p)), month, sheetReports(c)),
    };
    const left = c.company.staff.filter(onSitePay).length;
    if (!run.lines.length) { notice = 'Nobody on the staff list was employed in that month. Add people under HR first.'; return false; }
    store.updateCompany(co => co.payroll.push(run));
    selected = run.id; slip = null; notice = left ? `${left} site crew left out: they are paid under Finance, Payments.` : '';
  },
  addPerson(fd, c) {
    const run = find(c.company);
    const staff = c.company.staff.find(p => p.id === fd.get('staffId'));
    if (!run || !staff || run.status !== 'draft') return false;
    store.updateCompany(co => { const r = find(co); r.lines.push(newLine(staff, r.month, sheetReports(c))); });
  },
};
