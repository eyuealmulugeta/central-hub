import { store } from '../core/store.js';
import { TEMPLATES, defaultParams } from '../engine/bom.js';
import { makeDoc, poLines } from '../engine/billing.js';
import { uid, money, num, fmtDay, fromDay, toCSV, downloadText } from '../core/util.js';
import { html, options, field, chip } from './dom.js';

let selected = null;
let tab = 'boq';
let notice = '';

const STATUS = [['not_ordered', 'Not ordered'], ['ordered', 'Ordered'], ['delivered', 'Delivered']];

function paramInput(def, value, materials) {
  const attrs = html`data-chg="param" data-k="${def.key}" data-fk="p-${def.key}"`;
  if (def.type === 'bool') return html`<label class="check"><input type="checkbox" ${attrs} ${value ? 'checked' : ''}> ${def.label}</label>`;
  if (def.type === 'select') return html`<label>${def.label} <select ${attrs}>${options(def.options, value)}</select></label>`;
  if (def.type === 'material') return html`<label>${def.label} <select ${attrs}>${options(materials.map(m => [m.id, `${m.name} (${m.unit})`]), value)}</select></label>`;
  return html`<label><span>${def.label}${def.unit ? `, ${def.unit}` : ''}</span>
    <input type="number" step="any" min="${def.min ?? 0}" ${def.max != null ? html`max="${def.max}"` : ''} ${attrs} value="${value}"></label>`;
}

