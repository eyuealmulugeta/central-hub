// Billing engine: what can be invoiced under each contract type, and the
// numbered documents (invoice, quotation, purchase order) built from it.
// Documents are snapshots: their lines and totals are frozen when created.

import { toDay, fromDay, sum, uid } from '../core/util.js';

export const METHODS = [
  ['milestone_pct', 'Milestones, % of contract value'],
  ['milestone_fixed', 'Milestones, fixed amounts'],
  ['progress', 'Work progress, % of contract value'],
  ['measured', 'Admeasurement (measured quantities)'],
  ['daily', 'Day rates with overtime'],
  ['advance', 'Full payment in advance'],
];

export const DEFAULT_BILLING = { method: 'milestone_pct', retention: 0, paymentDays: 30, otMultiplier: 1.5, hoursPerDay: 10 };
export function billingOf(project) {
  const b = { ...DEFAULT_BILLING, ...project.billing };
  // both are divisors or multipliers of money: never let a blank or zero through
  if (!(b.hoursPerDay > 0)) b.hoursPerDay = DEFAULT_BILLING.hoursPerDay;
  if (!(b.otMultiplier > 0)) b.otMultiplier = DEFAULT_BILLING.otMultiplier;
  return b;
}

const round2 = v => Math.round(v * 100) / 100;

/** Where the project stands against its billing terms. Every existing invoice counts, drafts included. */
export function billingState({ project, ws, sched }) {
  const b = billingOf(project);
  const invoices = ws.docs.filter(d => d.type === 'invoice');
  const stageDoc = new Map();
  const measuredBilled = {};
  for (const d of invoices) {
    for (const l of d.lines) {
      if (l.stageId) stageDoc.set(l.stageId, d);
      if (l.measureId) measuredBilled[l.measureId] = (measuredBilled[l.measureId] || 0) + l.qty;
    }
  }
  const taskById = new Map(sched.rows.map(r => [r.id, r]));
  const stages = ws.payStages.map(s => {
    const amount = b.method === 'milestone_pct' ? project.contractValue * s.value / 100 : s.value;
    // a stage with no task is due from the start (an advance payment)
    const reached = s.taskId ? taskById.get(s.taskId)?.progress >= 100 : true;
    const doc = stageDoc.get(s.id);
    return { ...s, amount, doc, state: doc ? 'invoiced' : reached ? 'ready' : 'pending' };
  });
  return {
    ...b, stages, measuredBilled,
    invoiced: sum(invoices, d => d.subtotal),
    outstanding: sum(invoices.filter(d => d.status === 'sent'), d => d.amountDue),
    received: sum(invoices.filter(d => d.status === 'paid'), d => d.amountDue),
    lastDaily: invoices.filter(d => d.period).map(d => d.period.to).sort().at(-1) || '',
  };
}

/** Lines for the next invoice under the project's billing method, or the reason there are none. */
export function invoiceLines({ project, ws, sched, bill, today }) {
  const once = (description, amount, extra = {}) => ({ description, qty: 1, unit: 'sum', rate: amount, amount, ...extra });
  switch (bill.method) {
    case 'milestone_pct':
    case 'milestone_fixed': {
      const ready = bill.stages.filter(s => s.state === 'ready');
      const pct = bill.method === 'milestone_pct';
      return ready.length
        ? { lines: ready.map(s => once(pct ? `${s.name} (${s.value}% of contract value)` : s.name, s.amount, { stageId: s.id })) }
        : { lines: [], why: bill.stages.length ? 'No payment stage has been reached that is not already invoiced.' : 'Add payment stages under Billing terms first.' };
    }
    case 'advance': {
      const rest = project.contractValue - bill.invoiced;
      return rest > 0.005 ? { lines: [once('Full payment in advance', rest)] } : { lines: [], why: 'The contract value is already fully invoiced.' };
    }
    case 'progress': {
      const earned = project.contractValue * sched.progress / 100;
      if (earned - bill.invoiced <= 0.005) return { lines: [], why: 'No new progress to invoice since the last invoice.' };
      const lines = [once(`Work completed to date, ${sched.progress.toFixed(1)}% of contract value`, earned)];
      if (bill.invoiced > 0) lines.push(once('Less previously invoiced', -bill.invoiced));
      return { lines };
    }
    case 'measured': {
      const lines = ws.measure
        .map(m => ({ m, qty: round2((m.doneQty || 0) - (bill.measuredBilled[m.id] || 0)) }))
        .filter(x => x.qty > 0)
        .map(({ m, qty }) => ({ description: m.description, qty, unit: m.unit, rate: m.rate, amount: qty * m.rate, measureId: m.id }));
      return lines.length ? { lines } : { lines: [], why: 'No measured quantity is waiting to be invoiced. Update "Measured to date" under Billing terms.' };
    }
    case 'daily': {
      const first = bill.lastDaily ? fromDay(toDay(bill.lastDaily) + 1) : '';
      const reports = ws.reports
        .filter(r => r.manpower?.length && r.date >= first && r.date <= today)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (!reports.length) return { lines: [], why: 'No manpower has been reported since the last invoice.' };
      const byTrade = new Map();
      for (const r of reports) {
        for (const m of r.manpower) {
          const t = byTrade.get(m.trade) || { days: 0, ot: 0 };
          t.days += m.count;
          t.ot += m.ot || 0;
          byTrade.set(m.trade, t);
        }
      }
      const lines = [];
      for (const [trade, t] of byTrade) {
        const rate = ws.billRates[trade] || 0;
        lines.push({ description: `${trade}, normal days`, qty: t.days, unit: 'day', rate, amount: t.days * rate });
        if (t.ot > 0) {
          const hourly = rate / bill.hoursPerDay * bill.otMultiplier;
          lines.push({ description: `${trade}, overtime at ${bill.otMultiplier}×`, qty: t.ot, unit: 'h', rate: hourly, amount: t.ot * hourly });
        }
      }
      return { lines, period: { from: reports[0].date, to: reports.at(-1).date } };
    }
    default:
      return { lines: [], why: 'Choose a billing method under Billing terms.' };
  }
}

