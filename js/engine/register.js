// v1.81.0–v1.83.0 (owner, 22 Nov): the schedule and quantity register, "Work executed" and progress against the total.
// One row per schedule task that has a total quantity (milestones and %-only tasks are not in the register). The daily
// quantities come from the reports: a quantity entered or corrected in Central Hub for a task on a day wins over the
// site's own (Field Report work lines), so nothing is counted twice. Pure functions: tasks + reports in, figures out.

import { schedule } from './gantt.js';
import { toDay, fromDay, workBetween, nextWork, isWork, DEFAULT_WEEK, todayISO } from '../core/util.js';

export const BEHIND_DAYS = 5;          // more than this many working days behind plan = CRITICAL RISK
const r2 = v => Math.round(v * 100) / 100;
const r1 = v => Math.round(v * 10) / 10;
const span = t => Math.max(1, Math.round(+t.duration || 1));

/** The register: WBS, activity, unit, total, planned start and finish, working days, daily rate, weight. */
export function registerRows(tasks = [], { workDays = DEFAULT_WEEK, today } = {}) {
  const s = schedule(tasks, [], { today: today || fromDay(0), workDays });
  const plan = new Map(s.rows.map(r => [r.id, r]));
  return tasks.filter(t => !t.milestone && +t.totalQty > 0).map((t, i) => {
    const p = plan.get(t.id), days = span(t), total = +t.totalQty;
    return {
      id: t.id, wbs: String(t.wbs || '').trim() || String(i + 1), name: t.name, unit: t.unit || '', total,
      start: fromDay(p.planEs), finish: fromDay(p.planEf), planEs: p.planEs, planEf: p.planEf, days,
      rate: r2(total / days), weight: +t.weight > 0 ? +t.weight : 0,
    };
  });
}

/**
 * Every day's quantity per task: { taskId: [{ date, qty, from: 'hub' | 'site', reportId, over? }] }, oldest first.
 * A report the office deleted (in the recycle bin) does not count.
 */
export function dailyLog(reports = [], tasks = []) {
  const ids = new Set(tasks.map(t => t.id)), out = {};
  const add = (id, x) => { if (ids.has(id)) (out[id] ||= []).push(x); };
  for (const r of [...reports].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    const hub = new Set();
    for (const e of r.entries || []) {
      if (!e.taskId || e.qty == null || !(+e.qty > 0 || e.edited)) continue;
      hub.add(e.taskId);
      add(e.taskId, { date: r.date, qty: Math.max(0, +e.qty || 0), from: 'hub', reportId: r.id, ...(e.overWhy ? { over: e.overWhy } : {}) });
    }
    const site = {};
    for (const w of r.field?.work || []) {
      if (!w.taskId || hub.has(w.taskId) || !(+w.qty > 0)) continue;
      const x = (site[w.taskId] ||= { date: r.date, qty: 0, from: 'site', reportId: r.id });
      x.qty = r2(x.qty + +w.qty);
      if (w.overWhy) x.over = String(w.overWhy);
    }
    for (const [id, x] of Object.entries(site)) add(id, x);
  }
  return out;
}

/** Planned % on a day: straight line over the task's working days (0 before its start, 100 from its finish). */
export function plannedPct(row, day, wd = DEFAULT_WEEK) {
  if (day < row.planEs) return 0;
  if (day >= row.planEf) return 100;
  return r2((workBetween(row.planEs, day, wd) + (isWork(row.planEs, wd) ? 1 : 0)) / row.days * 100);
}

/**
 * The figures of each activity on `to` (default today), counting the days from `from` to `to` for the chart only:
 * cumulative (always from the first day), %, remaining, planned % to date, variance in points, days behind.
 */
