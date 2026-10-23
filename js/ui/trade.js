// Trading and freight: shipments from order to site, with their landed cost.
// Shipments belong to the company, not to one project; each can be tied to
// the project it is for, and its landed cost posted to that project's costs.

import { store } from '../core/store.js';
import { STAGES, MODES, INCOTERMS, COST_KINDS, stageLabel, nextStage, costLabel, nextRef, landed, tradeSummary, stockAndSales, priceForMargin, isStock } from '../engine/trade.js';
import { convert } from '../engine/pricing.js';
import { uid, money, num, fmtFull, fmtDate, clamp } from '../core/util.js';
import { html, options, field, chip } from './dom.js';
import { currentDivision, TRADING } from '../core/division.js';

let selected = null;
let notice = '';
let posting = false;
let tab = 'ship';        // ship | stock: set by the shell from the page that is open
export const setTab = t => { tab = t; };
let targetMargin = 20;   // % of the selling price, for the suggested price column

/** Select a shipment from outside this screen (search, quick links). */
export const focusOn = id => { selected = id; };

const STAGE_CLS = { ordered: '', shipped: 'info', port: 'info', customs: 'warn', delivered: 'ok' };
const find = company => company.shipments.find(s => s.id === selected);

export function render(c) {
  const { company, global, project } = c;
  const cur = global.fx.base;
  const currencies = Object.keys(global.fx.rates).map(k => [k, k]);
  const sum = tradeSummary(company.shipments, global.fx, c.today, cur);
  const rows = [...sum.rows].sort((a, b) => (a.state.done ? 1 : 0) - (b.state.done ? 1 : 0) || (a.s.eta || '9').localeCompare(b.s.eta || '9'));
  const row = sum.rows.find(r => r.s.id === selected);
  const kpi = (label, value, sub, cls = '') => html`
    <div class="kpi"><span class="kpi-label">${label}</span><strong class="${cls}">${value}</strong><span class="muted">${sub}</span></div>`;
  const projectName = id => store.projects.find(p => p.id === id)?.name || '';

  if (tab === 'stock') return stockView(c, kpi, currencies);

  return html`
    <section class="kpis">
      ${kpi('On the way', sum.open, `shipment${sum.open === 1 ? '' : 's'} not delivered yet`)}
      ${kpi('Value on the way', money(sum.onTheWay, cur), 'Goods and costs so far')}
      ${kpi('Late', sum.late, 'Past the expected arrival', sum.late ? 'bad' : '')}
      ${kpi('Landed this year', money(sum.landedThisYear, cur), sum.uplift == null ? 'No delivered shipment yet' : `Freight and duties add ${Math.round(sum.uplift)}% on average`)}
    </section>

    <section class="card">
      <div class="toolbar"><h2>Shipments</h2><span class="grow"></span><button class="btn primary" data-act="add">New shipment</button></div>
      ${rows.length ? html`<ul class="list">${rows.map(({ s, cost, state }) => html`
        <li><button class="row pick ${s.id === selected ? 'sel' : ''}" data-act="select" data-id="${s.id}">
          <span class="row-main">
            <b>${s.ref} ${s.supplier || 'No supplier yet'}</b>
            <span class="muted">${[s.origin && s.destination ? `${s.origin} to ${s.destination}` : s.origin || s.destination, projectName(s.projectId)].filter(Boolean).join(', ') || 'No route yet'}</span>
            <span>${chip(stageLabel(s.status), STAGE_CLS[s.status] || '')}
              ${state.late ? chip(`${state.daysLate} days late`, 'high') : state.daysToArrival != null ? html`<span class="muted">arrives in ${state.daysToArrival} d</span>` : ''}</span>
          </span>
          <span class="row-end"><span>${money(cost.total, cur)}</span></span>
        </button></li>`)}</ul>` : html`<p class="empty">No shipments yet. Add the first one with "New shipment".</p>`}
    </section>

    <section class="card">
      ${row ? detail(row, c, currencies) : html`<p class="empty">Choose a shipment on the left to see its route, costs and landed cost.</p>`}
      <span class="muted">${row ? '' : notice}</span>
    </section>`;
}

