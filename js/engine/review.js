// The checks above a report under review (v0.21.0): what the approver should look at before reading it, each green,
// amber or red, with the report section it points to. And what approving it will do, said in one line. Pure functions.

import { sum, num } from '../core/util.js';
import { keyOf } from './attendance.js';

/** The sections a check or an office comment can point to: id -> heading in the report. */
export const SECTIONS = [
  ['work', 'Work done today'], ['activities', "Today's activities"], ['manpower', 'Manpower'], ['equipment', 'Equipment'],
  ['attendance', 'Attendance'], ['delays', 'Delays'], ['requests', 'Requests'], ['materials', 'Materials received'],
  ['safety', 'Safety'], ['plan', 'Next day schedule'], ['photos', 'Photos'], ['general', 'General'],
];
export const sectionLabel = id => SECTIONS.find(([k]) => k === id)?.[1] || 'General';

const words = text => new Set(String(text || '').toLowerCase().match(/[a-zሀ-፿]{4,}/g) || []);
const lineOf = x => (typeof x === 'string' ? x : x?.text || [x?.type, x?.task].filter(Boolean).join(' ') || '');

/** The report filed before this one (by date) that is not a no-work day. */
export const previousOf = (reports, r) => reports.filter(x => x.id !== r.id && x.date < r.date && !x.field?.nowork)
  .sort((a, b) => b.date.localeCompare(a.date))[0] || null;

/**
 * Yesterday's next-day plan against what today's report says was done.
 * Field Report 2 links each logged item to the plan line it came from (planId); for older reports a plan line counts
 * as done when two of its longer words appear in today's activities.
 * @returns { planned, done: [line], open: [line], extra: count of logged items that were not planned }
 */
export function planAgainstDone(r, prev) {
  const f = r.field || {};
  if (f.planned?.length) {
    const ids = new Set((f.items || f.work || []).map(i => i.planId).filter(Boolean));
    const done = f.planned.filter(p => ids.has(p.id)).map(lineOf);
    return { planned: f.planned.length, done, open: f.planned.filter(p => !ids.has(p.id)).map(lineOf), extra: (f.items || f.work || []).filter(i => !i.planId).length };
  }
  const plan = (prev?.field?.plan || []).map(lineOf).filter(Boolean);
  const today = [...(f.progress || []), ...(f.extra || []).flatMap(x => [x.activity, ...(x.items || [])]), ...(f.work || []).map(w => w.note || '')];
  const said = words(today.join(' '));
  const hit = line => [...words(line)].filter(w => said.has(w)).length >= 2;
  const done = plan.filter(hit);
  return { planned: plan.length, done, open: plan.filter(l => !hit(l)), extra: 0 };
}

/**
 * The six checks. Each: { id, label, level: 'ok'|'warn'|'bad', text, section }.
 * @param r the report under review
 * @param ctx { ws, rows: the schedule rows (derive().sched.rows), hoursPerDay }
 */
