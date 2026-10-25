// The printed pay sheets of a pay period (v0.21.2, docs/plan-print-pay.md): the site pay sheet for the daily crew,
// with a "Received by" column for a signature or thumbprint when cash is paid on site, and the monthly staff with the
// labour cost by trade on a page of their own (office only), so the crew's sheet never shows a salary.

import { money, fmtFull } from '../core/util.js';
import { html } from './dom.js';
import { docHead, docFoot, footText, signoff } from './print.js';
import { docRef } from '../engine/docref.js';
import { splitLines, labourByTrade, STATUS_LABEL } from '../engine/crewpay.js';

/** Money per currency, as "ETB 12,000 + USD 300". */
export function byCurrency(lines, f) {
  const sums = new Map();
  for (const l of lines) sums.set(l.currency, (sums.get(l.currency) || 0) + (+l[f] || 0));
  return [...sums].filter(([, v]) => Math.abs(v) > 0.004).map(([cur, v]) => money(v, cur, 2)).join(' + ') || '–';
}
const totalOf = t => Object.entries(t).filter(([, v]) => Math.abs(v) > 0.004).map(([cur, v]) => money(v, cur, 2)).join(' + ') || '–';
const amt = (v, cur) => (Math.abs(+v || 0) > 0.004 ? money(v, cur, 2) : '');
const pct = v => (v == null ? '' : `${Math.round(v)} %`);

/** The reference of a period's sheet: AP-CHB-PAY-2026-10-16-B (B for the crew, M for the monthly staff). */
export const payRef = (c, p, part) => docRef({ company: c.global.company, project: c.project, type: 'PAY', key: `${p.from.slice(0, 7)}${p.kind === 'monthly' ? '' : `-${p.from.slice(8)}`}-${part}` });

const sign = labels => signoff(labels.map(label => ({ label })));

/** The daily crew's site pay sheet. */
export function crewSheet(c, p, lines, status) {
  const { crew } = splitLines(lines);
  const ot = c.project.billing?.otMultiplier || 1.5;
  const ref = payRef(c, p, 'B');
  const foot = footText(c, 'Site pay sheet', ref, { note: 'confidential' });
  return html`<div class="paper pay-print dsr land" data-foot="${foot}">
    ${docHead(c, { title: 'Site pay sheet · daily crew', sub: p.label, ref, status: STATUS_LABEL[status], tone: status === 'draft' ? 'warn' : 'ok', facts: [['Project', c.project.name], ['Pay period', p.label], ['People', String(crew.length)], ['Due this period', byCurrency(crew, 'due')]] })}
    ${crew.length ? html`<table class="pay-t">
      <thead><tr><th class="r">No.</th><th>Name</th><th>Trade</th><th class="r">Days</th><th class="r">OT h</th><th class="r">Day rate</th><th class="r">Earned</th><th class="r">Adjust</th><th class="r">Brought fwd</th><th class="r">Due</th><th class="r">Paid</th><th class="r">Outstanding</th><th class="pay-rcv">Received by (signature or thumbprint)</th></tr></thead>
      <tbody>${crew.map((l, i) => html`<tr>
        <td class="r muted">${i + 1}</td><td><b>${l.name}</b></td><td>${l.role || ''}</td>
        <td class="r">${l.present || ''}</td><td class="r">${l.ot || ''}</td>
        <td class="r nowrap">${l.wage > 0 ? money(l.wage, l.currency, 2) : html`<span class="bad">none</span>`}</td>
        <td class="r nowrap">${amt(l.earned, l.currency)}</td><td class="r nowrap">${amt(l.adjust, l.currency)}</td><td class="r nowrap">${amt(l.brought, l.currency)}</td>
        <td class="r nowrap"><b>${money(l.due, l.currency, 2)}</b></td><td class="r nowrap">${amt(l.paid, l.currency)}</td><td class="r nowrap">${amt(l.outstanding, l.currency)}</td>
        <td class="pay-rcv"></td></tr>`)}</tbody>
      <tfoot><tr><td colspan="3"><b>Total, ${crew.length} people</b></td><td class="r">${crew.reduce((s, l) => s + (+l.present || 0), 0)}</td><td class="r">${crew.reduce((s, l) => s + (+l.ot || 0), 0) || ''}</td><td></td>
        <td class="r nowrap">${byCurrency(crew, 'earned')}</td><td class="r nowrap">${byCurrency(crew, 'adjust')}</td><td class="r nowrap">${byCurrency(crew, 'brought')}</td>
        <td class="r nowrap"><b>${byCurrency(crew, 'due')}</b></td><td class="r nowrap">${byCurrency(crew, 'paid')}</td><td class="r nowrap"><b>${byCurrency(crew, 'outstanding')}</b></td><td></td></tr></tfoot>
    </table>
    <p class="muted p-notes">Earned: days present x day rate, plus overtime hours at ${ot} times the hourly rate, from the approved Attendance sheet. Adjust: an advance or deduction (minus), or a bonus. Brought forward: still owed from earlier periods.</p>
    ${sign(['Prepared by', 'Checked by · Project engineer', 'Approved by · Office', 'Paid by · Cashier'])}`
    : html`<p class="empty">No daily-paid crew in ${p.label}.</p>`}
    ${docFoot(foot)}
  </div>`;
}