/** Goods bought for resale: what is left, what was sold, and what it earned. */
function stockView(c, kpi, currencies) {
  const { company, global } = c;
  const cur = global.fx.base;
  const st = stockAndSales(company, global.fx, cur);
  const m = v => money(v, cur);
  const available = st.items.filter(i => i.left > 0);

  return html`
    <section class="kpis">
      ${kpi('Stock value', m(st.stockValue), 'Unsold goods at landed cost')}
      ${kpi('Sold', m(st.revenue), `${st.sales.length} sale${st.sales.length === 1 ? '' : 's'}`)}
      ${kpi('Profit', m(st.profit), st.margin == null ? 'No sale yet' : `${Math.round(st.margin)}% of sales`, st.profit < 0 ? 'bad' : '')}
      ${kpi('Not paid yet', m(st.unpaid), 'Sales waiting for payment')}
    </section>
    <div class="side wide">
      <section class="card">
        <div class="toolbar">
          <h2>Stock</h2><span class="grow"></span>
          <label class="inline">Margin wanted, % <input class="narrow" type="number" min="0" max="95" step="any" data-chg="margin" data-fk="tr-margin" value="${targetMargin}"></label>
        </div>
        ${st.items.length ? html`<table class="table compact">
          <thead><tr><th>Item</th><th>Shipment</th><th class="r">Bought</th><th class="r">Sold</th><th class="r">Left</th><th class="r">Landed per unit</th><th class="r">Sell at, ${num(targetMargin, 1)}% margin</th><th class="r">Stock value</th><th class="r">Profit so far</th></tr></thead>
          <tbody>${st.items.map(i => html`
            <tr>
              <td>${i.description}</td>
              <td class="nowrap">${i.ref} ${i.arrived ? '' : chip('On the way', 'info')}</td>
              <td class="r nowrap">${num(i.bought)} ${i.unit}</td>
              <td class="r">${num(i.sold)}</td>
              <td class="r ${i.left < 0 ? 'bad' : ''}"><b>${num(i.left)}</b></td>
              <td class="r nowrap">${num(i.unitLanded)}</td>
              <td class="r nowrap">${num(priceForMargin(i.unitLanded, targetMargin))}</td>
              <td class="r nowrap">${m(i.stockValue)}</td>
              <td class="r nowrap ${i.profit < 0 ? 'bad' : ''}">${i.sold ? m(i.profit) : '—'}</td>
            </tr>`)}</tbody>
        </table>
        <p class="muted">Prices per unit are in ${cur}. Stock is every shipment marked "For resale". Landed cost includes freight, duties and the other costs entered on the shipment.</p>`
        : html`<p class="empty">Nothing in stock. Add a shipment: the goods on it become stock for resale.</p>`}
      </section>

      <section class="card">
        <div class="toolbar"><h2>Sales</h2><span class="grow"></span><span class="muted">${notice}</span></div>
        ${available.length ? html`<form data-form="sale" class="entry">
          <select name="item" required aria-label="Item sold" class="wide">${available.map(i => html`<option value="${i.key}">${i.description}, ${i.ref}: ${num(i.left)} ${i.unit} left</option>`)}</select>
          <input name="customer" placeholder="Customer" required aria-label="Customer" class="wide">
          <input name="country" placeholder="Country" aria-label="Country">
          <input type="date" name="date" value="${c.today}" max="${c.today}" required aria-label="Date of sale">
          <input type="number" name="qty" min="0" step="any" placeholder="Qty" required aria-label="Quantity" class="amount">
          <input type="number" name="unitPrice" min="0" step="any" placeholder="Unit price" required aria-label="Selling price per unit" class="amount">
          <select name="currency" aria-label="Currency">${options(currencies, c.project.currency)}</select>
          <button class="btn primary">Record sale</button>
        </form>` : html`<p class="muted">There is nothing left in stock to sell.</p>`}
        ${st.sales.length ? html`<table class="table compact">
          <thead><tr><th>Date</th><th>Customer</th><th>Item</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Sale</th><th class="r">Landed cost</th><th class="r">Profit</th><th>Paid</th><th></th></tr></thead>
          <tbody>${st.sales.map(x => html`
            <tr>
              <td class="nowrap">${fmtDate(x.date)}</td>
              <td>${x.customer}${x.country ? html`<span class="muted note">${x.country}</span>` : ''}</td>
              <td>${x.item}</td>
              <td class="r nowrap">${num(x.qty)} ${x.unit}</td>
              <td class="r nowrap">${money(x.unitPrice, x.currency, 2)}</td>
              <td class="r nowrap">${m(x.revenue)}</td>
              <td class="r nowrap">${m(x.cost)}</td>
              <td class="r nowrap ${x.profit < 0 ? 'bad' : ''}">${m(x.profit)}${x.margin != null ? html` <span class="muted">${Math.round(x.margin)}%</span>` : ''}</td>
              <td><label class="check"><input type="checkbox" data-chg="paid" data-id="${x.id}" ${x.paid ? 'checked' : ''} aria-label="Paid"> ${x.paid ? 'Paid' : 'Not yet'}</label></td>
              <td class="r"><button class="btn ghost small" data-act="dropSale" data-id="${x.id}">Delete</button></td>
            </tr>`)}</tbody>
        </table>` : html`<p class="empty">No sales recorded yet.</p>`}
      </section>
    </div>`;
}

