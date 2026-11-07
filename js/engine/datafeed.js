// v1.2.0 (owner, 7 Nov, G5): the data tracker. For each project, how up to date each kind of data is kept:
// green on time, amber 1 day late, red 2 days or more; days off (the project's week, its non-working dates and the
// company holidays already written on it) are not counted; a project on hold or completed is paused. Pure: the
// server (functions/datafeed.js) runs it twice a day and saves one summary; the page and Home read that summary.

import { toDay, fromDay, isWork, dow } from '../core/util.js';
import { calendarOf } from './calendar.js';
import { statusOf } from './deployment.js';
import { isOpen } from './requests.js';

/** Who answers for an item, by position. */
export const WHO = {
  se: { label: 'Site Engineer', re: /site engineer|site supervisor|foreman/i },
  pm: { label: 'Project Manager / Coordinator', re: /project manager|coordinator|project engineer/i },
  acc: { label: 'Accountant', re: /accountant|finance/i },
};
/** The items, how often each is due, and who answers for it (the owner's list, 7 Nov). */
export const ITEMS = [
  { key: 'daily', label: 'Daily site report', every: 'day', who: 'se' },
  { key: 'attendance', label: 'Attendance', every: 'day', who: 'se' },
  { key: 'photos', label: 'Photos', every: 'day', who: 'se' },
  { key: 'weekly', label: 'Weekly report', every: 'week', who: 'pm' },
  { key: 'progress', label: 'Progress %', every: 'week', who: 'pm' },
  { key: 'requests', label: 'Material requests and deliveries', every: 'event', who: 'pm' },
  { key: 'money', label: 'Invoices and payments', every: 'month', who: 'acc' },
  { key: 'plan', label: 'Planning / schedule', every: 'month', who: 'pm' },
];
export const EVERY = { day: 'Daily', week: 'Weekly (Sunday)', month: 'Monthly', event: 'When they happen' };
export const COLOUR = { green: 'On time', amber: '1 day late', red: '2+ days late', grey: 'No data yet', paused: 'Paused' };
export const TONE = { green: 'ok', amber: 'warn', red: 'bad', grey: '', paused: '' };
const POINTS = { green: 1, amber: 0.5, red: 0 };

const dates = list => [...new Set(list.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))))].sort();
const sundayOn = n => n - dow(n);   // the Sunday on or before day n
/** Working days after `due` up to and including today; at least 1 once it is past due. */
function lateBy(due, t, wd) {
  if (due >= t) return 0;
  let n = 0;
  for (let d = due + 1; d <= t; d++) if (isWork(d, wd)) n++;
  return Math.max(1, n);
}
const colourOf = late => (late <= 0 ? 'green' : late === 1 ? 'amber' : 'red');

/**
 * The dates each item was last fed. b = { project, reports, fieldDays, docs, requests, payments, ledger, bills, planDates }.
 * planDates: the days the schedule's tasks were last saved (the server reads them from the database).
 */
export function feedDates(b) {
  const reps = (b.reports || []).filter(r => r && r.date && r.review !== 'deleted');
  return {
    daily: dates(reps.map(r => r.date)),
    attendance: dates([...reps.filter(r => r.field?.attendance || (r.crew || []).length || r.source !== 'field').map(r => r.date),
      ...(b.fieldDays || []).filter(d => d && Object.keys(d.rows || {}).length).map(d => d.date)]),
    photos: dates(reps.filter(r => (r.field?.photoFiles || []).some(p => p && p.id) || (r.photos || []).length).map(r => r.date)),
    weekly: dates((b.docs || []).filter(d => d.type === 'report' && d.kind === 'weekly').map(d => d.period?.to || d.date)),
    progress: dates(reps.filter(r => (r.entries || []).length).map(r => r.date)),
    money: dates([...(b.docs || []).filter(d => d.type === 'invoice').map(d => d.date), ...(b.payments || []).map(p => p.date || p.paidOn),
      ...(b.ledger || []).map(e => e.date), ...(b.bills || []).map(x => x.date)]),
    plan: dates(b.planDates || []),
  };
}

