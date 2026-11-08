// v1.21.0 (owner, 8 Nov, G10 T3): Trading > Deals. Enquiry -> Quotation -> Approved -> Order -> Delivered -> Invoiced ->
// Paid (or Lost). Prices from the last landed cost + margin; the GM approves every quotation, the Admin too below 10%
// margin; an order opens the supplier shipment in one tap; quotation, delivery note and invoice print in the house style.

import { store } from '../core/store.js';
import { uid, money, num, fmtDate, fmtFull, downloadText } from '../core/util.js';
import { html, options, chip } from './dom.js';
import { xlsxBytes } from '../core/xlsxwrite.js';
import { docHead, docSec, signoff, docFoot, footText } from './print.js';
import { stampPng } from './seal.js';
import { productStats } from '../engine/products.js';
import { partnerOf, termsLabel } from '../engine/partners.js';
import { nextRef, landed } from '../engine/trade.js';
import { PEG } from '../engine/zoho.js';
import { STEPS, OPEN, METHODS, MIN_MARGIN, stepLabel, stepIndex, nextStep, blockOf, dealTotals, approvalNeeds, mayApprove, priceAt, dueDate, dealSummary, dealSheets, nextDealRef, nextQuote, nextInvoice, shipmentFor } from '../engine/deals.js';
import { TRADING } from '../core/division.js';

let open = '';
let filter = 'open';    // open | all | <step> | lost
let notice = '';
let doc = '';           // '' | quote | delivery | invoice: the printable page of the open deal

const isGM = () => (store.ranks || []).includes('general_manager');
const me = () => ({ by: store.user?.email || '', name: store.profile?.name || store.user?.displayName || store.user?.email || (store.isAdmin ? 'Admin' : 'GM'), at: new Date().toISOString() });
const STEP_CLS = { enquiry: '', quotation: 'info', approved: 'info', order: 'warn', delivered: 'warn', invoiced: 'warn', paid: 'ok', lost: 'high' };
const find = co => (co.deals || []).find(d => d.id === open);
const editable = d => d.status === 'enquiry' || d.status === 'quotation';
const usd = v => money(v, 'USD', 2), aed = v => money(v * PEG, 'AED');

