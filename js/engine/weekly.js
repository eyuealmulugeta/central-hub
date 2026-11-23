// v1.86.0 (owner, 23 Nov, F1): the weekly summary for the GM, made by the server each Monday at 07:00 (Addis Ababa):
// last week's (Monday to Sunday) missing days, No activity days and days off of every open project linked to Field
// Report, with the reasons. The same rule as Review's missing days (ui/reports.js missDays). Pure, for the tests.
import { offDates, weeklyOff } from './calendar.js';

const DAY = 864e5;
const iso = t => new Date(t).toISOString().slice(0, 10);
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Mon 17 Nov". */
export const dayName = d => { const t = new Date(d + 'T00:00:00Z'); return `${DOW[t.getUTCDay()]} ${t.getUTCDate()} ${MON[t.getUTCMonth()]}`; };

/** Last week, Monday to Sunday, before the week of `today`. */
export function lastWeek(today) {
  const t = Date.parse(today + 'T00:00:00Z'), back = (new Date(t).getUTCDay() + 6) % 7;   // days since this Monday
  const from = t - (back + 7) * DAY;
  return { from: iso(from), to: iso(from + 6 * DAY) };
}

/** One project's week: { missing: [d], noAct: [{ d, why, by }], off: [{ d, why }] }; null when it cannot be told. */
export function projectWeek(project, reports, week, today) {
  const dated = (reports || []).filter(r => isDate(r?.date));
  const start = String(project.start || '').slice(0, 10) || dated.reduce((a, r) => (!a || r.date < a ? r.date : a), '');
  if (!start) return null;   // no start date and no report yet: nothing to count from
  const nw = weeklyOff(project), off = new Set(offDates(project, dated)), na = project.noAct || {}, why = project.offWhy || {};
  const sent = new Set(dated.filter(r => !r.field?.nowork).map(r => r.date)), nowork = new Set(dated.filter(r => r.field?.nowork).map(r => r.date));
  const out = { missing: [], noAct: [], off: [] };
  for (let t = Date.parse(week.from + 'T00:00:00Z'), end = Date.parse(week.to + 'T00:00:00Z'); t <= end; t += DAY) {
    const d = iso(t);
    if (d < start || d >= today) continue;
    if (na[d]) { out.noAct.push({ d, why: String(na[d].why || ''), by: String(na[d].by || '') }); continue; }
    if (nw.includes(new Date(t).getUTCDay()) || sent.has(d)) continue;   // the weekly day off (Sunday) is not listed
    if (off.has(d)) { out.off.push({ d, why: why[d] || (nowork.has(d) ? 'No work (sent from Field Report)' : 'Day off') }); continue; }
    out.missing.push(d);
  }
  return out;
}

/**
 * The summary: { from, to, rows: [{ pid, name, code, missing, noAct, off }], totals, title, text }.
 * projects: the project records; reportsOf(pid): that project's reports.
 */
export function weekSummary({ projects = [], reportsOf = () => [], today }) {
  const week = lastWeek(today), rows = [];
  for (const p of projects) {
    if (!p?.id || !p.fieldCode || p.archived || p.status === 'closed') continue;
    const w = projectWeek(p, reportsOf(p.id), week, today);
    if (w) rows.push({ pid: p.id, name: String(p.name || p.id), code: String(p.fieldCode).toUpperCase(), ...w });
  }
  rows.sort((a, b) => b.missing.length - a.missing.length || a.name.localeCompare(b.name));
  const totals = { missing: 0, noAct: 0, off: 0 };
  rows.forEach(r => { totals.missing += r.missing.length; totals.noAct += r.noAct.length; totals.off += r.off.length; });
  const span = `${dayName(week.from)} – ${dayName(week.to)}`;
  const line = r => {
    const parts = [];
    if (r.missing.length) parts.push(`${r.missing.length} missing (${r.missing.map(dayName).join(', ')})`);
    if (r.noAct.length) parts.push(`${r.noAct.length} No activity (${r.noAct.map(x => `${dayName(x.d)}: ${x.why}`).join('; ')})`);
    if (r.off.length) parts.push(`${r.off.length} day off (${r.off.map(x => `${dayName(x.d)}: ${x.why}`).join('; ')})`);
    return `${r.name}: ${parts.length ? parts.join(' · ') : 'every report sent'}`;
  };
  return {
    ...week, rows, totals,
    title: `Weekly reports: ${totals.missing ? `${totals.missing} missing day${totals.missing === 1 ? '' : 's'}` : 'nothing missing'} (${span})`,
    text: rows.length ? rows.map(line).join('\n') : 'No open project linked to Field Report.',
  };
}