function detail({ s, state }, c, currencies) {
  const { global } = c;
  const base = global.fx.base;
  const goodsCur = s.currency || base;
  const cost = landed(s, global.fx, goodsCur);
  const next = nextStage(s.status);
  const target = store.projects.find(p => p.id === s.projectId);
  const stageIndex = STAGES.findIndex(([k]) => k === s.status);

  return html`
    <div class="toolbar">
      <h2>${s.ref}</h2>
      ${chip(stageLabel(s.status), STAGE_CLS[s.status] || '')}
      ${state.late ? chip(`${state.daysLate} days late`, 'high') : ''}
      <span class="grow"></span>
      <span class="muted">${notice}</span>
      ${next ? html`<button class="btn primary" data-act="advance">Mark as ${next[1].toLowerCase()}</button>` : ''}
      <button class="btn danger" data-act="remove">Delete</button>
    </div>
    <ol class="steps">${STAGES.map(([k, label], i) => html`<li class="${i <= stageIndex ? 'on' : ''}">${label}</li>`)}</ol>

    <div class="form">
      <div class="grid3">
        <label>Supplier <input data-chg="set" data-f="supplier" data-fk="sh-supplier" value="${s.supplier || ''}" list="trade-suppliers"></label>
        ${currentDivision() === TRADING ? html`<label>For <input value="Resale (stock)" disabled></label>`
          : html`<label>For project <select data-chg="set" data-f="projectId" data-fk="sh-project">${options(store.projects.map(p => [p.id, p.name]), s.projectId || null)}</select></label>`}
        <label>Goods priced in <select data-chg="set" data-f="currency" data-fk="sh-cur">${options(currencies, goodsCur)}</select></label>
        <label>From <input data-chg="set" data-f="origin" data-fk="sh-origin" value="${s.origin || ''}" placeholder="e.g. Tianjin, China"></label>
        <label>To <input data-chg="set" data-f="destination" data-fk="sh-dest" value="${s.destination || ''}" placeholder="e.g. Modjo dry port"></label>
        <label>Transport <select data-chg="set" data-f="mode" data-fk="sh-mode">${options(MODES, s.mode || 'sea')}</select></label>
        <label>Incoterm <select data-chg="set" data-f="incoterm" data-fk="sh-inco"><option value="">Not set</option>${options(INCOTERMS.map(x => [x, x]), s.incoterm || null)}</select></label>
        <label>Bill of lading or tracking No. <input data-chg="set" data-f="tracking" data-fk="sh-track" value="${s.tracking || ''}"></label>
        <label>Forwarder or carrier <input data-chg="set" data-f="carrier" data-fk="sh-carrier" value="${s.carrier || ''}"></label>
        <label>Shipped on <input type="date" data-chg="set" data-f="etd" data-fk="sh-etd" value="${s.etd || ''}"></label>
        <label>Expected on site <input type="date" data-chg="set" data-f="eta" data-fk="sh-eta" value="${s.eta || ''}"></label>
        <label>Delivered on <input type="date" data-chg="set" data-f="arrived" data-fk="sh-arr" value="${s.arrived || ''}" ${s.status === 'delivered' ? '' : 'disabled'}></label>
      </div>
      <datalist id="trade-suppliers">${[...new Set(c.company.shipments.map(x => x.supplier).filter(Boolean))].map(n => html`<option value="${n}"></option>`)}</datalist>
      ${state.transit != null ? html`<p class="muted">${state.done ? `Door to door in ${state.transit} days.` : `${state.transit} days on the way so far.`}</p>` : ''}

      <h3>Goods <span class="muted">${goodsCur}</span></h3>
      ${s.lines?.length ? html`<table class="table compact">
        <thead><tr><th>Item</th><th class="r">Qty</th><th>Unit</th><th class="r">Unit price</th><th class="r">Value</th><th class="r">Landed per unit</th><th></th></tr></thead>
        <tbody>${cost.lines.map(l => html`
          <tr>
            <td><input data-chg="line" data-id="${l.id}" data-f="description" data-fk="ln-d-${l.id}" value="${l.description}" aria-label="Item"></td>
            <td class="r"><input class="narrow" type="number" min="0" step="any" data-chg="line" data-id="${l.id}" data-f="qty" data-fk="ln-q-${l.id}" value="${l.qty}" aria-label="Quantity"></td>
            <td><input class="narrow" data-chg="line" data-id="${l.id}" data-f="unit" data-fk="ln-u-${l.id}" value="${l.unit || ''}" aria-label="Unit"></td>
            <td class="r"><input class="price" type="number" min="0" step="any" data-chg="line" data-id="${l.id}" data-f="unitCost" data-fk="ln-c-${l.id}" value="${l.unitCost}" aria-label="Unit price"></td>
            <td class="r nowrap">${num(l.value)}</td>
            <td class="r nowrap"><b>${num(l.unitLanded)}</b></td>
            <td class="r"><button class="btn ghost small" data-act="dropLine" data-id="${l.id}">Remove</button></td>
          </tr>`)}</tbody>
      </table>` : html`<p class="muted">Add what was bought: steel, panels, containers, fittings.</p>`}
      <form data-form="line" class="entry">
        <input name="description" placeholder="Item, e.g. Sandwich panel 50 mm" required aria-label="Item" class="wide">
        <input type="number" name="qty" min="0" step="any" placeholder="Qty" required aria-label="Quantity" class="amount">
        <input name="unit" placeholder="Unit" aria-label="Unit" class="amount">
        <input type="number" name="unitCost" min="0" step="any" placeholder="Unit price" required aria-label="Unit price" class="amount">
        <button class="btn">Add item</button>
      </form>

      <h3>Freight, duties and other costs</h3>
      ${s.costs?.length ? html`<table class="table compact">
        <thead><tr><th>Cost</th><th>Note</th><th class="r">Amount</th><th>Currency</th><th></th></tr></thead>
        <tbody>${s.costs.map(x => html`
          <tr>
            <td>${costLabel(x.kind)}</td>
            <td><input data-chg="cost" data-id="${x.id}" data-f="note" data-fk="cs-n-${x.id}" value="${x.note || ''}" aria-label="Note"></td>
            <td class="r"><input class="price" type="number" min="0" step="any" data-chg="cost" data-id="${x.id}" data-f="amount" data-fk="cs-a-${x.id}" value="${x.amount}" aria-label="Amount"></td>
            <td>${x.currency || goodsCur}</td>
            <td class="r"><button class="btn ghost small" data-act="dropCost" data-id="${x.id}">Remove</button></td>
          </tr>`)}</tbody>
      </table>` : html`<p class="muted">Add each cost as its invoice arrives: freight, insurance, duty, clearing, port, inland transport.</p>`}
      <form data-form="cost" class="entry">
        <select name="kind" aria-label="Kind of cost">${options(COST_KINDS, 'freight')}</select>
        <input name="note" placeholder="Note, e.g. invoice No." aria-label="Note" class="wide">
        <input type="number" name="amount" min="0" step="any" placeholder="Amount" required aria-label="Amount" class="amount">
        <select name="currency" aria-label="Currency">${options(currencies, goodsCur)}</select>
        <button class="btn">Add cost</button>
      </form>

      <h3>Landed cost</h3>
      <dl class="totals">
        <dt>Goods</dt><dd>${money(cost.goods, goodsCur, 2)}</dd>
        ${cost.byKind.map(k => html`<dt>${k.label}</dt><dd>${money(k.value, goodsCur, 2)}</dd>`)}
        <dt class="grand">Landed cost</dt><dd class="grand">${money(cost.total, goodsCur, 2)}</dd>
        ${goodsCur !== base ? html`<dt>In ${base}</dt><dd>${money(convert(cost.total, goodsCur, base, global.fx), base, 2)}</dd>` : ''}
      </dl>
      <p class="muted">${cost.uplift == null ? 'Add the goods to see what the route adds to their price.'
        : `Freight, duties and the rest add ${num(cost.uplift, 1)}% to the purchase price. They are shared over the items by value to give the landed cost per unit.`}</p>

      <label>Notes <textarea data-chg="set" data-f="notes" data-fk="sh-notes" rows="2">${s.notes || ''}</textarea></label>

      <div class="actions left">
        ${s.posted ? html`${chip('In project costs', 'ok')} <span class="muted">Posted to ${s.posted.project} on ${fmtFull(s.posted.date)} as ${money(s.posted.amount, s.posted.currency)}. Later changes here are not carried over.</span>`
          : target ? html`<button class="btn" data-act="post" ${posting || !(cost.total > 0) ? 'disabled' : ''}>${posting ? 'Posting…' : `Add landed cost to ${target.name} costs`}</button>
              <span class="muted">Adds one material expense of ${money(convert(cost.total, goodsCur, target.currency, global.fx), target.currency)}. Skip it if these materials were already added to costs from the estimate.</span>`
          : html`<span class="muted">This shipment is stock for resale: sell from it under "Stock and sales". To charge it to a project instead, choose the project above.</span>`}
      </div>
    </div>`;
}

