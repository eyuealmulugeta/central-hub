// v1.20.0 (owner, 8 Nov, G10 T2): trading partners: one list of customers and suppliers (a partner can be both).
// Records point at a partner by name (shipment.supplier, sale.customer), so names typed before this list link up
// by themselves. Overdue = sale date + the partner's payment terms (owner). Pure functions.
// A partner: { id, name, kind: customer|supplier|both, country, city, phone, email, trn, currency, terms (days), person, notes, off }

import { landed, stockAndSales } from './trade.js';
import { sum } from '../core/util.js';

export const KINDS = [['customer', 'Customer'], ['supplier', 'Supplier'], ['both', 'Customer and supplier']];
export const TERMS = [[0, 'On receipt'], [7, '7 days'], [15, '15 days'], [30, '30 days'], [45, '45 days'], [60, '60 days'], [90, '90 days']];
export const kindLabel = k => KINDS.find(([v]) => v === k)?.[1] || 'Customer';
export const termsLabel = d => (+d ? `${+d} days` : 'On receipt');

export const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
export const isCustomer = p => p.kind !== 'supplier';
export const isSupplier = p => p.kind === 'supplier' || p.kind === 'both';

/** The partner a typed name stands for (case and spaces ignored). */
export const partnerOf = (partners, name) => (norm(name) ? (partners || []).find(p => norm(p.name) === norm(name)) || null : null);

/** Same name already in the list. */
export const samePartner = (partners, name, exceptId = '') => (partners || []).find(p => p.id !== exceptId && norm(p.name) === norm(name)) || null;

/** The day a sale is due: its own due date, else its date + the customer's terms. */
export function dueOf(sale, partner) {
  if (sale.due) return sale.due;
  if (!sale.date) return '';
  const d = new Date(`${sale.date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (+partner?.terms || 0));
  return d.toISOString().slice(0, 10);
}

/** Names used on shipments and sales that are not partners yet, with what they were used as. */
export function namesToAdd(company) {
  const partners = company.partners || [];
  const found = new Map();
  const add = (name, kind) => {
    const n = String(name || '').trim();
    if (!n || partnerOf(partners, n)) return;
    const k = norm(n), was = found.get(k);
    found.set(k, { name: was?.name || n, kind: was && was.kind !== kind ? 'both' : kind, uses: (was?.uses || 0) + 1 });
  };
  for (const s of company.shipments || []) add(s.supplier, 'supplier');
  for (const x of company.sales || []) add(x.customer, 'customer');
  return [...found.values()].sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
}

/** Goods value of a shipment (what is owed to the supplier for the goods), in `currency`. */
const goodsOf = (s, fx, currency) => landed(s, fx, currency).goods;

/**
 * One partner's records and money, in `currency`: sales (sold, owed to us, overdue) and shipments (bought, owed by us
 * = goods of shipments not marked as paid to the supplier).
 */
export function partnerRecords(p, company, fx, currency, today) {
  const st = stockAndSales({ shipments: company.shipments || [], sales: company.sales || [] }, fx, currency);
  const sales = st.sales.filter(x => norm(x.customer) === norm(p.name)).map(x => {
    const due = dueOf(x, p);
    return { ...x, due, overdue: !x.paid && !!due && due < today, daysLate: !x.paid && due && due < today ? Math.round((Date.parse(today) - Date.parse(due)) / 864e5) : 0 };
  });
  const shipments = (company.shipments || []).filter(s => norm(s.supplier) === norm(p.name)).map(s => ({ s, goods: goodsOf(s, fx, currency) }));
  return {
    sales, shipments,
    sold: sum(sales, x => x.revenue), owedToUs: sum(sales.filter(x => !x.paid), x => x.revenue),
    overdue: sum(sales.filter(x => x.overdue), x => x.revenue), overdueCount: sales.filter(x => x.overdue).length,
    bought: sum(shipments, x => x.goods), weOwe: sum(shipments.filter(x => !x.s.supplierPaid), x => x.goods),
  };
}

/** Every partner with its totals, the ones in use first. */
export function partnerList(company, fx, currency, today) {
  return (company.partners || []).map(p => ({ ...p, ...partnerRecords(p, company, fx, currency, today) }))
    .sort((a, b) => !!a.off - !!b.off || a.name.localeCompare(b.name));
}

/**
 * Statement for a date range: sales are money the partner owes us (debit), payments received clear them (credit);
 * shipments are money we owe the supplier (credit), paid to the supplier clears it (debit). Balance: + = they owe us.
 */
export function statement(p, company, fx, currency, from, to, today) {
  const r = partnerRecords(p, company, fx, currency, today);
  const lines = [];
  for (const x of r.sales) {
    lines.push({ date: x.date, ref: x.number || `SALE-${String(x.id).slice(-8)}`, what: `Sale: ${x.item}, ${x.qty} ${x.unit || ''}`.trim(), debit: x.revenue, credit: 0 });
    if (x.paid) lines.push({ date: x.paidOn || x.date, ref: x.number || `SALE-${String(x.id).slice(-8)}`, what: 'Payment received', debit: 0, credit: x.revenue });
  }
  for (const { s, goods } of r.shipments) {
    const day = s.ordered || s.created || s.etd || '';
    lines.push({ date: day, ref: s.ref, what: `Goods bought: ${(s.lines || []).map(l => l.description).join(', ').slice(0, 80) || s.ref}`, debit: 0, credit: goods });
    if (s.supplierPaid) lines.push({ date: s.supplierPaidOn || day, ref: s.ref, what: 'Paid to the supplier', debit: goods, credit: 0 });
  }
  lines.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let opening = 0;
  for (const l of lines) if (from && l.date < from) opening += l.debit - l.credit;
  let bal = opening;
  const rows = lines.filter(l => (!from || l.date >= from) && (!to || l.date <= to)).map(l => ({ ...l, balance: (bal += l.debit - l.credit) }));
  return { partner: p, currency, from, to, opening, rows, closing: bal, debit: sum(rows, l => l.debit), credit: sum(rows, l => l.credit) };
}

/** The list for Excel. */
export function partnerSheets(list, currency) {
  const r = v => Math.round((+v || 0) * 100) / 100;
  return [{ name: 'Partners', rows: [
    ['Name', 'Type', 'Country', 'City', 'Phone', 'Email', 'TRN', 'Currency', 'Payment terms', 'Contact person', `Sold (${currency})`, `Owed to us (${currency})`, `Overdue (${currency})`, `Bought (${currency})`, `We owe (${currency})`, 'In use', 'Notes'],
    ...list.map(p => [p.name, kindLabel(p.kind), p.country || '', p.city || '', p.phone || '', p.email || '', p.trn || '', p.currency || 'USD', termsLabel(p.terms), p.person || '', r(p.sold), r(p.owedToUs), r(p.overdue), r(p.bought), r(p.weOwe), p.off ? 'No' : 'Yes', p.notes || '']),
  ] }];
}
