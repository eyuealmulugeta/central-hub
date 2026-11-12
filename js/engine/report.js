// Client progress report for a date range, assembled from daily reports and
// the live schedule. It carries no cost information.

import { toDay, fromDay, uid } from '../core/util.js';
import { schedule } from './gantt.js';
import { calendarOf } from './calendar.js';

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

/** v1.58.0 (owner R8): the calendar month that holds this day, 1st to last. */
export function monthOf(day) {
  const [y, m] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${day.slice(0, 7)}-01`, `${day.slice(0, 7)}-${String(last).padStart(2, '0')}`];
}

/**
 * v1.58.0 (owner R8): the progress chart of a period (layout A): each task as it stood the day before the period and
 * what the period's approved reports added, in % of the task.
 */
export function periodChart({ project, ws }, from, to) {
  if (!project || !ws?.tasks?.length) return [];
  const ok = (ws.reports || []).filter(r => r.review !== 'pending');
  const wd = calendarOf(project, ws.reports || []);
  const at = d => schedule(ws.tasks, [...ok.filter(r => r.date <= d), ...(ws.xlProgress || []).filter(r => !r.date || r.date <= d)], { today: d, workDays: wd });
  const before = new Map(at(fromDay(toDay(from) - 1)).rows.map(r => [r.id, r.progress]));
  return at(to).rows.filter(r => !r.milestone && r.name).map(r => {
    const b = Math.min(100, Math.round(before.get(r.id) || 0));
    return { name: r.name, unit: '%', total: 100, before: b, now: Math.max(0, Math.min(100, Math.round(r.progress)) - b) };
  });
}

/** v1.58.0 (owner R8): automatic drafts start with the week of Mon 9 Nov 2026 (first one on Mon 16 Nov, the first month on 1 Dec). */
export const AUTO_FROM = '2026-11-09';
/**
 * v1.58.0 (owner R8): the client reports the server drafts by itself for the owner to approve: last week (Monday to
 * Sunday) once it is over, last calendar month once it is over; only with approved daily reports, never twice.
 */
export function autoDue(ws, today) {
  const has = (kind, from) => (ws.docs || []).some(d => d.type === 'report' && d.kind === kind && d.period?.from === from);
  const any = (f, t) => (ws.reports || []).some(r => r.date >= f && r.date <= t && approvedOf(r));
  const out = [];
  const [wf, wt] = weekOf(fromDay(toDay(today) - 7));
  if (wf >= AUTO_FROM && !has('weekly', wf) && any(wf, wt)) out.push({ kind: 'weekly', from: wf, to: wt });
  const [mf, mt] = monthOf(fromDay(toDay(`${today.slice(0, 7)}-01`) - 1));
  if (mt >= AUTO_FROM && !has('monthly', mf) && any(mf, mt)) out.push({ kind: 'monthly', from: mf, to: mt });
  return out;
}

/** v1.58.0 (owner R8): up to 12 photos spread over the period, first and last day included. */
export function spreadPhotos(pool, n = PHOTOS_MAX) {
  if (pool.length <= n) return pool;
  return Array.from({ length: n }, (_, i) => pool[Math.round(i * (pool.length - 1) / (n - 1))]);
}

/** v1.58.0 (owner R8): a draft client report made by the server (ctx as derive gives it), photos chosen, waiting for the owner. */
export function autoReport(ctx, { kind, from, to }, number) {
  return {
    id: uid('d'), type: 'report', kind, number, date: ctx.today, due: '', status: 'draft', auto: true,
    party: { name: '', address: '', contact: '', taxId: '', ...(ctx.project.client || {}) },
    period: { from, to }, remarks: '', data: reportSnapshot(ctx, from, to, { weekly: true }), lines: [], subtotal: 0, amountDue: 0,
    photos: spreadPhotos(photoPool(ctx.ws, from, to)).map(p => ({ pdf: p.pdf, id: p.id, date: p.date, caption: p.caption })),
  };
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
export function reportSnapshot({ ws, sched, today, project }, from, to, { weekly = false } = {}) {
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
    chart: periodChart({ project, ws }, from, to),   // v1.58.0 (owner R8): layout A's progress chart
    // v0.66.0: the weekly report is made from the approved reports only and shows these too
    ...(weekly ? { weekly: true, equipment: r.equipment, received: r.received, safety: r.safety } : {}),
  };
}