export function checksOf(r, { ws, rows = [], hoursPerDay = 8 }) {
  const f = r.field || {};
  const out = [];
  const add = (id, label, level, text, section) => out.push({ id, label, level, text, section });

  // 1. attendance: everyone on the active team marked, present count
  const att = f.attendance || [];
  const team = (ws.team || []).filter(m => m.active !== false);
  const name = x => keyOf({ name: x.name });
  const marked = new Set([...att.map(a => a.id).filter(Boolean), ...att.map(name)]);
  const missing = team.filter(m => !marked.has(m.id) && !marked.has(name(m)));
  const present = att.filter(a => (a.state || 'present') === 'present').length;
  const manHours = sum(r.manpower || [], m => m.count * (m.hrs ?? (m.count ? hoursPerDay + (m.ot || 0) / m.count : 0)));
  if (!att.length) add('attendance', 'Attendance', team.length ? 'bad' : 'warn', 'No names marked', 'attendance');
  else add('attendance', 'Attendance', missing.length ? 'warn' : 'ok',
    `${present} of ${att.length} present${missing.length ? ` · ${missing.length} not on the roll` : ' · all marked'} · ${num(manHours, 1)} man-hours`, 'attendance');

  // 2. yesterday's plan against today's work
  const pd = planAgainstDone(r, previousOf(ws.reports || [], r));
  if (!pd.planned) add('plan', 'Plan vs done', 'ok', 'Nothing was planned yesterday', 'activities');
  else add('plan', 'Plan vs done', pd.open.length ? 'warn' : 'ok',
    `${pd.done.length} of ${pd.planned} planned done${pd.open.length ? ` · not done: ${pd.open.slice(0, 2).join('; ')}${pd.open.length > 2 ? '…' : ''}` : ''}`, 'activities');

  // 3. quantities against what is left on the schedule
  const over = [];
  for (const w of f.work || []) {
    const row = rows.find(x => x.id === w.taskId);
    if (!row?.qtyTotal || !(+w.qty > 0)) continue;
    const left = Math.max(0, row.qtyTotal - row.qtyDone);
    if (+w.qty > left + 1e-9) over.push(`${row.name} ${num(w.qty)} ${row.unit || ''}, only ${num(left)} left`.replace(/\s+,/, ','));
  }
  const counted = (f.work || []).filter(w => +w.qty > 0 || w.pct != null).length;
  add('qty', 'Quantities', over.length ? 'bad' : 'ok',
    over.length ? over.join(' · ') : counted ? `${counted} amount${counted === 1 ? '' : 's'} within the schedule` : 'No amounts against tasks', 'work');

  // 4. photos
  const photos = +f.photos || (Array.isArray(f.photos) ? f.photos.length : 0);
  const busy = (f.work || []).length || (f.progress || []).length;
  add('photos', 'Photos', photos ? 'ok' : busy ? 'warn' : 'ok', photos ? `${photos} photo${photos === 1 ? '' : 's'}` : busy ? 'No photos of the work' : 'None', 'photos');

  // 5. delays and safety
  const delays = f.delayItems?.length ? f.delayItems : f.delays || [];
  const lost = sum(delays, d => +(d.hours ?? d.h) || 0);
  const idle = sum(f.delayItems || [], d => +d.idlePeople || 0);
  const incident = f.safety === 'Incident', near = f.safety === 'Near miss';
  add('delays', 'Delays and safety', incident ? 'bad' : lost || near ? 'warn' : 'ok',
    [incident ? 'Incident reported' : near ? 'Near miss' : '', lost ? `${num(lost)} h lost${idle ? `, ${idle} idle` : ''}` : '', !incident && !near && !lost ? 'No delays, no incidents' : '']
      .filter(Boolean).join(' · '), incident || near ? 'safety' : 'delays');

  // 6. requests
  const req = f.requests?.length ? f.requests : r.issue ? [{ priority: 'Normal', text: r.issue }] : [];
  const urgent = req.filter(x => /urgent/i.test(x.priority || '')).length;
  add('requests', 'Requests', urgent ? 'warn' : 'ok', req.length ? `${req.length} new${urgent ? `, ${urgent} urgent` : ''}` : 'None', 'requests');
  return out;
}

/** What approving does, in one line. `tasks` is how many schedule tasks get an amount. */
export function approveSummary(r, tasks, hoursPerDay = 8) {
  const att = (r.field?.attendance || []).length;
  const hours = sum(r.manpower || [], m => m.count * (m.hrs ?? (m.count ? hoursPerDay + (m.ot || 0) / m.count : 0)));
  const parts = [tasks ? `${tasks} schedule task${tasks === 1 ? '' : 's'}` : '', att ? `${att} attendance mark${att === 1 ? '' : 's'}` : '', hours ? `labour ${num(hours, 1)} h` : ''].filter(Boolean);
  return parts.length ? `Approving updates ${parts.join(', ')}.` : 'Approving records the report; it changes no figures.';
}

/** The office comments pinned to sections, as the message the site receives. */
export const pinsMessage = (pins = [], text = '') => [...pins.map(p => `${sectionLabel(p.section)}: ${p.text}`), text].filter(Boolean).join('\n');
