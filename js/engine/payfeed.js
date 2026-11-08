// v1.17.0 (owner, 8 Nov, G8): the Excel pay link. One private read-only link per project, made by the Admin or the GM
// only, that stops by itself after 30 days. Excel's Data > From Web opens it: attendance by day, the crew pay sheets
// (the same figures as Money > Payments), the monthly staff of the project (Payroll) and progress. Names and pay are
// in it, so it is never part of the money link (G7). Pure: the server (functions/payfeed.js) gives it the records.

import { register, periodFor } from './attendance.js';
import { payLines, wageOf, runStatus, STATUS_LABEL } from './crewpay.js';
import { compute, statusLabel } from './payroll.js';
import { taskProgress } from './excelfeed.js';

export const KEY_RE = /^[A-Za-z0-9]{32}$/;
export const FEED_URL = 'https://europe-west1-amistad-ops.cloudfunctions.net/payFeed';
export const linkOf = key => (key ? `${FEED_URL}?k=${key}` : '');
/** The owner's choice: a pay link stops by itself after 30 days; a new one is made then. */
export const LINK_DAYS = 30;
/** The Admin and the GM make, renew and turn off pay links (owner, G8). */
export const mayLink = (role, ranks = []) => role === 'owner' || (ranks || []).includes('general_manager');
/** The project records the feed reads. */
export const SECTIONS = ['team', 'reports', 'attendance', 'payruns', 'payments', 'penalties', 'laborRates', 'crewRates', 'tasks'];
/** How many months of attendance and pay go in (this month and the two before). */
export const MONTHS_BACK = 2;

const r2 = v => (Number.isFinite(+v) ? Math.round(+v * 100) / 100 : 0);
const day = d => String(d || '').slice(0, 10);
const WORD = { present: 'Present', absent: 'Absent', sick: 'Sick', leave: 'Leave', none: 'Cleared' };
const monthsBack = (today, n) => { const [y, m] = today.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 - n, 1)); return d.toISOString().slice(0, 10); };
const plusDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** The pay periods of the window: every run's period since `from`, and the periods up to today. Newest first. */
export function periodsOf(project, ws, from, today) {
  const seen = new Map();
  for (const r of ws.payruns || []) if (r?.from && r.to && r.to >= from && r.from <= today) seen.set(r.from, { from: r.from, to: r.to });
  for (let d = today, guard = 0; d >= from && guard < 120; guard++) {
    const p = periodFor(project, d);
    if (!p?.from) break;
    if (!seen.has(p.from)) seen.set(p.from, { from: p.from, to: p.to });
    d = plusDays(p.from, -1);
  }
  return [...seen.values()].sort((a, b) => b.from.localeCompare(a.from));
}

/**
 * The tables, as [{ name, rows }] with a header row first.
 * @param o { project, ws, staff, payroll, crew, monthlyRoles, today }  crew: the active site team, as the Payments page uses
 */
export function payTables({ project = {}, ws = {}, staff = [], payroll = [], crew = [], monthlyRoles, today = '' }) {
  const w = { team: [], reports: [], attendance: [], payruns: [], payments: [], penalties: [], ...ws };
  const from = monthsBack(today, MONTHS_BACK);
  const ctx = { project, ws: w, staff, crew, ...(monthlyRoles ? { monthlyRoles } : {}) };

  // Attendance: one row per person per day reported
  const sheet = register(project, w, { from, to: today }, crew);
  const att = [];
  for (const row of sheet.rows) for (const [d, c] of Object.entries(row.cells)) att.push([d, row.name, row.role, WORD[c.state] || c.mark, r2(c.ot), c.fixed ? 'Yes' : '']);
  att.sort((a, b) => b[0].localeCompare(a[0]) || a[1].localeCompare(b[1]));

  // Salary: the crew pay sheets of each period
  const pay = [], sums = [];
  for (const p of periodsOf(project, w, from, today)) {
    const { run, lines, totals } = payLines(ctx, p);
    const status = STATUS_LABEL[runStatus(run, lines)] || 'Draft';
    for (const l of lines) pay.push([p.from, p.to, l.name, l.role, l.per === 'month' ? 'Month' : 'Day', r2(l.wage), l.currency || '', l.present || 0, l.absent || 0, r2(l.ot), r2(l.earned), r2(l.adjust), r2(l.penalty), r2(l.brought), r2(l.due), r2(l.paid), r2(l.outstanding), status]);
    if (lines.length) sums.push([p.from, p.to, lines.length, r2(totals.earned), r2(totals.due), r2(totals.paid), r2(totals.outstanding), status]);
  }

  // Monthly staff of this project (Payroll)
  const mine = new Set(staff.filter(s => s.projectId === project.id || (s.assignments || []).some(a => a.projectId === project.id && a.active !== false)).map(s => s.id));
  const monthly = [];
  for (const run of payroll.filter(r => r && r.month >= from.slice(0, 7)).sort((a, b) => b.month.localeCompare(a.month))) {
    for (const l of run.lines || []) {
      if (!mine.has(l.staffId)) continue;
      const c = compute(l, run.settings);
      monthly.push([run.month, l.name || '', l.title || '', l.payPer || 'month', r2(l.rate), l.currency || '', r2(l.days), r2(l.ot), c.gross, c.deductions, c.net, statusLabel(run.status)]);
    }
  }

  // Progress
  const prog = taskProgress(w.tasks, w.reports);
  const rates = (w.team || []).filter(m => m.active !== false).map(m => { const p = wageOf({ id: m.id, key: m.id, role: m.role, name: m.name }, ctx); return [m.name || '', m.role || '', p.per === 'month' ? 'Month' : 'Day', r2(p.wage), p.currency || '']; });

  return [
    { name: 'Summary', rows: [['Item', 'Value'], ['Project', project.name || ''], ['Pay currency', project.payCurrency || project.currency || ''], ['From', from], ['To', today],
      ['People on the team', (w.team || []).filter(m => m.active !== false).length], ['Attendance rows', att.length], ['Pay periods', sums.length], ['Updated', today]] },
    { name: 'Pay periods', rows: [['From', 'To', 'People', 'Earned', 'Due', 'Paid', 'Outstanding', 'Status'], ...sums] },
    { name: 'Salary', rows: [['From', 'To', 'Name', 'Trade', 'Paid per', 'Wage', 'Currency', 'Days present', 'Days absent', 'Overtime hours', 'Earned', 'Adjustment', 'Penalties', 'Brought forward', 'Due', 'Paid', 'Outstanding', 'Status'], ...pay] },
    { name: 'Attendance', rows: [['Date', 'Name', 'Trade', 'Mark', 'Overtime hours', 'Corrected by the office'], ...att] },
    { name: 'Monthly staff', rows: [['Month', 'Name', 'Title', 'Paid per', 'Rate', 'Currency', 'Days', 'Overtime hours', 'Gross', 'Deductions', 'Net', 'Status'], ...monthly] },
    { name: 'Rates', rows: [['Name', 'Trade', 'Paid per', 'Wage', 'Currency'], ...rates] },
    { name: 'Progress', rows: [['Task', 'Total quantity', 'Unit', 'Done quantity', '% done', 'Delay days', 'Last report'],
      ...(w.tasks || []).map(t => { const p = prog[t.id] || {}; return [t.name || '', r2(t.totalQty), t.unit || '', p.qty || 0, p.pct ?? '', p.delay || 0, day(p.last)]; })] },
  ];
}