export function render(c) {
  const { ws, boq, bom, project: p, global, flags } = c;
  const cur = ws.assemblies.find(a => a.id === selected) || ws.assemblies[0];
  const tpl = cur && TEMPLATES[cur.templateId];
  const params = cur && { ...defaultParams(cur.templateId), ...cur.params };
  const metrics = cur ? bom.metrics[cur.id] || {} : {};
  const t = boq.totals;
  const m = p.markups;
  const region = global.regions.find(r => r.id === p.regionId);

  return html`
    <section class="card">
      <h2>Components</h2>
      <ul class="list">${ws.assemblies.map(a => html`
        <li><button class="row pick ${a === cur ? 'sel' : ''}" data-act="select" data-id="${a.id}">
          <span class="row-main"><b>${a.name}</b><span class="muted">${TEMPLATES[a.templateId]?.name}</span></span>
        </button></li>`)}</ul>
      <label>Add from library
        <select data-chg="add">
          <option value="">Choose a component…</option>
          ${options(Object.entries(TEMPLATES).map(([id, tp]) => [id, tp.name]), null)}
        </select>
      </label>
    </section>

    <section class="card">
      ${cur ? html`
        <h2>Dimensions</h2>
        <div class="form">
          <label>Name <input data-chg="name" data-fk="a-name" value="${cur.name}"></label>
          <div class="grid2">${tpl.params.map(d => paramInput(d, params[d.key], global.materials))}</div>
          <label>Needed on site for
            <select data-chg="task" data-fk="a-task">
              <option value="">Not linked to a task</option>
              ${options(ws.tasks.map(tk => [tk.id, tk.name]), cur.taskId || null)}
            </select>
          </label>
          <dl class="facts">${Object.entries(metrics).map(([k, v]) => html`<dt>${k}</dt><dd>${typeof v === 'number' ? num(v, 1) : v}</dd>`)}</dl>
          <p class="muted">Quantities are estimating take-offs from rules of thumb, not a structural design.</p>
          <button class="btn danger" data-act="remove">Remove component</button>
        </div>` : html`<p class="empty">Add a component from the library to start an estimate.</p>`}
    </section>

    <section class="card">
      <div class="toolbar">
        <div class="seg">
          <button class="${tab === 'boq' ? 'on' : ''}" data-act="tab" data-t="boq">Bill of quantities</button>
          <button class="${tab === 'proc' ? 'on' : ''}" data-act="tab" data-t="proc">Procurement</button>
        </div>
        <span class="muted">${region?.name || 'No region'} prices in ${p.currency}${boq.steelT ? `, ${num(boq.steelT, 1)} t steel` : ''}</span>
        <span class="grow"></span>
        <span class="muted">${notice}</span>
        ${tab === 'proc' ? html`<button class="btn" data-act="po" title="One purchase order per supplier, for materials not ordered yet">Create purchase orders</button>` : ''}
        <button class="btn" data-act="csv">Export CSV</button>
      </div>

      ${tab === 'boq' ? html`
        <table class="table compact">
          <thead><tr><th>Item</th><th>Material</th><th class="r">Net qty</th><th class="r">Waste</th><th class="r">Order qty</th><th>Unit</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
          ${ws.assemblies.map(a => html`
            <tbody>
              <tr class="group"><td colspan="8">${a.name}</td></tr>
              ${boq.rows.filter(r => r.assemblyId === a.id).map(r => html`
                <tr>
                  <td>${r.element}${r.note ? html`<span class="muted note">${r.note}</span>` : ''}</td>
                  <td>${r.name}</td>
                  <td class="r">${num(r.qty)}</td>
                  <td class="r muted">${r.waste}%</td>
                  <td class="r">${num(r.orderQty)}</td>
                  <td>${r.unit}</td>
                  <td class="r">${r.missing ? chip('No price', 'warn') : num(r.rate)}</td>
                  <td class="r">${num(r.amount, 0)}</td>
                </tr>`)}
            </tbody>`)}
        </table>
        <dl class="totals">
          <dt>Direct cost</dt><dd>${money(t.direct, p.currency)}</dd>
          <dt>Overhead ${m.overhead}%</dt><dd>${money(t.overhead, p.currency)}</dd>
          <dt>Contingency ${m.contingency}%</dt><dd>${money(t.contingency, p.currency)}</dd>
          <dt>Profit ${m.profit}%</dt><dd>${money(t.profit, p.currency)}</dd>
          <dt>VAT ${m.vat}%</dt><dd>${money(t.vat, p.currency)}</dd>
          <dt class="grand">Estimate total</dt><dd class="grand">${money(t.total, p.currency)}</dd>
        </dl>` : html`
        <table class="table compact">
          <thead><tr><th>Material</th><th class="r">Order qty</th><th>Unit</th><th class="r">Est. cost</th><th class="r">Lead</th><th>Needed for</th><th>Needed</th><th>Supplier</th><th>Status</th><th>Expected</th><th></th></tr></thead>
          <tbody>${boq.procurement.map(r => {
            const st = ws.procurement[r.materialId] || {};
            const posted = ws.ledger.some(l => l.id === st.ledgerId);
            return html`<tr>
              <td>${r.name}</td>
              <td class="r">${num(r.qty)}</td>
              <td>${r.unit}</td>
              <td class="r">${num(r.amount, 0)}</td>
              <td class="r">${r.leadDays} d</td>
              <td><select class="task-pick" data-chg="need" data-id="${r.materialId}" data-fk="nd-${r.materialId}" aria-label="Task that needs ${r.name}">
                <option value="">Same as component</option>${options(ws.tasks.map(tk => [tk.id, tk.name]), st.taskId || null)}</select></td>
              <td class="nowrap">${flags.needBy[r.materialId] != null ? fmtDay(flags.needBy[r.materialId]) : '—'}</td>
              <td><input class="supplier" list="suppliers" data-chg="supplier" data-id="${r.materialId}" data-fk="sp-${r.materialId}" value="${st.supplier || ''}" placeholder="Supplier" aria-label="Supplier, ${r.name}"></td>
              <td><select data-chg="status" data-id="${r.materialId}" data-fk="st-${r.materialId}" aria-label="Order status, ${r.name}">${options(STATUS, st.status || 'not_ordered')}</select></td>
              <td><input type="date" data-chg="eta" data-id="${r.materialId}" data-fk="eta-${r.materialId}" value="${st.eta || ''}" aria-label="Expected delivery, ${r.name}"></td>
              <td class="r nowrap">${posted ? chip('In costs', 'ok') : html`
                <button class="btn small" data-act="post" data-id="${r.materialId}" title="Mark as ordered and add the estimated cost to Costs">Order and add to costs</button>`}</td>
            </tr>`;
          })}</tbody>
        </table>
        <datalist id="suppliers">${[...new Set(Object.values(ws.procurement).map(x => x.supplier).filter(Boolean))].map(n => html`<option value="${n}"></option>`)}</datalist>
        <p class="muted">Needed dates follow the forecast start of the task, so they move when the schedule moves.</p>`}
    </section>`;
}

const current = ws => ws.assemblies.find(a => a.id === selected) || ws.assemblies[0];

