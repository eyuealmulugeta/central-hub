// Internal performance report for a period (weekly or monthly): what was
// achieved against the plan, by whom, with what manpower, and how reliably it
// was reported. It compares the schedule as it stood the day before the period
// with the schedule at the end of it. Not a client document.

import { schedule } from './gantt.js';
import { laborRows, costsOf } from './ledger.js';
import { convert } from './pricing.js';
import { billingOf } from './billing.js';
import { calendarOf } from './calendar.js';
import { toDay, fromDay, isWork, sum, DEFAULT_WEEK } from '../core/util.js';

export function performanceReport({ project, ws, global }, from, to) {
  const wd = calendarOf(project, ws.reports);
  const stateAt = date => schedule(ws.tasks, ws.reports.filter(r => r.date <= date), { today: date, workDays: wd });
  const before = stateAt(fromDay(toDay(from) - 1));
  const after = stateAt(to);
  const within = d => !!d && d >= from && d <= to;
  const reports = ws.reports.filter(r => within(r.date));

  // ---- output per task and per engineer ----
  const was = new Map(before.rows.map(r => [r.id, r]));
  const member = new Map(ws.team.map(m => [m.id, m.name]));
  const tasks = after.rows.map(r => {
    const p0 = was.get(r.id);
    return {
      id: r.id, name: r.name, milestone: !!r.milestone, engineer: member.get(r.assigneeId) || 'Unassigned',
      weight: r.milestone ? 0 : Math.max(1, +r.duration || 1),
      gain: r.progress - (p0?.progress || 0), qty: r.qtyDone - (p0?.qtyDone || 0), unit: r.unit || '',
      progress: r.progress, status: r.status, slip: r.slip,
      finished: within(r.actualEnd), finishedLate: within(r.actualEnd) && toDay(r.actualEnd) > r.planEf,
    };
  });

  const engineers = new Map();
  for (const t of tasks) {
    const e = engineers.get(t.engineer) || { name: t.engineer, tasks: 0, weight: 0, earned: 0, finished: 0, finishedLate: 0, overdue: 0, slipping: 0 };
    e.tasks++;
    e.weight += t.weight;
    e.earned += t.gain * t.weight;
    if (t.finished) e.finished++;
    if (t.finishedLate) e.finishedLate++;
    if (t.status === 'late') e.overdue++;
    else if (t.slip > 0 && t.progress < 100) e.slipping++;
    engineers.set(t.engineer, e);
  }

  // ---- reporting discipline ----
  const reportedDays = new Set(reports.map(r => r.date));
  const workDays = [];
  for (let d = toDay(from); d <= toDay(to); d++) if (isWork(d, wd)) workDays.push(fromDay(d));
  // a day counts as missing only once the job has started
  const missing = after.rows.length ? workDays.filter(d => !reportedDays.has(d) && toDay(d) >= after.planStart) : [];
  const reporters = new Map();
  for (const r of reports) {
    const p = reporters.get(r.by) || { name: r.by, reports: 0, unconfirmed: 0 };
    p.reports++;
    if (r.review === 'pending') p.unconfirmed++;
    reporters.set(r.by, p);
  }

  // ---- manpower, delays, follow-ups, money ----
  const manDays = sum(reports, r => sum(r.manpower || [], m => m.count));
  const gain = after.progress - before.progress;
  const plannedGain = after.plannedProgress - before.plannedProgress;
  const taskName = id => ws.tasks.find(t => t.id === id)?.name || 'Removed task';
  const delays = reports.flatMap(r => (r.entries || []).filter(e => e.delayDays > 0)
    .map(e => ({ date: r.date, task: taskName(e.taskId), days: e.delayDays, note: e.note || '' })));
  const money = type => sum([...costsOf(ws), ...laborRows(ws, project)].filter(e => e.type === type && !e.estimate && within(e.date)),
    e => convert(e.amount, e.currency, project.currency, global.fx));

  return {
    from, to,
    progress: after.progress, gain, plannedGain,
    // 1.0 = exactly the planned progress for the period; null when no progress was planned
    index: plannedGain > 0.01 ? gain / plannedGain : null,
    slip: after.slip, slipChange: after.slip - before.slip,
    tasks: tasks.filter(t => !t.milestone && (t.gain > 0 || t.qty > 0 || t.status === 'late' || t.status === 'active')),
    engineers: [...engineers.values()].map(e => ({ ...e, gain: e.weight ? e.earned / e.weight : 0 })),
    workDays: workDays.length, reportedDays: workDays.filter(d => reportedDays.has(d)).length, missing,
    reporters: [...reporters.values()],
    // a person present counts as a full working day of hours, plus any overtime
    manDays, otHours: sum(reports, r => sum(r.manpower || [], m => m.ot || 0)), hoursPerDay: billingOf(project).hoursPerDay,
    manHours: manDays * billingOf(project).hoursPerDay + sum(reports, r => sum(r.manpower || [], m => m.ot || 0)),
    labourCost: sum(laborRows(ws, project).filter(r => within(r.date)), r => r.amount),
    // progress points gained per 100 man-days
    productivity: manDays > 0 ? gain / manDays * 100 : null,
    delays, daysLost: sum(delays, d => d.days),
    itemsOpened: ws.items.filter(i => within(i.created)).length,
    itemsClosed: ws.items.filter(i => within(i.closedAt)).length,
    itemsOverdue: ws.items.filter(i => i.status === 'open' && i.due && i.due <= to).length,
    spent: money('expense'), received: money('income'),
  };
}
