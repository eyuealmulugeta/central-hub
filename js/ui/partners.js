// v1.20.0 (owner, 8 Nov, G10 T2): Trading > Partners. One list of customers and suppliers, each with its shipments,
// sales, what is owed both ways, overdue sales (sale date + terms) and a statement to print. Anyone with Trading adds
// and edits; the Admin deletes (others "Stop using").

import { store } from '../core/store.js';
import { uid, money, num, fmtDate, downloadText } from '../core/util.js';
import { html, options, chip } from './dom.js';
import { xlsxBytes } from '../core/xlsxwrite.js';
import { KINDS, TERMS, kindLabel, termsLabel, samePartner, namesToAdd, partnerList, statement, partnerSheets } from '../engine/partners.js';
import { PEG } from '../engine/zoho.js';
import { TRADING } from '../core/division.js';

let open = '';         // partner id shown
let editing = '';      // partner id being edited, or 'new'
let notice = '';
let showOff = false;
let stmt = null;       // { id, from, to } when a statement is shown
let draftName = '', draftKind = 'customer';

const blank = () => ({ id: '', name: draftName, kind: draftKind, country: '', city: '', phone: '', email: '', trn: '', currency: 'USD', terms: 30, person: '', notes: '' });
const aed = v => money(v * PEG, 'AED');

function form(p) {
  return html`<form data-form="ptSave" class="form box pad">
    <input type="hidden" name="id" value="${p.id}">
    <div class="grid3">
      <label>Name <input name="name" value="${p.name}" required maxlength="120"></label>
      <label>Type <select name="kind">${options(KINDS, p.kind || 'customer')}</select></label>
      <label>Contact person <input name="person" value="${p.person || ''}" maxlength="80"></label>
      <label>Country <input name="country" value="${p.country || ''}" maxlength="60"></label>
      <label>City <input name="city" value="${p.city || ''}" maxlength="60"></label>
      <label>Phone <input name="phone" value="${p.phone || ''}" maxlength="40" inputmode="tel"></label>
      <label>Email <input type="email" name="email" value="${p.email || ''}" maxlength="120"></label>
      <label>TRN (UAE tax No.) <input name="trn" value="${p.trn || ''}" maxlength="20"></label>
      <label>Payment terms <select name="terms">${TERMS.map(([d, l]) => html`<option value="${d}" ${+p.terms === d ? 'selected' : ''}>${l}</option>`)}</select></label>
      <label>Currency <select name="currency">${options([['USD', 'USD'], ['AED', 'AED']], p.currency || 'USD')}</select></label>
      <label class="span2">Notes <input name="notes" value="${p.notes || ''}" maxlength="300"></label>
    </div>
    <div class="actions left"><button class="btn primary">Save</button><button type="button" class="btn" data-act="ptCancel">Cancel</button></div>
  </form>`;
}

function statementView(p, c, cur) {
  const s = statement(p, c.company, c.global.fx, cur, stmt.from, stmt.to, c.today);
  const m = v => (v ? money(v, cur, 2) : '');
  return html`<div class="box pad statement">
    <div class="toolbar"><h3>Statement: ${p.name}</h3><span class="grow"></span>
      <label>From <input type="date" value="${stmt.from}" data-chg="ptFrom"></label><label>To <input type="date" value="${stmt.to}" data-chg="ptTo"></label>
      <button class="btn" data-act="ptPrint">Print or PDF</button><button class="btn ghost" data-act="ptStmtClose">Close</button></div>
    <p class="muted small">Amistad Pre Fab Trading FZCO. ${[p.country, p.trn ? `TRN ${p.trn}` : '', termsLabel(p.terms)].filter(Boolean).join(', ')}. In ${cur}; 1 USD = ${PEG} AED.</p>
    <table class="table compact"><thead><tr><th>Date</th><th>Ref.</th><th>What</th><th class="r">They owe</th><th class="r">Paid or we owe</th><th class="r">Balance</th></tr></thead>
      <tbody><tr><td colspan="5"><b>Opening balance</b></td><td class="r">${money(s.opening, cur, 2)}</td></tr>
      ${s.rows.map(l => html`<tr><td class="nowrap">${fmtDate(l.date)}</td><td class="nowrap">${l.ref}</td><td>${l.what}</td><td class="r">${m(l.debit)}</td><td class="r">${m(l.credit)}</td><td class="r nowrap">${money(l.balance, cur, 2)}</td></tr>`)}
      <tr><td colspan="5"><b>Closing balance</b> <span class="muted">${s.closing > 0 ? `${p.name} owes Amistad` : s.closing < 0 ? `Amistad owes ${p.name}` : 'Settled'}</span></td><td class="r"><b>${money(s.closing, cur, 2)}</b><br><span class="muted">${aed(s.closing)}</span></td></tr></tbody></table>
  </div>`;
}

