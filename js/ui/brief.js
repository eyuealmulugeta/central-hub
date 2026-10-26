// The client brief (v0.22.1): option B as the owner revised it on 25 Oct 2026 (Field Report docs/client-brief-b.pdf).
// Everything on page 1: the figures, the site plan as zone tiles, the S-curve, progress by activity, the work done,
// manpower by trade, equipment and materials, safety, the next day and the signatures. It is for the client: no money
// and no workers' names. The photos page follows once photos come to Drive (Field Report 1.63.0); the QR code to the
// client page comes with v0.23.0.

import { dailyModel } from '../engine/dailyreport.js';
import { sCurve, zoneTiles, activityProgress } from '../engine/brief.js';
import { docRef } from '../engine/docref.js';
import { billingOf } from '../engine/billing.js';
import { calendarOf } from '../engine/calendar.js';
import { fmtFull, fmtDay, num } from '../core/util.js';
import { html } from './dom.js';
import { docHead, docSec, docFoot, footText, signoff, sCurveSvg, zonePlan } from './print.js';
import { photoGrid } from './photos.js';

const pct = v => `${Math.round(v || 0)} %`;

export function clientBrief(r, c) {
  const f = r.field || {};
  const m = dailyModel(r, { ws: c.ws, rows: c.sched?.rows || [], hoursPerDay: billingOf(c.project).hoursPerDay });
  const s = c.sched;
  const ref = docRef({ company: c.global.company, project: c.project, type: 'CB', key: m.no || r.date });
  const foot = footText(c, 'Daily progress brief', ref);
  const curve = sCurve({ tasks: c.ws.tasks, reports: c.ws.reports.filter(x => x.review !== 'pending'), today: r.date, workDays: calendarOf(c.project, c.ws.reports) });
  const tiles = zoneTiles(c.ws.reports, r);
  const acts = activityProgress(s.rows, 9);
  const behind = s.slip > 0 ? `${s.slip} days behind` : s.slip < 0 ? `${-s.slip} days ahead` : 'On plan';
  const approved = r.review !== 'pending' && r.approvedBy;
  const none = t => html`<p class="dsr-none">${t}</p>`;

  return html`<div class="paper dsr brief" data-foot="${foot}">
    ${docHead(c, {
      title: 'Daily progress brief', sub: `${m.no ? `No. ${m.no} · ` : ''}${fmtFull(r.date)}`, ref,
      status: r.review === 'pending' ? 'Awaiting approval' : 'Approved', tone: r.review === 'pending' ? 'warn' : 'ok',
      facts: [['Project', c.project.name], ['Client', c.project.client?.name || ''], ['Location', f.location || c.project.location || ''], ['Weather', [r.weather, f.tempC != null && f.tempC !== '' ? `${f.tempC} °C` : ''].filter(Boolean).join(', ')]],
    })}

    <div class="dsr-kpis brief-kpis">
      <div><b>${pct(s.progress)}</b><span>Complete · ${pct(s.plannedProgress)} planned</span></div>
      <div class="${s.slip > 0 ? 'warn' : ''}"><b>${s.rows.length ? fmtDay(s.end) : '—'}</b><span>Forecast finish · ${behind}</span></div>
      <div><b>${m.people}</b><span>People on site</span></div>
      <div><b>${num(m.manHours, 0)}</b><span>Man-hours today</span></div>
      <div class="${m.safety.incident ? 'warn' : ''}"><b>${m.safety.incident ? 'Incident' : 'Safe'}</b><span>${m.safety.incident || 'No incidents'}</span></div>
    </div>

    <div class="brief-grid">
      ${docSec(1, 'Site plan', zonePlan(tiles), 'zones worked')}
      ${docSec(2, 'Progress against plan', sCurveSvg(curve, { width: 420, height: 150 }))}
      ${docSec(3, 'Progress by activity', acts.length ? html`<div class="dsr-bars brief-acts">${acts.map(a => html`<div><span>${a.name}</span><i><b style="width:${a.progress}%"></b></i><em>${a.progress} %</em></div>`)}</div>` : none('No schedule yet'))}
      ${docSec(4, 'Work done today', html`
        ${m.work.length ? html`<ul class="brief-list">${m.work.map(w => html`<li><b>${w.name}</b>: ${w.pct != null && !w.qty ? `${w.pct} %` : `${num(w.qty)} ${w.unit}`}${w.location ? ` · ${w.location}` : ''}</li>`)}</ul>` : ''}
        ${m.activities.flatMap(g => g.zones).map(z => html`<div class="dsr-zone"><b>${z.zone}</b><ul>${z.lines.map(l => html`<li>${l}</li>`)}</ul></div>`)}
        ${!m.work.length && !m.activities.length ? none(f.nowork ? `No work: ${f.reason || ''}` : 'No activities entered') : ''}`)}
    </div>

    <div class="brief-three">
      ${docSec(5, 'Manpower', m.trades.length ? html`<table class="dsr-t"><thead><tr><th>Trade</th><th class="r">People</th><th class="r">Man-hours</th></tr></thead>
        <tbody>${m.trades.map(t => html`<tr><td>${t.trade}</td><td class="r">${t.count}</td><td class="r">${num(t.manHours, 0)}</td></tr>`)}</tbody>
        <tfoot><tr><td>Total</td><td class="r">${m.people}</td><td class="r">${num(m.manHours, 0)}</td></tr></tfoot></table>` : none('No manpower entered'))}
      ${docSec(6, 'Equipment, materials', html`
        ${m.equipment.length ? html`<ul class="brief-list">${m.equipment.map(e => html`<li>${e.name} × ${e.qty}${e.hrs ? `, ${num(e.hrs, 1)} h` : ''}</li>`)}</ul>` : none('No equipment entered')}
        ${m.received.length ? html`<p class="brief-sub">Received</p><ul class="brief-list">${m.received.map(x => html`<li>${x.name}: ${num(x.qty)} ${x.unit}</li>`)}</ul>` : ''}`)}
      ${docSec(7, 'Safety and delays', html`
        <div class="dsr-card ${m.safety.incident ? 'bad' : 'ok'}"><b>${m.safety.incident || 'No incidents or near misses'}</b>${m.safety.toolbox ? html`<span>Toolbox talk held.</span>` : ''}</div>
        ${m.delays.length ? html`<div class="dsr-card warn"><b>Delay ${num(m.delayHours)} h</b><ul>${m.delays.map(d => html`<li>${d.cause}${d.party ? ` · ${d.party}` : ''}</li>`)}</ul></div>` : ''}`)}
    </div>

    ${docSec(8, 'Next day', m.plan.length ? html`<div class="brief-next">${m.plan.map(z => html`<div><b>${z.zone}</b> ${z.lines.join('; ')}</div>`)}</div>` : none('Nothing planned'))}

    ${signoff([{ label: 'Prepared by · Site engineer', name: r.by || '', note: fmtFull(r.date) }, { label: 'Approved by', name: approved ? r.approvedBy : '', note: approved && r.approvedAt ? fmtFull(r.approvedAt.slice(0, 10)) : 'Date' }])}
    <p class="muted brief-note">${m.photos && !photoGrid(r, c) ? `${m.photos} site photo${m.photos === 1 ? ' was' : 's were'} taken today. ` : ''}Figures from the approved daily report and the project schedule.</p>
    ${docFoot(foot)}
    ${photoGrid(r, c) ? html`<div class="brief-photos"><h3>Site photos</h3>${photoGrid(r, c, { perPage: 6, cls: 'ph-page' })}</div>` : ''}
  </div>`;
}