/** subtotal -> + VAT -> total -> less retention (held on the subtotal) -> amount due */
export function docTotals(lines, vatPct = 0, retentionPct = 0) {
  const subtotal = sum(lines, l => l.amount);
  const vat = subtotal * vatPct / 100;
  const retention = subtotal * retentionPct / 100;
  return { subtotal, vat, total: subtotal + vat, retention, amountDue: subtotal + vat - retention };
}

const PREFIX = { invoice: 'INV', quote: 'QUO', po: 'PO', report: 'RPT' };

/** INV-MOD-001: document type, first three letters of the project, running number per type. */
export function nextNumber(docs, type, project) {
  const code = (project.name.replace(/[^A-Za-z]/g, '').slice(0, 3) || 'PRJ').toUpperCase();
  const last = Math.max(0, ...docs.filter(d => d.type === type).map(d => +(d.number.match(/(\d+)$/)?.[1] || 0)));
  return `${PREFIX[type]}-${code}-${String(last + 1).padStart(3, '0')}`;
}

export function makeDoc({ type, project, docs, today, lines, party = {}, due, period = null, retentionPct = 0, notes = '' }) {
  const vatPct = project.markups?.vat || 0;
  return {
    id: uid('d'), type, number: nextNumber(docs, type, project), date: today, due: due || today, status: 'draft',
    party: { name: party.name || '', address: party.address || '', contact: party.contact || '', taxId: party.taxId || '' },
    lines, period, notes, vatPct, retentionPct, ...docTotals(lines, vatPct, retentionPct),
  };
}

// Selling price per line: the cost with overhead, contingency and profit spread evenly (VAT is added on the document).
const sellFactor = boq => (boq.totals.direct > 0 ? boq.totals.subtotal / boq.totals.direct : 1);

/** Quotation lines from the estimate. */
export function quoteLines(boq) {
  const f = sellFactor(boq);
  return boq.rows.map(r => ({
    group: r.assemblyName, description: `${r.element}, ${r.name}`, qty: r.qty, unit: r.unit,
    rate: r.qty ? r.amount * f / r.qty : 0, amount: r.amount * f,
  }));
}

/** Purchase order lines from procurement rows (at cost, no markup). */
export const poLines = rows => rows.map(r => ({
  description: r.name, qty: round2(r.qty), unit: r.unit, rate: r.rate, amount: round2(r.qty) * r.rate, materialId: r.materialId,
}));

/** Admeasurement items from the estimate, at selling rates. */
export function measureFromBOQ(boq) {
  const f = sellFactor(boq);
  return boq.rows.map((r, i) => ({
    id: 'q' + (i + 1), description: `${r.element}, ${r.name}`, unit: r.unit,
    contractQty: round2(r.qty), rate: round2(r.rate * (1 + r.waste / 100) * f), doneQty: 0,
  }));
}
