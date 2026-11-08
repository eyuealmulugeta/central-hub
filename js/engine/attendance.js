// The attendance sheet of a pay period (a week, two weeks or a month): one row per person, one column per day,
// from the attendance taken on site in the daily reports, with the office's corrections on top.
// A correction is its own record (workspace section `attendance`), so importing the reports again never
// undoes it. Pure functions; the screen is ui/attendance.js.

import { toDay, fromDay, isWork } from '../core/util.js';
import { calendarOf } from './calendar.js';

export const MARK = { present: 'P', absent: 'A', sick: 'S', leave: 'L' };
export const MARK_LABEL = { P: 'Present', A: 'Absent', S: 'Sick', L: 'On leave' };
export const STATES = [['present', 'Present'], ['absent', 'Absent'], ['sick', 'Sick'], ['leave', 'On leave']];

// v0.71.0 (owner, 3 Nov, Phase G2): Field Report shares each day's marks live (projects/<id>/fieldDay/<date>), and
// the reporter confirms there that the attendance is correct. A day with no report yet shows those marks on the sheet
// (not counted until the report comes); each day says whether the reporter confirmed it, or it changed after.
/** The key Field Report gives a row (model/crew.js markKey). */
export const fieldKey = x => String(x.id || x.name || '').toLowerCase().replace(/[.\/\[\]#$~*`]/g, '_');
const ms = v => (typeof v === 'number' ? v : Date.parse(v) || 0);
/** A Field Report day: { state: 'open' | 'ok' | 'changed', by, at }. */
export function dayCheck(doc, fixes = []) {
  const c = doc?.confirmed;
  if (!c) return { state: 'open', by: '', at: 0 };
  const at = ms(c.at);
  const later = Object.values(doc.rows || {}).some(x => ms(x.at) > at) || fixes.some(f => f.date === doc.date && ms(f.at) > at);
  return { state: later ? 'changed' : 'ok', by: c.by || '', at };
}

/** How often the crew of a project is paid; the attendance sheet shows the same period. */
export const PAY_PERIODS = [['weekly', 'Weekly'], ['biweekly', 'Every two weeks'], ['monthly', 'Monthly']];
export const payPeriodOf = project => (PAY_PERIODS.some(([k]) => k === project?.payPeriod) ? project.payPeriod : 'monthly');
/** The day a pay week starts, 0 = Sunday. Monday unless the project says otherwise. */
export const weekStartOf = project => (Number.isInteger(project?.payWeekStart) && project.payWeekStart >= 0 && project.payWeekStart < 7 ? project.payWeekStart : 1);

const dowOf = n => (((n + 4) % 7) + 7) % 7;   // day 0 (1 Jan 1970) was a Thursday
const monthEnd = month => {
  const [y, m] = month.split('-').map(Number);
  return fromDay(toDay(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`) - 1);
};
const short = iso => new Date(`${iso}T00:00:00Z`).toLocaleString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * The pay period of `project` that holds `date`: { kind, from, to, label }. Two-week periods are counted from the
 * first pay week of the project (its start date), so they stay the same from one month to the next.
 */
export function periodFor(project, date) {
  const kind = payPeriodOf(project);
  if (kind === 'monthly') {
    const month = date.slice(0, 7);
    const label = new Date(`${month}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return { kind, from: `${month}-01`, to: monthEnd(month), label };
  }
  const ws = weekStartOf(project);
  const n = toDay(date);
  let from = n - ((dowOf(n) - ws + 7) % 7);
  if (kind === 'biweekly') {
    const a = toDay(/^\d{4}-\d{2}-\d{2}$/.test(project?.start || '') ? project.start : '2026-01-05');
    const anchor = a - ((dowOf(a) - ws + 7) % 7);
    if (Math.abs(Math.floor((from - anchor) / 7)) % 2 === 1) from -= 7;
  }
  const to = from + (kind === 'weekly' ? 6 : 13);
  return { kind, from: fromDay(from), to: fromDay(to), label: `${short(fromDay(from))} to ${short(fromDay(to))} ${fromDay(to).slice(0, 4)}` };
}
/** The period before (n = -1) or after (n = 1) this one. */
export const shiftPeriod = (project, period, n) => periodFor(project, fromDay(n > 0 ? toDay(period.to) + 1 : toDay(period.from) - 1));

export const daysBetween = (from, to) => Array.from({ length: toDay(to) - toDay(from) + 1 }, (_, i) => fromDay(toDay(from) + i));
export const daysOf = month => daysBetween(`${month}-01`, monthEnd(month));

/** How a person is known on the sheet: their team member id, else their name in any case. */
export const keyOf = a => a.id || `name:${String(a.name || '').trim().toLowerCase()}`;
export const fixId = (date, key) => `af_${date}_${key.replace(/[^a-z0-9]+/gi, '-')}`.slice(0, 120);

/** The corrections that count (an undone one keeps its record but no longer applies). */
// v0.42.0: a correction sent from site (Field Report, Crew attendance; it has `review`) counts only once accepted,
// as the office's own correction of that cell
export const liveFixes = fixes => (fixes || []).filter(f => !f.undone && !f.review);

/**
 * Reports that count for attendance, pay and labour cost (v0.20.0): a Field Report report counts once it is approved
 * in Central Hub; while it waits for approval (or was sent back) it does not. Reports typed in Central Hub count.
 */
export const counts = r => r.review !== 'pending';
export const waiting = (reports, p) => (reports || []).filter(r => !counts(r) && (!p || (r.date >= p.from && r.date <= p.to))).length;
/** The line shown on the attendance and pay pages while reports of the period wait for approval, or ''. */
export const waitingNote = (reports, p) => {
  const n = waiting(reports, p);
  return n ? `${n} daily report${n === 1 ? '' : 's'} of this period ${n === 1 ? 'waits' : 'wait'} for approval and ${n === 1 ? 'is' : 'are'} not counted yet. Approve ${n === 1 ? 'it' : 'them'} under Daily reports.` : '';
};

/**
 * The daily reports that count, with the office's corrections applied: a mark changed, added or cleared (state 'none').
 * A day with corrections but no counted report gets a stand-in report that only carries the attendance.
 */
export function withFixes(all, fixes) {
  const reports = (all || []).filter(counts);
  const live = liveFixes(fixes);
  if (!live.length) return reports;
  const byDate = new Map();
  for (const f of live) byDate.set(f.date, [...(byDate.get(f.date) || []), f]);
  const apply = (list, fs) => {
    const out = list.map(a => ({ ...a }));
    for (const f of fs) {
      const i = out.findIndex(a => keyOf(a) === f.key);
      if (f.state === 'none') { if (i >= 0) out.splice(i, 1); continue; }
      const entry = { ...(i >= 0 ? out[i] : { id: f.personId || '', name: f.name }), state: f.state, ot: +f.ot || 0 };
      if (i >= 0) out[i] = entry; else out.push(entry);
    }
    return out;
  };
  const done = new Set();
  const out = reports.map(r => {
    const fs = byDate.get(r.date);
    if (!fs || done.has(r.date) || r.field?.nowork) return r;
    done.add(r.date);
    return { ...r, field: { ...(r.field || {}), attendance: apply(r.field?.attendance || [], fs) } };
  });
  for (const [date, fs] of byDate) if (!done.has(date)) out.push({ id: `att_${date}`, date, standIn: true, field: { attendance: apply([], fs) } });
  return out;
}

/**
 * The sheet of a period (`{ from, to }`, or a month 'YYYY-MM' as before).
 * `crew` [{ id, name, role }] are the people on the project's site team: they always have a row, so a day the
 * report left out can be filled in. Returns { days, off, rows, reportedDays, heads } where `off` holds the dates
 * that are not working days, `heads` the number present each day, and each row is
 * { key, id, name, role, cells: { [date]: { mark, state, ot, fixed } }, present, absent, sick, leave, ot }.
 */
export function register(project, ws, period, crew = [], { live = false } = {}) {
  const { from, to } = typeof period === 'string' ? { from: `${period}-01`, to: monthEnd(period) } : period;
  const days = daysBetween(from, to);
  const cal = calendarOf(project, ws.reports);
  const off = new Set(days.filter(d => !isWork(toDay(d), cal)));
  const roleOf = new Map(ws.team.map(m => [m.id, m.role || '']));
  // underlined: corrected by the office (a correction sent by the site is the site's own mark)
  const fixed = new Set(liveFixes(ws.attendance).filter(f => !f.site).map(f => `${f.date}|${f.key}`));
  const people = new Map();
  const reportedDays = new Set();
  const personFor = a => {
    const key = keyOf(a);
    if (!people.has(key)) people.set(key, { key, id: a.id || '', name: a.name || ws.team.find(m => m.id === a.id)?.name || 'Unnamed', role: roleOf.get(a.id) || a.trade || a.role || '', cells: {}, present: 0, absent: 0, sick: 0, leave: 0, ot: 0 });
    return people.get(key);
  };
  for (const m of crew) personFor(m);
  const heads = Object.fromEntries(days.map(d => [d, 0]));
  for (const r of withFixes(ws.reports, ws.attendance)) {
    if (r.date < from || r.date > to) continue;
    for (const a of r.field?.attendance || []) {
      reportedDays.add(r.date);
      const p = personFor(a);
      const state = a.state || 'present';
      const mark = MARK[state] || 'A';
      p.cells[r.date] = { mark, state, ot: +a.ot || 0, fixed: fixed.has(`${r.date}|${p.key}`) };
      if (state === 'present') { p.present++; heads[r.date]++; } else if (state === 'sick') p.sick++; else if (state === 'leave') p.leave++; else p.absent++;
      p.ot += +a.ot || 0;
    }
  }
  // v0.71.0: Field Report's live marks on the days with no report yet, and the reporter's check of each day
  const checks = {};
  if (live) for (const doc of ws.fieldDays || []) {
    const d = doc.date;
    if (!d || d < from || d > to) continue;
    checks[d] = dayCheck(doc, liveFixes(ws.attendance));
    if (reportedDays.has(d)) continue;
    const byKey = new Map([...people.values()].map(p => [fieldKey(p), p]));
    for (const [k, x] of Object.entries(doc.rows || {})) {
      if (!MARK[x.state]) continue;
      const p = byKey.get(k) || (x.name ? personFor({ id: x.id || '', name: x.name }) : null);
      if (p && !p.cells[d]) p.cells[d] = { mark: MARK[x.state], state: x.state, ot: +x.ot || 0, fixed: false, live: true };
    }
  }
  // a cell cleared by the office still shows that it was corrected
  for (const f of liveFixes(ws.attendance)) if (f.state === 'none' && f.date >= from && f.date <= to) { const p = people.get(f.key); if (p && !p.cells[f.date]) p.cells[f.date] = { mark: '', state: 'none', ot: 0, fixed: true }; }
  const rows = [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { days, off, rows, reportedDays: reportedDays.size, heads, checks };
}

/**
 * The rows of the sheet in the order it prints (v0.21.0): the monthly-paid staff first, then the daily crew trade by
 * trade, each group with its totals. `perOf(row)` says 'month' or 'day'. Groups with nobody are left out.
 */
export function groupRows(rows, perOf) {
  const totals = list => ({
    present: list.reduce((s, x) => s + x.present, 0), absent: list.reduce((s, x) => s + x.absent, 0), sick: list.reduce((s, x) => s + x.sick, 0),
    leave: list.reduce((s, x) => s + x.leave, 0), ot: list.reduce((s, x) => s + x.ot, 0),
  });
  const monthly = rows.filter(r => perOf(r) === 'month');
  const trades = new Map();
  for (const r of rows.filter(x => perOf(x) !== 'month')) {
    const t = r.role || 'Other';
    if (!trades.has(t)) trades.set(t, []);
    trades.get(t).push(r);
  }
  return [
    { title: 'Monthly staff', per: 'month', rows: monthly },
    ...[...trades].sort(([a], [b]) => a.localeCompare(b)).map(([t, list]) => ({ title: `Daily crew · ${t}`, per: 'day', rows: list })),
  ].filter(g => g.rows.length).map(g => ({ ...g, totals: totals(g.rows) }));
}

/** What a day shows for a person before the office changes it: the mark from the reports (with earlier corrections). */
export function markOn(ws, date, key) {
  for (const r of withFixes(ws.reports, ws.attendance)) {
    if (r.date !== date) continue;
    const a = (r.field?.attendance || []).find(x => keyOf(x) === key);
    if (a) return { state: a.state || 'present', ot: +a.ot || 0 };
  }
  return null;
}

/**
 * The correction record for a person on a day. `was` is what the reports said before the first correction of
 * that cell, kept so the change can be shown and undone.
 */
export function correction(ws, { date, key, personId = '', name = '', state, ot = 0 }, by, at) {
  const id = fixId(date, key);
  const old = (ws.attendance || []).find(f => f.id === id);
  const base = withFixes(ws.reports, []).find(r => r.date === date && (r.field?.attendance || []).some(a => keyOf(a) === key));
  const orig = base ? base.field.attendance.find(a => keyOf(a) === key) : null;
  const was = old ? old.was : orig ? { state: orig.state || 'present', ot: +orig.ot || 0 } : null;
  return { id, date, key, personId, name, state, ot: Math.max(0, +ot || 0), was, by, at, undone: false };
}

/** What goes to Field Report with the lists: the office's corrections of the last weeks, so the site sees them too (locked there). */
export function fixesForField(fixes, today, days = 45) {
  const since = fromDay(toDay(today) - days);
  return liveFixes(fixes).filter(f => f.date >= since && !f.site).map(f => ({ date: f.date, id: f.personId || '', name: f.name, state: f.state, ot: +f.ot || 0 }));
}

/**
 * The attendance the site corrected in Field Report after the daily report (export `attendance`, script 7.27.0):
 * one record per day, { date, rows: [{ id, name, trade, state, ot }], byName, at }. Each changed row becomes a
 * correction marked `site`, unless the office corrected that person on that day (the office has the last word)
 * or the same or a newer site record is already in. Changes ws.attendance; returns how many were added or changed.
 */
export function siteFixes(ws, days = []) {
  ws.attendance ||= [];
  let n = 0;
  for (const d of days || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d?.date || '')) continue;
    for (const r of d.rows || []) {
      if (!r?.name || !STATES.some(([k]) => k === r.state)) continue;
      const key = keyOf(r);
      const old = ws.attendance.find(f => f.id === fixId(d.date, key));
      if (old && !old.site && !old.undone) continue;
      if (old?.site && String(old.at || '') >= String(d.at || '')) continue;
      const ot = r.state === 'present' ? Math.max(0, +r.ot || 0) : 0;
      const rec = { ...correction(ws, { date: d.date, key, personId: r.id || '', name: r.name, state: r.state, ot }, `Site: ${d.byName || 'Field Report'}`, d.at || ''), site: true };
      // the same as the report said: nothing to correct
      if (!old && rec.was && rec.was.state === rec.state && rec.was.ot === rec.ot) continue;
      if (old) Object.assign(old, rec); else ws.attendance.push(rec);
      n++;
    }
  }
  return n;
}

// ---- v0.50.0 (Phase B6): the morning crew photo beside each day, the people delegated to the project, office staff ----

/**
 * The morning crew photo of a report: { time, st: 'ontime' | 'late', tags, geo, fileId }, or null. Field Report writes
 * "Morning crew · On time 07:55 · Taken offline" in the caption; from 2.22.0 it also sends `crew` { st, tags, geo }.
 */
export function crewPhotoOf(report) {
  const p = (report?.field?.photoFiles || []).filter(x => /morning crew|^crew$/i.test(String(x.caption || '').trim()) || x.crew).sort((a, b) => String(a.time).localeCompare(String(b.time)))[0];
  if (!p) return null;
  const cap = String(p.caption || '');
  const st = p.crew?.st === 'late' || /late attendance/i.test(cap) ? 'late' : 'ontime';
  const tags = p.crew?.tags?.length ? p.crew.tags : cap.split('·').slice(2).join(',').split(',').map(x => x.trim()).filter(Boolean);
  return { time: p.time || '', st, tags, geo: p.crew?.geo || null, fileId: p.fileId || '' };
}
export const PHOTO_WORD = { ontime: 'On time', late: 'Late', missing: 'Missing' };

/** The crew photo state of one day: on time, late, missing (a working day with a report and no photo) or '' (nothing to say). */
export function photoDay(ws, date) {
  const reps = (ws.reports || []).filter(r => r.date === date && r.field && !r.field.nowork);
  if (!reps.length) return { state: '' };
  const ph = reps.map(crewPhotoOf).find(Boolean);
  return ph ? { state: ph.st, ...ph } : { state: 'missing' };
}

/** Needs attention for the Project Engineer and the GM: a late or missing crew photo in the last 3 days. */
export function crewPhotoFlags(ws, today) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    const d = fromDay(toDay(today) - i), s = photoDay(ws, d);
    if (s.state === 'missing') out.push({ sev: 'high', kind: 'Attendance', title: `No morning crew photo on ${d}`, detail: 'The report came without the crew photo.', link: 'attendance' });
    else if (s.state === 'late') out.push({ sev: 'warn', kind: 'Attendance', title: `Crew photo late on ${d}`, detail: `Taken at ${s.time}${s.tags.length ? ` (${s.tags.join(', ')})` : ''}.`, link: 'attendance' });
  }
  return out;
}