function lineTable(d, c, t) {
  const ed = editable(d);
  const prods = productStats(c.company, c.global.fx, 'USD').filter(p => !p.off);
  return html`<table class="table compact">
    <thead><tr><th>Product</th><th class="r">Qty</th><th>Unit</th><th class="r">Cost per unit</th><th class="r">Margin %</th><th class="r">Price per unit</th><th class="r">Amount</th><th class="r">Profit</th>${ed ? html`<th></th>` : ''}</tr></thead>
    <tbody>${t.lines.map(l => html`<tr>
      <td>${l.description}</td>
      <td class="r">${ed ? html`<input class="narrow" type="number" min="0" step="any" value="${l.qty}" data-chg="dlLine" data-id="${l.id}" data-f="qty" data-fk="dl-q-${l.id}" aria-label="Quantity">` : num(l.qty)}</td>
      <td>${l.unit || ''}</td>
      <td class="r">${ed ? html`<input class="price" type="number" min="0" step="any" value="${l.cost}" data-chg="dlLine" data-id="${l.id}" data-f="cost" data-fk="dl-c-${l.id}" aria-label="Cost per unit">` : num(l.cost)}</td>
      <td class="r">${ed ? html`<input class="narrow" type="number" min="0" max="95" step="any" value="${l.margin == null ? '' : Math.round(l.margin * 10) / 10}" data-chg="dlLine" data-id="${l.id}" data-f="margin" data-fk="dl-m-${l.id}" aria-label="Margin">` : l.margin == null ? '—' : `${Math.round(l.margin)}%`}</td>
      <td class="r">${ed ? html`<input class="price" type="number" min="0" step="any" value="${l.price}" data-chg="dlLine" data-id="${l.id}" data-f="price" data-fk="dl-p-${l.id}" aria-label="Price per unit">` : num(l.price)}</td>
      <td class="r nowrap">${usd(l.priceTotal)}</td>
      <td class="r nowrap ${l.profit < 0 ? 'bad' : ''}">${usd(l.profit)}</td>
      ${ed ? html`<td class="r"><button class="btn ghost small" data-act="dlDropLine" data-id="${l.id}">Remove</button></td>` : ''}
    </tr>`)}</tbody>
    <tfoot><tr><td colspan="6"><b>Total</b> ${t.margin != null ? html`<span class="muted">margin ${num(t.margin, 1)}%</span>` : ''}</td><td class="r nowrap"><b>${usd(t.price)}</b><br><span class="muted">${aed(t.price)}</span></td><td class="r nowrap"><b>${usd(t.profit)}</b></td>${ed ? html`<td></td>` : ''}</tr></tfoot>
  </table>
  ${ed ? html`<form data-form="dlLine" class="entry">
    <select name="productId" required aria-label="Product"><option value="">Product…</option>${prods.map(p => html`<option value="${p.id}">${p.code} ${p.name}${p.lastLanded != null ? ` (landed ${num(p.lastLanded)})` : ''}</option>`)}</select>
    <input type="number" name="qty" min="0" step="any" placeholder="Qty" required class="amount" aria-label="Quantity">
    <input type="number" name="margin" min="0" max="95" step="any" placeholder="Margin %" value="${d.margin ?? 20}" class="amount" aria-label="Margin">
    <button class="btn">Add product</button></form>
    ${prods.length ? '' : html`<p class="muted small">Add products first under Trading > Products.</p>`}
    <div class="actions left"><label class="inline">Margin for every line, % <input class="narrow" type="number" min="0" max="95" step="any" value="${d.margin ?? 20}" data-chg="dlAllMargin" data-fk="dl-all-m"></label></div>` : ''}`;
}

function stepFields(d, c) {
  const s = d.status;
  const f = (label, name, type = 'text', v = d[name] || '') => html`<label>${label} <input type="${type}" value="${v}" data-chg="dlSet" data-f="${name}" data-fk="dl-${name}" ${type === 'date' ? `max="${c.today}"` : ''}></label>`;
  return html`<div class="grid3">
    ${stepIndex(s) >= stepIndex('approved') && s !== 'lost' ? html`${f("Customer's PO No.", 'po')}${f('PO date', 'poDate', 'date')}` : ''}
    ${stepIndex(s) >= stepIndex('order') && s !== 'lost' ? f('Delivered to the customer on', 'delivered', 'date') : ''}
    ${stepIndex(s) >= stepIndex('invoiced') && s !== 'lost' ? html`${f('Paid on', 'paidOn', 'date')}<label>Method <select data-chg="dlSet" data-f="method" data-fk="dl-method">${options(METHODS, d.method || 'bank')}</select></label>${f('Payment ref.', 'payRef')}` : ''}
  </div>`;
}

/** v1.22.0 (G10 T4): the deal's shipment now costs more per unit than the cost the price was made from. */
function costRise(d, ship, c) {
  if (!ship) return '';
  const got = landed(ship, c.global.fx, 'USD').lines;
  const up = (d.lines || []).map((l, i) => ({ l, now: (got.find(x => x.productId && x.productId === l.productId) || got[i])?.unitLanded })).filter(x => x.now > (+x.l.cost || 0) * 1.005);
  if (!up.length) return '';
  return html`<p class="callout warn small"><b>The landed cost went up</b> on shipment ${ship.ref}: ${up.map(x => `${x.l.description} ${num(x.l.cost)} → ${num(x.now)} per unit`).join('; ')}. The margin on this deal is lower than quoted.</p>`;
}

