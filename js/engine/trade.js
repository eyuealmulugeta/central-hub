// Trading and freight: what a shipment really costs once it is on site.
// Pure functions. A shipment holds the goods bought and every cost of getting
// them here; the landed cost is worked out from those and never stored.

import { convert } from './pricing.js';
import { toDay, sum } from '../core/util.js';

/** The route a shipment takes, in order. */
export const STAGES = [
  ['ordered', 'Ordered'],
  ['shipped', 'Shipped'],
  ['port', 'At port'],
  ['customs', 'In customs'],
  ['delivered', 'Delivered'],
];
export const stageLabel = id => STAGES.find(([k]) => k === id)?.[1] || STAGES[0][1];
export const nextStage = id => STAGES[STAGES.findIndex(([k]) => k === id) + 1] || null;

export const MODES = [['sea', 'Sea'], ['air', 'Air'], ['road', 'Road'], ['rail', 'Rail']];
export const INCOTERMS = ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
/** Everything paid on top of the goods themselves. */
export const COST_KINDS = [
  ['freight', 'Freight'], ['insurance', 'Insurance'], ['duty', 'Customs duty'], ['tax', 'Import tax'],
  ['clearing', 'Clearing agent'], ['port', 'Port and storage'], ['inland', 'Inland transport'], ['other', 'Other'],
];
export const costLabel = id => COST_KINDS.find(([k]) => k === id)?.[1] || 'Other';

/** SHP-001, SHP-002, … */
export function nextRef(shipments) {
  const last = Math.max(0, ...shipments.map(s => +(String(s.ref || '').match(/(\d+)$/)?.[1] || 0)));
  return `SHP-${String(last + 1).padStart(3, '0')}`;
}

/**
 * Landed cost of one shipment in `currency`: the goods plus every extra cost,
 * with the extras shared over the goods lines by value, so each line gets the
 * unit cost it has actually reached on site.
 */
export function landed(shipment, fx, currency) {
  const goodsCur = shipment.currency || currency;
  const lines = (shipment.lines || []).map(l => ({ ...l, value: convert((+l.qty || 0) * (+l.unitCost || 0), goodsCur, currency, fx) }));
  const goods = sum(lines, l => l.value);
  const costs = (shipment.costs || []).map(c => ({ ...c, value: convert(+c.amount || 0, c.currency || goodsCur, currency, fx) }));
  const extras = sum(costs, c => c.value);
  const byKind = COST_KINDS.map(([kind, label]) => ({ kind, label, value: sum(costs.filter(c => (c.kind || 'other') === kind), c => c.value) })).filter(k => k.value);
  return {
    currency, goods, extras, total: goods + extras, byKind,
    // how much the route adds to the purchase price
    uplift: goods > 0 ? extras / goods * 100 : null,
    lines: lines.map(l => {
      const share = goods > 0 ? l.value / goods * extras : 0;
      const total = l.value + share;
      return { ...l, share, total, unitLanded: +l.qty > 0 ? total / l.qty : 0, unitBought: +l.qty > 0 ? l.value / l.qty : 0 };
    }),
  };
}

/** Where a shipment stands against its expected arrival. */
export function shipmentState(s, today) {
  const T = toDay(today);
  const done = s.status === 'delivered';
  const late = !done && !!s.eta && toDay(s.eta) < T;
  return {
    done, late,
    daysLate: late ? T - toDay(s.eta) : 0,
    daysToArrival: !done && s.eta && !late ? toDay(s.eta) - T : null,
    // days on the way so far, or door to door once delivered
    transit: s.etd ? (done && s.arrived ? toDay(s.arrived) : T) - toDay(s.etd) : null,
  };
}

/** Company-wide figures for the Trading screen. */
export function tradeSummary(shipments, fx, today, currency) {
  const rows = shipments.map(s => ({ s, cost: landed(s, fx, currency), state: shipmentState(s, today) }));
  const open = rows.filter(r => !r.state.done);
  const done = rows.filter(r => r.state.done);
  const year = today.slice(0, 4);
  const thisYear = done.filter(r => (r.s.arrived || r.s.eta || '').startsWith(year));
  const goods = sum(done, r => r.cost.goods);
  return {
    rows,
    open: open.length,
    onTheWay: sum(open, r => r.cost.total),
    late: open.filter(r => r.state.late).length,
    landedThisYear: sum(thisYear, r => r.cost.total),
    // across delivered shipments: what freight, duty and the rest add to the purchase price
    uplift: goods > 0 ? sum(done, r => r.cost.extras) / goods * 100 : null,
  };
}

// ---- stock and sales ----
// Goods on a shipment with no project are bought to be sold on. Each sale takes
// a quantity out of one shipment line, at that line's landed cost per unit.

/** A shipment is stock for resale when it is not tied to a project. */
export const isStock = s => !s.projectId;

/**
 * What is in stock, what has been sold and what it earned, in `currency`.
 * Profit on a sale = selling price - landed cost of the quantity sold.
 */
export function stockAndSales(company, fx, currency) {
  const sales = company.sales || [];
  const items = [];
  const byLine = new Map();
  for (const s of company.shipments.filter(isStock)) {
    for (const l of landed(s, fx, currency).lines) {
      const item = {
        key: `${s.id}|${l.id}`, shipmentId: s.id, lineId: l.id, ref: s.ref, supplier: s.supplier || '', arrived: s.status === 'delivered',
        description: l.description, unit: l.unit || '', bought: +l.qty || 0, unitLanded: l.unitLanded, sold: 0, revenue: 0, cost: 0,
      };
      items.push(item);
      byLine.set(item.key, item);
    }
  }
  const rows = sales.map(x => {
    const item = byLine.get(`${x.shipmentId}|${x.lineId}`);
    const revenue = convert((+x.qty || 0) * (+x.unitPrice || 0), x.currency || currency, currency, fx);
    const cost = (item?.unitLanded || 0) * (+x.qty || 0);
    if (item) { item.sold += +x.qty || 0; item.revenue += revenue; item.cost += cost; }
    return { ...x, item: item?.description || 'Removed item', unit: item?.unit || '', revenue, cost, profit: revenue - cost, margin: revenue > 0 ? (revenue - cost) / revenue * 100 : null };
  }).sort((a, b) => b.date.localeCompare(a.date));
  for (const i of items) {
    i.left = i.bought - i.sold;
    i.stockValue = Math.max(0, i.left) * i.unitLanded;
    i.profit = i.revenue - i.cost;
  }
  const revenue = sum(rows, r => r.revenue), cost = sum(rows, r => r.cost);
  return {
    currency, items, sales: rows,
    stockValue: sum(items, i => i.stockValue),
    revenue, cost, profit: revenue - cost,
    margin: revenue > 0 ? (revenue - cost) / revenue * 100 : null,
    unpaid: sum(rows.filter(r => !r.paid), r => r.revenue),
  };
}

/** Selling price per unit that leaves `marginPct` of the price as profit. */
export const priceForMargin = (unitLanded, marginPct) => (marginPct < 100 ? unitLanded / (1 - marginPct / 100) : 0);