function detail(p, c, cur) {
  const m = v => money(v, cur);
  return html`<section class="card">
    <div class="toolbar"><h2>${p.name}</h2>${chip(kindLabel(p.kind))}${p.off ? chip('Not in use') : ''}<span class="grow"></span>
      <button class="btn" data-act="ptStmt">Statement</button>
      <button class="btn" data-act="ptEdit" data-id="${p.id}">Edit</button>
      <button class="btn ghost" data-act="ptToggle" data-id="${p.id}">${p.off ? 'Use again' : 'Stop using'}</button>
      ${store.isAdmin ? html`<button class="btn danger" data-act="ptDelete" data-id="${p.id}">Delete</button>` : ''}</div>
    <p class="muted">${[p.person, p.phone, p.email, [p.city, p.country].filter(Boolean).join(', '), p.trn ? `TRN ${p.trn}` : '', `Terms: ${termsLabel(p.terms)}`].filter(Boolean).join(' · ')}</p>
    ${p.notes ? html`<p class="small">${p.notes}</p>` : ''}
    <section class="kpis">
      <div class="kpi"><span class="kpi-label">Sold to them</span><strong>${m(p.sold)}</strong><span class="muted">${p.sales.length} sale(s)</span></div>
      <div class="kpi"><span class="kpi-label">They owe</span><strong>${m(p.owedToUs)}</strong><span class="muted">${aed(p.owedToUs)}</span></div>
      <div class="kpi"><span class="kpi-label">Overdue</span><strong class="${p.overdue ? 'bad' : ''}">${m(p.overdue)}</strong><span class="muted">${p.overdueCount} sale(s) past terms</span></div>
      <div class="kpi"><span class="kpi-label">Bought from them</span><strong>${m(p.bought)}</strong><span class="muted">we owe ${m(p.weOwe)}</span></div>
    </section>
    ${stmt?.id === p.id ? statementView(p, c, cur) : ''}
    ${p.sales.length ? html`<h3>Sales</h3><table class="table compact"><thead><tr><th>Date</th><th>Item</th><th class="r">Qty</th><th class="r">Sale</th><th>Due</th><th>Paid</th></tr></thead>
      <tbody>${p.sales.map(x => html`<tr><td class="nowrap">${fmtDate(x.date)}</td><td>${x.item}</td><td class="r nowrap">${num(x.qty)} ${x.unit}</td><td class="r nowrap">${m(x.revenue)}</td>
        <td class="nowrap">${fmtDate(x.due)} ${x.overdue ? chip(`${x.daysLate} days late`, 'high') : ''}</td><td>${x.paid ? chip('Paid', 'ok') : 'Not yet'}</td></tr>`)}</tbody></table>` : ''}
    ${p.shipments.length ? html`<h3>Shipments</h3><table class="table compact"><thead><tr><th>Ref.</th><th>Ordered</th><th>Goods</th><th class="r">Goods value</th><th class="r">Paid to supplier</th></tr></thead>
      <tbody>${p.shipments.map(({ s, goods, paid }) => html`<tr><td class="nowrap">${s.ref}</td><td class="nowrap">${fmtDate(s.ordered || s.created)}</td><td>${(s.lines || []).map(l => l.description).join(', ')}</td><td class="r nowrap">${m(goods)}</td>
        <td class="r nowrap">${m(paid)} ${goods - paid > 0.005 ? html`<span class="muted">balance ${m(goods - paid)}</span>` : chip('Paid', 'ok')}</td></tr>`)}</tbody></table>
      <p class="muted small">Deposits and balances paid to the supplier are added on each shipment under Trading > Shipments.</p>` : ''}
    ${!p.sales.length && !p.shipments.length ? html`<p class="empty">No sales or shipments with this name yet.</p>` : ''}
  </section>`;
}

export function render(c) {
  const cur = c.global.fx.base;
  const all = partnerList(c.company, c.global.fx, cur, c.today);
  const list = all.filter(p => showOff || !p.off || p.id === open);
  const toAdd = namesToAdd(c.company);
  const m = v => money(v, cur);
  const edit = editing === 'new' ? blank() : all.find(p => p.id === editing);
  const sel = all.find(p => p.id === open);

  return html`<section class="card wide">
    <div class="toolbar"><h2>Partners</h2><span class="muted">${notice}</span><span class="grow"></span>
      <label class="check"><input type="checkbox" data-chg="ptOff" ${showOff ? 'checked' : ''}> Show partners not in use</label>
      <button class="btn" data-act="ptExcel" ${all.length ? '' : 'disabled'}>Excel</button>
      <button class="btn primary" data-act="ptNew">New partner</button></div>
    <p class="muted small">Customers and suppliers in one list. A sale is overdue when its date plus the customer's payment terms has passed. Figures in ${cur}.</p>
    ${edit ? form(edit) : ''}
    ${toAdd.length ? html`<div class="callout info small"><b>Names already used on shipments and sales</b>: add them as partners so their records link up.
      <div class="chips">${toAdd.slice(0, 20).map(n => html`<button class="btn small" data-act="ptAddName" data-name="${n.name}" data-kind="${n.kind}">+ ${n.name} <span class="muted">${kindLabel(n.kind).toLowerCase()}</span></button> `)}</div></div>` : ''}
    ${list.length ? html`<div class="table-wrap"><table class="table compact">
      <thead><tr><th>Name</th><th>Type</th><th>Country</th><th>Terms</th><th class="r">Sold</th><th class="r">They owe</th><th class="r">Overdue</th><th class="r">Bought</th><th class="r">We owe</th></tr></thead>
      <tbody>${list.map(p => html`<tr class="${p.id === open ? 'sel' : ''} ${p.off ? 'muted' : ''}">
        <td><button class="link" data-act="ptOpen" data-id="${p.id}">${p.name}</button></td><td>${kindLabel(p.kind)}</td><td>${p.country || ''}</td><td>${termsLabel(p.terms)}</td>
        <td class="r nowrap">${p.sold ? m(p.sold) : '—'}</td><td class="r nowrap">${p.owedToUs ? m(p.owedToUs) : '—'}</td>
        <td class="r nowrap ${p.overdue ? 'bad' : ''}">${p.overdue ? m(p.overdue) : '—'}</td><td class="r nowrap">${p.bought ? m(p.bought) : '—'}</td><td class="r nowrap">${p.weOwe ? m(p.weOwe) : '—'}</td>
      </tr>`)}</tbody></table></div>` : html`<p class="empty">No partners yet. Add one with "New partner", or add the names above.</p>`}
  </section>
  ${sel ? detail(sel, c, cur) : ''}`;
}