function detail(d, c) {
  const t = dealTotals(d), need = approvalNeeds(d), can = mayApprove(d, { admin: store.isAdmin, gm: isGM() });
  const nx = nextStep(d.status), block = nx ? blockOf(d, nx) : '';
  const partner = partnerOf(c.company.partners, d.customer);
  const customers = (c.company.partners || []).filter(p => !p.off && p.kind !== 'supplier');
  const ship = d.shipmentId && (c.company.shipments || []).find(s => s.id === d.shipmentId);
  const nxLabel = { quotation: 'Make the quotation', approved: 'Mark as approved', order: 'Customer ordered', delivered: 'Mark as delivered', invoiced: 'Make the invoice', paid: 'Mark as paid' }[nx];
  return html`<section class="card">
    <div class="toolbar"><h2>${d.ref} ${d.customer || 'No customer yet'}</h2>${chip(stepLabel(d.status), STEP_CLS[d.status])}<span class="grow"></span><span class="muted">${notice}</span>
      ${d.quote ? html`<button class="btn" data-act="dlDoc" data-doc="quote">Quotation ${d.quote}</button>` : ''}
      ${d.delivered ? html`<button class="btn" data-act="dlDoc" data-doc="delivery">Delivery note</button>` : ''}
      ${d.invoice ? html`<button class="btn" data-act="dlDoc" data-doc="invoice">Invoice ${d.invoice}</button>` : ''}
      ${d.status !== 'lost' && d.status !== 'paid' && d.status !== 'invoiced' ? html`<button class="btn ghost" data-act="dlLost">Lost</button>` : ''}
      ${store.isAdmin && (d.status === 'enquiry' || d.status === 'lost') ? html`<button class="btn danger" data-act="dlDelete">Delete</button>` : ''}</div>
    <ol class="steps">${STEPS.map(([k, label], i) => html`<li class="${d.status !== 'lost' && i <= stepIndex(d.status) ? 'on' : ''}">${label}</li>`)}</ol>
    ${d.status === 'lost' ? html`<p class="callout warn small">Lost on ${fmtDate(d.lost?.at)}: ${d.lost?.reason || 'no reason given'}. <button class="btn small" data-act="dlReopen">Open again</button></p>` : ''}
    <div class="grid3">
      <label>Customer ${editable(d) ? html`<input value="${d.customer || ''}" list="dl-customers" data-chg="dlSet" data-f="customer" data-fk="dl-cust">` : html`<input value="${d.customer || ''}" disabled>`}</label>
      <label>Wanted by <input type="date" value="${d.wanted || ''}" data-chg="dlSet" data-f="wanted" data-fk="dl-wanted"></label>
      <label>Terms <input value="${partner ? termsLabel(partner.terms) : 'Add the customer under Partners'}" disabled></label>
    </div>
    <datalist id="dl-customers">${customers.map(p => html`<option value="${p.name}"></option>`)}</datalist>
    ${lineTable(d, c, t)}
    <label>Notes (printed on the quotation) <textarea rows="2" data-chg="dlSet" data-f="notes" data-fk="dl-notes">${d.notes || ''}</textarea></label>
    ${stepIndex(d.status) >= stepIndex('quotation') ? html`<div class="box pad small"><b>Approval</b>:
      GM ${d.gm ? chip(`${d.gm.name}, ${fmtFull(d.gm.at.slice(0, 10))}`, 'ok') : chip('Waiting', 'warn')}
      ${need.low ? html` · Admin (margin below ${MIN_MARGIN}%) ${d.admin ? chip(`${d.admin.name}, ${fmtFull(d.admin.at.slice(0, 10))}`, 'ok') : chip('Waiting', 'warn')}` : ''}
      ${can.gm || can.admin ? html` <button class="btn primary small" data-act="dlApprove">Approve</button>` : ''}</div>` : ''}
    ${stepFields(d, c)}
    ${costRise(d, ship, c)}
    ${stepIndex(d.status) >= stepIndex('order') && d.status !== 'lost' ? html`<p class="small">${ship ? html`Supplier shipment: <b>${ship.ref}</b> ${ship.supplier || ''} (${ship.status}). Open it under Trading > Shipments for freight and dates.`
      : html`No supplier shipment yet. <button class="btn small" data-act="dlShip">Open the supplier shipment</button> <span class="muted">It copies these products at their cost; then add the supplier, freight and dates.</span>`}</p>` : ''}
    ${nx && d.status !== 'lost' ? html`<div class="actions left"><button class="btn primary" data-act="dlNext" ${block ? 'disabled' : ''}>${nxLabel}</button>${block ? html`<span class="muted">${block}</span>` : ''}</div>` : ''}
  </section>`;
}

