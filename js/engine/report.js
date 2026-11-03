// Client progress report for a date range, assembled from daily reports and
// the live schedule. It carries no cost information.

import { toDay, fromDay } from '../core/util.js';

/** v0.66.0 (owner, Phase D1): the week, Monday to Sunday, that holds this day. */
export function weekOf(day) {
  const n = toDay(day), mon = n - (((n + 4) % 7) + 6) % 7;   // day 0 (1 Jan 1970) was a Thursday
  return [fromDay(mon), fromDay(mon + 6)];
}
export const isSunday = day => (toDay(day) + 4) % 7 === 0;
export const PHOTOS_MIN = 6, PHOTOS_MAX = 12;
const approvedOf = r => r.review !== 'pending' && r.field?.status !== 'returned';

/** v0.66.0: the site photos of the approved reports of the period, for the weekly report (6 to 12 are chosen). */
export function photoPool(ws, from, to) {
  return ws.reports.filter(r => r.date >= from && r.date <= to && approvedOf(r) && r.field?.pdf).sort((a, b) => a.date.localeCompare(b.date))
    .flatMap(r => (r.field.photoFiles || []).filter(p => p && p.id).map(p => ({ key: `${r.field.pdf}|${p.id}`, pdf: r.field.pdf, id: p.id, date: r.date, caption: [p.zone, p.task, p.caption].filter(Boolean).join(' · ') })));
}

/** v0.66.0: Sunday, the week has approved reports and no weekly client report yet: time to send one. */
export function weeklyDue(ws, today) {
  if (!isSunday(today)) return false;
  const [mon, sun] = weekOf(today);
  return ws.reports.some(r => r.date >= mon && r.date <= sun && approvedOf(r))
    && !(ws.docs || []).some(d => d.type === 'report' && d.kind === 'weekly' && d.period?.to >= mon);
}

export function progressReport({ ws, sched }, from, to, { approved = false } = {}) {
  const taskName = id => ws.tasks.find(t => t.id === id)?.name || 'Removed task';
  const reports = ws.reports.filter(r => r.date >= from && r.date <= to && (!approved || approvedOf(r))).sort((a, b) => a.date.localeCompare(b.date));
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
    // v0.66.0: what the weekly report adds, day by day, from the Field Report entries
    equipment: reports.flatMap(r => (r.field?.equipment || []).filter(e => e.name).map(e => ({ date: r.date, name: e.name, qty: e.qty || '', hrs: e.hrs || '', status: e.status || '' }))),
    received: reports.flatMap(r => (r.field?.received || []).filter(x => x.name).map(x => ({ date: r.date, name: x.name, qty: x.qty || '', unit: x.unit || '', note: x.note || '' }))),
    safety: reports.filter(r => r.field && (r.field.safety || r.field.safetyNotes?.length || r.field.toolbox != null))
      .map(r => ({ date: r.date, status: r.field.safety || '', toolbox: r.field.toolbox, notes: (r.field.safetyNotes || []).map(String) })),
  };
}

/**
 * Everything a progress report shows, as plain data. A client report stores
 * this, so the issued document stays exactly as approved when the project moves on.
 */
export function reportSnapshot({ ws, sched, today }, from, to, { weekly = false } = {}) {
  const r = progressReport({ ws, sched }, from, to, { approved: weekly });
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
    // v0.66.0: the weekly report is made from the approved reports only and shows these too
    ...(weekly ? { weekly: true, equipment: r.equipment, received: r.received, safety: r.safety } : {}),
  };
}