export const actions = {
  select(el) { selected = el.dataset.id; },
  tab(el) { tab = el.dataset.t; notice = ''; },
  remove(el, c) {
    const a = current(c.ws);
    if (!a || !confirm(`Remove "${a.name}" from the estimate? Its quantities leave the bill of quantities and procurement.`)) return;
    store.update(ws => { const x = current(ws); ws.assemblies = ws.assemblies.filter(y => y !== x); });
    selected = null;
  },
  /** One click: the material becomes "ordered" and its estimated cost is posted as an expense. */
  post(el, c) {
    const r = c.boq.procurement.find(x => x.materialId === el.dataset.id);
    if (!r || !(r.amount > 0)) return;
    const ledgerId = uid('l');
    store.update(ws => {
      ws.ledger.push({
        id: ledgerId, date: c.today, type: 'expense', category: 'material', vendor: '',
        description: `${r.name}, ${num(r.qty)} ${r.unit} (from estimate)`,
        amount: Math.round(r.amount * 100) / 100, currency: c.project.currency,
      });
      const prev = ws.procurement[r.materialId] || {};
      ws.procurement[r.materialId] = { ...prev, status: prev.status && prev.status !== 'not_ordered' ? prev.status : 'ordered', ledgerId };
    });
  },
  /** One purchase order per supplier, covering every material of theirs that is not ordered yet. */
  po(el, c) {
    const bySupplier = new Map();
    for (const r of c.boq.procurement) {
      const st = c.ws.procurement[r.materialId] || {};
      const supplier = (st.supplier || '').trim();
      if (!supplier || (st.status || 'not_ordered') !== 'not_ordered') continue;
      bySupplier.set(supplier, [...(bySupplier.get(supplier) || []), r]);
    }
    if (!bySupplier.size) { notice = 'Enter a supplier for at least one material that is not ordered yet.'; return; }
    store.update(ws => {
      for (const [supplier, rows] of bySupplier) {
        const needs = rows.map(r => c.flags.needBy[r.materialId]).filter(d => d != null);
        const doc = makeDoc({
          type: 'po', project: c.project, docs: ws.docs, today: c.today, lines: poLines(rows), party: { name: supplier },
          due: needs.length ? fromDay(Math.min(...needs)) : c.today,
        });
        ws.docs.push(doc);
        for (const r of rows) ws.procurement[r.materialId] = { ...ws.procurement[r.materialId], status: 'ordered', poId: doc.id };
      }
    });
    notice = `${bySupplier.size} purchase order${bySupplier.size > 1 ? 's' : ''} created. Open Finance, Invoices and documents to review and print.`;
  },
  csv(el, c) {
    const { boq, project: p } = c;
    const rows = tab === 'boq'
      ? [['Component', 'Item', 'Material', 'Net qty', 'Waste %', 'Order qty', 'Unit', `Rate (${p.currency})`, `Amount (${p.currency})`],
        ...boq.rows.map(r => [r.assemblyName, r.element, r.name, r.qty.toFixed(3), r.waste, r.orderQty.toFixed(3), r.unit, r.rate.toFixed(2), r.amount.toFixed(2)]),
        [], ...Object.entries(boq.totals).map(([k, v]) => ['', '', '', '', '', '', '', k, v.toFixed(2)])]
      : [['Material', 'Order qty', 'Unit', `Est. cost (${p.currency})`, 'Lead days', 'Needed', 'Status', 'Expected'],
        ...boq.procurement.map(r => {
          const st = c.ws.procurement[r.materialId] || {};
          const need = c.flags.needBy[r.materialId];
          return [r.name, r.qty.toFixed(3), r.unit, r.amount.toFixed(2), r.leadDays, need != null ? fromDay(need) : '', st.status || 'not_ordered', st.eta || ''];
        })];
    downloadText(`${p.name} ${tab === 'boq' ? 'BOQ' : 'procurement'}.csv`, '﻿' + toCSV(rows));
  },
};

export const changes = {
  add(el) {
    const templateId = el.value;
    if (!TEMPLATES[templateId]) return;
    const a = { id: uid('a'), templateId, name: TEMPLATES[templateId].name, params: defaultParams(templateId), taskId: '' };
    store.update(ws => ws.assemblies.push(a));
    selected = a.id;
  },
  name(el) { store.update(ws => { current(ws).name = el.value.trim() || 'Component'; }); },
  task(el) { store.update(ws => { current(ws).taskId = el.value; }); },
  param(el) {
    const def = TEMPLATES[current(store.ws).templateId].params.find(d => d.key === el.dataset.k);
    let value = field(el);
    if (typeof value === 'number') {
      if (def.min != null) value = Math.max(def.min, value);
      if (def.max != null) value = Math.min(def.max, value);
    }
    store.update(ws => { current(ws).params[def.key] = value; });
  },
  supplier(el) {
    store.update(ws => { ws.procurement[el.dataset.id] = { status: 'not_ordered', ...ws.procurement[el.dataset.id], supplier: el.value.trim() }; });
  },
  status(el) {
    store.update(ws => { ws.procurement[el.dataset.id] = { ...ws.procurement[el.dataset.id], status: el.value }; });
  },
  need(el) {
    store.update(ws => { ws.procurement[el.dataset.id] = { status: 'not_ordered', ...ws.procurement[el.dataset.id], taskId: el.value }; });
  },
  eta(el) {
    store.update(ws => { ws.procurement[el.dataset.id] = { status: 'not_ordered', ...ws.procurement[el.dataset.id], eta: el.value }; });
  },
};