function paper(d, c) {
  const t = dealTotals(d), partner = partnerOf(c.company.partners, d.customer) || {};
  const titles = { quote: ['Quotation', d.quote, d.created], delivery: ['Delivery note', `DN-${d.ref}`, d.delivered], invoice: ['Invoice', d.invoice, d.invoiceDate] };
  const [title, ref, day] = titles[doc];
  const prices = doc !== 'delivery';
  const cc = { ...c, global: { ...c.global, company: { ...(c.global.company || {}), name: 'Amistad Pre Fab Trading FZCO' } } };   // the trading company's papers
  const facts = [['Date', fmtFull(day || c.today)], ['Customer', d.customer], ['TRN', partner.trn || ''], ["Customer's PO", d.po || ''], ['Deal', d.ref],
    ...(doc === 'invoice' ? [['Due', fmtFull(d.due)], ['Terms', termsLabel(partner.terms)]] : []), ...(doc === 'quote' ? [['Valid for', '30 days']] : [])];
  return html`<section class="card sheet"><div class="toolbar"><button class="btn" data-act="dlDocClose">Back to the deal</button><span class="grow"></span><button class="btn primary" data-act="dlPrint">Print or PDF</button></div>
    <div class="paper dsr doc-paper" data-foot="${footText(cc, title, ref, { project: false })}">
      ${docHead(cc, { title, ref, facts })}
      ${docSec(1, prices ? 'Goods and prices' : 'Goods delivered', html`<table><thead><tr><th>#</th><th>Description</th><th class="r">Qty</th><th>Unit</th>${prices ? html`<th class="r">Unit price (USD)</th><th class="r">Amount (USD)</th>` : html`<th>Received in good order</th>`}</tr></thead>
        <tbody>${t.lines.map((l, i) => html`<tr><td>${i + 1}</td><td>${l.description}</td><td class="r">${num(l.qty)}</td><td>${l.unit || ''}</td>${prices ? html`<td class="r">${num(l.price, 2)}</td><td class="r">${num(l.priceTotal, 2)}</td>` : html`<td></td>`}</tr>`)}</tbody>
        ${prices ? html`<tfoot><tr><td colspan="5"><b>Total (USD)</b></td><td class="r"><b>${num(t.price, 2)}</b></td></tr><tr><td colspan="5" class="muted">In AED at ${PEG}</td><td class="r muted">${num(t.price * PEG, 2)}</td></tr></tfoot>` : ''}</table>`)}
      ${d.notes && doc === 'quote' ? docSec(2, 'Notes', html`<p>${d.notes}</p>`) : ''}
      ${doc === 'invoice' ? docSec(2, 'Payment', html`<p>Please pay by ${fmtFull(d.due)}, quoting ${d.invoice}.</p>`) : ''}
      ${signoff(doc === 'delivery' ? [{ label: 'Delivered by' }, { label: 'Received by (customer)' }] : [{ label: 'For Amistad Pre Fab Trading FZCO', name: d.gm?.name || '' }], { stamp: stampPng() })}
      ${docFoot(footText(cc, title, ref, { project: false }))}
    </div></section>`;
}

