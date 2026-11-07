// v1.7.0 (owner, 7 Nov, G3): engagement. From the sign-in history (both apps): who is online now, each person's active
// minutes today, this week and this month, the work days they used the apps, when they last opened one, and who has not
// opened any for 3 work days or more. Seen by the Admin and the GM only (owner). Pure functions.

import { activeOf, isOnline, endOf, day } from './signlog.js';

export const QUIET_DAYS = 3;
export const mayView = (role, ranks = []) => role === 'owner' || (ranks || []).includes('general_manager');

const toMs = d => Date.parse(`${d}T00:00:00Z`);
const addDays = (d, n) => new Date(toMs(d) + n * 864e5).toISOString().slice(0, 10);
const dow = d => new Date(toMs(d)).getUTCDay();
const isWork = (d, workDays) => workDays.includes(dow(d));
/** Monday of the week of d. */
export const weekStart = d => addDays(d, -((dow(d) + 6) % 7));
/** Work days from a (excluded) to b (included). */
export function workDaysBetween(a, b, workDays = [1, 2, 3, 4, 5, 6]) {
  let n = 0;
  for (let d = addDays(a, 1); d <= b; d = addDays(d, 1)) if (isWork(d, workDays)) n++;
  return n;
}

/**
 * One row per person: { email, name, position, apps, today, week, month (active minutes), daysUsed, workDays (this month
 * so far), last (ms), quietDays (work days since the last day used), online }.
 * people = the accounts that should use the apps ([{ email, name, position }]), so someone who never opened one shows too.
 */
export function rows(list, now, { people = [], workDays = [1, 2, 3, 4, 5, 6] } = {}) {
  const today = day(now), week = weekStart(today), month = today.slice(0, 8) + '01';
  const m = new Map();
  const row = (email, name = '', position = '') => {
    const k = String(email || '').toLowerCase();
    if (!m.has(k)) m.set(k, { email: k, name: name || k, position, apps: new Set(), today: 0, week: 0, month: 0, days: new Set(), last: 0, online: false });
    const r = m.get(k);
    if (name && r.name === k) r.name = name; if (position && !r.position) r.position = position;
    return r;
  };
  for (const p of people) if (p?.email) row(p.email, p.name, p.position);
  for (const e of list || []) {
    if (!e?.email) continue;
    const r = row(e.email, e.name, e.position), d = day(+e.start), a = activeOf(e, now);
    r.apps.add(e.app);
    if (d === today) r.today += a;
    if (d >= week) r.week += a;
    if (d >= month) { r.month += a; if (a > 0) r.days.add(d); }
    r.last = Math.max(r.last, endOf(e, now) || now);
    r.online ||= isOnline(e, now);
  }
  const wdMonth = workDaysBetween(addDays(month, -1), today, workDays);
  return [...m.values()].map(r => {
    const lastDay = r.last ? day(r.last) : '';
    return { ...r, apps: [...r.apps], days: undefined, daysUsed: r.days.size, workDays: wdMonth, quietDays: lastDay ? workDaysBetween(lastDay, today, workDays) : null };
  }).sort((a, b) => (b.quietDays ?? 999) - (a.quietDays ?? 999) || a.week - b.week || a.name.localeCompare(b.name));
}
export const isQuiet = r => r.quietDays == null || r.quietDays >= QUIET_DAYS;

/** Per position and app: people, average active minutes this week. */
export function byPosition(list, now) {
  const today = day(now), week = weekStart(today), m = new Map();
  for (const e of list || []) {
    if (!e?.email || day(+e.start) < week) continue;
    const k = `${e.position || 'No position'}|${e.app}`;
    const g = m.get(k) || { position: e.position || 'No position', app: e.app, people: new Set(), minutes: 0 };
    g.people.add(e.email); g.minutes += activeOf(e, now); m.set(k, g);
  }
  return [...m.values()].map(g => ({ position: g.position, app: g.app, people: g.people.size, avg: Math.round(g.minutes / g.people.size) }))
    .sort((a, b) => a.position.localeCompare(b.position) || a.app.localeCompare(b.app));
}

/** The GM's Sunday line: the people who used the apps least this week. */
export function leastLine(rs, n = 3) {
  const low = [...rs].sort((a, b) => a.week - b.week).slice(0, n);
  return low.length ? `Least use this week: ${low.map(r => `${r.name} ${r.week} min`).join(', ')}.` : '';
}

export function csvRows(rs) {
  const out = [['Name', 'Email', 'Position', 'Apps', 'Active today (min)', 'This week (min)', 'This month (min)', 'Days used this month', 'Work days this month', 'Last opened', 'Work days since']];
  for (const r of rs) out.push([r.name, r.email, r.position, r.apps.join(' + '), r.today, r.week, r.month, r.daysUsed, r.workDays, r.last ? new Date(r.last + 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : 'Never', r.quietDays ?? '']);
  return out;
}
