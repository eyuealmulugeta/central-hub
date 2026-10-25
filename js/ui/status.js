// The status report (v0.22.1, docs/plan-hub-makeover.md part 6): one page on how the project stands today, in the
// house style. Five figures (done against planned, forecast finish, spent against budget, invoiced and received, days
// without an incident), the S-curve, what needs attention and the next milestones. Money only for people who see money.

import { sCurve, nextMilestones, daysSafe } from '../engine/brief.js';
import { docRef } from '../engine/docref.js';
import { calendarOf } from '../engine/calendar.js';
import { fmtFull, fmtDate, fmtDay, money } from '../core/util.js';
import { html } from './dom.js';
import { docHead, docSec, docFoot, footText, signoff, sCurveSvg } from './print.js';

const SEV = { high: 0, warn: 1, info: 2 };
const pct = v => `${Math.round(v || 0)} %`;

export function statusPaper(c) {
  const s = c.sched, p = c.project;
  const ref = docRef({ company: c.global.company, project: p, type: 'SR', key: c.today });
  const foot = footText(c, 'Project status report', ref, { note: c.money ? 'internal' : '' });
  const approved = c.ws.reports.filter(r => r.review !== 'pending');
  const curve = sCurve({ tasks: c.ws.tasks, reports: approved, today: c.today, workDays: calendarOf(p, c.ws.reports) });
  const safe = daysSafe(c.ws.reports, c.today);
  const miles = nextMilestones(s.rows);
  const flags = [...(c.flags?.auto || [])].filter(f => f.sev !== 'info').sort((a, b) => (SEV[a.sev] ?? 3) - (SEV[b.sev] ?? 3)).slice(0, 6);
  const behind = s.slip > 0 ? `${s.slip} days behind` : s.slip < 0 ? `${-s.slip} days ahead` : 'On plan';
  const budget = c.led?.budget || 0, spent = c.led?.spent || 0;
  const value = p.contractValue || 0;

  const figs = [
    [pct(s.progress), `Done · ${pct(s.plannedProgress)} planned`, s.progress + 5 < s.plannedProgress],
    [s.rows.length ? fmtDay(s.end) : '—', `Forecast finish · ${behind}`, s.slip > 0],
    ...(c.money ? [
      [money(spent, p.currency), budget ? `Spent · ${pct(spent / budget * 100)} of budget` : 'Spent · no budget set', budget > 0 && spent > budget],
      [money(c.bill?.invoiced || 0, p.currency), `Invoiced · ${money(c.led?.income || 0, p.currency)} received${value ? ` · contract ${money(value, p.currency)}` : ''}`, false],
    ] : []),
    ...(safe != null ? [[String(safe), `Day${safe === 1 ? '' : 's'} without an incident`, safe === 0]] : []),
  ];

  return html`<div class="paper dsr status-paper" data-foot="${foot}">
    ${docHead(c, {
      title: 'Project status report', sub: fmtFull(c.today), ref,
      status: behind, tone: s.slip > 5 ? 'bad' : s.slip > 0 ? 'warn' : 'ok',
      facts: [['Project', p.name], ['Client', p.client?.name || ''], ['Location', p.location || ''], ['Planned finish', s.rows.length ? fmtDay(s.planEnd) : '']],
    })}

    <div class="dsr-kpis" style="grid-template-columns:repeat(${figs.length},1fr)">${figs.map(([v, l, warn]) => html`<div class="${warn ? 'warn' : ''}"><b>${v}</b><span>${l}</span></div>`)}</div>

    ${docSec(1, 'Progress against plan', sCurveSvg(curve, { width: 640, height: 190 }), 'planned and actual, from the schedule and the approved daily reports')}

    <div class="brief-grid status-grid">
      ${docSec(2, 'Needs attention', flags.length ? html`<ul class="status-flags">${flags.map(f => html`<li class="${f.sev}"><b>${f.title}</b>${f.detail ? html` <span>${f.detail}</span>` : ''}<em>${f.kind}</em></li>`)}</ul>` : html`<p class="dsr-none">Nothing needs attention.</p>`)}
      ${docSec(3, 'Next milestones', miles.length ? html`<table class="dsr-t"><thead><tr><th>Milestone</th><th>Forecast</th><th>Planned</th></tr></thead>
        <tbody>${miles.map(m => html`<tr><td>${m.name}</td><td class="nowrap ${m.slip > 0 ? 'late' : ''}">${fmtDate(m.day)}</td><td class="nowrap">${fmtDate(m.planned)}${m.slip > 0 ? `, ${m.slip} d late` : ''}</td></tr>`)}</tbody></table>`
        : html`<p class="dsr-none">No milestones ahead in the schedule.</p>`)}
    </div>

    ${signoff([{ label: 'Prepared by · Project engineer', name: '', note: fmtFull(c.today) }, { label: 'Approved by · Project manager' }])}
    ${docFoot(foot)}
  </div>`;
}
