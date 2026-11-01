// Pay rules of Phase B4 (v0.48.0). Who is paid monthly (Tiers 1, 2, 3 and 5, in Payroll) and who by the day (Tier 4,
// in crew Payments); the steps of a pay run (Draft, Checked, Approved, Paid, Payslips shared); the Site Engineer's
// check of days and hours, kept with the attendance records (Site may write those, never pay); the tax and pension
// rates with the month they apply from; and the history of a person's pay. Pure functions.

import { tierOfPerson } from './manpower.js';
import { tierOfPosition } from './positions.js';
import { periodFor } from './attendance.js';

/** Paid by the month: anyone whose tier is 1, 2, 3 or 5. Tier 4 and a person with no tier are paid by the day. */
export function isMonthly(person, role = '') {
  const t = (person && tierOfPerson(person)) || tierOfPosition(role);
  return !!t && t !== 4;
}

export const STEPS = [['draft', 'Draft'], ['checked', 'Checked'], ['approved', 'Approved'], ['paid', 'Paid'], ['shared', 'Payslips shared']];
export const stepLabel = id => STEPS.find(([k]) => k === id)?.[1] || id;
export const stepTone = id => (id === 'draft' ? 'warn' : id === 'checked' ? 'info' : 'ok');

// ---- the Site Engineer's check of a crew pay period (a record in the attendance section) ----
export const checkId = from => `ck_${from}`;
/** `review: 'check'` keeps it out of the attendance fixes (liveFixes) and the site corrections waiting. */
export const checkRecord = (period, { by, byName = '', at }) => ({ id: checkId(period.from), kind: 'check', review: 'check', from: period.from, to: period.to, by, byName, at });
export const checkOf = (ws, from) => (ws?.attendance || []).find(r => r.id === checkId(from) && r.kind === 'check') || null;

/**
 * May `me` approve a run checked by `checkedBy`? Approving needs the check first (owner, 1 Nov 2026), and nobody
 * approves what they checked themselves; the Admin may still do it after saying so (`self` true: it is recorded).
 */
export function mayApprove({ checkedBy = '', me = '', admin = false }) {
  if (!checkedBy) return { ok: false, why: 'The days and hours are not checked yet.' };
  if (String(checkedBy).toLowerCase() !== String(me).toLowerCase()) return { ok: true, self: false };
  return admin ? { ok: true, self: true } : { ok: false, why: 'You checked this run: someone else approves it.' };
}

// ---- tax and pension rates, each from a month on (entered once, never fixed in the code) ----
/** The rates that apply to `month` (YYYY-MM): the latest entry starting on or before it; null when none. */
export function ratesFor(list, month) {
  return (list || []).filter(r => r && /^\d{4}-\d{2}$/.test(r.from) && r.from <= month).sort((a, b) => b.from.localeCompare(a.from))[0] || null;
}

/** Bands typed one per line as "up to, rate %, deduction" (the last may have no "up to"). Bad lines are left out. */
export function parseBands(text) {
  return String(text || '').split(/\n/).map(l => l.split(/[,;\t]/).map(x => x.trim())).filter(x => x.some(Boolean))
    .map(([upTo, rate, deduct]) => ({ upTo: upTo === '' || /^(above|over|-|\*)$/i.test(upTo) ? null : +upTo, rate: +rate, deduct: +deduct || 0 }))
    .filter(b => (b.upTo === null || Number.isFinite(b.upTo)) && Number.isFinite(b.rate) && b.rate >= 0)
    .sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
}
export const bandsText = bands => (bands || []).map(b => `${b.upTo ?? 'above'}, ${b.rate}, ${b.deduct || 0}`).join('\n');

/** Income tax on a monthly taxable income by bands: income x rate % - the band's deduction, never below 0. */
export function bandTax(income, bands) {
  const x = +income || 0;
  if (!(x > 0) || !bands?.length) return 0;
  const b = bands.find(y => y.upTo === null || x <= y.upTo) || bands[bands.length - 1];
  return Math.max(0, Math.round((x * b.rate / 100 - (b.deduct || 0)) * 100) / 100);
}

// ---- a person's pay over time ----
/** The pay history with a change from `from` (YYYY-MM-DD) added; one entry per date, oldest first. Pure. */
export function withPayChange(history, { from, pay, payPer, currency, by = '' }) {
  const list = (history || []).filter(h => h.from !== from);
  return [...list, { from, pay: +pay || 0, payPer: payPer || 'month', currency: currency || '', by }].sort((a, b) => a.from.localeCompare(b.from));
}
/** The pay that applied on a date: the history entry in force then, else the agreement as it is now. */
export function payOn(person, date) {
  const h = (person?.payHistory || []).filter(x => x.from <= date).sort((a, b) => b.from.localeCompare(a.from))[0];
  const a = person?.agreement || {};
  return h ? { pay: h.pay, payPer: h.payPer, currency: h.currency || a.currency || '' } : { pay: +a.pay || 0, payPer: a.payPer || 'month', currency: a.currency || '' };
}

