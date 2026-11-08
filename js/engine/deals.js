// v1.21.0 (owner, 8 Nov, G10 T3): trading deals: Enquiry -> Quotation -> Approved -> Order -> Delivered -> Invoiced -> Paid
// (or Lost). Lines are priced from the product's last landed cost plus a margin. The GM approves every quotation; below
// MIN_MARGIN the Admin approves too (owner). No warehouse: an order can open a supplier shipment for the same goods.
// An invoiced deal counts in the partner's balance, Products and the Zoho export. Pure functions.
// A deal: { id, ref DL-001, quote QT-001, invoice INV-T001, customer, status, margin, lines: [{ id, productId,
//   description, unit, qty, cost, price }], wanted, notes, gm: {by,name,at}, admin: {...}, po, poDate, shipmentId,
//   delivered, invoiceDate, due, paidOn, method, payRef, lost: { reason, at }, created, by }

import { priceForMargin } from './trade.js';
import { sum } from '../core/util.js';

export const MIN_MARGIN = 10;   // % of the price (owner): below it the Admin approves as well as the GM
export const STEPS = [['enquiry', 'Enquiry'], ['quotation', 'Quotation'], ['approved', 'Approved'], ['order', 'Order'], ['delivered', 'Delivered'], ['invoiced', 'Invoiced'], ['paid', 'Paid']];
export const stepLabel = s => (s === 'lost' ? 'Lost' : STEPS.find(([k]) => k === s)?.[1] || 'Enquiry');
export const stepIndex = s => STEPS.findIndex(([k]) => k === s);
export const OPEN = ['enquiry', 'quotation', 'approved', 'order', 'delivered'];
export const METHODS = [['bank', 'Bank transfer'], ['cash', 'Cash'], ['cheque', 'Cheque'], ['card', 'Card']];

const next = (list, key, prefix, digits = 3) => {
  const last = Math.max(0, ...(list || []).map(d => +(String(d[key] || '').match(/(\d+)$/)?.[1] || 0)));
  return `${prefix}${String(last + 1).padStart(digits, '0')}`;
};
export const nextDealRef = deals => next(deals, 'ref', 'DL-');
export const nextQuote = deals => next(deals, 'quote', 'QT-');
export const nextInvoice = deals => next(deals, 'invoice', 'INV-T');

const r2 = v => Math.round((+v || 0) * 100) / 100;

/** A line priced at `margin` % from its unit cost. */
export const priceAt = (cost, margin) => r2(priceForMargin(+cost || 0, Math.min(95, Math.max(0, +margin || 0))));

/** Totals of a deal: cost, price, profit, margin %, and the lowest line margin. */
export function dealTotals(d) {
  const lines = (d.lines || []).map(l => {
    const cost = (+l.qty || 0) * (+l.cost || 0), price = (+l.qty || 0) * (+l.price || 0);
    return { ...l, costTotal: cost, priceTotal: price, profit: price - cost, margin: price > 0 ? (price - cost) / price * 100 : null };
  });
  const cost = sum(lines, l => l.costTotal), price = sum(lines, l => l.priceTotal);
  return { lines, cost, price, profit: price - cost, margin: price > 0 ? (price - cost) / price * 100 : null };
}

/** Who must still approve: the GM always; the Admin too when the margin is below MIN_MARGIN. */
export function approvalNeeds(d) {
  const t = dealTotals(d);
  const low = t.margin == null || t.margin < MIN_MARGIN;
  return { low, gm: !d.gm, admin: low && !d.admin, done: !!d.gm && (!low || !!d.admin), margin: t.margin };
}

/**
 * May this person approve now? The Admin approves both parts; a GM approves the GM part.
 * Returns the parts this person would sign: { gm, admin }.
 */
export function mayApprove(d, { admin = false, gm = false }) {
  const n = approvalNeeds(d);
  return { gm: n.gm && (gm || admin), admin: n.admin && admin };
}