export function render(c) {
  const deals = c.company.deals || [];
  const d = deals.find(x => x.id === open);
  if (d && doc) return paper(d, c);
  const s = dealSummary(deals, c.today);
  const list = deals.filter(x => filter === 'all' || (filter === 'open' ? OPEN.includes(x.status) : x.status === filter))
    .sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')) || String(b.ref).localeCompare(String(a.ref)));
  const kpi = (label, value, sub, cls = '') => html`<div class="kpi"><span class="kpi-label">${label}</span><strong class="${cls}">${value}</strong><span class="muted">${sub}</span></div>`;
  return html`<section class="kpis">
      ${kpi('Open deals', s.open, `worth ${usd(s.openValue)}`)}
      ${kpi('Waiting for approval', s.waiting, 'Quotations', s.waiting ? 'warn' : '')}
      ${kpi('Won this month', s.wonMonth, 'Invoiced')}
      ${kpi('Lost this month', s.lostMonth, '')}
    </section>
    <section class="card wide">
      <div class="toolbar"><h2>Deals</h2><span class="grow"></span>
        <select data-chg="dlFilter" aria-label="Show">${options([['open', 'Open deals'], ['all', 'All deals'], ...STEPS, ['lost', 'Lost']], filter)}</select>
        <button class="btn" data-act="dlExcel" ${deals.length ? '' : 'disabled'}>Excel</button>
        <button class="btn primary" data-act="dlNew">New deal</button></div>
      ${list.length ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>Deal</th><th>Customer</th><th>Step</th><th class="r">Price</th><th class="r">Margin</th><th>Wanted by</th></tr></thead>
        <tbody>${list.map(x => { const t = dealTotals(x); const n = approvalNeeds(x); return html`<tr class="${x.id === open ? 'sel' : ''}">
          <td><button class="link" data-act="dlOpen" data-id="${x.id}">${x.ref}</button> <span class="muted">${x.quote || ''}</span></td><td>${x.customer || '—'}</td>
          <td>${chip(stepLabel(x.status), STEP_CLS[x.status])} ${x.status === 'quotation' && !n.done ? chip('Approval', 'warn') : ''}</td>
          <td class="r nowrap">${usd(t.price)}</td><td class="r ${t.margin != null && t.margin < MIN_MARGIN ? 'bad' : ''}">${t.margin == null ? '—' : `${Math.round(t.margin)}%`}</td><td class="nowrap">${fmtDate(x.wanted)}</td></tr>`; })}</tbody></table></div>`
        : html`<p class="empty">No deals here. Start one with "New deal" when a customer asks for a price.</p>`}
    </section>
    ${d ? detail(d, c) : ''}`;
}

const upd = fn => store.updateCompany(co => { const d = find(co); if (d) { fn(d, co); d.updated = new Date().toISOString(); } });

export const actions = {
  dlNew(el, c) {
    const d = { id: uid('dl'), ref: nextDealRef(c.company.deals), customer: '', status: 'enquiry', margin: 20, lines: [], wanted: '', notes: '', created: c.today, by: store.user?.email || '', division: TRADING };
    store.updateCompany(co => { co.deals ||= []; co.deals.push(d); });
    open = d.id; notice = ''; doc = '';
  },
  dlOpen(el) { open = open === el.dataset.id ? '' : el.dataset.id; notice = ''; doc = ''; },
  dlDoc(el) { doc = el.dataset.doc; },
  dlDocClose() { doc = ''; },
  dlPrint() { window.print(); },
  dlDropLine(el) { upd(d => { d.lines = d.lines.filter(l => l.id !== el.dataset.id); d.gm = null; d.admin = null; }); },
  dlApprove(el, c) {
    const d = find(c.company); if (!d) return;
    const can = mayApprove(d, { admin: store.isAdmin, gm: isGM() });
    if (!can.gm && !can.admin) return;
    const t = dealTotals(d);
    if (!confirm(`Approve quotation ${d.quote} for ${d.customer}: ${usd(t.price)}, margin ${t.margin == null ? '—' : num(t.margin, 1)}%?`)) return;
    upd(x => { if (can.gm) x.gm = me(); if (can.admin) x.admin = me(); });
    notice = 'Approved.';
  },
  dlNext(el, c) {
    const d = find(c.company); const to = d && nextStep(d.status);
    if (!to || blockOf(d, to)) return;
    const partner = partnerOf(c.company.partners, d.customer);
    if (to === 'invoiced' && !confirm(`Make invoice ${nextInvoice(c.company.deals)} for ${d.customer}: ${usd(dealTotals(d).price)}? It then counts in what ${d.customer} owes and in the Zoho export.`)) return;
    upd((x, co) => {
      x.status = to;
      if (to === 'quotation' && !x.quote) x.quote = nextQuote(co.deals);
      if (to === 'invoiced') { x.invoice ||= nextInvoice(co.deals); x.invoiceDate = c.today; x.due = dueDate(c.today, partner?.terms); }
    });
    notice = `${stepLabel(to)}.`;
  },
  dlShip(el, c) {
    const d = find(c.company); if (!d || d.shipmentId) return;
    const sid = uid('sh');
    const supplier = [...new Set((c.company.products || []).filter(p => d.lines.some(l => l.productId === p.id)).map(p => p.supplier).filter(Boolean))];
    store.updateCompany(co => {
      co.shipments.push({ ...shipmentFor(d, { id: sid, ref: nextRef(co.shipments), today: c.today, supplier: supplier.length === 1 ? supplier[0] : '' }), division: TRADING });
      find(co).shipmentId = sid;
    });
    notice = 'Supplier shipment opened under Trading > Shipments.';
  },
  dlLost(el, c) {
    const reason = prompt('Why was this deal lost? (price, time, chose another supplier…)');
    if (reason == null) return;
    upd(d => { d.wasStatus = d.status; d.status = 'lost'; d.lost = { reason: reason.trim(), at: c.today, by: store.user?.email || '' }; });
  },
  dlReopen() { upd(d => { d.status = d.wasStatus && d.wasStatus !== 'lost' ? d.wasStatus : 'enquiry'; d.lost = null; }); },
  dlDelete(el, c) {
    const d = find(c.company);
    if (!d || !confirm(`Delete deal ${d.ref}${d.customer ? ` for ${d.customer}` : ''}?`)) return;
    store.updateCompany(co => { co.deals = co.deals.filter(x => x.id !== d.id); });
    open = '';
  },
  dlExcel(el, c) { downloadText(`Deals ${c.today}.xlsx`, xlsxBytes(dealSheets(c.company.deals, 'USD')), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); },
};

const TEXT = new Set(['customer', 'notes', 'po', 'payRef']);
export const changes = {
  dlFilter(el) { filter = el.value; },
  dlSet(el) { const f = el.dataset.f, v = TEXT.has(f) ? el.value.trim() : el.value; upd(d => { d[f] = v; }); },
  dlAllMargin(el) {
    const m = Math.min(95, Math.max(0, +el.value || 0));
    upd(d => { d.margin = m; for (const l of d.lines) l.price = priceAt(l.cost, m); d.gm = null; d.admin = null; });
  },
  dlLine(el) {
    const f = el.dataset.f, v = Math.max(0, +el.value || 0);
    upd(d => {
      const l = d.lines.find(x => x.id === el.dataset.id); if (!l) return;
      if (f === 'margin') l.price = priceAt(l.cost, v);
      else { l[f] = v; if (f === 'cost') l.price = priceAt(v, d.margin ?? 20); }
      d.gm = null; d.admin = null;   // a changed price is approved again
    });
  },
};

export const submits = {
  dlLine(fd, c) {
    const p = productStats(c.company, c.global.fx, 'USD').find(x => x.id === fd.get('productId'));
    const qty = +fd.get('qty'), margin = Math.min(95, Math.max(0, +fd.get('margin') || 0));
    if (!p || !(qty > 0)) { notice = 'Choose the product and the quantity.'; return false; }
    const cost = Math.round((p.lastLanded || 0) * 100) / 100;
    upd(d => { d.lines.push({ id: uid('dll'), productId: p.id, description: p.name, unit: p.unit || '', qty, cost, price: priceAt(cost, margin) }); d.gm = null; d.admin = null; });
    notice = cost ? '' : `${p.name} has no landed cost yet: enter its cost per unit.`;
  },
};
