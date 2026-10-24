// Copying the schedule of one project into another: the task list with its links, moved so the first task starts
// on the chosen day. What belongs to the old project stays behind: who the tasks were given to, and the progress
// (progress comes from the reports of each project). Pure functions; the screen is ui/schedule.js.

import { toDay, fromDay } from '../core/util.js';

/**
 * @param {Object[]} tasks  the other project's tasks
 * @param {string} start    the day the earliest task should start on
 * @param {() => string} newId
 * @returns {Object[]} new tasks with new ids; links point to the new ids, links to tasks not copied are dropped
 */
export function copyTasks(tasks, start, newId) {
  const list = (tasks || []).filter(t => t && t.id && String(t.name || '').trim());
  if (!list.length) return [];
  const ids = new Map(list.map(t => [t.id, newId()]));
  const dated = list.filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t.start || ''));
  const shift = dated.length ? toDay(start) - Math.min(...dated.map(t => toDay(t.start))) : 0;
  return list.map(t => ({
    id: ids.get(t.id),
    name: String(t.name).trim(),
    start: dated.includes(t) ? fromDay(toDay(t.start) + shift) : start,
    duration: Math.max(t.milestone ? 0 : 1, +t.duration || 0),
    milestone: !!t.milestone,
    ...(+t.totalQty > 0 ? { totalQty: +t.totalQty, unit: t.unit || '' } : {}),
    deps: (t.deps || []).filter(d => ids.has(d.id)).map(d => ({ id: ids.get(d.id), ...(d.lag ? { lag: +d.lag } : {}) })),
  }));
}
