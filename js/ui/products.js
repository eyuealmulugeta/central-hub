// v1.19.0 (owner, 8 Nov, G10 T1): Trading > Products. The catalogue of what Amistad buys and sells, with what each
// cost landed last time and what it sold for. No warehouse: no stock count; "bought, not sold yet" comes from shipments.

import { store } from '../core/store.js';
import { uid, money, num, downloadText } from '../core/util.js';
import { html, chip } from './dom.js';
import { xlsxBytes } from '../core/xlsxwrite.js';
import { nextCode, sameProduct, productStats, productSheets, unlinkedLines } from '../engine/products.js';
import { TRADING } from '../core/division.js';

let editing = '';      // product id being edited, or 'new'
let notice = '';
let showOff = false;

const blank = () => ({ id: '', code: '', name: '', unit: '', hs: '', supplier: '', notes: '' });

function form(p, c) {
  const suppliers = [...new Set((c.company.shipments || []).map(s => s.supplier).filter(Boolean))];
  return html`<form data-form="prodSave" class="form box pad">
    <input type="hidden" name="id" value="${p.id}">
    <div class="grid3">
      <label>Code <input name="code" value="${p.code || nextCode(c.company.products)}" required maxlength="30"></label>
      <label>Product <input name="name" value="${p.name}" required maxlength="120" placeholder="e.g. Sandwich panel 50 mm"></label>
      <label>Unit <input name="unit" value="${p.unit || ''}" maxlength="20" placeholder="e.g. m², pcs, ton"></label>
      <label>HS code <input name="hs" value="${p.hs || ''}" maxlength="20" placeholder="for customs"></label>
      <label>Usual supplier <input name="supplier" value="${p.supplier || ''}" list="prod-suppliers" maxlength="120"></label>
      <label>Notes <input name="notes" value="${p.notes || ''}" maxlength="300"></label>
    </div>
    <datalist id="prod-suppliers">${suppliers.map(n => html`<option value="${n}"></option>`)}</datalist>
    <div class="actions left"><button class="btn primary">Save</button><button type="button" class="btn" data-act="prodCancel">Cancel</button></div>
  </form>`;
}

export function render(c) {
  const cur = c.global.fx.base;
  const all = productStats(c.company, c.global.fx, cur);
  const list = all.filter(p => showOff || !p.off);
  const loose = unlinkedLines(c.company);
  const m = v => money(v, cur);
  const edit = editing === 'new' ? blank() : all.find(p => p.id === editing);

  return html`<section class="card wide">
    <div class="toolbar"><h2>Products</h2><span class="muted">${notice}</span><span class="grow"></span>
      <label class="check"><input type="checkbox" data-chg="prodOff" ${showOff ? 'checked' : ''}> Show products not in use</label>
      <button class="btn" data-act="prodExcel" ${all.length ? '' : 'disabled'}>Excel</button>
      <button class="btn primary" data-act="prodNew">New product</button></div>
    <p class="muted small">No warehouse: goods go from the supplier to the customer. "Bought, not sold yet" is what is on resale shipments and not sold. Figures in ${cur}.</p>
    ${edit ? form(edit, c) : ''}
    ${list.length ? html`<div class="table-wrap"><table class="table compact">
      <thead><tr><th>Code</th><th>Product</th><th>Usual supplier</th><th class="r">Bought</th><th class="r">Last landed per unit</th><th class="r">Sold</th><th class="r">Average price</th><th class="r">Profit</th><th class="r">Not sold yet</th><th></th></tr></thead>
      <tbody>${list.map(p => html`<tr class="${p.off ? 'muted' : ''}">
        <td class="nowrap">${p.code}</td>
        <td>${p.name}${p.hs ? html`<span class="muted note">HS ${p.hs}</span>` : ''}${p.off ? html` ${chip('Not in use')}` : ''}</td>
        <td>${p.lastSupplier}</td>
        <td class="r nowrap">${num(p.bought)} ${p.unit || ''}</td>
        <td class="r nowrap">${p.lastLanded == null ? '—' : html`${num(p.lastLanded)} <span class="muted">${p.lastRef}</span>`}</td>
        <td class="r nowrap">${num(p.sold)}</td>
        <td class="r nowrap">${p.avgPrice == null ? '—' : num(p.avgPrice)}</td>
        <td class="r nowrap ${p.profit < 0 ? 'bad' : ''}">${p.sold ? html`${m(p.profit)}${p.margin != null ? html` <span class="muted">${Math.round(p.margin)}%</span>` : ''}` : '—'}</td>
        <td class="r nowrap">${p.notSold ? num(p.notSold) : '—'}</td>
        <td class="r nowrap"><button class="btn ghost small" data-act="prodEdit" data-id="${p.id}">Edit</button>
          <button class="btn ghost small" data-act="prodToggle" data-id="${p.id}">${p.off ? 'Use again' : 'Stop using'}</button></td>
      </tr>`)}</tbody></table></div>` : html`<p class="empty">No products yet. Add the first one with "New product", then pick it on a shipment's goods.</p>`}
    ${loose.length && all.length ? html`<p class="muted small">${loose.length} shipment item${loose.length === 1 ? ' is' : 's are'} not linked to a product. Open the shipment and choose the product on each item.</p>` : ''}
  </section>`;
}

export const actions = {
  prodNew() { editing = 'new'; notice = ''; },
  prodEdit(el) { editing = el.dataset.id; notice = ''; },
  prodCancel() { editing = ''; },
  prodToggle(el, c) {
    const p = (c.company.products || []).find(x => x.id === el.dataset.id);
    if (!p) return;
    if (!p.off && !confirm(`Stop using ${p.name}? It stays on old shipments and sales, and can be used again later.`)) return;
    store.updateCompany(co => { const x = co.products.find(y => y.id === p.id); if (x) x.off = !x.off; });
    notice = p.off ? `${p.name} is in use again.` : `${p.name} is no longer in use.`;
  },
  prodExcel(el, c) {
    const cur = c.global.fx.base;
    downloadText(`Products ${c.today}.xlsx`, xlsxBytes(productSheets(productStats(c.company, c.global.fx, cur), cur)), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  },
};

export const changes = { prodOff(el) { showOff = el.checked; } };

export const submits = {
  prodSave(fd, c) {
    const v = k => String(fd.get(k) || '').trim();
    const p = { code: v('code'), name: v('name'), unit: v('unit'), hs: v('hs'), supplier: v('supplier'), notes: v('notes') };
    const id = v('id');
    if (!p.code || !p.name) { notice = 'Enter the code and the product name.'; return false; }
    const twin = sameProduct(c.company.products, p, id);
    if (twin) { notice = `${twin.code} ${twin.name} already has this ${twin.code.toLowerCase() === p.code.toLowerCase() ? 'code' : 'name'}.`; return false; }
    store.updateCompany(co => {
      co.products ||= [];
      const x = id && co.products.find(y => y.id === id);
      if (x) Object.assign(x, p);
      else co.products.push({ id: uid('pr'), ...p, off: false, created: c.today, division: TRADING });
    });
    notice = `${p.name} saved.`;
    editing = '';
  },
};