/** The people of the Manpower Directory delegated to the project (Tier 1 is not on any sheet), as sheet rows to show. */
export function delegated(staff, projectId, tierOf) {
  return (staff || []).filter(p => p.status !== 'left' && (p.assignments || []).some(a => a.active !== false && a.projectId === projectId) && tierOf(p) !== 1)
    .map(p => ({ id: '', personId: p.id, name: p.name, role: p.title || '' }));
}

/** Office staff (no project) are marked by HR or the Admin in Central Hub: company.officeAttendance [{ id, date, personId, name, state }]. */
export const officeId = (date, personId) => `oa_${date}_${personId}`;
/** The office marks as daily reports, so the sheet and Payroll read them the same way as the site's. */
export function officeReports(list) {
  const by = new Map();
  for (const m of list || []) {
    if (!m.state || m.state === 'none') continue;
    if (!by.has(m.date)) by.set(m.date, { id: `office_${m.date}`, date: m.date, review: 'done', field: { attendance: [] } });
    by.get(m.date).field.attendance.push({ id: '', name: m.name, state: m.state });
  }
  return [...by.values()];
}

/** v0.50.1: the office staff: not left, not Tier 1, on no project. Names and positions only, for HR's list. */
export const officeStaffOf = (staff, tierOf) => (staff || []).filter(p => p.status !== 'left' && tierOf(p) !== 1 && !(p.assignments || []).some(a => a.active !== false))
  .map(p => ({ id: p.id, name: p.name || '', title: p.title || '' })).sort((a, b) => a.name.localeCompare(b.name));
/** Is the kept list behind the directory? */
export const officeStaffStale = (kept, now) => JSON.stringify((kept || []).map(({ id, name, title }) => ({ id, name, title })).sort((a, b) => a.name.localeCompare(b.name))) !== JSON.stringify(now);
