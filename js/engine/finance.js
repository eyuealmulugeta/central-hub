// Company finance: every project's money in one currency. Pure: projects and
// their workspaces in, figures out. It reads what the projects already hold
// (invoices, cost entries, labour from daily reports, purchase orders) and
// stores nothing. It is a management view, not statutory accounts.

import { derive } from '../core/derive.js';
import { convert } from './pricing.js';
import { toDay, sum } from '../core/util.js';

const MONTHS_SHOWN = 6;
/** Days overdue -> bucket label, in order. */
export const AGE_BUCKETS = ['Not due yet', '1 to 30 days', '31 to 60 days', 'Over 60 days'];
const bucketOf = days => (days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : 3);

/**
 * @param projects   project settings
 * @param workspaces { [projectId]: workspace }
 * @param currency   the currency everything is shown in (defaults to the base of the exchange-rate table)
 */
export function companyFinance(projects, workspaces, global, today, currency = global.fx.base) {
  const T = toDay(today);
  const rows = [];
  const receivables = [];
  const commitments = [];
  const invoices = [];
  const entries = [];
  const byMonth = new Map();

  for (const project of projects) {
    const ws = workspaces[project.id];
    if (!ws) continue;
    const d = derive(project, ws, global, today);
    const to = v => convert(v || 0, project.currency, currency, global.fx);

    const invoiced = to(d.bill.invoiced);
    const spent = to(d.led.spent);
    const received = to(d.led.income);
    rows.push({
      id: project.id, name: project.name, currency: project.currency,
      contract: to(project.contractValue), budget: to(project.budget),
      invoiced, received, owed: to(d.bill.outstanding), spent,
      cash: received - spent,
      // what has been billed against what it has cost so far
      margin: invoiced > 0 ? (invoiced - spent) / invoiced * 100 : null,
      progress: d.sched.progress,
    });

    for (const doc of ws.docs) {
      if (doc.type === 'invoice') {
        invoices.push({ project: project.name, currency: project.currency, ...doc });
        if (doc.status === 'sent') {
          const overdue = T - toDay(doc.due);
          receivables.push({
            project: project.name, number: doc.number, client: doc.party?.name || '', due: doc.due,
            overdue, bucket: bucketOf(overdue), amount: to(doc.amountDue),
          });
        }
      }
      // ordered from a supplier and not delivered yet: money that will have to be paid
      if (doc.type === 'po' && doc.status === 'sent') {
        commitments.push({ project: project.name, number: doc.number, supplier: doc.party?.name || '', due: doc.due, amount: to(doc.total) });
      }
    }

    for (const r of d.led.rows) {
      entries.push({ project: project.name, ...r });
      const month = r.date.slice(0, 7);
      const m = byMonth.get(month) || { month, in: 0, out: 0 };
      if (r.type === 'income') m.in += to(r.base); else m.out += to(r.base);
      byMonth.set(month, m);
    }
  }

  receivables.sort((a, b) => b.overdue - a.overdue);
  commitments.sort((a, b) => a.due.localeCompare(b.due));
  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-MONTHS_SHOWN)
    .map(m => ({ ...m, net: m.in - m.out }));
  const total = f => sum(rows, f);
  const invoiced = total(r => r.invoiced), spent = total(r => r.spent), received = total(r => r.received);

  return {
    currency, rows,
    totals: {
      contract: total(r => r.contract), invoiced, received, owed: total(r => r.owed), spent,
      cash: received - spent, committed: sum(commitments, x => x.amount),
      margin: invoiced > 0 ? (invoiced - spent) / invoiced * 100 : null,
    },
    receivables,
    aging: AGE_BUCKETS.map((label, i) => ({ label, amount: sum(receivables.filter(r => r.bucket === i), r => r.amount) })),
    commitments, months, invoices, entries,
  };
}

/** Rows for the accountant: every invoice, in its own currency. */
export const invoiceExport = f => [
  ['Project', 'Number', 'Date', 'Due', 'Client', 'Client tax ID', 'Status', 'Currency', 'Subtotal', 'VAT %', 'VAT', 'Total', 'Retention', 'Amount due'],
  ...f.invoices.map(d => [d.project, d.number, d.date, d.due, d.party?.name || '', d.party?.taxId || '', d.status, d.currency,
    d.subtotal.toFixed(2), d.vatPct || 0, (d.vat || 0).toFixed(2), d.total.toFixed(2), (d.retention || 0).toFixed(2), d.amountDue.toFixed(2)]),
];

/** Rows for the accountant: every cost and receipt, in the currency it was entered in. */
export const entryExport = f => [
  ['Project', 'Date', 'Type', 'Category', 'Description', 'Vendor or payer', 'Amount', 'Currency', 'Source'],
  ...[...f.entries].sort((a, b) => a.date.localeCompare(b.date) || a.project.localeCompare(b.project))
    .map(r => [r.project, r.date, r.type === 'income' ? 'Received' : 'Expense', r.category, r.description, r.vendor || '',
      r.amount.toFixed(2), r.currency, r.auto ? 'Daily reports' : 'Entered']),
];