// ---- v0.48.1 (B4b): drafts made by the server, reminders, and the reports after approval ----
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const lastOf = month => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);

/** The day the month's payroll draft is made: the day the Admin set (1-31), else the last working day (not a Sunday). */
export function payrollDay(month, day = 0) {
  const last = lastOf(month);
  if (+day >= 1) return +day >= +last.slice(8) ? last : `${month}-${String(+day).padStart(2, '0')}`;
  let d = last;
  while (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) d = addDays(d, -1);
  return d;
}

/** The crew pay period that ended before today's, when the project has no pay run for it yet; else null. */
export function crewDraftDue(project, runs, today) {
  const now = periodFor(project, today);
  const last = periodFor(project, addDays(now.from, -1));
  return (runs || []).some(r => r.from === last.from) ? null : last;
}

/** Does the month need its payroll draft today? Not before the payroll day, and not when a run exists. */
export const payrollDue = (runs, month, today, day = 0) => today >= payrollDay(month, day) && !(runs || []).some(r => r.month === month);

/** Needs attention, every day until it is done: pay sheets to check or approve, and the payroll steps (Admin). */
export function payFlags({ ws, company, today, admin = false, payrollDayOf = 0 }) {
  const out = [];
  const flag = (sev, title, detail, link) => out.push({ sev, kind: 'Pay', title, detail, link });
  for (const r of ws?.payruns || []) {
    if (r.status !== 'draft' || !(r.to < today)) continue;
    if (!checkOf(ws, r.from)) flag('warn', `Check the days and hours of ${r.from} to ${r.to}`, 'The Site Engineer checks the attendance; then the pay is approved.', 'attendance');
    else flag('warn', `Approve the crew pay of ${r.from} to ${r.to}`, 'The days and hours are checked.', 'payments');
  }
  if (!admin) return out;
  for (const r of company?.payroll || []) {
    if (r.status === 'draft' && today >= payrollDay(r.month, payrollDayOf)) flag('warn', `Check the payroll of ${r.month}`, r.auto ? 'Made by the server; fill in what is missing, then mark it checked.' : 'Fill in what is missing, then mark it checked.', 'payroll');
    else if (r.status === 'checked') flag('warn', `Approve the payroll of ${r.month}`, `Checked by ${r.checkedBy || 'the office'}.`, 'payroll');
    else if (r.status === 'approved') flag('info', `Pay the payroll of ${r.month}`, 'Then mark it paid.', 'payroll');
    else if (r.status === 'paid') flag('info', `Share the payslips of ${r.month}`, 'Send each person their payslip, then mark them shared.', 'payroll');
  }
  return out;
}

const csvCell = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
export const csvText = rows => rows.map(r => r.map(csvCell).join(',')).join('\n');

/** The report of an approved crew pay sheet: one line a person, the totals, and the labour cost against the budget. */
export function crewReport({ project, period, lines, labourToDate = 0, budget = 0 }) {
  const sum = new Map();
  for (const l of lines) sum.set(l.currency || '', (sum.get(l.currency || '') || 0) + (+l.earned || 0));
  const rows = [['Weekly crew pay', project?.name || '', `${period.from} to ${period.to}`], [], ['Name', 'Trade', 'Days', 'Earned', 'Currency'],
    ...lines.map(l => [l.name, l.trade || l.role || '', l.days ?? l.present ?? '', Math.round((+l.earned || 0) * 100) / 100, l.currency || '']), [],
    ...[...sum].map(([cur, v]) => ['Total', '', '', Math.round(v * 100) / 100, cur])];
  if (budget) rows.push([], ['Labour cost to date', '', '', Math.round(labourToDate * 100) / 100, project?.currency || ''], ['Project budget', '', '', budget, project?.currency || '']);
  return csvText(rows);
}

/** The report of an approved payroll: the totals of each currency, with tax and pension. */
export function payrollReport(run, totalsByCurrency) {
  return csvText([['Monthly payroll', run.month, run.division || ''], [], ['Currency', 'People', 'Gross', 'Income tax', 'Pension (employee)', 'Pension (employer)', 'Net', 'Cost to the company'],
    ...totalsByCurrency.map(t => [t.currency, t.people, t.gross, t.tax, t.pensionEmployee, t.pensionEmployer, t.net, t.cost])]);
}

/** Who gets the reports: the list the Admin keeps (global payReportTo), else the Admin alone. */
export const reportList = (global, adminEmail = '') => {
  const list = String(global?.payReportTo || '').split(/[,;\s]+/).filter(x => /@/.test(x));
  return list.length ? list : adminEmail ? [adminEmail] : [];
};
