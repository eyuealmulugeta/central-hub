// Today (v0.22.0, docs/plan-hub-makeover.md part 3): what needs this person, across all projects. A card per
// project with its health, then what needs them most urgent first, this week, and what they wait on others for.
// Pure: the screen (ui/home.js) passes in the project summaries and the open project's derived figures.

import { toDay, fromDay } from '../core/util.js';

const SEV = { high: 0, warn: 1, info: 2 };
const WEEK = 7;

/** A project's health from its summary: { tone: ok | warn | bad | none, label }. */
export function healthOf(s = {}) {
  if (s.basis === 'none' || s.basis == null) return { tone: 'none', label: 'No schedule yet' };
  if (s.basis === 'billed') return { tone: 'ok', label: `${Math.round(s.progress || 0)} % invoiced` };
  const slip = +s.slip || 0;
  if (slip > 5) return { tone: 'bad', label: `${slip} days behind` };
  if (slip > 0) return { tone: 'warn', label: `${slip} day${slip > 1 ? 's' : ''} behind` };
  if (slip < 0) return { tone: 'ok', label: `${-slip} day${slip < -1 ? 's' : ''} ahead` };
  return { tone: 'ok', label: 'On plan' };
}

/** The one line under a project card: reports to approve first, then a long silence from site, then the last report. */
export function projectLine(s = {}, today) {
  if (s.waiting > 0) return { tone: 'warn', text: `${s.waiting} daily report${s.waiting > 1 ? 's' : ''} to approve` };
  if (!s.lastReport) return { tone: 'none', text: 'No daily report yet' };
  const days = toDay(today) - toDay(s.lastReport);
  if (days > 2) return { tone: 'bad', text: `No daily report for ${days} days` };
  return { tone: 'ok', text: days <= 0 ? 'Reported today' : days === 1 ? 'Reported yesterday' : `Last report ${days} days ago` };
}

/**
 * What needs this person, most urgent first. The open project's alerts (already filtered to what they may open),
 * its requests waiting for an answer, and one line for each other project that has something waiting.
 * @returns [{ sev, kind, title, detail, link, projectId }]
 */
export function needsYou({ project, flags, requests = [], others = [], approver = false }) {
  const out = [];
  for (const f of flags?.auto || []) if (f.sev !== 'info' || f.kind === 'Reporting') out.push({ ...f, projectId: project.id, project: project.name });
  if (approver) {
    const asked = requests.filter(r => r.status === 'requested');
    const urgent = asked.filter(r => /urgent|high/i.test(r.priority || ''));
    if (asked.length) out.push({ sev: urgent.length ? 'high' : 'warn', kind: 'Requests', title: `${asked.length} site request${asked.length > 1 ? 's' : ''} waiting for an answer`, detail: urgent.length ? `${urgent.length} marked urgent` : 'Material, manpower or equipment', link: 'requests', projectId: project.id, project: project.name });
  }
  for (const s of others) {
    const waiting = +s.waiting || 0, alerts = +s.unseen || 0;
    if (!waiting && !alerts) continue;
    const parts = [waiting ? `${waiting} report${waiting > 1 ? 's' : ''} to approve` : '', alerts ? `${alerts} new alert${alerts > 1 ? 's' : ''}` : ''].filter(Boolean);
    out.push({ sev: waiting ? 'warn' : 'info', kind: 'Other project', title: s.project.name, detail: parts.join(', '), link: waiting ? 'reports' : 'dashboard', projectId: s.project.id, project: s.project.name, other: true });
  }
  // the open project's reports to approve lead, as on the phone
  const lead = f => (f.link === 'reports' && !f.other ? -1 : 0);
  return out.sort((a, b) => lead(a) - lead(b) || SEV[a.sev] - SEV[b.sev]);
}

/**
 * This week, from today: schedule tasks and milestones due to finish, follow-ups due, and meetings.
 * @returns [{ day: ISO date, kind, title, detail, link }] by day
 */
export function thisWeek({ today, rows = [], items = [], meetings = [] }) {
  const T = toDay(today), end = T + WEEK;
  const out = [];
  for (const r of rows) if ((r.progress || 0) < 100 && r.ef >= T && r.ef < end) out.push({ day: fromDay(r.ef), kind: r.milestone ? 'Milestone' : 'Task due', title: r.name, detail: `${Math.round(r.progress || 0)} % done`, link: 'schedule' });
  for (const i of items) if (i.status === 'open' && i.due && toDay(i.due) >= T && toDay(i.due) < end) out.push({ day: i.due, kind: 'Follow-up', title: i.title, detail: i.owner ? `With ${i.owner}` : '', link: 'dashboard' });
  for (const m of meetings) {
    const day = String(m.start || '').slice(0, 10);
    if (day && toDay(day) >= T && toDay(day) < end) out.push({ day, kind: 'Meeting', title: m.title || m.typeName || 'Meeting', detail: String(m.start).slice(11, 16), link: 'meetings' });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

/** Follow-ups that wait on someone else: open, with an owner, oldest first. */
export const waitingOn = items => items.filter(i => i.status === 'open' && i.owner).sort((a, b) => String(a.created || '').localeCompare(String(b.created || '')));
