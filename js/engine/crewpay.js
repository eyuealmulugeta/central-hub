// Payments: what the site crew of a project earned in a pay period, what they were paid and what is still owed.
// Earned comes from the Attendance sheet (with the office's corrections): days present x day rate plus overtime for
// the daily-paid, the period's share of the month's wage for the monthly-paid. A period becomes a run when anything
// is done with it; approving it locks the earned figures. What is owed carries over from one run to the next.
// Each payment is also a labour expense in Costs (made by the screen, ui/payments.js). Pure functions.

import { register, daysBetween, keyOf } from './attendance.js';
import { billingOf } from './billing.js';
import { dayRateOf } from './people.js';

export const METHODS = [['cash', 'Cash'], ['bank', 'Bank transfer'], ['mobile', 'Mobile money']];
export const methodLabel = k => METHODS.find(([m]) => m === k)?.[1] || k || '';
export const runId = from => `run_${from}`;
const r2 = v => Math.round((+v || 0) * 100) / 100;
const daysInMonth = iso => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/** The positions paid by the month unless their HR agreement says otherwise (Settings, Company). Everyone else is paid per day. */
export const MONTHLY_ROLES = ['Project Engineer', 'Site Engineer'];
export const monthlyRolesOf = g => (Array.isArray(g?.monthlyRoles) ? g.monthlyRoles : MONTHLY_ROLES);
const norm = v => String(v || '').trim().toLowerCase();

/**
 * How a person on the sheet is paid: { per: 'day'|'month', wage, currency, from } where `from` says where the wage
 * was found: the person's place on this project (Crew, Employee data, Projects), their HR agreement, or the trade rates.
 * A position paid monthly with no monthly wage in the agreement comes back with from 'missing' and wage 0: it is
 * flagged, never quietly paid per day. An agreement that says "per day" wins over the position.
 */
export function wageOf(row, { ws, project, staff = [], monthlyRoles = MONTHLY_ROLES }) {
  const member = ws.team.find(m => m.id === row.id) || ws.team.find(m => keyOf({ name: m.name }) === row.key);
  const person = member?.personId ? staff.find(p => p.id === member.personId) : null;
  const a = person?.agreement || {};
  const payCur = project.payCurrency || project.currency;   // v0.25.0: the currency of this project's day rates
  const currency = a.currency || payCur;
  if (a.payPer === 'month' && +a.pay > 0) return { per: 'month', wage: +a.pay, currency, from: 'agreement' };
  const role = norm(member?.role || row.role || person?.title);
  if (a.payPer !== 'day' && role && monthlyRoles.some(r => norm(r) === role)) {
    return +a.pay > 0 && !a.payPer ? { per: 'month', wage: +a.pay, currency, from: 'agreement' } : { per: 'month', wage: 0, currency, from: 'missing' };
  }
  const day = member ? dayRateOf(ws, member.id) : 0;
  if (day > 0) return { per: 'day', wage: day, currency: payCur, from: 'project' };
  if (a.payPer === 'day' && +a.pay > 0) return { per: 'day', wage: +a.pay, currency, from: 'agreement' };
  const trade = ws.laborRates?.[member?.role || row.role];
  if (+trade > 0) return { per: 'day', wage: +trade, currency: payCur, from: 'trade' };
  return { per: 'day', wage: 0, currency: payCur, from: '' };
}

/** What a person earned in a period, from their row on the Attendance sheet. */
export function earnedOf(row, pay, project, period) {
  if (pay.per === 'month') {
    // the share of each month's wage for the days of the period in it
    return r2(daysBetween(period.from, period.to).reduce((s, d) => s + pay.wage / daysInMonth(d), 0));
  }
  const { hoursPerDay, otMultiplier } = billingOf(project);
  return r2(row.present * pay.wage + row.ot * (pay.wage / hoursPerDay) * otMultiplier);
}

/** What each person earned in a run: locked figures once approved, else worked out from the sheet. */
function earnedIn(ctx, run) {
  if (run.status !== 'draft') return new Map(Object.entries(run.lines || {}).map(([k, l]) => [k, +l.earned || 0]));
  const sheet = register(ctx.project, ctx.ws, run, ctx.crew || []);
  return new Map(sheet.rows.map(row => [row.key, earnedOf(row, wageOf(row, ctx), ctx.project, run)]));
}

/** The payments of one person, up to and including a period (by the period they were made for). */
const paidOf = (payments, key, test) => r2((payments || []).filter(p => p.key === key && test(p)).reduce((s, p) => s + (+p.amount || 0), 0));

