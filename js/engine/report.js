// Client progress report for a date range, assembled from daily reports and
// the live schedule. It carries no cost information.

import { toDay } from '../core/util.js';

export function progressReport({ ws, sched }, from, to) {
  const taskName = id => ws.tasks.find(t => t.id === id)?.name || 'Removed task';
  const reports = ws.reports.filter(r => r.date >= from && r.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const entries = reports.flatMap(r => (r.entries || []).map(e => ({ ...e, date: r.date, task: taskName(e.taskId), unit: ws.tasks.find(t => t.id === e.taskId)?.unit || '' })));

  const manpower = new Map();
  for (const r of reports) {
    for (const m of r.manpower || []) {
      const t = manpower.get(m.trade) || { trade: m.trade, days: 0, ot: 0 };
      t.days += m.count;
      t.ot += m.ot || 0;
      manpower.set(m.trade, t);
    }
  }

  // look ahead as far as the period looks back, and at least a week
  const horizon = toDay(to) + Math.max(7, toDay(to) - toDay(from) + 1);
  return {
    from, to,
    reportDays: reports.length,
    weather: [...new Set(reports.map(r => r.weather).filter(Boolean))],
    work: entries.filter(e => e.progress != null || e.qty > 0 || (e.note && !e.delayDays)),
    summary: reports.flatMap(r => (r.field?.progress || []).map(text => ({ date: r.date, text }))),
    delays: entries.filter(e => e.delayDays > 0),
    manpower: [...manpower.values()],
    lookahead: sched.rows.filter(r => r.progress < 100 && r.es <= horizon),
    issues: ws.items.filter(i => i.status === 'open'),
  };
}

/**
 * Everything a progress report shows, as plain data. A client report stores
 * this, so the issued document stays exactly as approved when the project moves on.
 */
export function reportSnapshot({ ws, sched, today }, from, to) {
  const r = progressReport({ ws, sched }, from, to);
  const row = x => ({
    id: x.id, name: x.name, milestone: !!x.milestone, es: x.es, ef: x.ef, planEs: x.planEs, planEf: x.planEf,
    progress: x.progress, status: x.status, slip: x.slip,
  });
  return {
    from, to, asOf: today,
    progress: sched.progress, plannedProgress: sched.plannedProgress, slip: sched.slip,
    start: sched.start, planStart: sched.planStart, end: sched.end, planEnd: sched.planEnd,
    reportDays: r.reportDays, weather: r.weather, manpower: r.manpower,
    work: r.work.map(e => ({ date: e.date, task: e.task, qty: e.qty || 0, unit: e.unit, progress: e.progress ?? null, note: e.note || '' })),
    summary: r.summary,
    delays: r.delays.map(e => ({ date: e.date, task: e.task, delayDays: e.delayDays, note: e.note || '' })),
    lookahead: r.lookahead.map(row),
    issues: r.issues.map(i => ({ title: i.title, due: i.due || '' })),
    rows: sched.rows.map(row),
  };
}
