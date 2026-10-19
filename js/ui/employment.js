// Agreement (Crew): where each employee's agreement stands, worst first: ended, ending soon, probation
// ending, nothing recorded. The agreement itself is on the person's HR record. Admin only, like HR.
// (Agreements with clients and suppliers are under Administration, Agreements.)

import { agreementRows, SOON_DAYS } from '../engine/agreements.js';
import { agreementLabel } from '../engine/hr.js';
import { money, fmtFull } from '../core/util.js';
import { html, chip } from './dom.js';
import { focusOn } from './hr.js';

let filter = 'all';

const FILTERS = [['all', 'Everyone'], ['attention', 'Needs attention'], ['expired', 'Ended'], ['ending', `Ending in ${SOON_DAYS} days`], ['none', 'Nothing recorded']];
const CLS = { expired: 'high', ending: 'warn', probation: 'warn', none: 'warn', running: 'ok', open: 'ok' };
const PER = { month: 'a month', day: 'a day', hour: 'an hour' };

export function render(c) {
  const rows = agreementRows(c.company.staff, c.today, filter);
  const all = agreementRows(c.company.staff, c.today);
  const attention = all.filter(r => ['expired', 'ending', 'probation', 'none'].includes(r.state)).length;
  return html`
    <section class="kpis">
      <div class="kpi"><span class="kpi-label">Employees</span><strong>${all.length}</strong><span class="muted">Currently working</span></div>
      <div class="kpi"><span class="kpi-label">Need attention</span><strong class="${attention ? 'bad' : ''}">${attention}</strong><span class="muted">Ended, ending soon, or no agreement recorded</span></div>
    </section>
    <section class="card">
      <div class="toolbar"><h2>Employment agreements</h2><span class="grow"></span>
        <div class="seg">${FILTERS.map(([k, label]) => html`<button class="${filter === k ? 'on' : ''}" data-act="filter" data-k="${k}">${label}</button>`)}</div></div>
      ${rows.length ? html`<table class="table">
        <thead><tr><th>Employee</th><th>Agreement</th><th>Starts</th><th>Ends</th><th>Probation ends</th><th class="r">Notice</th><th class="r">Pay</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows.map(({ p, state, text }) => { const a = p.agreement || {}; return html`<tr>
          <td><b>${p.name}</b><br><span class="muted">${p.title || ''}</span></td>
          <td>${a.type ? agreementLabel(a.type) : '—'}</td>
          <td class="nowrap">${a.start ? fmtFull(a.start) : '—'}</td><td class="nowrap">${a.end ? fmtFull(a.end) : 'Open-ended'}</td><td class="nowrap">${a.probationEnd ? fmtFull(a.probationEnd) : ''}</td>
          <td class="r">${a.noticeDays ? `${a.noticeDays} days` : ''}</td>
          <td class="r nowrap">${a.pay ? `${money(a.pay, a.currency || c.global.fx.base, 0)} ${PER[a.payPer] || ''}` : ''}</td>
          <td>${chip(text, CLS[state])}</td>
          <td class="r"><button class="btn small" data-act="open" data-id="${p.id}">Open the record</button></td></tr>`; })}</tbody>
      </table>` : html`<p class="empty">${all.length ? 'Nobody matches.' : 'No employees yet. Add them under Crew, Employee data.'}</p>`}
    </section>
    <p class="muted">Only you, the Admin, can open this page. The agreement itself, its terms and the signed file are on each person's record, under Agreement and pay.</p>`;
}

export const actions = {
  filter(el) { filter = el.dataset.k; },
  open(el) { focusOn(el.dataset.id, 'pay'); location.hash = '#hr'; },
};