/** One item's state: { key, status, last, late, due, note }. */
export function itemState(item, fed, b, today) {
  const t = toDay(today), wd = calendarOf(b.project, b.reports || []);
  const list = fed[item.key] || [], last = list.filter(d => d <= today).pop() || '';
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(b.project?.start || '')) ? toDay(b.project.start) : null;
  const out = (late, due, note = '') => ({ key: item.key, status: colourOf(late), last, late, due: due == null ? '' : fromDay(due), note });
  if (item.every === 'event') {   // open requests past the day they were needed
    const late = (b.requests || []).filter(r => isOpen(r) && r.neededBy && r.neededBy < today);
    if (!late.length) return out(0, null, 'Nothing overdue');
    const due = Math.min(...late.map(r => toDay(r.neededBy)));
    return out(lateBy(due, t, wd), due, `${late.length} overdue`);
  }
  if (!last && (start == null || start > t)) return { key: item.key, status: 'grey', last: '', late: 0, due: '', note: 'No data yet' };
  if (item.every === 'day') {   // the first working day after the last one fed, if it has passed
    let d = (last ? toDay(last) : start - 1) + 1;
    while (d < t && !isWork(d, wd)) d++;
    return d >= t ? out(0, null) : out(lateBy(d, t, wd), d);
  }
  if (item.every === 'week') {   // the week Monday to Sunday that ended last Sunday
    const sun = sundayOn(t) === t ? t - 7 : sundayOn(t), mon = sun - 6;
    if (start != null && start > sun && !last) return out(0, null);
    return last && toDay(last) >= mon ? out(0, null) : out(lateBy(sun, t, wd), sun);
  }
  // month: something dated in last month or later, due its last day
  const first = toDay(`${today.slice(0, 7)}-01`), prevFirst = toDay(`${fromDay(first - 1).slice(0, 7)}-01`);
  if (start != null && start >= first && !last) return out(0, null);
  return last && toDay(last) >= prevFirst ? out(0, null) : out(lateBy(first - 1, t, wd), first - 1);
}

/** The project's people who answer for each position: { se: [{ name, email }], pm: [...], acc: [...] }. */
export function whoFor(team = [], users = []) {
  const out = { se: [], pm: [], acc: [] };
  for (const m of team) {
    if (m?.active === false) continue;
    const email = String(m.contact || m.email || '').includes('@') ? String(m.contact || m.email).toLowerCase() : '';
    for (const k of ['se', 'pm']) if (WHO[k].re.test(m.role || '')) out[k].push({ name: m.name || '', email });
  }
  for (const u of users) if ((u.ranks || []).includes('accountant') && u.email) out.acc.push({ name: u.name || u.email, email: String(u.email).toLowerCase() });
  return out;
}

/** A week's score for the daily and weekly items: the share of working days fed, and the weekly items done. */
export function weekScore(fed, b, mon, today) {
  const wd = calendarOf(b.project, b.reports || []), t = toDay(today), m = toDay(mon), end = Math.min(m + 6, t - 1);
  const parts = [];
  const days = []; for (let d = m; d <= end; d++) if (isWork(d, wd)) days.push(fromDay(d));
  if (days.length) for (const k of ['daily', 'attendance', 'photos']) { const s = new Set(fed[k]); parts.push(days.filter(d => s.has(d)).length / days.length); }
  if (m + 6 < t) for (const k of ['weekly', 'progress']) parts.push((fed[k] || []).some(d => d >= mon && d <= fromDay(m + 13)) ? 1 : 0);
  return parts.length ? Math.round(100 * parts.reduce((a, x) => a + x, 0) / parts.length) : null;
}