/** What a step change needs before it may happen; '' when it may. */
export function blockOf(d, to) {
  const t = dealTotals(d);
  if (to === 'quotation' && (!d.customer || !t.lines.length)) return 'Choose the customer and add at least one product.';
  if (to === 'quotation' && t.lines.some(l => !(+l.qty > 0) || !(+l.price > 0))) return 'Every line needs a quantity and a price.';
  if (to === 'approved' && !approvalNeeds(d).done) return approvalNeeds(d).low ? `The GM and, below ${MIN_MARGIN}% margin, the Admin approve first.` : 'The GM approves first.';
  if (to === 'order' && !d.po) return "Enter the customer's PO number.";
  if (to === 'delivered' && !d.delivered) return 'Enter the delivery date.';
  if (to === 'paid' && !d.paidOn) return 'Enter the date it was paid.';
  return '';
}

/** The next step of a deal, or null at the end (or lost). */
export const nextStep = s => (s === 'lost' ? null : STEPS[stepIndex(s) + 1]?.[0] || null);

/** The day an invoice is due: invoice date + the customer's terms. */
export function dueDate(invoiceDate, terms) {
  if (!invoiceDate) return '';
  const d = new Date(`${invoiceDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (+terms || 0));
  return d.toISOString().slice(0, 10);
}

/** Invoiced deals as sales rows (partner balances and statements): one row per deal, in USD. */
export const dealSales = deals => (deals || []).filter(d => d.invoice && (d.status === 'invoiced' || d.status === 'paid')).map(d => {
  const t = dealTotals(d);
  return { id: d.id, number: d.invoice, date: d.invoiceDate, due: d.due, customer: d.customer, item: `Deal ${d.ref}: ${t.lines.map(l => l.description).join(', ').slice(0, 80)}`, qty: 1, unit: '', revenue: t.price, cost: t.cost, paid: d.status === 'paid', paidOn: d.paidOn || '', deal: true };
});

/** Figures for the list. */
export function dealSummary(deals, today) {
  const month = String(today || '').slice(0, 7);
  const open = (deals || []).filter(d => OPEN.includes(d.status));
  const at = d => (d.lost?.at || d.invoiceDate || d.updated || d.created || '').slice(0, 7);
  return {
    open: open.length, openValue: sum(open, d => dealTotals(d).price),
    waiting: (deals || []).filter(d => d.status === 'quotation' && !approvalNeeds(d).done).length,
    wonMonth: (deals || []).filter(d => (d.status === 'invoiced' || d.status === 'paid') && (d.invoiceDate || '').startsWith(month)).length,
    lostMonth: (deals || []).filter(d => d.status === 'lost' && at(d) === month).length,
  };
}

/** The deal list for Excel. */
export function dealSheets(deals, currency) {
  return [{ name: 'Deals', rows: [
    ['Deal', 'Quotation', 'Invoice', 'Customer', 'Step', 'Products', `Cost (${currency})`, `Price (${currency})`, `Profit (${currency})`, 'Margin %', 'GM approved', 'Admin approved', 'Customer PO', 'Delivered', 'Invoice date', 'Due', 'Paid on', 'Lost reason'],
    ...(deals || []).map(d => {
      const t = dealTotals(d);
      return [d.ref, d.quote || '', d.invoice || '', d.customer || '', stepLabel(d.status), t.lines.map(l => `${l.description} x ${l.qty}`).join('; '), r2(t.cost), r2(t.price), r2(t.profit), t.margin == null ? '' : Math.round(t.margin),
        d.gm ? `${d.gm.name} ${String(d.gm.at || '').slice(0, 10)}` : '', d.admin ? `${d.admin.name} ${String(d.admin.at || '').slice(0, 10)}` : '', d.po || '', d.delivered || '', d.invoiceDate || '', d.due || '', d.paidOn || '', d.lost?.reason || ''];
    }),
  ] }];
}

/** The supplier shipment an order opens (no warehouse): the deal's products at their cost, tied to the deal. */
export function shipmentFor(d, { id, ref, today, supplier = '' }) {
  return {
    id, ref, supplier, projectId: '', dealId: d.id, currency: 'USD', origin: '', destination: '', mode: 'sea', incoterm: '', tracking: '', carrier: '',
    etd: '', eta: d.wanted || '', arrived: '', status: 'ordered', costs: [], notes: `For deal ${d.ref}, ${d.customer}`, created: today, ordered: today,
    lines: (d.lines || []).map((l, i) => ({ id: `${id}-${i + 1}`, productId: l.productId || undefined, description: l.description, qty: +l.qty || 0, unit: l.unit || '', unitCost: +l.cost || 0 })),
  };
}