/**
 * The lines of one period: one per person on the Attendance sheet who is on the team, was reported, was paid or is owed.
 * @param ctx { project, ws, staff, crew }  crew: the active site team ({ id, name, role }), as the Attendance sheet uses
 * @param period { from, to }
 * @returns { run, lines: [{ key, id, name, role, per, wage, currency, from, present, absent, ot, earned, adjust, note,
 *            brought, due, paid, paidToDate, outstanding }], totals }
 */
export function payLines(ctx, period) {
  const { project, ws, crew = [] } = ctx;
  const runs = (ws.payruns || []).slice().sort((a, b) => (a.from < b.from ? -1 : 1));
  const run = runs.find(x => x.from === period.from) || null;
  const before = runs.filter(x => x.from < period.from);
  const live = register(project, ws, period, crew);
  const rows = new Map(live.rows.map(x => [x.key, x]));
  // people who are owed from before or were paid in this period stay on the list though not on the sheet any more
  for (const k of new Set([...(ws.payments || []).filter(p => p.periodFrom === period.from).map(p => p.key), ...before.flatMap(x => Object.keys(x.lines || {}))])) {
    if (!rows.has(k)) {
      const p = (ws.payments || []).find(x => x.key === k) || before.map(x => x.lines?.[k]).find(Boolean) || {};
      rows.set(k, { key: k, id: p.personId || p.id || '', name: p.name || 'Unnamed', role: p.role || '', present: 0, absent: 0, ot: 0, cells: {} });
    }
  }
  // what each earlier run left owing, in order: its earned (locked when approved, else from the sheet now), its adjustments, its payments
  const owed = new Map();
  for (const x of before) {
    const earned = earnedIn(ctx, x);
    for (const k of new Set([...earned.keys(), ...Object.keys(x.lines || {}), ...(ws.payments || []).filter(p => p.periodFrom === x.from).map(p => p.key)])) {
      const due = (owed.get(k) || 0) + (earned.get(k) || 0) + (+x.lines?.[k]?.adjust || 0);
      owed.set(k, r2(due - paidOf(ws.payments, k, p => p.periodFrom === x.from)));
    }
  }
  const lines = [...rows.values()].map(row => {
    const pay = wageOf(row, ctx);
    const locked = run && run.status !== 'draft' ? run.lines?.[row.key] : null;
    const earned = locked ? +locked.earned || 0 : earnedOf(row, pay, project, period);
    const adj = run?.lines?.[row.key] || {};
    const brought = owed.get(row.key) || 0;
    const due = r2(brought + earned + (+adj.adjust || 0));
    const paid = paidOf(ws.payments, row.key, p => p.periodFrom === period.from);
    return {
      key: row.key, id: row.id, name: row.name, role: row.role, ...pay,
      ...(locked ? { per: locked.per || pay.per, wage: +locked.wage || pay.wage } : {}),
      present: row.present, absent: row.absent, ot: row.ot, earned, adjust: +adj.adjust || 0, note: adj.note || '',
      brought, due, paid, paidToDate: paidOf(ws.payments, row.key, p => p.periodFrom <= period.from), outstanding: r2(due - paid),
    };
  }).filter(l => l.earned || l.brought || l.paid || l.adjust || crew.some(m => keyOf(m) === l.key))
    .sort((a, b) => a.name.localeCompare(b.name));
  const total = f => r2(lines.reduce((s, l) => s + l[f], 0));
  return { run, lines, totals: { earned: total('earned'), adjust: total('adjust'), brought: total('brought'), due: total('due'), paid: total('paid'), outstanding: total('outstanding') } };
}

/** The run record of a period, made when anything is first done with it. */
export const newRun = (period, at) => ({ id: runId(period.from), from: period.from, to: period.to, kind: period.kind, status: 'draft', lines: {}, created: at });

/** Approving locks what each person earned (and how they were paid) at that moment. */
export function lockLines(run, lines) {
  const out = { ...(run.lines || {}) };
  for (const l of lines) out[l.key] = { ...(out[l.key] || {}), name: l.name, role: l.role, personId: l.id, per: l.per, wage: l.wage, earned: l.earned };
  return out;
}

/** A run is paid when it is approved and nobody is owed anything for it. */
export const runStatus = (run, lines) => (!run ? 'draft' : run.status === 'draft' ? 'draft' : lines.every(l => l.outstanding <= 0.004) ? 'paid' : 'approved');
export const STATUS_LABEL = { draft: 'Draft', approved: 'Approved', paid: 'Paid' };