export const actions = {
  select(el) { selected = el.dataset.id; notice = ''; },
  dropSale(el, c) {
    const x = c.company.sales.find(s => s.id === el.dataset.id);
    if (!x || !confirm(`Delete the sale of ${num(x.qty)} to ${x.customer} on ${fmtDate(x.date)}? The quantity goes back into stock.`)) return;
    store.updateCompany(co => { co.sales = co.sales.filter(s => s.id !== x.id); });
    notice = '';
  },
  add(el, c) {
    const s = {
      id: uid('sh'), ref: nextRef(store.company.shipments), supplier: '', projectId: currentDivision() === TRADING ? '' : c.project.id, currency: c.global.fx.base,
      origin: '', destination: '', mode: 'sea', incoterm: '', tracking: '', carrier: '', etd: '', eta: '', arrived: '',
      status: 'ordered', lines: [], costs: [], notes: '', created: c.today,
      division: currentDivision() === TRADING ? TRADING : 'installation',
    };
    store.updateCompany(co => co.shipments.push(s));
    selected = s.id;
    notice = '';
  },
  /** Moves the shipment to its next stage; the dates that belong to a stage are filled in if empty. */
  advance(el, c) {
    const s = find(c.company);
    const next = s && nextStage(s.status);
    if (!next) return;
    store.updateCompany(co => {
      const x = find(co);
      x.status = next[0];
      if (next[0] === 'shipped' && !x.etd) x.etd = c.today;
      if (next[0] === 'delivered' && !x.arrived) x.arrived = c.today;
    });
    notice = `Marked as ${next[1].toLowerCase()}.`;
  },
  remove(el, c) {
    const s = find(c.company);
    if (!s) return;
    const sold = (c.company.sales || []).filter(x => x.shipmentId === s.id).length;
    const posted = (s.posted ? `\n\nIts cost stays in the costs of ${s.posted.project}; delete it there if it should go too.` : '')
      + (sold ? `\n\n${sold} sale(s) were made from it. They stay listed but lose their cost.` : '');
    if (!confirm(`Delete shipment ${s.ref}${s.supplier ? ` from ${s.supplier}` : ''}?${posted}`)) return;
    store.updateCompany(co => { co.shipments = co.shipments.filter(x => x.id !== s.id); });
    selected = null;
    notice = '';
  },
  dropLine(el) { store.updateCompany(co => { const s = find(co); s.lines = s.lines.filter(l => l.id !== el.dataset.id); }); },
  dropCost(el) { store.updateCompany(co => { const s = find(co); s.costs = s.costs.filter(x => x.id !== el.dataset.id); }); },

  /** One material expense in the project's costs, for the whole landed cost. */
  async post(el, c) {
    const s = find(c.company);
    const target = s && store.projects.find(p => p.id === s.projectId);
    if (!s || !target || s.posted || posting) return;
    const goodsCur = s.currency || c.global.fx.base;
    const amount = Math.round(convert(landed(s, c.global.fx, goodsCur).total, goodsCur, target.currency, c.global.fx) * 100) / 100;
    if (!(amount > 0)) return;
    posting = true;
    const ledgerId = uid('l');
    try {
      await store.updateOther(target.id, ws => ws.ledger.push({
        id: ledgerId, date: c.today, type: 'expense', category: 'material', vendor: s.supplier || '',
        description: `Shipment ${s.ref}, landed cost${s.lines?.length ? `: ${s.lines.map(l => l.description).join(', ').slice(0, 80)}` : ''}`,
        amount, currency: target.currency,
      }));
      store.updateCompany(co => { find(co).posted = { ledgerId, project: target.name, date: c.today, amount, currency: target.currency }; });
      notice = `Added to the costs of ${target.name}.`;
    } catch (err) {
      console.warn(err);
      notice = 'Not added: could not reach the project. Try again.';
    }
    posting = false;
    store.notify();
  },
};

