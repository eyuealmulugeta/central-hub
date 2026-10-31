// A project's calendar: the weekly working days plus the dates nobody works (holidays, rain days,
// and every day the site reported "no work"). The schedule counts only working days, so each date
// added here pushes everything after it, and the target (finish) date, later by one working day.
// Pure functions. A calendar is the usual array of working weekdays with one extra property, `off`:
// the set of day numbers that are not worked, which util.isWork reads.

import { DEFAULT_WEEK, toDay, fromDay, addWork, workBetween } from '../core/util.js';
import { schedule } from './gantt.js';

export const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const weekdays = project => (project?.workDays?.length ? [...project.workDays] : [...DEFAULT_WEEK]);

/** One date per line (or separated by commas or spaces); anything that is not a date is dropped. Sorted, no repeats. */
export const parseDates = text => [...new Set(String(text || '').split(/[\s,;]+/).filter(isDate))].sort();

/** Every date not worked on this project: the dates entered for it, and each day the site reported no work. */
export function offDates(project, reports = []) {
  const fromReports = reports.filter(r => r.field?.nowork && isDate(r.date)).map(r => r.date);
  return [...new Set([...(project?.nonWorking || []).filter(isDate), ...fromReports])].sort();
}

/** The calendar to hand to the schedule and to the day-counting helpers. */
export function calendarOf(project, reports = []) {
  const wd = weekdays(project);
  wd.off = new Set(offDates(project, reports).map(toDay));
  return wd;
}

/** The weekdays not worked, 0 = Sunday, as Field Report calls them (nwDow). */
export const weeklyOff = project => [0, 1, 2, 3, 4, 5, 6].filter(d => !weekdays(project).includes(d));

/**
 * The target (finish) date: the project start plus the planned number of working days, skipping every
 * weekly off day and every non-working date. The planned number is counted on the plain working week,
 * so each non-working date moves the target later by exactly one working day.
 * workingDaysLeft counts the working days after today up to the target, never below 0.
 */
export function targetFor(project, ws, today) {
  const weekly = weekdays(project);
  const cal = calendarOf(project, ws.reports || []);
  const out = { nonWorking: offDates(project, ws.reports || []), nwDow: weeklyOff(project), targetDate: '', workingDaysLeft: null, plannedWorkingDays: 0 };
  const tasks = ws.tasks || [];
  if (!tasks.length) return out;
  const plan = schedule(tasks, [], { today, workDays: weekly });
  const planned = Math.max(1, workBetween(plan.planStart - 1, plan.planEnd, weekly));
  const target = addWork(plan.planStart, planned - 1, cal);
  return { ...out, plannedWorkingDays: planned, targetDate: fromDay(target), workingDaysLeft: Math.max(0, workBetween(toDay(today), target, cal)) };
}

/**
 * What Field Report says about the calendar, set against the project's. Non-working dates it knows
 * are added (never removed). Its weekly off days are only compared: changing the working week moves
 * the whole schedule, so that stays a decision of the Admin. Returns { nonWorking, added, weeklyDiffers, theirs }.
 */
export function mergeCalendar(project, payload = {}) {
  const have = (project.nonWorking || []).filter(isDate);
  const theirs = (Array.isArray(payload.nonWorking) ? payload.nonWorking : []).filter(isDate);
  const added = theirs.filter(d => !have.includes(d));
  const off = Array.isArray(payload.nwDow) ? [...new Set(payload.nwDow.map(Number).filter(n => n >= 0 && n <= 6))].sort() : null;
  return {
    nonWorking: added.length ? [...new Set([...have, ...added])].sort() : have,
    added,
    weeklyDiffers: !!off && JSON.stringify(off) !== JSON.stringify(weeklyOff(project)),
    theirs: off,
  };
}

// v0.25.0 (Phase A2): one company calendar (Admin settings, Company): the working week and the public holidays of
// every project, with each project's own exceptions (its own week, its own days off). The result is still written
// on each project (workDays, nonWorking), so the schedule, the target date, pay and Field Report read it as before.
export const sameWeek = (a = [], b = []) => [...a].sort().join() === [...b].sort().join();

/** The company calendar; before it is first saved, the week most projects use and no holidays (nothing changes). */
export function companyCalendar(global, projects = []) {
  const c = global?.calendar;
  if (c) return { workDays: c.workDays?.length ? [...c.workDays].sort() : [...DEFAULT_WEEK], holidays: [...new Set((c.holidays || []).filter(isDate))].sort() };
  const count = new Map();
  for (const p of projects) { const k = weekdays(p).sort().join(); count.set(k, (count.get(k) || 0) + 1); }
  const best = [...count].sort((a, b) => b[1] - a[1])[0];
  return { workDays: best ? best[0].split(',').map(Number) : [...DEFAULT_WEEK], holidays: [] };
}
/** Does this project keep a working week of its own? */
export const ownWeekOf = (p, cal) => (typeof p?.ownWeek === 'boolean' ? p.ownWeek : !sameWeek(weekdays(p), cal.workDays));
/** The dates off of this project only (not the company's holidays). */
export const ownOffOf = (p, cal) => (Array.isArray(p?.ownOff) ? p.ownOff.filter(isDate) : (p?.nonWorking || []).filter(d => isDate(d) && !cal.holidays.includes(d)));

/**
 * What to save on a project when the company calendar or its own exceptions change: its working week and every
 * date off (the company's holidays, its own, and any other date already on it, such as a reported no-work day).
 */
export function projectPatch(p, oldCal, cal, { ownWeek = ownWeekOf(p, oldCal), week = weekdays(p), ownOff = ownOffOf(p, oldCal) } = {}) {
  const oldOwn = ownOffOf(p, oldCal);
  const kept = (p.nonWorking || []).filter(d => isDate(d) && !oldCal.holidays.includes(d) && !oldOwn.includes(d));
  const own = [...new Set(ownOff.filter(isDate))].sort();
  return {
    ownWeek, ownOff: own,
    workDays: (ownWeek ? [...week] : [...cal.workDays]).sort(),
    nonWorking: [...new Set([...cal.holidays, ...own, ...kept])].sort(),
  };
}
