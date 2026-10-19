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
