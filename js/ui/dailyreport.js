// The Daily Site Report (v0.21.0): the formal, printable report Central Hub makes from a daily report, in the blue
// house style of docs/samples. A4 portrait, numbered sections, charts drawn in the page, "Page x of y" when printed.
// The attendance page is for the office only: it is added when `office` is set, never to the client's copy.

import { dailyModel } from '../engine/dailyreport.js';
import { docRef } from '../engine/docref.js';
import { billingOf } from '../engine/billing.js';
import { fmtDate, fmtFull, num } from '../core/util.js';
import { html } from './dom.js';
import { docFoot, footText } from './print.js';

const STATE = { present: 'Present', absent: 'Absent', sick: 'Sick', leave: 'Leave' };
const pct = v => (v == null ? '' : `${num(v, 0)} %`);

/** Horizontal bars, label and value, the longest bar full width. */
const bars = (list, unit = '') => {
  const max = Math.max(1, ...list.map(x => x.v));
  return list.length ? html`<div class="dsr-bars">${list.map(x => html`<div><span>${x.label}</span><i><b style="width:${(x.v / max * 100).toFixed(1)}%"></b></i><em>${num(x.v, 1)}${unit}</em></div>`)}</div>`
    : html`<p class="dsr-none">Nothing to chart</p>`;
};

/** A task's progress before today (dark) and today's part (light). */
const progressBar = w => (w.pctAfter == null ? '' : html`<span class="dsr-prog"><b style="width:${(w.pctBefore || 0).toFixed(1)}%"></b><i style="left:${(w.pctBefore || 0).toFixed(1)}%;width:${Math.max(0, w.pctAfter - (w.pctBefore || 0)).toFixed(1)}%"></i></span>`);