const TEXT_FIELDS = new Set(['supplier', 'origin', 'destination', 'tracking', 'carrier', 'notes']);

export const changes = {
  margin(el) { targetMargin = clamp(field(el), 0, 95); },
  paid(el) { store.updateCompany(co => { const x = co.sales.find(s => s.id === el.dataset.id); if (x) x.paid = el.checked; }); },
  set(el) {
    const f = el.dataset.f;
    const value = TEXT_FIELDS.has(f) ? el.value.trim() : el.value;
    store.updateCompany(co => { const s = find(co); if (s) s[f] = value; });
  },
  line(el) {
    const f = el.dataset.f;
    const value = f === 'qty' || f === 'unitCost' ? Math.max(0, field(el)) : el.value.trim();
    if (f === 'description' && !value) return;
    store.updateCompany(co => { const l = find(co)?.lines.find(x => x.id === el.dataset.id); if (l) l[f] = value; });
  },
  cost(el) {
    const f = el.dataset.f;
    const value = f === 'amount' ? Math.max(0, field(el)) : el.value.trim();
    store.updateCompany(co => { const x = find(co)?.costs.find(k => k.id === el.dataset.id); if (x) x[f] = value; });
  },
};

export const submits = {
  sale(fd, c) {
    const [shipmentId, lineId] = fd.get('item').split('|');
    const qty = +fd.get('qty'), unitPrice = +fd.get('unitPrice');
    const item = stockAndSales(c.company, c.global.fx, c.global.fx.base).items.find(i => i.shipmentId === shipmentId && i.lineId === lineId);
    if (!item || !(qty > 0) || !(unitPrice > 0)) { notice = 'Enter the quantity and the selling price.'; return false; }
    if (qty > item.left + 1e-9) { notice = `Only ${num(item.left)} ${item.unit} of ${item.description} are left.`; return false; }
    store.updateCompany(co => co.sales.push({
      id: uid('sl'), date: fd.get('date') || c.today, customer: fd.get('customer').trim(), country: fd.get('country').trim(),
      shipmentId, lineId, qty, unitPrice, currency: fd.get('currency'), paid: false, note: '', division: TRADING,
    }));
    notice = `Sale to ${fd.get('customer').trim()} recorded.`;
  },
  line(fd, c) {
    const description = fd.get('description').trim();
    if (!description || !find(c.company)) return false;
    store.updateCompany(co => find(co).lines.push({
      id: uid('ln'), description, qty: Math.max(0, +fd.get('qty') || 0), unit: fd.get('unit').trim(), unitCost: Math.max(0, +fd.get('unitCost') || 0),
    }));
  },
  cost(fd, c) {
    const amount = +fd.get('amount');
    if (!(amount > 0) || !find(c.company)) return false;
    store.updateCompany(co => find(co).costs.push({ id: uid('cs'), kind: fd.get('kind'), note: fd.get('note').trim(), amount, currency: fd.get('currency') }));
  },
};

/** Late shipments, for the number beside Trading in the sidebar. */
export const lateCount = (company, today) => company.shipments.filter(s => s.status !== 'delivered' && s.eta && s.eta < today).length;