/** The payment record and the labour expense in Costs that goes with it. */
export function paymentFor(line, { amount, date, method, ref, period, by, at, id, usdRate = 0 }) {
  const pay = { id, key: line.key, personId: line.id, name: line.name, role: line.role, amount: r2(amount), currency: line.currency, date, method, ref: ref || '', periodFrom: period.from, by, at };
  // v0.25.0: a pay in ETB keeps its own ETB-to-USD rate; its labour cost is booked in USD at that rate
  const foreign = line.currency && line.currency !== 'USD' && +usdRate > 0;
  if (foreign) pay.usdRate = +usdRate;
  const cost = {
    // kept in paycosts, not the general Costs list, so only those who see pay read it
    id: `pay-${id}`, payId: id, date, type: 'expense', category: 'labor', amount: foreign ? r2(pay.amount / usdRate) : pay.amount, currency: foreign ? 'USD' : line.currency,
    ...(foreign ? { fxFrom: { currency: line.currency, ratePerUsd: +usdRate, on: date, was: { amount: pay.amount } } } : {}),
    description: `Crew pay, ${line.name}${line.role ? ` (${line.role})` : ''}, ${period.label || `${period.from} to ${period.to}`}`,
    method, bankRef: ref || '',
  };
  return { pay, cost };
}

/**
 * Is this person paid through Payments rather than Payroll? Yes when they are on a project (active assignment) that
 * has chosen its pay period, unless their HR department is an office one.
 */
export function paidOnSite(person, projects, isSiteDepartment) {
  if (person.department && !isSiteDepartment(person.department)) return false;
  const using = new Set((projects || []).filter(p => p.payPeriod).map(p => p.id));
  return (person.assignments || []).some(a => a.active !== false && using.has(a.projectId));
}

/** For the HR record: what a person earned, was paid and is owed on each project, from that project's runs and payments. */
export function personSummary(ws, key) {
  const runs = (ws.payruns || []).filter(r => r.lines?.[key]);
  const earned = r2(runs.reduce((s, r) => s + (+r.lines[key].earned || 0) + (+r.lines[key].adjust || 0), 0));
  const paid = paidOf(ws.payments, key, () => true);
  return { earned, paid, owed: r2(earned - paid), payments: (ws.payments || []).filter(p => p.key === key) };
}

/** CSV rows for the accountant. */
export function csvRows(lines, period) {
  return [['Period from', 'Period to', 'Name', 'Trade/position', 'Paid', 'Wage', 'Currency', 'Days present', 'Overtime h', 'Earned', 'Adjustment', 'Brought forward', 'Due', 'Paid this period', 'Total paid to date', 'Outstanding'],
    ...lines.map(l => [period.from, period.to, l.name, l.role, l.per === 'month' ? 'monthly' : 'daily', l.wage, l.currency, l.present, l.ot, l.earned, l.adjust, l.brought, l.due, l.paid, l.paidToDate, l.outstanding])];
}


/**
 * The printed pay sheets (v0.21.2): the daily crew's site pay sheet and the monthly staff's own page, so the crew's
 * cash sheet never shows a salary.
 */
export const splitLines = lines => ({ crew: lines.filter(l => l.per !== 'month'), staff: lines.filter(l => l.per === 'month') });

/**
 * Labour cost of a period by trade or position and pay type: people, man-days, overtime hours and cost (earned plus
 * adjustments), each currency apart. `share` is each group's part of the total when everything is in one currency.
 * @returns { groups: [{ trade, per, people, days, ot, cost: { [currency]: amount }, share }], total: { [currency]: amount } }
 */
export function labourByTrade(lines) {
  const groups = new Map();
  const total = {};
  for (const l of lines) {
    const per = l.per === 'month' ? 'month' : 'day';
    const trade = String(l.role || '').trim() || 'No trade';
    const k = `${per}|${trade.toLowerCase()}`;
    if (!groups.has(k)) groups.set(k, { trade, per, people: 0, days: 0, ot: 0, cost: {} });
    const g = groups.get(k);
    const cost = r2((+l.earned || 0) + (+l.adjust || 0));
    g.people += 1; g.days += +l.present || 0; g.ot += +l.ot || 0;
    g.cost[l.currency] = r2((g.cost[l.currency] || 0) + cost);
    total[l.currency] = r2((total[l.currency] || 0) + cost);
  }
  const one = Object.keys(total).length === 1 ? Object.keys(total)[0] : null;
  const sum = one ? total[one] : 0;
  const out = [...groups.values()]
    .map(g => ({ ...g, share: one && sum > 0 ? (g.cost[one] || 0) / sum * 100 : null }))
    .sort((a, b) => (a.per === b.per ? a.trade.localeCompare(b.trade) : a.per === 'month' ? -1 : 1));
  return { groups: out, total };
}
