// Pricing engine: BOM lines + regional price matrix + FX table -> priced BOQ.
// Nothing here is stored. The BOQ is recomputed from the price matrix on every
// render, so changing a unit price or an exchange rate re-prices every estimate.

/** fx.rates holds units of each currency per 1 unit of the base currency. */
export function convert(amount, from, to, fx) {
  if (from === to) return amount;
  const a = fx.rates[from], b = fx.rates[to];
  return a > 0 && b > 0 ? amount / a * b : amount;
}

/**
 * Markups compound in this order:
 *   direct -> + overhead % -> + contingency % -> + profit % -> + VAT %
 */
export function applyMarkups(direct, m = {}) {
  const overhead = direct * (m.overhead || 0) / 100;
  const contingency = (direct + overhead) * (m.contingency || 0) / 100;
  const profit = (direct + overhead + contingency) * (m.profit || 0) / 100;
  const subtotal = direct + overhead + contingency + profit;
  const vat = subtotal * (m.vat || 0) / 100;
  return { direct, overhead, contingency, profit, subtotal, vat, total: subtotal + vat };
}

export function priceBOM(bom, project, global) {
  const materials = new Map(global.materials.map(m => [m.id, m]));
  const column = global.prices[project.regionId] || {};

  const rows = bom.lines.map(l => {
    const m = materials.get(l.materialId);
    const p = column[l.materialId];
    const waste = m?.waste || 0;
    const orderQty = l.qty * (1 + waste / 100);
    const rate = p ? convert(p.price, p.currency, project.currency, global.fx) : 0;
    return {
      ...l, name: m?.name || l.materialId, unit: m?.unit || '', category: m?.category || '',
      waste, orderQty, rate, amount: orderQty * rate, missing: !(p?.price > 0),
    };
  });

  // procurement sheet: one line per material across all assemblies
  const byMaterial = new Map();
  for (const r of rows) {
    const g = byMaterial.get(r.materialId) || {
      materialId: r.materialId, name: r.name, unit: r.unit, rate: r.rate, missing: r.missing,
      leadDays: materials.get(r.materialId)?.leadDays || 0, qty: 0, amount: 0, taskIds: [],
    };
    g.qty += r.orderQty;
    g.amount += r.amount;
    if (r.taskId && !g.taskIds.includes(r.taskId)) g.taskIds.push(r.taskId);
    byMaterial.set(r.materialId, g);
  }

  const direct = rows.reduce((s, r) => s + r.amount, 0);
  return {
    rows,
    procurement: [...byMaterial.values()],
    totals: applyMarkups(direct, project.markups),
    steelT: rows.filter(r => r.category === 'Steel' && r.unit === 't').reduce((s, r) => s + r.qty, 0),
  };
}