export function progressOf(tasks = [], reports = [], { today, workDays = DEFAULT_WEEK, to = today } = {}) {
  const rows = registerRows(tasks, { workDays, today });
  const log = dailyLog(reports, tasks), T = toDay(to);
  const list = rows.map(row => {
    const days = (log[row.id] || []).filter(x => x.date <= to);
    const cum = r2(days.reduce((s, x) => s + x.qty, 0));
    const pct = r2(cum / row.total * 100), planned = plannedPct(row, T, workDays);
    const started = days.some(x => x.qty > 0);
    // days behind: the working days the plan has used so far, less the days the quantity done is worth at the planned rate
    const used = T < row.planEs ? 0 : Math.min(row.days, workBetween(row.planEs, T, workDays) + (isWork(row.planEs, workDays) ? 1 : 0));
    const behind = Math.max(0, r1(used - cum / row.rate));
    const lastDay = row.planEf > T ? workBetween(T, row.planEf, workDays) : 0;
    return {
      ...row, cum, pct, remaining: r2(Math.max(0, row.total - cum)), planned, variance: r2(pct - planned),
      started, status: !started ? 'Not started' : cum >= row.total ? 'Done' : 'In progress', behind,
      daysLeft: lastDay, over: days.filter(x => x.over).map(x => ({ date: x.date, why: x.over })), log: days,
    };
  });
  return { rows: list, ...overall(list) };
}

/** Overall progress: weighted by the weight column when any activity has one, otherwise by planned working days. */
export function overall(list) {
  const byWeight = list.some(r => r.weight > 0), w = r => (byWeight ? r.weight : r.days);
  const total = list.reduce((s, r) => s + w(r), 0);
  if (!total) return { actual: 0, planned: 0, by: byWeight ? 'weight' : 'days' };
  return {
    actual: r2(list.reduce((s, r) => s + w(r) * Math.min(100, r.pct), 0) / total),
    planned: r2(list.reduce((s, r) => s + w(r) * r.planned, 0) / total),
    by: byWeight ? 'weight' : 'days',
  };
}

/** The S-curve, planned against actual (in the shape print.js sCurveSvg draws), from `from` to `to`, at most 40 points. */
export function registerCurve(tasks, reports, { today, workDays = DEFAULT_WEEK, from, to } = {}) {
  const rows = registerRows(tasks, { workDays, today });
  if (!rows.length) return { points: [], today: -1 };
  const a = from ? toDay(from) : Math.min(...rows.map(r => r.planEs));
  const b = to ? toDay(to) : Math.max(...rows.map(r => r.planEf), toDay(today));
  const step = Math.max(1, Math.ceil((b - a) / 40)), days = [];
  for (let d = a; d < b; d += step) days.push(d);
  days.push(b);
  const T = toDay(today);
  if (T > a && T < b && !days.includes(T)) days.push(T);
  days.sort((x, y) => x - y);
  const points = days.map(d => {
    const s = progressOf(tasks, reports, { today, workDays, to: fromDay(d) });
    return { day: fromDay(d), planned: r1(s.planned), actual: d <= T ? r1(s.actual) : null };
  });
  return { points, today: points.map(p => p.day <= today).lastIndexOf(true) };
}

/** The daily quantities of one activity between two dates (inclusive), for its chart. */
export const dailyOf = (p, id, from = '', to = '9999') => (p.rows.find(r => r.id === id)?.log || []).filter(x => x.date >= from && x.date <= to);

/**
 * CRITICAL RISK: an activity more than 5 working days behind its plan, or a milestone whose forecast is later than its
 * plan. Each comes with 2 or 3 recovery options and the one recommended.
 */
