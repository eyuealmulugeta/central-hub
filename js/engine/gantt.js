// Daily-report-to-Gantt engine. Pure functions: tasks + reports in, schedule out.
// Nothing is mutated, so editing or deleting a report re-syncs the whole timeline.

import { toDay, addWork, subWork, nextWork, workBetween, clamp, DEFAULT_WEEK } from '../core/util.js';

/**
 * Fold every daily report (oldest first) into per-task actuals. A task with a
 * total quantity takes its progress from the quantities installed; any other
 * task takes the percentage the report states.
 */
export function deriveActuals(tasks, reports) {
  const acc = new Map(tasks.map(t => [t.id, {
    progress: 0, qtyDone: 0, qtyTotal: Math.max(0, +t.totalQty || 0), actualStart: null, actualEnd: null, delayDays: 0, reasons: [],
  }]));
  const ordered = [...reports].sort((a, b) => a.date.localeCompare(b.date));
  for (const r of ordered) {
    for (const e of r.entries || []) {
      const a = acc.get(e.taskId);
      if (!a) continue;
      if (a.qtyTotal > 0) {
        // volume-tracked task: percent complete = installed quantity / total quantity
        if (e.qty > 0) {
          a.qtyDone += +e.qty;
          a.progress = Math.min(100, Math.round(a.qtyDone / a.qtyTotal * 1e4) / 100);
          if (!a.actualStart) a.actualStart = r.date;
          if (a.progress >= 100 && !a.actualEnd) a.actualEnd = r.date;
        }
      } else if (e.progress != null) {
        // progress is cumulative, so the latest report wins (this also allows corrections)
        a.progress = clamp(Math.round(+e.progress || 0), 0, 100);
        if (a.progress > 0 && !a.actualStart) a.actualStart = r.date;
        a.actualEnd = a.progress >= 100 ? (a.actualEnd || r.date) : null;
      }
      if (e.delayDays > 0) {
        a.delayDays += +e.delayDays;
        a.reasons.push({ date: r.date, days: +e.delayDays, note: e.note || '' });
      }
    }
  }
  return acc;
}

/** Kahn topological sort. Tasks caught in a dependency loop are appended and reported. */
export function topoSort(tasks) {
  const ids = new Set(tasks.map(t => t.id));
  const indeg = new Map(tasks.map(t => [t.id, 0]));
  const succ = new Map(tasks.map(t => [t.id, []]));
  for (const t of tasks) {
    for (const d of t.deps || []) {
      if (!ids.has(d.id)) continue;
      indeg.set(t.id, indeg.get(t.id) + 1);
      succ.get(d.id).push({ task: t, lag: d.lag || 0 });
    }
  }
  const queue = tasks.filter(t => indeg.get(t.id) === 0);
  const order = [];
  while (queue.length) {
    const t = queue.shift();
    order.push(t);
    for (const s of succ.get(t.id)) {
      indeg.set(s.task.id, indeg.get(s.task.id) - 1);
      if (indeg.get(s.task.id) === 0) queue.push(s.task);
    }
  }
  const cyclic = tasks.filter(t => !order.includes(t));
  return { order: [...order, ...cyclic], cyclic: cyclic.map(t => t.id), succ };
}

/** True if making `depId` a predecessor of `taskId` would create a loop. */
export function wouldCycle(tasks, taskId, depId) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const seen = new Set();
  const stack = [depId];
  while (stack.length) {
    const id = stack.pop();
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const d of byId.get(id)?.deps || []) stack.push(d.id);
  }
  return false;
}

const span = t => (t.milestone ? 0 : Math.max(1, Math.round(+t.duration || 1)));

/**
 * Build the live schedule.
 *
 * Plan pass      planned start + durations + dependencies only (the reference bar).
 * Forecast pass  the same network driven by what the field reported:
 *                  - a started task is pinned to its actual start
 *                  - reported delay days extend the task
 *                  - an unstarted task cannot start before the status date
 *                  - an in-progress task cannot finish before today + its remaining work
 *                  - a finished task ends on the day it was reported 100%
 *                Successors start after their predecessors' forecast finish, so a
 *                delay anywhere moves everything that depends on it.
 * Backward pass  latest finish and float per task; zero float = critical.
 */
