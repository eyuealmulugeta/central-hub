import { store } from '../core/store.js';
import { CATEGORIES } from '../engine/ledger.js';
import { uid, money, fmtDate } from '../core/util.js';
import { html, options, meter, chip } from './dom.js';

const LABEL = { labor: 'Labour', material: 'Material', equipment: 'Equipment', subcontract: 'Subcontract', transport: 'Transport', overhead: 'Overhead' };

let only = null;   // 'income' or 'expense' when the menu opened this screen as Income or Expenses

/** Opened from the menu as Ledger (everything), Income or Expenses. */
export function preset(p = {}) { only = p.only || null; }

export function render(c) {
  const { led, project: p, global } = c;
  const rows = led.rows.filter(r => !only || r.type === only);
  const cur = p.currency;
  const currencies = Object.keys(global.fx.rates).map(k => [k, k]);
  const top = Math.max(1, ...Object.values(led.byCategory));

  const kpi = (label, value, sub, cls = '') => html`
    <div class="kpi"><span class="kpi-label">${label}</span><strong class="${cls}">${value}</strong><span class="muted">${sub}</span></div>`;

  return html`
    <section class="kpis">
      ${kpi('Budget', money(led.budget, cur), `${money(led.remaining, cur)} remaining`, led.remaining < 0 ? 'bad' : '')}
      ${kpi('Spent', money(led.spent, cur), led.budget ? `${Math.round(led.spent / led.budget * 100)}% of budget` : 'No budget set')}
      ${kpi('Received', money(led.income, cur), `Contract ${money(p.contractValue, cur)}`)}
      ${kpi('Cash position', money(led.cash, cur), led.cpi == null ? 'Cost index not available yet' : `Cost index ${led.cpi.toFixed(2)} (1.00 = on budget)`, led.cash < 0 ? 'bad' : '')}
    </section>

    <section class="card">
      <form data-form="entry" class="entry">
        <input type="date" name="date" value="${c.today}" required aria-label="Date">
        <select name="type" aria-label="Type"><option value="expense" ${only === 'income' ? '' : 'selected'}>Expense</option><option value="income" ${only === 'income' ? 'selected' : ''}>Payment received</option></select>
        <select name="category" aria-label="Category">${options(CATEGORIES.map(k => [k, LABEL[k]]), 'material')}</select>
        <input name="description" placeholder="Description" required aria-label="Description" class="wide">
        <input name="vendor" placeholder="Vendor or payer" aria-label="Vendor or payer">
        <input type="number" name="amount" min="0" step="any" placeholder="Amount" required aria-label="Amount" class="amount">
        <select name="currency" aria-label="Currency">${options(currencies, cur)}</select>
        <button class="btn primary">Add</button>
      </form>
      <table class="table">
        <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Vendor</th><th class="r">Amount</th><th class="r">In ${cur}</th><th></th></tr></thead>
        <tbody>${rows.map(r => html`
          <tr>
            <td class="nowrap">${fmtDate(r.date)}</td>
            <td>${r.type === 'income' ? chip('Received', 'ok') : chip(LABEL[r.category] || r.category)}</td>
            <td>${r.description}${r.estimate ? html` ${chip('estimate, not counted: the crew is paid through Payments', 'warn')}` : r.auto ? html` ${chip('auto', 'info')}` : ''}${r.payId ? html` ${chip('Payments', 'info')}` : ''}</td>
            <td class="muted">${r.vendor || ''}</td>
            <td class="r nowrap">${money(r.amount, r.currency)}</td>
            <td class="r nowrap ${r.type === 'income' ? 'ok' : ''}">${r.type === 'income' ? '+' : '−'}${money(r.base, cur)}</td>
            <td class="r">${r.auto || r.payId ? '' : html`<button class="btn ghost small" data-act="remove" data-id="${r.id}">Delete</button>`}</td>
          </tr>`)}</tbody>
      </table>
      ${rows.length ? '' : html`<p class="empty">${led.rows.length ? `No ${only === 'income' ? 'payments received' : 'expenses'} yet.` : 'No entries yet.'}</p>`}
    </section>

    <section class="card">
      <h2>Spend by category</h2>
      <ul class="list">${CATEGORIES.map(k => html`
        <li class="stack">
          <span class="split"><b>${LABEL[k]}</b><span>${money(led.byCategory[k], cur)}</span></span>
          ${meter(led.byCategory[k] / top * 100)}
        </li>`)}</ul>
      <p class="muted">Labour is posted automatically from the manpower logged in daily reports, at the day rates set on the Settings screen.</p>
    </section>`;
}

export const submits = {
  entry(fd) {
    const amount = +fd.get('amount');
    if (!(amount > 0)) return false;
    store.update(ws => ws.ledger.push({
      id: uid('l'), date: fd.get('date'), type: fd.get('type'), category: fd.get('category'),
      description: fd.get('description').trim(), vendor: fd.get('vendor').trim(), amount, currency: fd.get('currency'),
    }));
  },
};

export const actions = {
  remove(el, c) {
    const r = c.ws.ledger.find(x => x.id === el.dataset.id);
    if (!r || !confirm(`Delete "${r.description}" (${money(r.amount, r.currency)}) from the costs?`)) return;
    store.update(ws => { ws.ledger = ws.ledger.filter(x => x.id !== r.id); });
  },
};