export function risks(tasks, reports, { today, workDays = DEFAULT_WEEK } = {}) {
  const p = progressOf(tasks, reports, { today, workDays });
  const out = [];
  for (const r of p.rows) {
    if (r.status === 'Done' || r.behind <= BEHIND_DAYS) continue;
    let options, recommend;
    if (r.daysLeft > 0) {
      // still before the planned finish: what it takes to finish on time
      const need = r2(r.remaining / r.daysLeft), factor = r.rate ? need / r.rate : 0;
      options = [
        `Raise the daily output to ${need} ${r.unit}/day (planned ${r.rate}) with overtime or a second shift, to finish by ${r.finish}.`,
        `Add crew: about ${Math.max(1, Math.round((factor - 1) * 100))} % more people on this activity for the ${r.daysLeft} working days left.`,
        `Agree a new finish with the client: about ${Math.ceil(r.behind)} working days later, and start the next activities in parallel where the links allow.`,
      ];
      recommend = factor <= 1.5 ? 0 : factor <= 3 ? 1 : 2;
    } else {
      // the planned finish has passed: how soon it can finish
      const d = k => Math.ceil(r.remaining / (r.rate * k)), d15 = d(1.5);
      options = [
        `Overtime or a second shift (1.5 × the planned rate, ${r2(r.rate * 1.5)} ${r.unit}/day): about ${d15} working days to finish.`,
        `Double the crew on this activity (${r2(r.rate * 2)} ${r.unit}/day): about ${d(2)} working days to finish.`,
        `Agree a new finish with the client: at the planned rate, ${d(1)} working days from today.`,
      ];
      recommend = d15 <= BEHIND_DAYS ? 0 : 1;
    }
    out.push({
      kind: 'activity', id: r.id, title: `${r.wbs} ${r.name}`, behind: r.behind,
      text: `${r.behind} working days behind plan: ${r.pct} % done against ${r.planned} % planned (${r.remaining} ${r.unit} left).`,
      options, recommend,
    });
  }
  const s = schedule(tasks, reports.filter(r => r.review !== 'pending'), { today, workDays });
  for (const m of s.rows.filter(x => x.milestone && x.status !== 'done' && x.ef > x.planEf)) {
    const late = workBetween(m.planEf, m.ef, workDays);
    out.push({
      kind: 'milestone', id: m.id, title: m.name, behind: late,
      text: `Milestone forecast ${fromDay(m.ef)}, ${late} working day${late === 1 ? '' : 's'} after the plan (${fromDay(m.planEf)}).`,
      options: ['Put more crew or overtime on the critical activities before it.', 'Re-sequence: start the activities after it in parallel where possible.', 'Tell the client now and agree the new date in writing.'],
      recommend: late > BEHIND_DAYS ? 2 : 0,
    });
  }
  return out;
}

// ---- Excel in and out ----

export const REGISTER_HEAD = ['WBS', 'Activity', 'Unit', 'Total quantity', 'Planned start', 'Planned finish', 'Working days', 'Daily rate', 'Weight'];

/** The register as sheet rows (with the progress when `p` is given). */
export function registerSheet(rows, p) {
  const by = new Map((p?.rows || []).map(r => [r.id, r]));
  return [[...REGISTER_HEAD, ...(p ? ['Done', 'Progress %', 'Remaining', 'Planned % to date', 'Variance (points)', 'Status'] : [])],
    ...rows.map(r => {
      const x = by.get(r.id);
      return [r.wbs, r.name, r.unit, r.total, r.start, r.finish, r.days, r.rate, r.weight || '', ...(x ? [x.cum, x.pct, x.remaining, x.planned, x.variance, x.status] : [])];
    })];
}

const excelDate = v => (typeof v === 'number' && v > 20000 && v < 80000 ? fromDay(Math.round(v) - 25569) : /^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : '');
const head = s => String(s || '').toLowerCase().replace(/[^a-z%]/g, '');
const COLS = { wbs: ['wbs', 'wbscode', 'code'], name: ['activity', 'activityname', 'task', 'taskname', 'name', 'description'], unit: ['unit', 'uom'], total: ['totalquantity', 'totalqty', 'quantity', 'qty', 'total', 'plannedquantity'], start: ['plannedstart', 'start', 'startdate'], finish: ['plannedfinish', 'finish', 'end', 'finishdate', 'enddate'], weight: ['weight', 'weight%'] };