const yearStart = today => `${today.slice(0, 4)}-01-01`;

export const actions = {
  ptNew() { editing = 'new'; draftName = ''; draftKind = 'customer'; notice = ''; },
  ptAddName(el) { editing = 'new'; draftName = el.dataset.name; draftKind = el.dataset.kind || 'customer'; notice = 'Check the details, then Save.'; },
  ptEdit(el) { editing = el.dataset.id; notice = ''; },
  ptCancel() { editing = ''; },
  ptOpen(el) { open = open === el.dataset.id ? '' : el.dataset.id; stmt = null; },
  ptStmt(el, c) { stmt = { id: open, from: yearStart(c.today), to: c.today }; },
  ptStmtClose() { stmt = null; },
  ptPrint() { window.print(); },
  ptToggle(el, c) {
    const p = (c.company.partners || []).find(x => x.id === el.dataset.id);
    if (!p) return;
    if (!p.off && !confirm(`Stop using ${p.name}? Old shipments and sales keep the name.`)) return;
    store.updateCompany(co => { const x = co.partners.find(y => y.id === p.id); if (x) x.off = !x.off; });
    notice = p.off ? `${p.name} is in use again.` : `${p.name} is no longer in use.`;
  },
  ptDelete(el, c) {
    const p = (c.company.partners || []).find(x => x.id === el.dataset.id);
    if (!p || !store.isAdmin || !confirm(`Delete ${p.name} from the partner list? Shipments and sales keep the name.`)) return;
    store.updateCompany(co => { co.partners = co.partners.filter(x => x.id !== p.id); });
    open = ''; notice = `${p.name} deleted.`;
  },
  ptExcel(el, c) {
    const cur = c.global.fx.base;
    downloadText(`Partners ${c.today}.xlsx`, xlsxBytes(partnerSheets(partnerList(c.company, c.global.fx, cur, c.today), cur)), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  },
};

export const changes = {
  ptOff(el) { showOff = el.checked; },
  ptFrom(el) { if (stmt) stmt.from = el.value; },
  ptTo(el) { if (stmt) stmt.to = el.value; },
  ptShipPaid(el, c) {
    store.updateCompany(co => { const s = co.shipments.find(x => x.id === el.dataset.id); if (s) { s.supplierPaid = el.checked; s.supplierPaidOn = el.checked ? c.today : ''; } });
  },
};

export const submits = {
  ptSave(fd, c) {
    const v = k => String(fd.get(k) || '').trim();
    const p = { name: v('name'), kind: v('kind') || 'customer', country: v('country'), city: v('city'), phone: v('phone'), email: v('email'), trn: v('trn'), currency: v('currency') || 'USD', terms: +v('terms') || 0, person: v('person'), notes: v('notes') };
    const id = v('id');
    if (!p.name) { notice = 'Enter the name.'; return false; }
    const twin = samePartner(c.company.partners, p.name, id);
    if (twin) { notice = `${twin.name} is already a partner.`; return false; }
    const was = id && (c.company.partners || []).find(x => x.id === id);
    store.updateCompany(co => {
      co.partners ||= [];
      if (was) {
        Object.assign(co.partners.find(y => y.id === id), p);
        // a new name: the shipments and sales under the old one follow it
        if (was.name !== p.name) {
          for (const s of co.shipments) if (s.supplier === was.name) s.supplier = p.name;
          for (const x of co.sales) if (x.customer === was.name) x.customer = p.name;
        }
      } else {
        const nid = uid('pt');
        co.partners.push({ id: nid, ...p, off: false, created: c.today, division: TRADING });
        open = nid;
      }
    });
    notice = `${p.name} saved.`;
    editing = ''; draftName = '';
  },
};