export function schedule(tasks, reports = [], { today, workDays } = {}) {
  const wd = workDays?.length ? workDays : DEFAULT_WEEK;
  const status = toDay(today);
  const act = deriveActuals(tasks, reports);
  const { order, cyclic, succ } = topoSort(tasks);
  const byId = new Map(tasks.map(t => [t.id, t]));

  // a successor starts the working day after its predecessor ends (same day after a milestone)
  const after = (predEnd, pred, lag) => addWork(predEnd, Math.max(0, (pred.milestone ? 0 : 1) + (lag || 0)), wd);
  const startAfterDeps = (t, done) => {
    let es = nextWork(toDay(t.start), wd);
    for (const d of t.deps || []) {
      const p = done.get(d.id);
      if (p) es = Math.max(es, after(p.ef, byId.get(d.id), d.lag));
    }
    return es;
  };

  const plan = new Map();
  for (const t of order) {
    const es = startAfterDeps(t, plan);
    plan.set(t.id, { es, ef: addWork(es, Math.max(0, span(t) - 1), wd) });
  }

  const rows = new Map();
  for (const t of order) {
    const a = act.get(t.id);
    const pl = plan.get(t.id);
    const total = t.milestone ? 0 : span(t) + a.delayDays;
    let es = startAfterDeps(t, rows);
    if (a.actualStart) es = toDay(a.actualStart);
    else if (es < status) es = nextWork(status, wd);
    let ef = addWork(es, Math.max(0, total - 1), wd);
    if (a.progress >= 100) {
      ef = Math.max(es, toDay(a.actualEnd));
    } else if (a.actualStart && !t.milestone) {
      const remaining = Math.max(1, Math.ceil(total * (1 - a.progress / 100)));
      ef = Math.max(ef, addWork(status, remaining - 1, wd));
    }
    const done = a.progress >= 100;
    rows.set(t.id, {
      ...t, ...a, es, ef, planEs: pl.es, planEf: pl.ef,
      slip: workBetween(pl.ef, ef, wd),
      status: done ? 'done' : pl.ef < status ? 'late' : a.actualStart ? 'active' : 'pending',
    });
  }

  const all = [...rows.values()];
  const end = all.length ? Math.max(...all.map(r => r.ef)) : status;
  const planEnd = all.length ? Math.max(...all.map(r => r.planEf)) : status;
  for (const t of [...order].reverse()) {
    const r = rows.get(t.id);
    let lf = end;
    for (const s of succ.get(t.id)) {
      const sr = rows.get(s.task.id);
      if (sr.ls != null) lf = Math.min(lf, subWork(sr.ls, Math.max(0, (t.milestone ? 0 : 1) + s.lag), wd));
    }
    r.lf = lf;
    r.ls = subWork(lf, workBetween(r.es, r.ef, wd), wd);
    r.float = workBetween(r.ef, lf, wd);
    r.critical = r.float <= 0 && r.progress < 100;
  }

  // overall progress, weighted by planned duration (milestones carry no weight)
  let weight = 0, earned = 0, planned = 0;
  for (const r of all) {
    const w = span(r);
    if (!w) continue;
    weight += w;
    earned += w * r.progress;
    planned += w * (status < r.planEs ? 0 : status >= r.planEf ? 100 : (workBetween(r.planEs, status, wd) + 1) / w * 100);
  }

  return {
    rows: tasks.map(t => rows.get(t.id)),
    cyclic,
    start: all.length ? Math.min(...all.map(r => r.es)) : status,
    planStart: all.length ? Math.min(...all.map(r => r.planEs)) : status,
    end, planEnd,
    slip: workBetween(planEnd, end, wd),
    progress: weight ? earned / weight : 0,
    plannedProgress: weight ? planned / weight : 0,
  };
}
