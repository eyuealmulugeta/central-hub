// What the structured entries of the daily reports add up to over a period:
// a pay sheet from the attendance taken on site, and a record of delays by
// cause and responsible party, the basis of a claim for more time. Pure functions.

import { billingOf } from './billing.js';
import { sum } from '../core/util.js';

const inRange = (reports, from, to) => reports.filter(r => r.date >= from && r.date <= to).sort((a, b) => a.date.localeCompare(b.date));

/**
 * One row per person from the attendance in the reports of the period.
 * Pay = days present x day rate + overtime hours x (day rate / hours per day) x overtime multiplier.
 * The day rate is the one set on the project's team; a person without one is listed with no amount.
 */
export function paySheet({ ws, project }, from, to) {
  const { hoursPerDay, otMultiplier } = billingOf(project);
  const rate = new Map(ws.team.map(m => [m.id, +m.dayRate || 0]));
  const role = new Map(ws.team.map(m => [m.id, m.role || '']));
  const people = new Map();
  const reports = inRange(ws.reports, from, to).filter(r => r.field?.attendance?.length);
  for (const r of reports) {
    for (const a of r.field.attendance) {
      // someone added by name for the day has no id: they are kept apart by name
      const key = a.id || `name:${String(a.name || '').trim().toLowerCase()}`;
      const p = people.get(key) || { id: a.id || '', name: a.name || 'Unnamed', role: role.get(a.id) || '', present: 0, sick: 0, leave: 0, absent: 0, ot: 0, rate: rate.get(a.id) || 0 };
      const state = a.state || 'present';
      if (state === 'present') p.present++; else if (state === 'sick') p.sick++; else if (state === 'leave') p.leave++; else p.absent++;
      p.ot += +a.ot || 0;
      people.set(key, p);
    }
  }
  const rows = [...people.values()].map(p => {
    const basic = p.present * p.rate;
    const overtime = p.ot * (p.rate / hoursPerDay) * otMultiplier;
    return { ...p, basic, overtime, pay: basic + overtime };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return {
    from, to, rows, days: reports.length, hoursPerDay, otMultiplier,
    total: sum(rows, r => r.pay), present: sum(rows, r => r.present), ot: sum(rows, r => r.ot),
    unrated: rows.filter(r => !r.rate).map(r => r.name),
  };
}

/**
 * Every itemised delay of the period, and the time lost by who was responsible.
 * Time is reported in hours; a day is the project's working day.
 */
export function delayRecord({ ws, project }, from, to) {
  const { hoursPerDay } = billingOf(project);
  const taskName = id => ws.tasks.find(t => t.id === id)?.name || '';
  const items = inRange(ws.reports, from, to).flatMap(r => (r.field?.delayItems || []).map(d => ({
    date: r.date, cause: d.cause || 'Not stated', party: d.party || 'Not stated', task: taskName(d.taskId),
    hours: +d.hours || 0, idlePeople: +d.idlePeople || 0, idleEquipment: d.idleEquipment || '', note: d.note || '', by: r.by || '',
  })));
  const group = key => {
    const m = new Map();
    for (const d of items) {
      const g = m.get(d[key]) || { name: d[key], hours: 0, count: 0, idleHours: 0 };
      g.hours += d.hours; g.count++; g.idleHours += d.hours * d.idlePeople;
      m.set(d[key], g);
    }
    return [...m.values()].map(g => ({ ...g, days: g.hours / hoursPerDay })).sort((a, b) => b.hours - a.hours);
  };
  const hours = sum(items, d => d.hours);
  const client = sum(items.filter(d => d.party === 'Client'), d => d.hours);
  return {
    from, to, items, hoursPerDay,
    byParty: group('party'), byCause: group('cause'),
    hours, days: hours / hoursPerDay,
    // the part a claim for an extension of time can rest on
    clientHours: client, clientDays: client / hoursPerDay,
    idleManHours: sum(items, d => d.hours * d.idlePeople),
  };
}
