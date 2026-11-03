// Today (v0.22.0, docs/plan-hub-makeover.md part 3): what needs this person, across all projects. A card per
// project with its health, then what needs them most urgent first, this week, and what they wait on others for.
// Pure: the screen (ui/home.js) passes in the project summaries and the open project's derived figures.

import { mayApprove, LEVEL_NAME } from './expenses.js';
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
 * v0.60.0 (owner, 2 Nov): "Needs you" grouped by the type of message (Field reports, Requests, Other project...).
 * The groups with something urgent come first, then the bigger ones; inside a group the order stays (most urgent first).
 * @returns [{ kind, items, high }]
 */
export function needGroups(needs = []) {
  const map = new Map();
  for (const n of needs) {
    const k = n.kind || 'Other';
    if (!map.has(k)) map.set(k, { kind: k, items: [], high: 0, at: map.size });
    const g = map.get(k); g.items.push(n); if (n.sev === 'high') g.high++;
  }
  return [...map.values()].sort((a, b) => (b.high > 0) - (a.high > 0) || b.items.length - a.items.length || a.at - b.at)
    .map(({ kind, items, high }) => ({ kind, items, high }));
}

/**
 * What needs this person, most urgent first. The open project's alerts (already filtered to what they may open),
 * its requests waiting for an answer, and one line for each other project that has something waiting.
 * @returns [{ sev, kind, title, detail, link, projectId }]
 */
export function needsYou({ project, flags, requests = [], others = [], approver = false, gm = false, trades = [], meetings = [], now = Date.now(), today = '', weekly = false, bills = [], level = 0, me = '', settings = null }) {
  const out = [];
  for (const f of flags?.auto || []) if (f.sev !== 'info' || f.kind === 'Reporting') out.push({ ...f, projectId: project.id, project: project.name });
  if (approver) {
    const asked = requests.filter(r => r.status === 'requested' && r.kind !== 'expense');
    const urgent = asked.filter(r => /urgent|high/i.test(r.priority || ''));
    if (asked.length) out.push({ sev: urgent.length ? 'high' : 'warn', kind: 'Requests', title: `${asked.length} site request${asked.length > 1 ? 's' : ''} waiting for an answer`, detail: urgent.length ? `${urgent.length} marked urgent` : 'Material, manpower or equipment', link: 'requests', projectId: project.id, project: project.name });
    // v0.61.0: approved expenses to pay (the office)
    const toPay = requests.filter(r => r.kind === 'expense' && r.status === 'approved');
    if (toPay.length) out.push({ sev: 'info', kind: 'Expenses', title: `${toPay.length} approved expense${toPay.length > 1 ? 's' : ''} to pay`, detail: 'Mark each paid with the method and the bank reference', link: 'requests', projectId: project.id, project: project.name });
  }
  // v0.69.0: expenses this person may approve (by position and amount; a Site Engineer too)
  const decide = requests.filter(r => r.kind === 'expense' && mayApprove(r, { level, me }, settings));
  if (decide.length) out.push({ sev: 'warn', kind: 'Expenses', title: `${decide.length} expense${decide.length > 1 ? 's' : ''} to approve`, detail: level === 3 ? 'Above the engineers\' limits, in USD, or waiting for the GM' : `Within your limit as ${LEVEL_NAME[level]}`, link: 'requests', projectId: project.id, project: project.name });
  // v0.68.0: supplier bills overdue or due within 7 days
  const overdueBills = bills.filter(b => b.status === 'overdue'), dueBills = bills.filter(b => b.status === 'due');
  if (overdueBills.length) out.push({ sev: 'high', kind: 'Supplier bills', title: `${overdueBills.length} supplier bill${overdueBills.length > 1 ? 's' : ''} overdue`, detail: overdueBills.map(b => b.supplier).join(', '), link: 'ledger', projectId: project.id, project: project.name });
  if (dueBills.length) out.push({ sev: 'warn', kind: 'Supplier bills', title: `${dueBills.length} supplier bill${dueBills.length > 1 ? 's' : ''} due within 7 days`, detail: dueBills.map(b => b.supplier).join(', '), link: 'ledger', projectId: project.id, project: project.name });
  // v0.66.0 (owner): every Sunday, the week's client report
  if (weekly) out.push({ sev: 'warn', kind: 'Weekly report', title: `Weekly report ready to send: ${project.name}`, detail: 'Made from this week\'s approved daily reports. Choose 6 to 12 photos, approve and email it.', link: 'docs', projectId: project.id, project: project.name });
  // v0.64.0: this person's meetings later today
  for (const m of meetings) {
    const t = Date.parse(m.start);
    if (m.status === 'cancelled' || !today || String(new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString()).slice(0, 10) !== today || t + (m.minutes || 0) * 60000 < now) continue;
    out.push({ sev: t - now <= 30 * 60000 ? 'warn' : 'info', kind: 'Meetings', title: `${m.title || m.typeName || 'Meeting'} at ${new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, detail: m.where || '', link: 'meetings', projectId: project.id, project: project.name });
  }
  // v0.63.0: trades at 90 % or more of their labour budget
  for (const l of trades) out.push({ sev: l.level === 'over' ? 'high' : 'warn', kind: 'Labour budget', title: `${l.trade}: ${l.level === 'over' ? 'over' : 'near'} its labour budget`, detail: [l.pctDays != null ? `${l.pctDays} % of the man-days` : '', l.pctCost != null ? `${l.pctCost} % of the amount` : ''].filter(Boolean).join(', '), link: 'ledger', projectId: project.id, project: project.name });
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
