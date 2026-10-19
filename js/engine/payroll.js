// Monthly payroll: one run per month, one line per employee, worked out from the HR agreement
// (pay and how it is counted: per month, per day or per hour) and the attendance taken on site.
// Pure functions; the screen is ui/payroll.js.
//
// What is and is not worked out here:
//   basic       monthly wage, or days worked x day rate, or hours worked x hourly rate
//   overtime    overtime hours at the hourly rate x the overtime multiplier
//   pension     a percentage of basic pay, as set on the run (employee share and employer share)
//   income tax  typed per person: tax is progressive and changes, so it is never guessed here.
//               Take the figure from your accountant or the tax authority's table.
// Money is never added across currencies: totals come out one line per currency.

import { toDay, fromDay } from '../core/util.js';

export const DEFAULT_SETTINGS = { hoursPerDay: 10, otMultiplier: 1.5, monthDays: 30, pensionEmployee: 0, pensionEmployer: 0 };

export const STATUSES = [['draft', 'Draft'], ['approved', 'Approved'], ['paid', 'Paid']];
export const statusLabel = id => STATUSES.find(([k]) => k === id)?.[1] || id;

const money2 = n => Math.round((+n || 0) * 100) / 100;
const num = v => (Number.isFinite(+v) ? +v : 0);

/** "October 2026" for 2026-10. */
export function monthLabel(month) {
  const [y, m] = String(month).split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
export const monthStart = month => `${month}-01`;
export function monthEnd(month) {
  const [y, m] = String(month).split('-').map(Number);
  return fromDay(toDay(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`) - 1);
}

/** Was this person employed at any time in the month? */
export function employedIn(staff, month) {
  if (staff.started && staff.started > monthEnd(month)) return false;
  if (staff.status === 'left' && staff.leftOn && staff.leftOn < monthStart(month)) return false;
  return true;
}

/**
 * Days present and overtime hours of one person in the month, from the attendance in daily reports.
 * A person is found by their name (any case) or by the email of a team member of the same name.
 */
export function attendanceFor(reports, month, staff) {
  const name = String(staff.name || '').trim().toLowerCase();
  let days = 0, ot = 0, absent = 0;
  for (const r of reports) {
    if (!String(r.date).startsWith(month)) continue;
    for (const a of r.field?.attendance || []) {
      if (!name || String(a.name || '').trim().toLowerCase() !== name) continue;
      if ((a.state || 'present') === 'present') days++; else if (a.state === 'absent') absent++;
      ot += num(a.ot);
    }
  }
  return { days, ot, absent, found: days + absent > 0 || ot > 0 };
}

/** One empty line for a person: how they are paid, and the figures typed or filled in for the month. */
export function newLine(staff, month, reports = []) {
  const a = staff.agreement || {};
  const att = attendanceFor(reports, month, staff);
  return {
    id: `pl-${staff.id}`, staffId: staff.id, name: staff.name || '', title: staff.title || '',
    currency: a.currency || '', payPer: a.payPer || 'month', rate: num(a.pay),
    days: att.days, ot: att.ot, unpaidDays: 0, allowances: 0, tax: 0, other: 0, notes: '',
    fromAttendance: att.found,
  };
}

/** The lines of a new run: everyone employed in the month. */
export const newLines = (staffList, month, reports) => staffList.filter(p => employedIn(p, month)).map(p => newLine(p, month, reports))
  .sort((a, b) => a.name.localeCompare(b.name));

/** What one line comes to. Rounded to cents. */
export function compute(line, s = DEFAULT_SETTINGS) {
  const set = { ...DEFAULT_SETTINGS, ...s };
  const rate = num(line.rate);
  const monthDays = set.monthDays > 0 ? set.monthDays : 30;
  const hoursPerDay = set.hoursPerDay > 0 ? set.hoursPerDay : 10;
  let basic = 0, hourly = 0;
  if (line.payPer === 'day') { basic = rate * num(line.days); hourly = rate / hoursPerDay; }
  else if (line.payPer === 'hour') { basic = rate * num(line.days) * hoursPerDay; hourly = rate; }
  else { basic = rate - (rate / monthDays) * num(line.unpaidDays); hourly = rate / monthDays / hoursPerDay; }
  basic = Math.max(0, basic);
  const overtime = hourly * num(set.otMultiplier) * num(line.ot);
  const gross = basic + overtime + num(line.allowances);
  const pensionEmployee = basic * num(set.pensionEmployee) / 100;
  const pensionEmployer = basic * num(set.pensionEmployer) / 100;
  const deductions = pensionEmployee + num(line.tax) + num(line.other);
  return {
    basic: money2(basic), overtime: money2(overtime), allowances: money2(line.allowances), gross: money2(gross),
    pensionEmployee: money2(pensionEmployee), pensionEmployer: money2(pensionEmployer), tax: money2(line.tax), other: money2(line.other),
    deductions: money2(deductions), net: money2(gross - deductions), cost: money2(gross + pensionEmployer),
  };
}

/** Totals, one entry per currency. Never mixes currencies. */
export function totals(lines, settings) {
  const by = new Map();
  for (const line of lines) {
    const c = compute(line, settings);
    const t = by.get(line.currency) || { currency: line.currency, people: 0, basic: 0, overtime: 0, allowances: 0, gross: 0, pensionEmployee: 0, pensionEmployer: 0, tax: 0, other: 0, net: 0, cost: 0 };
    t.people++;
    for (const k of ['basic', 'overtime', 'allowances', 'gross', 'pensionEmployee', 'pensionEmployer', 'tax', 'other', 'net', 'cost']) t[k] = money2(t[k] + c[k]);
    by.set(line.currency, t);
  }
  return [...by.values()].sort((a, b) => String(a.currency).localeCompare(String(b.currency)));
}

/** Things the Admin should look at before approving, in plain words. */
export function warnings(lines, settings) {
  const out = [];
  for (const l of lines) {
    if (!l.currency) out.push(`${l.name}: no currency in the agreement.`);
    if (!(num(l.rate) > 0)) out.push(`${l.name}: no pay in the agreement.`);
    if (l.payPer !== 'month' && !(num(l.days) > 0)) out.push(`${l.name}: paid ${l.payPer === 'day' ? 'per day' : 'per hour'} but no days worked entered.`);
    if (compute(l, settings).net < 0) out.push(`${l.name}: deductions are more than the pay.`);
  }
  return out;
}

/** Rows for the accountant (CSV): one per person, in the currency they are paid in. */
export function csvRows(run) {
  const head = ['Employee', 'Job title', 'Currency', 'Pay basis', 'Rate', 'Days worked', 'Overtime hours', 'Unpaid days', 'Basic', 'Overtime', 'Allowances', 'Gross', 'Pension (employee)', 'Income tax', 'Other deductions', 'Net pay', 'Pension (employer)', 'Cost to company', 'Notes'];
  const rows = run.lines.map(l => {
    const c = compute(l, run.settings);
    return [l.name, l.title, l.currency, { month: 'per month', day: 'per day', hour: 'per hour' }[l.payPer] || l.payPer, l.rate, l.days, l.ot, l.unpaidDays, c.basic, c.overtime, c.allowances, c.gross, c.pensionEmployee, c.tax, c.other, c.net, c.pensionEmployer, c.cost, l.notes || ''];
  });
  return [head, ...rows];
}