export function dailyDoc(r, c, { office = false } = {}) {
  const f = r.field || {};
  const m = dailyModel(r, { ws: c.ws, rows: c.sched?.rows || [], hoursPerDay: billingOf(c.project).hoursPerDay });
  const co = c.global.company || {};
  const ref = docRef({ company: co, project: c.project, type: 'DR', key: m.no || r.date });
  const sec = (n, title, body, sub = '') => html`<section class="dsr-sec"><h3><span>${String(n).padStart(2, '0')}</span>${title}${sub ? html` <small>${sub}</small>` : ''}</h3>${body}</section>`;
  const none = text => html`<p class="dsr-none">${text}</p>`;
  const status = r.review === 'pending' ? html`<span class="dsr-st warn">Awaiting approval</span>`
    : r.approvedBy ? html`<span class="dsr-st ok">Approved by ${r.approvedBy}${r.approvedAt ? ` on ${fmtDate(r.approvedAt.slice(0, 10))}` : ''}</span>` : html`<span class="dsr-st">Entered in Central Hub</span>`;
  const labels = [
    m.safety.incident ? ['bad', m.safety.incident] : ['ok', 'No incidents'],
    m.safety.toolbox == null ? null : m.safety.toolbox ? ['ok', 'Toolbox talk held'] : ['warn', 'No toolbox talk'],
    m.delayHours ? ['warn', `Delay ${num(m.delayHours)} h`] : ['ok', 'No delay'],
    [m.received.length ? 'info' : '', `${m.received.length} material${m.received.length === 1 ? '' : 's'} received`],
    [m.requests.length ? 'info' : '', `${m.requests.length} request${m.requests.length === 1 ? '' : 's'}`],
  ].filter(Boolean);

  if (f.nowork) {
    return html`<div class="paper dsr" data-foot="${footText(c, 'Daily Site Report', ref)}">${head(co, c, r, m, status)}
      ${sec(1, 'No work', html`<p>${f.reason || ''}${f.note ? ` (${f.note})` : ''}</p>`)}
      ${docFoot(footText(c, 'Daily Site Report', ref))}</div>`;
  }

  return html`<div class="paper dsr" data-foot="${footText(c, 'Daily Site Report', ref)}">
    ${head(co, c, r, m, status)}

    ${sec(1, 'Summary', html`
      <div class="dsr-kpis">
        <div><b>${m.people}</b><span>People on site</span></div>
        <div><b>${num(m.manHours, 1)}</b><span>Man-hours${m.ot ? ` · ${num(m.ot)} h OT` : ''}</span></div>
        <div><b>${m.items}</b><span>Work items</span></div>
        <div><b>${m.equipment.reduce((s, e) => s + e.qty, 0)}</b><span>Equipment</span></div>
        <div class="${m.delayHours ? 'warn' : ''}"><b>${num(m.delayHours)} h</b><span>Delay</span></div>
      </div>
      <p class="dsr-labels">${labels.map(([cls, t]) => html`<span class="dsr-l ${cls}">${t}</span>`)}</p>
      <div class="dsr-charts">
        <div><h4>Man-hours by trade</h4>${bars(m.trades.map(t => ({ label: t.trade, v: t.manHours })), ' h')}</div>
        <div><h4>Work items by ${m.work.length ? 'task' : 'zone'}</h4>${bars(m.itemsChart.map(x => ({ label: x.label, v: x.n })))}</div>
        <div><h4>Equipment hours</h4>${bars(m.equipment.filter(e => e.machineHours).map(e => ({ label: e.name, v: e.machineHours })), ' h')}</div>
      </div>`)}

    ${sec(2, 'Information', html`<div class="dsr-info">
      ${[['Date', fmtFull(r.date)], ['Prepared by', [r.by, f.position].filter(Boolean).join(', ')], ['Working hours', f.hours?.start ? `${f.hours.start} to ${f.hours.end}` : ''],
        ['Weather', [r.weather, f.tempC != null && f.tempC !== '' ? `${f.tempC} °C` : ''].filter(Boolean).join(', ')], ['Ground', f.ground || ''], ['Location', f.location || c.project.location || '']]
        .filter(([, v]) => v).map(([k, v]) => html`<div><span>${k}</span><b>${v}</b></div>`)}
    </div>`)}

    ${sec(3, "Today's activities", html`
      ${m.work.length ? html`<table class="dsr-t"><thead><tr><th>Against the schedule</th><th class="r">Today</th><th>Location</th><th style="width:30%">Task progress</th></tr></thead>
        <tbody>${m.work.map(w => html`<tr><td><b>${w.name}</b>${w.note ? html`<br><span class="muted">${w.note}</span>` : ''}</td>
          <td class="r">${w.pct != null && !w.qty ? `${w.pct} %` : `${num(w.qty)} ${w.unit}`}</td><td>${w.location}</td>
          <td>${progressBar(w)} <span class="muted">${pct(w.pctAfter)}</span></td></tr>`)}</tbody></table>` : ''}
      ${m.activities.length ? m.activities.map(g => html`${g.type ? html`<h4 class="dsr-type">${g.type}</h4>` : ''}
        ${g.zones.map(z => html`<div class="dsr-zone"><b>${z.zone}</b><ul>${z.lines.map(l => html`<li>${l}</li>`)}</ul></div>`)}`)
        : m.work.length ? '' : none('No activities entered')}`)}

    ${sec(4, 'Manpower and equipment', html`<div class="dsr-two">
      <table class="dsr-t"><thead><tr><th>Trade</th><th class="r">People</th><th class="r">Hours</th><th class="r">Man-hours</th></tr></thead>
        <tbody>${m.trades.map(t => html`<tr><td>${t.trade}</td><td class="r">${t.count}</td><td class="r">${num(t.hours, 1)}</td><td class="r">${num(t.manHours, 1)}</td></tr>`)}</tbody>
        <tfoot><tr><td>Total</td><td class="r">${m.people}</td><td></td><td class="r">${num(m.manHours, 1)}</td></tr></tfoot></table>
      ${m.equipment.length ? html`<table class="dsr-t"><thead><tr><th>Equipment</th><th class="r">Qty</th><th class="r">Hours</th><th>Status</th></tr></thead>
        <tbody>${m.equipment.map(e => html`<tr><td>${e.name}</td><td class="r">${e.qty}</td><td class="r">${num(e.hrs, 1)}</td><td>${e.status}</td></tr>`)}</tbody>
        <tfoot><tr><td>Total</td><td class="r">${m.equipment.reduce((s, e) => s + e.qty, 0)}</td><td class="r">${num(m.machineHours, 1)} h</td><td></td></tr></tfoot></table>` : none('No equipment entered')}
    </div>`)}

    ${sec(5, 'Safety and work delay', html`<div class="dsr-two">
      <div class="dsr-card ${m.safety.incident ? 'bad' : 'ok'}"><b>${m.safety.incident || 'No incidents or near misses'}</b>
        <span>${m.safety.toolbox == null ? '' : m.safety.toolbox ? 'Toolbox talk held.' : 'No toolbox talk.'}</span>
        ${m.safety.notes.length ? html`<ul>${m.safety.notes.map(n => html`<li>${n}</li>`)}</ul>` : ''}</div>
      ${m.delays.length ? html`<div class="dsr-card warn"><b>Work delay, ${num(m.delayHours)} h${m.idle ? `, ${m.idle} people idle` : ''}</b>
        <ul>${m.delays.map(d => html`<li>${d.cause}${d.party ? ` · ${d.party}` : ''} · ${num(d.hours)} h${d.idle ? ` · ${d.idle} idle` : ''}${d.note ? `. ${d.note}` : ''}</li>`)}</ul></div>`
        : html`<div class="dsr-card ok"><b>No work delay</b></div>`}
    </div>`)}

    ${sec(6, 'Materials received', m.received.length ? html`<table class="dsr-t"><thead><tr><th>Material</th><th class="r">Quantity</th><th>Note</th></tr></thead>
      <tbody>${m.received.map(x => html`<tr><td>${x.name}</td><td class="r">${num(x.qty)} ${x.unit}</td><td>${x.note}</td></tr>`)}</tbody></table>` : none('No materials received today'))}

    ${sec(7, 'Requests', m.requests.length ? html`
      <p class="dsr-labels">${m.typeCount.map(([t, n]) => html`<span class="dsr-l ${n ? 'info' : ''}">${t} ${n}</span>`)}</p>
      <table class="dsr-t"><thead><tr><th>Type</th><th>Item</th><th class="r">Quantity</th><th>Needed by</th><th>Priority</th></tr></thead>
        <tbody>${m.requests.map(x => html`<tr><td>${x.type}</td><td>${x.text}</td><td class="r">${x.qty !== '' ? `${num(x.qty)} ${x.unit}` : ''}</td><td>${x.neededBy ? fmtDate(x.neededBy) : ''}</td>
          <td>${/urgent/i.test(x.priority) ? html`<span class="dsr-l bad">Urgent</span>` : x.priority}</td></tr>`)}</tbody></table>` : none('No requests today'))}

    ${sec(8, 'Next day schedule', m.plan.length ? m.plan.map(z => html`<div class="dsr-zone"><b>${z.zone}</b><ul>${z.lines.map(l => html`<li>${l}</li>`)}</ul></div>`) : none('Nothing planned'))}

    ${sec(9, 'Sign-off', html`<div class="dsr-sign">
      <div><span>Prepared by</span><b>${r.by || ''}</b><em>${[f.position, fmtDate(r.date)].filter(Boolean).join(' · ')}</em></div>
      <div><span>Approved by</span><b>${r.approvedBy || ''}</b><em>${r.approvedAt ? fmtDate(r.approvedAt.slice(0, 10)) : 'Signature and date'}</em></div>
    </div>`)}

    ${office && m.attendance.length ? html`<section class="dsr-sec dsr-office"><h3><span>A</span>Attendance <small>for office use only</small></h3>
      <p class="dsr-labels">${Object.entries(STATE).map(([k, label]) => html`<span class="dsr-l">${label} ${m.attendance.filter(a => a.state === k).length}</span>`)}</p>
      <table class="dsr-t"><thead><tr><th>Name</th><th>State</th><th class="r">Overtime</th></tr></thead>
        <tbody>${m.attendance.map(a => html`<tr><td>${a.name}</td><td>${STATE[a.state] || a.state}</td><td class="r">${a.ot ? `${num(a.ot)} h` : ''}</td></tr>`)}</tbody></table></section>` : ''}

    ${m.photos ? html`<section class="dsr-sec dsr-photos"><h3><span>${office && m.attendance.length ? 'B' : 'A'}</span>Site photos</h3>
      <p>${m.photos} photo${m.photos === 1 ? '' : 's'} were taken. They are in the Field Report PDF${f.pdfId ? html`: <a href="https://drive.google.com/file/d/${f.pdfId}/view" target="_blank" rel="noopener">open the PDF</a>` : ''}. From Field Report 1.63.0 they are shown here, 6 to a page.</p></section>` : ''}

    ${docFoot(footText(c, 'Daily Site Report', ref))}
  </div>`;
}

function head(co, c, r, m, status) {
  return html`<header class="dsr-head">
    <img src="${co.logo || 'assets/logo.png'}" alt="">
    <div class="dsr-co"><b class="p-company">${co.name || 'Amistad Prefab'}</b><span>${c.project.name}${c.project.location ? ` · ${c.project.location}` : ''}</span></div>
    <div class="dsr-title"><h2>Daily Site Report</h2><span>${m.no ? `No. ${m.no} · ` : ''}${fmtFull(r.date)}</span>${status}</div>
  </header>`;
}
