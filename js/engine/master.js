// v1.48.0 (owner, 10 Nov, M1–M4): the Master page. One read-only view of the whole company for the Admin, the GM
// and the Executive, made only from what is already saved: each project's summary (written when someone with the
// money records opens it), the contracts, the trading deals and the server backup status. No one's pay is shown:
// money is per project and per company total only.

import { convert } from './pricing.js';
import { OPEN as OPEN_DEALS } from './deals.js';
import { contractAlerts, contractStatus } from './contracts.js';

const DAY = 86400000;
const days = (from, to) => (from && to ? Math.round((Date.parse(to) - Date.parse(from)) / DAY) : null);
const sum = (list, f) => list.reduce((a, x) => a + (+f(x) || 0), 0);
export const LATE_REPORT = 2;    // days without a report before it is an alert
export const BACKUP_LATE = 8;    // days since the last weekly server copy before it is an alert

/** One line per live project (M1). */
export function projectRows(projects = [], today) {
  return projects.filter(p => p && p.id && p.status !== 'archived' && p.status !== 'completed').map(p => {
    const s = p.summary || {};
    const since = s.lastReport ? days(s.lastReport, today) : null;
    return {
      id: p.id, name: p.name || p.id, code: p.fieldCode || '', progress: s.progress ?? null, basis: s.basis || 'none',
      behind: Math.max(0, +s.slip || 0), lastReport: s.lastReport || '', since, waiting: +s.waiting || 0,
      alerts: (s.alerts || []).length, crew: s.crewDate === today ? +s.crew || 0 : 0, crewDate: s.crewDate || '',
      value: +p.contractValue || 0, money: s.money || null, currency: s.money?.currency || p.currency || 'ETB',
    };
  }).sort((a, b) => b.behind - a.behind || (b.since ?? 99) - (a.since ?? 99) || a.name.localeCompare(b.name));
}

/** Contract vs invoiced vs paid, and cash in and out this month, in one currency (M2). */
export function moneyTotals(rows, fx, currency, today) {
  const month = String(today || '').slice(0, 7);
  const c = (v, from) => convert(+v || 0, from || currency, currency, fx);
  const withMoney = rows.filter(r => r.money);
  return {
    currency,
    contract: sum(rows, r => c(r.value, r.currency)),
    invoiced: sum(withMoney, r => c(r.money.invoiced, r.currency)),
    received: sum(withMoney, r => c(r.money.received, r.currency)),
    owed: sum(withMoney, r => c(r.money.owed, r.currency)),
    monthIn: sum(withMoney.filter(r => r.money.month === month), r => c(r.money.monthIn, r.currency)),
    monthOut: sum(withMoney.filter(r => r.money.month === month), r => c(r.money.monthOut, r.currency)),
    missing: rows.length - withMoney.length,
  };
}

/** Trading deals still open, and their value (deals are priced in USD). */
export function dealTotals(deals = [], fx, currency, priceOf) {
  const open = deals.filter(d => OPEN_DEALS.includes(d.status));
  return { open: open.length, value: sum(open, d => convert(priceOf(d), 'USD', currency, fx)), waiting: deals.filter(d => d.status === 'quotation').length };
}

/** What needs someone today (M3), most urgent first. */
export function alertsOf({ rows = [], contracts = [], backup = null, today }) {
  const out = [];
  for (const r of rows) {
    if (r.since == null) out.push({ sev: 'mid', kind: 'report', text: `${r.name}: no daily report yet`, link: 'reports', id: r.id });
    else if (r.since >= LATE_REPORT) out.push({ sev: r.since >= 5 ? 'high' : 'mid', kind: 'report', text: `${r.name}: no daily report for ${r.since} days`, link: 'reports', id: r.id });
    if (r.waiting) out.push({ sev: 'mid', kind: 'approve', text: `${r.name}: ${r.waiting} report${r.waiting === 1 ? '' : 's'} waiting for approval`, link: 'reports', id: r.id });
    if (r.behind >= 5) out.push({ sev: r.behind >= 15 ? 'high' : 'mid', kind: 'late', text: `${r.name}: ${r.behind} work days behind plan`, link: 'schedule', id: r.id });
  }
  for (const k of contracts) {
    const st = contractStatus(k, today);
    if (st === 'completed' || st === 'terminated') continue;
    for (const a of contractAlerts(k, today)) out.push({ sev: a.sev === 'high' ? 'high' : 'mid', kind: 'contract', text: `${k.ref || 'Contract'} ${k.party || ''}: ${a.text}`.replace(/\s+/g, ' '), link: 'contracts' });
  }
  const last = backup?.at || '';
  const age = last ? days(String(last).slice(0, 10), today) : null;
  if (age == null) out.push({ sev: 'mid', kind: 'backup', text: 'No server backup copy yet', link: 'setup' });
  else if (age > BACKUP_LATE) out.push({ sev: 'high', kind: 'backup', text: `Last server backup copy was ${age} days ago`, link: 'setup' });
  if (backup?.error) out.push({ sev: 'high', kind: 'backup', text: `Last backup failed: ${String(backup.error).slice(0, 80)}`, link: 'setup' });
  const rank = { high: 0, mid: 1 };
  return out.sort((a, b) => rank[a.sev] - rank[b.sev]);
}

/** Everything the Master page shows. */
export function masterView({ projects, contracts = [], deals = [], backup, fx, currency = 'USD', today, priceOf = () => 0 }) {
  const rows = projectRows(projects, today);
  return {
    rows,
    money: moneyTotals(rows, fx, currency, today),
    trade: dealTotals(deals, fx, currency, priceOf),
    alerts: alertsOf({ rows, contracts, backup, today }),
    crew: sum(rows, r => r.crew),
    backup: { last: backup?.at || '', kept: +backup?.kept || 0 },
  };
}
