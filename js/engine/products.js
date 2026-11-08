// v1.19.0 (owner, 8 Nov, G10 T1): the trading product catalogue. No warehouse (owner): goods go from the supplier
// to the customer, so a product has no stock count; what is bought and not yet sold is read off the shipments.
// Pure functions: a product is { id, code, name, unit, hs, supplier, notes, off }.

import { landed, isStock, stockAndSales } from './trade.js';
import { dealTotals } from './deals.js';   // v1.21.0 (G10 T3)
import { sum } from '../core/util.js';

/** PRD-001, PRD-002, … */
export function nextCode(products) {
  const last = Math.max(0, ...(products || []).map(p => +(String(p.code || '').match(/(\d+)$/)?.[1] || 0)));
  return `PRD-${String(last + 1).padStart(3, '0')}`;
}

/** Same name or same code already in the catalogue (case and spaces ignored). */
export function sameProduct(products, { code, name }, exceptId = '') {
  const k = v => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return (products || []).find(p => p.id !== exceptId && ((code && k(p.code) === k(code)) || (name && k(p.name) === k(name)))) || null;
}

/**
 * Per product, in `currency`: bought (qty, last landed cost per unit, last supplier), sold (qty, sales, profit),
 * not sold yet (on resale shipments), and the margin. Shipment lines point at a product by productId.
 */
export function productStats(company, fx, currency) {
  const products = company.products || [];
  const st = stockAndSales({ shipments: company.shipments || [], sales: company.sales || [] }, fx, currency);
  const items = new Map(st.items.map(i => [i.key, i]));
  const out = products.map(p => {
    const lines = [];
    for (const s of company.shipments || []) {
      for (const l of landed(s, fx, currency).lines) if (l.productId === p.id) lines.push({ s, l, when: s.etd || s.ordered || s.created || '' });
    }
    lines.sort((a, b) => b.when.localeCompare(a.when));
    const last = lines[0];
    const resale = lines.filter(x => isStock(x.s)).map(x => items.get(`${x.s.id}|${x.l.id}`)).filter(Boolean);
    const dl = (company.deals || []).filter(d => d.status === 'invoiced' || d.status === 'paid').flatMap(d => dealTotals(d).lines.filter(l => l.productId === p.id));
    const sold = sum(resale, i => i.sold) + sum(dl, l => +l.qty || 0), revenue = sum(resale, i => i.revenue) + sum(dl, l => l.priceTotal), cost = sum(resale, i => i.cost) + sum(dl, l => l.costTotal);
    return {
      ...p,
      bought: sum(lines, x => +x.l.qty || 0), shipments: new Set(lines.map(x => x.s.id)).size,
      lastLanded: last ? last.l.unitLanded : null, lastSupplier: last?.s.supplier || p.supplier || '', lastRef: last?.s.ref || '',
      sold, revenue, profit: revenue - cost, notSold: sum(resale, i => Math.max(0, i.left)),
      avgPrice: sold > 0 ? revenue / sold : null, margin: revenue > 0 ? (revenue - cost) / revenue * 100 : null,
    };
  });
  return out.sort((a, b) => !!a.off - !!b.off || String(a.code).localeCompare(String(b.code)));
}

/** Shipment lines not tied to a product yet (to link them from the catalogue). */
export const unlinkedLines = company => (company.shipments || []).flatMap(s => (s.lines || []).filter(l => !l.productId).map(l => ({ s, l })));

/** The catalogue for Excel. */
export function productSheets(stats, currency) {
  const r = v => (v == null ? '' : Math.round(v * 100) / 100);
  return [{ name: 'Products', rows: [
    ['Code', 'Product', 'Unit', 'HS code', 'Usual supplier', 'Bought (qty)', 'Shipments', `Last landed per unit (${currency})`, 'Last shipment', 'Sold (qty)', `Sales (${currency})`, `Profit (${currency})`, 'Margin %', 'Bought, not sold yet', 'In use', 'Notes'],
    ...stats.map(p => [p.code, p.name, p.unit || '', p.hs || '', p.lastSupplier, p.bought, p.shipments, r(p.lastLanded), p.lastRef, p.sold, r(p.revenue), r(p.profit), p.margin == null ? '' : Math.round(p.margin), p.notSold, p.off ? 'No' : 'Yes', p.notes || '']),
  ] }];
}