/** The monthly staff, and the labour cost of the period by trade against the project's labour budget. Office only. */
export function staffSheet(c, p, lines, status, paidToDate) {
  const { crew, staff } = splitLines(lines);
  const cost = labourByTrade(lines);
  const budget = +c.project.labourBudget || 0;
  const cur = c.project.currency;
  const used = budget > 0 ? (paidToDate || 0) / budget * 100 : null;
  const ref = payRef(c, p, 'M');
  const foot = footText(c, 'Monthly staff and labour cost', ref, { note: 'confidential, office only' });
  return html`<div class="paper pay-print dsr land" data-foot="${foot}">
    ${docHead(c, { title: 'Monthly staff and labour cost', sub: `${p.label} · office only`, ref, status: STATUS_LABEL[status], tone: status === 'draft' ? 'warn' : 'ok', facts: [['Project', c.project.name], ['Monthly staff', String(staff.length)], ['Daily crew', String(crew.length)], ['Labour cost this period', totalOf(cost.total)],
      ['Labour budget', budget > 0 ? `${money(budget, cur, 2)}, ${pct(used)} paid to date` : 'not set']] })}
    <h3 class="pay-k">Monthly staff <span class="muted">paid by the month, by position</span></h3>
    ${staff.length ? html`<table class="pay-t">
      <thead><tr><th>Name</th><th>Position</th><th>Wage from</th><th class="r">Monthly wage</th><th class="r">Days present</th><th class="r">Absent</th><th class="r">Earned</th><th class="r">Adjust</th><th class="r">Brought fwd</th><th class="r">Due</th><th class="r">Paid</th><th class="r">Outstanding</th></tr></thead>
      <tbody>${staff.map(l => html`<tr>
        <td><b>${l.name}</b></td><td>${l.role || ''}</td><td class="muted">${l.from === 'missing' ? 'missing' : l.from === 'agreement' ? 'HR agreement' : l.from === 'project' ? 'this project' : l.from || ''}</td>
        <td class="r nowrap">${l.wage > 0 ? money(l.wage, l.currency, 2) : html`<span class="bad">missing</span>`}</td>
        <td class="r">${l.present || ''}</td><td class="r">${l.absent || ''}</td>
        <td class="r nowrap">${amt(l.earned, l.currency)}</td><td class="r nowrap">${amt(l.adjust, l.currency)}</td><td class="r nowrap">${amt(l.brought, l.currency)}</td>
        <td class="r nowrap"><b>${money(l.due, l.currency, 2)}</b></td><td class="r nowrap">${amt(l.paid, l.currency)}</td><td class="r nowrap">${amt(l.outstanding, l.currency)}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="6"><b>Total monthly staff</b></td><td class="r nowrap">${byCurrency(staff, 'earned')}</td><td class="r nowrap">${byCurrency(staff, 'adjust')}</td><td class="r nowrap">${byCurrency(staff, 'brought')}</td>
        <td class="r nowrap"><b>${byCurrency(staff, 'due')}</b></td><td class="r nowrap">${byCurrency(staff, 'paid')}</td><td class="r nowrap"><b>${byCurrency(staff, 'outstanding')}</b></td></tr></tfoot>
    </table>
    <p class="muted p-notes">Attendance is taken for everyone. For monthly staff it is kept for the record and does not change the pay. Earned is the period's share of the month's wage.</p>`
    : html`<p class="empty">No monthly-paid staff on this project in ${p.label}.</p>`}
    <h3 class="pay-k">Labour cost by trade <span class="muted">${p.label}, earned plus adjustments</span></h3>
    ${cost.groups.length ? html`<table class="pay-t">
      <thead><tr><th>Trade or position</th><th>Paid</th><th class="r">People</th><th class="r">Man-days</th><th class="r">OT h</th><th class="r">Cost</th><th class="r">Share</th></tr></thead>
      <tbody>${cost.groups.map(g => html`<tr><td><b>${g.trade}</b></td><td>${g.per === 'month' ? 'Monthly' : 'Daily'}</td><td class="r">${g.people}</td><td class="r">${g.days || ''}</td><td class="r">${g.ot || ''}</td>
        <td class="r nowrap">${totalOf(g.cost)}</td><td class="r">${pct(g.share)}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="2"><b>Total labour</b></td><td class="r">${lines.length}</td><td class="r">${cost.groups.reduce((s, g) => s + g.days, 0)}</td><td class="r">${cost.groups.reduce((s, g) => s + g.ot, 0) || ''}</td>
        <td class="r nowrap"><b>${totalOf(cost.total)}</b></td><td class="r">${cost.groups.some(g => g.share != null) ? '100 %' : ''}</td></tr></tfoot>
    </table>
    ${budget > 0 ? html`<p class="muted p-notes">Labour budget ${money(budget, cur, 2)}: ${money(paidToDate || 0, cur, 2)} paid to the crew and staff of this project so far (${pct(used)}), ${money(Math.max(0, budget - (paidToDate || 0)), cur, 2)} left.</p>`
      : html`<p class="muted p-notes no-print">No labour budget set: add it under Settings, This project, The project.</p>`}`
    : html`<p class="empty">No labour cost in ${p.label}.</p>`}
    ${sign(['Prepared by · Office', 'Checked by · Finance', 'Approved by · General manager'])}
    ${docFoot(foot)}
  </div>`;
}