/** One project's row of the summary. */
export function projectRow(b, users, today) {
  const p = b.project, paused = statusOf(p) !== 'active' || !!p.hold;
  const fed = feedDates(b), who = whoFor(b.team, users);
  const items = ITEMS.map(it => {
    const s = paused ? { key: it.key, status: 'paused', last: (fed[it.key] || []).filter(d => d <= today).pop() || '', late: 0, due: '', note: '' } : itemState(it, fed, b, today);
    return { ...s, who: who[it.who] };
  });
  const t = toDay(today), mon = sundayOn(t) + 1 - (dow(t) === 0 ? 7 : 0);
  const trend = [4, 3, 2, 1].map(w => ({ week: fromDay(mon - 7 * w), score: paused ? null : weekScore(fed, b, fromDay(mon - 7 * w), today) }));
  const scored = items.filter(i => i.status in POINTS);
  return {
    id: p.id, name: p.name || p.id, code: p.fieldCode || '', paused, items, trend,
    score: paused || !scored.length ? null : Math.round(100 * scored.reduce((a, i) => a + POINTS[i.status], 0) / scored.length),
  };
}

/** The whole summary: { today, at, projects: [row] }, worst score first. */
export function summary(bundles, users, today, at = Date.now()) {
  const projects = bundles.map(b => projectRow(b, users, today)).sort((a, b) => (a.score ?? 101) - (b.score ?? 101) || a.name.localeCompare(b.name));
  return { today, at, projects };
}

/** Each person's on-time %: the average of the items they answer for, across projects. [{ email, name, score, items, red }] */
export function personScores(sum) {
  const m = new Map();
  for (const p of sum?.projects || []) for (const i of p.items) {
    if (!(i.status in POINTS)) continue;
    for (const w of i.who || []) {
      const k = w.email || w.name; if (!k) continue;
      const e = m.get(k) || { email: w.email, name: w.name, pts: 0, items: 0, red: 0 };
      e.pts += POINTS[i.status]; e.items++; if (i.status === 'red') e.red++;
      m.set(k, e);
    }
  }
  return [...m.values()].map(({ pts, ...e }) => ({ ...e, score: Math.round(100 * pts / e.items) })).sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
}

/** Items that turned red since the last summary: [{ project, item, label, who }] (the reminders). */
export function newlyRed(sum, before) {
  const was = new Set((before?.projects || []).flatMap(p => p.items.filter(i => i.status === 'red').map(i => `${p.id}|${i.key}`)));
  const label = k => ITEMS.find(i => i.key === k)?.label || k;
  return (sum?.projects || []).flatMap(p => p.items.filter(i => i.status === 'red' && !was.has(`${p.id}|${i.key}`))
    .map(i => ({ project: p.name, id: p.id, item: i.key, label: label(i.key), late: i.late, who: (i.who || []).map(w => w.email).filter(Boolean) })));
}

/** The projects one person sees: the Admin and Tier 1 all, the others the projects they are on. */
export function rowsFor(sum, { all, projects = [], email = '' }) {
  const mine = new Set(projects), e = String(email).toLowerCase();
  return (sum?.projects || []).filter(p => all || mine.has(p.id) || p.items.some(i => (i.who || []).some(w => w.email && w.email === e)));
}

/** One person's overdue items (amber or red), for their Home page. */
export const myOverdue = (sum, email) => {
  const e = String(email || '').toLowerCase();
  return !e ? [] : (sum?.projects || []).flatMap(p => p.items.filter(i => (i.status === 'red' || i.status === 'amber') && (i.who || []).some(w => w.email === e))
    .map(i => ({ project: p.name, ...i, label: ITEMS.find(x => x.key === i.key)?.label || i.key })));
};

/** The rows of the Excel file. */
export function csvRows(rows) {
  const out = [['Project', 'Code', 'Score %', ...ITEMS.flatMap(i => [i.label, `${i.label} last`])]];
  for (const p of rows) out.push([p.name, p.code, p.score ?? '', ...p.items.flatMap(i => [COLOUR[i.status] + (i.late > 1 ? ` (${i.late} days)` : ''), i.last])]);
  return out;
}

/** The Sunday evening summary for the GM: one line. */
export function weekLine(sum) {
  const rows = (sum?.projects || []).filter(p => p.score != null);
  const behind = rows.filter(p => p.score < 80);
  return behind.length ? `${behind.length} of ${rows.length} projects behind on data: ${behind.slice(0, 5).map(p => `${p.name} ${p.score}%`).join(', ')}` : `All ${rows.length} projects are up to date with their data.`;
}
