// The attendance register of a month: one row per person, one column per day, from the attendance taken
// on site in the daily reports. Pure functions; the screen is ui/attendance.js.

import { toDay, fromDay, isWork } from '../core/util.js';
import { calendarOf } from './calendar.js';

export const MARK = { present: 'P', absent: 'A', sick: 'S', leave: 'L' };
export const MARK_LABEL = { P: 'Present', A: 'Absent', S: 'Sick', L: 'On leave' };

export const daysOf = month => {
  const [y, m] = month.split('-').map(Number);
  const first = toDay(`${month}-01`);
  const next = toDay(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`);
  return Array.from({ length: next - first }, (_, i) => fromDay(first + i));
};

/**
 * @returns { days, off, rows, reportedDays } where `off` holds the dates that are not working days and each row is
 * { key, name, role, cells: { [date]: { mark, ot } }, present, absent, sick, leave, ot }.
 */
export function register(project, ws, month) {
  const days = daysOf(month);
  const cal = calendarOf(project, ws.reports);
  const off = new Set(days.filter(d => !isWork(toDay(d), cal)));
  const roleOf = new Map(ws.team.map(m => [m.id, m.role || '']));
  const people = new Map();
  const reportedDays = new Set();
  const personFor = a => {
    // the same person is found by id when there is one, otherwise by name in any case
    const key = a.id || `name:${String(a.name || '').trim().toLowerCase()}`;
    if (!people.has(key)) people.set(key, { key, name: a.name || ws.team.find(m => m.id === a.id)?.name || 'Unnamed', role: roleOf.get(a.id) || a.trade || '', cells: {}, present: 0, absent: 0, sick: 0, leave: 0, ot: 0 });
    return people.get(key);
  };
  for (const r of ws.reports) {
    if (!String(r.date).startsWith(month)) continue;
    for (const a of r.field?.attendance || []) {
      reportedDays.add(r.date);
      const p = personFor(a);
      const state = a.state || 'present';
      const mark = MARK[state] || 'A';
      p.cells[r.date] = { mark, ot: +a.ot || 0 };
      if (state === 'present') p.present++; else if (state === 'sick') p.sick++; else if (state === 'leave') p.leave++; else p.absent++;
      p.ot += +a.ot || 0;
    }
  }
  const rows = [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { days, off, rows, reportedDays: reportedDays.size };
}
