// The figures behind the client brief (option B as the owner revised it, 25 Oct 2026) and the status report (v0.22.1):
// the S-curve of planned against actual progress, the site plan as zone tiles, and progress by activity. Pure.

import { schedule } from './gantt.js';
import { activitiesOf, byZone } from './dailyreport.js';
import { toDay, fromDay } from '../core/util.js';

const MAX_POINTS = 40;

/**
 * Planned and actual progress over time, for the S-curve: one point a week (or wider steps on a long job, at most
 * 40 points) from the planned start to the later of the planned finish and today. Actual stops at `today`.
 * @returns { points: [{ day, planned, actual }], today: index of the last point at or before today, or -1 }
 */
export function sCurve({ tasks = [], reports = [], today, workDays }) {
  if (!tasks.length) return { points: [], today: -1 };
  const at = date => schedule(tasks, reports.filter(r => r.date <= date), { today: date, workDays });
  const now = at(today);
  const from = now.planStart, to = Math.max(now.planEnd, toDay(today));
  const step = Math.max(7, Math.ceil((to - from) / MAX_POINTS));
  const days = [];
  for (let d = from; d < to; d += step) days.push(d);
  days.push(to);
  if (!days.includes(toDay(today)) && toDay(today) > from && toDay(today) < to) days.push(toDay(today));
  days.sort((a, b) => a - b);
  const points = days.map(d => {
    const s = d === toDay(today) ? now : at(fromDay(d));
    return { day: fromDay(d), planned: Math.round(s.plannedProgress * 10) / 10, actual: d <= toDay(today) ? Math.round(s.progress * 10) / 10 : null };
  });
  return { points, today: points.map(p => p.day <= today).lastIndexOf(true) };
}

/**
 * The site plan as tiles (no drawings: owner, 25 Oct 2026): every zone named in the daily reports, worked today,
 * worked before, or planned for the next day. Zones keep the order they first appeared in.
 * @returns [{ zone, state: 'today' | 'before' | 'next', lines: n today }]
 */
export function zoneTiles(reports, r) {
  const seen = new Map();
  const rank = { next: 0, before: 1, today: 2 };
  const add = (zone, state, lines = 0) => {
    if (zone === 'General') return;
    const z = seen.get(zone) || seen.set(zone, { zone, state, lines: 0 }).get(zone);
    if (rank[state] > rank[z.state]) z.state = state;
    z.lines += lines;
  };
  for (const x of reports.filter(x => x.date < r.date && x.review !== 'pending').sort((a, b) => a.date.localeCompare(b.date))) {
    for (const g of activitiesOf(x.field || {})) for (const z of g.zones) add(z.zone, 'before');
  }
  for (const z of byZone(r.field?.plan || [])) add(z.zone, 'next');
  for (const g of activitiesOf(r.field || {})) for (const z of g.zones) add(z.zone, 'today', z.lines.length);
  return [...seen.values()];
}

/** Progress by activity for the client: the schedule's tasks (not milestones) that have started, then the next ones, at most `max`. */
export function activityProgress(rows, max = 10) {
  const work = rows.filter(t => !t.milestone);
  const started = work.filter(t => t.progress > 0);
  const next = work.filter(t => !(t.progress > 0)).sort((a, b) => a.es - b.es);
  return [...started, ...next].slice(0, max).map(t => ({ name: t.name, progress: Math.round(t.progress || 0), status: t.status, slip: t.slip || 0 }));
}

/** The next milestones not reached yet, soonest first. */
export const nextMilestones = (rows, max = 5) => rows.filter(t => t.milestone && (t.progress || 0) < 100).sort((a, b) => a.ef - b.ef).slice(0, max)
  .map(t => ({ name: t.name, day: fromDay(t.ef), planned: fromDay(t.planEf), slip: t.slip || 0 }));

/**
 * Days since the last incident or near miss in the approved daily reports, up to `today`. `null` when no report
 * says anything about safety yet, so the status report leaves the figure out rather than claim a safe record.
 */
export function daysSafe(reports, today) {
  const said = reports.filter(r => r.review !== 'pending' && r.date <= today && r.field && 'safety' in r.field);
  if (!said.length) return null;
  const last = said.filter(r => r.field.safety && r.field.safety !== 'None').map(r => r.date).sort().at(-1);
  const from = last || said.map(r => r.date).sort()[0];
  return Math.round((Date.parse(today) - Date.parse(from)) / 864e5) + (last ? 0 : 1);
}