/**
 * Rows read from an Excel file -> the changes to the tasks: an activity matched by WBS (then by name) is updated,
 * a new one is added. Start and finish set the duration in the project's working days. Returns { tasks, added,
 * updated, problems } with `tasks` the whole new task list (the input is not changed).
 */
export function importRegister(rows, tasks = [], { workDays = DEFAULT_WEEK, newId = () => Math.random().toString(36).slice(2, 9) } = {}) {
  const at = rows.findIndex(r => r.some(c => COLS.name.includes(head(c))));
  if (at < 0) return { tasks, added: 0, updated: 0, problems: ['No "Activity" column found in the first rows.'] };
  const col = {};
  rows[at].forEach((c, i) => { for (const [k, names] of Object.entries(COLS)) if (col[k] == null && names.includes(head(c))) col[k] = i; });
  const out = tasks.map(t => ({ ...t })), problems = [];
  let added = 0, updated = 0;
  rows.slice(at + 1).forEach((r, i) => {
    const get = k => (col[k] == null ? '' : r[col[k]]);
    const name = String(get('name') || '').trim();
    if (!name) return;
    const total = +get('total'), wbs = String(get('wbs') ?? '').trim();
    if (!(total > 0)) { problems.push(`Row ${at + i + 2} ${name}: no total quantity, skipped.`); return; }
    const start = excelDate(get('start')), finish = excelDate(get('finish'));
    const patch = { name, unit: String(get('unit') || '').trim(), totalQty: total, ...(wbs ? { wbs } : {}), ...(+get('weight') > 0 ? { weight: +get('weight') } : {}) };
    if (start) {
      patch.start = start;
      if (finish && finish >= start) patch.duration = Math.max(1, workBetween(nextWork(toDay(start), workDays), toDay(finish), workDays) + 1);
    }
    const t = out.find(x => (wbs && String(x.wbs || '') === wbs) || x.name.trim().toLowerCase() === name.toLowerCase());
    if (t) { Object.assign(t, patch); updated++; }
    else { out.push({ id: newId(), duration: 1, deps: [], ...patch, start: patch.start || fromDay(nextWork(toDay(todayISO()), workDays)) }); added++; }
  });
  return { tasks: out, added, updated, problems };
}

// ---- Work executed: the checks and the audit log ----

/**
 * Checks a day's quantity for an activity: never negative; over the total needs a reason (then it is flagged).
 * done = the cumulative quantity of the other days. Returns '' when it may be saved, otherwise why not.
 */
export function qtyProblem(qty, { total, done = 0, why = '' }) {
  const q = Number(qty);
  if (qty === '' || qty == null || Number.isNaN(q)) return 'Enter a number.';
  if (q < 0) return 'The quantity cannot be negative.';
  if (total > 0 && done + q > total && !String(why).trim()) return `This brings the total to ${r2(done + q)} of ${total}: write why it goes over.`;
  return '';
}

/** A past day's quantity changed in Central Hub: the report's entry for the task and one audit line. Returns the new report. */
export function editQty(report, taskId, { qty, why = '', by, at = new Date().toISOString(), before = null }) {
  const entries = (report.entries || []).filter(e => e.taskId !== taskId);
  const old = (report.entries || []).find(e => e.taskId === taskId);
  entries.push({ ...(old || { progress: null, delayDays: 0, note: '' }), taskId, qty: Math.max(0, +qty || 0), edited: true, ...(String(why).trim() ? { overWhy: String(why).trim().slice(0, 300) } : {}) });
  const line = { at, by, taskId, from: before, to: Math.max(0, +qty || 0), ...(String(why).trim() ? { why: String(why).trim().slice(0, 300) } : {}) };
  return { ...report, entries, qtyLog: [...(report.qtyLog || []), line].slice(-100) };
}
