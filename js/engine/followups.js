// Follow-up engine: derives flags from the schedule, BOQ and ledger, and
// decorates manual action items with overdue / reminder-due state.

import { calendarOf } from './calendar.js';
import { toDay, fmtDay, fmtDate, prevWork, money } from '../core/util.js';

const SEVERITY = { high: 0, warn: 1, info: 2 };
const ORDER_SOON_DAYS = 7;
const OVERDUE_LISTED = 5;   // overdue tasks shown one by one before the rest are grouped

export function buildFlags({ project, ws, sched, boq, led, bill, today }) {
  const T = toDay(today);
  const auto = [];
  const flag = (sev, kind, title, detail, link) => auto.push({ sev, kind, title, detail, link });

  // v0.30.0: Attention from the site (Field Report 2.7.0): a serious issue for the client, from the last 14 days
  for (const r of ws.reports || []) {
    if (!r.date || toDay(r.date) < T - 14) continue;
    for (const text of r.field?.attention || []) flag('high', 'Attention', text, `From the site, ${fmtDay(toDay(r.date))}${r.field.no ? ` · report No. ${r.field.no}` : ''}`, 'reports');
  }

  // schedule. A delay runs down the whole chain of tasks behind it, so only the tasks where the
  // delay starts are listed one by one; everything merely pushed back by them is one line.
  const slipOf = new Map(sched.rows.map(r => [r.id, r.progress < 100 ? r.slip : 0]));
  const pushed = [];
  const overdue = [];
  for (const r of sched.rows) {
    if (r.progress >= 100) continue;
    if (r.planEf < T) {
      overdue.push(r);
    } else if (r.slip > 0) {
      // behind only because something before it is at least as far behind
      if ((r.deps || []).some(d => slipOf.get(d.id) >= r.slip)) { pushed.push(r); continue; }
      const late = !r.actualStart && r.planEs < T;
      flag(r.critical ? 'warn' : 'info', late ? 'Not started' : 'Slipping', r.name,
        late ? `Planned to start ${fmtDay(r.planEs)}. Every day without a start moves the finish back a day`
          : `Forecast to finish ${r.slip} working day${r.slip > 1 ? 's' : ''} behind plan`, 'schedule');
    }
  }
  // A project that is past its planned dates can have dozens of overdue tasks. The ones furthest
  // from done are listed one by one (milestones first); the rest are one line, so the list stays readable.
  overdue.sort((a, b) => (b.milestone ? 1 : 0) - (a.milestone ? 1 : 0) || a.progress - b.progress);
  const listed = overdue.length > OVERDUE_LISTED + 1 ? overdue.slice(0, OVERDUE_LISTED) : overdue;
  for (const r of listed) {
    flag(r.critical || r.milestone ? 'high' : 'warn', r.milestone ? 'Overdue milestone' : 'Overdue task', r.name,
      `Planned for ${fmtDay(r.planEf)}, now forecast ${fmtDay(r.ef)} (${r.progress}% done)`, 'schedule');
  }
  const others = overdue.slice(listed.length);
  if (others.length) {
    flag('warn', 'Schedule', `${others.length} more overdue tasks`,
      `All past their planned finish, between ${Math.min(...others.map(r => r.progress))}% and ${Math.max(...others.map(r => r.progress))}% done. Open the schedule to see them`, 'schedule');
  }
  if (pushed.length) {
    const worst = Math.max(...pushed.map(r => r.slip));
    flag(pushed.some(r => r.critical) ? 'warn' : 'info', 'Schedule', `${pushed.length} later task${pushed.length > 1 ? 's' : ''} pushed back`,
      `Up to ${worst} working day${worst > 1 ? 's' : ''}, because of the delay${pushed.length > 1 ? 's' : ''} above: ${pushed.slice(0, 4).map(r => r.name).join(', ')}${pushed.length > 4 ? ` and ${pushed.length - 4} more` : ''}`, 'schedule');
  }
  if (sched.cyclic.length) flag('high', 'Schedule', 'Circular dependency', 'Some tasks depend on each other in a loop', 'schedule');

  // materials: the Estimate is gone (1B), so no material dates are known any more
  const needBy = {};

  // money
  if (led.budget > 0) {
    const used = led.spent / led.budget;
    if (used > 1) flag('high', 'Budget', 'Over budget', `Spent ${money(led.spent, project.currency)} of ${money(led.budget, project.currency)}`, 'ledger');
    else if (used > 0.9) flag('warn', 'Budget', 'Budget almost used', `${Math.round(used * 100)}% spent at ${Math.round(sched.progress)}% progress`, 'ledger');
    else if (led.cpi != null && led.cpi < 0.85) flag('warn', 'Budget', 'Cost running ahead of progress', `Cost performance index ${led.cpi.toFixed(2)}`, 'ledger');
  }

  // billing
  if (bill.method.startsWith('milestone')) {
    for (const s of bill.stages) {
      if (s.state === 'ready') flag('warn', 'Ready to invoice', s.name, `${money(s.amount, project.currency)} can be invoiced now`, 'docs');
    }
  }
  for (const d of ws.docs) {
    if (d.type === 'invoice' && d.status === 'sent' && toDay(d.due) < T) {
      flag('high', 'Invoice overdue', d.number, `${money(d.amountDue, project.currency)} was due ${fmtDate(d.due)}`, 'docs');
    }
  }

  const drafts = ws.docs.filter(d => d.type === 'report' && d.status === 'draft').length;
  if (drafts) flag('warn', 'Client reports', `${drafts} client report${drafts > 1 ? 's' : ''} waiting for approval`, 'Drafted but not yet approved and issued', 'docs');

  // field reports that have arrived but whose progress is not counted yet
  const unconfirmed = ws.reports.filter(r => r.review === 'pending').length;
  if (unconfirmed) {
    flag('warn', 'Field reports', `${unconfirmed} field report${unconfirmed > 1 ? 's' : ''} to confirm`,
      'Their progress is not in the schedule until the Office confirms them', 'reports');
  }

  // reporting discipline
  const lastWorkDay = prevWork(T - 1, calendarOf(project));   // a date set aside as non-working needs no report
  const lastReport = ws.reports.map(r => r.date).sort().at(-1);
  if (sched.rows.length && sched.progress < 100 && sched.start <= lastWorkDay && (!lastReport || toDay(lastReport) < lastWorkDay)) {
    flag('info', 'Reporting', 'Daily report missing',
      lastReport ? `Last report was ${fmtDate(lastReport)}` : 'No daily reports submitted yet', 'reports');
  }

  auto.sort((a, b) => SEVERITY[a.sev] - SEVERITY[b.sev]);

  // manual action items
  const items = ws.items.map(i => {
    const open = i.status === 'open';
    return {
      ...i,
      age: T - toDay(i.created),
      overdue: open && !!i.due && toDay(i.due) < T,
      reminderDue: open && i.remindEvery > 0 && T - toDay(i.lastReminded || i.created) >= i.remindEvery,
    };
  }).sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || (a.due || '9').localeCompare(b.due || '9'));

  return {
    auto, items, needBy,
    openItems: items.filter(i => i.status === 'open').length,
    count: auto.filter(f => f.sev !== 'info').length + items.filter(i => i.overdue || i.reminderDue).length,
  };
}

const TYPE_LABEL = { approval: 'Client approval', site_request: 'Site request', material: 'Material', other: 'Follow-up' };
export const itemTypeLabel = type => TYPE_LABEL[type] || TYPE_LABEL.other;

export function reminderText(item, project, today) {
  const waiting = toDay(today) - toDay(item.created);
  return {
    subject: `[${project.name}] Reminder: ${item.title}`,
    body: `Hello,\n\nThis is a reminder that the following ${itemTypeLabel(item.type).toLowerCase()} is still open on ${project.name}:\n\n` +
      `  ${item.title}\n  Raised: ${fmtDate(item.created)} (${waiting} days ago)\n` +
      (item.due ? `  Due: ${fmtDate(item.due)}\n` : '') +
      `\nPlease let us know the status.\n\nThank you.`,
  };
}
